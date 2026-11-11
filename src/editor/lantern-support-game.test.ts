import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gameProfileSchema, profileMaterials } from "../core/profile";
import type { BlockState, Vec3 } from "../core/schema";
import { assessSupport } from "./support";

const oracleFile = "node_modules/.cache/game-profile/26.2/placement-oracle.json";
const profileFile = "public/generated/26.2.profile.json";
type Fixture = {
  block: string;
  hanging: "true" | "false";
  support: BlockState;
  canSurvive: boolean;
  ticks: number;
  afterTicks: BlockState;
  afterSupportRemoval: BlockState;
};

// The matching local oracle is optional in clean CI. No game data is shipped.
describe.skipIf(!existsSync(oracleFile) || !existsSync(profileFile))(
  "26.2 runtime CENTER lantern attachment predicates",
  () => {
    it("agrees with actual dry support states and supported-lantern readback", () => {
      const oracle = JSON.parse(readFileSync(oracleFile, "utf8")) as {
        gameVersion: string; dataVersion: number; enabledFeatures: string[];
        verifiedClientSha1: string; lanternSupportCases: Fixture[];
      };
      const profile = gameProfileSchema.parse(JSON.parse(readFileSync(profileFile, "utf8")));
      expect(oracle.gameVersion).toBe("26.2");
      expect(oracle.dataVersion).toBe(4903);
      expect(oracle.enabledFeatures).toEqual(["minecraft:vanilla"]);
      expect(oracle.verifiedClientSha1).toBe(profile.sourceSha1);
      expect(oracle.lanternSupportCases?.length, "Regenerate with scripts/validate-placement.mjs").toBeGreaterThan(2000);
      const catalog = profileMaterials(profile);
      expect(oracle.lanternSupportCases.some((fixture) => fixture.support.name === "minecraft:cobblestone_wall"), "Regenerate the core R1 wall fixtures").toBe(true);
      let ticked = 0;
      for (const fixture of oracle.lanternSupportCases) {
        const lamp = { pos: [0, 1, 0] as Vec3, state: { name: fixture.block, properties: { hanging: fixture.hanging, waterlogged: "false" } } };
        const pos: Vec3 = [0, fixture.hanging === "true" ? 2 : 0, 0];
        const issues = assessSupport([lamp, { pos, state: fixture.support }], catalog, [lamp]);
        const label = JSON.stringify({ block: fixture.block, hanging: fixture.hanging, support: fixture.support });
        if (fixture.canSurvive) {
          expect(issues, label).toEqual([]);
          expect(fixture.afterTicks, label).toEqual(lamp.state);
        } else expect(issues, label).toMatchObject([{ code: "invalid_support", supportPos: pos }]);
        expect([0, 20], label).toContain(fixture.ticks);
        if (fixture.ticks === 20) ticked++;
        expect(fixture.afterSupportRemoval.name, label).toBe("minecraft:air");
      }
      expect(ticked).toBeGreaterThan(0);
    });
  },
);
