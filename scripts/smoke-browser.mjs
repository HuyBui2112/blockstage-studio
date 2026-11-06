import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { resolve, join, sep, basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
import { strToU8, zipSync, zlibSync } from 'fflate'
import { runEditorScenarios } from './editor-browser-scenarios.mjs'
import { runAnimationPixelScenario } from './animation-browser-scenarios.mjs'
import { runRepositoryScenarios } from './repository-browser-scenarios.mjs'
import { runStorageHealthScenarios } from './storage-health-browser-scenarios.mjs'

// Reuse an installed browser and an isolated profile. No browser download or personal data.
const browser = process.env.BLOCKSTAGE_BROWSER ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync)
if (!browser) throw new Error('Set BLOCKSTAGE_BROWSER to an installed Chromium browser.')
const cache = resolve('node_modules/.cache')
await mkdir(cache, { recursive: true })
await mkdir('artifacts', { recursive: true })
const directory = await mkdtemp(join(cache, 'blockstage-browser-'))
const rendererMode=process.env.BLOCKSTAGE_RENDERER??'software'
if(!['hardware','software'].includes(rendererMode))throw new Error('BLOCKSTAGE_RENDERER must be hardware or software')
const child = spawn(browser, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  // Keep the isolated Edge process's DevTools stderr pipe across Windows startup.
  ...(process.platform==='win32'&&/msedge\.exe$/i.test(browser)?['--edge-skip-compat-layer-relaunch']:[]),
  '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
  ...(rendererMode==='software'?['--enable-unsafe-swiftshader','--use-angle=swiftshader']:['--use-angle=d3d11']),
  `--user-data-dir=${directory}`, 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })

function solidPng(red, green, blue) {
  const chunk = (type, data) => {
    const tag = Buffer.from(type), payload = Buffer.concat([tag, data])
    let crc = 0xffffffff
    for (const byte of payload) {
      crc ^= byte
      for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0)
    }
    const length = Buffer.alloc(4), sum = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, payload, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', zlibSync(new Uint8Array([0, red, green, blue, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function overlay(png, description) {
  return {
    'pack.mcmeta': strToU8(JSON.stringify({ pack: { description, min_format: [88, 0], max_format: [88, 0] } })),
    'assets/minecraft/textures/block/oak_log.png': png,
    'assets/minecraft/textures/block/oak_log_top.png': png,
  }
}

