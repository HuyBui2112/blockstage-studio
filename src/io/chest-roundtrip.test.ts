import { describe, expect, it } from "vitest";
import { gunzipSync } from "fflate";
import type { Material } from "../core/catalog";
import { blockSchema } from "../core/schema";
import { newEditorDocument, sceneBlocks } from "../editor/model";
import { createPlacedObject, rewriteLogicalState } from "../editor/placement";
import { moveObjects } from "../editor/operations";
import { planDuplicate } from "../editor/duplicate-plan";
import { decodePortableBackup, encodePortableBackup } from "./portable-backup";
import { exportEditorStructure } from "./editor-export";
import { inspectStructure } from "./structure-import";
import { readNbt, type NbtTag } from "./nbt-reader";

const catalog: Material[] = [{ id: "minecraft:chest", label: "Chest", family: "chest", color: "#888888",
  properties: { facing: ["north", "east", "south", "west"], type: ["single", "left", "right"], waterlogged: ["false", "true"] },
  defaults: { facing: "north", type: "single", waterlogged: "false" }, source: "game-profile", hasBlockEntity: true }];
describe("bounded single chest inventory", () => {
  it("preserves payload through state/move/JSON and NBT export/import", () => {
    const object = createPlacedObject({ name: "minecraft:chest", properties: catalog[0].defaults }, [-2, 1, 3], catalog);
    object.cells[0].blockEntity = { kind: "chest", items: [{ slot: 0, id: "minecraft:stone", count: 64 }, { slot: 26, id: "minecraft:iron_ingot", count: 1 }] };
    const inventory = object.cells[0].blockEntity;
    const rotated = rewriteLogicalState(object, "facing", "east", catalog);
    expect(rotated.cells[0].blockEntity).toEqual(inventory);
    const base = { ...newEditorDocument(), objects: [rotated] };
    const moved = moveObjects(base, [object.id], [1, 0, 0], "global", catalog);
    const copy = planDuplicate(moved, [object.id], [2, 0, 0], catalog, {
      base: { documentId: moved.id, sessionEpoch: "chest-test", revision: 1 }, operationId: "chest-copy",
    });
    expect(copy.document.objects[1].cells[0].blockEntity).toEqual(inventory);
    expect(copy.document.objects[1].cells[0].blockEntity).not.toBe(moved.objects[0].cells[0].blockEntity);
    const backup = decodePortableBackup(encodePortableBackup({ format: "blockstage-portable", version: 1,
      document: moved, components: [], resources: { adapter: "blockstage-editor-v2-copy", profile: null, packs: [] } }));
    expect(backup.document).toEqual(moved);
    const json = JSON.parse(JSON.stringify(moved));
    const root = readNbt(gunzipSync(exportEditorStructure(json, catalog).bytes));
    const tags = root.value as Record<string, NbtTag>;
    const block = (tags.blocks.value as NbtTag[])[0].value as Record<string, NbtTag>;
    const payload = block.nbt.value as Record<string, NbtTag>;
    const items = payload.Items.value as NbtTag[];
    expect(items[0].value).toEqual({ Slot: { type: 1, value: 0 }, id: { type: 8, value: "minecraft:stone" }, count: { type: 3, value: 64 } });
    const imported = inspectStructure(root, "Chest.nbt", "architecture", catalog);
    expect(sceneBlocks(imported.document)[0]).toMatchObject({ pos: [0, 0, 0], state: { properties: { facing: "east" } }, blockEntity: inventory });
    const first = items[0].value as Record<string, NbtTag>;
    first.components = { type: 10, value: {} };
    expect(() => inspectStructure(root, "Unsupported.nbt", "architecture", catalog)).toThrow("components");
    delete first.components;
    first.Slot = { type: 1, value: 26 };
    expect(() => inspectStructure(root, "Duplicate.nbt", "architecture", catalog)).toThrow("Duplicate");
    first.Slot = { type: 1, value: 27 };
    expect(() => inspectStructure(root, "Outside.nbt", "architecture", catalog)).toThrow();
    expect(() => rewriteLogicalState(rotated, "type", "left", catalog)).toThrow("payload");
  });
  it("rejects unsupported inventory, wrong owners and unknown fields rather than dropping them", () => {
    const cell = { pos: [0, 0, 0], state: { name: "minecraft:chest", properties: catalog[0].defaults }, blockEntity: { kind: "chest", items: [{ id: "minecraft:stone" }] } };
    expect(blockSchema.safeParse(cell).success).toBe(false);
    const parseItems = (items: unknown[]) => blockSchema.safeParse({ ...cell, blockEntity: { kind: "chest", items } }).success;
    expect(parseItems([])).toBe(true);
    for (const item of [
      { slot: -1, id: "minecraft:stone", count: 1 },
      { slot: 27, id: "minecraft:stone", count: 1 },
      { slot: 0, id: "minecraft:stone", count: 65 },
      { slot: 0, id: "minecraft:stone", count: 0 },
      { slot: 0, id: "minecraft:diamond_sword", count: 1 },
      { slot: 0, id: "minecraft:stone", count: 1, components: {} },
      { slot: 0, id: "minecraft:stone", count: Infinity },
    ]) expect(parseItems([item])).toBe(false);
    expect(parseItems([{ slot: 0, id: "minecraft:glass", count: 1 }, { slot: 0, id: "minecraft:stone", count: 1 }])).toBe(false);
    expect(blockSchema.safeParse({ ...cell, blockEntity: { kind: "chest", items: [], CustomName: "unsafe" } }).success).toBe(false);
    expect(blockSchema.safeParse({ ...cell, state: { name: "minecraft:stone", properties: {} }, blockEntity: { kind: "chest", items: [] } }).success).toBe(false);
  });
});
