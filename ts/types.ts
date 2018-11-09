import { Dexie } from 'dexie'
// import { FilterQuery as MongoFilterQuery } from 'mongodb' // tslint:disable-line

export interface DexieMongoify extends Dexie {
    collection: <T>(
        name: string,
    ) => {
        find(query): Dexie.Collection<T, any>
        count(query): Promise<number>
        update(
            query,
            update,
        ): Promise<{ modifiedCount: number }>
        remove(query): Promise<{ deletedCount: number }>
    }
}

export interface DexieSchema {
    version: number
    // migrations: MigrationRunner[]
    schema: {
        [collName: string]: string
    }
}

export type UpdateOpApplier<V=any> = (object, key: string, value: V) => void

export interface UpdateOps { 
    $inc: UpdateOpApplier<number>
    $mul: UpdateOpApplier<number>
    $rename: UpdateOpApplier
    $set: UpdateOpApplier
    $unset: UpdateOpApplier
    $min: UpdateOpApplier
    $max: UpdateOpApplier
    $addToSet: UpdateOpApplier
    $pop: UpdateOpApplier
    $push: UpdateOpApplier
    $pull: UpdateOpApplier
    $pullAll: UpdateOpApplier
    $slice: UpdateOpApplier
    $sort: UpdateOpApplier
}
