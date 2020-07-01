import { getTermsIndex } from './schema'
import {
    ObjectCleaner,
    ObjectCleanerOptions,
    ObjectCleanerPurpose,
} from './types'
import {
    isChildOfRelationship,
    isConnectsRelationship,
} from '@worldbrain/storex'

export function makeCleanerChain(cleaners: ObjectCleaner[]): ObjectCleaner {
    return async (object: any, options: ObjectCleanerOptions) => {
        for (const cleaner of cleaners) {
            object = (await cleaner(object, options)) || object
        }
        return object
    }
}

/**
 * Handles mutation of a document to be inserted/updated to storage,
 * depending on needed pre-processing for a given indexed field.
 */
export const _cleanFullTextIndexFieldsForWrite = ({
    purpose,
}: {
    purpose: ObjectCleanerPurpose
}): ObjectCleaner => async (object: any, options: ObjectCleanerOptions) => {
    for (const [fieldName, fieldDef] of Object.entries(
        options.collectionDefinition.fields,
    )) {
        switch (fieldDef.type) {
            case 'text':
                if (fieldDef._index == null) {
                    continue
                }

                const fieldValue = object[fieldName]
                if (!fieldValue) {
                    continue
                }

                if (!options.stemmerSelector) {
                    throw new Error(
                        `You tried to write to an indexed text field (${fieldName}) without specifying a stemmer selector`,
                    )
                }

                const stemmer = options.stemmerSelector({
                    collectionName: options.collectionDefinition.name!,
                    fieldName,
                })
                if (!stemmer) {
                    throw new Error(
                        `You tried to write to an indexed text field (${fieldName}) without specifying a stemmer for that field`,
                    )
                }

                const indexDef = options.collectionDefinition.indices![
                    fieldDef._index
                ]
                const fullTextField =
                    indexDef.fullTextIndexName || getTermsIndex(fieldName)

                // If we're doing an update that also touches the associated full-text field,
                //  don't overwrite the update's value by re-deriving the `text` field
                if (
                    purpose === 'update' &&
                    Object.keys(object).includes(fullTextField)
                ) {
                    return
                }

                object[fullTextField] = [...stemmer(fieldValue)]
                break
            default:
        }
    }
}

export function _makeCustomFieldCleaner(options: {
    purpose: ObjectCleanerPurpose
}): ObjectCleaner {
    const purpose = options.purpose
    const direction = purpose === 'read' ? 'from-storage' : 'to-storage'
    const method =
        direction === 'from-storage'
            ? 'prepareFromStorage'
            : 'prepareForStorage'
    return async (object: any, options: ObjectCleanerOptions) => {
        for (const [fieldName, fieldDef] of Object.entries(
            options.collectionDefinition.fields,
        )) {
            if (fieldDef.fieldObject) {
                const oldValue = object[fieldName]
                if (
                    purpose !== 'create' &&
                    !Object.keys(object).includes(fieldName)
                ) {
                    continue
                }

                const newValue = await fieldDef.fieldObject[method](oldValue)
                object[fieldName] = newValue
            }
        }
    }
}

export const _cleanFieldAliasesForWrites: ObjectCleaner = async (
    object: any,
    options: ObjectCleanerOptions,
) => {
    for (const relationship of options.collectionDefinition.relationships ||
        []) {
        if (isChildOfRelationship(relationship)) {
            if (
                relationship.alias !== relationship.fieldName &&
                typeof object[relationship.alias!] !== 'undefined'
            ) {
                object[relationship.fieldName!] = object[relationship.alias!]
                delete object[relationship.alias!]
            }
        } else if (isConnectsRelationship(relationship)) {
            if (
                relationship.aliases![0] !== relationship.fieldNames![0] &&
                typeof object[relationship.aliases![0]] !== 'undefined'
            ) {
            }
            if (
                relationship.aliases![1] !== relationship.fieldNames![1] &&
                typeof object[relationship.aliases![1]] !== 'undefined'
            ) {
            }
        }
    }
}

export const _cleanFieldAliasesForReads: ObjectCleaner = async (
    object: any,
    options: ObjectCleanerOptions,
) => {
    for (const relationship of options.collectionDefinition.relationships ||
        []) {
        if (isChildOfRelationship(relationship)) {
            if (relationship.alias !== relationship.fieldName) {
                object[relationship.alias!] = object[relationship.fieldName!]
                delete object[relationship.fieldName!]
            }
        } else if (isConnectsRelationship(relationship)) {
            if (
                relationship.aliases![0] !== relationship.fieldNames![0] &&
                typeof object[relationship.aliases![0]] !== 'undefined'
            ) {
            }
            if (
                relationship.aliases![1] !== relationship.fieldNames![1] &&
                typeof object[relationship.aliases![1]] !== 'undefined'
            ) {
            }
        }
    }
}

export const _cleanTimestampFieldsForWrites: ObjectCleaner = async (
    object,
    options,
) => {
    for (const [fieldName, fieldDef] of Object.entries(
        options.collectionDefinition.fields,
    )) {
        if (fieldDef.type === 'timestamp') {
            if (object[fieldName] === '$now') {
                object[fieldName] = Date.now()
            }
        }
    }
}
