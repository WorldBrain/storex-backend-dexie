/* eslint-env jest */
const expect = require('expect')
import StorageRegisty from '@worldbrain/storex/lib/registry'
import { getDexieHistory } from './schema'
import { FieldTypeRegistry } from '@worldbrain/storex/lib/fields'

describe('Dexie schema generation', () => {
    it('it should work', async () => {
        const storageRegisty = new StorageRegisty({
            fieldTypes: new FieldTypeRegistry(),
        })
        storageRegisty.registerCollection('spam', {
            version: new Date(2018, 5, 20),
            fields: {
                slug: { type: 'string' },
                field1: { type: 'string' },
            },
            indices: [{ field: 'slug', pk: true }],
        })

        const migrateEggs = () => Promise.resolve()
        storageRegisty.registerCollection('eggs', [
            {
                version: new Date(2018, 5, 20),
                fields: {
                    slug: { type: 'string' },
                    field1: { type: 'string' },
                },
                indices: [{ field: 'slug', pk: true }],
            },
            {
                version: new Date(2018, 5, 25),
                fields: {
                    slug: { type: 'string' },
                    field1: { type: 'string' },
                    field2: { type: 'text' },
                },
                indices: [{ field: 'slug', pk: true }, { field: 'field2' }],
                migrate: migrateEggs,
            },
        ])

        storageRegisty.registerCollection('foo', {
            version: new Date(2018, 5, 28),
            fields: {
                slug: { type: 'string' },
                field1: { type: 'string' },
            },
            indices: [{ field: 'slug', pk: true }],
        })

        storageRegisty.registerCollection('ham', {
            version: new Date(2018, 6, 20),
            fields: {
                nameFirst: { type: 'string' },
                nameLast: { type: 'string' },
            },
            indices: [
                { field: ['nameLast', 'nameFirst'], pk: true },
                { field: 'nameLast' },
            ],
        })

        storageRegisty.registerCollection('people', {
            version: new Date(2018, 6, 23),
            fields: {
                id: { type: 'string' },
                name: { type: 'string' },
                ssn: { type: 'string' },
            },
            indices: [
                { field: 'id', pk: true, autoInc: true },
                { field: 'ssn', unique: true },
            ],
        })

        storageRegisty.registerCollection('dogs', {
            version: new Date(2018, 6, 26),
            fields: {
                id: { type: 'string' },
                biography: { type: 'text' },
            },
            indices: [
                { field: 'biography', fullTextIndexName: 'biographyTerms' },
                { field: 'id', pk: true },
            ],
        })

        await storageRegisty.finishInitialization()
        const dexieSchemas = getDexieHistory(storageRegisty)

        expect(dexieSchemas).toEqual([
            {
                dexieSchemaVersion: 1,
                storexSchemaVersion: new Date(2018, 5, 20),
                schema: {
                    eggs: 'slug',
                    spam: 'slug',
                },
                // migrations: [],
            },
            {
                dexieSchemaVersion: 2,
                storexSchemaVersion: new Date(2018, 5, 25),
                schema: {
                    eggs: 'slug, *_field2_terms',
                    spam: 'slug',
                },
                // migrations: [migrateEggs],
            },
            {
                dexieSchemaVersion: 3,
                storexSchemaVersion: new Date(2018, 5, 28),
                schema: {
                    eggs: 'slug, *_field2_terms',
                    foo: 'slug',
                    spam: 'slug',
                },
                // migrations: [],
            },
            {
                dexieSchemaVersion: 4,
                storexSchemaVersion: new Date(2018, 6, 20),
                schema: {
                    eggs: 'slug, *_field2_terms',
                    foo: 'slug',
                    spam: 'slug',
                    ham: '[nameLast+nameFirst], nameLast',
                },
                // migrations: [],
            },
            {
                dexieSchemaVersion: 5,
                storexSchemaVersion: new Date(2018, 6, 23),
                schema: {
                    eggs: 'slug, *_field2_terms',
                    foo: 'slug',
                    spam: 'slug',
                    ham: '[nameLast+nameFirst], nameLast',
                    people: '++id, &ssn',
                },
                // migrations: [],
            },
            {
                dexieSchemaVersion: 6,
                storexSchemaVersion: new Date(2018, 6, 26),
                schema: {
                    eggs: 'slug, *_field2_terms',
                    foo: 'slug',
                    spam: 'slug',
                    ham: '[nameLast+nameFirst], nameLast',
                    people: '++id, &ssn',
                    dogs: 'id, *biographyTerms',
                },
                // migrations: [],
            }
        ])
    })

    it('should correctly index (single)ChildOf relationship fields', async () => {
        const storageRegisty = new StorageRegisty({})
        storageRegisty.registerCollections({
            user: {
                version: new Date(1),
                fields: {
                    displayName: { type: 'string' }
                }
            },
            profile: {
                version: new Date(1),
                fields: {
                    food: { type: 'string' }
                },
                relationships: [
                    { alias: 'theUser', singleChildOf: 'user', fieldName: 'user_id' }
                ],
                indices: [
                    { field: { relationship: 'theUser' } }
                ]
            },
            email: {
                version: new Date(1),
                fields: {
                    address: { type: 'string' }
                },
                relationships: [
                    { alias: 'theUser', childOf: 'user', fieldName: 'user_id' }
                ],
                indices: [
                    { field: { relationship: 'theUser' } }
                ]
            }
        })
        await storageRegisty.finishInitialization()

        await storageRegisty.finishInitialization()
        const dexieSchemas = getDexieHistory(storageRegisty)

        expect(dexieSchemas).toEqual([{
            dexieSchemaVersion: 1,
            storexSchemaVersion: new Date(1),
            schema: {
                user: '++id',
                profile: '++id, user_id',
                email: '++id, user_id'
            },
        }])
    })

    it('should correctly index compound indices involving (single)ChildOf relationship fields', async () => {
        const storageRegisty = new StorageRegisty({})
        storageRegisty.registerCollections({
            user: {
                version: new Date(1),
                fields: {
                    displayName: { type: 'string' }
                }
            },
            profile: {
                version: new Date(1),
                fields: {
                    food: { type: 'string' }
                },
                relationships: [
                    { alias: 'theUser', singleChildOf: 'user', fieldName: 'user_id' }
                ],
                indices: [
                    { field: [{ relationship: 'theUser' }, 'food'] }
                ]
            },
            email: {
                version: new Date(1),
                fields: {
                    address: { type: 'string' }
                },
                relationships: [
                    { alias: 'theUser', childOf: 'user', fieldName: 'user_id' }
                ],
                indices: [
                    { field: [{ relationship: 'theUser' }, 'address'] }
                ]
            }
        })
        await storageRegisty.finishInitialization()

        await storageRegisty.finishInitialization()
        const dexieSchemas = getDexieHistory(storageRegisty)

        expect(dexieSchemas).toEqual([{
            dexieSchemaVersion: 1,
            storexSchemaVersion: new Date(1),
            schema: {
                user: '++id',
                profile: '++id, [user_id+food]',
                email: '++id, [user_id+address]'
            },
        }])
    })
})
