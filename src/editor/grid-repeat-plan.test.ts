import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS, defaultState, type Material } from "../core/catalog";
import type { NeighborRule, NeighborRules } from "../core/profile";
import type { Vec3 } from "../core/schema";
import { applyCopyAction, planCopyAction } from "./copy-action";
import { applyGridRepeatPlan, planGridRepeat, type GridRepeatIntent } from "./grid-repeat-plan";
import { executeHistory, redoHistory, undoHistory } from "./history";
import { newEditorDocument, objectCells, type EditorDocument, type EditorObject } from "./model";
import { createPlacedObject } from "./placement";
import { assertViewEdit, emptyEditorViewState } from "./view-state";

const bed: Material = {
  id: "minecraft:red_bed", label: "Bed", family: "bed", color: "#aaa",
  properties: { facing: ["north", "east", "south", "west"], part: ["foot", "head"], occupied: ["false", "true"] },
  defaults: { facing: "east", part: "foot", occupied: "false" },
};
const chest: Material = {
  id: "minecraft:chest", label: "Chest", family: "chest", color: "#aaa", hasBlockEntity: true,
  properties: { facing: ["north", "east", "south", "west"], type: ["single", "left", "right"], waterlogged: ["false", "true"] },
  defaults: { facing: "north", type: "single", waterlogged: "false" },
};
const catalog = [...DEMO_MATERIALS, bed, chest];
function block(id: string, pos: Vec3 = [0, 0, 0], type = "minecraft:stone"): EditorObject {
  return { ...createPlacedObject(defaultState(type, catalog), pos, catalog), id };
}
function source(...objects: EditorObject[]): EditorDocument {
  return { ...newEditorDocument(), id: "document", objects };
}
const base = { documentId: "document", sessionEpoch: "epoch", revision: 7 };
const options = { base, operationId: "grid" };
const intent: GridRepeatIntent = { counts: [2, 2, 2], spacing: [4, 5, -6] };

