import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { createCapabilityResolver } from "../core/capabilities";
import { DEMO_MATERIALS } from "../core/catalog";
import type { EntityModelPart, GameProfile } from "../core/profile";
import type { BlockState } from "../core/schema";
import { assessAppearance } from "./appearance-capability";
import { ModelResolver } from "./models";

const part: EntityModelPart = {
  position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
  polygons: [], omittedPolygons: 0, children: {},
};
function profile(layers: string[] = []): GameProfile {
  return {
    schemaVersion: 1, gameVersion: "26.2", dataVersion: 4903,
    sourceSha1: "a".repeat(40), blocks: [], entities: [], creativeTabs: [],
    entityModels: Object.fromEntries(layers.map((layer) => [layer, part])),
    dyeColors: { red: 0xb02e26 },
  };
}
function resolver(files: Record<string, Uint8Array> = {}) {
  return new ModelResolver([{
    id: "fixture", name: "fixture", enabled: true, priority: 0,
    gameVersion: "26.2", files,
    counts: { textures: 0, models: 0, blockstates: 0, entityTextures: 0 },
  }]);
}
function jsonModel(id: string): Record<string, Uint8Array> {
  const path = id.replace(":", "/");
  return {
    [`assets/${path.split("/")[0]}/blockstates/${path.split("/")[1]}.json`]: strToU8(JSON.stringify({
      variants: { "": { model: `${id.split(":")[0]}:block/${id.split(":")[1]}` } },
    })),
    [`assets/${id.split(":")[0]}/models/block/${id.split(":")[1]}.json`]: strToU8(JSON.stringify({
      textures: { all: "fixture:block/plain" },
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "#all" } } }],
    })),
    "assets/fixture/textures/block/plain.png": new Uint8Array([1]),
  };
}
const state = (id: string, properties: Record<string, string> = {}): BlockState => ({ name: id, properties });

