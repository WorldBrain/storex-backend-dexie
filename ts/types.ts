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
