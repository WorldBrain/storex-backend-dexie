export default () => ({
  factory: new (require('fake-indexeddb/lib/FDBFactory')),
  range: require('fake-indexeddb/lib/FDBKeyRange'),
})