describe("resource-dependent appearance capabilities", () => {
  it("keeps model availability separate from legal placement and world proof", () => {
    const stone = state("minecraft:stone");
    const input = { kind: "block" as const, id: stone.name, state: stone, profile: null };
    const unavailable = assessAppearance({ ...input, resolver: resolver() });
    const capabilities = createCapabilityResolver(DEMO_MATERIALS);
    expect(unavailable.status).toBe("unsupported");
    expect(capabilities.block(stone, "design").supported).toBe(true);
    expect(capabilities.block(stone, "appearance", { appearance: unavailable }).supported).toBe(false);
    const available = assessAppearance({ ...input, resolver: resolver(jsonModel(stone.name)) });
    expect(available.status).toBe("supported");
    expect(available.evidence).toContain("pixel-parity:unverified");
    expect(capabilities.block(stone, "world").status).toBe("unverified");
    const missingTexture = jsonModel(stone.name);
    delete missingTexture["assets/fixture/textures/block/plain.png"];
    expect(assessAppearance({ ...input, resolver: resolver(missingTexture) }).reason).toContain("textures/block/plain.png");
  });

  it("distinguishes entity layers, textures and static-only appearance from editing/export", () => {
    const pig = state("minecraft:pig");
    const input = { kind: "entity" as const, id: pig.name, state: pig };
    expect(assessAppearance({ ...input, profile: null, resolver: resolver() }).reason).toContain("model layer");
    const pigProfile = profile(["minecraft:pig#main"]);
    expect(assessAppearance({ ...input, profile: pigProfile, resolver: resolver() }).reason).toContain("entity texture");
    const available = assessAppearance({ ...input, profile: pigProfile, resolver: resolver({
      "assets/minecraft/textures/entity/pig/pig_temperate.png": new Uint8Array([1]),
    }) });
    expect(available.status).toBe("partial");
    expect(available.supported).toBe(true);
    const slime = state("minecraft:slime");
    const slimeAppearance = assessAppearance({ kind: "entity", id: slime.name, state: slime,
      profile: profile(["minecraft:slime#main"]), resolver: resolver({
        "assets/minecraft/textures/entity/slime/slime.png": new Uint8Array([1]),
      }) });
    expect(slimeAppearance.supported).toBe(true);
    const capabilities = createCapabilityResolver([]);
    expect(capabilities.entity(slime.name, "design").supported).toBe(false);
    expect(capabilities.entity(slime.name, "structure-export").supported).toBe(false);
    expect(assessAppearance({ ...input, id: "mod:pig", profile: pigProfile, resolver: resolver() }).reason).toContain("No static renderer adapter");
  });

  it("reports special renderer requirements and finite static coverage without throwing", () => {
    const banner = state("minecraft:red_banner", { rotation: "0" });
    const input = { kind: "block" as const, id: banner.name, state: banner };
    expect(assessAppearance({ ...input, profile: null, resolver: resolver() }).reason).toContain("model layers");
    const bannerProfile = profile(["minecraft:standing_banner#main", "minecraft:standing_banner#flag"]);
    const assets = resolver({
      "assets/minecraft/textures/entity/banner/banner_base.png": new Uint8Array([1]),
      "assets/minecraft/textures/entity/banner/base.png": new Uint8Array([1]),
    });
    expect(assessAppearance({ ...input, profile: bannerProfile, resolver: assets })).toMatchObject({
      status: "partial", supported: true,
    });
    expect(assessAppearance({ ...input, profile: { ...bannerProfile, dyeColors: undefined }, resolver: assets }).reason).toContain("dye colors");
    expect(assessAppearance({ ...input, state: state("minecraft:red_wall_banner", { facing: "up" }), profile: bannerProfile, resolver: assets }).reason).toContain("legal orientation");
  });

  it("preserves JSON override fallback when chest resources are missing", () => {
    const chest = state("minecraft:chest", { type: "single", facing: "north", waterlogged: "false" });
    const input = { kind: "block" as const, id: chest.name, state: chest, profile: null };
    expect(assessAppearance({ ...input, resolver: resolver() }).reason).toContain("Missing model layer");
    expect(assessAppearance({ ...input, resolver: resolver(jsonModel(chest.name)) }).status).toBe("supported");
    const chestResources = resolver({ "assets/minecraft/textures/entity/chest/normal.png": new Uint8Array([1]) });
    expect(assessAppearance({ ...input, profile: profile(["minecraft:chest#main"]), resolver: chestResources }).status).toBe("partial");
  });

  it("does not infer fluid or invisible runtime appearance from a JSON model", () => {
    const water = state("minecraft:water", { level: "0" });
    const input = { kind: "block" as const, id: water.name, state: water, profile: null,
      resolver: resolver(jsonModel(water.name)) };
    expect(assessAppearance(input).reason).toContain("Fluid rendering is not supported");
    const invisible = state("minecraft:fixture");
    expect(assessAppearance({ ...input, id: invisible.name, state: invisible,
      material: { ...DEMO_MATERIALS[0], id: invisible.name, renderShape: "INVISIBLE" },
      resolver: resolver(jsonModel(invisible.name)),
    }).status).toBe("unsupported");
  });

  it("recognizes an intentionally empty complete wall using profile predicates, not its name", () => {
    const wall = state("minecraft:cobblestone_wall", {
      up: "false", north: "none", east: "none", south: "none", west: "none", waterlogged: "false",
    });
    const material = {
      ...DEMO_MATERIALS[0], id: wall.name, source: "game-profile" as const, hasBlockEntity: false,
      defaults: wall.properties,
      properties: { up: ["false", "true"], north: ["none", "low", "tall"], east: ["none", "low", "tall"],
        south: ["none", "low", "tall"], west: ["none", "low", "tall"], waterlogged: ["false", "true"] },
    };
    const wallProfile = { ...profile(), neighborRules: { [wall.name]: {
      kind: "wall" as const, fence: false, wooden: false, wall: true, forcePost: false, exception: false,
      properties: [], shapes: {},
    } } };
    const emptyModel = resolver({ "assets/minecraft/blockstates/cobblestone_wall.json": strToU8('{"multipart":[]}') });
    const input = { kind: "block" as const, id: wall.name, state: wall, material, profile: wallProfile, resolver: emptyModel };
    expect(assessAppearance(input)).toMatchObject({ status: "supported", label: "Empty wall state" });
    expect(assessAppearance({ ...input, profile: profile() }).status).toBe("unsupported");
    expect(assessAppearance({ ...input, material: { ...material, source: undefined } }).status).toBe("unsupported");
    expect(assessAppearance({ ...input, state: { ...wall, properties: { ...wall.properties, north: "low" } } }).status).toBe("unsupported");
    const incomplete: Record<string, string> = { ...wall.properties };
    delete incomplete.waterlogged;
    expect(assessAppearance({ ...input, state: { ...wall, properties: incomplete } }).status).toBe("unsupported");
  });
});
