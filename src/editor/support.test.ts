import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS, type Material } from "../core/catalog";
import type { Block, Vec3 } from "../core/schema";
import { CONTEXT_CHAIN_IDS } from "./placement-plan";
import {
  assessSupport,
  createSupportChecker,
  MAX_SUPPORT_ISSUES,
} from "./support";

const material = (
  id: string,
  properties: Record<string, string[]> = {},
): Material => ({
  id: `minecraft:${id}`,
  label: id,
  family: "solid",
  renderShape: "MODEL",
  color: "#888888",
  properties,
  defaults: {},
  source: "game-profile",
});
const catalog = [
  ...DEMO_MATERIALS,
  material("oak_door", { half: ["lower", "upper"] }),
  material("sunflower", { half: ["lower", "upper"] }),
  material("red_bed", { part: ["foot", "head"] }),
  material("small_dripleaf", { half: ["lower", "upper"] }),
  material("stripped_warped_hyphae", { axis: ["x", "y", "z"] }),
  material("honey_block"), material("soul_sand"), material("fake_slab", { type: ["bottom", "top", "double"] }),
  material("oak_fence", { north: ["true", "false"], east: ["true", "false"], south: ["true", "false"], west: ["true", "false"], waterlogged: ["false", "true"] }),
  ...["stone_brick_wall", "cobblestone_wall"].map((id) => material(id, { north: ["none", "low", "tall"], east: ["none", "low", "tall"], south: ["none", "low", "tall"], west: ["none", "low", "tall"], up: ["true", "false"], waterlogged: ["false", "true"] })),
  ...["lantern", "soul_lantern", "copper_lantern"].map((id) =>
    material(id, {
      hanging: ["false", "true"],
      waterlogged: ["false", "true"],
    }),
  ),
  ...[...CONTEXT_CHAIN_IDS].map((id) =>
    material(id.slice("minecraft:".length), {
      axis: ["x", "y", "z"],
      waterlogged: ["false", "true"],
    }),
  ),
  ...[
    "air",
    "clay",
    "coarse_dirt",
    "dirt",
    "farmland",
    "grass_block",
    "moss_block",
    "mud",
    "muddy_mangrove_roots",
    "mycelium",
    "pale_moss_block",
    "podzol",
    "rooted_dirt",
    "torch",
    "mystery_cube",
    "fake_door",
  ].map((id) => material(id)),
];
const block = (
  id: string,
  pos: Vec3,
  properties: Record<string, string> = {},
): Block => ({ pos, state: { name: `minecraft:${id}`, properties } });
const door = (pos: Vec3 = [0, 1, 0]) =>
  block("oak_door", pos, { half: "lower" });
const plant = (pos: Vec3 = [0, 1, 0]) =>
  block("sunflower", pos, { half: "lower" });

