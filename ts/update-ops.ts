import { UpdateOps } from './types'

/**
 * Handles mutation of a document, updating each field in the way specified
 * in the `updates` object.
 * See for more info: https://github.com/YurySolovyov/dexie-mongoify/blob/master/docs/update-api.md
 *
 * TODO: Proper runtime error handling for badly formed update objs.
 */
export function _processFieldUpdates(updates: any, object: any) {
    // TODO: Find a home for this
    // TODO: Support all update ops
    const updateOpAppliers: UpdateOps = {
        $inc: (obj, key, value) => (obj[key] += value),
        $set: (obj, key, value) => (obj[key] = value),
        $mul: (obj, key, value) => (obj[key] *= value),
        $unset: (obj, key) => (obj[key] = undefined),
        $rename: () => undefined,
        $min: () => undefined,
        $max: () => undefined,
        $addToSet: () => undefined,
        $pop: () => undefined,
        $push: () => undefined,
        $pull: () => undefined,
        $pullAll: () => undefined,
        $slice: () => undefined,
        $sort: () => undefined,
    }

    for (const [updateKey, updateVal] of Object.entries(updates)) {
        // If supported update op, run assoc. update op applier
        if (updateOpAppliers[updateKey] != null) {
            Object.entries(updateVal as any).forEach(([key, val]: [any, any]) =>
                updateOpAppliers[updateKey](object, key, val),
            )
        } else {
            object[updateKey] = updateVal
        }
    }
}
