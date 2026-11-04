import { describe, expect, it } from 'vitest'
import { defaultState, DEMO_MATERIALS } from '../core/catalog'
import { enableMeasurementPhases, type MeasurementPhase } from '../core/measurement-phases'
import type { NeighborRules } from '../core/profile'
import { newEditorDocument } from './model'
import { createPlacedObject } from './placement'
import { previewTransform, type TransformIntent } from './operations'
import { createTransformPreviewController, type TransformPreviewContext } from './transform-preview-controller'
import { emptyEditorViewState } from './view-state'

const move: TransformIntent = { kind: 'move', delta: [0, 1, 0] }
const context = (): TransformPreviewContext => ({
  document: { ...newEditorDocument(), objects: [createPlacedObject(defaultState('minecraft:stone'), [0, 0, 0], DEMO_MATERIALS, undefined, 'a'), createPlacedObject(defaultState('minecraft:stone'), [4, 0, 0], DEMO_MATERIALS, undefined, 'b')] },
  catalog: DEMO_MATERIALS, scope: 'architecture', epoch: 'epoch', revision: 0,
  selection: ['a', 'b'], space: 'global', pivot: 'active', view: emptyEditorViewState(), autoConnections: false,
})
function phases(action: (count: (name: string) => number) => void) {
  const release = enableMeasurementPhases()
  const count = (name: string) => (globalThis as typeof globalThis & { __blockstagePhaseRead: () => { events: MeasurementPhase[] } }).__blockstagePhaseRead().events.filter(event => event.name === name).length
  try { action(count) } finally { release() }
}
const full = (value: TransformPreviewContext, intent = move) => previewTransform(value.document, value.selection, intent, value.space, value.pivot, value.catalog, value.rules)

describe('one-context immutable transform preview controller', () => {
  it('reuses base proof/index for equivalent immutable context and discards them on reset', () => phases(count => {
    const controller = createTransformPreviewController(), value = context()
    expect(controller.preview(value, move)).toEqual(full(value))
    controller.preview({ ...value, selection: [...value.selection] }, { kind: 'move', delta: [0, 2, 0] })
    expect(count('transform.validation-base')).toBe(1)
    expect(count('transform.base-index')).toBe(1)
    controller.reset()
    controller.preview(value, move)
    expect(count('transform.validation-base')).toBe(2)
    expect(count('transform.base-index')).toBe(2)
  }))

  const changes: [string, (value: TransformPreviewContext) => TransformPreviewContext][] = [
    ['document', value => ({ ...value, document: { ...value.document } })],
    ['catalog', value => ({ ...value, catalog: [...value.catalog] })],
    ['scope', value => ({ ...value, scope: 'component' })],
    ['epoch', value => ({ ...value, epoch: 'next' })],
    ['revision', value => ({ ...value, revision: 1 })],
    ['selection order', value => ({ ...value, selection: [...value.selection].reverse() })],
    ['selection membership', value => ({ ...value, selection: ['a'] })],
    ['space', value => ({ ...value, space: 'local' })],
    ['pivot', value => ({ ...value, pivot: 'individual' })],
    ['view', value => ({ ...value, view: { ...value.view } })],
    ['rules identity', value => ({ ...value, rules: {} })],
  ]
  it.each(changes)('invalidates on %s and retains only the current context', (_name, change) => phases(count => {
    const controller = createTransformPreviewController(), value = context()
    controller.preview(value, move)
    controller.preview(change(value), move)
    expect(count('transform.validation-base')).toBe(2)
    expect(count('transform.base-index')).toBe(2)
    controller.preview(value, move)
    expect(count('transform.validation-base')).toBe(3)
    expect(count('transform.base-index')).toBe(3)
  }))

  it('copies selection identity rather than retaining a mutable list alias', () => phases(count => {
    const controller = createTransformPreviewController(), value = context()
    controller.preview(value, move)
    value.selection.reverse()
    expect(controller.preview(value, move)).toEqual(full(value))
    expect(count('transform.validation-base')).toBe(2)
    value.selection.pop()
    controller.preview(value, move)
    expect(count('transform.validation-base')).toBe(3)
  }))

  it.each([undefined, {} as NeighborRules])('uses full validation repeatedly whenever auto connections is enabled (%s)', rules => phases(count => {
    const controller = createTransformPreviewController(), value = { ...context(), autoConnections: true, rules }
    const expected = full(value)
    const before = count('validation.total')
    expect(controller.preview(value, move)).toEqual(expected)
    expect(controller.preview(value, move)).toEqual(expected)
    expect(count('transform.validation-base')).toBe(0)
    expect(count('transform.base-index')).toBe(0)
    expect(count('transform.validation-subset')).toBe(0)
    expect(count('validation.total') - before).toBe(2)
  }))

  it('discards an existing proof on auto-connections transition and rebuilds on return', () => phases(count => {
    const controller = createTransformPreviewController(), value = context()
    controller.preview(value, move)
    controller.preview({ ...value, autoConnections: true }, move)
    controller.preview(value, move)
    expect(count('transform.validation-base')).toBe(2)
    expect(count('transform.validation-subset')).toBe(2)
  }))

  it('retains public repair behavior for an invalid base and never retains failed proof', () => phases(count => {
    const controller = createTransformPreviewController(), value = context()
    value.selection = ['a']
    value.document.objects[0].cells[0].pos = [-30000001, 0, 0]
    value.document.objects[0].pivot2 = [-60000001, 1, 1]
    const repair: TransformIntent = { kind: 'move', delta: [1, 0, 0] }
    const expected = full(value, repair)
    expect(expected.valid).toBe(true)
    expect(controller.preview(value, repair)).toEqual(expected)
    expect(controller.preview(value, repair)).toEqual(expected)
    expect(count('transform.validation-base')).toBe(2)
    expect(count('transform.base-index')).toBe(0)
  }))

  it('revalidates a replacement catalog and matches public missing-registry rejection', () => {
    const controller = createTransformPreviewController(), value = context()
    expect(controller.preview(value, move).valid).toBe(true)
    const missing = { ...value, catalog: [] }
    const expected = full(missing)
    expect(expected.valid).toBe(false)
    expect(controller.preview(missing, move)).toEqual(expected)
    expect(controller.preview(missing, move)).toEqual(expected)
    expect(controller.preview(value, move).valid).toBe(true)
  })
})
