import * as expect from 'expect'
import { testStorageBackend, testStorageBackendFullTextSearch } from "@worldbrain/storex/lib/index.tests"
import extractTerms from "@worldbrain/memex-stemmer";
import { DexieStorageBackend, _flattenBatch } from "."
import inMemory from './in-memory'
import StorageManager from "@worldbrain/storex";

describe('Dexie StorageBackend integration tests', () => {
    testStorageBackend(async () => {
        return new DexieStorageBackend({dbName: 'unittest', idbImplementation: inMemory()})
    })
})

describe('Dexie StorageBackend full-text search with Memex stemmer tests', () => {
    testStorageBackendFullTextSearch(async () => {
        return new DexieStorageBackend({dbName: 'unittest', idbImplementation: inMemory(), stemmer: extractTerms})
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

    it('should correctly do batch operations containing only creates', async () => {
        const { storageManager } = await setupTest()
        const { info } = await storageManager.operation('executeBatch', [
            {
                placeholder: 'jane',
                operation: 'createObject',
                collection: 'user',
                args: {
                    displayName: 'Jane'
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
            {
                placeholder: 'joeEmail',
                operation: 'createObject',
                collection: 'email',
                args: {
                    address: 'joe@doe.com'
                },
                replace: [{
                    path: 'user',
                    placeholder: 'joe',
                }]
            },
        ])


        expect(info).toEqual({
            jane: {
                object: expect.objectContaining({
                    id: expect.anything(),
                    displayName: 'Jane',
                })
            },
            joe: {
                object: expect.objectContaining({
                    id: expect.anything(),
                    displayName: 'Joe',
                })
            },
            joeEmail: {
                object: expect.objectContaining({
                    id: expect.anything(),
                    user: expect.anything(),
                    address: 'joe@doe.com'
                })
            }
        })
        expect(info['joeEmail']['object']['user']).toEqual(info['joe']['object']['id'])
    })

    it('should support batch operations with complex createObject operations', async () => {
        const { storageManager } = await setupTest()
        const { info } = await storageManager.operation('executeBatch', [
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
        ])
        expect(info).toEqual({
            jane: {
                object: {
                    id: expect.anything(),
                    displayName: 'Jane',
                    emails: [{
                        id: expect.anything(),
                        address: 'jane@doe.com'
                    }]
                }
            },
            joe: {
                object: {
                    id: expect.anything(),
                    displayName: 'Joe',
                }
            },
        })
    })

    it('should support batch operations with compound primary keys')

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
