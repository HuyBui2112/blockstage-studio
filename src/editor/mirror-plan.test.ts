import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS, defaultState, type Material } from "../core/catalog";
import type { NeighborRule, NeighborRules } from "../core/profile";
import type { Vec3 } from "../core/schema";
import { applyMirrorPlan, planMirror, type MirrorIntent } from "./mirror-plan";
import { newEditorDocument, objectCells, type EditorDocument, type EditorObject } from "./model";
import { createPlacedObject } from "./placement";
import { assertViewEdit, emptyEditorViewState } from "./view-state";

const catalog = DEMO_MATERIALS;
const base = { documentId: "document", sessionEpoch: "epoch", revision: 1 };
const options = { base, operationId: "mirror" };
const intent: MirrorIntent = { plane: "yz", pivotMode: "custom", plane2: 0 };
function block(id: string, pos: Vec3 = [0, 0, 0], type = "minecraft:stone"): EditorObject {
  return { ...createPlacedObject(defaultState(type, catalog), pos, catalog), id };
}
function source(...objects: EditorObject[]): EditorDocument { return { ...newEditorDocument(), id: "document", objects }; }

describe("whole-owner geometric mirror", () => {
  it("reflects cell centers and pivots across integer and half-cell World planes", () => {
    const document = source(block("stone", [17, 2, -4]));
    const plan = planMirror(document, ["stone"], intent, catalog, options);
    expect(plan.document.objects[0].cells[0].pos).toEqual([-18, 2, -4]);
    expect(plan.document.objects[0].pivot2).toEqual([-35, 5, -7]);
    expect(plan.changedChunks).toContain("1,0,-1");
    expect(plan.changedChunks).toContain("-2,0,-1");
    const half = planMirror(document, ["stone"], { plane: "xy", pivotMode: "custom", plane2: 1 }, catalog, options);
    expect(half.document.objects[0].cells[0].pos).toEqual([17, 2, 4]);
    expect(document.objects[0].cells[0].pos).toEqual([17, 2, -4]);
  });

  it("selects full bounds, last selected active pivot and individual owner pivots", () => {
    const document = source(block("a", [0, 0, 0]), block("b", [4, 0, 0]));
    const selection = planMirror(document, ["a", "b"], { plane: "yz", pivotMode: "selection" }, catalog, options);
    expect(selection.document.objects.map(root => root.cells[0].pos[0])).toEqual([4, 0]);
    const active = planMirror(document, ["b", "a"], { plane: "yz", pivotMode: "active" }, catalog, options);
    expect(active.document.objects.map(root => root.cells[0].pos[0])).toEqual([0, -4]);
    const individual = planMirror(document, ["a", "b"], { plane: "yz", pivotMode: "individual" }, catalog, options);
    expect(individual.document).toBe(document);
    expect(individual.patches).toEqual([]);
  });

  it("preserves nested IDs and provenance, reverses stair chirality, and is an involution", () => {
    const stair = block("stairs", [2, 0, 0], "minecraft:oak_stairs");
    stair.cells[0].state.properties = { ...stair.cells[0].state.properties, facing: "east", shape: "inner_left" };
    const root: EditorObject = { id: "component", name: "Copy", kind: "component", componentId: "asset", cells: [], children: [stair], pivot2: [1, 1, 1], orientation: 1 };
    const document = source(root);
    document.entities = [{ id: "pig", type: "minecraft:pig", position: [1, 2, 3], yaw: 20 }];
    const before = structuredClone(document);
    const first = planMirror(document, ["component"], intent, catalog, options);
    expect(first.document.entities).toBe(document.entities);
    expect(first.document.objects[0]).toMatchObject({ id: "component", componentId: "asset", orientation: 3 });
    expect(first.document.objects[0].children[0]).toMatchObject({ id: "stairs", cells: [{ pos: [-3, 0, 0], state: { properties: { facing: "west", shape: "inner_right" } } }] });
    const second = planMirror(first.document, ["component"], intent, catalog, options);
    expect(second.document).toEqual(document);
    expect(document).toEqual(before);
    expect(first.addedObjectIds).toEqual([]);
    expect(applyMirrorPlan(first, document, base, catalog)).toBe(first.document);
  });

  it("rejects collisions atomically but allows selected owners to exchange vacated cells", () => {
    const document = source(block("a"), block("b", [-1, 0, 0]));
    expect(() => planMirror(document, ["a"], intent, catalog, options)).toThrow();
    expect(planMirror(document, ["a", "b"], intent, catalog, options).document.objects.map(root => root.cells[0].pos[0])).toEqual([-1, 0]);
    expect(document.objects[0].cells[0].pos).toEqual([0, 0, 0]);
  });

  it("rejects malformed planes, fractional doubled coordinates, unsafe footprints and selection", () => {
    const document = source(block("stone"));
    for (const invalid of [{ ...intent, plane: "xz" }, { ...intent, plane2: .5 }, { ...intent, plane2: Infinity }, { ...intent, plane2: 60000003 }, { ...intent, pivotMode: "unknown" }, { plane: "yz", pivotMode: "selection", plane2: 1 }])
      expect(() => planMirror(document, ["stone"], invalid as MirrorIntent, catalog, options)).toThrow();
    expect(() => planMirror(document, ["stone", "stone"], intent, catalog, options)).toThrow();
    expect(() => planMirror(document, ["missing"], intent, catalog, options)).toThrow();
    expect(() => planMirror(source(block("stone", [30000000, 0, 0])), ["stone"], intent, catalog, options)).toThrow();
  });

  it("checks budgets and cycles before reading cell states or recursively validating", () => {
    const object = block("stone");
    Object.defineProperty(object.cells[0], "state", { get() { throw new Error("STATE READ"); } });
    expect(() => planMirror(source(object), ["stone"], intent, catalog, { ...options, budget: { maxObjects: 1, maxCells: 0 } })).toThrow(/budget/i);
    const cyclic = block("cycle"); cyclic.children.push(cyclic);
    expect(() => planMirror(source(cyclic), ["cycle"], intent, catalog, options)).toThrow(/cycle/i);
  });

  it("rejects unsupported registry-valid blocks even at an unchanged mirror footprint", () => {
    const unsupported: Material = { id: "minecraft:unknown_custom_block", label: "Unknown", family: "solid", color: "#aaa", properties: {}, defaults: {} };
    const object = block("unknown"); object.cells[0].state = { name: unsupported.id, properties: {} };
    expect(() => planMirror(source(object), ["unknown"], { ...intent, plane2: 1 }, [...catalog, unsupported], options)).toThrow(/finite mirror adapter/i);
  });

  it("keeps no-op source/history and guards stale identity, revision, cancellation and policy", () => {
    const document = source(block("stone"));
    const noop = planMirror(document, ["stone"], { ...intent, plane2: 1 }, catalog, options);
    expect(noop.document).toBe(document); expect(noop.patches).toEqual([]);
    const plan = planMirror(document, ["stone"], intent, catalog, options);
    expect(() => applyMirrorPlan(plan, { ...document }, base, catalog)).toThrow();
    expect(() => applyMirrorPlan(plan, document, { ...base, revision: 2 }, catalog)).toThrow();
    expect(() => applyMirrorPlan(plan, document, base, catalog, {} as never)).toThrow(/policy/i);
    const controller = new AbortController();
    const cancelled = planMirror(document, ["stone"], intent, catalog, { ...options, signal: controller.signal });
    controller.abort();
    expect(() => applyMirrorPlan(cancelled, document, base, catalog)).toThrow(/cancel/i);
  });

  it("preserves complete bed/door pairs and typed chest inventory inside a group", () => {
    const bed: Material = { id: "minecraft:red_bed", label: "Bed", family: "bed", color: "#aaa", properties: { facing: ["north", "east", "south", "west"], part: ["foot", "head"], occupied: ["false", "true"] }, defaults: { facing: "east", part: "foot", occupied: "false" } };
    const chest: Material = { id: "minecraft:chest", label: "Chest", family: "chest", color: "#aaa", hasBlockEntity: true, properties: { facing: ["north", "east", "south", "west"], type: ["single", "left", "right"], waterlogged: ["false", "true"] }, defaults: { facing: "north", type: "single", waterlogged: "false" } };
    const door: Material = { id: "minecraft:oak_door", label: "Door", family: "door", color: "#aaa", properties: { facing: ["north", "east", "south", "west"], half: ["lower", "upper"], hinge: ["left", "right"], open: ["false", "true"], powered: ["false", "true"] }, defaults: { facing: "north", half: "lower", hinge: "left", open: "false", powered: "false" } };
    const materials = [...catalog, bed, chest, door];
    const placed = (id: string, type: string, pos: Vec3) => ({ ...createPlacedObject(defaultState(type, materials), pos, materials), id });
    const inventory = placed("inventory", chest.id, [0, 2, 0]);
    inventory.cells[0].blockEntity = { kind: "chest", items: [{ slot: 26, id: "minecraft:stone", count: 64 }] };
    const group: EditorObject = { id: "group", name: "Furniture", kind: "group", cells: [], children: [placed("bed", bed.id, [0, 0, 0]), placed("door", "minecraft:oak_door", [3, 0, 0]), inventory], pivot2: [1, 1, 1], orientation: 0 };
    const document = source(group), plan = planMirror(document, ["group"], intent, materials, options);
    const cells = objectCells(plan.document.objects[0]);
    expect(cells.slice(0, 2).map(cell => cell.pos)).toEqual([[-1, 0, 0], [-2, 0, 0]]);
    expect(cells.slice(0, 2).map(cell => cell.state.properties)).toEqual([{ facing: "west", part: "foot", occupied: "false" }, { facing: "west", part: "head", occupied: "false" }]);
    expect(cells.slice(2, 4).map(cell => cell.state.properties.hinge)).toEqual(["right", "right"]);
    expect(cells[4].blockEntity).toEqual(inventory.cells[0].blockEntity);
    expect(planMirror(plan.document, ["group"], intent, materials, options).document).toEqual(document);
  });

  it("finalizes neighbor patches into the exact candidate and exposes protected indirect edits", () => {
    const fence: Material = { id: "minecraft:oak_fence", label: "Fence", family: "fence", color: "#888", properties: { north: ["false", "true"], east: ["false", "true"], south: ["false", "true"], west: ["false", "true"] }, defaults: { north: "false", east: "false", south: "false", west: "false" } };
    const materials = [...catalog, fence];
    const rule = (kind: NeighborRule["kind"]): NeighborRule => ({ kind, fence: kind === "fence", wooden: true, wall: false, forcePost: false, exception: false, properties: [], shapes: { "": [0, 0] } });
    const rules: NeighborRules = { "minecraft:air": rule("other"), [fence.id]: rule("fence") };
    const placed = (id: string, x: number) => ({ ...createPlacedObject(defaultState(fence.id, materials), [x, 0, 0], materials), id });
    const document = source(placed("moving", 2), placed("fixed", -2));
    const plan = planMirror(document, ["moving"], intent, materials, options, rules);
    expect(plan.document.objects[0].cells[0]).toMatchObject({ pos: [-3, 0, 0], state: { properties: { east: "true" } } });
    expect(plan.document.objects[1].cells[0].state.properties.west).toBe("true");
    expect(plan.patches.map(patch => patch.id)).toEqual(["moving", "fixed"]);
    expect(plan.cells.map(cell => cell.owner)).toEqual(["moving", "fixed"]);
    expect(applyMirrorPlan(plan, document, base, materials, rules)).toBe(plan.document);
    expect(() => assertViewEdit(document, plan.document, { ...emptyEditorViewState(), locked: ["fixed"] })).toThrow(/Protected object/);
  });
});
