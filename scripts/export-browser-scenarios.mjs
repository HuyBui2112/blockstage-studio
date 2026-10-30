import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { gunzipSync, unzipSync, strFromU8 } from 'fflate'

// Independent, bounded reader for the structure tags produced by the browser.
function readStructure(compressed) {
  const bytes = gunzipSync(compressed), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let cursor = 0
  const byte = () => view.getUint8(cursor++)
  const integer = () => { const value = view.getInt32(cursor); cursor += 4; return value }
  const text = () => { const size = view.getUint16(cursor); cursor += 2; const value = strFromU8(bytes.subarray(cursor, cursor + size)); cursor += size; return value }
  function tag(type) {
    if (type === 3) return integer()
    if (type === 5 || type === 6) { const value = type === 5 ? view.getFloat32(cursor) : view.getFloat64(cursor); cursor += type === 5 ? 4 : 8; return value }
    if (type === 8) return text()
    if (type === 9) { const item = byte(), size = integer(); assert.ok(size >= 0 && size <= 110592); return Array.from({ length: size }, () => tag(item)) }
    if (type === 10) { const value = {}; for (let child = byte(); child !== 0; child = byte()) { const name = text(); value[name] = tag(child) } return value }
    throw new Error(`Unsupported structure tag ${type}`)
  }
  assert.equal(byte(), 10); assert.equal(text(), '')
  const result = tag(10)
  assert.equal(cursor, bytes.length)
  return result
}