describe("bounded scene support diagnostics", () => {
  it.each(["lantern", "soul_lantern"])(
    "checks verified dry %s attachments above/below without assuming absent cells are air",
    (id) => {
      for (const hanging of ["true", "false"]) {
        const lamp = block(id, [0, 1, 0], { hanging, waterlogged: "false" });
        const supportPos: Vec3 = [0, hanging === "true" ? 2 : 0, 0];
        expect(assessSupport([lamp], catalog)).toMatchObject([
          { code: "missing_support", supportPos },
        ]);
        expect(
          assessSupport([lamp, block("air", supportPos)], catalog),
        ).toMatchObject([{ code: "invalid_support" }]);
        expect(
          assessSupport([lamp, block("stone", supportPos)], catalog),
        ).toEqual([]);
        for (const chain of CONTEXT_CHAIN_IDS) {
          for (const axis of ["x", "y", "z"]) {
            const support = block(
              chain.slice("minecraft:".length),
              supportPos,
              { axis, waterlogged: "false" },
            );
            const issues = assessSupport([lamp, support], catalog);
            if (axis === "y") expect(issues).toEqual([]);
            else
              expect(issues).toMatchObject([
                { code: "invalid_support", supportPos },
              ]);
          }
        }
        expect(
          assessSupport([lamp, block("mystery_cube", supportPos)], catalog),
        ).toMatchObject([{ code: "support_unknown" }]);
        const slabIssues = assessSupport(
            [
              lamp,
              block("stone_brick_slab", supportPos, {
                type: "top",
                waterlogged: "false",
              }),
            ],
            catalog,
          );
        if (hanging === "false") expect(slabIssues).toEqual([]);
        else expect(slabIssues).toMatchObject([{ code: "invalid_support" }]);
        const wetChain = block("iron_chain", supportPos, {
          axis: "y",
          waterlogged: "true",
        });
        expect(assessSupport([lamp, wetChain], catalog)).toMatchObject([
          { code: "support_unknown" },
        ]);
      }
    },
  );

  it("checks dry common building supports using CENTER, not a full-cube or visual rule", () => {
    for (const hanging of ["false", "true"]) {
      const lamp = block("lantern", [0, 1, 0], { hanging, waterlogged: "false" });
      const pos: Vec3 = [0, hanging === "true" ? 2 : 0, 0];
      for (const id of ["oak_planks", "glass", "soul_sand"])
        expect(assessSupport([lamp, block(id, pos)], catalog)).toEqual([]);
      for (const axis of ["x", "y", "z"])
        expect(assessSupport([lamp, block("stripped_warped_hyphae", pos, { axis })], catalog)).toEqual([]);
      for (const type of ["bottom", "top", "double"]) {
        const issues = assessSupport([lamp, block("stone_brick_slab", pos, { type, waterlogged: "false" })], catalog);
        if (type === "double" || type === (hanging === "true" ? "bottom" : "top")) expect(issues).toEqual([]);
        else expect(issues).toMatchObject([{ code: "invalid_support", supportPos: pos }]);
      }
      for (const half of ["bottom", "top"]) for (const shape of ["straight", "inner_left", "inner_right", "outer_left", "outer_right"]) {
        const support = block("oak_stairs", pos, { half, shape, facing: "east", waterlogged: "false" });
        const issues = assessSupport([lamp, support], catalog);
        if (half === (hanging === "true" ? "bottom" : "top")) expect(issues).toEqual([]);
        else expect(issues).toMatchObject([{ code: "invalid_support" }]);
      }
      const honeyIssues = assessSupport([lamp, block("honey_block", pos)], catalog);
      if (hanging === "true") expect(honeyIssues).toEqual([]);
      else expect(honeyIssues).toMatchObject([{ code: "invalid_support" }]);
      const fence = block("oak_fence", pos, { north: "false", east: "false", south: "false", west: "false", waterlogged: "false" });
      expect(assessSupport([lamp, fence], catalog)).toEqual([]);
      for (const id of ["stone_brick_wall", "cobblestone_wall"]) {
        const wall = block(id, pos, { north: "none", east: "none", south: "none", west: "none", up: "false", waterlogged: "false" });
        expect(assessSupport([lamp, wall], catalog)).toMatchObject([{ code: "invalid_support" }]);
        for (const properties of [{ ...wall.state.properties, up: "true" }, { ...wall.state.properties, east: "low" }])
          expect(assessSupport([lamp, { ...wall, state: { ...wall.state, properties } }], catalog)).toEqual([]);
      }
      expect(assessSupport([lamp, block("fake_slab", pos, { type: "double" })], catalog)).toMatchObject([{ code: "support_unknown" }]);
      expect(assessSupport([lamp, block("stone_brick_slab", pos, { type: "double", waterlogged: "true" })], catalog)).toMatchObject([{ code: "support_unknown" }]);
    }
  });

  it("overlays preview lantern support and keeps unverified wet states and other lantern IDs outside the adapter", () => {
    const lamp = block("lantern", [0, 1, 0], {
      hanging: "true",
      waterlogged: "false",
    });
    const support = block("iron_chain", [0, 2, 0], {
      axis: "y",
      waterlogged: "false",
    });
    const check = createSupportChecker([lamp, support], catalog);
    expect(check()).toEqual([]);
    expect(check([lamp, block("air", support.pos)])).toMatchObject([
      { code: "invalid_support" },
    ]);
    expect(
      check([
        lamp,
        {
          ...support,
          state: {
            ...support.state,
            properties: { axis: "x", waterlogged: "false" },
          },
        },
      ]),
    ).toMatchObject([{ code: "invalid_support" }]);
    expect(
      check([
        {
          ...lamp,
          state: {
            ...lamp.state,
            properties: { hanging: "true", waterlogged: "true" },
          },
        },
      ]),
    ).toMatchObject([{ code: "support_unknown" }]);
    expect(check()).toEqual([]);
    expect(
      assessSupport(
        [
          block("copper_lantern", [0, 1, 0], {
            hanging: "true",
            waterlogged: "false",
          }),
        ],
        catalog,
      ),
    ).toEqual([]);
    expect(
      assessSupport(
        [
          block("lantern", [0, 1, 0], {
            hanging: "invalid",
            waterlogged: "false",
          }),
        ],
        catalog,
      ),
    ).toMatchObject([{ code: "support_unknown" }]);
  });

  it("distinguishes absent scene support from explicit air and skips internal upper halves", () => {
    const lower = door(),
      upper = block("oak_door", [0, 2, 0], { half: "upper" });
    expect(assessSupport([lower, upper], catalog)).toMatchObject([
      { code: "missing_support", pos: [0, 1, 0], supportPos: [0, 0, 0] },
    ]);
    expect(
      assessSupport([lower, upper, block("air", [0, 0, 0])], catalog),
    ).toMatchObject([{ code: "invalid_support" }]);
    expect(
      assessSupport([lower, upper, block("stone", [0, 0, 0])], catalog),
    ).toEqual([]);
  });

  it("uses the complete committed-plus-preview scene and re-evaluates changed cells", () => {
    const floor = block("stone", [0, 0, 0]),
      preview = door();
    expect(assessSupport([floor, preview], catalog)).toEqual([]);
    expect(assessSupport([floor, door([1, 1, 0])], catalog)).toMatchObject([
      { code: "missing_support", pos: [1, 1, 0] },
    ]);
    expect(assessSupport([preview], catalog)).toMatchObject([
      { code: "missing_support" },
    ]);
    expect(
      assessSupport([floor, preview, door([2, 1, 0])], catalog, [preview]),
    ).toEqual([]);
  });

  it("reuses a scene index while candidate floors and soils override committed support", () => {
    const scene = Object.freeze([block("stone", [0, 0, 0]), door()]),
      before = structuredClone(scene);
    const check = createSupportChecker(scene, Object.freeze([...catalog]));
    expect(check()).toEqual([]);
    expect(check([door(), block("air", [0, 0, 0])])).toMatchObject([
      { code: "invalid_support" },
    ]);
    expect(check([plant()])).toMatchObject([{ code: "invalid_support" }]);
    expect(check([plant(), block("dirt", [0, 0, 0])])).toEqual([]);
    expect(check([door([5, 1, 0]), block("stone", [5, 0, 0])])).toEqual([]);
    expect(check([door([5, 1, 0])])).toMatchObject([
      { code: "missing_support" },
    ]);
    expect(check()).toEqual([]);
    expect(scene).toEqual(before);
  });

  it("warns for invalid plant soil while accepting explicitly verified soils", () => {
    expect(
      assessSupport([plant(), block("stone", [0, 0, 0])], catalog),
    ).toMatchObject([{ code: "invalid_support" }]);
    expect(
      assessSupport([plant(), block("clay", [0, 0, 0])], catalog),
    ).toMatchObject([{ code: "invalid_support" }]);
    for (const id of [
      "coarse_dirt",
      "dirt",
      "farmland",
      "grass_block",
      "moss_block",
      "mud",
      "muddy_mangrove_roots",
      "mycelium",
      "pale_moss_block",
      "podzol",
      "rooted_dirt",
    ])
      expect(assessSupport([plant(), block(id, [0, 0, 0])], catalog)).toEqual(
        [],
      );
    expect(
      assessSupport([door(), block("torch", [0, 0, 0])], catalog),
    ).toMatchObject([{ code: "invalid_support" }]);
  });

  it("keeps arbitrary models and partial blocks unknown rather than inferring physics", () => {
    for (const support of [
      block("mystery_cube", [0, 0, 0]),
      block("stone_brick_slab", [0, 0, 0], {
        type: "top",
        waterlogged: "false",
      }),
    ]) {
      const issues = assessSupport([door(), support], catalog);
      expect(issues).toMatchObject([{ code: "support_unknown" }]);
      expect(issues[0].message).toContain("has not been verified");
    }
    expect(
      assessSupport([plant(), block("mystery_cube", [0, 0, 0])], catalog),
    ).toMatchObject([{ code: "support_unknown" }]);
    expect(assessSupport([block("fake_door", [0, 1, 0])], catalog)).toEqual([]);
  });

  it("does not claim floating beds need a floor", () => {
    expect(
      assessSupport(
        [
          block("red_bed", [0, 1, 0], { part: "foot" }),
          block("red_bed", [0, 1, -1], { part: "head" }),
        ],
        catalog,
      ),
    ).toEqual([]);
  });

  it("does not trust invalid or missing registry states and identifies special plant limits", () => {
    expect(
      assessSupport(
        [door(), block("stone", [0, 0, 0], { bogus: "true" })],
        catalog,
      ),
    ).toMatchObject([{ code: "support_unknown" }]);
    expect(
      assessSupport([door(), block("stone", [0, 0, 0])], []),
    ).toMatchObject([{ code: "support_unknown" }]);
    expect(
      assessSupport(
        [
          block("small_dripleaf", [0, 1, 0], { half: "lower" }),
          block("dirt", [0, 0, 0]),
        ],
        catalog,
      ),
    ).toMatchObject([{ code: "support_unknown" }]);
  });

  it("preserves source data and attributes warnings to scene owners", () => {
    const blocks = [{ ...door(), owner: "group-id" }],
      before = structuredClone(blocks),
      registryBefore = structuredClone(catalog);
    const issues = assessSupport(
      Object.freeze(blocks),
      Object.freeze([...catalog]),
    );
    expect(issues[0].objectId).toBe("group-id");
    issues[0].pos[0] = 99;
    issues[0].supportPos[0] = 99;
    expect(blocks).toEqual(before);
    expect(catalog).toEqual(registryBefore);
  });

  it("deduplicates and bounds large reports with an explicit overflow count", () => {
    const blocks = Array.from({ length: 250 }, (_, index) =>
      door([index, 1, 0]),
    );
    const issues = assessSupport([...blocks, ...blocks], catalog);
    expect(issues).toHaveLength(MAX_SUPPORT_ISSUES + 1);
    expect(
      issues.filter((issue) => issue.code === "missing_support"),
    ).toHaveLength(MAX_SUPPORT_ISSUES);
    expect(issues.at(-1)?.message).toContain(
      "150 additional support diagnostics omitted",
    );
  });
});
