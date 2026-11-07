import { describe, expect, it } from "vitest";
import { createCapabilityResolver, capabilityDecision, resolveEntityCapability } from "./capabilities";
import { DEMO_MATERIALS, defaultState, type Material } from "./catalog";
import type { NeighborRules } from "./profile";
import type { Block, BlockState } from "./schema";
import { entityAppearance } from "../render/entities";
import { ModelResolver } from "../render/models";
import { createPlacedObject } from "../editor/placement";
import { newEditorDocument } from "../editor/model";
import { rotateObjects } from "../editor/operations";
import { addEntity } from "../editor/entity-operations";
import { preflightEditorExport } from "../io/editor-export";
import { structureStateError } from "../io/structure";

const material = (id: string, properties: Record<string, string[]> = {}, defaults: Record<string, string> = {}): Material => ({
  id, label: id, family: "fixture", color: "#888888", source: "game-profile", properties, defaults,
});
const chest = { ...material("minecraft:chest", {
  facing: ["north", "east", "south", "west"], type: ["single", "left", "right"], waterlogged: ["false", "true"],
}, { facing: "north", type: "single", waterlogged: "false" }), hasBlockEntity: true };
const door = material("minecraft:oak_door", { facing: ["north"], half: ["lower", "upper"], hinge: ["left", "right"] },
  { facing: "north", half: "lower", hinge: "left" });
const catalog = [...DEMO_MATERIALS, chest, door];

