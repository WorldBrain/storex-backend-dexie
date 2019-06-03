import Dexie from 'dexie'
import 'dexie-mongoify'

import { StorageRegistry, CollectionDefinition } from '@worldbrain/storex'
import { CreateObjectDissection, dissectCreateObjectOperation, convertCreateObjectDissectionToBatch, setIn } from '@worldbrain/storex/lib/utils'
// import { CollectionDefinition } from 'storex/types'
import * as backend from '@worldbrain/storex/lib/types/backend'
import { getDexieHistory } from './schema'
import { DexieMongoify, DexieSchema } from './types'
import { StorageBackendFeatureSupport } from '@worldbrain/storex/lib/types/backend-features';
import { UnimplementedError, InvalidOptionsError } from '@worldbrain/storex/lib/types/errors';
import { _flattenBatch } from './utils';
import { StemmerSelector, Stemmer, SchemaPatcher } from './types'
import { _processFieldUpdates } from './update-ops';
import { makeCleanerChain, _makeCustomFieldCleaner, _cleanFullTextIndexFieldsForWrite, _cleanFieldAliasesForWrites, _cleanFieldAliasesForReads } from './object-cleaning';
export { Stemmer, StemmerSelector, SchemaPatcher } from './types'

export interface IndexedDbImplementation {
    factory: IDBFactory
    range: new () => IDBKeyRange
}

const IdentitySchemaPatcher: SchemaPatcher = f => f

export interface DexieStorageBackendOptions {
    dbName: string
    stemmer?: Stemmer
    stemmerSelector?: StemmerSelector
    idbImplementation?: IndexedDbImplementation
    /**
     * An optional function to run the generated Dexie schemas through to
     * afford changing them independently of the storex registry. Identity
     * function by default.
     **/
    schemaPatcher?: SchemaPatcher
}

export class DexieStorageBackend extends backend.StorageBackend {
    public features: StorageBackendFeatureSupport = {
        count: true,
        createWithRelationships: true,
        fullTextSearch: true,
        executeBatch: true,
        transaction: true,
    }

    private dbName : string
    private idbImplementation : IndexedDbImplementation
    private dexie! : DexieMongoify
    private stemmerSelector : StemmerSelector
    private schemaPatcher : SchemaPatcher
    private initialized = false
    private readObjectCleaner = makeCleanerChain([
        _cleanFieldAliasesForReads,
        _makeCustomFieldCleaner({ purpose: 'read' }),
    ])
    private createObjectCleaner = makeCleanerChain([
        _makeCustomFieldCleaner({ purpose: 'create' }),
        _cleanFullTextIndexFieldsForWrite,
        _cleanFieldAliasesForWrites,
    ])
    private updateObjectCleaner = makeCleanerChain([
        _makeCustomFieldCleaner({ purpose: 'create' }),
        _cleanFullTextIndexFieldsForWrite,
        _cleanFieldAliasesForWrites,
    ])
    private whereObjectCleaner = makeCleanerChain([
        _makeCustomFieldCleaner({ purpose: 'query-where' }),
        _cleanFieldAliasesForWrites,
    ])

    constructor({
        dbName,
        idbImplementation = undefined,
        stemmer = undefined,
        stemmerSelector = undefined,
        schemaPatcher = IdentitySchemaPatcher,
    }: DexieStorageBackendOptions) {
        super()

        if (!stemmerSelector) {
            if (stemmer) {
                stemmerSelector = () => stemmer
            } else {
                stemmerSelector = () => null
            }
        } else if (stemmer) {
            throw new Error(`You cannot pass both a 'stemmer' and a 'stemmerSelector' into DexieStorageBackend`)
        }

        this.dbName = dbName
        this.idbImplementation = idbImplementation || { factory: window.indexedDB, range: window['IDBKeyRange'] }
        this.stemmerSelector = stemmerSelector
        this.schemaPatcher = schemaPatcher
    }

    get dexieInstance() {
        return this.dexie
    }

    configure({ registry }: { registry: StorageRegistry }) {
        super.configure({ registry })
        registry.once('initialized', this._onRegistryInitialized)

        // const origCreateObject = this.createObject.bind(this)
        // this.createObject = augmentCreateObject(origCreateObject, { registry })
    }

    supports(feature: string) {
        if (feature !== 'fullTextSearch') {
            return super.supports(feature)
        }

        return !!this.stemmerSelector
    }

