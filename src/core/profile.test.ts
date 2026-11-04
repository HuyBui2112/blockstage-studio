import { describe, expect, it } from "vitest";
import { gameProfileSchema, profileMaterials } from "./profile";
import { newProject } from "./seed";
import { projectSchema } from "./schema";

const profileFixture = () => ({
  schemaVersion: 1 as const,
  gameVersion: "26.2" as const,
  dataVersion: 4903 as const,
  sourceSha1: "0123456789abcdef0123456789abcdef01234567",
  blocks: [
    {
      id: "minecraft:plain_block",
      translationKey: "block.test.plain_block",
      defaults: {},
      properties: {},
      stateCount: 1,
      hasBlockEntity: false,
      gravity: false,
      friction: 0.6,
      blastResistance: 6,
      item: "minecraft:plain_block",
    },
    {
      id: "minecraft:facing_block",
      translationKey: "block.test.facing_block",
      defaults: { facing: "north" },
      properties: { facing: ["north", "south"] },
      stateCount: 2,
      hasBlockEntity: false,
      gravity: false,
      friction: 0.6,
      blastResistance: 6,
      item: "minecraft:facing_block",
    },
  ],
  entities: [
    {
      id: "minecraft:pig",
      width: 0.9,
      height: 0.9,
      category: "creature",
      summonable: true,
    },
  ],
  creativeTabs: [
    {
      id: "minecraft:building_blocks",
      label: "Building Blocks",
      items: ["minecraft:facing_block"],
    },
  ],
  entityModels: {},
});

describe("game profile schema", () => {
  it("parses a small synthetic profile and maps its own block count and tab membership", () => {
    const profile = gameProfileSchema.parse(profileFixture());
    const materials = profileMaterials(profile);
    expect(profile.blocks).toHaveLength(2);
    expect(materials.map((m) => m.id)).toEqual([
      "minecraft:plain_block",
      "minecraft:facing_block",
    ]);
    expect(materials[1]).toMatchObject({
      source: "game-profile",
      defaults: { facing: "north" },
      properties: { facing: ["north", "south"] },
      creativeTabs: ["minecraft:building_blocks"],
    });
  });

  it("rejects duplicate block IDs and defaults absent from their finite property values", () => {
    const fixture = profileFixture();
    expect(
      gameProfileSchema.safeParse({
        ...fixture,
        blocks: [fixture.blocks[0], fixture.blocks[0]],
      }).success,
    ).toBe(false);
    expect(
      gameProfileSchema.safeParse({
        ...fixture,
        blocks: [{ ...fixture.blocks[1], defaults: { facing: "east" } }],
      }).success,
    ).toBe(false);
  });

  it("defaults entities when loading project JSON saved before entity support", () => {
    const oldProject = newProject();
    const { entities: _entities, ...beforeEntitySupport } = oldProject;
    expect(projectSchema.parse(beforeEntitySupport).entities).toEqual([]);
  });

  it("validates entity IDs, duplicate IDs, finite positions and yaw range", () => {
    const p = newProject();
    p.entities = [
      {
        id: "pig-1",
        type: "minecraft:pig",
        position: [-0.5, 1.25, 4.75],
        yaw: -180,
      },
    ];
    expect(projectSchema.parse(p).entities).toEqual(p.entities);
    expect(
      projectSchema.safeParse({
        ...p,
        entities: [p.entities[0], { ...p.entities[0] }],
      }).success,
    ).toBe(false);
    expect(
      projectSchema.safeParse({
        ...p,
        entities: [{ ...p.entities[0], position: [0, Number.NaN, 0] }],
      }).success,
    ).toBe(false);
    expect(
      projectSchema.safeParse({
        ...p,
        entities: [{ ...p.entities[0], yaw: 361 }],
      }).success,
    ).toBe(false);
  });
});
