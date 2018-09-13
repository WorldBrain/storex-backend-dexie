import StorageRegistry, { RegistryCollections } from 'storex/ts/registry'
import { DexieSchema } from './types'
import { CollectionDefinition, isRelationshipReference, isChildOfRelationship, isConnectsRelationship, RelationshipReference } from 'storex/ts/types'

export const getTermsIndex = (fieldName: string) => `_${fieldName}_terms`

export function getDexieHistory(storageRegistry: StorageRegistry) {
    const collections = {}
    const versions: DexieSchema[] = []
    let version = 0

    Object.entries(storageRegistry.collectionsByVersion)
        .sort((left, right) => (left[0] < right[0] ? -1 : 1))
        .forEach(([versionTimestamp, defs]) => {
            defs.forEach(def => (collections[def.name] = def))
            versions.push({
                ...getDexieSchema(collections),
                version: ++version,
            })
        })

    return patchDirectLinksSchema(versions)
}

function getDexieSchema(collections: RegistryCollections) {
    const schema = {}
    // const migrations: MigrationRunner[] = []

    Object.entries(collections).forEach(([collectionName, collectionDef]) => {
        schema[collectionName] = convertIndexToDexieExps(collectionDef)
    })

    return {
        schema,
        // migrations
    }
}

/**
 * Handles converting from StorageManager index definitions to Dexie index expressions.
 */
function convertIndexToDexieExps({ name: collection, fields, indices, relationshipsByAlias }: CollectionDefinition) {
    return indices
        .sort(({ pk }) => (pk ? -1 : 1)) // PK indexes always come first in Dexie
        .map((indexDef) => {
            const fieldNameFromRelationshipReference = (reference : RelationshipReference) : string | string[] => {
                const relationship = relationshipsByAlias[reference.relationship]
                if (!relationship) {
                    throw new Error(
                        `You tried to create an index in collection
                        '${collection}' on non-existing relationship '${reference.relationship}'`
                    )
                }

                if (isChildOfRelationship(relationship)) {
                    return relationship.fieldName
                } else if (isConnectsRelationship(relationship)) {
                    return relationship.fieldNames
                } else {
                    throw new Error(`Unsupported relationship index in collection '${name}'`)
                }
            }

            // Convert from StorageManager compound index to Dexie compound index
            // Note that all other `IndexDefinition` opts are ignored for compound indexes
            let source = indexDef.field
            if (!(source instanceof Array) && isRelationshipReference(source)) {
                source = fieldNameFromRelationshipReference(source)
            }

            if (source instanceof Array) {
                const fieldNames = []
                for (const field of source) {
                    if (isRelationshipReference(field)) {
                        const fieldName = fieldNameFromRelationshipReference(field)
                        if (fieldName instanceof Array) {
                            throw new Error(`Cannot create a compound index involving a 'connects' relationship`)
                        }
                        fieldNames.push(fieldName)
                    } else {
                        fieldNames.push(field)
                    }
                }
                return `[${fieldNames.join('+')}]`
            }

            // Create Dexie MultiEntry index for indexed text fields: http://dexie.org/docs/MultiEntry-Index
            // TODO: throw error if text field + PK index
            if (!isRelationshipReference(source) && fields[source].type === 'text') {
                const fullTextField =
                    indexDef.fullTextIndexName ||
                    getTermsIndex(indexDef.field as string)
                return `*${fullTextField}`
            }

            // Note that order of these statements matters
            let listPrefix = indexDef.unique ? '&' : ''
            listPrefix = indexDef.pk && (indexDef.autoInc || fields[indexDef.field as string].type === 'auto-pk') ? '++' : listPrefix

            return `${listPrefix}${indexDef.field}`
        })
        .join(', ')
}

/**
 * Takes the generated schema versions, based on the registed collections, and finds the
 * first one in which `directLinks` schema was added, then generates a "patch" schema.
 * This "patch" schema should contain the incorrect indexes that was accidently rolled out
 * to users at the release of our Direct Links feature. This should ensure Dexie knows about
 * both the incorrect indexes and how to drop those to migrate to the correct indexes.
 */
function patchDirectLinksSchema(schemaVersions: DexieSchema[]): DexieSchema[] {
    const firstAppears = schemaVersions.findIndex(
        ({ schema }) => schema.directLinks != null,
    )

    // Return schemas as-is if direct links schema not found (tests)
    if (firstAppears === -1) {
        return schemaVersions
    }

    const preceding = schemaVersions[firstAppears - 1]

    const patchedSchema = {
        schema: {
            ...preceding.schema,
            directLinks: 'url, *pageTitle, *body, createdWhen',
        },
        migrations: [],
        version: preceding.version + 1,
    }

    return [
        ...schemaVersions.slice(0, firstAppears),
        // Shim the schema with the incorrect indexes, so Dexie knows about its existence
        patchedSchema,
        // All subsequent schemas need to be 1 version higher to take the incorrect index schema into account
        ...schemaVersions
            .slice(firstAppears)
            .map(schema => ({ ...schema, version: schema.version + 1 })),
    ]
}
