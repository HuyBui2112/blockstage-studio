import * as T from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { SceneBlock, Vec3 } from '../core/schema'
import type { PlacementHit } from '../editor/placement-plan'

export type EditorTransformIntent = { kind: 'move'; delta: Vec3 } | { kind: 'rotate'; turns: number }
export type EditorPlacementHit = PlacementHit
export type EditorViewportState = {
  tool: 'select' | 'place' | 'move' | 'rotate' | 'box'
  selected: string[]
  active: string | null
  space: 'global' | 'local'
  pivot: [number, number, number]
  localYaw: number
  ghost?: { blocks: SceneBlock[]; valid: boolean }
  onSelect: (ids: string[], toggle: boolean) => void
  onPlace: (hit: EditorPlacementHit) => void
  onPlacementHover?: (hit: EditorPlacementHit | null) => void
  onPlacementRotate?: (turns: number) => void
  onPlacementCancel?: () => void
  onTransform: (intent: EditorTransformIntent, phase: 'preview' | 'commit' | 'cancel') => void
  onCommand: (name: 'undo' | 'redo' | 'delete' | 'group' | 'ungroup' | 'select-all' | 'deselect') => void
}

type Bridge = {
  canvas: HTMLCanvasElement
  host: HTMLDivElement
  scene: T.Scene
  camera: () => T.Camera
  navigation: (enabled: boolean) => void
  invalidate: () => void
  message: (text: string) => void
  geometry: (block: SceneBlock) => T.BufferGeometry
}
type Modal = {
  kind: 'move' | 'rotate'; origin: T.Vector3; startX: number; startY: number
  axis: 0 | 1 | 2 | null; plane: boolean; numeric: string
  intent: EditorTransformIntent; base: Vec3; baseTurns: number; navigating: boolean
}

/** Minecraft clockwise local axes converted to integer world coordinates. */
export function localDelta(delta: Vec3, yaw: number): Vec3 {
  let [x, y, z] = delta
  for (let n = 0; n < ((yaw % 4) + 4) % 4; n++) [x, z] = [-z, x]
  return [x === 0 ? 0 : x, y === 0 ? 0 : y, z === 0 ? 0 : z]
}
export function constrainedDelta(delta: Vec3, axis: 0 | 1 | 2 | null, plane: boolean, yaw: number): Vec3 {
  const local = localDelta(delta, -yaw)
  return localDelta(local.map((value, i) => Math.round(axis === null || (plane ? i !== axis : i === axis) ? value : 0)) as Vec3, yaw)
}
export function rectanglesOverlap(a: number[], b: number[]) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

