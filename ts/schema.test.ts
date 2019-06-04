/* eslint-env jest */
const expect = require('expect')
import StorageRegisty from '@worldbrain/storex/lib/registry'
import { getDexieHistory } from './schema'
import { FieldTypeRegistry } from '@worldbrain/storex/lib/fields'

describe('Dexie schema generation', () => {
    it('it should work', () => {
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

        const dexieSchemas = getDexieHistory(storageRegisty)

        expect(dexieSchemas[0]).toEqual({
            version: 1,
            schema: {
                eggs: 'slug',
                spam: 'slug',
            },
            // migrations: [],
        })

        expect(dexieSchemas[1]).toEqual({
            version: 2,
            schema: {
                eggs: 'slug, *_field2_terms',
                spam: 'slug',
            },
            // migrations: [migrateEggs],
        })

        expect(dexieSchemas[2]).toEqual({
            version: 3,
            schema: {
                eggs: 'slug, *_field2_terms',
                foo: 'slug',
                spam: 'slug',
            },
            // migrations: [],
        })

        expect(dexieSchemas[3]).toEqual({
            version: 4,
            schema: {
                eggs: 'slug, *_field2_terms',
                foo: 'slug',
                spam: 'slug',
                ham: '[nameLast+nameFirst], nameLast',
            },
            // migrations: [],
        })

        expect(dexieSchemas[4]).toEqual({
            version: 5,
            schema: {
                eggs: 'slug, *_field2_terms',
                foo: 'slug',
                spam: 'slug',
                ham: '[nameLast+nameFirst], nameLast',
                people: '++id, &ssn',
            },
            // migrations: [],
        })

        expect(dexieSchemas[5]).toEqual({
            version: 6,
            schema: {
                eggs: 'slug, *_field2_terms',
                foo: 'slug',
                spam: 'slug',
                ham: '[nameLast+nameFirst], nameLast',
                people: '++id, &ssn',
                dogs: 'id, *biographyTerms',
            },
            // migrations: [],
        })
    })
})
