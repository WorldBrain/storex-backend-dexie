import { StorageRegistry, OperationBatch } from '@worldbrain/storex'
import {
    dissectCreateObjectOperation,
    convertCreateObjectDissectionToBatch,
} from '@worldbrain/storex/lib/utils'

export function _flattenBatch(
    originalBatch: OperationBatch,
    registry: StorageRegistry,
) {
    const generatedBatch = []
    let placeholdersGenerated = 0
    const generatePlaceholder = () => `auto-gen:${++placeholdersGenerated}`

    for (const step of originalBatch) {
        if (step.operation !== 'createObject') {
            generatedBatch.push(step)
            continue
        }

        const dissection = dissectCreateObjectOperation(step, registry, {
            generatePlaceholder: (() => {
                let isFirst = true
                return () => {
                    if (isFirst) {
                        isFirst = false
                        return step.placeholder || generatePlaceholder()
                    } else {
                        return generatePlaceholder()
                    }
                }
            })(),
        })
        const creationBatch = convertCreateObjectDissectionToBatch(dissection)
        for (const object of creationBatch) {
            generatedBatch.push(object)
        }
    }
    return generatedBatch
}
