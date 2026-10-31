import assert from 'node:assert/strict'

/** Exercise Save acknowledgements through real UI under a native IDB write lock. */
export async function runSaveScenarios({ evaluate, until, click, aria, input, key, command }) {
  await click(aria('Architecture workspace'))
  await until(`document.querySelector('.editor-workspace')?.dataset.editorReady === 'true'`)
  const save = () => evaluate(`Array.from(document.querySelectorAll('.document-actions button')).find(button=>button.textContent.trim()==='Save').click()`)
  const rename = async name => {
    await input(aria('Document name'), name)
    await evaluate(`document.querySelector('[aria-label="Document name"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`)
    await until(`document.querySelector('[aria-label="Document name"]').defaultValue === ${JSON.stringify(name)}`)
  }
  const checkpoint = 'Save checkpoint'
  await rename(checkpoint)
  await save()
  await until(`document.querySelector('.document-saved')`)
  const id = await evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot).id`)
  await rename('Submitted snapshot')
  // Keep a real write transaction alive until released. Save is queued behind it.
  await evaluate(`new Promise((resolve,reject)=>{
    const request=indexedDB.open('blockstage-studio');request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction(['editorDocuments','editorRevisions','preferences'],'readwrite');
      window.__saveLock=true;
      const tick=()=>{const read=tx.objectStore('preferences').get('save-test-lock');read.onsuccess=()=>{if(window.__saveLock)tick()}};
      tick();tx.oncomplete=()=>db.close();tx.onerror=()=>{db.close();reject(tx.error)};resolve();
    };
  })`)
  try {
    await save()
    await rename('Edited while saving')
  } finally { await evaluate('window.__saveLock=false') }
  const persisted = await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('blockstage-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,query=db.transaction('editorDocuments').objectStore('editorDocuments').get(${JSON.stringify(id)});query.onsuccess=()=>{db.close();resolve(query.result?.name)};query.onerror=()=>reject(query.error)}})`)
  assert.equal(persisted, 'Submitted snapshot', 'Save must persist the submitted snapshot, not later edits')
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  assert.ok(await evaluate(`Boolean(document.querySelector('.document-dirty'))`), 'Edit during Save must stay Unsaved after old acknowledgement')
  await save()
  await until(`document.querySelector('.document-saved')`)
  await evaluate(`document.querySelector('canvas').focus()`)
  await key('KeyZ', 'z', 2)
  await until(`document.querySelector('.document-dirty')`)
  await key('KeyZ', 'z', 10)
  // Undo/Redo content equality is not a storage acknowledgement. Explicit Save is still required.
  assert.ok(await evaluate(`Boolean(document.querySelector('.document-dirty'))`), 'Undo/Redo must not manufacture a Saved acknowledgement')
  await save()
  await until(`document.querySelector('.document-saved')`)

  // An independent connection edits the revision, simulating a competing writer.
  await evaluate(`new Promise((resolve,reject)=>{
    const request=indexedDB.open('blockstage-studio');request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction(['editorDocuments','editorRevisions'],'readwrite');
      const revisions=tx.objectStore('editorRevisions'),documents=tx.objectStore('editorDocuments');
      const revision=revisions.get(${JSON.stringify(id)}),snapshot=documents.get(${JSON.stringify(id)});
      snapshot.onsuccess=()=>{revisions.put({...revision.result,version:revision.result.version+1});documents.put({...snapshot.result,name:'Other connection'})};
      tx.oncomplete=()=>{db.close();resolve()};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error)};
    };
  })`)
  await rename('Local edits kept')
  await save()
  await until(`document.querySelector('.editor-feedback')?.textContent.includes('another session')`)
  assert.equal(await evaluate(`document.querySelector('[aria-label="Document name"]').value`), 'Local edits kept', 'Conflicting save must retain local document')
  assert.ok(await evaluate(`Boolean(document.querySelector('.document-dirty'))`), 'Conflicting save must not show Saved')
  const previous = await evaluate('performance.timeOrigin')
  await command('Page.reload')
  await until(`performance.timeOrigin!==${previous} && document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`)
  assert.equal(await evaluate(`document.querySelector('[aria-label="Document name"]').value`), 'Other connection', 'Reload must restore winning stored snapshot')
  console.log(JSON.stringify({ saveResult: 'passed', checks: ['edit during pending Save stays dirty', 'explicit next Save', 'Undo/Redo never acknowledges IO', 'competing writer conflict preserves local edit', 'reload reads winning snapshot'] }))
}