    _onRegistryInitialized = () => {
        this._validateRegistry()
        this._initDexie()
        this.initialized = true
    }

    _validateRegistry() {
        if (this.stemmerSelector) {
            return
        }

        // See if we're trying to create full-text indices without providing a stemmer
        for (const [collectionName, collectionDefinition] of Object.entries(this.registry.collections)) {
            for (const index of collectionDefinition.indices || []) {
                if (typeof index === 'string') {
                    const field = collectionDefinition.fields[index]
                    if (field.type === 'text') {
                        throw new Error(
                            `Trying to create full-text index on '${collectionName}.${index}'
                            without having supplied a stemmer to the Dexie back-end`
                        )
                    }
                }
            }
        }
    }

    _initDexie = () => {
        this.dexie = new Dexie(this.dbName, {
            indexedDB: this.idbImplementation.factory,
            IDBKeyRange: this.idbImplementation.range
        }) as DexieMongoify

        // DexieMongofiy binds the .collection to the last DB created, creating confusing situations when using multiple DBs at the same time
        Dexie.prototype['collection'] = function collection(collectionName : string) {
            return this.table(collectionName);
        }

        const dexieHistory = getDexieHistory(this.registry)

        for (const { version, schema } of this.schemaPatcher(dexieHistory)) {
            this.dexie.version(version).stores(schema)
        }
    }

    async migrate({ database }: { database?: string } = {}) {
        if (database) {
            throw new Error('This backend doesn\'t support multiple databases directly')
        }
    }

    async cleanup(): Promise<any> {

    }

    async createObject(collection: string, object : any, options: backend.CreateSingleOptions = {}): Promise<backend.CreateSingleResult> {
        return this._complexCreateObject(collection, object, {...options, needsRawCreates: false})
    }

    async _complexCreateObject(collection: string, object : any, options: backend.CreateSingleOptions & {needsRawCreates : boolean}) {
        const dissection = dissectCreateObjectOperation({operation: 'createObject', collection, args: object}, this.registry)
        const batchToExecute = convertCreateObjectDissectionToBatch(dissection)
        const batchResult = await this._rawExecuteBatch(batchToExecute, {needsRawCreates: true})
        this._reconstructCreatedObject(object, collection, dissection, batchResult.info)

        return { object }
    }

    async _reconstructCreatedObject(object : any, collection : string, operationDissection : CreateObjectDissection, batchResultInfo : any) {
        for (const step of operationDissection.objects) {
            const collectionDefiniton = this.registry.collections[collection]
            const pkIndex = collectionDefiniton.pkIndex
            setIn(object, [...step.path, pkIndex], batchResultInfo[step.placeholder].object[pkIndex as string])
        }
    }

    async _rawCreateObject(collection: string, object : any, options: backend.CreateSingleOptions = {}) {
        const { collectionDefinition } = this._prepareOperation({ operationName: 'createObject', collection })
        
        await this.createObjectCleaner(object, {
            collectionDefinition, 
            stemmerSelector: this.stemmerSelector,
        })
        await this.dexie.table(collection).put(object)

        return { object }
    }

    // TODO: Afford full find support for ignoreCase opt; currently just uses the first filter entry
    private _findIgnoreCase<T>(collection: string, query : any, findOpts: backend.FindManyOptions = {}) {
        // Grab first entry from the filter query; ignore rest for now
        const [[indexName, value], ...fields] = Object.entries<string>(query)

        if (fields.length) {
            throw new UnimplementedError(
                'Find methods with `ignoreCase` set only support querying a single field.',
            )
        }

        if (findOpts.ignoreCase && findOpts.ignoreCase[0] !== indexName) {
            throw new InvalidOptionsError(
                `Specified ignoreCase field '${findOpts.ignoreCase[0]}' is not in filter query.`,
            )
        }

        return this.dexie
            .table<T>(collection)
            .where(indexName)
            .equalsIgnoreCase(value)
    }


