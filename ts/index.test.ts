import * as expect from 'expect'
import { testStorageBackend, testStorageBackendFullTextSearch } from "@worldbrain/storex/lib/index.tests"
import extractTerms from "@worldbrain/memex-stemmer";
import { DexieStorageBackend } from "."
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
    it('should correctly do batch operations containing only creates', async () => {
        const backend = new DexieStorageBackend({dbName: 'unittest', idbImplementation: inMemory()})
        const storageManager = new StorageManager({backend})
        storageManager.registry.registerCollections({
            user: {
                version: new Date(2019, 1, 1),
                fields: {
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
        const { info } = await storageManager.operation('executeBatch', [
            {
                placeholder: 'jane',
                operation: 'createObject',
                collection: 'user',
                args: {
                    displayName: 'Joe'
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
                    displayName: 'Joe',
                })
            },
            joe: {
                object: expect.objectContaining({
                    displayName: 'Joe',
                })
            },
            joeEmail: {
                object: expect.objectContaining({
                    address: 'joe@doe.com'
                })
            }
        })
        expect(info['joe']['object']['id']).toEqual(expect.anything())
        expect(info['joeEmail']['object']['user']).toEqual(expect.anything())
        expect(info['joeEmail']['object']['user']).toEqual(info['joe']['object']['id'])
    })

    it('should support batch operations with complex createObject operations')
    it('should support batch operations with compound primary keys')
})
