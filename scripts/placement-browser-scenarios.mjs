import assert from 'node:assert/strict'
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** Real ray hits and keyboard input, not calls into editor functions. */
export async function runPlacementScenarios({ command, evaluate, until, click, aria, input, upload, key, screenshot, directory, profilePath }) {
  await command('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  if (!await evaluate(`Boolean(document.querySelector('.editor-library'))`)) await click(aria('Toggle editor library'))
  if (!await evaluate(`Boolean(document.querySelector('.editor-inspector'))`)) await click(aria('Toggle editor inspector'))
  const profile = JSON.parse(await readFile(profilePath, 'utf8'))
  const cell = (name, pos, properties = {}) => ({ pos, state: { name: `minecraft:${name}`, properties: { ...profile.blocks.find(block => block.id === `minecraft:${name}`).defaults, ...properties } } })
  const object = (id, cells, kind = cells.length > 1 ? 'multiblock' : 'block') => ({ id, name: id, kind, cells, children: [], pivot2: cells[0].pos.map(value => value * 2 + 1), orientation: 0 })
  const doc = (name, objects) => ({ schemaVersion: 2, id: name.toLowerCase().replaceAll(' ', '-'), name, workspace: 'component', target: { gameVersion: '26.2', dataVersion: 4903 }, objects, entities: [] })
  const snapshot = () => evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot)`)
  const history = () => evaluate(`document.querySelector('.editor-diagnostics').dataset.history`)
  const ghost = () => evaluate(`JSON.parse(document.querySelector('.editor-placement-diagnostics').dataset.snapshot)`)
  const focus = () => evaluate(`document.querySelector('canvas').focus()`)
  async function importDocument(document) {
    const file = join(directory, `${document.id}.json`)
    await writeFile(file, JSON.stringify(document))
    await upload(aria('Import editor document'), file)
    await until(`document.querySelector('[aria-label="Document name"]').value === ${JSON.stringify(document.name)}`)
    await click(aria('Frame editor scene'))
  }
  async function palette(name) {
    await click('.editor-library-tabs button:first-child')
    await input(aria('Search resources'), `minecraft:${name}`)
    await click(`.resource-item[title="minecraft:${name}"]`)
  }
  async function point(world) {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    return evaluate(`(() => {const m=JSON.parse(document.querySelector('canvas').dataset.editorCamera).projection,p=${JSON.stringify(world)},q=[0,0,0,0];for(let r=0;r<4;r++)q[r]=m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r];const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x+(q[0]/q[3]+1)*b.width/2,y:b.y+(1-q[1]/q[3])*b.height/2};})()`)
  }
  async function hover(world) {
    const position = await point(world)
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position })
    await until(`document.querySelector('.editor-placement-diagnostics').dataset.snapshot !== ''`)
    return position
  }
  async function press(position, modifiers = 0) {
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', buttons: 1, clickCount: 1, modifiers })
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', clickCount: 1, modifiers })
  }
  // Select the occupied cell even where the thin model has no triangles.
  const selectionFixture = doc('Thin block selection fixture', [
    object('near-chain', [cell('iron_chain', [0, 0, 1], { axis: 'y' })]),
    object('far-stone', [cell('stone', [0, 0, 0])]),
    object('side-lantern', [cell('lantern', [2, 0, 1])]),
  ])
  await importDocument(selectionFixture)
  await click(aria('Select tool'))
  await click(aria('Editor Z view'))
  const selectionBefore = await snapshot(), selectionHistory = await history()
  const selected = () => evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.selection)`)
  async function selectAt(world, expected, modifiers = 0) {
    const position = await point(world)
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position, modifiers })
    await press(position, modifiers)
    await until(`document.querySelector('.editor-diagnostics').dataset.selection === ${JSON.stringify(JSON.stringify(expected))}`)
    assert.deepEqual(await selected(), expected)
  }
  await selectAt([.15, .75, 2], ['near-chain'])
  await selectAt([2.1, .9, 2], ['near-chain', 'side-lantern'], 8)
  await selectAt([1.5, .75, 2], [])
  await focus(); await key('Numpad1', '1', 2)
  await selectAt([.15, .75, 0], ['far-stone'])
  await click(aria('Editor Z view'))
  await focus()
  for (let step = 0; step < 3; step++) await key('NumpadSubtract', '-')
  await selectAt([.15, .75, 2], ['near-chain'])
  await click(aria('Editor projection'))
  await selectAt([.15, .75, 2], ['near-chain'])
  assert.deepEqual(await snapshot(), selectionBefore, 'Selection and view changes must not mutate the document')
  assert.equal(await history(), selectionHistory)
  await screenshot('editor-thin-cell-selection')

  // Chain placement uses its cell face so the empty part of the underside is a stable target.
  const lanternFixture = doc('Chain lantern placement fixture', [object('chain', [cell('iron_chain', [0, 2, 0], { axis: 'y' })])])
  for (const name of ['lantern', 'soul_lantern']) {
    await importDocument({ ...lanternFixture, id: 'chain-' + name, name: 'Chain placement ' + name })
    await palette(name)
    await input(aria('Placement mode'), 'context')
    // Deliberately start with the opposite palette state: Context must derive it.
    await input(aria('State hanging'), 'false')
    await focus(); await key('Numpad7', '7', 2)
    const before = await snapshot(), beforeHistory = await history()
    const position = await hover([.15, 2, .15]), candidate = await ghost()
    assert.deepEqual(candidate.cells[0].pos, [0, 1, 0], 'Empty chain underside must target the adjacent cell, never the grid or chain cell')
    assert.equal(candidate.cells[0].state.properties.hanging, 'true')
    assert.equal(await evaluate(`document.querySelector('.editor-placement-diagnostics').dataset.valid`), 'true')
    assert.deepEqual(await snapshot(), before)
    assert.equal(await history(), beforeHistory)
    await press(position)
    await until(`document.querySelector('.editor-diagnostics').dataset.blocks === '2'`)
    const committed = await snapshot()
    assert.deepEqual(committed.cells.filter(entry => entry.state.name === `minecraft:${name}`).map(({ pos, state }) => ({ pos, state })), candidate.cells)
    assert.deepEqual(committed.cells.find(entry => entry.state.name === 'minecraft:iron_chain'), before.cells[0], 'Placing a lantern must preserve its chain')
    assert.equal(Number(await history()), Number(beforeHistory) + 1)
    // Review attachment from the side, rather than hiding the chain behind the lamp in bottom view.
    await click(aria('Editor Z view'))
    await click(aria('Frame editor scene'))
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
    await screenshot(`editor-chain-${name}-hanging`)
    await click(aria('Undo editor'))
    await until(`document.querySelector('.editor-diagnostics').dataset.blocks === '1'`)
    assert.deepEqual((await snapshot()).cells, before.cells)
    await click(aria('Redo editor'))
    await until(`document.querySelector('.editor-diagnostics').dataset.blocks === '2'`)
    assert.deepEqual((await snapshot()).cells, committed.cells)
    await click(aria('Undo editor'))
    await until(`document.querySelector('.editor-diagnostics').dataset.blocks === '1'`)
    await input(aria('State hanging'), 'true')
    await click(aria('Editor Y view'))
    await hover([.15, 3, .15])
    const standing = await ghost()
    assert.deepEqual(standing.cells[0].pos, [0, 3, 0])
    assert.equal(standing.cells[0].state.properties.hanging, 'false', 'Top chain face must resolve standing independently of the palette state')
  }
  // Playback smoke plus reviewable appearance evidence; exact sprite cropping is covered by renderer tests.
  await importDocument(doc('Animated block appearance fixture', [
    object('standing-lantern', [cell('lantern', [0, 0, 0], { hanging: 'false' })]),
    object('hanging-lantern', [cell('lantern', [2, 0, 0], { hanging: 'true' })]),
    object('standing-soul-lantern', [cell('soul_lantern', [4, 0, 0], { hanging: 'false' })]),
    object('hanging-soul-lantern', [cell('soul_lantern', [6, 0, 0], { hanging: 'true' })]),
    object('lit-campfire', [cell('campfire', [0, 0, 2], { lit: 'true' })]),
    object('unlit-campfire', [cell('campfire', [2, 0, 2], { lit: 'false' })]),
    object('lit-soul-campfire', [cell('soul_campfire', [4, 0, 2], { lit: 'true' })]),
    object('unlit-soul-campfire', [cell('soul_campfire', [6, 0, 2], { lit: 'false' })]),
  ]))
  await click(aria('Select tool'))
  await click(aria('Editor Z view'))
  await focus(); await key('Numpad8', '8'); await key('Numpad6', '6')
  await click(aria('Frame editor scene'))
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
  await delay(500)
  const animationBefore = await snapshot(), animationHistory = await history()
  const clip = await evaluate(`(() => {const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x+2,y:r.y+2,width:r.width-4,height:r.height-4,scale:1}})()`)
  const frames = new Set()
  for (let frame = 0; frame < 4; frame++) {
    frames.add((await command('Page.captureScreenshot', { format: 'png', clip })).data)
    if (frame === 0 || frame === 3) await screenshot(`editor-animated-blocks-frame-${frame}`)
    await delay(170)
  }
  assert.ok(frames.size > 1, 'Lit campfire/lantern fixture must keep animating with a stationary camera')
  assert.deepEqual(await snapshot(), animationBefore)
  assert.equal(await history(), animationHistory)
  const fixture = doc('Context placement fixture', [object('support', [cell('stone', [0, 0, 0])])])
  await importDocument(fixture)
  await palette('oak_log')
  await input(aria('Placement mode'), 'context')
  for (const [view, world, axis] of [['X', [1, .5, .5], 'x'], ['Y', [.5, 1, .5], 'y'], ['Z', [.5, .5, 0], 'z']]) {
    await click(aria(`Editor ${view} view`))
    const before = await snapshot(), beforeHistory = await history(), position = await hover(world)
    const candidate = await ghost()
    assert.equal(candidate.cells[0].state.properties.axis, axis, 'Context log axis must use the actual clicked face')
    assert.deepEqual(await snapshot(), before)
    assert.equal(await history(), beforeHistory)
    await press(position)
    await until(`document.querySelector('.editor-diagnostics').dataset.blocks === '2'`)
    assert.deepEqual((await snapshot()).cells.filter(entry => entry.state.name === 'minecraft:oak_log').map(({ pos, state }) => ({ pos, state })), candidate.cells)
    await click(aria('Undo editor'))
    await until(`document.querySelector('.editor-diagnostics').dataset.blocks === '1'`)
  }
  await palette('stone_brick_slab')
  await click(aria('Editor X view'))
  for (const [height, type] of [[.75, 'top'], [.25, 'bottom']]) {
    const position = await hover([1, height, .5]), candidate = await ghost()
    assert.equal(candidate.cells[0].state.properties.type, type, 'Side click height must set slab half')
    await press(position)
    await until(`document.querySelector('.editor-diagnostics').dataset.blocks === '2'`)
    assert.deepEqual((await snapshot()).cells.filter(entry => entry.state.name.endsWith('_slab')).map(({ pos, state }) => ({ pos, state })), candidate.cells)
    await click(aria('Undo editor'))
    await until(`document.querySelector('.editor-diagnostics').dataset.blocks === '1'`)
  }
  await palette('oak_stairs')
  await click(aria('Editor Z view'))
  await hover([.5, .75, 0])
  let candidate = await ghost()
  assert.equal(candidate.cells[0].state.properties.half, 'top')
  assert.equal(candidate.cells[0].state.properties.facing, 'north')
  const beforeYaw = await snapshot(), beforeYawHistory = await history()
  await focus(); await key('KeyR', 'r')
  await until(`document.querySelector('.editor-workspace').dataset.placementTurns === '1'`)
  assert.equal((await ghost()).cells[0].state.properties.facing, 'east')
  assert.deepEqual(await snapshot(), beforeYaw)
  assert.equal(await history(), beforeYawHistory)
  await screenshot('editor-context-placement')
  await key('Escape', 'Escape')
  await until(`document.querySelector('canvas').dataset.editorTool === 'select'`)
  assert.equal(await history(), beforeYawHistory)
  // Unsupported context preserves the palette state with an honest detail.
  await palette('glass'); await hover([.5, .75, 0])
  assert.ok((await ghost()).notes.some(note => /No verified Context/.test(note)))
  await input(aria('Placement mode'), 'design')
  await palette('oak_log'); await input(aria('State axis'), 'z')
  await click(aria('Editor X view')); await hover([1, .5, .5])
  assert.equal((await ghost()).cells[0].state.properties.axis, 'z', 'Design must retain explicit state independently of clicked face')

  const component = { schemaVersion: 1, id: 'yaw-bed-source', name: 'Yaw bed', objects: [object('bed', [cell('red_bed', [0, 0, 1], { part: 'foot', facing: 'north' }), cell('red_bed', [0, 0, 0], { part: 'head', facing: 'north' })])], pivot2: [1, 1, 2], size: [1, 1, 2], orientation: 0 }
  const componentPath = join(directory, 'yaw-bed.component.json')
  await writeFile(componentPath, JSON.stringify(component))
  await click('.editor-library-tabs button:nth-child(2)')
  await upload(aria('Import component JSON'), componentPath)
  await until(`Array.from(document.querySelectorAll('.component-asset-main')).some(button=>button.textContent.includes('Yaw bed'))`)
  await evaluate(`Array.from(document.querySelectorAll('.component-asset-main')).find(button=>button.textContent.includes('Yaw bed')).click()`)
  await click(aria('Editor Y view'))
  const position = await hover([.5, 1, .5]), beforeComponent = await snapshot(), componentHistory = await history()
  await focus(); await key('KeyR', 'r')
  await until(`document.querySelector('.editor-workspace').dataset.placementTurns === '1'`)
  candidate = await ghost()
  assert.equal(candidate.cells.length, 2)
  assert.ok(candidate.cells.every(entry => entry.state.properties.facing === 'east'))
  assert.equal(Math.max(...candidate.cells.map(entry => entry.pos[0])) - Math.min(...candidate.cells.map(entry => entry.pos[0])), 1)
  assert.equal(new Set(candidate.cells.map(entry => entry.pos[2])).size, 1)
  assert.deepEqual(await snapshot(), beforeComponent)
  assert.equal(await history(), componentHistory)
  await press(position)
  await until(`document.querySelector('.editor-diagnostics').dataset.blocks === '3'`)
  assert.deepEqual((await snapshot()).cells.filter(entry => entry.state.name === 'minecraft:red_bed').map(({ pos, state }) => ({ pos, state })), candidate.cells)
  await click(aria('Undo editor'))
  assert.deepEqual((await snapshot()).cells, beforeComponent.cells)
  await click(aria('Redo editor'))
  await until(`document.querySelector('.editor-diagnostics').dataset.blocks === '3'`)
  await hover([.5, 1, .5])
  // The bed top itself is picked after placement; use a direct occupied grid case in domain tests.
  await screenshot('editor-component-yaw')

  // A Context merge replaces one standalone slab root, never adds a second cell.
  await importDocument(doc('Slab merge', [object('merge-slab', [cell('stone_brick_slab', [0, 0, 0], { type: 'bottom', waterlogged: 'true' })])]))
  await palette('stone_brick_slab')
  await input(aria('Placement mode'), 'context')
  await click(aria('Editor Y view'))
  const slabBefore = await snapshot(), slabHistory = await history()
  const mergePoint = await hover([.5, .5, .5])
  const mergeGhost = await ghost()
  assert.equal(mergeGhost.cells[0].state.properties.type, 'double')
  assert.deepEqual(mergeGhost.cells[0].pos, [0, 0, 0])
  await press(mergePoint)
  await until(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot).cells[0].state.properties.type==='double'`)
  assert.equal((await snapshot()).cells.length, 1)
  assert.equal((await snapshot()).cells[0].owner, 'merge-slab')
  assert.equal((await snapshot()).cells[0].state.properties.waterlogged, 'false')
  assert.equal(Number(await history()), Number(slabHistory) + 1)
  await click(aria('Undo editor'))
  assert.deepEqual(await snapshot(), slabBefore)
  await click(aria('Redo editor'))
  assert.equal((await snapshot()).cells[0].state.properties.type, 'double')

  // Closed room, explicit upper slabs/axis/facing, complete pairs, all supported.
  const room = [], used = new Set()
  const put = (name, pos, properties) => { const k = pos.join(','); if (used.has(k)) return; used.add(k); room.push(object(`room-${k}`, [cell(name, pos, properties)])) }
  for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) put(x === 2 && z === 6 ? 'dirt' : 'stone_bricks', [x, 0, z])
  for (let y = 1; y <= 3; y++) for (let n = 0; n <= 8; n++) {
    put('oak_planks', [0, y, n]); put('oak_planks', [8, y, n]); put('oak_planks', [n, y, 8])
    if (!(n === 4 && y <= 2)) put('oak_planks', [n, y, 0])
  }
  for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) put('stone_brick_slab', [x, 4, z], { type: 'top' })
  room.push(object('room-door', [cell('oak_door', [4, 1, 0], { half: 'lower', facing: 'south', hinge: 'left', powered: 'false', open: 'false' }), cell('oak_door', [4, 2, 0], { half: 'upper', facing: 'south', hinge: 'left', powered: 'false', open: 'false' })]))
  room.push(object('room-bed', [cell('red_bed', [6, 1, 5], { part: 'foot', facing: 'north' }), cell('red_bed', [6, 1, 4], { part: 'head', facing: 'north' })]))
  room.push(object('room-flower', [cell('sunflower', [2, 1, 6], { half: 'lower' }), cell('sunflower', [2, 2, 6], { half: 'upper' })]))
  put('oak_stairs', [2, 1, 2], { facing: 'east', half: 'bottom', shape: 'straight' })
  put('oak_log', [2, 2, 2], { axis: 'x' })
  const roomDocument = doc('Placement room verification', room)
  await importDocument(roomDocument)
  await click(aria('Select tool'))
  await focus()
  for (let step = 0; step < 3; step++) await key('Numpad2', '2')
  await key('Numpad6', '6'); await key('Numpad6', '6')
  await click(aria('Editor projection'))
  await click(aria('Frame editor scene'))
  await screenshot('editor-placement-room')
  const downloads = join(directory, 'room-exports'); await mkdir(downloads)
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  await click(aria('Export Minecraft'))
  await until(`document.querySelector('[aria-label="Download Minecraft export"]') && !document.querySelector('[aria-label="Download Minecraft export"]').disabled`)
  assert.equal(await evaluate(`document.querySelector('[aria-label="Export checks"]').textContent.includes('support cell')`), false)
  async function download(extension, name) {
    await input(aria('Export format'), extension === '.zip' ? 'datapack' : 'nbt')
    await click(aria('Download Minecraft export'))
    for (let i = 0; i < 100; i++) {
      const found = (await readdir(downloads)).find(file => file.endsWith(extension))
      if (found) { await writeFile(resolve(`artifacts/${name}`), await readFile(join(downloads, found))); return }
      await delay(100)
    }
    throw new Error(`Missing room export ${extension}`)
  }
  await download('.nbt', 'placement-room.nbt'); await download('.zip', 'placement-room.zip')
  const cells = room.flatMap(entry => entry.cells)
  await writeFile(resolve('artifacts/placement-room.expected.json'), JSON.stringify({ origin: [0, 0, 0], size: [9, 5, 9], blocks: cells, entities: [] }, null, 2))
  await click(aria('Close Export Minecraft'))
  // A definite unsupported plant is diagnosed at its cell and before export, without blocking Design.
  const unsupported = doc('Support verification', [object('soil', [cell('stone', [0, 0, 0])]), object('flower', [cell('sunflower', [0, 1, 0], { half: 'lower' }), cell('sunflower', [0, 2, 0], { half: 'upper' })])])
  await importDocument(unsupported)
  await until(`document.querySelector('.support-details')`)
  await click('.support-details summary')
  assert.match(await evaluate(`document.querySelector('.support-details').textContent`), /not accepted plant soil/)
  await click(aria('Export Minecraft'))
  await until(`document.querySelector('[aria-label="Export checks"]')?.textContent.includes('not accepted plant soil')`)
  assert.equal(await evaluate(`document.querySelector('[aria-label="Download Minecraft export"]').disabled`), false, 'Support warnings must not prevent exporting designs intended for an existing world')
  await key('Escape', 'Escape')
  await evaluate(`document.querySelector('.outliner-object > button').click()`)
  await focus(); await key('Delete', 'Delete')
  await until(`document.querySelector('.support-details')?.textContent.includes('no support cell')`)
  await click(aria('Undo editor'))
  await until(`document.querySelector('.support-details')?.textContent.includes('not accepted plant soil')`)
  await palette('oak_stairs')
  await input(aria('Placement mode'), 'context')
  await command('Emulation.setDeviceMetricsOverride', { width: 620, height: 800, deviceScaleFactor: 1, mobile: false })
  await click(aria('Toggle editor library')); await click(aria('Toggle editor inspector'))
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false, 'Context toolbar must not overflow the compact editor')
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.placement-controls select,.placement-controls button')).every(element=>{const r=element.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})`), 'Placement controls must remain reachable without opening a panel')
  await screenshot('editor-placement-compact')
  console.log(JSON.stringify({ placementResult: 'passed', roomCells: cells.length, checks: ['stationary animated block playback and lit/unlit appearance captures', 'thin-cell nearest selection / Shift / empty ray / zoom / projection', 'chain underside lantern and soul lantern preview/commit/undo/redo', 'chain top standing state', 'actual face axis', 'slab hit height', 'stairs facing/half', 'Design explicit state', 'unknown adapter note', 'ghost/commit parity', 'placement yaw/cancel no history', 'component yaw and paired state', 'component undo/redo', 'located support/preflight warning', 'room NBT/ZIP downloads'] }))
}
