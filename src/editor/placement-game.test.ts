import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { defaultState, type Material } from "../core/catalog";
import { gameProfileSchema, profileMaterials } from "../core/profile";
import type { BlockState, Vec3 } from "../core/schema";
import { CONTEXT_CHAIN_IDS, planBlockPlacement } from "./placement-plan";
import { assessSupport } from "./support";

const oracleFile =
  "node_modules/.cache/game-profile/26.2/placement-oracle.json";
const profileFile = "public/generated/26.2.profile.json";
type PlacementCase = {
  block: string;
  face: string;
  target: Vec3;
  clicked: Vec3;
  point: Vec3;
  look: Vec3;
  yaw: number;
  state: BlockState;
};
type SupportCase = {
  name: string;
  block?: string;
  below?: string;
  canSurvive: boolean;
  survivesAfterTicks?: boolean;
};
type LanternAttachmentCase = Omit<PlacementCase, "state"> & {
  state: BlockState | { null: true };
  support: BlockState;
  itemPlaced: boolean;
  readback: BlockState;
  afterTicks: BlockState;
  afterSupportRemoval: BlockState;
  ticks: number;
};
type Oracle = {
  gameVersion: string;
  dataVersion: number;
  verifiedClientSha1: string;
  enabledFeatures: string[];
  placementCases: PlacementCase[];
  supportCases: SupportCase[];
  families: Record<string, string[]>;
  lanternAttachmentCases: LanternAttachmentCase[];
};
const faces: Record<string, Vec3> = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  south: [0, 0, 1],
  north: [0, 0, -1],
};

// Run scripts/validate-placement.mjs first. No game classes/assets are required
// in normal CI and no generated game data is committed with these assertions.
describe.skipIf(!existsSync(oracleFile) || !existsSync(profileFile))(
  "actual Java 26.2 placement and survival oracle",
  () => {
    let oracle: Oracle, catalog: Material[];
    beforeAll(() => {
      oracle = JSON.parse(readFileSync(oracleFile, "utf8")) as Oracle;
      const profile = gameProfileSchema.parse(
        JSON.parse(readFileSync(profileFile, "utf8")),
      );
      catalog = profileMaterials(profile);
      expect(oracle.verifiedClientSha1).toBe(profile.sourceSha1);
      expect(oracle.gameVersion).toBe("26.2");
      expect(oracle.dataVersion).toBe(4903);
      expect(oracle.enabledFeatures).toEqual(["minecraft:vanilla"]);
    });

    it("matches actual getStateForPlacement for every derived axis/half/facing field", () => {
      expect(oracle.placementCases.length).toBeGreaterThanOrEqual(100);
      for (const fixture of oracle.placementCases) {
        const source = defaultState(fixture.block, catalog);
        const plan = planBlockPlacement(
          source,
          fixture.target,
          catalog,
          {
            pos: fixture.target,
            face: faces[fixture.face],
            point: fixture.point,
            target: fixture.clicked,
            look: fixture.look,
          },
          { mode: "context", turns: 0 },
        );
        const actual = plan.object.cells[0].state.properties;
        const compared =
          fixture.block === "minecraft:oak_log" ||
          oracle.families.chain.includes(fixture.block)
            ? ["axis"]
            : oracle.families.lantern.includes(fixture.block)
              ? ["hanging"]
              : fixture.block === "minecraft:stone_brick_slab"
                ? ["type"]
                : fixture.block === "minecraft:oak_stairs"
                  ? ["facing", "half"]
                  : ["facing"];
        for (const property of compared)
          expect(
            actual[property],
            `${fixture.block} ${fixture.face} yaw=${fixture.yaw} point=${fixture.point} ${property}`,
          ).toBe(fixture.state.properties[property]);
      }
    });

    it("binds chain IDs to actual 26.2 classes and matches vertical lantern item placement with world readback", () => {
      expect([...CONTEXT_CHAIN_IDS].sort()).toEqual(oracle.families.chain);
      expect(oracle.families.chain).toHaveLength(9);
      expect(oracle.families.lantern).toHaveLength(10);
      expect(oracle.lanternAttachmentCases).toHaveLength(336);
      expect(
        oracle.lanternAttachmentCases.filter((fixture) => fixture.itemPlaced),
      ).toHaveLength(40);
      for (const fixture of oracle.lanternAttachmentCases) {
        const label = `${fixture.block} ${fixture.face} ${fixture.support.name} axis=${fixture.support.properties.axis}`;
        expect(fixture.ticks, label).toBe(20);
        expect(fixture.afterSupportRemoval.name, label).toBe("minecraft:air");
        if (["up", "down"].includes(fixture.face)) {
          const lamp = {
            pos: fixture.target,
            state: {
              ...defaultState(fixture.block, catalog),
              properties: {
                hanging: String(fixture.face === "down"),
                waterlogged: "false",
              },
            },
          };
          const support = { pos: fixture.clicked, state: fixture.support };
          const issues = assessSupport([lamp, support], catalog, [lamp]);
          if (fixture.itemPlaced) expect(issues, label).toEqual([]);
          else
            expect(issues, label).toMatchObject([{ code: "invalid_support" }]);
        }
        if (!("null" in fixture.state)) {
          expect(fixture.itemPlaced, label).toBe(true);
          expect(fixture.readback, label).toEqual(fixture.state);
          expect(fixture.afterTicks, label).toEqual(fixture.state);
          // Side clicks may depend on other support and look ordering; only the
          // vertical face orientation is part of the editor's bounded adapter.
          expect(["up", "down"], label).toContain(fixture.face);
          const planned = planBlockPlacement(
            defaultState(fixture.block, catalog),
            fixture.target,
            catalog,
            {
              pos: fixture.target,
              face: faces[fixture.face],
              point: fixture.point,
              target: fixture.clicked,
              look: fixture.look,
            },
            { mode: "context", turns: 0 },
          );
          expect(planned.object.cells[0].state, label).toEqual(fixture.state);
          expect(planned.object.cells[0].pos, label).toEqual(fixture.target);
        } else {
          expect(fixture.itemPlaced, label).toBe(false);
          expect(fixture.readback.name, label).toBe("minecraft:air");
        }
      }
    });

    it("agrees with actual bounded plant survival predicates and floating beds", () => {
      const plantCases = oracle.supportCases.filter(
        (entry) => entry.block && entry.below,
      );
      expect(plantCases.length).toBeGreaterThanOrEqual(90);
      for (const fixture of plantCases) {
        const plant = {
          pos: [0, 1, 0] as Vec3,
          state: defaultState(fixture.block!, catalog),
        };
        const below = {
          pos: [0, 0, 0] as Vec3,
          state: defaultState(fixture.below!, catalog),
        };
        const issues = assessSupport([plant, below], catalog, [plant]);
        if (fixture.canSurvive) expect(issues, fixture.name).toEqual([]);
        else expect(issues[0]?.code, fixture.name).toBe("invalid_support");
      }
      expect(
        oracle.supportCases.find((entry) => entry.name === "floating-bed-pair")
          ?.survivesAfterTicks,
      ).toBe(true);
      expect(
        assessSupport(
          [
            {
              pos: [0, 5, 0],
              state: defaultState("minecraft:red_bed", catalog),
            },
          ],
          catalog,
        ),
      ).toEqual([]);
    });
  },
);
