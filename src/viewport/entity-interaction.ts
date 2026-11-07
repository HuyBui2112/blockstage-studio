import * as T from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { SceneEntity, Vec3 } from "../core/schema";
import type { EntityActionIntent } from "../editor/entity-action";

export type EntityViewportState = {
  source: readonly SceneEntity[];
  selected: readonly string[];
  selectable: readonly string[];
  tool: "select" | "place" | "move" | "rotate";
  placementId?: string;
  yaw: number;
  contextKey: string;
  previewing?: boolean;
  onSelect: (id: string, toggle: boolean) => void;
  onPreview: (intent: EntityActionIntent) => boolean | void;
  onConfirm: () => void;
  onCancel: () => void;
  onTool?: (tool: "select" | "move" | "rotate") => void;
};
type Bridge = {
  canvas: HTMLCanvasElement;
  host: HTMLDivElement;
  scene: T.Scene;
  camera: () => T.Camera;
  meshes: () => readonly T.Mesh[];
  navigation: (enabled: boolean) => void;
  invalidate: () => void;
};
type Modal = {
  kind: "move" | "rotate";
  start: [number, number];
  origin: T.Vector3;
  axis: number | null;
  plane: boolean;
  numeric: string;
  delta: Vec3;
  degrees: number;
};

export function entityMoveDelta(delta: Vec3, axis: number | null, plane: boolean): Vec3 {
  return delta.map((value, index) => axis === null || (plane ? index !== axis : index === axis) ? value : 0) as Vec3;
}

