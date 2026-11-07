import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS, type Material } from "./catalog";
import { mirrorBlockState, mirrorStateCapability, type MirrorPlane } from "./mirror";
import type { BlockState } from "./schema";

function material(name: string, properties: Record<string, string[]>): Material {
  return { id: `minecraft:${name}`, label: name, family: "fixture", color: "#fff", defaults: {}, properties };
}
const bool = ["false", "true"];
const directions = ["north", "east", "south", "west"];
const stairs = material("oak_stairs", { facing: directions, half: ["top", "bottom"], shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"], waterlogged: bool });
const state = (m: Material, properties: Record<string, string>): BlockState => ({ name: m.id, properties });

describe("finite vertical geometric mirrors", () => {
  it.each([
    ["yz", ["north", "west", "south", "east"]],
    ["xy", ["south", "east", "north", "west"]],
  ] as const)("reflects every stair facing and handed shape across %s", (plane, expected) => {
    const pairs = [["straight", "straight"], ["inner_left", "inner_right"], ["inner_right", "inner_left"], ["outer_left", "outer_right"], ["outer_right", "outer_left"]];
    directions.forEach((facing, index) => {
      for (const [shape, mirroredShape] of pairs) {
        const input = state(stairs, { facing, shape, half: "top", waterlogged: "true" });
        const output = mirrorBlockState(input, plane, stairs);
        expect(output.properties).toEqual({ facing: expected[index], shape: mirroredShape, half: "top", waterlogged: "true" });
        expect(mirrorBlockState(output, plane, stairs)).toEqual(input);
        expect(input.properties.shape).toBe(shape);
      }
    });
  });
  it("reflects door hinges for parallel and perpendicular facings without changing halves", () => {
    const door = material("oak_door", { facing: directions, half: ["lower", "upper"], hinge: ["left", "right"], open: bool, powered: bool });
    for (const half of ["lower", "upper"]) for (const facing of directions) {
      const input = state(door, { facing, half, hinge: "left", open: "true", powered: "false" });
      const output = mirrorBlockState(input, "yz", door);
      expect(output.properties).toEqual({ ...input.properties, facing: ({ east: "west", west: "east" } as Record<string, string>)[facing] ?? facing, hinge: "right" });
      expect(mirrorBlockState(output, "yz", door)).toEqual(input);
    }
  });
  it("preserves bed part while reflecting both halves equally", () => {
    const bed = material("red_bed", { facing: directions, part: ["head", "foot"], occupied: bool });
    for (const part of ["head", "foot"]) expect(mirrorBlockState(state(bed, { facing: "south", part, occupied: "false" }), "xy", bed).properties).toEqual({ facing: "north", part, occupied: "false" });
  });
  it("swaps connection keys and preserves wall heights", () => {
    const wall = material("cobblestone_wall", { north: ["none", "low", "tall"], south: ["none", "low", "tall"], east: ["none", "low", "tall"], west: ["none", "low", "tall"], up: bool, waterlogged: bool });
    const input = state(wall, { north: "low", south: "tall", east: "none", west: "low", up: "true", waterlogged: "false" });
    expect(mirrorBlockState(input, "xy", wall).properties).toEqual({ ...input.properties, north: "tall", south: "low" });
  });
  it("preserves explicit axis, slab type and cube states with new property objects", () => {
    for (const id of ["minecraft:oak_log", "minecraft:stone_brick_slab", "minecraft:stone"]) {
      const m = DEMO_MATERIALS.find((item) => item.id === id)!;
      const input = state(m, { ...m.defaults });
      for (const plane of ["yz", "xy"] as MirrorPlane[]) {
        const output = mirrorBlockState(input, plane, m);
        expect(output).toEqual(input);
        expect(output.properties).not.toBe(input.properties);
      }
    }
  });
  it.each([
    ["iron_chain", { axis: ["x", "y", "z"], waterlogged: bool }, { axis: "x", waterlogged: "true" }],
    ["lantern", { hanging: bool, waterlogged: bool }, { hanging: "true", waterlogged: "false" }],
    ["oak_leaves", { distance: ["1", "7"], persistent: bool, waterlogged: bool }, { distance: "7", persistent: "true", waterlogged: "false" }],
  ])("preserves vertical-invariant %s properties", (name, domains, properties) => {
    const m = material(name, domains as Record<string, string[]>);
    const input = state(m, properties as Record<string, string>);
    expect(mirrorBlockState(input, "yz", m)).toEqual(input);
    expect(mirrorBlockState(input, "xy", m)).toEqual(input);
  });
  it("reflects fence connections and gate facing without changing open/power", () => {
    const fence = material("oak_fence", { north: bool, east: bool, south: bool, west: bool, waterlogged: bool });
    const input = state(fence, { north: "true", east: "true", south: "false", west: "false", waterlogged: "false" });
    expect(mirrorBlockState(input, "yz", fence).properties).toEqual({ ...input.properties, east: "false", west: "true" });
    const gate = material("oak_fence_gate", { facing: directions, in_wall: bool, open: bool, powered: bool });
    expect(mirrorBlockState(state(gate, { facing: "south", in_wall: "true", open: "true", powered: "false" }), "xy", gate).properties).toEqual({ facing: "north", in_wall: "true", open: "true", powered: "false" });
  });
  it("accepts a strict single chest payload without mutating its slots and rejects pairs", () => {
    const chest = material("chest", { facing: directions, type: ["single", "left", "right"], waterlogged: bool });
    const input = state(chest, { facing: "west", type: "single", waterlogged: "false" });
    const payload = { kind: "chest" as const, items: [{ slot: 26, id: "minecraft:stone" as const, count: 64 }] };
    const snapshot = JSON.stringify(payload);
    expect(mirrorBlockState(input, "yz", chest, payload).properties.facing).toBe("east");
    expect(JSON.stringify(payload)).toBe(snapshot);
    expect(mirrorStateCapability(state(chest, { ...input.properties, type: "left" }), chest, "yz").supported).toBe(false);
    expect(mirrorStateCapability(input, chest, "yz", { ...payload, items: [{ ...payload.items[0], count: 65 }] }).supported).toBe(false);
    expect(mirrorStateCapability(state(stairs, { facing: "north", shape: "straight", half: "bottom", waterlogged: "false" }), stairs, "yz", payload).supported).toBe(false);
  });
  it("rejects unsupported IDs, unknown directional fields, illegal or incomplete states and planes", () => {
    const impostor = material("unknown_stairs", stairs.properties);
    const properties = { facing: "north", shape: "straight", half: "bottom", waterlogged: "false" };
    expect(mirrorStateCapability(state(impostor, properties), impostor, "yz").supported).toBe(false);
    const extended = { ...stairs, properties: { ...stairs.properties, orientation: ["north"] } };
    expect(mirrorStateCapability(state(extended, { ...properties, orientation: "north" }), extended, "yz").supported).toBe(false);
    const unknownShape = { ...stairs, properties: { ...stairs.properties, shape: ["future_shape"] } };
    expect(mirrorStateCapability(state(unknownShape, { ...properties, shape: "future_shape" }), unknownShape, "yz").supported).toBe(false);
    expect(mirrorStateCapability(state(stairs, { ...properties, facing: "up" }), stairs, "yz").supported).toBe(false);
    expect(mirrorStateCapability(state(stairs, {}), stairs, "yz").supported).toBe(false);
    expect(mirrorStateCapability(state(stairs, properties), undefined, "yz").supported).toBe(false);
    const input = state(stairs, properties);
    expect(mirrorStateCapability(input, stairs, "xz" as MirrorPlane).supported).toBe(false);
    expect(() => mirrorBlockState(input, "xz" as MirrorPlane, stairs)).toThrow("vertical World");
  });
});
