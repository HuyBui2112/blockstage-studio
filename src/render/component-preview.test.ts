import { strToU8 } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { DEMO_MATERIALS, type Material } from "../core/catalog";
import type { Block } from "../core/schema";
import type { ComponentAsset, EditorObject } from "../editor/model";
import { inspectComponentPreview } from "./component-preview";
import { ModelResolver } from "./models";

function asset(cells: Block[]): ComponentAsset {
  return { schemaVersion: 1, id: "asset", name: "Preview", objects: [{ id: "root", name: "Root", kind: "component",
    cells, children: [], pivot2: [1, 1, 1], orientation: 0 }], pivot2: [1, 1, 1], size: [1, 1, 1], orientation: 0 };
}
function stone(pos: Block["pos"] = [0, 0, 0]): Block { return { pos, state: { name: "minecraft:stone", properties: {} } }; }
function resolver() {
  return new ModelResolver([{ id: "pack", name: "Pack", gameVersion: "26.2", priority: 0, enabled: true,
    counts: { textures: 1, models: 1, blockstates: 1, entityTextures: 0 }, files: {
      "assets/minecraft/blockstates/stone.json": strToU8(JSON.stringify({ variants: { "": { model: "minecraft:block/stone" } } })),
      "assets/minecraft/models/block/stone.json": strToU8(JSON.stringify({ textures: { all: "minecraft:block/stone" }, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "#all" } } }] })),
      "assets/minecraft/textures/block/stone.png": new Uint8Array([1]),
    } }]);
}
describe("bounded component resource preview", () => {
  it("normalizes complete nested geometry without changing source states, IDs or payload", () => {
    const source = asset([stone([-10, 2, 8])]);
    const payload: Block = { pos: [-9, 3, 9], state: { name: "minecraft:chest", properties: { facing: "north", type: "single", waterlogged: "false" } }, blockEntity: { kind: "chest", items: [{ slot: 26, id: "minecraft:stone", count: 64 }] } };
    const beam: EditorObject = { ...source.objects[0], id: "beam", kind: "block" };
    const child: EditorObject = { ...source.objects[0], id: "child", kind: "block", cells: [payload] };
    const bed: EditorObject = { ...source.objects[0], id: "bed", kind: "multiblock", cells: [
      { pos: [-8, 2, 8], state: { name: "minecraft:red_bed", properties: { facing: "east", part: "foot", occupied: "false" } } },
      { pos: [-7, 2, 8], state: { name: "minecraft:red_bed", properties: { facing: "east", part: "head", occupied: "false" } } },
    ] };
    source.objects[0] = { ...source.objects[0], kind: "group", cells: [], children: [beam, child, bed] };
    const before = structuredClone(source);
    const result = inspectComponentPreview(source, DEMO_MATERIALS, null, resolver());
    expect(result.blocks.map(cell => cell.pos)).toEqual([[0, 0, 0], [1, 1, 1], [2, 0, 0], [3, 0, 0]]);
    expect(result.blocks[1].blockEntity).toEqual(payload.blockEntity);
    expect(result.blocks.slice(2).map(cell => cell.state.properties.part)).toEqual(["foot", "head"]);
    expect(result.blocks.every(cell => cell.owner === source.id)).toBe(true);
    expect(source).toEqual(before);
  });
  it("deduplicates exact states and skips air while retaining stored counts", () => {
    const models = resolver(), resolve = vi.spyOn(models, "resolve");
    const result = inspectComponentPreview(asset([stone(), stone([1, 0, 0]), { pos: [2, 0, 0], state: { name: "minecraft:air", properties: {} } }]), DEMO_MATERIALS, null, models);
    expect(result).toMatchObject({ checkedStates: 1, storedCells: 3, nonAirCells: 2, status: "ready", complete: true });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it("reports unavailable resources and unknown or illegal registry states honestly", () => {
    expect(inspectComponentPreview(asset([stone()]), DEMO_MATERIALS, null, new ModelResolver([]))).toMatchObject({ status: "unavailable", checkedStates: 1 });
    const unknown = inspectComponentPreview(asset([stone()]), [], null, resolver());
    expect(unknown.status).toBe("unavailable"); expect(unknown.issues.join(" ")).toContain("Registry unavailable");
    const invalid = stone(); invalid.state.properties = { unknown: "true" };
    expect(inspectComponentPreview(asset([invalid]), DEMO_MATERIALS, null, resolver()).status).toBe("unavailable");
  });
  it("never crops an oversized component into a misleading partial 3D shape", () => {
    const source = asset(Array.from({ length: 10001 }, (_, x) => stone([x, 0, 0])));
    const result = inspectComponentPreview(source, DEMO_MATERIALS, null, resolver());
    expect(result).toMatchObject({ status: "limited", blocks: [], complete: false, nonAirCells: 10001, checkedStates: 0 });
  });
  it("bounds unique-state checks and rendered issue rows without claiming full readiness", () => {
    const materials: Material[] = Array.from({ length: 300 }, (_, index) => ({ ...DEMO_MATERIALS[0], id: `fixture:block_${index}`, properties: {}, defaults: {} }));
    const source = asset(materials.map((material, x) => ({ pos: [x, 0, 0], state: { name: material.id, properties: {} } })));
    const result = inspectComponentPreview(source, materials, null, new ModelResolver([]));
    expect(result).toMatchObject({ status: "limited", complete: false, checkedStates: 256 });
    expect(result.blocks).toHaveLength(300); expect(result.issues).toHaveLength(20); expect(result.totalIssues).toBeGreaterThan(20);
  });
  it("rejects cyclic trees and aggregate limits before reading oversized cells", () => {
    const cyclic = asset([stone()]); cyclic.objects[0].children.push(cyclic.objects[0]);
    expect(() => inspectComponentPreview(cyclic, DEMO_MATERIALS, null, resolver())).toThrow(/cycle/);
    const cells = Array.from({ length: 100001 }, () => stone());
    Object.defineProperty(cells, "0", { get() { throw new Error("CELL READ"); } });
    expect(() => inspectComponentPreview(asset(cells), DEMO_MATERIALS, null, resolver())).toThrow(/limits/);
  });
});
