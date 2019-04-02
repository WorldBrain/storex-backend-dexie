import Dexie from 'dexie'
import 'dexie-mongoify'

import { StorageRegistry } from '@worldbrain/storex'
import { CreateObjectDissection, dissectCreateObjectOperation, convertCreateObjectDissectionToBatch, setIn } from '@worldbrain/storex/lib/utils'
// import { CollectionDefinition } from 'storex/types'
import * as backend from '@worldbrain/storex/lib/types/backend'
import { augmentCreateObject } from '@worldbrain/storex/lib/backend/utils'
import { getDexieHistory, getTermsIndex } from './schema'
import { DexieMongoify, DexieSchema, UpdateOps } from './types'
import { IndexDefinition, CollectionField, CollectionDefinition } from '@worldbrain/storex/lib/types';
import { StorageBackendFeatureSupport } from '@worldbrain/storex/lib/types/backend-features';
import { UnimplementedError, InvalidOptionsError } from '@worldbrain/storex/lib/types/errors';

export interface IndexedDbImplementation {
    factory: IDBFactory
    range: new () => IDBKeyRange
}

export type Stemmer = (text: string) => Set<string>
export type SchemaPatcher = (schema: DexieSchema[]) => DexieSchema[]

const IdentitySchemaPatcher: SchemaPatcher = f => f

interface Props {
    dbName: string
    stemmer?: Stemmer
    idbImplementation?: IndexedDbImplementation
    /**
     * An optional function to run the generated Dexie schemas through to
     * afford changing them independently of the storex registry. Identity
     * function by default.
     **/
    schemaPatcher?: SchemaPatcher
}

export class DexieStorageBackend extends backend.StorageBackend {
    features: StorageBackendFeatureSupport = {
        count: true,
        createWithRelationships: true,
        fullTextSearch: true,
        executeBatch: true,
        transaction: true,
    }

    private dbName : string
    private idbImplementation : IndexedDbImplementation
    private dexie : DexieMongoify
    private stemmer : Stemmer
    private schemaPatcher : SchemaPatcher
    private initialized = false

    constructor({
        dbName,
        idbImplementation = null,
        stemmer = null,
        schemaPatcher = IdentitySchemaPatcher,
    }: Props) {
        super()

        this.dbName = dbName
        this.idbImplementation = idbImplementation || { factory: window.indexedDB, range: window['IDBKeyRange'] }
        this.stemmer = stemmer
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

        return !!this.stemmer
    }

    _onRegistryInitialized = () => {
        this._validateRegistry()
        this._initDexie()
        this.initialized = true
    }

