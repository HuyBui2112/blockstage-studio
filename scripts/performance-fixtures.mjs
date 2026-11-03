import { createHash } from 'node:crypto'

export const PERFORMANCE_FIXTURE_KINDS = Object.freeze(['dense', 'sparse', 'mixed', 'transparent', 'pairs', 'component', 'entity'])
export const PERFORMANCE_FIXTURE_SIZES = Object.freeze([1000, 10000, 100000])

// Synthetic document data only. No assets, registry files, browser state, random
// UUIDs or wall-clock values enter the fixture or its reproducibility hash.
export function createPerformanceFixture({ cells = 1000, kind = 'dense', seed = 1 } = {}) {
  // Bound all inputs before creating cells, IDs or recursive object trees.
  if (!Number.isSafeInteger(cells) || cells < 1 || cells > 100000) throw new RangeError('Fixture cells must be an integer from 1 to 100000')
  if (!PERFORMANCE_FIXTURE_KINDS.includes(kind)) throw new RangeError(`Unknown fixture kind: ${kind}`)
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Fixture seed must be an unsigned 32-bit integer')

  let randomState = seed >>> 0
  const random = limit => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    return Math.floor(randomState / 0x100000000 * limit)
  }
  const prefix = `p01-${kind}-${seed.toString(16)}`
  const origin = [-64 + random(32), random(4), -64 + random(32)]
  const width = Math.ceil(Math.cbrt(kind === 'pairs' ? Math.ceil(cells / 2) : cells))
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  const chunkKeys = new Set()
  const stateCounts = new Map()
  let nextId = 0, objectCount = 0, maxDepth = 1

  const position = (index, spacing = 1) => [
    origin[0] + index % width * spacing,
    origin[1] + Math.floor(index / (width * width)) * spacing,
    origin[2] + Math.floor(index / width) % width * spacing,
  ]
  const cell = (pos, name = 'stone', properties = {}) => {
    for (let axis = 0; axis < 3; axis++) {
      bounds.min[axis] = Math.min(bounds.min[axis], pos[axis])
      bounds.max[axis] = Math.max(bounds.max[axis], pos[axis])
    }
    chunkKeys.add(pos.map(value => Math.floor(value / 16)).join(','))
    stateCounts.set(`minecraft:${name}`, (stateCounts.get(`minecraft:${name}`) ?? 0) + 1)
    return { pos, state: { name: `minecraft:${name}`, properties: { ...properties } } }
  }
  const object = (kind, cells, children = []) => {
    const pivot2 = cells.length ? cells[0].pos.map(value => value * 2 + 1) : [...children[0].pivot2]
    const result = { id: `${prefix}-${(nextId++).toString(36)}`, name: kind, kind, cells, children, pivot2, orientation: 0 }
    if (kind === 'component') result.componentId = 'p01-independent-copy'
    objectCount++
    return result
  }
  const objects = []
  let pairCount = 0
  if (kind === 'pairs') {
    pairCount = Math.floor(cells / 2)
    for (let index = 0; index < pairCount; index++) {
      // Four-cell anchor spacing reserves both the east-facing bed footprint and
      // the vertical door footprint, including successive rows/layers.
      const pos = position(index, 4)
      const isDoor = index % 2 === 0
      const properties = isDoor
        ? { facing: 'east', half: 'lower', hinge: 'left', open: 'false', powered: 'false' }
        : { facing: 'east', part: 'foot', occupied: 'false' }
      const otherPos = [pos[0] + (isDoor ? 0 : 1), pos[1] + (isDoor ? 1 : 0), pos[2]]
      const name = isDoor ? 'oak_door' : 'red_bed'
      objects.push(object('multiblock', [cell(pos, name, properties), cell(otherPos, name, { ...properties, [isDoor ? 'half' : 'part']: isDoor ? 'upper' : 'head' })]))
    }
    // Odd requested sizes explicitly include one unpaired stone cell. Never
    // truncate a logical pair to satisfy an exact occupied-cell count.
    if (cells % 2) objects.push(object('block', [cell(position(pairCount, 4))]))
  } else if (kind === 'component') {
    // Independent reusable copies, not linked instances. Small cell leaves and
    // fixed fan-out keep 100k cells below both the object and depth budgets.
    let level = []
    for (let start = 0; start < cells; start += 16) {
      const content = []
      for (let index = start; index < Math.min(start + 16, cells); index++) content.push(cell(position(index), index % 2 ? 'oak_planks' : 'stone_bricks'))
      level.push(object('component', content))
    }
    let depth = 1
    while (level.length > 4) {
      const parents = []
      for (let start = 0; start < level.length; start += 4) parents.push(object(depth % 2 ? 'group' : 'component', [], level.slice(start, start + 4)))
      level = parents
      depth++
    }
    objects.push(...level)
    maxDepth = depth
  } else {
    for (let index = 0; index < cells; index++) {
      const pos = position(index, kind === 'sparse' ? 32 : 1)
      if (kind === 'sparse') {
        pos[0] += random(8)
        pos[2] += random(8)
        // Negative coordinates and chunk boundaries are intentional. Keep Y
        // bounded at the 100k-cell case and leave a clear command destination.
        pos[1] = origin[1] - 128 + Math.floor(index / (width * width)) * 4
      }
      let name = 'stone', properties = {}
      if (kind === 'transparent') name = index % 2 ? 'white_stained_glass' : 'glass'
      if (kind === 'mixed') {
        switch (random(6)) {
          case 0: name = 'oak_log'; properties = { axis: ['x', 'y', 'z'][random(3)] }; break
          case 1: name = 'oak_stairs'; properties = { facing: ['north', 'east', 'south', 'west'][random(4)], half: 'bottom', shape: 'straight', waterlogged: 'false' }; break
          case 2: name = 'stone_brick_slab'; properties = { type: 'bottom', waterlogged: 'false' }; break
          case 3: name = 'glass'; break
          case 4: name = 'oak_planks'; break
        }
      }
      objects.push(object('block', [cell(pos, name, properties)]))
    }
  }
  const entities = []
  if (kind === 'entity') {
    for (let index = 0; index < Math.min(1000, Math.max(1, Math.floor(cells / 10))); index++) {
      const anchor = position(random(cells))
      entities.push({ id: `${prefix}-pig-${index.toString(36)}`, type: 'minecraft:pig', position: [anchor[0] + 0.5, bounds.max[1] + 1 + index % 4, anchor[2] + 0.5], yaw: random(360) })
    }
  }
  const document = { schemaVersion: 2, id: prefix, name: `P01 ${kind} ${cells} seed ${seed}`, workspace: 'architecture', target: { gameVersion: '26.2', dataVersion: 4903 }, objects, entities }
  const serialized = JSON.stringify(document)
  return {
    document,
    meta: {
      schemaVersion: 1, generator: 'p01-v1', kind, seed, requestedCells: cells, occupiedCells: cells,
      objectCount, rootCount: objects.length, entityCount: entities.length, pairCount,
      singleCellRemainder: kind === 'pairs' ? cells % 2 : 0, maxDepth, bounds,
      chunkCount: chunkKeys.size, blockCounts: Object.fromEntries([...stateCounts].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
      documentBytes: Buffer.byteLength(serialized), documentSha256: createHash('sha256').update(serialized).digest('hex'),
      commands: {
        // Y +256 clears every fixture's original footprint, even for a single
        // root. These are edit commands; free entities remain unchanged.
        moveRoot: { selection: [objects[0].id], delta: [0, 256, 0] },
        moveAll: { selection: objects.map(root => root.id), delta: [0, 256, 0] },
      },
    },
  }
}
