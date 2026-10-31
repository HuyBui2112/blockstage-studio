import assert from 'node:assert/strict'
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** Recovery runs against the harness's disposable profile, including a second app page. */
export async function runRecoveryScenarios({ command, evaluate, until, click, aria, input, upload, key, screenshot, directory, createPeer }) {
  const ready = `document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const snapshot = () => evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot)`)
  const phase = value => `document.querySelector('[aria-label="Draft protection"]')?.dataset.phase===${JSON.stringify(value)}`
  const protectedDraft = () => until(phase('protected'))
  const settle = async () => { await evaluate('new Promise(resolve=>setTimeout(resolve,0))'); await until(ready) }
  const rename = async name => {
    await input(aria('Document name'), name)
    await evaluate(`document.querySelector('[aria-label="Document name"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`)
    await settle()
  }
  const save = async () => { await evaluate(`Array.from(document.querySelectorAll('.document-actions button')).find(button=>button.textContent.trim()==='Save').click()`); await until(`document.querySelector('.document-saved')`) }
  const newDocument = async () => { await evaluate(`Array.from(document.querySelectorAll('.document-actions button')).find(button=>button.textContent.trim()==='New').click()`); await settle() }
  const raw = (store, id) => evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('blockstage-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,query=db.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).${id === undefined ? 'getAll()' : `get(${JSON.stringify(id)})`};query.onsuccess=()=>{db.close();resolve(query.result??null)};query.onerror=()=>reject(query.error)}})`)
  const heads = async () => (await raw('editorDraftHeads')).filter(head => head.status === 'live')
  const manager = async () => { await click(aria('Manage editor documents')); await until(`document.querySelector('.documents-content')?.getAttribute('aria-busy')==='false'`) }
  const recovery = async () => { await manager(); await click(aria('Recovery documents')); await until(`document.querySelector('.recovery-list')?.getAttribute('aria-busy')==='false'`) }
  const close = () => click(aria('Close Documents'))
  const recoveryRow = id => `.recovery-item[data-recovery-id=${JSON.stringify(id)}]`
  const confirm = () => click(aria('Confirm recovery action'))
  const reload = async () => { const old = await evaluate('performance.timeOrigin'); await command('Page.reload'); await until(`performance.timeOrigin!==${old} && (${ready})`) }
  const discardCurrent = async () => { await manager(); await click(aria('Discard document changes')); await click(aria('Confirm document action')); await until(`!document.querySelector('.document-confirm')`); await close() }
  const peerRename = async (peer, name) => {
    await peer.evaluate(`(()=>{const input=document.querySelector('[aria-label="Document name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}))})()`)
    await peer.until(`document.querySelector('[aria-label="Document name"]').defaultValue===${JSON.stringify(name)}`)
  }
  await click(aria('Architecture workspace')); await settle()
  await command('Emulation.setDeviceMetricsOverride', { width:1500,height:1000,deviceScaleFactor:1,mobile:false })
  // Earlier suites intentionally leave protected drafts. Discard their test fixtures via UI.
  await recovery()
  while (await evaluate(`document.querySelectorAll('.recovery-item').length`)) {
    const count = await evaluate(`document.querySelectorAll('.recovery-item').length`)
    await click('.recovery-item button[aria-label^="Discard recovery"]'); await confirm()
    await until(`!document.querySelector('[aria-label="Recovery confirmation"]') && document.querySelectorAll('.recovery-item').length<${count}`)
  }
  await close(); await newDocument()
  console.log(JSON.stringify({ recoveryStep: 'old fixture recovery cleared' }))
  const fixture = { schemaVersion:2,id:'recovery-stone',name:'Recovery room',workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},entities:[],objects:[{id:'stone',name:'Stone',kind:'block',cells:[{pos:[1,2,-3],state:{name:'minecraft:stone',properties:{}}}],children:[],pivot2:[3,5,-5],orientation:0}] }
  const path = join(directory, 'recovery-room.json')
  await writeFile(path, JSON.stringify(fixture))
  await upload(aria('Import editor document'), path)
  await until(`document.querySelector('.editor-diagnostics').dataset.blocks==='1'`)
  await protectedDraft()
  const original = await snapshot(), originalHead = (await heads()).find(head => head.documentId === original.id)
  assert.ok(originalHead)
  assert.equal(await raw('editorDocuments', original.id), null, 'Autosave must keep new work out of Saved documents')
  await click(aria('Editor X view'))
  await evaluate('new Promise(resolve=>setTimeout(resolve,900))')
  assert.deepEqual(await raw('editorDraftHeads', originalHead.id), originalHead, 'Camera/preview changes must not create a committed draft revision')
  await reload()
  console.log(JSON.stringify({ recoveryStep: 'protected unsaved work reloaded' }))
  assert.notEqual((await snapshot()).id, original.id, 'Recovery must be offered, never silently applied')
  await recovery()
  await screenshot('editor-recovery')
  const downloads = join(directory, 'recovery-downloads')
  await mkdir(downloads, { recursive: true })
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  await click(`${recoveryRow(originalHead.id)} button[aria-label^="Download recovery"]`)
  let backup
  for (let i = 0; i < 100; i++) { try { backup = JSON.parse(await readFile(join(downloads, 'Recovery room.recovery.blockstage.json'), 'utf8')); break } catch { await delay(100) } }
  assert.equal(backup?.id, original.id, 'Recovery backup must be downloadable without promoting Saved')
  await until(`document.querySelector('.recovery-list')?.getAttribute('aria-busy')==='false'`)
  await click(`${recoveryRow(originalHead.id)} button[aria-label^="Restore draft"]`); await confirm()
  await until(`!document.querySelector('.documents-dialog')`)
  assert.deepEqual((await snapshot()).cells, original.cells)
  assert.equal((await snapshot()).id, original.id)
  assert.ok(await evaluate(`Boolean(document.querySelector('.document-dirty'))`))
  assert.equal((await raw('editorDraftHeads', originalHead.id)).status, 'retired')
  await rename('Saved checkpoint recovery'); await save()
  console.log(JSON.stringify({ recoveryStep: 'new unsaved recovery restored and saved' }))
  await rename('Unsaved after checkpoint')
  const beforeUndo = await evaluate(`Number(document.querySelector('.editor-diagnostics').dataset.revision)`)
  await evaluate(`document.querySelector('canvas').focus()`); await key('KeyZ', 'z', 2); await key('KeyZ', 'z', 10)
  assert.equal(await evaluate(`Number(document.querySelector('.editor-diagnostics').dataset.revision)`), beforeUndo + 2, 'Undo/Redo must increase committed revision, never rewind it')
  await protectedDraft()
  const changedHead = (await heads()).find(head => head.documentId === original.id)
  await reload()
  assert.equal(await evaluate(`document.querySelector('[aria-label="Document name"]').value`), 'Saved checkpoint recovery', 'Reload must load Saved separately from draft')
  await recovery(); await click(`${recoveryRow(changedHead.id)} button[aria-label^="Restore draft"]`); await confirm()
  await until(`!document.querySelector('.documents-dialog')`)
  assert.equal((await raw('editorDocuments', original.id)).name, 'Saved checkpoint recovery', 'Restore must not overwrite Saved')
  await discardCurrent(); await reload()
  assert.equal(await evaluate(`document.querySelector('[aria-label="Document name"]').value`), 'Saved checkpoint recovery')
  assert.ok(!(await heads()).some(head => head.documentId === original.id), 'Discard must retire the current recovery stream')
  console.log(JSON.stringify({ recoveryStep: 'saved checkpoint recovery/discard verified' }))

  await click(aria('Component Editor workspace')); await settle(); await newDocument()
  await rename('Independent component draft'); await protectedDraft()
  const component = await snapshot()
  await click(aria('Architecture workspace')); await reload()
  assert.equal((await snapshot()).id, original.id, 'Component draft must not replace architecture')
  await click(aria('Component Editor workspace')); await settle(); await recovery()
  const componentHead = (await heads()).find(head => head.documentId === component.id)
  await click(`${recoveryRow(componentHead.id)} button[aria-label^="Restore draft"]`); await confirm(); await until(`!document.querySelector('.documents-dialog')`)
  assert.equal((await snapshot()).id, component.id)
  await discardCurrent()

  await click(aria('Architecture workspace')); await settle(); await newDocument()
  await evaluate(`(()=>{const original=IDBObjectStore.prototype.put;window.__draftAttempts=0;window.__restoreDraftPut=()=>{IDBObjectStore.prototype.put=original};IDBObjectStore.prototype.put=function(...args){if(this.name==='editorDrafts'){window.__draftAttempts++;throw new DOMException('Injected draft quota failure','QuotaExceededError')}return original.apply(this,args)}})()`)
  try {
    await rename('Draft quota failure'); await until(phase('error'))
    await rename('Latest edit after failure')
    await evaluate('new Promise(resolve=>setTimeout(resolve,1000))')
    assert.equal(await evaluate('window.__draftAttempts'), 1, 'Failed background protection must not spin/retry on every edit')
    assert.equal(await raw('editorDocuments', (await snapshot()).id), null)
  } finally { await evaluate('window.__restoreDraftPut();delete window.__restoreDraftPut') }
  await click(aria('Retry draft protection')); await protectedDraft()
  const retried = await snapshot()
  assert.equal((await heads()).find(head => head.documentId === retried.id)?.name, 'Latest edit after failure')
  await save()
  const shared = await snapshot()
  const peer = await createPeer()
  let peerHead
  try {
    await peer.evaluate(`document.querySelector('[aria-label="Architecture workspace"]').click()`)
    await peer.until(ready)
    await peerRename(peer, 'Closed page recovery')
    await peer.until(phase('protected'))
    peerHead = (await heads()).find(head => head.name === 'Closed page recovery')
  } finally { await peer.close() }
  assert.ok(peerHead, 'Closing a page after protected ack must retain recovery')
  await rename('Newer Saved revision'); await save()
  await recovery()
  await click(`${recoveryRow(peerHead.id)} button[aria-label^="Restore draft"]`); await confirm()
  await until(`document.querySelector('.document-manager-error')?.textContent.includes('Recover a copy')`)
  assert.equal((await raw('editorDocuments', shared.id)).name, 'Newer Saved revision')
  await click(`${recoveryRow(peerHead.id)} button[aria-label^="Recover copy"]`); await confirm(); await until(`!document.querySelector('.documents-dialog')`)
  assert.notEqual((await snapshot()).id, shared.id, 'Conflicting recovery must get an independent ID')
  assert.equal((await raw('editorDocuments', shared.id)).name, 'Newer Saved revision')
  await discardCurrent()
  await manager(); await click(`.saved-document[data-document-id=${JSON.stringify(shared.id)}] .saved-document-open`); await until(`!document.querySelector('.documents-dialog')`)
  const peerDelete = await createPeer()
  try {
    await peerDelete.evaluate(`document.querySelector('[aria-label="Architecture workspace"]').click()`); await peerDelete.until(ready)
    await peerRename(peerDelete, 'Peer before document deletion'); await peerDelete.until(phase('protected'))
    await rename('Main before document deletion'); await protectedDraft()
    await manager(); await click(`.saved-document[data-document-id=${JSON.stringify(shared.id)}] button[title="Delete saved document"]`)
    await click(aria('Confirm document action')); await until(`!document.querySelector('.document-confirm')`); await close()
    assert.ok(!(await heads()).some(head => head.documentId === shared.id), 'Delete must remove all live recovery streams across pages')
    await peerRename(peerDelete, 'Peer edit after deletion'); await peerDelete.until(phase('error'))
    assert.equal(await raw('editorDocuments', shared.id), null)
  } finally { await peerDelete.close() }
  await reload()
  assert.ok(!(await heads()).some(head => head.documentId === shared.id))
  await upload(aria('Import editor document'), path)
  await until(`document.querySelector('.editor-diagnostics').dataset.blocks==='1'`); await protectedDraft()
  const missingAssetsDraft = (await heads()).find(head => head.name === 'Recovery room')
  // Simulate another origin's missing resources inside the disposable profile only.
  await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('blockstage-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['packs','profiles','catalogs'],'readwrite');for(const name of ['packs','profiles','catalogs'])tx.objectStore(name).clear();tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}})`)
  await reload()
  await recovery(); await click(`${recoveryRow(missingAssetsDraft.id)} button[aria-label^="Restore draft"]`); await confirm(); await until(`!document.querySelector('.documents-dialog')`)
  assert.equal((await snapshot()).cells[0].state.name, 'minecraft:stone', 'Recovery must preserve document data without a profile or textures')
  await discardCurrent()
  await command('Emulation.setDeviceMetricsOverride', { width:620,height:800,deviceScaleFactor:1,mobile:false })
  await recovery(); await screenshot('editor-recovery-compact'); await close()
  console.log(JSON.stringify({ recoveryResult:'passed', checks:['new unsaved work protected without Saved promotion','camera does not change revision','reload offers recovery explicitly','download recovery JSON','restore keeps Saved checkpoint','Undo/Redo committed revision monotonic','discard survives reload','independent Architecture/Component recovery','quota rollback and manual latest retry','closed page recovery','changed-base recovery copy','two-page delete invalidates all drafts','recovery without assets/profile','compact recovery'] }))
}