    async findObjects<T>(collection : string, query : any, findOpts: backend.FindManyOptions = {}): Promise<Array<T>> {
        const { collectionDefinition } = this._prepareOperation({ operationName: 'findObjects', collection })
        
        const order = findOpts.order && findOpts.order.length ? findOpts.order[0] : null
        if (order && findOpts.order!.length > 1) {
            throw new Error('Sorting on multiple fields is not supported')
        }
        const descendingOrder = findOpts.reverse || (order && order[1] == 'desc')

        await this.whereObjectCleaner(query, { collectionDefinition, stemmerSelector: this.stemmerSelector })
        let coll = findOpts.ignoreCase && findOpts.ignoreCase.length
            ? this._findIgnoreCase<T>(collection, query, findOpts)
            : this.dexie.collection<T>(collection).find(query)

        let results
        if (order) {
            results = await coll.sortBy(order[0])
            if (descendingOrder) {
                results.reverse()
            }
            if (findOpts.limit) {
                results = results.slice(0, findOpts.limit)
            }
        } else {
            if (findOpts.skip && findOpts.skip > 0) {
                coll = coll.offset(findOpts.skip)
            }

            if (findOpts.limit) {
                coll = coll.limit(findOpts.limit)
            }

            results = await coll.toArray()
        }
        
        await Promise.all(results.map(async object => {
            await this.readObjectCleaner(object, {
                collectionDefinition,
                stemmerSelector: this.stemmerSelector,
            })
        }))
        
        return results
    }

    async updateObjects(collection: string, where : any, updates : any, options: backend.UpdateManyOptions = {}): Promise<backend.UpdateManyResult> {
        const { collectionDefinition } = this._prepareOperation({ operationName: 'updateObjects', collection })
        
        await this.updateObjectCleaner(updates, {
            collectionDefinition,
            stemmerSelector: this.stemmerSelector,
        })

        const objects = await this.findObjects(collection, where, options)

        for (const object of objects) {
            _processFieldUpdates(updates, object)
            await this.dexie.table(collection).put(object)
        }
    }

    async deleteObjects(collection : string, query : any, options : backend.DeleteManyOptions = {}): Promise<backend.DeleteManyResult> {
        const { collectionDefinition } = this._prepareOperation({ operationName: 'deleteObjects', collection })
        
        this.whereObjectCleaner(query, {
            collectionDefinition,
            stemmerSelector: this.stemmerSelector,
        })

        const { deletedCount } = await this.dexie
            .collection(collection)
            .remove(query)

        // return deletedCount
    }

    async countObjects(collection: string, query : any) {
        return this.dexie.collection(collection).count(query)
    }

    async executeBatch(batch : backend.OperationBatch) {
        if (!batch.length) {
            return { info: {} }
        }

        const collections = Array.from(new Set(_flattenBatch(batch, this.registry).map(operation => operation.collection)))
        let info = null
        await this.transaction({ collections }, async () => {
            info = (await this._rawExecuteBatch(batch, {needsRawCreates: false})).info
        })
        return { info }
    }

    async transaction(options : { collections: string[] }, body : Function) {
        const executeBody = async () => {
            return body({ transactionOperation: (name : string, ...args : any[]) => {
                return this.operation(name, ...args)
            } })
        }

        if (typeof navigator !== 'undefined') {
            const tables = options.collections.map(collection => this.dexie.table(collection))
            return this.dexie.transaction('rw', tables, executeBody)
        } else {
            return executeBody()
        }
    }

    async _rawExecuteBatch(
        batch : backend.OperationBatch,
        options : {needsRawCreates : boolean}
    ) {
        const info = {}
        const placeholders = {}
        for (const operation of batch) {
            if (operation.operation === 'createObject') {
                for (const { path, placeholder } of operation.replace || []) {
                    operation.args[path as string] = placeholders[placeholder].id
                }

                const { object } = options.needsRawCreates
                    ? await this._rawCreateObject(operation.collection, operation.args)
                    : await this._complexCreateObject(operation.collection, operation.args, {needsRawCreates: true})

                if (operation.placeholder) {
                    info[operation.placeholder] = {object}
                    placeholders[operation.placeholder] = object
                }
            } else if (operation.operation === 'updateObjects') {
                await this.updateObjects(operation.collection, operation.where, operation.updates)
            }
        }
        return { info }
    }

    async operation(name : string, ...args : any[]) {
        if (!this.initialized) {
            throw new Error('Tried to use Dexie backend without calling StorageManager.finishInitialization() first')
        }
        // console.log('operation', name)
        return await super.operation(name, ...args)
    }

    _prepareOperation(options : { operationName : string, collection : string }) : { collectionDefinition : CollectionDefinition } {
        const collectionDefinition = this.registry.collections[options.collection]
        if (!collectionDefinition) {
            throw new Error(`Tried to do '${options.operationName}' operation on non-existing collection: ${options.collection}`)
        }
        return { collectionDefinition }
    }
}
