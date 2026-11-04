import { describe, expect, it } from "vitest";
import {
  bounds,
  canPlace,
  flatten,
  instantiate,
  rotatePos,
  rotateState,
} from "./assembly";
import {
  DEMO_MATERIALS,
  defaultState,
  parseBlockReport,
  validateState,
} from "./catalog";
import { newProject, seedComponents } from "./seed";
import {
  componentSchema,
  projectSchema,
  stateKey,
  uniqueBlocks,
  type BlockState,
  type Vec3,
} from "./schema";

describe("Minecraft grid and transformations", () => {
  it("rotates north clockwise to east without floating-point drift", () => {
    expect(rotatePos([0, 2, -1], 1)).toEqual([1, 2, 0]);
    let point: Vec3 = [-17, 4, 11];
    for (let n = 0; n < 4; n++) point = rotatePos(point, 1);
    expect(point).toEqual([-17, 4, 11]);
  });
  it.each([0, 1, 2, 3])(
    "restores facing, axis, rail and connections after four turns (%i)",
    (turns) => {
      const states: BlockState[] = [
        { name: "minecraft:oak_log", properties: { axis: "x" } },
        {
          name: "minecraft:oak_stairs",
          properties: {
            facing: "north",
            half: "top",
            shape: "inner_left",
            waterlogged: "false",
          },
        },
        { name: "minecraft:rail", properties: { shape: "north_east" } },
        {
          name: "minecraft:cobblestone_wall",
          properties: {
            north: "low",
            east: "none",
            south: "tall",
            west: "none",
          },
        },
      ];
      for (const state of states)
        expect(rotateState(rotateState(state, turns), 4 - turns)).toEqual(
          state,
        );
    },
  );
  it("rotates facing, rail shape and axis, preserving other states", () => {
    expect(
      rotateState(defaultState("minecraft:oak_log"), 1).properties.axis,
    ).toBe("y");
    expect(
      rotateState({ name: "minecraft:oak_log", properties: { axis: "x" } }, 1)
        .properties.axis,
    ).toBe("z");
    expect(
      rotateState(defaultState("minecraft:oak_stairs"), 1).properties,
    ).toEqual({
      facing: "east",
      half: "bottom",
      shape: "straight",
      waterlogged: "false",
    });
    expect(
      rotateState(
        { name: "minecraft:rail", properties: { shape: "north_south" } },
        1,
      ).properties.shape,
    ).toBe("east_west");
    expect(
      rotateState(
        { name: "minecraft:rail", properties: { shape: "ascending_west" } },
        1,
      ).properties.shape,
    ).toBe("ascending_north");
  });
  it("fails explicitly when rotation requires an adapter", () => {
    const state = {
      name: "minecraft:jigsaw",
      properties: { orientation: "north_up" },
    };
    expect(rotateState(state, 0)).toEqual(state);
    expect(() => rotateState(state, 1)).toThrow("adapter");
  });
  it("substitutes compatible materials without changing the source", () => {
    const c = seedComponents()[0];
    const output = instantiate(c, {
      id: "one",
      componentId: c.id,
      position: [-10, 2, 3],
      rotation: 1,
      substitutions: { logs: "minecraft:spruce_log" },
    });
    expect(output[0]).toMatchObject({
      pos: [-10, 2, 3],
      state: { name: "minecraft:spruce_log", properties: { axis: "y" } },
    });
    expect(c.blocks[0].state.name).toBe("minecraft:oak_log");
    expect(() =>
      instantiate(c, {
        id: "bad",
        componentId: c.id,
        position: [0, 0, 0],
        rotation: 0,
        substitutions: { logs: "minecraft:stone" },
      }),
    ).toThrow("cùng nhóm");
  });
});
describe("project integrity", () => {
  it("flattens the demo without collisions", () => {
    const p = newProject(true);
    expect(projectSchema.parse(p)).toEqual(p);
    expect(flatten(p)).toHaveLength(85);
    expect(bounds(flatten(p)).size).toEqual([6, 6, 6]);
  });
  it("rejects collisions between loose blocks and instances", () => {
    const p = newProject(true);
    p.blocks = [
      structuredClone(p.components.find((c) => c.id === "floor")!.blocks[0]),
    ];
    expect(() => flatten(p)).toThrow("Trùng block");
    expect(() => uniqueBlocks([p.blocks[0], p.blocks[0]])).toThrow();
  });
  it("rejects fractional cells, stale references, duplicate IDs and unsupported versions", () => {
    const p = newProject(true);
    expect(
      projectSchema.safeParse({
        ...p,
        target: { gameVersion: "1.21.11", dataVersion: 4671 },
      }).success,
    ).toBe(false);
    expect(
      componentSchema.safeParse({
        ...p.components[0],
        blocks: [{ pos: [0.5, 0, 0], state: defaultState("minecraft:stone") }],
      }).success,
    ).toBe(false);
    expect(
      projectSchema.safeParse({
        ...p,
        instances: [{ ...p.instances[0], componentId: "missing" }],
      }).success,
    ).toBe(false);
    expect(
      projectSchema.safeParse({
        ...p,
        components: [p.components[0], p.components[0]],
      }).success,
    ).toBe(false);
  });
  it("checks occupancy and canonical palette keys", () => {
    const blocks = flatten(newProject(true));
    expect(canPlace(blocks, [blocks[0]])).toBe(false);
    expect(canPlace(blocks, [{ ...blocks[0], pos: [100, 0, 0] }])).toBe(true);
    expect(
      stateKey({
        name: "minecraft:oak_stairs",
        properties: { facing: "west", half: "top" },
      }),
    ).toBe(
      stateKey({
        name: "minecraft:oak_stairs",
        properties: { half: "top", facing: "west" },
      }),
    );
  });
});
describe("registry validation", () => {
  it("reads defaults from vanilla reports and rejects invalid values", () => {
    const m = parseBlockReport({
      "minecraft:oak_log": {
        properties: { axis: ["x", "y", "z"] },
        states: [
          { id: 0, properties: { axis: "x" } },
          { id: 1, default: true, properties: { axis: "y" } },
        ],
      },
    });
    expect(m[0].defaults).toEqual({ axis: "y" });
    expect(() =>
      validateState(
        { name: "minecraft:oak_log", properties: { axis: "q" } },
        m,
      ),
    ).toThrow();
    expect(() =>
      validateState(
        {
          name: "minecraft:oak_log",
          properties: { axis: "y", waterlogged: "true" },
        },
        m,
      ),
    ).toThrow();
    expect(() => validateState(defaultState("minecraft:stone"), m)).toThrow();
  });
  it("rejects malformed reports and missing properties", () => {
    expect(() => parseBlockReport([])).toThrow();
    expect(() => parseBlockReport({ "minecraft:stone": {} })).toThrow();
    expect(() =>
      validateState(
        { name: "minecraft:oak_log", properties: {} },
        DEMO_MATERIALS,
      ),
    ).toThrow();
  });
});
