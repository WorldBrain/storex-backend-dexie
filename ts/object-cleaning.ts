import { getTermsIndex } from "./schema";
import { ObjectCleaner, ObjectCleanerOptions } from "./types";

export function makeCleanerChain(cleaners : ObjectCleaner[]) : ObjectCleaner {
    return async (object : any, options : ObjectCleanerOptions) => {
        for (const cleaner of cleaners) {
            object = await cleaner(object, options) || object
        }
        return object
    }
}

/**
 * Handles mutation of a document to be inserted/updated to storage,
 * depending on needed pre-processing for a given indexed field.
 */
export async function _cleanFullTextIndexFieldsForWrite(object : any, options : ObjectCleanerOptions) {
    for (const [fieldName, fieldDef] of Object.entries(options.collectionDefinition.fields)) {
        switch (fieldDef.type) {
            case 'text':
                if (fieldDef._index == null) {
                    continue
                }
                
                if (!options.stemmerSelector) {
                    throw new Error(`You tried to write to an indexed text field (${fieldName}) without specifying a stemmer selector`)
                }

                const stemmer = options.stemmerSelector({ collectionName: options.collectionDefinition.name!, fieldName })
                if (!stemmer) {
                    throw new Error(`You tried to write to an indexed text field (${fieldName}) without specifying a stemmer for that field`)
                }

                const indexDef = options.collectionDefinition.indices![fieldDef._index]
                const fullTextField =
                    indexDef.fullTextIndexName ||
                    getTermsIndex(fieldName)
                object[fullTextField] = [...stemmer(object[fieldName])]
                break
            default:
        }
    }
}

export async function _cleanFieldsForWrite(object : any, options : ObjectCleanerOptions) {
    await _cleanCustomFieldsForWrites(object, options)
    await _cleanFullTextIndexFieldsForWrite(object, options)
}

export async function _cleanCustomFieldsForWrites(object : any, options : ObjectCleanerOptions) {
    for (const [fieldName, fieldDef] of Object.entries(options.collectionDefinition.fields)) {
        if (fieldDef.fieldObject) {
            object[fieldName] = await fieldDef.fieldObject.prepareForStorage(
                object[fieldName],
            )
        }
    }
}

export async function _cleanCustomFieldsForReads(object : any, options : ObjectCleanerOptions) {
    for (const [fieldName, fieldDef] of Object.entries(options.collectionDefinition.fields)) {
        if (fieldDef.fieldObject) {
            object[fieldName] = fieldDef.fieldObject.prepareFromStorage(
                object[fieldName],
            )
        }
    }
}
