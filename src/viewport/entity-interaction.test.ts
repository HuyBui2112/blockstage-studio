import { afterEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import { EntityInteraction, entityMoveDelta, type EntityViewportState } from "./entity-interaction";

function fixture() {
  const hud = { hidden: true, className: "", textContent: "", remove: vi.fn(), classList: { toggle: vi.fn() } };
  vi.stubGlobal("document", { createElement: () => hud });
  const canvas = Object.assign(new EventTarget(), { style: {}, dataset: {} as Record<string, string>,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 400 }), contains: () => true }) as unknown as HTMLCanvasElement;
  const camera = new T.OrthographicCamera(-6, 6, 4, -4, .1, 100);
  camera.position.set(0, 0, 12); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial());
  mesh.userData.entityId = "pig"; mesh.updateMatrixWorld();
  const navigation = vi.fn(), scene = new T.Scene();
  const interaction = new EntityInteraction({ canvas, host: { append: vi.fn() } as unknown as HTMLDivElement,
    scene, camera: () => camera, meshes: () => [mesh], navigation, invalidate: vi.fn() });
  const state: EntityViewportState = { source: [{ id: "pig", type: "minecraft:pig", position: [0, 0, 0], yaw: 0 }],
    selected: ["pig"], selectable: ["pig"], tool: "select", yaw: 0, contextKey: "doc:epoch:1",
    onSelect: vi.fn(), onPreview: vi.fn(() => true), onConfirm: vi.fn(), onCancel: vi.fn(), onTool: vi.fn() };
  interaction.update(state);
  return { interaction, state, canvas, mesh, scene, navigation };
}
const key = (code: string, value = code) => ({ code, key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }) as KeyboardEvent;
afterEach(() => vi.unstubAllGlobals());

describe("entity gesture ownership", () => {
  it("retains fractional movement and supports axis/plane constraints", () => {
    expect(entityMoveDelta([.125, -.75, 1.25], 0, false)).toEqual([.125, 0, 0]);
    expect(entityMoveDelta([.125, -.75, 1.25], 1, true)).toEqual([.125, 0, 1.25]);
    expect(entityMoveDelta([.125, -.75, 1.25], null, false)).toEqual([.125, -.75, 1.25]);
  });
  it("numeric move uses the immutable source and confirms exactly once", () => {
    const { interaction, state } = fixture();
    interaction.keyDown(key("KeyG", "g")); interaction.keyDown(key("KeyX", "x"));
    for (const value of "0.25") interaction.keyDown(key("Digit", value));
    expect(state.onPreview).toHaveBeenLastCalledWith({ kind: "move", delta: [.25, 0, 0] });
    interaction.update({ ...state, previewing: true });
    expect(interaction.modal).not.toBeNull();
    interaction.keyDown(key("Enter"));
    expect(state.onConfirm).toHaveBeenCalledTimes(1);
    expect(state.source[0].position).toEqual([0, 0, 0]);
    interaction.dispose();
  });
  it("yaw uses degrees rather than block quarter turns and context changes cancel", () => {
    const { interaction, state } = fixture();
    interaction.keyDown(key("KeyR", "r"));
    for (const value of "-37.5") interaction.keyDown(key("Digit", value));
    expect(state.onPreview).toHaveBeenLastCalledWith({ kind: "rotate", degrees: -37.5 });
    interaction.update({ ...state, previewing: true });
    interaction.update({ ...state, contextKey: "doc:epoch:2" });
    expect(interaction.modal).toBeNull();
    expect(state.onConfirm).not.toHaveBeenCalled();
    expect(state.onCancel).toHaveBeenCalled();
    interaction.dispose();
  });
  it("typed plane movement chooses an allowed axis rather than discarding the value", () => {
    const { interaction, state } = fixture();
    interaction.keyDown(key("KeyG", "g"));
    interaction.keyDown({ ...key("KeyX", "x"), shiftKey: true } as KeyboardEvent);
    for (const value of "0.5") interaction.keyDown(key("Digit", value));
    expect(state.onPreview).toHaveBeenLastCalledWith({ kind: "move", delta: [0, .5, 0] });
    interaction.dispose();
  });
  it("stages one stable entity ID, freezes click and external cancellation retires local state", () => {
    const { interaction, state, canvas } = fixture();
    const placing = { ...state, selected: [], tool: "place" as const, placementId: "new", yaw: 90 };
    interaction.update(placing);
    interaction.placement([.25, 1, -.75]);
    expect(state.onPreview).toHaveBeenLastCalledWith({ kind: "add", entity: { id: "new", type: "minecraft:pig", position: [.25, 1, -.75], yaw: 90 } });
    const event = { button: 0, clientX: 100, clientY: 100, target: canvas } as unknown as PointerEvent;
    interaction.pointerDown(event); interaction.pointerUp(event);
    interaction.placement([2, 2, 2]);
    expect(state.onPreview).toHaveBeenCalledTimes(1);
    interaction.update({ ...placing, previewing: true });
    interaction.update({ ...placing, previewing: false });
    expect(interaction.frozen).toBe(false);
    expect(interaction.lastPoint).toBe("");
    expect(state.onConfirm).not.toHaveBeenCalled();
    interaction.dispose();
  });
  it("invalid numeric intent cannot confirm an older valid preview", () => {
    const { interaction, state } = fixture();
    interaction.keyDown(key("KeyG", "g"));
    interaction.update({ ...state, previewing: true });
    interaction.keyDown(key("Minus", "-"));
    expect(state.onPreview).toHaveBeenLastCalledWith({ kind: "move", delta: [NaN, 0, 0] });
    interaction.update({ ...state, previewing: false });
    expect(interaction.modal).not.toBeNull();
    interaction.keyDown(key("Enter"));
    expect(state.onConfirm).not.toHaveBeenCalled();
    interaction.dispose();
  });
  it("disposing owns helpers only, never shared entity geometry/material", () => {
    const { interaction, mesh, scene } = fixture();
    const geometry = vi.spyOn(mesh.geometry, "dispose"), material = vi.spyOn(mesh.material as T.Material, "dispose");
    interaction.update({ ...interaction.state!, tool: "move" });
    expect(interaction.transform.object).toBeDefined();
    interaction.dispose();
    expect(scene.children).toHaveLength(0);
    expect(geometry).not.toHaveBeenCalled(); expect(material).not.toHaveBeenCalled();
  });
  it("Q and E cancel numeric entity modals without confirming", () => {
    const { interaction, state } = fixture();
    interaction.keyDown(key("KeyG", "g"));
    interaction.keyDown(key("Digit1", "1"));
    expect(interaction.keyDown(key("KeyQ", "q"))).toBe(true);
    expect(interaction.modal).toBeNull();
    expect(state.onTool).toHaveBeenLastCalledWith("select");
    interaction.keyDown(key("KeyR", "r"));
    expect(interaction.keyDown(key("KeyE", "e"))).toBe(false);
    expect(interaction.modal).toBeNull();
    expect(state.onConfirm).not.toHaveBeenCalled();
    interaction.dispose();
  });
});
