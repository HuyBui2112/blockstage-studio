import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Native CDP input against an isolated document and the harness's disposable origin. */
export async function runInteractionScenarios({ command, evaluate, until, click, aria, input, upload, key, screenshot, directory, profilePath }) {
  const editor = '.editor-diagnostics'
  const snapshot = () => evaluate(`JSON.parse(document.querySelector('${editor}').dataset.snapshot)`)
  const status = () => evaluate(`(()=>{const d=document.querySelector('${editor}').dataset;return {revision:Number(d.revision),history:Number(d.history)}})()`)
  const tool = name => until(`document.querySelector('canvas')?.dataset.editorTool===${JSON.stringify(name)}`)
  const focus = () => evaluate(`document.querySelector('canvas').focus()`)
  const settle = () => evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const absent = () => until(`!document.querySelector('.primitive-action-panel')`)
  const preview = () => evaluate(`JSON.parse(document.querySelector('.primitive-action-diagnostics').dataset.snapshot)`)
  const valid = () => until(`document.querySelector('.primitive-action-diagnostics')?.dataset.valid==='true'`)
  const canonicalCells = cells => cells.map(({ pos, state }) => ({ pos, state })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  async function expectSelected(ids) {
    await until(`JSON.stringify([...JSON.parse(document.querySelector('${editor}').dataset.selection)].sort())===${JSON.stringify(JSON.stringify([...ids].sort()))}`)
  }
  async function viewAction(label) { await click('.object-view-menu summary'); await click(aria(label)) }
  async function outline(id) { await click(`.outliner-object > button[title=${JSON.stringify(id)}]`) }
  async function point(pos) {
    await settle()
    return evaluate(`(()=>{const m=JSON.parse(document.querySelector('canvas').dataset.editorCamera).projection,p=${JSON.stringify(pos)},q=[0,0,0,0];for(let r=0;r<4;r++)q[r]=m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r];const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x+(q[0]/q[3]+1)*b.width/2,y:b.y+(1-q[1]/q[3])*b.height/2}})()`)
  }
  async function mouse(type, pos, modifiers = 0) {
    await command('Input.dispatchMouseEvent', { type, ...pos, modifiers, ...(type === 'mouseMoved' ? {} : { button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }) })
  }
  async function tap(pos, modifiers = 0) {
    await mouse('mouseMoved', pos, modifiers); await mouse('mousePressed', pos, modifiers); await mouse('mouseReleased', pos, modifiers)
  }
  async function drag(start, end, modifiers = 0) {
    const before=modifiers===2?await evaluate(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`):null
    await mouse('mouseMoved', start, modifiers); await mouse('mousePressed', start, modifiers)
    if(modifiers===2)await until(`document.querySelector('.editor-workspace').dataset.regionDragging==='true'`)
    for (let step = 1; step <= 6; step++) {
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (end.x - start.x) * step / 6, y: start.y + (end.y - start.y) * step / 6, buttons: 1, modifiers })
    }
    if(modifiers===2){await settle();assert.equal(await evaluate(`getComputedStyle(document.querySelector('.primitive-action-panel')).visibility`),'hidden');assert.deepEqual(await evaluate(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`),before,'Held region must not resize the viewport');await screenshot('interaction-held-plane')}
    await mouse('mouseReleased', end, modifiers)
  }
  async function rectangle(min, max, modifiers = 0) { await drag(await point(min), await point(max), modifiers) }
  async function chooseLog() {
    await input(aria('Search resources'), 'minecraft:oak_log')
    await click('.resource-item[title="minecraft:oak_log"]'); await tool('place'); await focus()
  }
  const profile = JSON.parse(await readFile(profilePath, 'utf8'))
  const cell = (name, pos, properties = {}) => ({ pos, state: { name: `minecraft:${name}`, properties: { ...profile.blocks.find(block => block.id === `minecraft:${name}`).defaults, ...properties } } })
  const block = (id, pos) => ({ id, name: id, kind: 'block', cells: [cell('oak_log', pos)], children: [], pivot2: pos.map(value => value * 2 + 1), orientation: 0 })
  const bed = { id: 'paired-bed', name: 'Paired bed', kind: 'multiblock', cells: [cell('red_bed', [4, 0, 0], { facing: 'south', part: 'foot' }), cell('red_bed', [4, 0, 1], { facing: 'south', part: 'head' })], children: [], pivot2: [9, 1, 1], orientation: 0 }
  const fixture = { schemaVersion: 2, id: 'interaction-fixture', name: 'Unified interaction acceptance', workspace: 'architecture', target: { gameVersion: '26.2', dataVersion: 4903 }, entities: [], objects: [
    block('back', [0, 0, 0]), block('front', [0, 0, 3]),
    { id: 'whole-bed', name: 'Whole bed group', kind: 'group', cells: [], children: [bed], pivot2: [9, 1, 1], orientation: 0 },
    block('shift-add', [6, 0, 0]), block('depth-obstacle', [2, 2, 6]), block('hidden', [8, 0, 0]), block('locked', [10, 0, 0]),
  ] }

  await command('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  await click(aria('Architecture workspace'))
  await until(`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`)
  for (const [panel, label] of [['.editor-library', 'Toggle editor library'], ['.editor-inspector', 'Toggle editor inspector']]) {
    if (!await evaluate(`!!document.querySelector(${JSON.stringify(panel)})`)) await click(aria(label))
  }
  await click('.editor-library-tabs > button:first-child')
  await input(aria('Search resources'), '')
  const file = join(directory, 'interaction-fixture.json')
  await writeFile(file, JSON.stringify(fixture)); await upload(aria('Import editor document'), file)
  await until(`document.querySelector('[aria-label="Document name"]').value==='Unified interaction acceptance'`)
  await tool('select')
  await outline('hidden'); await viewAction('Hide selected')
  await outline('locked'); await viewAction('Lock selected')
  const original = await snapshot(), initial = await status()

  // The regular Select tool supports through rectangles; no Box/B activation.
  await focus(); await key('KeyQ', 'q'); await tool('select')
  await key('KeyA', 'a', 2); await expectSelected(['back', 'front', 'whole-bed', 'shift-add', 'depth-obstacle'])
  await key('KeyA', 'a', 1); await expectSelected([])
  await key('KeyA', 'a', 4); await expectSelected(['back', 'front', 'whole-bed', 'shift-add', 'depth-obstacle'])
  await key('KeyA', 'a', 1); await expectSelected([])
  await click(aria('Editor Z view')); await click(aria('Frame editor scene'))
  await rectangle([-.2, -.2, 0], [1.2, 1.2, 0])
  await expectSelected(['back', 'front'])
  await rectangle([3.8, -.2, 0], [5.2, 1.2, 0])
  await expectSelected(['whole-bed'])
  await rectangle([5.8, -.2, 0], [7.2, 1.2, 0], 8)
  await expectSelected(['whole-bed', 'shift-add'])
  await tap(await point([4.5, .5, 1.5]), 8)
  await expectSelected(['shift-add'])
  assert.deepEqual(await snapshot(), original); assert.deepEqual(await status(), initial)

  // Q/E preserve the last chosen palette; R still rotates its ghost in Place.
  await chooseLog()
  await mouse('mouseMoved', await point([.5, .5, 3.5]))
  await until(`document.querySelector('.editor-placement-diagnostics').dataset.valid==='true'`)
  const turns = await evaluate(`Number(document.querySelector('.editor-workspace').dataset.placementTurns)`)
  await key('KeyR', 'r'); await tool('place')
  await until(`Number(document.querySelector('.editor-workspace').dataset.placementTurns)===${(turns + 1) % 4}`)
  assert.equal(await evaluate(`!!document.querySelector('.transform-hud')`), false)
  await key('KeyQ', 'q'); await tool('select')
  await key('KeyE', 'e'); await tool('place')
  assert.equal(await evaluate(`document.querySelector('.editor-inspector .block-id').textContent`), 'minecraft:oak_log')
  await tap(await point([.5, .5, 3.5]), 1)
  await tool('select'); await expectSelected(['front'])
  assert.deepEqual(await snapshot(), original, 'Alt+Place click selects a cell without placing')

  // G switches parent tool and enters a modal; an empty selection only changes tool.
  await key('KeyE', 'e'); await tool('place'); await key('KeyG', 'g'); await tool('move')
  await until(`document.querySelector('.transform-hud')`)
  await key('KeyX', 'x'); await key('Digit1', '1')
  await until(`document.querySelector('.transform-hud.valid')`)
  assert.deepEqual(await snapshot(), original)
  await key('Escape', 'Escape'); await until(`!document.querySelector('.transform-hud')`)
  await key('KeyR', 'r'); await tool('rotate'); await until(`document.querySelector('.transform-hud')`)
  await key('Escape', 'Escape'); await until(`!document.querySelector('.transform-hud')`)
  await key('KeyA', 'a', 1); await expectSelected([])
  await key('KeyE', 'e'); await tool('place'); await key('KeyG', 'g'); await tool('move')
  assert.equal(await evaluate(`!!document.querySelector('.transform-hud')`), false)
  assert.equal(await evaluate(`document.querySelector('.editor-feedback')?.textContent??''`), '', 'G without a selection must not warn')
  assert.deepEqual(await status(), initial)

  // Keyboard routing must leave text selection and typed shortcut letters native.
  await evaluate(`(()=>{const e=document.querySelector('[aria-label="Search resources"]');e.focus();e.setSelectionRange(3,3)})()`)
  for (const type of ['keyDown', 'keyUp']) await command('Input.dispatchKeyEvent', { type, code: 'KeyA', key: 'a', modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 })
  assert.equal(await evaluate(`(()=>{const e=document.activeElement;return e.selectionEnd-e.selectionStart===e.value.length})()`), true)
  for (const [code, value] of [['KeyQ', 'q'], ['KeyE', 'e'], ['KeyG', 'g'], ['KeyR', 'r'], ['KeyA', 'a']]) {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', code, key: value, text: value })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', code, key: value })
  }
  assert.equal(await evaluate(`document.querySelector('[aria-label="Search resources"]').value`), 'qegra')
  await tool('move'); await expectSelected([])
  assert.equal(await evaluate(`!!document.querySelector('.transform-hud')`), false)
  await chooseLog()

  // Drag from a real vertical block face. The endpoint is in front of a different
  // depth object, so surface re-picking would produce z=7 instead of fixed z=4.
  await click(aria('Editor Z view')); await click(aria('Frame editor scene'))
  const beforePlane = await status()
  await drag(await point([.5, .5, 4]), await point([2.5, 2.5, 4]), 2)
  await valid()
  assert.equal(await evaluate(`!!document.querySelector('.primitive-action-panel')`), true, 'Release retains an explicit Plane preview')
  let candidate = await preview()
  assert.equal(candidate.kind, 'plane'); assert.equal(candidate.cells.length, 9)
  assert.deepEqual([...new Set(candidate.cells.map(cell => cell.pos[2]))], [4], 'Drag remains on the initial XY placement face')
  assert.deepEqual(await snapshot(), original); assert.deepEqual(await status(), beforePlane)
  await until(`Number(document.querySelector('canvas').dataset.editorGhostTexturedMaterials)>0`)
  assert.equal(await evaluate(`Number(document.querySelector('canvas').dataset.editorGhostCells)`), 9)
  assert.ok(await evaluate(`document.querySelector('canvas').dataset.editorGhostOpacity.split(',').every(value=>Number(value)>0&&Number(value)<1)`), 'Ghost retains translucent textured materials')
  await screenshot('interaction-face-plane-ghost')
  await focus(); await key('Enter', 'Enter'); await absent()
  let committed = await snapshot()
  assert.deepEqual(canonicalCells(committed.cells.filter(cell => !original.cells.some(prior => JSON.stringify(prior.pos) === JSON.stringify(cell.pos)))), canonicalCells(candidate.cells))
  assert.equal((await status()).history, beforePlane.history + 1)
  await click(aria('Undo editor')); await until(`document.querySelector('${editor}').dataset.blocks==='8'`)
  assert.deepEqual(await snapshot(), original, 'One Undo removes the entire dragged plane')
  await click(aria('Redo editor')); await until(`document.querySelector('${editor}').dataset.blocks==='17'`)
  assert.deepEqual(await snapshot(), committed)
  await click(aria('Undo editor')); await until(`document.querySelector('${editor}').dataset.blocks==='8'`)

  // A top face uses XZ and Escape preserves both the document and undo stack.
  await chooseLog(); await click(aria('Editor Y view')); await click(aria('Frame editor scene'))
  const beforeCancel = await status()
  await drag(await point([.5, 1, 3.5]), await point([2.5, 1, 5.5]), 2)
  await valid(); candidate = await preview()
  assert.equal(candidate.cells.length, 9)
  assert.deepEqual([...new Set(candidate.cells.map(cell => cell.pos[1]))], [1])
  await focus(); await key('Escape', 'Escape'); await absent()
  assert.deepEqual(await snapshot(), original); assert.deepEqual(await status(), beforeCancel)

  // Complete logical pairs are repeated as units. A later region intersecting
  // an existing pair is rejected atomically instead of dropping occupied cells.
  await input(aria('Search resources'),'minecraft:red_bed')
  await click('.resource-item[title="minecraft:red_bed"]');await tool('place')
  await input(aria('State facing'),'south')
  await click(aria('Editor Z view'));await click(aria('Frame editor scene'))
  const beforeBeds=await status()
  await drag(await point([.5,.5,4]),await point([2.5,.5,4]),2)
  await valid();candidate=await preview()
  assert.equal(candidate.cells.length,6)
  assert.equal(candidate.cells.filter(cell=>cell.state.properties.part==='head').length,3)
  assert.equal(candidate.cells.filter(cell=>cell.state.properties.part==='foot').length,3)
  await focus();await key('Enter','Enter');await absent()
  committed=await snapshot()
  assert.equal(committed.objects.filter(object=>object.kind==='multiblock').length,3)
  assert.equal((await status()).history,beforeBeds.history+1)
  await click(aria('Undo editor'));await until(`document.querySelector('${editor}').dataset.blocks==='8'`)
  assert.deepEqual(await snapshot(),original)
  await key('Escape','Escape');await chooseLog()
  await click(aria('Editor Z view'));await click(aria('Frame editor scene'))
  const invalidBefore=await status()
  await drag(await point([6.5,.5,1]),await point([4.5,.5,1]),2)
  await until(`document.querySelector('.primitive-action-panel .copy-action-error')`)
  assert.equal(await evaluate(`document.querySelector('[aria-label="Confirm primitive action"]').disabled`),true)
  await focus();await key('Enter','Enter')
  assert.deepEqual(await snapshot(),original);assert.deepEqual(await status(),invalidBefore)
  await key('Escape','Escape');await absent()

  // Compact mode must keep the camera and panels stable until release.
  await command('Emulation.setDeviceMetricsOverride',{width:900,height:800,deviceScaleFactor:1,mobile:false})
  await focus();await key('KeyE','e');await tool('place')
  await click(aria('Editor Y view'));await click(aria('Frame editor scene'))
  await drag(await point([.5,1,3.5]),await point([1.5,1,4.5]),2)
  await valid();await screenshot('interaction-plane-compact')
  assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)
  assert.ok(await evaluate(`document.querySelector('canvas').getBoundingClientRect().width>innerWidth*.9`),'Compact preview must use the space released by hidden sidebars')
  await focus();await key('Escape','Escape');await absent()
  assert.deepEqual(await snapshot(),original)
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await screenshot('interaction-select-desktop')
  console.log(JSON.stringify({ interactionResult: 'passed', environment: 'native Chromium CDP / isolated profile / imported 26.2 assets / SwiftShader', checks: ['default Select', 'Q Select / E last palette', 'Ctrl and Meta+A eligible roots / Alt+A clear', 'Select through rectangle and whole paired group', 'Shift rectangle add / click toggle', 'Alt Place cell selection', 'G parent Move and empty selection', 'Place R yaw / non-Place R rotate', 'native textfield shortcuts', 'fixed vertical XY and top XZ Ctrl drags', 'release preview / exact Enter candidate / one Undo / Redo / Escape', 'translucent textured ghost screenshot'] }))
}
