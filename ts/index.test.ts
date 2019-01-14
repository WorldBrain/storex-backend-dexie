import { testStorageBackend, testStorageBackendFullTextSearch } from "@worldbrain/storex/lib/index.tests"
import extractTerms from "@worldbrain/memex-stemmer";
import { DexieStorageBackend } from "."
import inMemory from './in-memory'

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
