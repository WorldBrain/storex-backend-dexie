export default () => ({
    factory: new (require('fake-indexeddb/ts/FDBFactory'))(),
    range: require('fake-indexeddb/ts/FDBKeyRange'),
})