/** Session-only proxy and overlays. This class never changes the committed scene. */
export class EditorInteraction {
  state?: EditorViewportState
  blocks: SceneBlock[] = []
  transform: TransformControls
  proxy = new T.Object3D()
  anchor = new T.Group()
  outlines = new T.Group()
  ghost = new T.Group()
  ghostMaterial = new T.MeshBasicMaterial({ color: '#8ce1af', wireframe: true, transparent: true, opacity: .65, depthTest: false })
  selectedKey = ''
  active: string | null = null
  ghostState?: EditorViewportState['ghost']
  modal: Modal | null = null
  dragging = false
  cancelled = false
  suppressClick = false
  startPosition = new T.Vector3()
  startRotation = 0
  rotationStartVector: T.Vector3 | null = null
  rotationStartQuaternion = new T.Quaternion()
  dragIntent: EditorTransformIntent = { kind: 'move', delta: [0, 0, 0] }
  lastIntent = ''
  lastPointer = [0, 0]
  handleMetadataKey = ''
  boxStart: [number, number] | null = null
  boxArmed = false
  rectangle: HTMLDivElement
  bridge: Bridge
  constructor(bridge: Bridge) {
    this.bridge = bridge
    this.transform = new TransformControls(bridge.camera(), bridge.canvas)
    this.transform.setTranslationSnap(1)
    this.transform.setRotationSnap(Math.PI / 2)
    this.transform.addEventListener('change', bridge.invalidate)
    this.transform.addEventListener('mouseDown', this.dragStart)
    this.transform.addEventListener('objectChange', this.dragChange)
    this.transform.addEventListener('mouseUp', this.dragEnd)
    this.anchor.add(this.proxy)
    bridge.scene.add(this.anchor, this.transform.getHelper(), this.outlines, this.ghost)
    this.transform.detach()
    this.rectangle = document.createElement('div')
    Object.assign(this.rectangle.style, { position: 'absolute', pointerEvents: 'none', border: '1px solid #8ce1af', background: '#8ce1af18', display: 'none', zIndex: '5' })
    this.rectangle.setAttribute('aria-hidden', 'true')
    bridge.host.append(this.rectangle)
  }
  update(state: EditorViewportState | undefined, blocks: SceneBlock[], resourcesChanged = false) {
    const selectionKey = state?.selected.join('\u0000') ?? ''
    if ((!state || selectionKey !== this.selectedKey || blocks !== this.blocks || state.tool !== this.state?.tool) && (this.modal || this.dragging)) this.cancel()
    const selectionChanged = this.blocks !== blocks || selectionKey !== this.selectedKey || this.active !== (state?.active ?? null)
    this.state = state; this.blocks = blocks; this.selectedKey = selectionKey
    this.active = state?.active ?? null
    this.bridge.canvas.dataset.editorTool = state?.tool ?? 'preview'
    this.bridge.canvas.dataset.selectionCount = String(state?.selected.length ?? 0)
    if (selectionChanged) {
      for (const child of this.outlines.children) (child as T.Box3Helper).dispose()
      this.outlines.clear()
      const boxes = new Map<string, T.Box3>()
      const selected = new Set(state?.selected)
      for (const block of blocks) if (selected.has(block.owner)) {
        const box = boxes.get(block.owner) ?? new T.Box3()
        box.expandByPoint(new T.Vector3(...block.pos).addScalar(-.015))
        box.expandByPoint(new T.Vector3(...block.pos).addScalar(1.015)); boxes.set(block.owner, box)
      }
      for (const [id, box] of boxes) this.outlines.add(new T.Box3Helper(box, id === state?.active ? '#ffe3a1' : '#8ce1af'))
    }
    if (resourcesChanged || state?.ghost !== this.ghostState) {
      this.ghost.clear(); this.ghostState = state?.ghost
      this.ghostMaterial.color.set(state?.ghost?.valid === false ? '#ff6c69' : '#8ce1af')
      for (const block of state?.ghost?.blocks ?? []) {
        const mesh = new T.Mesh(this.bridge.geometry(block), this.ghostMaterial)
        mesh.position.set(block.pos[0] + .5, block.pos[1] + .5, block.pos[2] + .5)
        mesh.renderOrder = 5; this.ghost.add(mesh)
      }
    }
    this.syncTransform(); this.bridge.invalidate()
  }
  syncTransform() {
    this.transform.camera = this.bridge.camera()
    if (this.dragging || this.modal) return
    const state = this.state
    if (!state?.selected.length || !['move', 'rotate'].includes(state.tool)) { this.transform.detach(); return }
    this.anchor.position.set(...state.pivot)
    this.proxy.position.set(0, 0, 0)
    this.proxy.rotation.set(0, state.space === 'local' ? -state.localYaw * Math.PI / 2 : 0, 0)
    this.transform.setMode(state.tool === 'rotate' ? 'rotate' : 'translate')
    // Local snapping measures integer offsets from the exact doubled-integer pivot.
    // An identity proxy orientation supplies global axes without snapping a .5 pivot away.
    this.transform.setSpace('local')
    this.transform.showX = this.transform.showZ = state.tool !== 'rotate'
    this.transform.showY = true
    this.transform.attach(this.proxy)
  }
  publishHandles() {
    // Read-only browser verification metadata, refreshed only when the view/proxy changes.
    const camera = this.bridge.camera(), canvas = this.bridge.canvas
    const rect = canvas.getBoundingClientRect()
    const key = [this.transform.object ? this.transform.mode : '', rect.width, rect.height, ...camera.matrixWorld.elements, ...camera.projectionMatrix.elements, ...this.proxy.matrixWorld.elements].join(',')
    if (key === this.handleMetadataKey) return
    this.handleMetadataKey = key
    const screen = (point: T.Vector3) => {
      point.project(camera)
      return { x: (point.x + 1) * rect.width / 2, y: (1 - point.y) * rect.height / 2 }
    }
    const origin = screen(this.proxy.getWorldPosition(new T.Vector3()))
    const handles = new Map<string, { axis: string; x: number; y: number; distance: number }>()
    if (this.transform.object) this.transform.getHelper().traverseVisible(object => {
      if (!(object instanceof T.Mesh) || !['X', 'Y', 'Z'].includes(object.name)) return
      const positions = object.geometry.getAttribute('position')
      const candidates: T.Vector3[] = []
      if (this.transform.mode === 'rotate') {
        // Torus center lies inside the ring; actual vertices are valid pick targets.
        for (let i = 0; i < positions.count; i += Math.max(1, Math.floor(positions.count / 32))) candidates.push(new T.Vector3().fromBufferAttribute(positions, i))
      } else {
        object.geometry.computeBoundingBox()
        candidates.push(object.geometry.boundingBox!.getCenter(new T.Vector3()))
      }
      for (const candidate of candidates) {
        const point = screen(candidate.applyMatrix4(object.matrixWorld))
        const distance = (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2
        if (!handles.has(object.name) || handles.get(object.name)!.distance < distance) handles.set(object.name, { axis: object.name, ...point, distance })
      }
    })
    canvas.dataset.gizmoHandles = JSON.stringify({ mode: this.transform.object ? this.transform.mode : null, origin, handles: [...handles.values()].map(({ axis, x, y }) => ({ axis, x, y })) })
  }
  dragStart = () => {
    if (!this.state) return
    this.dragging = true; this.cancelled = false; this.suppressClick = true; this.lastIntent = ''
    this.startPosition.copy(this.proxy.position)
    const direction = new T.Vector3(0, 0, 1).applyQuaternion(this.proxy.quaternion)
    this.startRotation = Math.atan2(direction.x, direction.z)
    this.rotationStartQuaternion.copy(this.proxy.quaternion)
    this.rotationStartVector = this.transform.mode === 'rotate' ? this.yPlaneVector(this.lastPointer[0], this.lastPointer[1]) : null
    this.dragIntent = this.transform.mode === 'rotate' ? { kind: 'rotate', turns: 0 } : { kind: 'move', delta: [0, 0, 0] }
    this.bridge.navigation(false)
    this.bridge.canvas.dataset.gizmoEvent = 'start'
    this.bridge.canvas.dataset.gizmoAxis = this.transform.axis ?? ''
  }
  dragChange = () => {
    if (!this.dragging || this.cancelled) return
    if (this.transform.mode === 'rotate') {
      const direction = new T.Vector3(0, 0, 1).applyQuaternion(this.proxy.quaternion)
      const angle = Math.atan2(direction.x, direction.z) - this.startRotation
      this.dragIntent = { kind: 'rotate', turns: Math.round(-Math.atan2(Math.sin(angle), Math.cos(angle)) / (Math.PI / 2)) || 0 }
    } else this.dragIntent = { kind: 'move', delta: this.proxy.position.clone().sub(this.startPosition).toArray().map(v => Math.round(v) || 0) as Vec3 }
    this.emit(this.dragIntent)
    this.bridge.canvas.dataset.gizmoEvent = 'preview'
  }
  dragEnd = () => {
    if (!this.dragging) return
    this.dragging = false; this.bridge.navigation(true)
    if (!this.cancelled) this.state?.onTransform(this.dragIntent, 'commit')
    this.bridge.canvas.dataset.gizmoEvent = this.cancelled ? 'cancel' : 'commit'
    this.syncTransform()
  }
  emit(intent: EditorTransformIntent) {
    const id = JSON.stringify(intent)
    if (id !== this.lastIntent) { this.lastIntent = id; this.state?.onTransform(intent, 'preview') }
    this.bridge.canvas.dataset.transformIntent = id
  }
  cancel() {
    const intent = this.modal?.intent ?? this.dragIntent
    this.cancelled = true
    if (this.dragging) { this.transform.reset(); this.transform.dragging = false }
    this.dragging = false; this.modal = null; this.lastIntent = ''; this.boxStart = null; this.boxArmed = false
    this.rectangle.style.display = 'none'; this.transform.enabled = true; this.bridge.navigation(true)
    this.state?.onTransform(intent, 'cancel')
    this.bridge.canvas.dataset.gizmoEvent = 'cancel'
    delete this.bridge.canvas.dataset.transformIntent
    delete this.bridge.canvas.dataset.transformMode
    this.syncTransform(); this.bridge.invalidate()
  }
  commitModal() {
    if (!this.modal) return
    const intent = this.modal.intent
    this.modal = null; this.transform.enabled = true
    this.state?.onTransform(intent, 'commit')
    delete this.bridge.canvas.dataset.transformMode
    delete this.bridge.canvas.dataset.transformIntent
    this.syncTransform()
  }
  planePoint(x: number, y: number, origin: T.Vector3) {
    const rect = this.bridge.canvas.getBoundingClientRect(), ray = new T.Raycaster()
    ray.setFromCamera(new T.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.bridge.camera())
    return ray.ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(this.bridge.camera().getWorldDirection(new T.Vector3()), origin), new T.Vector3()) ?? origin.clone()
  }
  yPlaneVector(x: number, y: number) {
    const rect = this.bridge.canvas.getBoundingClientRect(), ray = new T.Raycaster()
    ray.setFromCamera(new T.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.bridge.camera())
    const origin = this.proxy.getWorldPosition(new T.Vector3())
    const point = ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -origin.y), new T.Vector3())
    if (!point) return null
    point.sub(origin); point.y = 0
    return point.lengthSq() > 1e-10 ? point.normalize() : null
  }
  startModal(kind: Modal['kind']) {
    const state = this.state
    if (!state?.selected.length) { this.bridge.message('Select an object first.'); return }
    if (this.modal || this.dragging) this.cancel()
    this.lastIntent = ''
    const [startX, startY] = this.lastPointer
    this.modal = { kind, origin: this.planePoint(startX, startY, new T.Vector3(...state.pivot)), startX, startY, axis: kind === 'rotate' ? 1 : null, plane: false, numeric: '', intent: kind === 'move' ? { kind, delta: [0, 0, 0] } : { kind, turns: 0 }, base: [0, 0, 0], baseTurns: 0, navigating: false }
    this.transform.detach(); this.transform.enabled = false
    this.bridge.canvas.dataset.transformMode = kind
    this.bridge.message(kind === 'move' ? 'Move: X/Y/Z axis · Shift+axis plane · type blocks · Enter/click confirm · Esc/right click cancel' : 'Rotate Y: type degrees (90° steps) · Enter/click confirm · Esc/right click cancel')
    this.emit(this.modal.intent); this.bridge.invalidate()
  }
  updateModal(x = this.lastPointer[0], y = this.lastPointer[1]) {
    const modal = this.modal, state = this.state
    if (!modal || !state) return
    const yaw = state.space === 'local' ? state.localYaw : 0
    if (modal.kind === 'rotate') {
      const value = modal.numeric ? Number(modal.numeric) / 90 : modal.baseTurns + (x - modal.startX) / 60
      // Typed values reach the domain unchanged so invalid fractions get a visible reason.
      // Pointer motion alone uses snapped quarter turns.
      modal.intent = { kind: 'rotate', turns: modal.numeric ? value : Math.round(value) }
    } else {
      let delta: Vec3
      if (modal.numeric) {
        const value = Number(modal.numeric), local: Vec3 = [0, 0, 0]
        let axis = modal.axis ?? 0
        if (modal.plane) {
          const cursor = localDelta(this.planePoint(x, y, new T.Vector3(...state.pivot)).sub(modal.origin).toArray() as Vec3, -yaw)
          const allowed = [0, 1, 2].filter(i => i !== modal.axis)
          axis = allowed.sort((a, b) => Math.abs(cursor[b]) - Math.abs(cursor[a]))[0] as 0 | 1 | 2
        }
        local[axis] = value
        delta = localDelta(local, yaw)
      } else {
        const point = this.planePoint(x, y, new T.Vector3(...state.pivot)).sub(modal.origin)
        delta = constrainedDelta(point.toArray().map((v, i) => v + modal.base[i]) as Vec3, modal.axis, modal.plane, yaw)
      }
      modal.intent = { kind: 'move', delta }
    }
    this.emit(modal.intent)
  }
  pointerDown(e: PointerEvent) {
    this.lastPointer = [e.clientX, e.clientY]
    if (!this.state) return false
    this.suppressClick = false
    if (e.button === 2 && (this.modal || this.dragging || this.boxArmed || this.boxStart)) { this.cancel(); return true }
    if (this.modal) {
      if (e.button === 0) { this.commitModal(); this.suppressClick = true; return true }
      if (e.button === 1) this.modal.navigating = true
      return false
    }
    if (e.button !== 0) return false
    if (this.state.tool === 'box' || this.boxArmed) {
      this.boxStart = [e.clientX, e.clientY]; this.rectangle.style.display = 'block'
      this.drawRectangle(e.clientX, e.clientY); return true
    }
    if (this.transform.object) {
      const rect = this.bridge.canvas.getBoundingClientRect()
      this.transform.pointerHover({ x: (e.clientX - rect.left) / rect.width * 2 - 1, y: -(e.clientY - rect.top) / rect.height * 2 + 1, button: e.button } as unknown as PointerEvent)
      if (this.transform.axis) { this.suppressClick = true; return false }
    }
    return false
  }
  pointerMove(e: PointerEvent) {
    this.lastPointer = [e.clientX, e.clientY]
    if (this.boxStart) { this.drawRectangle(e.clientX, e.clientY); return true }
    if (this.modal) { if (!this.modal.navigating) this.updateModal(e.clientX, e.clientY); return true }
    if (this.dragging && this.transform.mode === 'rotate' && this.rotationStartVector) {
      const end = this.yPlaneVector(e.clientX, e.clientY), start = this.rotationStartVector
      if (end) {
        // Three's top-view rotation checks exact vector parallelism. Its camera-up
        // epsilon can select the tangent path and produce a zero turn instead.
        // Intersect the legal Y plane and snap the measured angle directly.
        const angle = Math.atan2(start.z * end.x - start.x * end.z, start.dot(end))
        const snapped = Math.round(angle / (Math.PI / 2)) * Math.PI / 2
        this.proxy.quaternion.copy(this.rotationStartQuaternion).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), snapped))
        this.dragChange(); this.bridge.invalidate()
        e.stopImmediatePropagation?.()
        return true
      }
    }
    return this.dragging
  }
  pointerUp(e: PointerEvent) {
    // The window owns release routing, including drags that end over a DOM overlay.
    // TransformControls otherwise only listens on its canvas and can miss that release.
    if (this.dragging && e.button === 0) {
      this.transform.pointerUp({ button: 0 } as PointerEvent)
      if (this.dragging) this.dragEnd()
      this.suppressClick = false
      return true
    }
    if (this.modal?.navigating && e.button === 1) {
      this.modal.navigating = false; this.modal.startX = e.clientX; this.modal.startY = e.clientY
      this.modal.origin = this.planePoint(e.clientX, e.clientY, new T.Vector3(...this.state!.pivot))
      if (this.modal.intent.kind === 'move') this.modal.base = this.modal.intent.delta
      else this.modal.baseTurns = this.modal.intent.turns
      return true
    }
    if (e.button === 0 && this.boxStart) {
      const [x, y] = this.boxStart
      const rect = [Math.min(x, e.clientX), Math.min(y, e.clientY), Math.max(x, e.clientX), Math.max(y, e.clientY)]
      this.state?.onSelect(this.boxSelection(rect), e.shiftKey)
      this.boxStart = null; this.boxArmed = false; this.rectangle.style.display = 'none'; return true
    }
    if (this.suppressClick) { this.suppressClick = false; return true }
    return Boolean(this.modal || this.dragging)
  }
  drawRectangle(x: number, y: number) {
    const [sx, sy] = this.boxStart!, host = this.bridge.host.getBoundingClientRect()
    Object.assign(this.rectangle.style, { left: `${Math.min(x, sx) - host.left}px`, top: `${Math.min(y, sy) - host.top}px`, width: `${Math.abs(x - sx)}px`, height: `${Math.abs(y - sy)}px` })
  }
  boxSelection(rect: number[]) {
    // Through-selection: every logical owner's projected cell bounds intersecting the rectangle.
    const boxes = new Map<string, T.Box3>(), canvas = this.bridge.canvas.getBoundingClientRect()
    for (const block of this.blocks) {
      const box = boxes.get(block.owner) ?? new T.Box3()
      box.expandByPoint(new T.Vector3(...block.pos)); box.expandByPoint(new T.Vector3(...block.pos).addScalar(1)); boxes.set(block.owner, box)
    }
    const selected: string[] = []
    for (const [owner, box] of boxes) {
      const projected = [Infinity, Infinity, -Infinity, -Infinity]
      let inFront = false
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const p = new T.Vector3(x, y, z).project(this.bridge.camera())
        if (p.z >= -1 && p.z <= 1) inFront = true
        const sx = canvas.left + (p.x + 1) * canvas.width / 2, sy = canvas.top + (1 - p.y) * canvas.height / 2
        projected[0] = Math.min(projected[0], sx); projected[1] = Math.min(projected[1], sy)
        projected[2] = Math.max(projected[2], sx); projected[3] = Math.max(projected[3], sy)
      }
      if (inFront && rectanglesOverlap(projected, rect)) selected.push(owner)
    }
    return selected
  }
  keyDown(e: KeyboardEvent) {
    const state = this.state
    if (!state) return false
    if (e.code === 'Escape' && (this.modal || this.dragging || this.boxArmed || this.boxStart)) { this.cancel(); return true }
    if (this.modal) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { this.commitModal(); return true }
      const axis = ['KeyX', 'KeyY', 'KeyZ'].indexOf(e.code)
      if (axis >= 0) {
        if (this.modal.kind === 'rotate' && axis !== 1) { this.bridge.message('Whole block objects rotate only around Y.'); return true }
        this.modal.axis = axis as 0 | 1 | 2; this.modal.plane = this.modal.kind === 'move' && e.shiftKey; this.updateModal(); return true
      }
      if (/^[0-9.-]$/.test(e.key)) { this.modal.numeric += e.key; this.updateModal(); return true }
      if (e.code === 'Backspace') { this.modal.numeric = this.modal.numeric.slice(0, -1); this.updateModal(); return true }
      // Navigation shortcuts remain available while a transform is staged.
      return !e.code.startsWith('Numpad') && !['Home', 'KeyF', 'Backquote'].includes(e.code)
    }
    if (this.dragging) return true
    if (state.tool === 'place' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.code === 'KeyR') { state.onPlacementRotate?.(e.shiftKey ? -1 : 1); return true }
      if (e.code === 'Escape') { state.onPlacementCancel?.(); return true }
      // Moving the selected object while placing is ambiguous; choose Move first.
      if (e.code === 'KeyG') return true
    }
    if (e.code === 'KeyG' && (e.ctrlKey || e.metaKey)) { state.onCommand(e.altKey ? 'ungroup' : 'group'); return true }
    if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) { state.onCommand(e.shiftKey ? 'redo' : 'undo'); return true }
    if (e.code === 'Delete' || e.code === 'Backspace') { state.onCommand('delete'); return true }
    if (e.code === 'KeyA' && !e.ctrlKey && !e.metaKey) { state.onCommand(e.altKey ? 'deselect' : 'select-all'); return true }
    if (e.code === 'KeyG' || e.code === 'KeyR') { this.startModal(e.code === 'KeyG' ? 'move' : 'rotate'); return true }
    if (e.code === 'KeyB') { this.boxArmed = true; this.bridge.message('Drag a rectangle to select through logical object bounds. Shift adds/removes selection.'); return true }
    return false
  }
  dispose() {
    this.transform.dispose()
    this.bridge.scene.remove(this.anchor, this.transform.getHelper(), this.outlines, this.ghost)
    for (const child of this.outlines.children) (child as T.Box3Helper).dispose()
    this.ghostMaterial.dispose(); this.rectangle.remove()
  }
}
