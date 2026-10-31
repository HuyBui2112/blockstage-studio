import { createEditorRepository, RepositoryConflict } from '../src/io/editor-repository'
import { STORAGE_VERSION, upgradeStorageDatabase } from '../src/io/storage'
import { newEditorDocument } from '../src/editor/model'
import { createDraftRepository } from '../src/io/draft-repository'
import { DraftConflict, MAX_DRAFTS } from '../src/io/draft-storage'
import { commitPortableRestore } from '../src/io/portable-repository'

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
    const drafts = createDraftRepository(async () => dbA), peerDrafts = createDraftRepository(async () => dbB)
    const draftDocument = newEditorDocument(), draftId = crypto.randomUUID()
    const draft = { id: draftId, epoch: draftId, documentId: draftDocument.id, workspace: draftDocument.workspace, document: draftDocument, base: null, revision: 1 }
    const beforePointer = await raw(dbA, 'preferences', 'editor:architecture')
    const protectedDraft = await drafts.write(draft)
    assert(await raw(dbA, 'editorDocuments', draftDocument.id) === undefined, 'Autosave must never promote a draft to Saved')
    assert(equal(await raw(dbA, 'preferences', 'editor:architecture'), beforePointer), 'Draft write must not change Saved active pointer')
    const newer = await drafts.write({ ...draft, revision: 2, document: { ...draft.document, name: 'Newer draft' } })
    await rejects(drafts.discard(protectedDraft, protectedDraft.revision), DraftConflict.name)
    await rejects(drafts.load(protectedDraft), DraftConflict.name)
    await drafts.discard(newer, newer.revision)
    await rejects(drafts.write({ ...draft, revision: 3 }), DraftConflict.name)
    await rejects(a.save(draftDocument, null, { draft }), DraftConflict.name)
    assert(await raw(dbA, 'editorDocuments', draftDocument.id) === undefined, 'Late Save must abort if its draft stream was discarded')
    checks.push('draft and Saved separation; stale discard/load rejected; tombstone blocks late draft and Save')

    const checkpoint = await a.save(newEditorDocument(), null)
    const ownId = crypto.randomUUID(), peerId = crypto.randomUUID()
    const own = { ...draft, id: ownId, epoch: ownId, documentId: checkpoint.document.id, document: checkpoint.document, base: checkpoint.token }
    const peerWrite = { ...own, id: peerId, epoch: peerId }
    const ownHead = await drafts.write(own), peerHead = await peerDrafts.write(peerWrite)
    await rejects(fault.save(checkpoint.document, checkpoint.token, { draft: own }), 'QuotaExceededError')
    assert((await drafts.load(ownHead)).id === checkpoint.document.id, 'Failed Save must preserve recovery payload')
    const savedAgain = await a.save(checkpoint.document, checkpoint.token, { draft: own })
    assert(!(await drafts.list()).records.some(head => head.id === ownId), 'Successful Save must atomically retire its own recovery')
    assert((await drafts.list()).records.some(head => head.id === peerId), 'Save must not delete a peer recovery')
    await rejects(drafts.restore(peerHead, { id: crypto.randomUUID(), epoch: crypto.randomUUID() }), DraftConflict.name)
    const forked = await drafts.restore(peerHead, { id: crypto.randomUUID(), epoch: crypto.randomUUID(), copyDocumentId: crypto.randomUUID() })
    assert(forked.document.id !== checkpoint.document.id && forked.saved === null, 'Conflicting recovery must fork with a fresh document ID')
    assert(equal(await a.load(checkpoint.document.id), savedAgain), 'Recover copy must not modify original Saved checkpoint')
    await rejects(peerDrafts.write({ ...peerWrite, revision: 2 }), DraftConflict.name)
    const liveAfter = { ...own, id: crypto.randomUUID(), epoch: crypto.randomUUID(), base: savedAgain.token }
    await drafts.write(liveAfter)
    await a.remove(checkpoint.document.id, savedAgain.token, 'architecture')
    assert(!(await drafts.list()).records.some(head => head.documentId === checkpoint.document.id), 'Document delete must retire every recovery stream for the document')
    await rejects(peerDrafts.write({ ...liveAfter, revision: 2 }), DraftConflict.name)
    checks.push('Save retires only own stream; failed Save preserves recovery; changed-base copy; document delete invalidates all streams')

    const remaining = (await drafts.list()).records
    for (const head of remaining) await drafts.discard(head, head.revision)
    const capacity = []
    for (let index = 0; index < MAX_DRAFTS; index++) {
      const document = newEditorDocument(), id = crypto.randomUUID()
      capacity.push(await drafts.write({ id, epoch: id, documentId: document.id, workspace: document.workspace, base: null, revision: 1, document }))
    }
    const extraDoc = newEditorDocument(), extraId = crypto.randomUUID()
    const extraWrite = { id: extraId, epoch: extraId, documentId: extraDoc.id, workspace: extraDoc.workspace, base: null, revision: 1, document: extraDoc }
    await rejects(drafts.write(extraWrite))
    assert((await drafts.list()).records.length === MAX_DRAFTS, 'Retention cap must reject new work without deleting old user drafts')
    await drafts.discard(capacity[0], capacity[0].revision)
    await drafts.write(extraWrite)
    checks.push('bounded recovery retention rejects overflow; explicit discard frees capacity without automatic eviction')
    for (const head of (await drafts.list()).records) await drafts.discard(head, head.revision)
    const byteHeads = []
    for (let index = 0; index < 2; index++) {
      const document = newEditorDocument(), id = crypto.randomUUID()
      const head = await drafts.write({ id,epoch:id,documentId:document.id,workspace:document.workspace,base:null,revision:1,document })
      const simulatedLargeHead = { ...head, bytes:32 * 1024 ** 2 }
      await write(dbA, 'editorDraftHeads', simulatedLargeHead)
      byteHeads.push(simulatedLargeHead)
    }
    await rejects(drafts.write({ ...extraWrite, id:crypto.randomUUID(),epoch:crypto.randomUUID() }))
    assert((await drafts.list()).records.length === 2, 'Aggregate byte budget must reject overflow without evicting live heads')
    for (const head of byteHeads) await drafts.discard(head, head.revision)
    const componentDocument = newEditorDocument('component'), componentDraftId = crypto.randomUUID()
    const bound = await drafts.write({ id:componentDraftId,epoch:componentDraftId,documentId:componentDocument.id,workspace:'component',base:null,revision:1,document:componentDocument,componentAssetId:legacy.id })
    const resumed = await drafts.restore(bound, { id:crypto.randomUUID(),epoch:crypto.randomUUID() })
    assert(resumed.head.componentAssetId === legacy.id, 'Resume must keep component publication provenance')
    const independent = await drafts.restore(resumed.head, { id:crypto.randomUUID(),epoch:crypto.randomUUID(),copyDocumentId:crypto.randomUUID() })
    assert(independent.head.componentAssetId === undefined, 'Independent recovery copy must not keep a library publication binding')
    const corruptPayload = { id:independent.head.id,document:{ ...independent.document,name:'Corrupt metadata mismatch' } }
    await write(dbA, 'editorDrafts', corruptPayload)
    await rejects(drafts.load(independent.head))
    await rejects(drafts.restore(independent.head, { id:crypto.randomUUID(),epoch:crypto.randomUUID() }))
    assert(equal(await raw(dbA, 'editorDrafts', independent.head.id), corruptPayload), 'Invalid payload must be left untouched after failed recovery')
    checks.push('aggregate payload budget; resume/copy binding ownership; malformed recovery payload preserved')
    const version6Name = `${name}-v6`
    let version6Db: IDBDatabase | undefined
    try {
      version6Db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(version6Name, 6)
        request.onupgradeneeded = () => { for (const store of ['projects','packs','catalogs','profiles','preferences','editorDocuments','componentAssets','editorRevisions']) request.result.createObjectStore(store, { keyPath:'id' }) }
        request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result)
      })
      const version6Doc = newEditorDocument(), version6Token = { id:version6Doc.id,generation:'v6-generation',version:8,deleted:false,updatedAt:1234 }
      await write(version6Db, 'editorDocuments', version6Doc); await write(version6Db, 'editorRevisions', version6Token)
      version6Db.close()
      version6Db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(version6Name, STORAGE_VERSION)
        request.onupgradeneeded = () => upgradeStorageDatabase(request.result)
        request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result)
      })
      assert(equal(await raw(version6Db, 'editorDocuments', version6Doc.id), version6Doc), 'v6 upgrade must not rewrite Saved payload')
      assert(equal(await raw(version6Db, 'editorRevisions', version6Doc.id), version6Token), 'v6 upgrade must preserve repository token and metadata')
      assert(version6Db.objectStoreNames.contains('editorDraftHeads') && version6Db.objectStoreNames.contains('editorDrafts'), 'v7 must add recovery stores')
    } finally {
      version6Db?.close()
      await new Promise<void>((resolve, reject) => { const request=indexedDB.deleteDatabase(version6Name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error) })
    }
    checks.push('additive v6 to v7 migration preserves Saved payload/token/metadata')
    const portablePlan={document:newEditorDocument(),components:[{schemaVersion:1 as const,id:crypto.randomUUID(),name:'Restored column',objects:[{id:'portable-stone',name:'Stone',kind:'block' as const,cells:[{pos:[0,0,0] as [number,number,number],state:{name:'minecraft:stone',properties:{}}}],children:[],pivot2:[1,1,1] as [number,number,number],orientation:0 as const}],pivot2:[1,1,1] as [number,number,number],size:[1,1,1] as [number,number,number],orientation:0 as const}]}
    const beforePortablePointer=await raw(dbA,'preferences','editor:architecture')
    const faultDb=await new Promise<IDBDatabase>(resolve=>{const injected=new Proxy(dbA,{get(target,property){if(property==='transaction')return(stores:string[],mode:IDBTransactionMode)=>{const tx=target.transaction(stores,mode),read=tx.objectStore.bind(tx);tx.objectStore=(name:string)=>{const store=read(name);if(name==='preferences')store.put=()=>{throw new DOMException('Portable quota failure','QuotaExceededError')};return store};return tx};const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value}});resolve(injected)})
    await rejects(commitPortableRestore(portablePlan,async()=>faultDb),'QuotaExceededError')
    assert(await raw(dbA,'editorDocuments',portablePlan.document.id)===undefined,'Failed restore must roll back document')
    assert(await raw(dbA,'editorRevisions',portablePlan.document.id)===undefined,'Failed restore must roll back revision')
    assert(await raw(dbA,'componentAssets',portablePlan.components[0].id)===undefined,'Failed restore must roll back library copies')
    assert(equal(await raw(dbA,'preferences','editor:architecture'),beforePortablePointer),'Failed restore must retain active preference')
    const restoredPortable=await commitPortableRestore(portablePlan,async()=>dbA)
    assert((await a.load(restoredPortable.document.id))?.token.version===1,'Restore creates a versioned Saved checkpoint')
    assert(equal(await raw(dbA,'componentAssets',portablePlan.components[0].id),portablePlan.components[0]),'Restore publishes library definitions')
    await rejects(commitPortableRestore(portablePlan,async()=>dbB))
    assert(equal((await a.load(restoredPortable.document.id))?.document,portablePlan.document),'Repeat ID restore must not overwrite existing Saved')
    checks.push('portable restore atomic document/revision/library/preference; quota rollback; repeat ID conflict preserves existing data')
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
