import { describe, expect, it } from "vitest";
import { defaultState, DEMO_MATERIALS, type Material } from "../core/catalog";
import { key, type Block, type Vec3 } from "../core/schema";
import { newEditorDocument } from "./model";
import { insertObject } from "./operations";
import { createPlacedObject } from "./placement";
import { planBlockPlacement, type PlacementOptions } from "./placement-plan";
import { createHistory, executeHistory, redoHistory, undoHistory } from "./history";

const door: Material = { id: "minecraft:oak_door", label: "Door", family: "door", color: "#fff",
  properties: { facing: ["north", "east", "south", "west"], half: ["lower", "upper"], hinge: ["left", "right"], open: ["false", "true"], powered: ["false", "true"] },
  defaults: { facing: "north", half: "lower", hinge: "right", open: "false", powered: "false" } };
const catalog = [...DEMO_MATERIALS, door, { ...door, id: "minecraft:iron_door" }];
const pos: Vec3 = [-8, -3, -6];
const stone = (offset: Vec3): Block => ({ pos: pos.map((n, i) => n + offset[i]) as Vec3, state: defaultState("minecraft:stone", catalog) });
const context: PlacementOptions = { mode: "context", turns: 0 };
function plan(cells: Block[], facing = "north", local = 0.5, options = context) {
  const look: Record<string, Vec3> = { north: [0, 0, -1], east: [1, 0, 0], south: [0, 0, 1], west: [-1, 0, 0] };
  const source = { name: door.id, properties: { ...door.defaults, open: "true", powered: "true" } };
  return planBlockPlacement(source, pos, catalog, { pos, point: [pos[0] + local, pos[1], pos[2] + local], face: [0, 1, 0], look: look[facing] }, options,
    undefined, new Map(cells.map((cell) => [key(cell.pos), cell])));
}
const hinge = (result: ReturnType<typeof plan>) => result.object.cells.map((cell) => cell.state.properties.hinge);

describe("Context door hinge planning", () => {
  it("uses strict click-side boundaries at negative coordinates in all four facings", () => {
    for (const facing of ["north", "east", "south", "west"]) {
      expect(hinge(plan([], facing, 0.5))).toEqual(["left", "left"]);
      const rightAtLow = ["south", "west"].includes(facing);
      expect(hinge(plan([], facing, 0.5 - 1e-6))).toEqual(Array(2).fill(rightAtLow ? "right" : "left"));
      expect(hinge(plan([], facing, 0.5 + 1e-6))).toEqual(Array(2).fill(rightAtLow ? "left" : "right"));
    }
  });
  it("counts both heights on both sides before falling back to the hit", () => {
    expect(hinge(plan([stone([1, 0, 0])], "north", 0.25))).toEqual(["right", "right"]);
    expect(hinge(plan([stone([-1, 1, 0])], "north", 0.75))).toEqual(["left", "left"]);
    expect(hinge(plan([stone([-1, 0, 0]), stone([1, 1, 0])], "north", 0.75))).toEqual(["right", "right"]);
  });
  it("uses lower adjacent doors across IDs/facings and leaves every neighbor unchanged", () => {
    const adjacent = createPlacedObject(defaultState("minecraft:iron_door", catalog), [-9, -3, -6], catalog);
    const before = structuredClone(adjacent);
    expect(hinge(plan(adjacent.cells, "north", 0.25))).toEqual(["right", "right"]);
    expect(adjacent).toEqual(before);
    const shifted = adjacent.cells.map((cell) => ({ ...cell, pos: [cell.pos[0], cell.pos[1] - 1, cell.pos[2]] as Vec3 }));
    expect(hinge(plan(shifted, "north", 0.25))).toEqual(["left", "left"]);
  });
  it("derives hinge after yaw, keeps explicit open/power and preserves Design", () => {
    const result = plan([], "north", 0.75, { mode: "context", turns: 3 });
    expect(result.object.cells.every((cell) => cell.state.properties.facing === "west" && cell.state.properties.open === "true" && cell.state.properties.powered === "true")).toBe(true);
    expect(hinge(result)).toEqual(["left", "left"]);
    expect(hinge(plan([], "north", 0.25, { mode: "design", turns: 0 }))).toEqual(["right", "right"]);
  });
  it("retains explicit hinge with a reason for unknown or illegal neighbor states", () => {
    const unsupported: Block[] = [
      { ...stone([1, 0, 0]), state: { name: "minecraft:unrecognized", properties: {} } },
      { ...stone([1, 0, 0]), state: { name: "minecraft:stone", properties: { invented: "true" } } },
      { ...stone([1, 0, 0]), state: { name: "minecraft:air", properties: { invented: "true" } } },
    ];
    for (const neighbor of unsupported) {
      const result = plan([neighbor], "north", 0.25);
      expect(hinge(result)).toEqual(["right", "right"]);
      expect(result.notes.join(" ")).toContain("selected hinge is preserved");
    }
  });
  it("inserts the exact whole pair with one Undo/Redo and rejects collisions atomically", () => {
    const result = plan([stone([1, 0, 0])]);
    const before = newEditorDocument();
    const after = insertObject(before, result.object, catalog);
    const history = executeHistory(createHistory(before), after, "Place door");
    expect(undoHistory(history).document).toEqual(before);
    expect(redoHistory(undoHistory(history)).document).toEqual(after);
    expect(() => insertObject(after, { ...result.object, id: "second-door" }, catalog)).toThrow();
    expect(history.document).toEqual(after);
  });
});
