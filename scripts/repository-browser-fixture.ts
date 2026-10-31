import { createEditorRepository, RepositoryConflict } from '../src/io/editor-repository'
import { STORAGE_VERSION, upgradeStorageDatabase } from '../src/io/storage'
import { newEditorDocument } from '../src/editor/model'

/** Compiled only by the smoke harness, never by the product build. Uses native IDB. */
export async function runRepositoryChecks() {
  const checks: string[] = []
  function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  async function rejects(action: Promise<unknown>, kind?: string) {
    try { await action } catch (error) {
      if (kind) assert(error instanceof Error && error.name === kind, `Expected ${kind}, got ${String(error)}`)
      return
    }
    throw new Error('Expected operation to fail')
  }
  const name = `blockstage-repository-test-${crypto.randomUUID()}`
  const connections: IDBDatabase[] = []
  async function open(version: number, upgrade?: (db: IDBDatabase, tx: IDBTransaction) => void) {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, version)
      request.onupgradeneeded = () => upgrade?.(request.result, request.transaction!)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => { connections.push(request.result); resolve(request.result) }
    })
  }
  async function write(db: IDBDatabase, store: string, value: unknown) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(value)
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () => reject(tx.error)
    })
  }
  async function raw(db: IDBDatabase, store: string, id: string) {
    return new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(store), request = tx.objectStore(store).get(id)
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = tx.onerror = () => reject(tx.error)
    })
  }
  try {
    const old = await open(5, db => {
      for (const store of ['projects', 'packs', 'catalogs', 'profiles', 'preferences', 'editorDocuments', 'componentAssets']) db.createObjectStore(store, { keyPath: 'id' })
    })
    const legacy = newEditorDocument(), invalid = { id: 'invalid', privateUnknown: ['preserve', 123] }
    await write(old, 'editorDocuments', legacy)
    await write(old, 'editorDocuments', invalid)
    await write(old, 'componentAssets', { id: legacy.id, canary: true })
    old.close()
    await rejects(open(STORAGE_VERSION, (db, tx) => { upgradeStorageDatabase(db); tx.abort() }), 'AbortError')
    const recovered = await open(5)
    assert(equal(await raw(recovered, 'editorDocuments', legacy.id), legacy), 'Aborted upgrade must preserve v5 snapshots')
    assert(!recovered.objectStoreNames.contains('editorRevisions'), 'Aborted upgrade must roll back new store')
    recovered.close()
    const dbA = await open(STORAGE_VERSION, upgradeStorageDatabase), dbB = await open(STORAGE_VERSION)
    const a = createEditorRepository(async () => dbA), b = createEditorRepository(async () => dbB)
    assert(equal(await raw(dbA, 'editorDocuments', legacy.id), legacy), 'Upgrade must not rewrite legacy records')
    assert(await raw(dbA, 'editorRevisions', legacy.id) === undefined, 'Upgrade must not publish revision metadata')
    const loaded = await a.load(legacy.id)
    assert(loaded?.token.version === 0, 'Legacy records need an explicit version-zero token')
    await rejects(a.save(legacy, null), RepositoryConflict.name)
    const adopted = await a.save({ ...legacy, name: 'Saved legacy' }, loaded.token)
    assert(adopted.token.version === 1 && adopted.token.generation !== 'legacy', 'First explicit save must adopt legacy identity')
    assert(adopted.updatedAt !== undefined && (await a.load(legacy.id))?.updatedAt === adopted.updatedAt, 'Save must persist display time; legacy load must not invent it')
    assert(equal(await raw(dbA, 'editorDocuments', 'invalid'), invalid), 'Invalid data must be left untouched')
    const listing = await a.list()
    assert(listing.records.length === 1 && listing.issues.length === 1, 'Listing must report invalid records while loading valid ones')
    checks.push('v5 upgrade/abort/read without rewrite; explicit legacy adoption; invalid data preserved')

    const doc = newEditorDocument(), originalName = doc.name
    const pending = a.save(doc, null)
    doc.name = 'Changed after submit'
    const saved = await pending
    assert(saved.document.name === originalName, 'Save must snapshot before its first await')
    assert(equal(await raw(dbA, 'preferences', 'editor:architecture'), { id: 'editor:architecture', value: doc.id }), 'Save must publish active pointer')
    const race = await Promise.allSettled([a.save({ ...doc, name: 'Writer A' }, saved.token), b.save({ ...doc, name: 'Writer B' }, saved.token)])
    assert(race.filter(result => result.status === 'fulfilled').length === 1, 'Exactly one connection may win a CAS race')
    const loser = race.find(result => result.status === 'rejected') as PromiseRejectedResult
    assert(loser.reason instanceof RepositoryConflict, 'Losing writer must receive a conflict')
    const winner = (await a.load(doc.id))!
    assert(winner.token.version === 2 && winner.token.generation === saved.token.generation, 'Storage version increases independently of content/history')
    checks.push('immutable submitted snapshot; two independent IDB connections, one CAS winner')

    let release!: (db: IDBDatabase) => void
    const delayed = createEditorRepository(() => new Promise(resolve => { release = resolve }))
    const stale = delayed.save({ ...doc, name: 'Stale writer' }, winner.token)
    const latest = await b.save({ ...doc, name: 'Latest writer' }, winner.token)
    release(dbA)
    await rejects(stale, RepositoryConflict.name)
    assert((await a.load(doc.id))?.document.name === 'Latest writer', 'Late old save must not overwrite new save')
    const staleDelete = delayed.save({ ...doc, name: 'Resurrection' }, latest.token)
    const other = await a.save(newEditorDocument('component'), null)
    await a.remove(doc.id, latest.token, 'architecture')
    release(dbA)
    await rejects(staleDelete, RepositoryConflict.name)
    await rejects(a.save(doc, null), RepositoryConflict.name)
    await rejects(a.save(doc, latest.token), RepositoryConflict.name)
    assert(await a.load(doc.id) === null, 'Deleted snapshot must not resurrect')
    assert(await raw(dbA, 'preferences', 'editor:architecture') === undefined, 'Delete active document clears matching pointer')
    assert(equal(await raw(dbA, 'preferences', 'editor:component'), { id: 'editor:component', value: other.document.id }), 'Delete preserves other workspace pointer')
    assert(equal(await raw(dbA, 'componentAssets', legacy.id), { id: legacy.id, canary: true }), 'Delete never cascades to library assets')
    checks.push('late save rejected; tombstone blocks old/null tokens; scoped preference cleanup')

    const fault = createEditorRepository(async () => new Proxy(dbA, {
      get(target, property) {
        if (property === 'transaction') return (stores: string[], mode: IDBTransactionMode) => {
          const tx = target.transaction(stores, mode), objectStore = tx.objectStore.bind(tx)
          tx.objectStore = (store: string) => {
            const result = objectStore(store)
            if (mode === 'readwrite' && store === 'preferences') result.put = () => { throw new DOMException('Injected quota failure', 'QuotaExceededError') }
            return result
          }
          return tx
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }))
    const before = await a.load(legacy.id), pointer = await raw(dbA, 'preferences', 'editor:architecture')
    await rejects(fault.save({ ...before!.document, name: 'Must roll back' }, before!.token), 'QuotaExceededError')
    assert(equal(await a.load(legacy.id), before), 'Failed preference write rolls back snapshot and revision')
    assert(equal(await raw(dbA, 'preferences', 'editor:architecture'), pointer), 'Failed save must not publish preference')
    await rejects(a.remove(legacy.id, before!.token, 'component'))
    assert(equal(await a.load(legacy.id), before), 'Wrong workspace delete must reject atomically')
    checks.push('injected quota failure rolls back document/revision/pointer; wrong workspace rejected')

    const broken = newEditorDocument()
    await write(dbA, 'editorDocuments', broken)
    await write(dbA, 'editorRevisions', { id: broken.id, version: -1, generation: 'corrupt', deleted: false })
    await rejects(a.load(broken.id))
    await rejects(a.save(broken, null))
    assert(equal(await raw(dbA, 'editorDocuments', broken.id), broken), 'Malformed metadata fails closed without rewriting snapshot')
    checks.push('malformed metadata load/save fail closed without data loss')
    await a.remove(legacy.id, before!.token, 'architecture')
    assert(equal(await raw(dbA, 'componentAssets', legacy.id), { id: legacy.id, canary: true }), 'Deleting the same document ID must preserve the component library asset')
    const binding = await a.save(newEditorDocument('component'), null, { activate: false, componentAssetId: legacy.id })
    assert((await a.load(binding.document.id))?.componentAssetId === legacy.id, 'Working document must retain separate library identity after reload')
    assert(equal(await raw(dbA, 'preferences', 'editor:component'), { id: 'editor:component', value: other.document.id }), 'Inactive save must not switch active preference')
    const renamed = await a.save({ ...binding.document, name: 'Renamed inactive' }, binding.token, { activate: false })
    assert(renamed.componentAssetId === legacy.id, 'Renaming must preserve component provenance')
    await rejects(a.activate('component', renamed.document.id, binding.token), RepositoryConflict.name)
    await a.activate('component', renamed.document.id, renamed.token)
    await a.remove(renamed.document.id, renamed.token, 'component')
    await rejects(a.activate('component', renamed.document.id, renamed.token), RepositoryConflict.name)
    assert(await raw(dbA, 'preferences', 'editor:component') === undefined, 'Late activation must not restore a deleted preference')
    checks.push('document deletion preserves same-ID component asset')
    return checks
  } finally {
    connections.forEach(db => db.close())
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
