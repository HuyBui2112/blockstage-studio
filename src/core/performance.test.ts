import { expect, it } from 'vitest'
import { bounds, flatten } from './assembly'
import { newProject } from './seed'
import { defaultState } from './catalog'

it('compiles 100,000 occupied cells with linear spatial validation', () => {
  const p = newProject(), state = defaultState('minecraft:stone')
  p.blocks = Array.from({ length: 100000 }, (_, n) => ({ pos: [n % 100, Math.floor(n / 10000), Math.floor(n / 100) % 100], state }))
  const start = performance.now()
  const scene = flatten(p), box = bounds(scene)
  const elapsed = performance.now() - start
  expect(scene.length).toBe(100000); expect(box.size).toEqual([100, 10, 100])
  console.info(`CPU baseline: flatten + collision validation + bounds / 100,000 blocks: ${elapsed.toFixed(1)} ms. No GPU/FPS claim.`)
})
