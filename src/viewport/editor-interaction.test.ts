import { afterEach, describe, expect, it, vi } from 'vitest'
import * as T from 'three'
import { constrainedDelta, EditorInteraction, localDelta, rectanglesOverlap, type EditorViewportState } from './editor-interaction'
import type { SceneBlock } from '../core/schema'
import { DEMO_MATERIALS } from '../core/catalog'
import { newEditorDocument, type EditorObject } from '../editor/model'
import { previewTransform, type TransformPreview } from '../editor/operations'

function fixture() {
  const rectangle = { style: {}, setAttribute: vi.fn(), remove: vi.fn() }
  vi.stubGlobal('document', { createElement: () => rectangle })
  const canvas = Object.assign(new EventTarget(), { style: {}, dataset: {} as Record<string, string>, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 400 }) }) as unknown as HTMLCanvasElement
  const camera = new T.OrthographicCamera(-6, 6, 4, -4, .1, 100)
  camera.position.set(0, 0, 12); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
  const geometry = new T.BoxGeometry(1, 1, 1)
  const navigation = vi.fn()
  const editor = new EditorInteraction({ canvas, host: { append: vi.fn(), getBoundingClientRect: () => ({ left: 0, top: 0 }) } as unknown as HTMLDivElement, scene: new T.Scene(), camera: () => camera, navigation, invalidate: vi.fn(), message: vi.fn(), geometry: () => geometry })
  const state: EditorViewportState = { tool: 'move', selected: ['a'], active: 'a', space: 'local', pivot: [.5, .5, .5], localYaw: 1, onSelect: vi.fn(), onPlace: vi.fn(), onTransform: vi.fn(), onCommand: vi.fn() }
  const blocks: SceneBlock[] = [{ owner: 'a', pos: [0, 0, 0], state: { name: 'minecraft:stone', properties: {} } }, { owner: 'b', pos: [4, 0, 0], state: { name: 'minecraft:stone', properties: {} } }]
  editor.update(state, blocks)
  editor.lastPointer = [300, 200]
  return { editor, state, blocks, navigation, geometry, canvas }
}
function keyboard(code: string, key = '', extra = {}) {
  return { code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...extra } as KeyboardEvent
}

afterEach(() => vi.unstubAllGlobals())

