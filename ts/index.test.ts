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
    describe('with single stemmer', () => {
        testStorageBackendFullTextSearch(async () => {
            return new DexieStorageBackend({dbName: 'unittest', idbImplementation: inMemory(), stemmer: extractTerms})
        })
    })

    describe('with stemmer selector', () => {
        testStorageBackendFullTextSearch(async () => {
            return new DexieStorageBackend({dbName: 'unittest', idbImplementation: inMemory(), stemmerSelector: () => extractTerms})
        })
    })
})

describe('Dexie StorageBackend specific operations', () => {
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
