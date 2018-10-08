import { testStorageBackend, testStorageBackendFullTextSearch } from "storex/lib/index.tests"
import { DexieStorageBackend } from "."
import inMemory from './in-memory'
import extractTerms from "memex-stemmer";

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
