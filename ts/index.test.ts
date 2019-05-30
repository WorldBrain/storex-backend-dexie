import * as expect from 'expect'
import { testStorageBackend, testStorageBackendFullTextSearch } from "@worldbrain/storex/lib/index.tests"
import extractTerms from "@worldbrain/memex-stemmer";
import { DexieStorageBackend } from "."
import inMemory from './in-memory'
import StorageManager from "@worldbrain/storex";
import { _flattenBatch } from './utils';

describe('Dexie StorageBackend integration tests', () => {
    testStorageBackend(async () => {
        return new DexieStorageBackend({dbName: 'unittest', idbImplementation: inMemory()})
    })
})

describe('Dexie StorageBackend full-text search with Memex stemmer tests', () => {
    testStorageBackendFullTextSearch(async () => {
        return new DexieStorageBackend({dbName: 'unittest', idbImplementation: inMemory(), stemmerSelector: () => extractTerms})
    })
})

describe('Dexie StorageBackend batch operations', () => {
    async function setupTest({userFields = null} = {}) {
        const backend = new DexieStorageBackend({dbName: 'unittest', idbImplementation: inMemory()})
        const storageManager = new StorageManager({backend})
        storageManager.registry.registerCollections({
            user: {
                version: new Date(2019, 1, 1),
                fields: userFields || {
                    displayName: {type: 'string'}
                }
            },
            email: {
                version: new Date(2019, 1, 1),
                fields: {
                    displayName: {type: 'string'}
                },
                relationships: [
                    {childOf: 'user'}
                ]
            }
        })
        await storageManager.finishInitialization()
        return { storageManager }
    }

    it('should support batches with updateObject operations', async () => {
        const { storageManager } = await setupTest()
        const { object: object1 } = await storageManager.collection('user').createObject({displayName: 'Jack'})
        const { object: object2 } = await storageManager.collection('user').createObject({displayName: 'Jane'})
        await storageManager.operation('executeBatch', [
            { operation: 'updateObjects', collection: 'user', where: {id: object1.id}, updates: {displayName: 'Jack 2'} },
            { operation: 'updateObjects', collection: 'user', where: {id: object2.id}, updates: {displayName: 'Jane 2'} },
        ])
        expect([
            await storageManager.collection('user').findOneObject({id: object1.id}),
            await storageManager.collection('user').findOneObject({id: object2.id}),
        ]).toEqual([
            {id: object1.id, displayName: 'Jack 2'},
            {id: object2.id, displayName: 'Jane 2'},
        ])
    })

    describe('flattenBatch()', () => {
        it('should flatten batches with complex creates', async () => {
            const { storageManager } = await setupTest()
            expect(_flattenBatch([
                {
                    placeholder: 'jane',
                    operation: 'createObject',
                    collection: 'user',
                    args: {
                        displayName: 'Jane',
                        emails: [{
                            address: 'jane@doe.com'
                        }]
                    }
                },
                {
                    placeholder: 'joe',
                    operation: 'createObject',
                    collection: 'user',
                    args: {
                        displayName: 'Joe'
                    }
                },
            ], storageManager.registry)).toEqual([
                {
                    placeholder: 'jane',
                    operation: 'createObject',
                    collection: 'user',
                    args: {
                        displayName: 'Jane',
                    },
                    replace: []
                },
                {
                    placeholder: 'auto-gen:1',
                    operation: 'createObject',
                    collection: 'email',
                    args: {
                        address: 'jane@doe.com'
                    },
                    replace: [{
                        path: 'user',
                        placeholder: 'jane',
                    }]
                },
                {
                    placeholder: 'joe',
                    operation: 'createObject',
                    collection: 'user',
                    args: {
                        displayName: 'Joe'
                    },
                    replace: []
                },
            ])
        })
    })    
})
