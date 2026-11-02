import { describe, expect, it } from 'vitest'
import { DEMO_MATERIALS, defaultState, type Material } from '../core/catalog'
import type { NeighborRule, NeighborRules } from '../core/profile'
import { executeHistory, redoHistory, undoHistory } from './history'
import { newEditorDocument, sceneBlocks } from './model'
import { createPlacedObject } from './placement'
import { applyPrimitiveAction, planPrimitiveAction } from './primitive-action'
import type { PrimitiveIntent } from './primitive-plan'

const properties = { north: ['false', 'true'], east: ['false', 'true'], south: ['false', 'true'], west: ['false', 'true'] }
const fence: Material = { id: 'minecraft:oak_fence', label: 'Fence', family: 'fence', color: '#aaa', properties, defaults: { north: 'false', east: 'false', south: 'false', west: 'false' } }
const catalog = [...DEMO_MATERIALS.filter(material => material.id !== fence.id), fence]
const rule = (kind: NeighborRule['kind'] = 'other'): NeighborRule => ({ kind, fence: kind === 'fence', wooden: kind === 'fence', wall: false, forcePost: false, exception: false, properties: [], shapes: { '': [0, 0] } })
const rules: NeighborRules = { 'minecraft:air': rule(), 'minecraft:oak_fence': rule('fence') }
const base = { documentId: 'document', sessionEpoch: 'epoch', revision: 3 }
const options = { base, operationId: 'primitive' }
const intent: PrimitiveIntent = { kind: 'line', start: [1, 0, 0], end: [2, 0, 0], state: defaultState(fence.id, catalog) }
function source() {
  const object = { ...createPlacedObject(defaultState(fence.id, catalog), [0, 0, 0], catalog), id: 'original' }
  return { ...newEditorDocument(), id: 'document', objects: [object] }
}

describe('primitive action composition', () => {
  it('previews final connections on existing and new objects and commits that candidate in one undo step', () => {
    const document = source(), before = structuredClone(document)
    const plan = planPrimitiveAction(document, intent, catalog, options, rules)
    expect(plan.cells).toEqual(sceneBlocks(plan.document))
    expect(plan.cells).toHaveLength(3)
    expect(plan.cells.find(cell => cell.owner === 'original')?.state.properties.east).toBe('true')
    expect(plan.cells.find(cell => cell.owner === plan.selection[0])?.state.properties).toMatchObject({ west: 'true', east: 'true' })
    expect(plan.cells.find(cell => cell.owner === plan.selection[1])?.state.properties.west).toBe('true')
    expect(plan.patches.map(patch => patch.id)).toEqual(['original', 'primitive:0', 'primitive:1'])
    expect(plan.patches[0].before?.object).toEqual(document.objects[0])
    expect(applyPrimitiveAction(plan, document, base, catalog, rules)).toBe(plan.document)
    expect(document).toEqual(before)
    const history = executeHistory({ document, past: [], future: [] }, plan.document, 'Build line')
    expect(history.past).toHaveLength(1)
    expect(undoHistory(history).document).toEqual(document)
    expect(redoHistory(undoHistory(history)).document).toEqual(plan.document)
  })

  it('keeps explicit states with policy off and rejects policy changes in either direction', () => {
    const document = source()
    const explicit = planPrimitiveAction(document, intent, catalog, options)
    expect(explicit.cells).toHaveLength(2)
    expect(explicit.cells.every(cell => cell.state.properties.west === 'false' && cell.state.properties.east === 'false')).toBe(true)
    expect(() => applyPrimitiveAction(explicit, document, base, catalog, rules)).toThrow(/Auto connections changed/)
    const connected = planPrimitiveAction(document, intent, catalog, options, rules)
    expect(() => applyPrimitiveAction(connected, document, base, catalog)).toThrow(/Auto connections changed/)
    expect(() => applyPrimitiveAction(connected, document, base, catalog, { ...rules })).toThrow(/Auto connections changed/)
  })

  it('rejects invalid derived states before publishing a preview without mutating the source', () => {
    const document = source(), before = structuredClone(document)
    const restricted = catalog.map(material => material.id === fence.id ? { ...material, properties: { ...material.properties, east: ['false'] } } : material)
    expect(() => planPrimitiveAction(document, intent, restricted, options, rules)).toThrow()
    expect(planPrimitiveAction(document, intent, restricted, options).cells).toHaveLength(2)
    expect(document).toEqual(before)
  })

  it('rejects stale identity, revision, epoch, collision and cancellation without mutation', () => {
    const document = source(), before = structuredClone(document)
    expect(() => planPrimitiveAction(document, { ...intent, start: [0, 0, 0] }, catalog, options, rules)).toThrow()
    const controller = new AbortController()
    const plan = planPrimitiveAction(document, intent, catalog, { ...options, signal: controller.signal }, rules)
    expect(() => applyPrimitiveAction(plan, { ...document }, base, catalog, rules)).toThrow(/document changed/)
    expect(() => applyPrimitiveAction(plan, document, { ...base, revision: 4 }, catalog, rules)).toThrow(/document changed/)
    expect(() => applyPrimitiveAction(plan, document, { ...base, sessionEpoch: 'next' }, catalog, rules)).toThrow(/document changed/)
    controller.abort()
    expect(() => applyPrimitiveAction(plan, document, base, catalog, rules)).toThrow(/cancelled/)
    expect(() => planPrimitiveAction(document, intent, catalog, { ...options, signal: controller.signal }, rules)).toThrow(/cancelled/)
    expect(document).toEqual(before)
  })
})
