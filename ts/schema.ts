import StorageRegistry, { RegistryCollections } from '@worldbrain/storex/lib/registry'
import { DexieSchema } from './types'
import { CollectionDefinition, isRelationshipReference, isChildOfRelationship, isConnectsRelationship, RelationshipReference } from '@worldbrain/storex/lib/types'

export const getTermsIndex = (fieldName: string) => `_${fieldName}_terms`

export function getDexieHistory(storageRegistry: StorageRegistry) {
    const collections = {}
    const versions: DexieSchema[] = []
    let version = 0

    Object.entries(storageRegistry.collectionsByVersion)
        .sort((left, right) => (left[0] < right[0] ? -1 : 1))
        .forEach(([, defs]) => {
            defs.forEach(def => (collections[def.name] = def))
            versions.push({
                ...getDexieSchema(collections),
                version: ++version,
            })
        })

    return versions
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