describe('grid-safe editor viewport input', () => {
  it('routes placement yaw and cancel without transforming the current selection', () => {
    const { editor, state, blocks } = fixture()
    state.tool = 'place'; state.onPlacementRotate = vi.fn(); state.onPlacementCancel = vi.fn()
    editor.update(state, blocks)
    expect(editor.keyDown(keyboard('KeyR'))).toBe(true)
    expect(editor.keyDown(keyboard('KeyR', 'R', { shiftKey: true }))).toBe(true)
    expect(state.onPlacementRotate).toHaveBeenNthCalledWith(1, 1)
    expect(state.onPlacementRotate).toHaveBeenNthCalledWith(2, -1)
    editor.keyDown(keyboard('KeyG'))
    editor.keyDown(keyboard('Escape'))
    expect(state.onPlacementCancel).toHaveBeenCalledOnce()
    expect(state.onTransform).not.toHaveBeenCalled()
    expect(editor.modal).toBeNull()
    editor.dispose()
  })
  it('constrains local axes and planes in Minecraft clockwise coordinates', () => {
    expect(localDelta([2, 3, 4], 1)).toEqual([-4, 3, 2])
    expect(localDelta([2, 3, 4], -1)).toEqual([4, 3, -2])
    expect(constrainedDelta([4.2, 3.1, 2.1], 0, false, 1)).toEqual([0, 0, 2])
    expect(constrainedDelta([4.2, 3.1, 2.1], 0, true, 1)).toEqual([4, 3, 0])
  })
  it('emits one commit for a local numeric move and preserves committed blocks', () => {
    const { editor, state, blocks } = fixture(), before = JSON.stringify(blocks)
    editor.keyDown(keyboard('KeyG')); editor.keyDown(keyboard('KeyX')); editor.keyDown(keyboard('Digit3', '3'))
    expect(state.onTransform).toHaveBeenLastCalledWith({ kind: 'move', delta: [0, 0, 3] }, 'preview')
    editor.keyDown(keyboard('Enter'))
    expect(vi.mocked(state.onTransform).mock.calls.filter(call => call[1] === 'commit')).toEqual([[{ kind: 'move', delta: [0, 0, 3] }, 'commit']])
    expect(JSON.stringify(blocks)).toBe(before)
    editor.dispose()
  })
  it.each([
    ['KeyR', '45', false], ['KeyG', '1.5', false],
    ['KeyR', '90', true], ['KeyG', '2', true],
    ['KeyR', '.', false], ['KeyG', '-', false],
  ])('routes %s typed %s to domain validation without silently rounding', (code, numeric, valid) => {
    const { editor, state, blocks } = fixture()
    const object: EditorObject = { id: 'a', name: 'Stone', kind: 'block', cells: [{ pos: [0, 0, 0], state: blocks[0].state }], children: [], pivot2: [1, 1, 1], orientation: 0 }
    const document = { ...newEditorDocument(), objects: [object] }, before = JSON.stringify(document)
    const results: TransformPreview[] = []
    state.onTransform = vi.fn(intent => { results.push(previewTransform(document, ['a'], intent, 'global', 'active', DEMO_MATERIALS)) })
    editor.keyDown(keyboard(code))
    for (const char of numeric) editor.keyDown(keyboard('', char))
    expect(results.at(-1)?.valid).toBe(valid)
    editor.keyDown(keyboard('Enter'))
    expect(results.at(-1)?.valid).toBe(valid)
    if (!valid) expect(results.at(-1)?.error).toMatch(/integer|quarter/)
    expect(JSON.stringify(document)).toBe(before)
    editor.dispose()
  })
  it('cancels staged numeric rotation without a later pointer release committing it', () => {
    const { editor, state } = fixture()
    editor.keyDown(keyboard('KeyR')); editor.keyDown(keyboard('KeyX'))
    for (const char of '90') editor.keyDown(keyboard(`Digit${char}`, char))
    expect(state.onTransform).toHaveBeenLastCalledWith({ kind: 'rotate', turns: 1 }, 'preview')
    editor.keyDown(keyboard('Escape'))
    editor.pointerUp({ button: 0 } as PointerEvent)
    expect(vi.mocked(state.onTransform).mock.calls.some(call => call[1] === 'commit')).toBe(false)
    expect(state.onTransform).toHaveBeenLastCalledWith({ kind: 'rotate', turns: 1 }, 'cancel')
    editor.dispose()
  })
  it('isolates gizmo preview and restores navigation after cancellation', () => {
    const { editor, state, navigation } = fixture()
    editor.dragStart(); editor.proxy.position.x += 2; editor.dragChange()
    expect(state.onTransform).toHaveBeenLastCalledWith({ kind: 'move', delta: [2, 0, 0] }, 'preview')
    expect(navigation).toHaveBeenLastCalledWith(false)
    editor.cancel(); editor.dragEnd()
    expect(navigation).toHaveBeenLastCalledWith(true)
    expect(vi.mocked(state.onTransform).mock.calls.some(call => call[1] === 'commit')).toBe(false)
    editor.dispose()
  })
  it('anchors snapped gizmos at an exact half-cell pivot and reads quaternion yaw across 180 degrees', () => {
    const { editor, state, blocks } = fixture()
    expect(editor.anchor.position.toArray()).toEqual([.5, .5, .5])
    expect(editor.proxy.position.toArray()).toEqual([0, 0, 0])
    expect(editor.transform.translationSnap).toBe(1)
    editor.update({ ...state, tool: 'rotate', space: 'global' }, blocks)
    expect(editor.transform.showX).toBe(false)
    expect(editor.transform.showZ).toBe(false)
    editor.dragStart()
    editor.proxy.quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), -Math.PI)
    editor.dragChange()
    expect(state.onTransform).toHaveBeenLastCalledWith({ kind: 'rotate', turns: 2 }, 'preview')
    editor.dragEnd()
    expect(state.onTransform).toHaveBeenLastCalledWith({ kind: 'rotate', turns: 2 }, 'commit')
    editor.dispose()
  })
  it('allows middle mouse navigation during a modal operation without confirming', () => {
    const { editor, state } = fixture()
    editor.startModal('move')
    editor.pointerDown({ button: 1, clientX: 300, clientY: 200 } as PointerEvent)
    editor.pointerMove({ clientX: 330, clientY: 230 } as PointerEvent)
    editor.pointerUp({ button: 1, clientX: 330, clientY: 230 } as PointerEvent)
    expect(editor.modal).not.toBeNull()
    expect(vi.mocked(state.onTransform).mock.calls.some(call => call[1] === 'commit')).toBe(false)
    editor.dispose()
  })
  it('uses logical owner bounds for through box selection', () => {
    const { editor, state, blocks } = fixture()
    blocks.push({ ...blocks[0], pos: [0, 1, 0] })
    editor.update(state, blocks)
    expect(editor.boxSelection([290, 140, 355, 205])).toEqual(['a'])
    expect(rectanglesOverlap([0, 0, 10, 10], [10, 10, 20, 20])).toBe(true)
    expect(rectanglesOverlap([0, 0, 10, 10], [11, 11, 20, 20])).toBe(false)
    editor.dispose()
  })
  it('reuses ghost geometry and keeps selection distinct from invalid candidates', () => {
    const { editor, state, blocks, geometry } = fixture()
    editor.update({ ...state, ghost: { valid: false, blocks: [{ ...blocks[0], pos: [4, 0, 0] }] } }, blocks)
    expect((editor.ghost.children[0] as T.Mesh).geometry).toBe(geometry)
    expect(editor.ghostMaterial.color.getHexString()).toBe('ff6c69')
    expect(editor.outlines.children).toHaveLength(1)
    expect(blocks[0].pos).toEqual([0, 0, 0])
    editor.dispose()
  })
  it('publishes projected visible gizmo geometry that the native picker recognizes', () => {
    const { editor, state, blocks, canvas } = fixture()
    for (const tool of ['move', 'rotate'] as const) {
      editor.update({ ...state, tool, space: 'global' }, blocks)
      editor.bridge.scene.updateMatrixWorld(true)
      editor.publishHandles()
      const metadata = JSON.parse(canvas.dataset.gizmoHandles!) as { handles: { axis: string; x: number; y: number }[] }
      expect(metadata.handles.length).toBeGreaterThan(0)
      for (const handle of metadata.handles) {
        editor.transform.pointerHover({ x: handle.x / 600 * 2 - 1, y: 1 - handle.y / 400 * 2, button: 0 } as unknown as PointerEvent)
        expect(editor.transform.axis).toBe(handle.axis)
      }
    }
    editor.dispose()
  })
  it('accepts actual snapped handle pointer movement in an orthographic Minecraft top view', () => {
    const { editor, state, canvas, blocks } = fixture()
    editor.update({ ...state, space: 'global' }, blocks)
    const camera = editor.bridge.camera() as T.OrthographicCamera
    camera.position.set(.5, 12, .5); camera.lookAt(.5, .5, .5); camera.updateMatrixWorld()
    editor.bridge.scene.updateMatrixWorld(true); editor.publishHandles()
    const metadata = JSON.parse(canvas.dataset.gizmoHandles!) as { origin: { x: number; y: number }; handles: { axis: string; x: number; y: number }[] }
    const handle = metadata.handles.find(handle => handle.axis === 'X')!
    const pointer = (x: number, y: number, button: number) => ({ x: x / 600 * 2 - 1, y: 1 - y / 400 * 2, button }) as unknown as PointerEvent
    editor.transform.pointerHover(pointer(handle.x, handle.y, 0))
    expect(editor.transform.axis).toBe('X')
    editor.transform.pointerDown(pointer(handle.x, handle.y, 0))
    editor.transform.pointerMove(pointer(handle.x + (handle.x - metadata.origin.x) * 1.8, handle.y + (handle.y - metadata.origin.y) * 1.8, -1))
    editor.transform.pointerUp(pointer(handle.x, handle.y, 0))
    expect(vi.mocked(state.onTransform).mock.calls.filter(call => call[1] === 'commit')).toHaveLength(1)
    const intent = vi.mocked(state.onTransform).mock.calls.at(-1)![0]
    expect(intent.kind === 'move' && intent.delta[0]).not.toBe(0)
    editor.dispose()
  })
  it('measures Y ring pointer rotation in top view despite camera-up epsilon', () => {
    const { editor, state, canvas, blocks } = fixture()
    editor.update({ ...state, tool: 'rotate', space: 'global' }, blocks)
    const camera = editor.bridge.camera() as T.OrthographicCamera
    camera.position.set(.5, 12, .5); camera.lookAt(.5, .5, .5); camera.updateMatrixWorld()
    editor.bridge.scene.updateMatrixWorld(true); editor.publishHandles()
    const metadata = JSON.parse(canvas.dataset.gizmoHandles!) as { origin: { x: number; y: number }; handles: { axis: string; x: number; y: number }[] }
    const handle = metadata.handles.find(handle => handle.axis === 'Y')!
    editor.lastPointer = [handle.x, handle.y]
    const pointer = (x: number, y: number, button: number) => ({ x: x / 600 * 2 - 1, y: 1 - y / 400 * 2, button }) as unknown as PointerEvent
    editor.transform.pointerHover(pointer(handle.x, handle.y, 0)); editor.transform.pointerDown(pointer(handle.x, handle.y, 0))
    const dx = handle.x - metadata.origin.x, dy = handle.y - metadata.origin.y
    editor.pointerMove({ clientX: metadata.origin.x - dy, clientY: metadata.origin.y + dx } as PointerEvent)
    editor.pointerUp({ button: 0 } as PointerEvent)
    const intent = vi.mocked(state.onTransform).mock.calls.at(-1)![0]
    expect(intent.kind === 'rotate' && Math.abs(intent.turns)).toBe(1)
    expect(vi.mocked(state.onTransform).mock.calls.filter(call => call[1] === 'commit')).toHaveLength(1)
    editor.dispose()
  })
})
