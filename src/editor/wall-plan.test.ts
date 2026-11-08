import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS, defaultState, type Material } from "../core/catalog";
import type { NeighborRule, NeighborRules } from "../core/profile";
import type { Vec3 } from "../core/schema";
import { executeHistory, redoHistory, undoHistory } from "./history";
import { newEditorDocument, type EditorDocument, type EditorObject } from "./model";
import { createPlacedObject } from "./placement";
import { assertViewEdit, emptyEditorViewState } from "./view-state";
import { applyWallPlan, planWall, type WallIntent } from "./wall-plan";

const catalog = DEMO_MATERIALS;
const base = { documentId: "document", sessionEpoch: "epoch", revision: 3 };
const options = { base, operationId: "wall" };
const intent: WallIntent = { start: [0, 0, 0], axis: "x", direction: 1, length: 5, height: 4, openings: [], state: defaultState("minecraft:stone", catalog) };
function source(...objects: EditorObject[]): EditorDocument { return { ...newEditorDocument(), id: "document", objects }; }
function block(id: string, pos: Vec3): EditorObject { return { ...createPlacedObject(intent.state, pos, catalog), id }; }

describe("bounded wall with rectangular openings", () => {
  it("enumerates single-cell walls in both signed World horizontal axes", () => {
    for (const axis of ["x", "z"] as const) for (const direction of [1, -1] as const) {
      const plan = planWall(source(), { ...intent, start: [-3, 2, 4], axis, direction, length: 3, height: 2 }, catalog, options);
      expect(plan.cells.map(cell => cell.pos)).toEqual(axis === "x" ? [
        [-3, 2, 4], [-3 + direction, 2, 4], [-3 + 2 * direction, 2, 4],
        [-3, 3, 4], [-3 + direction, 3, 4], [-3 + 2 * direction, 3, 4],
      ] : [
        [-3, 2, 4], [-3, 2, 4 + direction], [-3, 2, 4 + 2 * direction],
        [-3, 3, 4], [-3, 3, 4 + direction], [-3, 3, 4 + 2 * direction],
      ]);
      expect(plan.wallCells).toBe(6); expect(plan.openingCells).toBe(0);
      expect(plan.selection).toEqual(["wall:0", "wall:1", "wall:2", "wall:3", "wall:4", "wall:5"]);
    }
  });

  it("omits disjoint door/window rectangles and preserves old cells inside holes", () => {
    const document = source(block("existing", [1, 0, 0]));
    document.entities = [{ id: "pig", type: "minecraft:pig", position: [1, 2, 3], yaw: 30 }];
    const openings = [{ id: "door", offset: 1, bottom: 0, width: 1, height: 2 }, { id: "window", offset: 3, bottom: 1, width: 2, height: 2 }];
    const plan = planWall(document, { ...intent, openings }, catalog, options);
    expect(plan.wallCells).toBe(14); expect(plan.openingCells).toBe(6);
    expect(plan.document.objects[0]).toBe(document.objects[0]);
    expect(plan.document.entities).toBe(document.entities);
    expect(plan.cells.some(cell => cell.pos[0] === 1 && cell.pos[1] < 2)).toBe(false);
    expect(plan.cells.some(cell => cell.pos[0] >= 3 && cell.pos[1] >= 1 && cell.pos[1] < 3)).toBe(false);
    expect(plan.cells.every(cell => cell.state.name === "minecraft:stone")).toBe(true);
    openings[0].width = 4;
    expect(plan.intent.openings[0].width).toBe(1);
    const committed = executeHistory({ document, past: [], future: [] }, plan.document, "Wall");
    expect(committed.past).toHaveLength(1);
    expect(undoHistory(committed).document).toEqual(document);
    expect(redoHistory(undoHistory(committed)).document).toEqual(plan.document);
  });

  it("rejects invalid, overlapping and fully removing openings; touching rectangles are legal", () => {
    const opening = { id: "a", offset: 0, bottom: 0, width: 1, height: 1 };
    for (const openings of [
      [{ ...opening, offset: -1 }], [{ ...opening, bottom: .5 }], [{ ...opening, width: 0 }], [{ ...opening, width: 6 }],
      [{ ...opening, id: "" }], [opening, opening], [opening, { ...opening, id: "b" }],
      [{ ...opening, width: 5, height: 4 }], Array.from({ length: 33 }, (_, index) => ({ ...opening, id: `o${index}` })),
    ]) expect(() => planWall(source(), { ...intent, openings }, catalog, options)).toThrow();
    expect(planWall(source(), { ...intent, openings: [opening, { ...opening, id: "b", offset: 1 }] }, catalog, options).wallCells).toBe(18);
    for (const override of [{ length: 0 }, { height: -1 }, { length: .5 }, { height: Infinity }, { axis: "y" }, { direction: 0 }])
      expect(() => planWall(source(), { ...intent, ...override } as WallIntent, catalog, options)).toThrow();
  });

  it("counts exact occupied cells before expansion, skips huge holes, and bounds actual footprints", () => {
    const huge: WallIntent = { ...intent, start: [-30000000, -2048, 0], length: 60000001, height: 4097, openings: [
      { id: "all-upper", offset: 0, bottom: 1, width: 60000001, height: 4096 },
      { id: "bottom", offset: 1, bottom: 0, width: 60000000, height: 1 },
    ] };
    const plan = planWall(source(), huge, catalog, options);
    expect(plan.wallCells).toBe(1); expect(plan.cells[0].pos).toEqual([-30000000, -2048, 0]);
    expect(plan.openingCells).toBe(245820004096);
    expect(() => planWall(source(), { ...huge, openings: [] }, catalog, options)).toThrow(/budget/i);
    expect(() => planWall(source(), { ...huge, height: 4098, openings: [
      { ...huge.openings[0], height: 4097 }, huge.openings[1],
    ] }, catalog, options)).toThrow();
    expect(() => planWall(source(), { ...intent, start: [30000000, 0, 0] }, catalog, options)).toThrow();
    expect(() => planWall(source(), { ...intent, start: [0, 2048, 0] }, catalog, options)).toThrow();
  });

  it("rejects combined base budgets before reading states and protects source on collision", () => {
    const object = block("existing", [20, 0, 0]);
    const rootBudget = source(object);
    Object.defineProperty(rootBudget.objects, "0", { get() { throw new Error("ROOT READ"); } });
    expect(() => planWall(rootBudget, intent, catalog, { ...options, budget: { maxCells: 100, maxObjects: 20 } })).toThrow(/budget/i);
    Object.defineProperty(object.cells[0], "state", { get() { throw new Error("STATE READ"); } });
    expect(() => planWall(source(object), intent, catalog, { ...options, budget: { maxCells: 20, maxObjects: 100 } })).toThrow(/budget/i);
    const document = source(block("occupied", [2, 1, 0])), before = structuredClone(document);
    expect(() => planWall(document, intent, catalog, options)).toThrow();
    expect(document).toEqual(before);
    const cyclic = block("cycle", [30, 0, 0]); cyclic.children.push(cyclic);
    expect(() => planWall(source(cyclic), intent, catalog, options)).toThrow(/cycle/i);
  });

  it("rejects logical pairs, preserves selected states, and creates stable independent previews", () => {
    const bed: Material = { id: "minecraft:red_bed", label: "Bed", family: "bed", color: "#aaa", properties: { facing: ["north", "east", "south", "west"], part: ["foot", "head"], occupied: ["false", "true"] }, defaults: { facing: "east", part: "foot", occupied: "false" } };
    expect(() => planWall(source(), { ...intent, state: defaultState(bed.id, [bed]) }, [...catalog, bed], options)).toThrow(/one logical cell/i);
    const slab = defaultState("minecraft:stone_brick_slab", catalog); slab.properties.type = "top";
    const document = source(), first = planWall(document, { ...intent, state: slab }, catalog, options), second = planWall(document, { ...intent, state: slab }, catalog, options);
    expect(first.document).toEqual(second.document);
    expect(first.cells.every(cell => cell.state.properties.type === "top")).toBe(true);
    expect(first.cells[0].state).not.toBe(first.cells[1].state);
    expect(applyWallPlan(first, document, base, catalog)).toBe(first.document);
    expect(() => applyWallPlan(first, { ...document }, base, catalog)).toThrow();
    expect(() => applyWallPlan(first, document, { ...base, revision: 4 }, catalog)).toThrow();
    const controller = new AbortController(), pending = planWall(document, intent, catalog, { ...options, signal: controller.signal });
    controller.abort(); expect(() => applyWallPlan(pending, document, base, catalog)).toThrow(/cancel/i);
  });

  it("finalizes connections exactly once and includes protected neighbor patches", () => {
    const fence: Material = { id: "minecraft:oak_fence", label: "Fence", family: "fence", color: "#888", properties: { north: ["false", "true"], east: ["false", "true"], south: ["false", "true"], west: ["false", "true"] }, defaults: { north: "false", east: "false", south: "false", west: "false" } };
    const materials = [...catalog, fence];
    const rule = (kind: NeighborRule["kind"]): NeighborRule => ({ kind, fence: kind === "fence", wooden: true, wall: false, forcePost: false, exception: false, properties: [], shapes: { "": [0, 0] } });
    const rules: NeighborRules = { "minecraft:air": rule("other"), [fence.id]: rule("fence") };
    const fixed = { ...createPlacedObject(defaultState(fence.id, materials), [-1, 0, 0], materials), id: "fixed" };
    const document = source(fixed), plan = planWall(document, { ...intent, length: 2, height: 1, state: defaultState(fence.id, materials) }, materials, options, rules);
    expect(plan.document.objects[0].cells[0].state.properties.east).toBe("true");
    expect(plan.patches.map(patch => patch.id)).toEqual(["fixed", "wall:0", "wall:1"]);
    expect(applyWallPlan(plan, document, base, materials, rules)).toBe(plan.document);
    expect(() => applyWallPlan(plan, document, base, materials)).toThrow(/policy/i);
    expect(() => assertViewEdit(document, plan.document, { ...emptyEditorViewState(), locked: ["fixed"] })).toThrow(/Protected object/);
  });
});