describe("versioned action capability resolver", () => {
  it("separates registry, resources, editing and export without changing input", () => {
    const mod = { ...material("fixture:oak_log", { axis: ["x", "y", "z"] }, { axis: "x" }), source: undefined };
    const state = defaultState(mod.id, [mod]), before = structuredClone(state);
    const resolver = createCapabilityResolver([mod]);
    expect(resolver.block(state, "registry").supported).toBe(true);
    expect(resolver.block(state, "design").supported).toBe(true);
    expect(resolver.block(state, "structure-export").supported).toBe(false);
    expect(resolver.block(state, "context").supported).toBe(false);
    expect(resolver.block(state, "appearance").status).toBe("unverified");
    const appearance = capabilityDecision("appearance", "fixture:render", "supported", "Synthetic resource model");
    expect(resolver.block(state, "appearance", { appearance })).toBe(appearance);
    expect(resolver.block(state, "structure-export", { appearance }).supported).toBe(false);
    expect(resolver.block(state, "world", { appearance })).toMatchObject({ supported: false, status: "unverified" });
    expect(state).toEqual(before);
  });

  it("rejects a different game target for every capability family and replacement", () => {
    for (const target of [{ gameVersion: "26.1", dataVersion: 4903 }, { gameVersion: "26.2", dataVersion: 4902 }]) {
      const resolver = createCapabilityResolver(catalog, { target });
      for (const action of ["registry", "appearance", "design", "context", "yaw", "payload-edit", "structure-export", "world"] as const) {
        expect(resolver.block(defaultState("minecraft:oak_log"), action)).toMatchObject({ supported: false, status: "unsupported", target });
        expect(resolver.entity("minecraft:pig", action).supported).toBe(false);
      }
      expect(resolver.replacement(defaultState("minecraft:oak_log"), "minecraft:spruce_log").supported).toBe(false);
    }
  });

  it("keeps complete string-state validation and declares contextual derived fields", () => {
    const resolver = createCapabilityResolver(catalog);
    const invalidStates: BlockState[] = [
      { name: "minecraft:oak_log", properties: {} },
      { name: "minecraft:oak_log", properties: { axis: "diagonal" } },
      { name: "minecraft:oak_log", properties: { axis: "y", extra: "true" } },
    ];
    for (const state of invalidStates) for (const action of ["registry", "design", "context", "yaw", "structure-export"] as const)
      expect(resolver.block(state, action).supported).toBe(false);
    const context = resolver.block(defaultState(door.id, catalog), "context");
    expect(context).toMatchObject({ supported: true, status: "partial", derivedProperties: ["facing"] });
    expect(context.preservedProperties).toContain("hinge");
    expect(context.evidence).toContain("world-readback:unverified");
    expect(resolver.block(defaultState("minecraft:oak_log"), "mirror").supported).toBe(true);
  });

  it("matches actual logical placement and yaw rejection rather than rotating only appearance", () => {
    const unknown = material("fixture:door", { half: ["lower", "upper"] }, { half: "lower" });
    const orientation = material("fixture:machine", { orientation: ["north_up"] }, { orientation: "north_up" });
    const values = [...catalog, unknown, orientation];
    const resolver = createCapabilityResolver(values), state = defaultState(unknown.id, values);
    expect(resolver.block(state, "design").supported).toBe(false);
    expect(() => createPlacedObject(state, [0, 0, 0], values)).toThrow(resolver.block(state, "design").reason);
    const object = createPlacedObject(defaultState(orientation.id, values), [0, 0, 0], values);
    const decision = resolver.block(object.cells[0].state, "yaw");
    expect(decision.supported).toBe(false);
    expect(() => rotateObjects({ ...newEditorDocument(), objects: [object] }, [object.id], 1, "active", values)).toThrow(decision.reason);
  });

  it("matches chest payload permissions with actual export preflight and schema boundaries", () => {
    const resolver = createCapabilityResolver(catalog), state = defaultState(chest.id, catalog);
    const payload: Block["blockEntity"] = { kind: "chest", items: [{ slot: 26, id: "minecraft:stone", count: 64 }] };
    for (const action of ["payload-preserve", "payload-edit", "payload-copy", "payload-transform"] as const)
      expect(resolver.block(state, action, { payload }).supported).toBe(true);
    const object = createPlacedObject(state, [0, 0, 0], catalog);
    object.cells[0].blockEntity = payload;
    expect(preflightEditorExport({ ...newEditorDocument(), objects: [object] }, catalog).valid).toBe(true);
    expect(resolver.block(state, "structure-export", { payload }).supported).toBe(true);
    expect(resolver.block(state, "structure-import", { payload }).supported).toBe(true);
    const missing = resolver.block(state, "structure-export");
    expect(missing.supported).toBe(false);
    expect(structureStateError(state, new Map(catalog.map((m) => [m.id, m])))).toBe(missing.reason);
    for (const invalid of [
      { kind: "chest", items: [{ slot: 0, id: "minecraft:diamond_sword", count: 1 }] },
      { kind: "chest", items: [], CustomName: "opaque" },
      { kind: "chest", items: [{ slot: 0, id: "minecraft:stone", count: 65 }] },
    ]) expect(resolver.block(state, "payload-edit", { payload: invalid as Block["blockEntity"] }).supported).toBe(false);
    expect(resolver.block({ ...state, properties: { ...state.properties, type: "left" } }, "payload-copy", { payload }).supported).toBe(false);
    expect(resolver.block(defaultState("minecraft:stone"), "translate", { payload }).supported).toBe(false);
  });

  it("does not turn a static block-entity renderer into payload/import/export permission", () => {
    const banner = { ...material("minecraft:red_banner", { rotation: ["0"] }, { rotation: "0" }), hasBlockEntity: true };
    const resolver = createCapabilityResolver([banner]), state = defaultState(banner.id, [banner]);
    expect(resolver.block(state, "design").status).toBe("partial");
    expect(resolver.block(state, "payload-edit").supported).toBe(false);
    expect(resolver.block(state, "structure-export").supported).toBe(false);
    expect(resolver.block(state, "structure-import")).toMatchObject({ supported: false, reason: expect.stringContaining("import") });
  });

  it("declares finite neighbor coverage without inferring adapters from tags or a shape property", () => {
    const other = { ...DEMO_MATERIALS.find((m) => m.id === "minecraft:oak_stairs")!, id: "minecraft:stone_stairs" };
    const rules: NeighborRules = {};
    const resolver = createCapabilityResolver([...catalog, other], { profile: { entities: [], neighborRules: rules } });
    expect(resolver.block(defaultState("minecraft:oak_stairs"), "neighbors").status).toBe("partial");
    expect(resolver.block({ name: other.id, properties: other.defaults }, "context").supported).toBe(true);
    expect(resolver.block({ name: other.id, properties: other.defaults }, "neighbors").supported).toBe(false);
    expect(createCapabilityResolver(catalog).block(defaultState("minecraft:oak_stairs"), "neighbors").supported).toBe(false);
  });

  it("keeps entity registry, static bindings, numeric editing, formats and world behavior independent", () => {
    const resolver = createCapabilityResolver(catalog);
    expect(resolver.entity("minecraft:pig", "registry").supported).toBe(false);
    expect(resolver.entity("minecraft:pig", "design").supported).toBe(true);
    expect(resolver.entity("minecraft:cow", "design").supported).toBe(false);
    expect(resolver.entity("minecraft:cow", "structure-export").supported).toBe(true);
    expect(resolver.entity("minecraft:slime", "structure-export").supported).toBe(false);
    expect(resolver.entity("minecraft:pig", "structure-import").supported).toBe(false);
    expect(resolver.entity("minecraft:pig", "world").status).toBe("unverified");
    expect(resolver.entity("fixture:pig", "design").supported).toBe(false);
    const document = newEditorDocument(), entity = { id: "cow", type: "minecraft:cow", position: [0, 0, 0] as [number, number, number], yaw: 0 };
    expect(() => addEntity(document, entity, catalog)).toThrow(resolver.entity(entity.type, "design").reason);
    const preflight = preflightEditorExport({ ...document, entities: [{ ...entity, type: "minecraft:slime" }] }, catalog);
    expect(preflight.issues).toContainEqual(expect.objectContaining({ code: "unsupported_entity", message: resolveEntityCapability("minecraft:slime", "structure-export").reason }));
    expect(entityAppearance("fixture:pig", null, new ModelResolver([]))).toBeUndefined();
  });

  it("composes replacement metadata while preserving the exact material contract", () => {
    const resolver = createCapabilityResolver(catalog), result = resolver.replacement(defaultState("minecraft:oak_log"), "minecraft:spruce_log");
    expect(result).toMatchObject({ action: "replace", status: "supported", adapterId: "blockstage:replacement-v1", family: "pillar", target: { gameVersion: "26.2", dataVersion: 4903 } });
    expect(result.evidence.filter((value) => value === "world-readback:unverified")).toHaveLength(1);
    expect(resolver.replacement(defaultState("minecraft:oak_log"), "minecraft:oak_stairs").supported).toBe(false);
  });
});
