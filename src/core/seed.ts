import type { Block, Component, Project } from './schema'
import { defaultState } from './catalog'

const block = (x: number, y: number, z: number, id: string): Block => ({ pos: [x, y, z], state: defaultState(`minecraft:${id}`) })
export function seedComponents(): Component[] {
  return [
    { id: 'column', name: 'Cột gỗ · 5 block', category: 'column', blocks: Array.from({ length: 5 }, (_, y) => block(0, y, 0, 'oak_log')) },
    { id: 'wall', name: 'Tường cửa sổ · 5 × 4', category: 'wall', blocks: Array.from({ length: 20 }, (_, n) => block(n % 5, Math.floor(n / 5), 0, n >= 6 && n <= 8 || n >= 11 && n <= 13 ? 'glass' : 'stone_bricks')) },
    { id: 'gate', name: 'Cổng gỗ · 5 × 5', category: 'gate', blocks: Array.from({ length: 25 }, (_, n) => [n % 5, Math.floor(n / 5)]).filter(([x, y]) => x === 0 || x === 4 || y === 4 || y === 3 && (x === 1 || x === 3)).map(([x, y]) => block(x, y, 0, 'oak_log')) },
    { id: 'floor', name: 'Sàn gỗ · 5 × 5', category: 'floor', blocks: Array.from({ length: 25 }, (_, n) => block(n % 5, 0, Math.floor(n / 5), 'oak_planks')) },
  ]
}
export function newProject(demo = false): Project {
  return { schemaVersion: 1, id: crypto.randomUUID(), name: demo ? 'Nhà mẫu ven rừng' : 'Công trình mới', target: { gameVersion: '26.2', dataVersion: 4903 }, components: seedComponents(), blocks: [], entities: [], instances: demo ? [
    { id: 'base', componentId: 'floor', position: [0, 0, 0], rotation: 0, substitutions: {} },
    { id: 'back', componentId: 'wall', position: [0, 1, 4], rotation: 0, substitutions: {} },
    { id: 'side', componentId: 'wall', position: [5, 1, 0], rotation: 1, substitutions: {} },
    { id: 'front', componentId: 'gate', position: [0, 1, -1], rotation: 0, substitutions: {} },
    { id: 'pillar', componentId: 'column', position: [0, 1, 3], rotation: 0, substitutions: {} },
  ] : [] }
}
