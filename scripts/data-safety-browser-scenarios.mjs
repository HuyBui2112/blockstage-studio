import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** D07 acceptance: only the harness's disposable origin/profile is modified. */
export async function runDataSafetyScenarios({ command, evaluate, until, click, aria, input, upload, screenshot, directory, createPeer }) {
  const ready = `document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const phase = value => `document.querySelector('[aria-label="Draft protection"]')?.dataset.phase===${JSON.stringify(value)}`
  const snapshot = () => evaluate(`({...JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot),name:document.querySelector('[aria-label="Document name"]').value})`)
  const raw = (store, id) => evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('blockstage-studio');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction(${JSON.stringify(store)}),q=tx.objectStore(${JSON.stringify(store)}).${id === undefined ? 'getAll()' : `get(${JSON.stringify(id)})`};q.onsuccess=()=>{db.close();resolve(q.result??null)};q.onerror=()=>reject(q.error)}})`)
  const heads = async () => (await raw('editorDraftHeads')).filter(head => head.status === 'live')
  const rename = async name => {
    await input(aria('Document name'), name)
    await evaluate(`document.querySelector('[aria-label="Document name"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`)
    await until(`document.querySelector('[aria-label="Document name"]').defaultValue===${JSON.stringify(name)}`)
  }
  const saveClick = () => evaluate(`Array.from(document.querySelectorAll('.document-actions button')).find(button=>button.textContent.trim()==='Save').click()`)
  const save = async () => { await saveClick(); await until(`document.querySelector('.document-saved')`) }
  const newDocument = async () => { await evaluate(`Array.from(document.querySelectorAll('.document-actions button')).find(button=>button.textContent.trim()==='New').click()`); await until(ready) }
  const reload = async () => { const previous = await evaluate('performance.timeOrigin'); await command('Page.reload'); await until(`performance.timeOrigin!==${previous} && (${ready})`) }
  const recovery = async () => {
    await click(aria('Manage editor documents')); await until(`document.querySelector('.documents-content')?.getAttribute('aria-busy')==='false'`)
    await click(aria('Recovery documents')); await until(`document.querySelector('.recovery-list')?.getAttribute('aria-busy')==='false'`)
  }
  const row = id => `.recovery-item[data-recovery-id=${JSON.stringify(id)}]`
  const restore = async (id, copy = false) => {
    await click(`${row(id)} button[aria-label^=${JSON.stringify(copy ? 'Recover copy' : 'Restore draft')}]`)
    await click(aria('Confirm recovery action'))
  }
  const downloads = join(directory, 'data-safety-downloads'); await mkdir(downloads, { recursive: true })
  const download = async name => {
    await command('Browser.setDownloadBehavior', { behavior:'allow',downloadPath:downloads })
    await click(aria('Export editor document'))
    for (let attempt = 0; attempt < 100; attempt++) {
      try { return JSON.parse(await readFile(join(downloads, `${name}.blockstage.json`), 'utf8')) } catch { await delay(100) }
    }
    throw new Error(`Missing JSON escape-hatch download for ${name}`)
  }
  await command('Emulation.setDeviceMetricsOverride', { width:1500,height:1000,deviceScaleFactor:1,mobile:false })
  await click(aria('Architecture workspace')); await until(ready)
  const fixture = {schemaVersion:2,id:'d07-input',name:'D07 room',workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},entities:[],objects:[{id:'d07-log',name:'Beam',kind:'block',cells:[{pos:[-2,1,3],state:{name:'minecraft:oak_log',properties:{axis:'x'}}}],children:[],pivot2:[-3,3,7],orientation:0}]}
  const file = join(directory, 'd07-room.json'); await writeFile(file, JSON.stringify(fixture))
  await upload(aria('Import editor document'), file)
  await until(`document.querySelector('.editor-diagnostics').dataset.blocks==='1'`); await until(phase('protected')); await save()
  const checkpoint = await snapshot(), storedCheckpoint = await raw('editorDocuments', checkpoint.id)

  // A failed protection attempt must block switching, leave Saved untouched and allow JSON/retry.
  await evaluate(`(()=>{const put=IDBObjectStore.prototype.put;window.__restoreD07Put=()=>{IDBObjectStore.prototype.put=put};IDBObjectStore.prototype.put=function(...args){if(this.name==='editorDrafts')throw new DOMException('D07 injected quota failure','QuotaExceededError');return put.apply(this,args)}})()`)
  try {
    await rename('D07 blocked switch'); await until(phase('error'))
    const blocked = await snapshot(), preference = await raw('preferences', 'editor:architecture')
    await newDocument()
    await until(`document.querySelector('.editor-feedback')?.textContent.includes('D07 injected quota failure')`)
    assert.deepEqual(await snapshot(), blocked, 'Failed protection must not switch documents or discard edits')
    assert.deepEqual(await raw('preferences', 'editor:architecture'), preference)
    assert.deepEqual(await raw('editorDocuments', checkpoint.id), storedCheckpoint)
    assert.deepEqual((await download('D07 blocked switch')).objects, fixture.objects)
  } finally { await evaluate('window.__restoreD07Put();delete window.__restoreD07Put') }
  await click(aria('Retry draft protection')); await until(phase('protected')); await save()
  console.log(JSON.stringify({dataSafetyStep:'failed protection blocks switch; JSON and explicit retry preserve latest work'}))

  // Two real application pages hold the same Saved token and independent protected streams.
  const peer = await createPeer()
  let losingHead
  try {
    await peer.evaluate(`document.querySelector('[aria-label="Architecture workspace"]').click()`); await peer.until(ready)
    assert.equal(await peer.evaluate(`document.querySelector('.editor-diagnostics').dataset.document`), checkpoint.id)
    await rename('D07 losing local edits'); await until(phase('protected'))
    losingHead = (await heads()).find(head => head.name === 'D07 losing local edits')
    assert.ok(losingHead)
    await peer.evaluate(`(()=>{const field=document.querySelector('[aria-label="Document name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'D07 winning peer');field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new FocusEvent('focusout',{bubbles:true}))})()`)
    await peer.until(phase('protected'))
    await peer.evaluate(`Array.from(document.querySelectorAll('.document-actions button')).find(button=>button.textContent.trim()==='Save').click()`)
    await peer.until(`document.querySelector('.document-saved')`)
    const localBefore = await snapshot()
    await saveClick(); await until(`document.querySelector('.editor-feedback')?.textContent.includes('another session')`)
    assert.deepEqual(await snapshot(), localBefore)
    assert.ok(await evaluate(`Boolean(document.querySelector('.document-dirty'))`))
    assert.equal((await raw('editorDocuments', checkpoint.id)).name, 'D07 winning peer')
    assert.deepEqual(await raw('editorDraftHeads', losingHead.id), losingHead, 'Failed Save must keep its protected recovery stream')
    assert.equal((await download('D07 losing local edits')).name, 'D07 losing local edits')
  } finally { await peer.close() }
  await reload(); assert.equal((await snapshot()).name, 'D07 winning peer')
  await recovery(); await restore(losingHead.id)
  await until(`document.querySelector('.document-manager-error')?.textContent.includes('Recover a copy')`)
  assert.equal((await raw('editorDraftHeads', losingHead.id)).status, 'live')
  await restore(losingHead.id, true); await until(`!document.querySelector('.documents-dialog')`)
  const recoveredCopy = await snapshot()
  assert.notEqual(recoveredCopy.id, checkpoint.id)
  assert.equal(recoveredCopy.name, 'D07 losing local edits')
  assert.deepEqual(recoveredCopy.cells, checkpoint.cells)
  assert.equal((await raw('editorDocuments', checkpoint.id)).name, 'D07 winning peer')
  await save()
  console.log(JSON.stringify({dataSafetyStep:'two-page stale Save rejected; winning Saved and losing recovery/JSON retained; explicit copy recovered'}))

  // Race two confirmations against the same displayed recovery revision: exactly one claim wins.
  await rename('D07 single claim'); await until(phase('protected'))
  const claimHead = (await heads()).find(head => head.name === 'D07 single claim')
  await reload(); await recovery()
  const claimant = await createPeer()
  try {
    await claimant.evaluate(`document.querySelector('[aria-label="Architecture workspace"]').click()`); await claimant.until(ready)
    await claimant.evaluate(`document.querySelector('[aria-label="Manage editor documents"]').click()`)
    await claimant.until(`document.querySelector('.documents-content')?.getAttribute('aria-busy')==='false'`)
    await claimant.evaluate(`document.querySelector('[aria-label="Recovery documents"]').click()`)
    await claimant.until(`document.querySelector('.recovery-list')?.getAttribute('aria-busy')==='false'`)
    await claimant.evaluate(`document.querySelector(${JSON.stringify(`${row(claimHead.id)} button[aria-label^="Restore draft"]`)}).click()`)
    await restore(claimHead.id); await until(`!document.querySelector('.documents-dialog')`)
    const claimed = await snapshot(), claimState = await raw('editorDraftHeads')
    await claimant.evaluate(`document.querySelector('[aria-label="Confirm recovery action"]').click()`)
    await claimant.until(`document.querySelector('.document-manager-error')?.textContent.includes('changed or was discarded')`)
    assert.equal(await claimant.evaluate(`document.querySelector('[aria-label="Document name"]').value`), 'D07 losing local edits')
    assert.deepEqual(await raw('editorDraftHeads'), claimState, 'Rejected stale claim must not retire/create other streams')
    assert.deepEqual(await snapshot(), claimed)
  } finally { await claimant.close() }
  await save()

  // Corruption is reported, not repaired or silently overwritten. Only own fixtures are cleaned up.
  await newDocument()
  const malformed = {id:'d07-malformed-saved',schemaVersion:999,name:'D07 invalid record'}
  const invalidHead = {id:'d07-malformed-head',status:'live',documentId:'d07-invalid',workspace:'architecture'}
  const corruptHead = {...claimHead,id:'d07-corrupt-payload',epoch:'d07-corrupt-epoch',documentId:'d07-corrupt-document',name:'D07 corrupted payload',base:null}
  const corruptBody = {id:corruptHead.id,document:{schemaVersion:999}}
  await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('blockstage-studio');r.onsuccess=()=>{const db=r.result,tx=db.transaction(['editorDocuments','editorDraftHeads','editorDrafts'],'readwrite');tx.objectStore('editorDocuments').put(${JSON.stringify(malformed)});tx.objectStore('editorDraftHeads').put(${JSON.stringify(invalidHead)});tx.objectStore('editorDraftHeads').put(${JSON.stringify(corruptHead)});tx.objectStore('editorDrafts').put(${JSON.stringify(corruptBody)});tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)};r.onerror=()=>reject(r.error)})`)
  try {
    await reload(); const untouched = await snapshot()
    await recovery()
    await until(`document.querySelector('.document-manager-error')?.textContent.includes('invalid recovery record')`)
    await screenshot('editor-data-safety-alerts')
    assert.equal(await evaluate(`Boolean(document.querySelector(${JSON.stringify(row(invalidHead.id))}))`), false)
    await restore(corruptHead.id)
    await until(`document.querySelector('.recovery-list')?.getAttribute('aria-busy')==='false' && document.querySelector('.document-manager-error')?.textContent.includes('schemaVersion')`)
    assert.deepEqual(await snapshot(), untouched)
    assert.deepEqual(await raw('editorDocuments', malformed.id), malformed)
    assert.deepEqual(await raw('editorDraftHeads', invalidHead.id), invalidHead)
    assert.deepEqual(await raw('editorDraftHeads', corruptHead.id), corruptHead)
    assert.deepEqual(await raw('editorDrafts', corruptHead.id), corruptBody)
    await click(aria('Close Documents'))
  } finally {
    await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('blockstage-studio');r.onsuccess=()=>{const db=r.result,tx=db.transaction(['editorDocuments','editorDraftHeads','editorDrafts'],'readwrite');tx.objectStore('editorDocuments').delete(${JSON.stringify(malformed.id)});tx.objectStore('editorDraftHeads').delete(${JSON.stringify(invalidHead.id)});tx.objectStore('editorDraftHeads').delete(${JSON.stringify(corruptHead.id)});tx.objectStore('editorDrafts').delete(${JSON.stringify(corruptHead.id)});tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)};r.onerror=()=>reject(r.error)})`)
  }
  console.log(JSON.stringify({dataSafetyStep:'one recovery claim wins; invalid Saved/head/payload reported and left untouched'}))

  // Crash a renderer only after durable protection. This does not simulate power loss or disk quota.
  await upload(aria('Import editor document'), file); await until(`document.querySelector('.editor-diagnostics').dataset.blocks==='1'`)
  await rename('D07 renderer crash'); await until(phase('protected'))
  const beforeCrash = await snapshot(), crashHead = (await heads()).find(head => head.documentId === beforeCrash.id)
  assert.ok(crashHead)
  await command('Inspector.enable')
  assert.equal((await command('Page.crash')).crashed, true, 'Require a real renderer crash event, not a timed-out command')
  await command('Page.reload'); await until(ready)
  assert.notEqual((await snapshot()).id, beforeCrash.id, 'A crash must offer recovery, never apply it implicitly')
  await recovery(); await restore(crashHead.id); await until(`!document.querySelector('.documents-dialog')`)
  assert.deepEqual(await snapshot(), beforeCrash)
  assert.equal(await raw('editorDocuments', beforeCrash.id), null, 'Crash recovery must not promote an unsaved document to Saved')
  await save()
  const report = {dataSafetyResult:'passed',testedAt:new Date().toISOString(),browser:await evaluate('navigator.userAgent'),target:fixture.target,checks:['failed draft blocks switch and preserves Saved/preference','JSON escape hatch and manual retry','actual two-page stale Save retains both versions','changed-base recovery copy','two-page displayed-revision claim rejection','malformed Saved/head/payload preserved','protected draft survives renderer crash without implicit restore'],limits:['injected quota failure, not actual disk exhaustion','renderer crash after protected acknowledgement, not browser kill/power loss','portable fresh-origin and legacy upgrade covered by separate suites','not full R1 release acceptance']}
  await writeFile('artifacts/data-safety-result.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
