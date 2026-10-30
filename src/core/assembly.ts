import type { BlockState, Component, Instance, Project, SceneBlock, Vec3 } from './schema'
import { key, uniqueBlocks } from './schema'
import { family } from './catalog'

// Minecraft +Y up; clockwise viewed from above: north (-Z) -> east (+X).
export function rotatePos([x, y, z]: Vec3, turns: number): Vec3 {
  switch (((turns % 4) + 4) % 4) { case 1: return [-z, y, x]; case 2: return [-x, y, -z]; case 3: return [z, y, -x]; default: return [x, y, z] }
}
export function rotateState(state: BlockState, turns: number): BlockState {
  const t = ((turns % 4) + 4) % 4
  const p = { ...state.properties }
  const directions = ['north', 'east', 'south', 'west']
  if (directions.includes(p.facing)) p.facing = directions[(directions.indexOf(p.facing) + t) % 4]
  if (t % 2 && (p.axis === 'x' || p.axis === 'z')) p.axis = p.axis === 'x' ? 'z' : 'x'
  if (p.rotation !== undefined) p.rotation = String((Number(p.rotation) + t * 4) % 16)
  const original = state.properties
  for (let i = 0; i < 4; i++) if (original[directions[i]] !== undefined) p[directions[(i + t) % 4]] = original[directions[i]]
  if (p.shape?.includes('_') && ['north_south', 'east_west', 'ascending_north', 'ascending_east', 'ascending_south', 'ascending_west', 'north_east', 'south_east', 'south_west', 'north_west'].includes(p.shape)) {
    const parts = p.shape.split('_').map(d => directions.includes(d) ? directions[(directions.indexOf(d) + t) % 4] : d)
    const rotated = parts.join('_')
    p.shape = ({ south_north: 'north_south', west_east: 'east_west', east_north: 'north_east', east_south: 'south_east', west_south: 'south_west', west_north: 'north_west' } as Record<string, string>)[rotated] ?? rotated
  }
  if (t && p.orientation) throw new Error('Block có orientation cần adapter xoay chuyên biệt')
  return { name: state.name, properties: p }
}
export function instantiate(c: Component, i: Instance): SceneBlock[] {
  return c.blocks.map(b => {
    const pos = rotatePos(b.pos, i.rotation).map((v, n) => v + i.position[n]) as Vec3
    const replacement = i.substitutions[family(b.state.name)]
    if (replacement && family(replacement) !== family(b.state.name)) throw new Error('Chỉ thay vật liệu cùng nhóm tương thích')
    return { pos, state: rotateState({ ...b.state, name: replacement ?? b.state.name }, i.rotation), owner: i.id }
  })
}
export function flatten(project: Pick<Project, 'blocks' | 'instances' | 'components'>): SceneBlock[] {
  const result: SceneBlock[] = project.blocks.map(b => ({ ...b, owner: 'loose' }))
  for (const i of project.instances) {
    const c = project.components.find(c => c.id === i.componentId)
    if (!c) throw new Error('Không tìm thấy thành phần')
    result.push(...instantiate(c, i))
    if (result.length > 100000) throw new Error('Giới hạn bản nền: 100.000 block')
  }
  uniqueBlocks(result)
  return result
}
export function canPlace(existing: SceneBlock[], incoming: SceneBlock[]) {
  const occupied = new Set(existing.map(b => key(b.pos)))
  return incoming.every(b => !occupied.has(key(b.pos)))
}
export function bounds(blocks: { pos: Vec3 }[]) {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  if (!blocks.length) return { min: [0, 0, 0] as Vec3, size: [0, 0, 0] as Vec3 }
  for (const { pos } of blocks) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pos[a]); max[a] = Math.max(max[a], pos[a]) }
  return { min, size: max.map((v, n) => v - min[n] + 1) as Vec3 }
}