    _validateRegistry() {
        if (this.stemmer) {
            return
        }

        // See if we're trying to create full-text indices without providing a stemmer
        for (const [collectionName, collectionDefinition] of Object.entries(this.registry.collections)) {
            for (const index of collectionDefinition.indices) {
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
        Dexie.prototype['collection'] = function collection(collectionName) {
            return this.table(collectionName);
        }

        const dexieHistory = getDexieHistory(this.registry)

        this.schemaPatcher(dexieHistory).forEach(({ version, schema }) => {
            this.dexie.version(version)
                .stores(schema)
            // .upgrade(() => {
            //     migrations.forEach(migration => {
            //         // TODO: Call migration with some object that allows for data manipulation
            //     })
            // })
        })
    }

    async migrate({ database }: { database?: string } = {}) {
        if (database) {
            throw new Error('This backend doesn\'t support multiple databases directly')
        }
    }

    async cleanup(): Promise<any> {

    }

    async createObject(collection: string, object, options: backend.CreateSingleOptions = {}): Promise<backend.CreateSingleResult> {
        return this._complexCreateObject(collection, object, {...options, needsRawCreates: false})
    }

    async _complexCreateObject(collection: string, object, options: backend.CreateSingleOptions & {needsRawCreates : boolean}) {
        const dissection = dissectCreateObjectOperation({operation: 'createObject', collection, args: object}, this.registry)
        const batchToExecute = convertCreateObjectDissectionToBatch(dissection)
        const batchResult = await this._rawExecuteBatch(batchToExecute, {needsRawCreates: true})
        this._reconstructCreatedObject(object, collection, dissection, batchResult.info)

        return { object }
    }

    async _reconstructCreatedObject(object, collection : string, operationDissection : CreateObjectDissection, batchResultInfo) {
        for (const step of operationDissection.objects) {
            const collectionDefiniton = this.registry.collections[collection]
            const pkIndex = collectionDefiniton.pkIndex
            setIn(object, [...step.path, pkIndex], batchResultInfo[step.placeholder].object[pkIndex as string])
        }
    }

    async _rawCreateObject(collection: string, object, options: backend.CreateSingleOptions = {}) {
        const collectionDefinition = this.registry.collections[collection]
        await _processFieldsForWrites(collectionDefinition, object, this.stemmer)
        await this.dexie.table(collection).put(object)

        return { object }
    }

    // TODO: Afford full find support for ignoreCase opt; currently just uses the first filter entry
    private _findIgnoreCase<T>(collection: string, query, findOpts: backend.FindManyOptions = {}) {
        // Grab first entry from the filter query; ignore rest for now
        const [[indexName, value], ...fields] = Object.entries<string>(query)

        if (fields.length) {
            throw new UnimplementedError(
                'Find methods with `ignoreCase` set only support querying a single field.',
            )
        }

        if (findOpts.ignoreCase[0] !== indexName) {
            throw new InvalidOptionsError(
                `Specified ignoreCase field '${findOpts.ignoreCase[0]}' is not in filter query.`,
            )
        }

        return this.dexie
            .table<T>(collection)
            .where(indexName)
            .equalsIgnoreCase(value)
    }


    async findObjects<T>(collection: string, query, findOpts: backend.FindManyOptions = {}): Promise<Array<T>> {
        const order = findOpts.order && findOpts.order.length ? findOpts.order[0] : null
        if (order && findOpts.order.length > 1) {
            throw new Error('Sorting on multiple fields is not supported')
        }
        const descendingOrder = findOpts.reverse || (order && order[1] == 'desc')

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
        // console.log(results)
        return results
    }

    async updateObjects(collection: string, query, updates, options: backend.UpdateManyOptions & { _transaction?} = {}): Promise<backend.UpdateManyResult> {
        const collectionDefinition = this.registry.collections[collection]

        const objects = await this.findObjects(collection, query, options)

        for (const object of objects) {
            _processFieldUpdates(updates, object)
            await _processFieldsForWrites(collectionDefinition, object, this.stemmer)
            await this.dexie.table(collection).put(object)
        }
    }

    async deleteObjects(collection: string, query, options: backend.DeleteManyOptions = {}): Promise<backend.DeleteManyResult> {
        const { deletedCount } = await this.dexie
            .collection(collection)
            .remove(query)

        // return deletedCount
    }

    async countObjects(collection: string, query) {
        return this.dexie.collection(collection).count(query)
    }

    async executeBatch(batch : backend.OperationBatch) {
        const collections = Array.from(new Set(_flattenBatch(batch, this.registry).map(operation => operation.collection)))
        let info = null
        await this.transaction({ collections }, async () => {
            info = (await this._rawExecuteBatch(batch, {needsRawCreates: false})).info
        })
        return { info }
    }

    async transaction(options : { collections: string[] }, body : Function) {
        const executeBody = async () => {
            await body({ transactionOperation: (name : string, ...args) => {
                return this.operation(name, ...args)
            } })
        }

        if (typeof navigator !== 'undefined') {
            const tables = options.collections.map(collection => this.dexie.table(collection))
            await this.dexie.transaction('rw', tables, executeBody)
        } else {
            await executeBody()
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
                for (const {path, placeholder} of operation.replace || []) {
                    operation.args[path as string] = placeholders[placeholder].id
                }

                const { object } = options.needsRawCreates
                    ? await this._rawCreateObject(operation.collection, operation.args)
                    : await this._complexCreateObject(operation.collection, operation.args, {needsRawCreates: true})
                info[operation.placeholder] = {object}
                placeholders[operation.placeholder] = object
            } else if (operation.operation === 'updateObjects') {
                await this.updateObjects(operation.collection, operation.where, operation.updates)
            }
        }
        return { info }
    }

    async operation(name : string, ...args) {
        if (!this.initialized) {
            throw new Error('Tried to use Dexie backend without calling StorageManager.finishInitialization() first')
        }
        // console.log('operation', name)
        return await super.operation(name, ...args)
    }
}


/**
 * Handles mutation of a document, updating each field in the way specified
 * in the `updates` object.
 * See for more info: https://github.com/YurySolovyov/dexie-mongoify/blob/master/docs/update-api.md
 *
 * TODO: Proper runtime error handling for badly formed update objs.
 */
export function _processFieldUpdates(updates, object) {
    // TODO: Find a home for this
    // TODO: Support all update ops
    const updateOpAppliers: UpdateOps = {
        $inc: (obj, key, value) => (obj[key] += value),
        $set: (obj, key, value) => (obj[key] = value),
        $mul: (obj, key, value) => (obj[key] *= value),
        $unset: (obj, key) => (obj[key] = undefined),
        $rename: () => undefined,
        $min: () => undefined,
        $max: () => undefined,
        $addToSet: () => undefined,
        $pop: () => undefined,
        $push: () => undefined,
        $pull: () => undefined,
        $pullAll: () => undefined,
        $slice: () => undefined,
        $sort: () => undefined,
    }

    for (const [updateKey, updateVal] of Object.entries(updates)) {
        // If supported update op, run assoc. update op applier
        if (updateOpAppliers[updateKey] != null) {
            Object.entries(updateVal).forEach(([key, val]) =>
                updateOpAppliers[updateKey](object, key, val))
        } else {
            object[updateKey] = updateVal
        }
    }
}

/**
 * Handles mutation of a document to be inserted/updated to storage,
 * depending on needed pre-processing for a given indexed field.
 */
export function _processIndexedField(
    fieldName: string,
    indexDef: IndexDefinition,
    fieldDef: CollectionField,
    object,
    stemmer: Stemmer,
) {
    switch (fieldDef.type) {
        case 'text':
            const fullTextField =
                indexDef.fullTextIndexName ||
                getTermsIndex(fieldName)
            object[fullTextField] = [...stemmer(object[fieldName])]
            break
        default:
    }
}

/**
 * Handles mutation of a document to be written to storage,
 * depending on needed pre-processing of fields.
 */
export async function _processFieldsForWrites(def: CollectionDefinition, object, stemmer: Stemmer) {
    for (const [fieldName, fieldDef] of Object.entries(def.fields)) {
        if (fieldDef.fieldObject) {
            object[fieldName] = await fieldDef.fieldObject.prepareForStorage(
                object[fieldName],
            )
        }

        if (fieldDef._index != null) {
            _processIndexedField(
                fieldName,
                def.indices[fieldDef._index],
                fieldDef,
                object,
                stemmer
            )
        }
    }
}

/**
 * Handles mutation of a document to be read from storage,
 * depending on needed pre-processing of fields.
 */
export function _processFieldsForReads(def: CollectionDefinition, object) {
    Object.entries(def.fields).forEach(([fieldName, fieldDef]) => {
        if (fieldDef.fieldObject) {
            object[fieldName] = fieldDef.fieldObject.prepareFromStorage(
                object[fieldName],
            )
        }
    })
}

export function _flattenBatch(originalBatch, registry : StorageRegistry) {
    const generatedBatch = []
    let placeholdersGenerated = 0
    for (const step of originalBatch) {
        if (step.operation !== 'createObject') {
            generatedBatch.push(step)
            continue
        }

        const dissection = dissectCreateObjectOperation(step, registry, {
            generatePlaceholder: (() => {
                let isFirst = true
                return () => {
                    if (isFirst) {
                        isFirst = false
                        return step.placeholder
                    } else {
                        return `auto-gen:${++placeholdersGenerated}`
                    }
                }
            })()
        })
        const creationBatch = convertCreateObjectDissectionToBatch(dissection)
        for (const object of creationBatch) {
            generatedBatch.push(object)
        }
    }
    return generatedBatch
}
