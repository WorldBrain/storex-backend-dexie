import * as expect from 'expect'

import { _cleanFullTextIndexFieldsForWrite } from './object-cleaning'
import { getTermsIndex } from './schema'
import { StemmerSelector, Stemmer, ObjectCleanerOptions } from './types'

const simpleStemmer: Stemmer = text => new Set(text.split(' '))
const stemmerSelector: StemmerSelector = () => simpleStemmer
const expectedTerms = ['this', 'is', 'some', 'test', 'text']

function setupTest() {
    const options: ObjectCleanerOptions = {
        stemmerSelector,
        collectionDefinition: {
            version: new Date(),
            fields: {
                text: { type: 'text' },
            },
        },
    }

    const object: any = { text: 'this is some test text' }
    const fullTextField = getTermsIndex('text')

    return { options, object, fullTextField }
}

describe('Object cleaning/pre-processing', () => {
    it('should derive full-text fields for text fields on creation', () => {
        const { options, object, fullTextField } = setupTest()

        expect(object[fullTextField]).toBeUndefined()
        _cleanFullTextIndexFieldsForWrite({ purpose: 'create' })(
            object,
            options,
        )
        expect(object[fullTextField]).not.toBeUndefined()
        expect(object[fullTextField]).toEqual(expectedTerms)
    })

    it('should derive full-text fields for text fields on update', () => {
        const { options, object, fullTextField } = setupTest()

        expect(object[fullTextField]).toBeUndefined()
        _cleanFullTextIndexFieldsForWrite({ purpose: 'update' })(
            object,
            options,
        )
        expect(object[fullTextField]).not.toBeUndefined()
        expect(object[fullTextField]).toEqual(expectedTerms)
    })

    it('should _not_ derive full-text fields for text fields on updates including that field', () => {
        const { options, object, fullTextField } = setupTest()

        // Extend test object with data in the full-text field
        const extendedObject = { ...object, [fullTextField]: ['some', 'text'] }

        _cleanFullTextIndexFieldsForWrite({ purpose: 'update' })(
            extendedObject,
            options,
        )
        expect(extendedObject.text).toEqual(object.text)
        expect(extendedObject[fullTextField]).not.toEqual(expectedTerms)
        expect(extendedObject[fullTextField]).toEqual(['some', 'text'])
    })
})