/** Gesture-owned proxy only. Every edit goes through the session's entity plan. */
export class EntityInteraction {
  state?: EntityViewportState;
  transform: TransformControls;
  proxy = new T.Object3D();
  outlines = new T.Group();
  helpers: T.Box3Helper[] = [];
  hover = new T.Box3Helper(new T.Box3(), 0xe5c389);
  hud: HTMLDivElement;
  modal: Modal | null = null;
  dragging = false;
  frozen = false;
  valid = false;
  placementPosition?: Vec3;
  placementYaw = 0;
  lastPoint = "";
  down: [number, number] | null = null;
  pointer: [number, number] = [0, 0];
  startPosition = new T.Vector3();
  selectionKey = "";
  disposed = false;
  retiringInvalid = false;
  rotationStartVector: T.Vector3 | null = null;
  bridge: Bridge;
  constructor(bridge: Bridge) {
    this.bridge = bridge;
    this.transform = new TransformControls(bridge.camera(), bridge.canvas);
    this.transform.setSpace("world");
    this.transform.showX = this.transform.showZ = true;
    this.transform.addEventListener("change", bridge.invalidate);
    this.transform.addEventListener("mouseDown", this.dragStart);
    this.transform.addEventListener("objectChange", this.dragChange);
    this.transform.addEventListener("mouseUp", this.dragEnd);
    this.hover.visible = false;
    bridge.scene.add(this.proxy, this.transform.getHelper(), this.outlines, this.hover);
    this.hud = document.createElement("div");
    this.hud.className = "transform-hud entity-transform-hud";
    this.hud.hidden = true;
  }
  hideHud() { this.hud.hidden = true; this.hud.remove(); }
  update(state: EntityViewportState | undefined) {
    const selection = state?.selected.join("\0") ?? "";
    if (this.state?.contextKey === state?.contextKey && this.state?.previewing && !state?.previewing && !this.retiringInvalid &&
      (this.modal || this.frozen || this.lastPoint || this.dragging)) {
      this.modal = null; this.dragging = false; this.frozen = false;
      this.lastPoint = ""; this.placementPosition = undefined;
      this.valid = false; this.hideHud(); this.bridge.navigation(true);
    }
    this.retiringInvalid = false;
    if (!this.state) this.placementYaw = state?.yaw ?? 0;
    if (this.state && (state?.contextKey !== this.state.contextKey ||
      selection !== this.selectionKey || state?.tool !== this.state.tool || state?.placementId !== this.state.placementId)) {
      this.cancel();
      this.frozen = false;
      this.lastPoint = "";
      this.placementYaw = state?.yaw ?? 0;
    }
    this.state = state;
    this.selectionKey = selection;
    this.transform.camera = this.bridge.camera();
    this.refreshOutlines();
    if (!state || !state.selected.length || state.tool === "select" || state.tool === "place" || this.modal) {
      this.transform.detach();
    } else if (!this.dragging) {
      const selected = new Set(state.selected), box = new T.Box3();
      for (const mesh of this.bridge.meshes()) if (selected.has(mesh.userData.entityId)) box.union(new T.Box3().setFromObject(mesh));
      if (!box.isEmpty()) {
        this.proxy.position.copy(box.getCenter(new T.Vector3()));
        this.proxy.rotation.set(0, 0, 0);
        this.transform.setMode(state.tool === "rotate" ? "rotate" : "translate");
        this.transform.showX = this.transform.showZ = state.tool !== "rotate";
        this.transform.showY = true;
        this.transform.attach(this.proxy);
      }
    }
    this.bridge.canvas.dataset.entityTool = state?.tool ?? "none";
    this.bridge.canvas.dataset.entitySelection = JSON.stringify(state?.selected ?? []);
    this.publishHandles();
    this.bridge.invalidate();
  }
  refreshOutlines() {
    for (const helper of this.helpers) { this.outlines.remove(helper); helper.dispose(); }
    this.helpers = [];
    const selected = new Set(this.state?.selected);
    for (const mesh of this.bridge.meshes()) if (selected.has(mesh.userData.entityId)) {
      const helper = new T.Box3Helper(new T.Box3().setFromObject(mesh).expandByScalar(0.025), 0x8ce1af);
      this.helpers.push(helper); this.outlines.add(helper);
    }
  }
  publishHandles() {
    if (this.disposed) return;
    this.bridge.canvas.dataset.entityGizmo = this.transform.object ? this.transform.mode : "none";
    const rect = this.bridge.canvas.getBoundingClientRect();
    const screen = (point: T.Vector3) => { point.project(this.bridge.camera()); return { x: (point.x + 1) * rect.width / 2, y: (1 - point.y) * rect.height / 2 }; };
    const handles: { axis: string; x: number; y: number }[] = [];
    const origin = screen(this.proxy.getWorldPosition(new T.Vector3()));
    if (this.transform.object) this.transform.getHelper().traverseVisible((object) => {
      if (!(object instanceof T.Mesh) || !["X", "Y", "Z"].includes(object.name)) return;
      const positions = object.geometry.getAttribute("position");
      const candidates: T.Vector3[] = [];
      if (this.transform.mode === "rotate") {
        for (let i = 0; i < positions.count; i += Math.max(1, Math.floor(positions.count / 32))) candidates.push(new T.Vector3().fromBufferAttribute(positions, i));
      } else { object.geometry.computeBoundingBox(); candidates.push(object.geometry.boundingBox!.getCenter(new T.Vector3())); }
      for (const candidate of candidates) {
        const point = screen(candidate.applyMatrix4(object.matrixWorld));
        const previous = handles.find((item) => item.axis === object.name);
        if (!previous || Math.hypot(point.x - origin.x, point.y - origin.y) > Math.hypot(previous.x - origin.x, previous.y - origin.y)) {
          if (previous) Object.assign(previous, point); else handles.push({ axis: object.name, ...point });
        }
      }
    });
    this.bridge.canvas.dataset.entityGizmoHandles = JSON.stringify({ mode: this.transform.object ? this.transform.mode : null, origin, handles });
  }
  hoverEntity(id?: string) {
    const mesh = id ? this.bridge.meshes().find((item) => item.userData.entityId === id) : undefined;
    this.hover.visible = !!mesh && !this.state?.selected.includes(id!);
    if (mesh) this.hover.box.setFromObject(mesh).expandByScalar(0.025);
  }
  point(x: number, y: number, origin: T.Vector3) {
    const rect = this.bridge.canvas.getBoundingClientRect(), ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), this.bridge.camera());
    const normal = this.bridge.camera().getWorldDirection(new T.Vector3());
    return ray.ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(normal, origin), new T.Vector3()) ?? origin.clone();
  }
  placement(position?: Vec3) {
    const state = this.state;
    if (!state || state.tool !== "place" || !state.placementId || this.frozen || !position) return;
    this.placementPosition = [...position];
    const key = JSON.stringify([position, this.placementYaw]);
    if (key === this.lastPoint) return;
    this.lastPoint = key;
    this.valid = state.onPreview({ kind: "add", entity: { id: state.placementId, type: "minecraft:pig", position, yaw: this.placementYaw } }) !== false;
  }
  pointerDown(event: PointerEvent, entityId?: string): "capture" | "gizmo" | false {
    this.pointer = [event.clientX, event.clientY];
    if (!this.state || event.button !== 0) return false;
    if (this.modal) {
      if (this.valid) this.confirm();
      return "capture";
    }
    if (this.transform.axis && this.transform.object) return "gizmo";
    if (this.state.tool === "place" || entityId) {
      this.down = [event.clientX, event.clientY];
      return "capture";
    }
    return false;
  }
  pointerMove(event: PointerEvent) {
    this.pointer = [event.clientX, event.clientY];
    if (this.modal) { this.updateModal(); return true; }
    if (this.dragging && this.transform.mode === "rotate" && this.rotationStartVector) {
      const end = this.yPlaneVector(...this.pointer), start = this.rotationStartVector;
      if (end) {
        this.proxy.rotation.y = Math.atan2(start.z * end.x - start.x * end.z, start.dot(end));
        this.dragChange(); this.bridge.invalidate();
        event.stopImmediatePropagation?.(); return true;
      }
    }
    return this.dragging || !!this.down;
  }
  pointerUp(event: PointerEvent, entityId?: string) {
    if (this.dragging && event.button === 0) {
      this.transform.pointerUp({ button: 0 } as PointerEvent);
      if (this.dragging) this.dragEnd();
      return true;
    }
    if (event.button !== 0 || !this.down) return false;
    const click = Math.hypot(event.clientX - this.down[0], event.clientY - this.down[1]) < 5;
    this.down = null;
    if (click && this.bridge.canvas.contains(event.target as Node)) {
      if (this.state?.tool === "place") this.frozen = true;
      else if (entityId) this.state?.onSelect(entityId, event.shiftKey);
    }
    return true;
  }
  start(kind: "move" | "rotate") {
    const state = this.state;
    if (!state?.selected.length) { state?.onTool?.(kind === "move" ? "move" : "rotate"); return; }
    this.cancel();
    const entity = state.source.find((item) => item.id === state.selected.at(-1));
    if (!entity) return;
    const origin = new T.Vector3(...entity.position);
    this.modal = { kind, origin, start: [...this.pointer], axis: kind === "rotate" ? 1 : null,
      plane: false, numeric: "", delta: [0, 0, 0], degrees: 0 };
    this.transform.detach();
    this.bridge.navigation(false);
    this.valid = true;
    this.updateModal();
  }
  updateModal() {
    const modal = this.modal;
    if (!modal || !this.state) return;
    if (modal.kind === "rotate") modal.degrees = modal.numeric ? Number(modal.numeric) : (this.pointer[0] - modal.start[0]) * 0.5;
    else {
      let delta = this.point(...this.pointer, modal.origin).sub(this.point(...modal.start, modal.origin)).toArray() as Vec3;
      if (modal.numeric) {
        const value = Number(modal.numeric);
        let axis = modal.axis ?? 0;
        if (modal.plane) {
          const allowed = [0, 1, 2].filter((index) => index !== modal.axis);
          axis = allowed.sort((left, right) => Math.abs(delta[right]) - Math.abs(delta[left]))[0];
        }
        delta = [0, 0, 0]; delta[axis] = value;
      }
      modal.delta = entityMoveDelta(delta, modal.axis, modal.plane);
    }
    const intent: EntityActionIntent = modal.kind === "move" ? { kind: "move", delta: modal.delta } : { kind: "rotate", degrees: modal.degrees };
    const values = modal.kind === "move" ? modal.delta : [modal.degrees];
    const finite = values.every(Number.isFinite);
    this.retiringInvalid = !finite;
    const accepted = this.state.onPreview(intent) !== false;
    this.valid = finite && accepted;
    this.hud.hidden = false;
    if (!this.hud.isConnected) this.bridge.host.append(this.hud);
    this.hud.textContent = `${modal.kind === "move" ? "Entity move" : "Entity yaw"} · ${modal.numeric || values.map((value) => value.toFixed(2)).join(", ")} · Enter confirm · Esc cancel`;
    this.hud.classList.toggle("invalid", !this.valid);
  }
  confirm() {
    const state = this.state;
    this.modal = null; this.hideHud(); this.frozen = false; this.lastPoint = "";
    this.placementPosition = undefined;
    this.bridge.navigation(true);
    state?.onConfirm();
  }
  cancel() {
    const active = !!this.modal || this.dragging || this.frozen || !!this.lastPoint;
    this.modal = null; this.dragging = false; this.frozen = false; this.lastPoint = ""; this.valid = false;
    this.down = null; this.hideHud();
    this.placementPosition = undefined;
    this.bridge.navigation(true);
    if (active) this.state?.onCancel();
  }
  keyDown(event: KeyboardEvent) {
    const state = this.state;
    if (!state) return false;
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (plain && state.tool === "place" && event.code === "KeyR") {
      if (!event.repeat) {
        this.placementYaw = (this.placementYaw + (event.shiftKey ? -90 : 90) + 360) % 360;
        const position = this.placementPosition;
        const frozen = this.frozen; this.frozen = false;
        this.placement(position); this.frozen = frozen;
      }
      return true;
    }
    if (event.code === "Escape" && (this.modal || this.dragging || state.tool === "place" || state.previewing)) { this.cancel(); state.onCancel(); state.onTool?.("select"); return true; }
    if ((event.code === "Enter" || event.code === "NumpadEnter") && (this.modal || state.tool === "place" || state.previewing)) { if (this.modal || state.tool === "place" ? this.valid : state.previewing) this.confirm(); return true; }
    if (plain && event.code === "KeyQ" && (this.modal || state.tool === "place" || state.selected.length)) {
      this.cancel(); state.onTool?.("select"); return true;
    }
    if (plain && event.code === "KeyE" && (this.modal || state.tool === "place")) {
      this.cancel(); return false; // Let the shared block tool router restore the last palette.
    }
    if (this.modal) {
      const axis = ["KeyX", "KeyY", "KeyZ"].indexOf(event.code);
      if (axis >= 0) { if (this.modal.kind === "move" || axis === 1) { this.modal.axis = axis; this.modal.plane = event.shiftKey; this.updateModal(); } return true; }
      if (/^[0-9.-]$/.test(event.key)) { this.modal.numeric += event.key; this.updateModal(); return true; }
      if (event.code === "Backspace") { this.modal.numeric = this.modal.numeric.slice(0, -1); this.updateModal(); return true; }
      if (plain && (event.code === "KeyG" || event.code === "KeyR")) { this.start(event.code === "KeyG" ? "move" : "rotate"); return true; }
      return !event.code.startsWith("Numpad") && !["Home", "KeyF"].includes(event.code);
    }
    if (plain && state.selected.length && (event.code === "KeyG" || event.code === "KeyR") && state.tool !== "place") { if (!event.repeat) this.start(event.code === "KeyG" ? "move" : "rotate"); return true; }
    return false;
  }
  dragStart = () => {
    this.dragging = true; this.valid = false; this.startPosition.copy(this.proxy.position);
    this.bridge.navigation(false);
    this.rotationStartVector = this.transform.mode === "rotate" ? this.yPlaneVector(...this.pointer) : null;
  };
  yPlaneVector(x: number, y: number) {
    const rect = this.bridge.canvas.getBoundingClientRect(), ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), this.bridge.camera());
    const point = ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -this.proxy.position.y), new T.Vector3());
    return point ? point.sub(this.proxy.position).normalize() : null;
  }
  dragChange = () => {
    if (!this.dragging || !this.state) return;
    const intent: EntityActionIntent = this.transform.mode === "rotate"
      ? { kind: "rotate", degrees: -T.MathUtils.radToDeg(this.proxy.rotation.y) }
      : { kind: "move", delta: this.proxy.position.clone().sub(this.startPosition).toArray() as Vec3 };
    this.valid = this.state.onPreview(intent) !== false;
  };
  dragEnd = () => {
    if (!this.dragging) return;
    this.dragging = false; this.bridge.navigation(true);
    if (this.valid) this.state?.onConfirm(); else this.state?.onCancel();
  };
  dispose() {
    this.cancel(); this.disposed = true;
    this.transform.removeEventListener("change", this.bridge.invalidate);
    this.transform.removeEventListener("mouseDown", this.dragStart);
    this.transform.removeEventListener("objectChange", this.dragChange);
    this.transform.removeEventListener("mouseUp", this.dragEnd);
    this.transform.dispose();
    for (const helper of this.helpers) helper.dispose();
    this.hover.dispose(); this.hud.remove();
    this.bridge.scene.remove(this.proxy, this.transform.getHelper(), this.outlines, this.hover);
  }
}
