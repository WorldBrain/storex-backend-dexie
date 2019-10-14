import { Dexie } from 'dexie'
import { CollectionDefinition } from '@worldbrain/storex'
// import { FilterQuery as MongoFilterQuery } from 'mongodb' // tslint:disable-line

export interface DexieMongoify extends Dexie {
    collection: <T>(
        name: string,
    ) => {
        find(query: any): Dexie.Collection<T, any>
        count(query: any): Promise<number>
        update(query: any, update: any): Promise<{ modifiedCount: number }>
        remove(query: any): Promise<{ deletedCount: number }>
    }
}

export interface DexieSchema {
    version: number
    // migrations: MigrationRunner[]
    schema: {
        [collName: string]: string
    }
}

export type UpdateOpApplier<V = any> = (
    object: any,
    key: string,
    value: V,
) => void

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

export type ObjectCleanerPurpose = 'query-where' | 'create' | 'update' | 'read'
export type ObjectCleaner = (
    object: any,
    options: ObjectCleanerOptions,
) => Promise<any>
export type ObjectCleanerOptions = {
    collectionDefinition: CollectionDefinition
    stemmerSelector: StemmerSelector
}

export type Stemmer = (text: string) => Set<string>
export type StemmerSelector = (opts: {
    collectionName: string
    fieldName: string
}) => Stemmer | null
export type SchemaPatcher = (schema: DexieSchema[]) => DexieSchema[]
