import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EntityModelPart, GameProfile } from "../core/profile";
import { gameProfileSchema } from "../core/profile";
import { ModelResolver } from "./models";
import {
  bakeSpecialBlock,
  specialBlockAppearance,
  specialBlockSupport,
} from "./special-blocks";

const texturePaths = [
  "assets/minecraft/textures/entity/banner/banner_base.png",
  "assets/minecraft/textures/entity/banner/base.png",
  "assets/minecraft/textures/entity/conduit/base.png",
];
const resolver = new ModelResolver([
  {
    id: "fixture",
    name: "fixture",
    enabled: true,
    priority: 0,
    gameVersion: "26.2",
    files: Object.fromEntries(
      texturePaths.map((path) => [path, new Uint8Array([1])]),
    ),
    counts: { textures: 3, models: 0, blockstates: 0, entityTextures: 3 },
  },
]);
const state = (name: string, properties: Record<string, string> = {}) => ({
  name: `minecraft:${name}`,
  properties,
});
const part: EntityModelPart = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  polygons: [
    [
      [0, 0, 0, 0, 0],
      [0, 16, 0, 0, 1],
      [16, 16, 0, 1, 1],
      [16, 0, 0, 1, 0],
    ],
  ],
  omittedPolygons: 0,
  children: {},
};
const profile: GameProfile = {
  schemaVersion: 1,
  gameVersion: "26.2",
  dataVersion: 4903,
  sourceSha1: "a".repeat(40),
  blocks: [],
  entities: [],
  creativeTabs: [],
  entityModels: Object.fromEntries(
    [
      "standing_banner#main",
      "standing_banner#flag",
      "wall_banner#main",
      "wall_banner#flag",
      "conduit#shell",
    ].map((id) => [`minecraft:${id}`, part]),
  ),
  dyeColors: { black: 0x1d1d21, red: 0xb02e26 },
};
describe("finite static special block adapters", () => {
  it("recognizes only exact vanilla banner IDs and inactive conduit", () => {
    expect(
      specialBlockAppearance(state("black_banner", { rotation: "8" }))?.layers,
    ).toEqual([
      "minecraft:standing_banner#main",
      "minecraft:standing_banner#flag",
    ]);
    expect(
      specialBlockAppearance(state("black_wall_banner", { facing: "north" }))
        ?.angle,
    ).toBe(-Math.PI);
    expect(specialBlockAppearance(state("conduit"))?.note).toMatch(/Inactive/);
    expect(
      specialBlockAppearance(state("fake_banner", { rotation: "0" })),
    ).toBeUndefined();
    expect(
      specialBlockAppearance({
        name: "custom:black_banner",
        properties: { rotation: "0" },
      }),
    ).toBeUndefined();
  });
  it("combines body and colored cloth as separate materials without altering model layers", () => {
    const before = structuredClone(profile.entityModels),
      mesh = bakeSpecialBlock(
        state("black_banner", { rotation: "0" }),
        profile,
        resolver,
      )!;
    expect(mesh.surfaces.map((s) => s.color)).toEqual([undefined, "#1d1d21"]);
    expect(mesh.geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
    expect(profile.entityModels).toEqual(before);
    expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(-0.5 - 2 / 3);
    mesh.geometry.dispose();
  });
  it("uses profile/texture requirements with actionable reasons, never a fake cube", () => {
    const banner = state("black_banner", { rotation: "0" });
    expect(specialBlockSupport(banner, null, resolver)).toMatchObject({
      available: false,
      detail: expect.stringMatching(/profile/),
    });
    expect(() =>
      bakeSpecialBlock(banner, { ...profile, dyeColors: undefined }, resolver),
    ).toThrow(/dye colors/);
    expect(() =>
      bakeSpecialBlock(banner, profile, new ModelResolver([])),
    ).toThrow(/Missing.*texture/);
    expect(bakeSpecialBlock(state("stone"), profile, resolver)).toBeUndefined();
  });
});
const profilePath = "public/generated/26.2.profile.json";
const actualProfile = existsSync(profilePath)
  ? gameProfileSchema.parse(JSON.parse(readFileSync(profilePath, "utf8")))
  : undefined;
describe.skipIf(!actualProfile?.dyeColors)(
  "actual 26.2 special model layer geometry",
  () => {
    it("uses game layers, banner scale/origin/yaw and conduit shell dimensions", () => {
      const actual = actualProfile!;
      const conduit = bakeSpecialBlock(state("conduit"), actual, resolver)!;
      expect(conduit.geometry.boundingBox!.min.toArray()).toEqual([
        -3 / 16,
        -3 / 16,
        -3 / 16,
      ]);
      expect(conduit.geometry.boundingBox!.max.toArray()).toEqual([
        3 / 16,
        3 / 16,
        3 / 16,
      ]);
      conduit.geometry.dispose();
      const banner = bakeSpecialBlock(
        state("black_banner", { rotation: "0" }),
        actual,
        resolver,
      )!;
      expect(banner.geometry.boundingBox!.max.y).toBeCloseTo(
        ((44 / 16) * 2) / 3 - 0.5,
      );
      expect(banner.geometry.boundingBox!.min.y).toBeCloseTo(-0.5);
      expect(banner.surfaces[1].color).toBe(
        "#" + actual.dyeColors!.black.toString(16).padStart(6, "0"),
      );
      banner.geometry.dispose();
      for (const facing of ["north", "east", "south", "west"]) {
        const wall = bakeSpecialBlock(
          state("black_wall_banner", { facing }),
          actual,
          resolver,
        )!;
        expect(wall.geometry.boundingBox!.max.y).toBeCloseTo(
          ((20.5 / 16) * 2) / 3 - 0.5,
        );
        expect(wall.geometry.boundingBox!.min.y).toBeCloseTo(
          ((-19.5 / 16) * 2) / 3 - 0.5,
        );
        wall.geometry.dispose();
      }
    });
  },
);