let socket
try {
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timeout = setTimeout(() => reject(new Error('No DevTools endpoint')), 20000)
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.stderr.on('data', data => {
      const match = data.toString().match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timeout); resolveEndpoint(match[1]) }
    })
  })
  socket = new WebSocket(endpoint)
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject })
  let counter = 0
  const pending = new Map(), errors = []
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Page.javascriptDialogOpening' && message.params.type === 'beforeunload') {
      void send('Page.handleJavaScriptDialog', { accept: true }, message.sessionId).catch(() => {})
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    // Page.crash intentionally has no ordinary response. Require the native crash event,
    // settle only its own request, and keep unexpected renderer crashes as test failures.
    if (message.method === 'Inspector.targetCrashed') {
      const request = [...pending.entries()].find(([, handler]) => handler.method === 'Page.crash' && handler.sessionId === message.sessionId)
      if (request) {
        const [id, handler] = request
        pending.delete(id); clearTimeout(handler.timeout); handler.resolve({ crashed: true })
      } else errors.push({ description: 'Unexpected renderer crash', sessionId: message.sessionId })
    }
    const handler = pending.get(message.id)
    if (handler) {
      pending.delete(message.id)
      clearTimeout(handler.timeout)
      if (message.error) handler.reject(new Error(`${handler.method}: ${JSON.stringify(message.error)}`))
      else handler.resolve(message.result)
    }
  }
  async function send(method, params = {}, sessionId) {
    const id = ++counter
    return new Promise((resolveResult, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30000)
      pending.set(id, { resolve: resolveResult, reject, method, timeout, sessionId })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const command = (method, params) => send(method, params, sessionId)
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).catch(error => { throw new Error(`${error.message}; expression: ${expression.slice(0, 250)}`, { cause: error }) })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  async function until(expression) {
    for (let i = 0; i < 250; i++) {
      try { if (await evaluate(`Boolean(${expression})`)) return }
      catch (error) {
        if (!/Inspected target navigated|Execution context was destroyed|Cannot find context/.test(String(error))) throw error
      }
      await delay(100)
    }
    throw new Error(`Timeout: ${expression}\n${JSON.stringify({ errors, editor: await evaluate(`(()=>{const e=document.querySelector('.editor-diagnostics'),c=document.querySelector('canvas');return {snapshot:{...e?.dataset},canvas:{...c?.dataset},feedback:document.querySelector('.editor-feedback')?.textContent}})()`), body: await evaluate('document.body.innerText.slice(-2500)') })}`)
  }
  const ready = `document.querySelector('.app-shell')?.dataset.ready === 'true' && document.querySelector('canvas')`
  async function createPeer(url=process.env.BLOCKSTAGE_URL ?? 'http://127.0.0.1:5173/') {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const peerCommand = (method, params) => send(method, params, sessionId)
    const peerEvaluate = async expression => {
      const result = await peerCommand('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const peerUntil = async expression => {
      for (let i = 0; i < 200; i++) {
        if (await peerEvaluate(`Boolean(${expression})`)) return
        await delay(100)
      }
      throw new Error(`Peer timeout: ${expression}`)
    }
    await peerCommand('Runtime.enable')
    await peerCommand('Page.enable')
    await peerCommand('Page.navigate', { url })
    await peerUntil(ready)
    return { command:peerCommand,evaluate: peerEvaluate, until: peerUntil, close: () => send('Target.closeTarget', { targetId }) }
  }
  const click = selector => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) throw new Error('Missing/enabled control: ' + ${JSON.stringify(selector)}); element.click(); })()`)
  const aria = label => `[aria-label=${JSON.stringify(label)}]`
  async function input(selector, value) {
    await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Missing input'); Object.getOwnPropertyDescriptor(element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`)
  }
  async function upload(selector, path) {
    const document = await command('DOM.getDocument')
    const node = await command('DOM.querySelector', { nodeId: document.root.nodeId, selector })
    assert.ok(node.nodeId, `Missing file input: ${selector}`)
    await command('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path] })
  }
  async function key(code, keyValue = code, modifiers = 0) {
    const native = code === 'Escape' ? { windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 } : {}
    await command('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyValue, modifiers, ...native })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyValue, modifiers, ...native })
  }
  async function canvasImage() {
    await delay(120)
    const clip = await evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x+3, y: r.y+3, width: r.width-6, height: r.height-6, scale: 1 }; })()`)
    return (await command('Page.captureScreenshot', { format: 'png', clip })).data
  }
  async function assertProjection(expected, message) {
    // React effects and the on-demand renderer apply commands on subsequent frames.
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await evaluate(`document.querySelector('canvas').dataset.projection`), expected, message)
  }
  async function screenshot(name) {
    await delay(150)
    const result = await command('Page.captureScreenshot', { format: 'png' })
    const suffix = process.env.BLOCKSTAGE_RESOURCE_PACK ? '' : '-fixture'
    await writeFile(`artifacts/${name}${suffix}.png`, Buffer.from(result.data, 'base64'))
  }
  async function manager() {
    await click('.top-actions .primary')
    await until(`document.querySelector('dialog[open]')`)
  }
  const closeManager = () => click(aria('Close Resources'))
  async function reload() {
    const previous = await evaluate('performance.timeOrigin')
    await command('Page.reload')
    await until(`performance.timeOrigin !== ${previous} && (${ready})`)
  }
  async function selectAsset(id) {
    await input(aria('Search resources'), id)
    await click(`.resource-item[title=${JSON.stringify(id)}]`)
    await until(`document.querySelector('.render-diagnostics').dataset.asset === ${JSON.stringify(id)}`)
  }

  await command('Runtime.enable')
  await command('Page.enable')
  await command('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  await command('Page.navigate', { url: process.env.BLOCKSTAGE_URL ?? 'http://127.0.0.1:5173/' })
  await until(ready)
  if (await evaluate(`Boolean(document.querySelector('[aria-label="Assets workspace"]'))`)) {
    await click(aria('Assets workspace'))
    await until(`Boolean(document.querySelector('.setup-prompt'))`)
  }
  assert.ok(await evaluate(`Boolean(document.querySelector('.setup-prompt'))`), 'A fresh workspace must explain missing assets')
  await screenshot('resource-empty')

  // A pre-existing project is a canary: resource operations must never touch its data.
  const preserved = { id: 'resource-test-preserved-project', arbitraryLegacyPayload: ['do', 'not', 'rewrite'], blocks: [{ unusual: true }] }
  // This is the disposable browser profile above, never the user's origin/profile.
  // Seed the actual old database version to exercise the additive v4 -> v7 upgrade.
  await evaluate(`new Promise((resolve,reject) => { const removal=indexedDB.deleteDatabase('blockstage-studio'); removal.onerror=()=>reject(removal.error); removal.onsuccess=()=>{ const request=indexedDB.open('blockstage-studio',4); request.onerror=()=>reject(request.error); request.onupgradeneeded=()=>{for(const name of ['projects','packs','catalogs','profiles','preferences']) request.result.createObjectStore(name,{keyPath:'id'})}; request.onsuccess=()=>{const db=request.result;const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(${JSON.stringify(preserved)});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}; }; })`)
  await reload()
  assert.equal(await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('blockstage-studio');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;resolve(db.version);db.close()}})`), 7, 'Legacy storage must upgrade without rewriting the project canary')
  const repositoryChecks = await runRepositoryScenarios({ evaluate })
  await runStorageHealthScenarios({command,evaluate,until,click,aria,screenshot})

  const orange = solidPng(222, 111, 48), blue = solidPng(51, 122, 219)
  const copperPath = join(directory, 'copper-test.zip'), bluePath = join(directory, 'blue-test.zip')
  await writeFile(copperPath, zipSync(overlay(orange, 'Orange test pixels')))
  await writeFile(bluePath, zipSync(overlay(blue, 'Blue test pixels')))
  const basePath = process.env.BLOCKSTAGE_RESOURCE_PACK ? resolve(process.env.BLOCKSTAGE_RESOURCE_PACK) : join(directory, 'base-fixture.zip')
  if (!process.env.BLOCKSTAGE_RESOURCE_PACK) {
    const faces = Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map(side => [side, { texture: '#all' }]))
    await writeFile(basePath, zipSync({
      ...overlay(solidPng(132, 119, 85), 'Synthetic base fixture'),
      'assets/minecraft/blockstates/oak_log.json': strToU8(JSON.stringify({ variants: { '': { model: 'minecraft:block/oak_log' } } })),
      'assets/minecraft/models/block/oak_log.json': strToU8(JSON.stringify({ textures: { all: 'minecraft:block/oak_log' }, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces }] })),
    }))
  }
  await manager()
  const profilePath = process.env.BLOCKSTAGE_GAME_PROFILE ?? (process.env.BLOCKSTAGE_RESOURCE_PACK && existsSync('public/generated/26.2.profile.json') ? resolve('public/generated/26.2.profile.json') : null)
  if (profilePath) {
    await upload(aria('Import game profile'), profilePath)
    await until(`document.querySelector('.profile-summary strong')?.textContent.includes('Java 26.2') && !document.querySelector('input[aria-label="Import resource pack"]').disabled`)
  }
  await upload(aria('Import resource pack'), basePath)
  await until(`document.querySelectorAll('.pack-card').length === 1 && !document.querySelector('input[aria-label="Import resource pack"]').disabled`)
  await closeManager()
  await until(`document.querySelector('.render-diagnostics').dataset.modeled === '1' && [...document.querySelectorAll('.resource-thumb img')].some(image=>image.naturalWidth>0)`)
  const capabilityStatus = action => evaluate(`document.querySelector('.capability-details [data-action=${JSON.stringify(action)}] dd')?.dataset.status`)
  assert.equal(await capabilityStatus('registry'), 'supported')
  assert.equal(await capabilityStatus('appearance'), 'supported')
  assert.equal(await capabilityStatus('context'), 'partial')
  assert.equal(await capabilityStatus('structure-export'), 'supported')
  assert.equal(await capabilityStatus('world'), 'unverified')
  await click('.capability-details summary')
  await screenshot('resource-capabilities')
  await click('.capability-details summary')
  await screenshot('resource-workspace')

  // Mouse navigation, then the same front command from keyboard and on-screen UI.
  await assertProjection('perspective', 'The initial camera projection must be perspective')
  const beforeOrbit = await canvasImage()
  const center = await evaluate(`(() => { const r=document.querySelector('canvas').getBoundingClientRect(); return {x:r.x+r.width*.5,y:r.y+r.height*.5}; })()`)
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...center, button: 'middle', buttons: 4, clickCount: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x + 110, y: center.y + 25, buttons: 4 })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x + 110, y: center.y + 25, button: 'middle' })
  assert.notEqual(await canvasImage(), beforeOrbit, 'MMB orbit must change the rendered view')
  await evaluate(`document.querySelector('canvas').focus()`)
  await key('Numpad1', '1')
  await assertProjection('orthographic', 'Numpad1 must select an orthographic front view')
  const frontKey = await canvasImage()
  await click(aria('Right view'))
  await assertProjection('orthographic', 'Selecting the right axis must stay orthographic')
  assert.notEqual(await canvasImage(), frontKey, 'Right and front camera views must differ')
  await click(aria('Right view'))
  await assertProjection('orthographic', 'Repeated right-axis selection must stay orthographic')
  await click(aria('Top view'))
  await assertProjection('orthographic', 'Selecting the top axis must stay orthographic')
  await click(aria('Top view'))
  await assertProjection('orthographic', 'Repeated top-axis selection must stay orthographic')
  await click(aria('Front view'))
  await assertProjection('orthographic', 'Selecting the front axis must stay orthographic')
  await click(aria('Front view'))
  await assertProjection('orthographic', 'Repeated front-axis selection must stay orthographic')
  assert.equal(await canvasImage(), frontKey, 'Keyboard and button must execute the same camera view')
  await click(aria('Perspective / orthographic · Numpad 5'))
  await assertProjection('perspective', 'Projection toggle must return an axis view to perspective')
  await click(aria('Front view'))
  await assertProjection('orthographic', 'Selecting an axis after toggling perspective must restore orthographic projection')
  await click(aria('Perspective / orthographic · Numpad 5'))
  await assertProjection('perspective', 'Projection toggle must switch orthographic back to perspective')
  await key('Numpad1', '1')
  await assertProjection('orthographic', 'Numpad1 must restore orthographic projection')
  assert.equal(await canvasImage(), frontKey, 'Restoring the front axis must reproduce the same rendered view')

  // State preview stays legal and retains the camera; returning to Y restores the same image.
  await input(aria('axis'), 'x')
  await until(`JSON.parse(document.querySelector('.render-diagnostics').dataset.properties).axis === 'x'`)
  await input(aria('axis'), 'y')
  assert.equal(await canvasImage(), frontKey, 'State changes must not reset the camera')
  await input(aria('Search resources'), 'G X 10')
  assert.equal(await evaluate(`document.querySelector('.render-diagnostics').dataset.asset`), 'minecraft:oak_log', 'Typing must not run viewport commands')
  await input(aria('Search resources'), '')

  // Real override pixels verify more than list ordering; document state stays unchanged.
  const stateBeforePacks = await evaluate(`document.querySelector('.render-diagnostics').dataset.properties`)
  await manager()
  await upload(aria('Import resource pack'), copperPath)
  await until(`document.querySelectorAll('.pack-card').length === 2 && !document.querySelector('input[aria-label="Import resource pack"]').disabled`)
  await closeManager()
  const orangeImage = await canvasImage()
  await manager()
  await upload(aria('Import resource pack'), bluePath)
  await until(`document.querySelectorAll('.pack-card').length === 3 && !document.querySelector('input[aria-label="Import resource pack"]').disabled`)
  await closeManager()
  const blueImage = await canvasImage()
  assert.notEqual(blueImage, orangeImage, 'Texture overrides must change actual 3D pixels')
  await manager()
  await click(aria('Move blue-test.zip down'))
  await until(`document.querySelector('.pack-card strong')?.textContent === 'copper-test.zip'`)
  await closeManager()
  assert.equal(await canvasImage(), orangeImage, 'Moving blue below orange must restore orange appearance')
  await manager()
  await click(aria('Enable copper-test.zip'))
  await until(`!document.querySelector('input[aria-label="Enable copper-test.zip"]').checked`)
  await closeManager()
  assert.equal(await canvasImage(), blueImage, 'Disabling the higher pack must reveal the next override')
  assert.equal(await evaluate(`document.querySelector('.render-diagnostics').dataset.properties`), stateBeforePacks)

  // Duplicate and invalid import recover without losing any existing pack.
  await manager()
  await upload(aria('Import resource pack'), bluePath)
  await until(`document.querySelector('.inline-error')?.textContent.includes('already been imported')`)
  assert.equal(await evaluate(`document.querySelectorAll('.pack-card').length`), 3)
  await click(aria('Dismiss import error'))
  const invalid = join(directory, 'invalid-profile.json')
  await writeFile(invalid, '{}')
  await upload(aria('Import game profile'), invalid)
  await until(`document.querySelector('.inline-error')`)
  await click(aria('Dismiss import error'))
  await screenshot('resource-manager')
  await closeManager()
  await reload()
  await manager()
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.pack-card strong')].map(item=>item.textContent)`), ['copper-test.zip', 'blue-test.zip', basename(basePath)], 'Order must survive reload')
  assert.equal(await evaluate(`document.querySelector('input[aria-label="Enable copper-test.zip"]').checked`), false, 'Enable state must survive reload')
  await click(aria('Remove blue-test.zip'))
  await until(`document.querySelectorAll('.pack-card').length === 2`)
  await closeManager()
  await reload()
  await manager()
  assert.equal(await evaluate(`document.querySelectorAll('.pack-card').length`), 2, 'Removal must survive reload')
  await closeManager()

  if (profilePath && process.env.BLOCKSTAGE_RESOURCE_PACK) {
    assert.equal(await evaluate(`document.querySelectorAll('.resource-item').length`), 60, 'Initial full registry list must be bounded')
    await click('.load-more')
    assert.equal(await evaluate(`document.querySelectorAll('.resource-item').length`), 120)
    await input(aria('Filter blocks by creative tab or tag'), 'tab:minecraft:building_blocks')
    assert.ok(await evaluate(`document.querySelectorAll('.resource-item').length > 20`), 'Creative tab must return actual registry items')
    await input(aria('Filter blocks by creative tab or tag'), '')
    await selectAsset('minecraft:oak_stairs')
    await input(aria('shape'), 'inner_left')
    await until(`document.querySelector('.render-diagnostics').dataset.modeled === '1'`)
    await screenshot('resource-stairs')
    await evaluate(`(() => { const original = window.requestAnimationFrame; window.__previewFrames = 0; window.requestAnimationFrame = callback => original.call(window, time => { window.__previewFrames++; callback(time); }); })()`)
    await selectAsset('minecraft:fire')
    const fire = await canvasImage()
    await delay(600)
    assert.notEqual(await canvasImage(), fire, 'Animated sprite must change on screen')
    await selectAsset('minecraft:oak_log')
    await delay(600)
    const frames = await evaluate('window.__previewFrames')
    await delay(350)
    assert.equal(await evaluate('window.__previewFrames'), frames, 'A static preview must stop scheduling frames after an animated asset')
    await selectAsset('minecraft:fire')
    const cachedFire = await canvasImage()
    await delay(600)
    assert.notEqual(await canvasImage(), cachedFire, 'Returning to cached animation must resume playback')
    for (const id of ['lantern','soul_lantern','campfire','soul_campfire']) {
      await selectAsset('minecraft:' + id)
      await delay(150)
      await runAnimationPixelScenario(evaluate)
    }
    for(const id of ['black_banner','black_wall_banner','conduit']){
      await selectAsset('minecraft:'+id)
      await until(`document.querySelector('.render-diagnostics').dataset.modeled === '1' && document.querySelector('.render-diagnostics').dataset.fallback === '0'`)
      assert.ok(await evaluate(`document.querySelector('.render-support').textContent.includes('Static partial model')`))
      assert.equal(await capabilityStatus('appearance'), 'partial')
      assert.equal(await capabilityStatus('payload-edit'), 'unsupported')
      assert.equal(await capabilityStatus('structure-export'), 'unsupported')
      assert.equal(await evaluate(`document.querySelector('.viewport-diagnostics')?.textContent.includes('không có elements')`),false)
      await screenshot('resource-special-'+id)
      if(id==='black_banner'){
        await input(aria('rotation'),'0');const front=await canvasImage();await input(aria('rotation'),'4');assert.notEqual(await canvasImage(),front,'Banner yaw must update its baked geometry')
      }
    }
    await selectAsset('minecraft:shulker_box')
    await until(`document.querySelector('.render-diagnostics').dataset.fallback === '1' && document.querySelector('.viewport-diagnostics')`)
    await click('.resource-tabs button:nth-child(2)')
    await input(aria('Search resources'), 'minecraft:pig')
    await click('.resource-item')
    await until(`document.querySelector('.render-diagnostics').dataset.entities === '1' && document.querySelector('.render-support')?.dataset.status === 'partial'`)
    assert.equal(await capabilityStatus('design'), 'supported')
    assert.equal(await capabilityStatus('structure-export'), 'supported')
    assert.equal(await capabilityStatus('structure-import'), 'unsupported')
    assert.equal(await capabilityStatus('world'), 'unverified')
    await input(aria('Entity yaw'), '90')
    await screenshot('resource-entity')
    for (const [id, exported] of [['minecraft:cow', 'supported'], ['minecraft:slime', 'unsupported']]) {
      await input(aria('Search resources'), id)
      await click('.resource-item')
      await until(`document.querySelector('.render-diagnostics').dataset.entities === '1'`)
      assert.equal(await capabilityStatus('appearance'), 'partial')
      assert.equal(await capabilityStatus('design'), 'unsupported')
      assert.equal(await capabilityStatus('structure-export'), exported)
    }
    const bounded = await evaluate(`document.querySelectorAll('.resource-item').length`)
    assert.ok(bounded <= 60, 'Browser list must remain bounded')
  }

  await click(aria('Navigation help'))
  await until(`document.querySelector('dialog[open] h2')?.textContent === 'Navigation help'`)
  await key('Escape', 'Escape')
  await until(`!document.querySelector('dialog[open]')`)
  await command('Emulation.setDeviceMetricsOverride', { width: 620, height: 800, deviceScaleFactor: 1, mobile: false })
  await reload()
  await click(aria('Toggle asset library'))
  await until(`document.querySelector('.library')`)
  assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false, 'Compact layout must not overflow horizontally')
  await screenshot('resource-compact')
  await click(aria('Toggle asset library'))
  await click(aria('Toggle inspector'))
  await until(`document.querySelector('.inspector') && getComputedStyle(document.querySelector('.inspector')).display !== 'none'`)
  await click('.capability-details summary')
  assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false, 'Expanded capabilities must fit the compact inspector')
  await screenshot('resource-capabilities-compact')
  await click('.capability-details summary')

  const actualProject = await evaluate(`new Promise((resolve,reject) => { const request=indexedDB.open('blockstage-studio'); request.onerror=()=>reject(request.error); request.onsuccess=()=>{ const db=request.result; const query=db.transaction('projects').objectStore('projects').get(${JSON.stringify(preserved.id)}); query.onsuccess=()=>{db.close();resolve(query.result)}; query.onerror=()=>reject(query.error); }; })`)
  assert.deepEqual(actualProject, preserved, 'Resource workflow must not rewrite existing projects')
  if (profilePath && process.env.BLOCKSTAGE_RESOURCE_PACK) {
    await runEditorScenarios({ command, evaluate, until, click, aria, input, upload, key, screenshot, directory, profilePath, closeManager, createPeer })
  }
  if(new URL(process.env.BLOCKSTAGE_URL??'http://127.0.0.1:5173/').searchParams.get('measure')!=='1'){
    assert.equal(await evaluate(`'editorMeasurement' in document.querySelector('canvas').dataset`),false,'Normal editor must not enable measurement telemetry')
    assert.equal(await evaluate(`Object.hasOwn(globalThis,'__blockstagePhaseRead')`),false,'Normal editor must not expose phase collection')
  }
  assert.deepEqual(errors, [], 'Browser must have no runtime exceptions')
  console.log(JSON.stringify({
    result: 'passed', resourcePack: basename(basePath), gameProfile: profilePath, repositoryChecks,
    checks: ['empty workspace', 'v4 to v7 additive storage upgrade', 'worker import', 'actual textured 3D', 'MMB orbit', 'axis views stay orthographic', 'projection toggle', 'keyboard/button camera parity', 'legal state/camera retention', 'input focus', 'pixel-verified precedence/toggle', 'duplicate/invalid recovery', 'order/toggle/removal persistence', 'dialog keyboard', 'compact layout', 'existing project preservation', ...(profilePath && process.env.BLOCKSTAGE_RESOURCE_PACK ? ['bounded library/creative tabs', 'stairs state', 'animation cache and idle frame stop', 'unsupported fallback', 'static entity/yaw'] : [])],
    screenshots: ['resource-workspace', 'resource-manager', 'resource-compact'],
  }, null, 2))
  await send('Browser.close')
} finally {
  socket?.close()
  child.kill()
  await delay(500)
  const target = resolve(directory)
  if (target.startsWith(cache + sep) && basename(target).startsWith('blockstage-browser-')) {
    await rm(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }).catch(() => {})
  }
}
