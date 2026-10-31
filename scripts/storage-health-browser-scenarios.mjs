import assert from 'node:assert/strict'

export async function runStorageHealthScenarios({ command,evaluate,until,click,aria,screenshot }) {
  const raw = () => evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('blockstage-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,names=Array.from(db.objectStoreNames),tx=db.transaction(names),result={};for(const name of names){const query=tx.objectStore(name).getAll();query.onsuccess=()=>{result[name]=query.result}}tx.oncomplete=()=>{db.close();resolve(result)};tx.onerror=()=>reject(tx.error)}})`)
  const open = async () => {
    await click(aria('Manage editor documents'))
    await until(`document.querySelector('.documents-content')?.getAttribute('aria-busy')==='false'`)
    await click(aria('Storage health tab'))
    await until(`document.querySelector('[aria-label="Storage health"]')?.getAttribute('aria-busy')==='false'`)
  }
  const close = () => click(aria('Close Documents'))
  const usage = () => evaluate(`document.querySelector('[aria-label="Estimated storage usage"]').textContent`)
  const retention = () => evaluate(`document.querySelector('[aria-label="Storage persistence"]').textContent`)
  await click(aria('Architecture workspace'))
  await until(`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`)
  const baseline=await raw()
  const scene=await evaluate(`document.querySelector('.editor-diagnostics').dataset.snapshot`)
  await open()
  assert.ok(await evaluate(`document.querySelector('.storage-origin').textContent===location.origin`),'Panel must identify actual storage origin')
  await close()
  await evaluate(`(()=>{
    const descriptor=Object.getOwnPropertyDescriptor(navigator,'storage');
    window.__restoreHealth=()=>{if(descriptor)Object.defineProperty(navigator,'storage',descriptor);else delete navigator.storage};
    window.__persistCalls=0;window.__healthMode='normal';window.__healthPersistent=false;
    const api={
      estimate:async()=>{if(window.__healthMode==='read-error')throw new DOMException('Estimate blocked','SecurityError');return window.__healthMode==='unknown'?{}:{usage:95*1024*1024,quota:100*1024*1024}},
      persisted:async()=>window.__healthPersistent,
      persist:()=>{window.__persistCalls++;if(window.__healthMode==='throw')throw new DOMException('Permission request blocked','SecurityError');if(window.__healthMode==='pending')return new Promise(resolve=>{window.__finishHealth=resolve});if(window.__healthMode==='deny')return Promise.resolve(false);window.__healthPersistent=true;return Promise.resolve(true)}
    };
    Object.defineProperty(navigator,'storage',{configurable:true,get:()=>window.__healthMode==='absent'?undefined:api});
  })()`)
  try {
    await open()
    assert.equal(await evaluate('window.__persistCalls'),0,'Opening Storage must never request persistence automatically')
    assert.equal(await usage(),'95 MiB')
    assert.equal(await retention(),'Best effort')
    assert.ok(await evaluate(`Boolean(document.querySelector('.storage-warning'))`),'High estimated usage must produce a bounded warning')
    await screenshot('editor-storage-health')
    await click(aria('Request persistent storage'))
    await until(`document.querySelector('.storage-request-result')?.textContent.includes('enabled')`)
    assert.equal(await evaluate('window.__persistCalls'),1)
    assert.equal(await retention(),'Persistent')
    assert.ok(await evaluate(`document.querySelector('[aria-label="Request persistent storage"]').disabled`))
    await close()

    await evaluate(`window.__healthMode='deny';window.__healthPersistent=false`)
    await open();await click(aria('Request persistent storage'))
    await until(`document.querySelector('.storage-request-result')?.textContent.includes('did not grant')`)
    assert.equal(await retention(),'Best effort')
    await close()
    await evaluate(`window.__healthMode='throw'`)
    await open();await click(aria('Request persistent storage'))
    await until(`document.querySelector('.storage-request-result')?.textContent.includes('Permission request blocked')`)
    assert.equal(await retention(),'Best effort')
    await close()

    await evaluate(`window.__healthMode='read-error'`)
    await open()
    assert.equal(await usage(),'Could not read')
    assert.equal(await retention(),'Best effort','Read failures must be independent')
    await evaluate(`window.__healthMode='unknown'`)
    await click(aria('Refresh storage health'))
    await until(`document.querySelector('[aria-label="Storage health"]').getAttribute('aria-busy')==='false'`)
    assert.equal(await usage(),'Unavailable','Refresh must not keep stale usage or invent zero')
    assert.equal(await evaluate(`document.querySelector('progress[aria-label="Estimated storage quota used"]')===null`),true)
    await close()
    await evaluate(`window.__healthMode='absent'`)
    await open()
    assert.equal(await retention(),'Unavailable')
    assert.ok(await evaluate(`document.querySelector('[aria-label="Request persistent storage"]').disabled`))
    await close()

    await evaluate(`window.__healthMode='pending'`)
    await open();await click(aria('Request persistent storage'))
    await close()
    await evaluate(`window.__finishHealth(true)`)
    await evaluate('new Promise(resolve=>setTimeout(resolve,30))')
    await evaluate(`window.__healthMode='normal'`)
    await open()
    await command('Emulation.setDeviceMetricsOverride',{width:620,height:800,deviceScaleFactor:1,mobile:false})
    assert.ok(await evaluate(`(()=>{const r=document.querySelector('.documents-dialog').getBoundingClientRect();return r.width<=innerWidth&&r.height<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()`),'Storage panel must fit compact screen')
    await screenshot('editor-storage-health-compact')
    await close()
  } finally { await evaluate(`window.__restoreHealth();delete window.__restoreHealth;delete window.__finishHealth;delete window.__healthMode;delete window.__healthPersistent;delete window.__persistCalls`) }
  assert.deepEqual(await raw(),baseline,'Storage health must not modify or delete any IndexedDB store')
  assert.equal(await evaluate(`document.querySelector('.editor-diagnostics').dataset.snapshot`),scene,'Storage health must not change the document')
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Assets workspace'))
  await until(`document.querySelector('.setup-prompt')`)
  console.log(JSON.stringify({storageHealthResult:'passed',checks:['native read-only estimate/status','explicit grant/denial/error via injected API','absent/partial estimate','refresh removes stale numbers','no auto permission request','pending request unmount safe','all IndexedDB stores unchanged','document unchanged','compact panel']}))
}
