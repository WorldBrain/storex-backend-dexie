import Dexie from 'dexie'
import 'dexie-mongoify'

import { StorageRegistry } from 'storex'
// import { CollectionDefinition } from 'storex/types'
import * as backend from 'storex/lib/types/backend'
import { augmentCreateObject } from 'storex/lib/backend/utils'
import { getDexieHistory, getTermsIndex } from './schema'
import { DexieMongoify, DexieSchema } from './types'
import { IndexDefinition, CollectionField, CollectionDefinition } from 'storex/lib/types';
import { StorageBackendFeatureSupport } from 'storex/lib/types/backend-features';
import { UnimplementedError, InvalidOptionsError } from 'storex/lib/types/errors';

export interface IndexedDbImplementation {
    factory : IDBFactory
    range : new () => IDBKeyRange
}

export type Stemmer = (text : string) => Set<string>
export type SchemaPatcher = (schema: DexieSchema[]) => DexieSchema[]

const IdentitySchemaPatcher: SchemaPatcher = f => f

interface Props {
    dbName : string
    stemmer? : Stemmer
    idbImplementation? : IndexedDbImplementation
    /**
     * An optional function to run the generated Dexie schemas through to
     * afford changing them independently of the storex registry. Identity
     * function by default.
     **/
    schemaPatcher? : SchemaPatcher
}

export class DexieStorageBackend extends backend.StorageBackend {
    protected features : StorageBackendFeatureSupport = {
        count: true,
        createWithRelationships: true,
        fullTextSearch: true,
    }

    private dbName : string
    private idbImplementation : IndexedDbImplementation
    private dexie : DexieMongoify
    private stemmer : Stemmer
    private schemaPatcher : SchemaPatcher

    constructor({
        dbName,
        idbImplementation = null,
        stemmer = null,
        schemaPatcher = IdentitySchemaPatcher,
    } : Props) {
        super()

        this.dbName = dbName
        this.idbImplementation = idbImplementation || {factory: window.indexedDB, range: window['IDBKeyRange']}
        this.stemmer = stemmer
        this.schemaPatcher = schemaPatcher
    }

    get dexieInstance() {
        return this.dexie
    }

    configure({registry} : {registry : StorageRegistry}) {
        super.configure({registry})
        registry.once('initialized', this._onRegistryInitialized)

        const origCreateObject = this.createObject.bind(this)
        this.createObject = augmentCreateObject(origCreateObject, { registry })
    }

    supports(feature : string) {
        if (feature !== 'fullTextSearch') {
            return super.supports(feature)
        }

        return !!this.stemmer
    }

    _onRegistryInitialized = () => {
        this._validateRegistry()
        this._initDexie()
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

    async migrate({database} : {database? : string} = {}) {
        if (database) {
            throw new Error('This backend doesn\'t support multiple databases directly')
        }
    }

    async cleanup() : Promise<any> {

    }

    async createObject(collection : string, object, options : backend.CreateSingleOptions & {_transaction?} = {}) : Promise<backend.CreateSingleResult> {
        const collectionDefinition = this.registry.collections[collection]
        await _processFieldsForWrites(collectionDefinition, object, this.stemmer)
        await this.dexie.table(collection).put(object)

        return {object}
    }

    // TODO: Afford full find support for ignoreCase opt; currently just uses the first filter entry
    private _findIgnoreCase<T>(collection: string, query, findOpts : backend.FindManyOptions = {}) {
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


    async findObjects<T>(collection : string, query, findOpts : backend.FindManyOptions = {}) : Promise<Array<T>> {
        let coll = findOpts.ignoreCase && findOpts.ignoreCase.length
            ? this._findIgnoreCase<T>(collection, query, findOpts)
            : this.dexie.collection<T>(collection).find(query)

        if (findOpts.reverse) {
            coll = coll.reverse()
        }

        if (findOpts.skip && findOpts.skip > 0) {
            coll = coll.offset(findOpts.skip)
        }

        if (findOpts.limit) {
            coll = coll.limit(findOpts.limit)
        }

        return await coll.toArray()
    }

    async updateObjects(collection : string, query, updates, options : backend.UpdateManyOptions & {_transaction?} = {}) : Promise<backend.UpdateManyResult> {
        const { modifiedCount } = await this.dexie
            .collection(collection)
            .update(query, updates)

        // return modifiedCount
    }

    async deleteObjects(collection : string, query, options : backend.DeleteManyOptions = {}) : Promise<backend.DeleteManyResult> {
        const { deletedCount } = await this.dexie
            .collection(collection)
            .remove(query)

        // return deletedCount
    }

    async countObjects(collection : string, query) {
        return this.dexie.collection(collection).count(query)
    }
}

/**
 * Handles mutation of a document to be inserted/updated to storage,
 * depending on needed pre-processing for a given indexed field.
 */
export async function _processIndexedField(
    fieldName: string,
    indexDef: IndexDefinition,
    fieldDef: CollectionField,
    object,
    stemmer : Stemmer,
) {
    switch (fieldDef.type) {
        case 'text':
            const fullTextField =
                indexDef.fullTextIndexName ||
                getTermsIndex(fieldName)
            object[fullTextField] = [...await stemmer(object[fieldName])]
            break
        default:
    }
}

/**
 * Handles mutation of a document to be written to storage,
 * depending on needed pre-processing of fields.
 */
export async function _processFieldsForWrites(def: CollectionDefinition, object, stemmer : Stemmer) {
    for (const [fieldName, fieldDef] of Object.entries(def.fields)) {
        if (fieldDef.fieldObject) {
            object[fieldName] = await fieldDef.fieldObject.prepareForStorage(
                object[fieldName],
            )
        }

        if (fieldDef._index != null) {
            await _processIndexedField(
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