export async function runExportScenarios({ command, evaluate, until, click, aria, input, upload, key, screenshot, directory, profilePath }) {
  const profile = JSON.parse(await readFile(profilePath, 'utf8'))
  const cell = (name, pos, properties = {}) => ({ pos, state: { name: `minecraft:${name}`, properties: { ...profile.blocks.find(block => block.id === `minecraft:${name}`).defaults, ...properties } } })
  const object = (id, cells, kind = cells.length > 1 ? 'multiblock' : 'block') => ({ id, name: id, kind, cells, children: [], pivot2: cells[0].pos.map(value => value * 2 + 1), orientation: 0 })
  const editor = '.editor-diagnostics'
  const snapshot = () => evaluate(`JSON.parse(document.querySelector('${editor}').dataset.snapshot)`)
  const history = () => evaluate(`document.querySelector('${editor}').dataset.history`)
  const importDocument = async document => {
    const path = join(directory, `${document.id}.json`)
    await writeFile(path, JSON.stringify(document))
    await upload(aria('Import editor document'), path)
    await until(`document.querySelector('[aria-label="Document name"]').value === ${JSON.stringify(document.name)}`)
  }
  const base = { schemaVersion: 2, id: 'export-blocked-fixture', name: 'Unsupported export', workspace: 'component', target: { gameVersion: '26.2', dataVersion: 4903 }, entities: [], objects: [object('chest', [cell('chest', [0, 0, 0])])] }
  await importDocument(base)
  await click(aria('Export Minecraft'))
  await until(`document.querySelector('dialog[open]') && document.querySelector('[aria-label="Download Minecraft export"]')?.disabled`)
  assert.match(await evaluate(`document.querySelector('dialog[open]').textContent`), /block.entity/i)
  await screenshot('editor-export-blocked')
  await key('Escape', 'Escape')
  await until(`!document.querySelector('dialog[open]')`)

  const floor = []
  for (let x = 0; x < 15; x++) for (let z = 0; z < 9; z++) floor.push(object(`floor-${x}-${z}`, [cell(x === 4 && z === 6 ? 'dirt' : 'stone', [x - 7, -3, z - 4])]))
  const shift = ([x, y, z]) => [x - 7, y - 3, z - 4]
  const paired = (id, name, pos, properties, offset, parts) => object(id, [cell(name, shift(pos), { ...properties, ...parts[0] }), cell(name, shift(pos.map((value, index) => value + offset[index])), { ...properties, ...parts[1] })])
  const document = { ...base, id: 'export-world-fixture', name: 'Export world fixture', entities: [{ id: 'export-pig', type: 'minecraft:pig', position: shift([7.5, 1, 4.5]), yaw: 90 }], objects: [
    { id: 'support-group', name: 'Support floor', kind: 'group', cells: [], children: floor, pivot2: [1, -5, 1], orientation: 0 },
    ...[['north', [2, 1, 2], [0, 0, -1]], ['east', [5, 1, 2], [1, 0, 0]], ['south', [9, 1, 2], [0, 0, 1]], ['west', [12, 1, 2], [-1, 0, 0]]].map(([facing, pos, offset]) => paired(`bed-${facing}`, 'red_bed', pos, { facing, occupied: 'false' }, offset, [{ part: 'foot' }, { part: 'head' }])),
    paired('door', 'oak_door', [2, 1, 6], { facing: 'north', open: 'false', powered: 'false' }, [0, 1, 0], [{ half: 'lower' }, { half: 'upper' }]),
    paired('flower', 'sunflower', [4, 1, 6], {}, [0, 1, 0], [{ half: 'lower' }, { half: 'upper' }]),
    object('stairs', [cell('oak_stairs', shift([6, 1, 6]), { facing: 'east', shape: 'straight', half: 'bottom', waterlogged: 'false' })]),
    object('slab', [cell('stone_brick_slab', shift([8, 1, 6]), { type: 'top', waterlogged: 'false' })]),
    object('log', [cell('oak_log', shift([10, 1, 6]), { axis: 'z' })]),
    { ...object('beam-instance', [cell('oak_log', shift([12, 1, 6]), { axis: 'x' })], 'component'), componentId: 'beam-library-source' },
    object('explicit-air', [cell('air', shift([14, 1, 8]))]),
  ] }
  await importDocument(document)
  const before = await snapshot(), beforeHistory = await history()
  const downloads = join(directory, 'exports')
  await mkdir(downloads)
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  await click(aria('Export Minecraft'))
  await until(`document.querySelector('[aria-label="Download Minecraft export"]') && !document.querySelector('[aria-label="Download Minecraft export"]').disabled`)
  await screenshot('editor-export-ready')
  async function downloaded(extension) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const file = (await readdir(downloads)).find(name => name.endsWith(extension))
      if (file) return readFile(join(downloads, file))
      await delay(100)
    }
    throw new Error(`Browser did not download ${extension}`)
  }
  await input(aria('Export format'), 'nbt')
  await click(aria('Download Minecraft export'))
  const bytes = await downloaded('.nbt'), nbt = readStructure(bytes)
  const cells = document.objects.flatMap(entry => entry.cells.concat(entry.children.flatMap(child => child.cells)))
  assert.equal(nbt.DataVersion, 4903)
  assert.deepEqual(nbt.size, [15, 3, 9])
  assert.equal(nbt.blocks.length, cells.length)
  const expected = cells.map(entry => ({ pos: entry.pos.map((value, index) => value - [-7, -3, -4][index]), state: entry.state }))
  const actual = nbt.blocks.map(entry => ({ pos: entry.pos, state: { name: nbt.palette[entry.state].Name, properties: nbt.palette[entry.state].Properties ?? {} } }))
  const sort = entries => entries.toSorted((a, b) => a.pos.join(',').localeCompare(b.pos.join(',')))
  assert.deepEqual(sort(actual), sort(expected), 'Browser export must retain every nested cell, property and explicit air')
  assert.deepEqual(nbt.entities.map(entity => ({ pos: entity.pos, yaw: entity.nbt.Rotation[0], id: entity.nbt.id })), [{ pos: [7.5, 1, 4.5], yaw: 90, id: 'minecraft:pig' }])
  // The dialog remains open so users can get both forms from the same snapshot.
  await input(aria('Export format'), 'datapack')
  await click(aria('Download Minecraft export'))
  const zipBytes = await downloaded('.zip'), zip = unzipSync(zipBytes)
  assert.deepEqual(readStructure(zip['data/blockstage/structure/build.nbt']), nbt)
  assert.deepEqual(JSON.parse(strFromU8(zip['pack.mcmeta'])).pack.min_format, [107, 1])
  assert.match(strFromU8(zip['README.txt']), /place template blockstage:build/)
  assert.deepEqual(await snapshot(), before, 'Export must never mutate document/selection')
  assert.equal(await history(), beforeHistory, 'Export must not add undo commands')
  await writeFile(resolve('artifacts/editor-export.nbt'), bytes)
  await writeFile(resolve('artifacts/editor-export.zip'), zipBytes)
  await writeFile(resolve('artifacts/editor-export.expected.json'), JSON.stringify({ origin: [-7, -3, -4], size: nbt.size, blocks: sort(expected), entities: nbt.entities }, null, 2))
  await command('Emulation.setDeviceMetricsOverride', { width: 620, height: 800, deviceScaleFactor: 1, mobile: false })
  assert.ok(await evaluate(`(() => { const modal=document.querySelector('dialog[open]'),r=modal.getBoundingClientRect(),button=modal.querySelector('[aria-label="Download Minecraft export"]').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && button.bottom<=innerHeight && modal.scrollWidth<=modal.clientWidth })()`), 'Export dialog and download must remain accessible in the compact viewport')
  await screenshot('editor-export-compact')
  await click(aria('Close Export Minecraft'))
  console.log(JSON.stringify({ exportResult: 'passed', blocks: cells.length, checks: ['block entity rejection', 'downloaded NBT decoded', 'group/component flatten', '4 bed facings/door/plant/stairs/slab/log', 'explicit air', 'entity coordinates/yaw', 'datapack metadata and same template', 'document/history unchanged'] }))
}
