import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import {
  constrainedDelta,
  EditorInteraction,
  localDelta,
  rectanglesOverlap,
  type EditorViewportState,
} from "./editor-interaction";
import type { SceneBlock } from "../core/schema";
import { DEMO_MATERIALS } from "../core/catalog";
import { newEditorDocument, type EditorObject } from "../editor/model";
import { previewTransform, type TransformPreview } from "../editor/operations";

function fixture(large = false) {
  const rectangle = { style: {}, setAttribute: vi.fn(), remove: vi.fn() };
  vi.stubGlobal("document", { createElement: () => rectangle });
  const canvas = Object.assign(new EventTarget(), {
    style: {},
    dataset: {} as Record<string, string>,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 400 }),
  }) as unknown as HTMLCanvasElement;
  const camera = new T.OrthographicCamera(-6, 6, 4, -4, 0.1, 100);
  camera.position.set(0, 0, 12);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const geometry = new T.BoxGeometry(1, 1, 1);
  const texture = new T.Texture(),
    alphaMap = new T.Texture();
  const material = new T.MeshLambertMaterial({
    map: texture,
    alphaMap,
    color: "#91bd59",
    alphaTest: 0.1,
  });
  const navigation = vi.fn();
  const editor = new EditorInteraction({
    canvas,
    host: {
      append: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    } as unknown as HTMLDivElement,
    scene: new T.Scene(),
    camera: () => camera,
    navigation,
    invalidate: vi.fn(),
    message: vi.fn(),
    renderBlock: () => ({ geometry, materials: [material] }),
  });
  const state: EditorViewportState = {
    tool: "move",
    selected: ["a"],
    active: "a",
    space: "local",
    pivot: [0.5, 0.5, 0.5],
    localYaw: 1,
    onSelect: vi.fn(),
    onPlace: vi.fn(),
    onTransform: vi.fn(),
    onCommand: vi.fn(),
  };
  const blocks: SceneBlock[] = [
    {
      owner: "a",
      pos: [0, 0, 0],
      state: { name: "minecraft:stone", properties: {} },
    },
    {
      owner: "b",
      pos: [4, 0, 0],
      state: { name: "minecraft:stone", properties: {} },
    },
  ];
  if (large)
    for (let index = 2; index < 25000; index++)
      blocks.push({
        owner: "background",
        pos: [index, 0, 0],
        state: blocks[0].state,
      });
  editor.update(state, blocks);
  editor.lastPointer = [300, 200];
  return {
    editor,
    state,
    blocks,
    navigation,
    geometry,
    material,
    texture,
    alphaMap,
    canvas,
  };
}
function keyboard(code: string, key = "", extra = {}) {
  return {
    code,
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...extra,
  } as KeyboardEvent;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("grid-safe editor viewport input", () => {
  it("keeps small-scene numeric previews immediate without timers", () => {
    const { editor, state } = fixture();
    editor.startModal("move");
    vi.mocked(state.onTransform).mockClear();
    editor.keyDown(keyboard("", "3"));
    expect(state.onTransform).toHaveBeenCalledExactlyOnceWith(
      { kind: "move", delta: [0, 0, 3] },
      "preview",
    );
    expect(vi.getTimerCount()).toBe(0);
    editor.dispose();
  });
  it("coalesces numeric input to the latest preview and commits immediately before its timer", () => {
    const { editor, state } = fixture(true);
    editor.startModal("move");
    vi.mocked(state.onTransform).mockClear();
    for (const char of "256") editor.keyDown(keyboard("", char));
    expect(state.onTransform).not.toHaveBeenCalled();
    expect(editor.bridge.canvas.dataset.transformIntent).toBe(
      JSON.stringify({ kind: "move", delta: [0, 0, 256] }),
    );
    vi.advanceTimersByTime(75);
    expect(state.onTransform).toHaveBeenCalledExactlyOnceWith(
      { kind: "move", delta: [0, 0, 256] },
      "preview",
    );
    editor.keyDown(keyboard("Backspace"));
    editor.keyDown(keyboard("Enter"));
    expect(state.onTransform).toHaveBeenLastCalledWith(
      { kind: "move", delta: [0, 0, 25] },
      "commit",
    );
    vi.advanceTimersByTime(300);
    expect(state.onTransform).toHaveBeenCalledTimes(2);
    editor.dispose();
  });
  it.each(["Escape", "KeyQ", "KeyE", "KeyR"])(
    "cancels pending numeric delivery on %s",
    (code) => {
      const { editor, state } = fixture(true);
      editor.startModal("move");
      editor.keyDown(keyboard("", "2"));
      editor.keyDown(keyboard(code));
      const calls = vi.mocked(state.onTransform).mock.calls.length;
      vi.advanceTimersByTime(300);
      expect(state.onTransform).toHaveBeenCalledTimes(calls);
      expect(
        vi
          .mocked(state.onTransform)
          .mock.calls.some((call) => call[1] === "commit"),
      ).toBe(false);
      editor.dispose();
    },
  );
  it.each([
    "revision",
    "context",
    "space",
    "pivot",
    "resource",
    "selection",
    "blocks",
    "absent",
  ])("drops pending preview when %s changes", (change) => {
    const { editor, state, blocks } = fixture(true);
    editor.startModal("move");
    editor.keyDown(keyboard("", "2"));
    const next = { ...state };
    if (change === "revision") next.revisionKey = "other:1";
    if (change === "context") next.transformContext = {};
    if (change === "space") next.space = "global";
    if (change === "pivot") next.pivot = [2, 2, 2];
    if (change === "selection") next.selected = ["b"];
    editor.update(
      change === "absent" ? undefined : next,
      change === "blocks" ? [...blocks] : blocks,
      change === "resource",
    );
    expect(editor.modal).toBeNull();
    const calls = vi.mocked(state.onTransform).mock.calls.length;
    vi.advanceTimersByTime(300);
    expect(state.onTransform).toHaveBeenCalledTimes(calls);
    expect(
      vi
        .mocked(state.onTransform)
        .mock.calls.some((call) => call[1] === "commit"),
    ).toBe(false);
    editor.dispose();
  });
  it("keeps pending preview across callback-only renders and drops it at disposal", () => {
    const { editor, state, blocks } = fixture(true),
      latest = vi.fn();
    editor.startModal("move");
    editor.keyDown(keyboard("", "2"));
    editor.update({ ...state, onTransform: latest }, blocks);
    vi.advanceTimersByTime(75);
    expect(latest).toHaveBeenCalledExactlyOnceWith(
      { kind: "move", delta: [0, 0, 2] },
      "preview",
    );
    editor.keyDown(keyboard("", "5"));
    editor.dispose();
    vi.advanceTimersByTime(300);
    expect(latest).toHaveBeenCalledTimes(1);
  });
  it("uses the presentation bridge only for delivered deferred input", () => {
    const { editor, state } = fixture(true),
      present = vi.fn((publish: () => void) => publish());
    editor.bridge.publishDeferredPreview = present;
    editor.startModal("move");
    expect(present).not.toHaveBeenCalled();
    editor.keyDown(keyboard("", "3"));
    vi.advanceTimersByTime(75);
    expect(present).toHaveBeenCalledTimes(1);
    expect(state.onTransform).toHaveBeenLastCalledWith(
      { kind: "move", delta: [0, 0, 3] },
      "preview",
    );
    editor.keyDown(keyboard("", "4"));
    editor.keyDown(keyboard("Escape"));
    vi.advanceTimersByTime(300);
    expect(present).toHaveBeenCalledTimes(1);
    editor.dispose();
  });
  it("through box selection excludes locked roots and refreshes when policy changes", () => {
    const { editor, state, blocks, geometry } = fixture();
    editor.update(
      {
        ...state,
        tool: "box",
        selected: [],
        active: null,
        selectableOwners: ["b"],
      },
      blocks,
    );
    expect(editor.boxSelection([0, 0, 600, 400])).toEqual(["b"]);
    editor.update(
      {
        ...state,
        tool: "box",
        selected: [],
        active: null,
        selectableOwners: [],
      },
      blocks,
    );
    expect(editor.boxSelection([0, 0, 600, 400])).toEqual([]);
    editor.update(
      { ...state, tool: "box", selected: [], active: null },
      blocks,
    );
    expect(editor.boxSelection([0, 0, 600, 400])).toEqual(["a", "b"]);
    editor.dispose();
    geometry.dispose();
  });
  it("routes placement yaw and cancel without transforming the current selection", () => {
    const { editor, state, blocks } = fixture();
    state.tool = "place";
    state.onPlacementRotate = vi.fn();
    state.onPlacementCancel = vi.fn();
    editor.update(state, blocks);
    expect(editor.keyDown(keyboard("KeyR"))).toBe(true);
    expect(editor.keyDown(keyboard("KeyR", "R", { shiftKey: true }))).toBe(
      true,
    );
    expect(state.onPlacementRotate).toHaveBeenNthCalledWith(1, 1);
    expect(state.onPlacementRotate).toHaveBeenNthCalledWith(2, -1);
    editor.keyDown(keyboard("Escape"));
    expect(state.onPlacementCancel).toHaveBeenCalledOnce();
    expect(state.onTransform).not.toHaveBeenCalled();
    expect(editor.modal).toBeNull();
    editor.dispose();
  });
  it("switches directly from Place to modal Move and between transform tools", () => {
    const { editor, state, blocks } = fixture();
    const onTool = vi.fn();
    editor.update({ ...state, tool: "place", onTool }, blocks);
    editor.keyDown(keyboard("KeyG"));
    expect(onTool).toHaveBeenLastCalledWith("move");
    expect(editor.modal).toBeNull();
    // An already queued hover render can publish the previous tool first.
    editor.update({ ...state, tool: "place", onTool }, blocks);
    expect(editor.modal).toBeNull();
    editor.update({ ...state, tool: "move", onTool }, blocks);
    expect(editor.modal?.kind).toBe("move");
    editor.keyDown(keyboard("Digit2", "2"));
    editor.keyDown(keyboard("KeyR"));
    expect(onTool).toHaveBeenLastCalledWith("rotate");
    editor.update({ ...state, tool: "rotate", onTool }, blocks);
    expect(editor.modal?.kind).toBe("rotate");
    editor.keyDown(keyboard("KeyQ"));
    expect(editor.modal).toBeNull();
    expect(onTool).toHaveBeenLastCalledWith("select");
    expect(
      vi
        .mocked(state.onTransform)
        .mock.calls.some((call) => call[1] === "commit"),
    ).toBe(false);
    editor.dispose();
  });
  it("does not revive a pending tool transition after the source selection changes", () => {
    const { editor, state, blocks } = fixture(),
      onTool = vi.fn();
    editor.update({ ...state, tool: "place", onTool }, blocks);
    editor.keyDown(keyboard("KeyG"));
    editor.update({ ...state, tool: "place", selected: ["b"], onTool }, blocks);
    editor.update({ ...state, tool: "move", selected: ["b"], onTool }, blocks);
    expect(editor.modal).toBeNull();
    editor.dispose();
  });
  it("switches tools without warning or preview when nothing is selected", () => {
    const { editor, state, blocks } = fixture(),
      onTool = vi.fn();
    editor.update(
      { ...state, tool: "place", selected: [], active: null, onTool },
      blocks,
    );
    editor.keyDown(keyboard("KeyG"));
    editor.update(
      { ...state, tool: "move", selected: [], active: null, onTool },
      blocks,
    );
    expect(editor.modal).toBeNull();
    expect(editor.bridge.message).not.toHaveBeenCalled();
    editor.keyDown(keyboard("KeyE"));
    expect(onTool).toHaveBeenLastCalledWith("place");
    editor.dispose();
  });
  it.each([{ ctrlKey: true }, { metaKey: true }, {}])(
    "accepts select all with %j and Alt+A clears",
    (extra) => {
      const { editor, state } = fixture();
      editor.keyDown(keyboard("KeyA", "a", extra));
      expect(state.onCommand).toHaveBeenLastCalledWith("select-all");
      editor.keyDown(keyboard("KeyA", "a", { altKey: true }));
      expect(state.onCommand).toHaveBeenLastCalledWith("deselect");
      editor.dispose();
    },
  );
  it("distinguishes regular Select clicks from through rectangle drags and cancels cleanly", () => {
    const { editor, state, blocks } = fixture();
    editor.update({ ...state, tool: "select" }, blocks);
    const pointer = (x: number, y: number, extra = {}) =>
      ({
        button: 0,
        clientX: x,
        clientY: y,
        shiftKey: false,
        ...extra,
      }) as PointerEvent;
    expect(editor.pointerDown(pointer(290, 205))).toBe(false);
    editor.pointerMove(pointer(292, 204));
    expect(editor.pointerUp(pointer(292, 204))).toBe(false);
    expect(state.onSelect).not.toHaveBeenCalled();
    editor.pointerDown(pointer(290, 205, { shiftKey: true }));
    editor.pointerMove(pointer(355, 140));
    expect(editor.pointerUp(pointer(355, 140))).toBe(true);
    expect(state.onSelect).toHaveBeenLastCalledWith(["a"], true);
    editor.pointerDown(pointer(290, 205));
    editor.pointerMove(pointer(355, 140));
    editor.keyDown(keyboard("Escape"));
    expect(editor.boxStart).toBeNull();
    expect(editor.rectangle.style.display).toBe("none");
    expect(state.onSelect).toHaveBeenCalledOnce();
    editor.dispose();
  });
  it("constrains local axes and planes in Minecraft clockwise coordinates", () => {
    expect(localDelta([2, 3, 4], 1)).toEqual([-4, 3, 2]);
    expect(localDelta([2, 3, 4], -1)).toEqual([4, 3, -2]);
    expect(constrainedDelta([4.2, 3.1, 2.1], 0, false, 1)).toEqual([0, 0, 2]);
    expect(constrainedDelta([4.2, 3.1, 2.1], 0, true, 1)).toEqual([4, 3, 0]);
  });
  it("emits one commit for a local numeric move and preserves committed blocks", () => {
    const { editor, state, blocks } = fixture(),
      before = JSON.stringify(blocks);
    editor.keyDown(keyboard("KeyG"));
    editor.keyDown(keyboard("KeyX"));
    editor.keyDown(keyboard("Digit3", "3"));
    vi.advanceTimersByTime(75);
    expect(state.onTransform).toHaveBeenLastCalledWith(
      { kind: "move", delta: [0, 0, 3] },
      "preview",
    );
    editor.keyDown(keyboard("Enter"));
    expect(
      vi
        .mocked(state.onTransform)
        .mock.calls.filter((call) => call[1] === "commit"),
    ).toEqual([[{ kind: "move", delta: [0, 0, 3] }, "commit"]]);
    expect(JSON.stringify(blocks)).toBe(before);
    editor.dispose();
  });
  it.each([
    ["KeyR", "45", false],
    ["KeyG", "1.5", false],
    ["KeyR", "90", true],
    ["KeyG", "2", true],
    ["KeyR", ".", false],
    ["KeyG", "-", false],
  ])(
    "routes %s typed %s to domain validation without silently rounding",
    (code, numeric, valid) => {
      const { editor, state, blocks } = fixture(true);
      const object: EditorObject = {
        id: "a",
        name: "Stone",
        kind: "block",
        cells: [{ pos: [0, 0, 0], state: blocks[0].state }],
        children: [],
        pivot2: [1, 1, 1],
        orientation: 0,
      };
      const document = { ...newEditorDocument(), objects: [object] },
        before = JSON.stringify(document);
      const results: TransformPreview[] = [];
      state.onTransform = vi.fn((intent) => {
        results.push(
          previewTransform(
            document,
            ["a"],
            intent,
            "global",
            "active",
            DEMO_MATERIALS,
          ),
        );
      });
      editor.keyDown(keyboard(code));
      for (const char of numeric) editor.keyDown(keyboard("", char));
      vi.advanceTimersByTime(75);
      expect(results.at(-1)?.valid).toBe(valid);
      editor.keyDown(keyboard("Enter"));
      expect(results.at(-1)?.valid).toBe(valid);
      if (!valid) expect(results.at(-1)?.error).toMatch(/integer|quarter/);
      expect(JSON.stringify(document)).toBe(before);
      editor.dispose();
    },
  );
  it("cancels staged numeric rotation without a later pointer release committing it", () => {
    const { editor, state } = fixture();
    editor.keyDown(keyboard("KeyR"));
    editor.keyDown(keyboard("KeyX"));
    for (const char of "90") editor.keyDown(keyboard(`Digit${char}`, char));
    vi.advanceTimersByTime(75);
    expect(state.onTransform).toHaveBeenLastCalledWith(
      { kind: "rotate", turns: 1 },
      "preview",
    );
    editor.keyDown(keyboard("Escape"));
    editor.pointerUp({ button: 0 } as PointerEvent);
    expect(
      vi
        .mocked(state.onTransform)
        .mock.calls.some((call) => call[1] === "commit"),
    ).toBe(false);
    expect(state.onTransform).toHaveBeenLastCalledWith(
      { kind: "rotate", turns: 1 },
      "cancel",
    );
    editor.dispose();
  });
  it("isolates gizmo preview and restores navigation after cancellation", () => {
    const { editor, state, navigation } = fixture();
    editor.dragStart();
    editor.proxy.position.x += 2;
    editor.dragChange();
    expect(state.onTransform).toHaveBeenLastCalledWith(
      { kind: "move", delta: [2, 0, 0] },
      "preview",
    );
    expect(navigation).toHaveBeenLastCalledWith(false);
    editor.cancel();
    editor.dragEnd();
    expect(navigation).toHaveBeenLastCalledWith(true);
    expect(
      vi
        .mocked(state.onTransform)
        .mock.calls.some((call) => call[1] === "commit"),
    ).toBe(false);
    editor.dispose();
  });
  it("anchors snapped gizmos at an exact half-cell pivot and reads quaternion yaw across 180 degrees", () => {
    const { editor, state, blocks } = fixture();
    expect(editor.anchor.position.toArray()).toEqual([0.5, 0.5, 0.5]);
    expect(editor.proxy.position.toArray()).toEqual([0, 0, 0]);
    expect(editor.transform.translationSnap).toBe(1);
    editor.update({ ...state, tool: "rotate", space: "global" }, blocks);
    expect(editor.transform.showX).toBe(false);
    expect(editor.transform.showZ).toBe(false);
    editor.dragStart();
    editor.proxy.quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), -Math.PI);
    editor.dragChange();
    expect(state.onTransform).toHaveBeenLastCalledWith(
      { kind: "rotate", turns: 2 },
      "preview",
    );
    editor.dragEnd();
    expect(state.onTransform).toHaveBeenLastCalledWith(
      { kind: "rotate", turns: 2 },
      "commit",
    );
    editor.dispose();
  });
  it("allows middle mouse navigation during a modal operation without confirming", () => {
    const { editor, state } = fixture();
    editor.startModal("move");
    editor.pointerDown({
      button: 1,
      clientX: 300,
      clientY: 200,
    } as PointerEvent);
    editor.pointerMove({ clientX: 330, clientY: 230 } as PointerEvent);
    editor.pointerUp({ button: 1, clientX: 330, clientY: 230 } as PointerEvent);
    expect(editor.modal).not.toBeNull();
    expect(
      vi
        .mocked(state.onTransform)
        .mock.calls.some((call) => call[1] === "commit"),
    ).toBe(false);
    editor.dispose();
  });
  it("uses logical owner bounds for through box selection", () => {
    const { editor, state, blocks } = fixture();
    blocks.push({ ...blocks[0], pos: [0, 1, 0] });
    editor.update(state, blocks);
    expect(editor.boxSelection([290, 140, 355, 205])).toEqual(["a"]);
    expect(rectanglesOverlap([0, 0, 10, 10], [10, 10, 20, 20])).toBe(true);
    expect(rectanglesOverlap([0, 0, 10, 10], [11, 11, 20, 20])).toBe(false);
    editor.dispose();
  });
  it("shares textured ghost geometry while isolating cached translucent materials and invalid tint", () => {
    const {
      editor,
      state,
      blocks,
      geometry,
      material,
      texture,
      alphaMap,
      canvas,
    } = fixture();
    const before = material.color.clone();
    editor.update(
      { ...state, ghost: { valid: true, blocks: [blocks[0]] } },
      blocks,
    );
    const valid = (
      (editor.ghost.children[0] as T.Mesh).material as T.MeshLambertMaterial[]
    )[0];
    expect(valid).not.toBe(material);
    expect(valid.map).toBe(texture);
    expect(valid.alphaMap).toBe(alphaMap);
    expect(valid.alphaTest).toBeCloseTo(material.alphaTest * 0.45);
    expect(valid.color.equals(before)).toBe(true);
    expect(valid.transparent).toBe(true);
    expect(valid.opacity).toBe(0.45);
    expect(valid.wireframe).toBe(false);
    expect(valid.depthWrite).toBe(false);
    expect(valid.depthTest).toBe(true);
    expect(valid.polygonOffset).toBe(true);
    editor.update(
      {
        ...state,
        ghost: { valid: true, blocks: [{ ...blocks[0], pos: [1, 0, 0] }] },
      },
      blocks,
    );
    expect(
      ((editor.ghost.children[0] as T.Mesh).material as T.Material[])[0],
    ).toBe(valid);
    editor.update(
      {
        ...state,
        ghost: { valid: false, blocks: [{ ...blocks[0], pos: [4, 0, 0] }] },
      },
      blocks,
    );
    expect((editor.ghost.children[0] as T.Mesh).geometry).toBe(geometry);
    const invalid = (
      (editor.ghost.children[0] as T.Mesh).material as T.MeshLambertMaterial[]
    )[0];
    expect(invalid).not.toBe(valid);
    expect(invalid.map).toBe(texture);
    expect(invalid.color.equals(valid.color)).toBe(false);
    expect(invalid.wireframe).toBe(false);
    expect(material.color.equals(before)).toBe(true);
    expect(material.opacity).toBe(1);
    expect(material.depthWrite).toBe(true);
    expect(canvas.dataset.editorGhostCells).toBe("1");
    expect(canvas.dataset.editorGhostTexturedMaterials).toBe("1");
    expect(canvas.dataset.editorGhostOpacity).toBe("0.45");
    expect(editor.outlines.children).toHaveLength(1);
    expect(blocks[0].pos).toEqual([0, 0, 0]);
    const instance = editor.ghost.children[0];
    material.color.set("#2255aa");
    editor.refreshGhostMaterialColors(new Set([material]));
    expect(valid.color.equals(material.color)).toBe(true);
    expect(invalid.color.equals(material.color.clone().lerp(new T.Color("#ff6c69"), 0.65))).toBe(true);
    expect(editor.ghost.children[0]).toBe(instance);
    expect(valid.opacity).toBe(0.45);
    const validDispose = vi.spyOn(valid, "dispose"),
      invalidDispose = vi.spyOn(invalid, "dispose");
    const sourceDispose = vi.spyOn(material, "dispose"),
      textureDispose = vi.spyOn(texture, "dispose"),
      geometryDispose = vi.spyOn(geometry, "dispose");
    editor.clearGhostMaterials();
    expect(validDispose).toHaveBeenCalledOnce();
    expect(invalidDispose).toHaveBeenCalledOnce();
    expect(editor.ghostMaterials.size).toBe(0);
    expect(editor.ghost.children).toHaveLength(0);
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(textureDispose).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled();
    editor.update(
      { ...state, ghost: { valid: true, blocks: [blocks[0]] } },
      blocks,
      true,
    );
    const refreshed = (
      (editor.ghost.children[0] as T.Mesh).material as T.MeshLambertMaterial[]
    )[0];
    expect(refreshed).not.toBe(valid);
    expect(refreshed.map).toBe(texture);
    const refreshedDispose = vi.spyOn(refreshed, "dispose");
    editor.dispose();
    expect(refreshedDispose).toHaveBeenCalledOnce();
  });
  it("batches identical ghost appearances at exact cell centers and disposes instance resources on replacement", () => {
    const { editor, state, blocks, geometry, material, texture, canvas } =
      fixture();
    const ghostBlocks: SceneBlock[] = [
      { ...blocks[0], pos: [-3, 2, 0] },
      { ...blocks[0], pos: [4, -1, 8] },
      {
        ...blocks[0],
        pos: [0, 0, 0],
        state: { name: "minecraft:air", properties: {} },
      },
    ];
    editor.update(
      { ...state, ghost: { valid: true, blocks: ghostBlocks } },
      blocks,
    );
    expect(editor.ghost.children).toHaveLength(1);
    const batch = editor.ghost.children[0] as T.InstancedMesh;
    expect(batch).toBeInstanceOf(T.InstancedMesh);
    expect(batch.count).toBe(2);
    expect(batch.geometry).toBe(geometry);
    const matrix = new T.Matrix4();
    batch.getMatrixAt(0, matrix);
    expect(new T.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([
      -2.5, 2.5, 0.5,
    ]);
    batch.getMatrixAt(1, matrix);
    expect(new T.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([
      4.5, -0.5, 8.5,
    ]);
    expect(canvas.dataset.editorGhostCells).toBe("2");
    expect(canvas.dataset.editorGhostBatches).toBe("1");
    const dispose = vi.spyOn(batch, "dispose"),
      geometryDispose = vi.spyOn(geometry, "dispose"),
      sourceDispose = vi.spyOn(material, "dispose"),
      textureDispose = vi.spyOn(texture, "dispose");
    editor.update(
      { ...state, ghost: { valid: false, blocks: [ghostBlocks[0]] } },
      blocks,
    );
    expect(dispose).toHaveBeenCalledOnce();
    const replacementDispose = vi.spyOn(
      editor.ghost.children[0] as T.InstancedMesh,
      "dispose",
    );
    editor.dispose();
    expect(replacementDispose).toHaveBeenCalledOnce();
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(sourceDispose).not.toHaveBeenCalled();
    expect(textureDispose).not.toHaveBeenCalled();
  });
  it("publishes projected visible gizmo geometry that the native picker recognizes", () => {
    const { editor, state, blocks, canvas } = fixture();
    for (const tool of ["move", "rotate"] as const) {
      editor.update({ ...state, tool, space: "global" }, blocks);
      editor.bridge.scene.updateMatrixWorld(true);
      editor.publishHandles();
      const metadata = JSON.parse(canvas.dataset.gizmoHandles!) as {
        handles: { axis: string; x: number; y: number }[];
      };
      expect(metadata.handles.length).toBeGreaterThan(0);
      for (const handle of metadata.handles) {
        editor.transform.pointerHover({
          x: (handle.x / 600) * 2 - 1,
          y: 1 - (handle.y / 400) * 2,
          button: 0,
        } as unknown as PointerEvent);
        expect(editor.transform.axis).toBe(handle.axis);
      }
    }
    editor.dispose();
  });
  it("accepts actual snapped handle pointer movement in an orthographic Minecraft top view", () => {
    const { editor, state, canvas, blocks } = fixture();
    editor.update({ ...state, space: "global" }, blocks);
    const camera = editor.bridge.camera() as T.OrthographicCamera;
    camera.position.set(0.5, 12, 0.5);
    camera.lookAt(0.5, 0.5, 0.5);
    camera.updateMatrixWorld();
    editor.bridge.scene.updateMatrixWorld(true);
    editor.publishHandles();
    const metadata = JSON.parse(canvas.dataset.gizmoHandles!) as {
      origin: { x: number; y: number };
      handles: { axis: string; x: number; y: number }[];
    };
    const handle = metadata.handles.find((handle) => handle.axis === "X")!;
    const pointer = (x: number, y: number, button: number) =>
      ({
        x: (x / 600) * 2 - 1,
        y: 1 - (y / 400) * 2,
        button,
      }) as unknown as PointerEvent;
    editor.transform.pointerHover(pointer(handle.x, handle.y, 0));
    expect(editor.transform.axis).toBe("X");
    editor.transform.pointerDown(pointer(handle.x, handle.y, 0));
    editor.transform.pointerMove(
      pointer(
        handle.x + (handle.x - metadata.origin.x) * 1.8,
        handle.y + (handle.y - metadata.origin.y) * 1.8,
        -1,
      ),
    );
    editor.transform.pointerUp(pointer(handle.x, handle.y, 0));
    expect(
      vi
        .mocked(state.onTransform)
        .mock.calls.filter((call) => call[1] === "commit"),
    ).toHaveLength(1);
    const intent = vi.mocked(state.onTransform).mock.calls.at(-1)![0];
    expect(intent.kind === "move" && intent.delta[0]).not.toBe(0);
    editor.dispose();
  });
  it("measures Y ring pointer rotation in top view despite camera-up epsilon", () => {
    const { editor, state, canvas, blocks } = fixture();
    editor.update({ ...state, tool: "rotate", space: "global" }, blocks);
    const camera = editor.bridge.camera() as T.OrthographicCamera;
    camera.position.set(0.5, 12, 0.5);
    camera.lookAt(0.5, 0.5, 0.5);
    camera.updateMatrixWorld();
    editor.bridge.scene.updateMatrixWorld(true);
    editor.publishHandles();
    const metadata = JSON.parse(canvas.dataset.gizmoHandles!) as {
      origin: { x: number; y: number };
      handles: { axis: string; x: number; y: number }[];
    };
    const handle = metadata.handles.find((handle) => handle.axis === "Y")!;
    editor.lastPointer = [handle.x, handle.y];
    const pointer = (x: number, y: number, button: number) =>
      ({
        x: (x / 600) * 2 - 1,
        y: 1 - (y / 400) * 2,
        button,
      }) as unknown as PointerEvent;
    editor.transform.pointerHover(pointer(handle.x, handle.y, 0));
    editor.transform.pointerDown(pointer(handle.x, handle.y, 0));
    const dx = handle.x - metadata.origin.x,
      dy = handle.y - metadata.origin.y;
    editor.pointerMove({
      clientX: metadata.origin.x - dy,
      clientY: metadata.origin.y + dx,
    } as PointerEvent);
    editor.pointerUp({ button: 0 } as PointerEvent);
    const intent = vi.mocked(state.onTransform).mock.calls.at(-1)![0];
    expect(intent.kind === "rotate" && Math.abs(intent.turns)).toBe(1);
    expect(
      vi
        .mocked(state.onTransform)
        .mock.calls.filter((call) => call[1] === "commit"),
    ).toHaveLength(1);
    editor.dispose();
  });
});