describe("bounded World grid repeat", () => {
  it("counts total positions including origin and enumerates signed XYZ copies X-fastest", () => {
    const document = source(block("stone", [-2, -1, -3]));
    const plan = planGridRepeat(document, ["stone"], intent, catalog, options);
    expect(plan.document.objects).toHaveLength(8);
    expect(plan.document.objects[0]).toBe(document.objects[0]);
    expect(plan.document.objects.slice(1).map((object) => object.cells[0].pos)).toEqual([
      [2, -1, -3], [-2, 4, -3], [2, 4, -3],
      [-2, -1, -9], [2, -1, -9], [-2, 4, -9], [2, 4, -9],
    ]);
    expect(plan.cost).toEqual({ addedObjects: 7, addedCells: 7, resultObjects: 8, resultCells: 8 });
    expect(plan.selection).toEqual(Array.from({ length: 7 }, (_, index) => `grid:${index}`));
    const vertical = planGridRepeat(document, ["stone"], { counts: [1, 2, 1], spacing: [0, -3, 0] }, catalog, options);
    expect(vertical.document.objects[1].cells[0].pos).toEqual([-2, -4, -3]);
  });

  it("keeps nested component provenance, complete pairs, payloads and source entities independent", () => {
    const inventory = block("chest", [0, 1, 0], chest.id);
    inventory.cells[0].blockEntity = { kind: "chest", items: [{ slot: 2, id: "minecraft:stone", count: 64 }] };
    const component: EditorObject = { id: "component", name: "Furniture", kind: "component", componentId: "library-source",
      cells: [], children: [block("bed", [0, 0, 0], bed.id), inventory], pivot2: [1, 1, 1], orientation: 2 };
    const root: EditorObject = { ...component, id: "group", name: "Room", kind: "group", componentId: undefined, children: [component] };
    const document = source(root);
    document.entities = [{ id: "pig", type: "minecraft:pig", position: [1.5, 2, 3.5], yaw: 20 }];
    const before = structuredClone(document);
    const plan = planGridRepeat(document, ["group"], { counts: [2, 1, 2], spacing: [5, 0, -5] }, catalog, options);
    expect(document).toEqual(before);
    expect(plan.document.entities).toBe(document.entities);
    for (const copy of plan.document.objects.slice(1)) {
      expect(copy.kind).toBe("group");
      expect(copy.children[0]).toMatchObject({ componentId: "library-source", orientation: 2 });
      const cells = objectCells(copy);
      expect(cells).toHaveLength(3);
      expect(cells.slice(0, 2).map((cell) => cell.state.properties.part)).toEqual(["foot", "head"]);
      expect(cells[2].blockEntity).toEqual(inventory.cells[0].blockEntity);
      expect(cells[2].blockEntity).not.toBe(inventory.cells[0].blockEntity);
    }
    expect(new Set(plan.addedObjectIds).size).toBe(12);
    expect(plan.cells.map((cell) => cell.owner)).toEqual([
      "grid:0", "grid:0", "grid:0", "grid:4", "grid:4", "grid:4", "grid:8", "grid:8", "grid:8",
    ]);
  });

  it("keeps IDs stable through numeric previews and snapshots mutable intent arrays", () => {
    const document = source(block("stone"));
    const mutable = { counts: [2, 2, 1] as Vec3, spacing: [3, 4, 0] as Vec3 };
    const plan = planGridRepeat(document, ["stone"], mutable, catalog, options);
    const revised = planGridRepeat(document, ["stone"], { counts: [4, 1, 1], spacing: [-3, 0, 0] }, catalog, options);
    expect(plan.addedObjectIds).toEqual(revised.addedObjectIds);
    mutable.counts[0] = 99; mutable.spacing[0] = 99;
    expect(plan.intent).toEqual({ counts: [2, 2, 1], spacing: [3, 4, 0] });
    expect(applyGridRepeatPlan(plan, document, base, catalog)).toBe(plan.document);
  });

  it("rejects malformed counts, meaningless grids, invalid spacing and unsafe extents", () => {
    const document = source(block("stone"));
    for (const counts of [[1, 1, 1], [0, 2, 1], [-1, 2, 1], [1.5, 2, 1], [Infinity, 2, 1], [NaN, 2, 1], [1, 2], [1, 2, 1, 1]])
      expect(() => planGridRepeat(document, ["stone"], { ...intent, counts: counts as Vec3 }, catalog, options)).toThrow(/counts|positions/i);
    for (const spacing of [[0, 1, 1], [.5, 1, 1], [Infinity, 1, 1], [NaN, 1, 1], [1, 1]])
      expect(() => planGridRepeat(document, ["stone"], { ...intent, spacing: spacing as Vec3 }, catalog, options)).toThrow(/spacing/i);
    expect(() => planGridRepeat(document, ["stone"], { counts: [3, 1, 1], spacing: [Number.MAX_SAFE_INTEGER, 0, 0] }, catalog, options)).toThrow(/safe integer/i);
    expect(() => planGridRepeat(document, ["stone"], { counts: [2, 1, 1], spacing: [30000001, 0, 0] }, catalog, options)).toThrow();
  });

  it("bounds multiplied counts and source cell/object budgets before expansion reads", () => {
    const child = block("child");
    const group: EditorObject = { id: "group", name: "Group", kind: "group", cells: [], children: [child], pivot2: [1, 1, 1], orientation: 0 };
    const document = source(group);
    const finite = planGridRepeat(document, ["group"], { counts: [2, 2, 1], spacing: [3, 3, 0] }, catalog,
      { ...options, budget: { maxObjects: 8, maxCells: 4 } });
    expect(finite.cost).toEqual({ addedObjects: 6, addedCells: 3, resultObjects: 8, resultCells: 4 });
    Object.defineProperty(child.cells[0], "state", { get() { throw new Error("Must not read state before budget rejection"); } });
    expect(() => planGridRepeat(document, ["group"], { counts: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 2], spacing: [1, 1, 1] }, catalog, options)).toThrow(/100,000 new copies/);
    expect(() => planGridRepeat(document, ["group"], { counts: [2, 2, 1], spacing: [3, 3, 0] }, catalog,
      { ...options, budget: { maxObjects: 7, maxCells: 4 } })).toThrow(/budget/i);
    expect(() => planGridRepeat(document, ["group"], { counts: [2, 2, 1], spacing: [3, 3, 0] }, catalog,
      { ...options, budget: { maxObjects: 8, maxCells: 3 } })).toThrow(/budget/i);
  });

  it("rejects the entire lattice for original/copy/obstacle collisions or invalid logical selection", () => {
    const pair = block("bed", [0, 0, 0], bed.id);
    expect(() => planGridRepeat(source(pair), ["bed"], { counts: [2, 1, 2], spacing: [1, 0, 3] }, catalog, options)).toThrow(/collision/i);
    const document = source(block("stone"), block("obstacle", [3, 0, 3]));
    expect(() => planGridRepeat(document, ["stone"], { counts: [2, 1, 2], spacing: [3, 0, 3] }, catalog, options)).toThrow(/collision/i);
    expect(document.objects).toHaveLength(2);
    // No copy hits the original selection; two different lattice sites overlap each other.
    const diagonal = source(block("a"), block("b", [3, -3, 0]));
    expect(() => planGridRepeat(diagonal, ["a", "b"], { counts: [2, 2, 1], spacing: [3, 3, 0] }, catalog, options)).toThrow(/collision/i);
    pair.cells.pop();
    expect(() => planGridRepeat(source(pair), ["bed"], intent, catalog, options)).toThrow();
    for (const ids of [[], ["missing"], ["stone", "stone"]])
      expect(() => planGridRepeat(document, ids, intent, catalog, options)).toThrow(/select|missing/i);
  });

  it("retains cancellation and exact source/epoch/revision apply guards", () => {
    const document = source(block("stone")), controller = new AbortController();
    const plan = planGridRepeat(document, ["stone"], intent, catalog, { ...options, signal: controller.signal });
    expect(() => applyGridRepeatPlan(plan, structuredClone(document), base, catalog)).toThrow(/changed/i);
    expect(() => applyGridRepeatPlan(plan, document, { ...base, revision: 8 }, catalog)).toThrow(/changed/i);
    expect(() => applyGridRepeatPlan(plan, document, { ...base, sessionEpoch: "other" }, catalog)).toThrow(/changed/i);
    controller.abort();
    expect(() => applyGridRepeatPlan(plan, document, base, catalog)).toThrow(/cancelled/i);
    expect(() => planGridRepeat(document, ["stone"], intent, catalog, { ...options, signal: controller.signal })).toThrow(/cancelled/i);
  });

  it("finalizes neighbor changes once and keeps policy, atomic history and exact candidates", () => {
    const properties = { north: ["false", "true"], east: ["false", "true"], south: ["false", "true"], west: ["false", "true"] };
    const fence: Material = { id: "minecraft:oak_fence", label: "Fence", family: "fence", color: "#888",
      properties, defaults: { north: "false", east: "false", south: "false", west: "false" } };
    const materials = [...catalog, fence];
    const rule = (kind: NeighborRule["kind"]): NeighborRule => ({ kind, fence: kind === "fence", wooden: true,
      wall: false, forcePost: false, exception: false, properties: [], shapes: { "": [0, 0] } });
    const rules: NeighborRules = { "minecraft:air": rule("other"), [fence.id]: rule("fence") };
    const root = { ...createPlacedObject(defaultState(fence.id, materials), [0, 0, 0], materials), id: "fence" };
    const document = source(root), before = structuredClone(document);
    const plan = planCopyAction(document, ["fence"], { kind: "repeat-grid", counts: [2, 1, 2], spacing: [1, 0, 1] }, null, materials, options, rules);
    expect(plan.cells).toHaveLength(4);
    expect(plan.document.objects[0].cells[0].state.properties).toMatchObject({ east: "true", south: "true" });
    expect(applyCopyAction(plan, document, base, materials, rules)).toBe(plan.document);
    expect(() => applyCopyAction(plan, document, base, materials)).toThrow(/connections changed/i);
    expect(() => assertViewEdit(document, plan.document, { ...emptyEditorViewState(), locked: ["fence"] })).toThrow(/Protected object/);
    const committed = executeHistory({ document, past: [], future: [] }, plan.document, "Grid repeat");
    expect(committed.past).toHaveLength(1);
    expect(undoHistory(committed).document).toEqual(document);
    expect(redoHistory(undoHistory(committed)).document).toEqual(plan.document);
    expect(document).toEqual(before);
  });
});
