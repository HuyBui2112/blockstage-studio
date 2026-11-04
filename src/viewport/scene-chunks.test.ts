import { describe, expect, it } from "vitest";
import type { SceneBlock, Vec3 } from "../core/schema";
import { SceneChunks, sceneChunkKey } from "./scene-chunks";

const block = (
  pos: Vec3,
  owner = "root",
  name = "minecraft:stone",
  properties: Record<string, string> = {},
): SceneBlock => ({ pos, owner, state: { name, properties } });

describe("render chunk snapshots", () => {
  it("uses floor chunk coordinates on every axis, including negative boundaries", () => {
    expect(sceneChunkKey([15, 16, -1])).toBe("0,1,-1");
    expect(sceneChunkKey([-16, -17, 32])).toBe("-1,-2,2");
  });

  it("retains previous arrays and blocks for clone-equal scenes and unordered property keys", () => {
    const chunks = new SceneChunks();
    const original = block([0, 0, 0], "root", "minecraft:oak_stairs", {
      facing: "north",
      half: "bottom",
    });
    const first = chunks.update([original]).chunks.get("0,0,0")!;
    const next = chunks.update([
      block([0, 0, 0], "root", "minecraft:oak_stairs", {
        half: "bottom",
        facing: "north",
      }),
    ]);
    expect(next.changed.size).toBe(0);
    expect(next.removed).toEqual([]);
    expect(next.chunks.get("0,0,0")).toBe(first);
    expect(first[0]).toBe(original);
  });

  it("detects owner-only rebind, block ID, property value and property key changes", () => {
    const chunks = new SceneChunks();
    const changes = [
      block([0, 0, 0]),
      block([0, 0, 0], "other"),
      block([0, 0, 0], "other", "minecraft:oak_log", { axis: "x" }),
      block([0, 0, 0], "other", "minecraft:oak_log", { axis: "y" }),
      block([0, 0, 0], "other", "minecraft:oak_log", { unknown: "y" }),
      block([0, 0, 0], "other", "minecraft:oak_log"),
    ];
    for (const value of changes) {
      expect(chunks.update([value]).changed.get("0,0,0")).toEqual([value]);
    }
  });

  it("updates old and new chunks across 15/16 and negative boundaries", () => {
    const chunks = new SceneChunks();
    const stable = block([0, 0, 0], "stable");
    chunks.update([stable, block([15, 0, 0], "moving")]);
    const moved = chunks.update([stable, block([16, 0, 0], "moving")]);
    expect([...moved.changed.keys()]).toEqual(["0,0,0", "1,0,0"]);
    expect(moved.chunks.get("0,0,0")).toEqual([stable]);
    const negative = chunks.update([stable, block([-1, 0, 0], "moving")]);
    expect([...negative.changed.keys()]).toEqual(["-1,0,0"]);
    expect(negative.removed).toEqual(["1,0,0"]);
    expect(
      chunks.update([stable, block([-17, 0, 0], "moving")]).removed,
    ).toEqual(["-1,0,0"]);
  });

  it("reports removed empty chunks and full scene replacement without mutating older snapshots", () => {
    const chunks = new SceneChunks();
    const first = chunks.update([block([0, 0, 0]), block([16, 0, 0])]);
    const replacement = chunks.update([block([0, 32, 0])]);
    expect(replacement.removed).toEqual(["0,0,0", "1,0,0"]);
    expect([...replacement.changed.keys()]).toEqual(["0,2,0"]);
    expect(first.chunks.size).toBe(2);
    expect(chunks.update([]).removed).toEqual(["0,2,0"]);
    expect(chunks.update([]).changed.size).toBe(0);
  });

  it("preserves per-chunk order and detects same-position replacements and reordered ties", () => {
    const chunks = new SceneChunks();
    const a = block([0, 0, 0], "a"),
      b = block([0, 0, 0], "b"),
      remote = block([16, 0, 0]);
    chunks.update([a, remote, b]);
    const reordered = chunks.update([b, remote, a]);
    expect([...reordered.changed.keys()]).toEqual(["0,0,0"]);
    expect(reordered.changed.get("0,0,0")).toEqual([b, a]);
    expect(chunks.update([a, remote]).changed.get("0,0,0")).toEqual([a]);
    expect(chunks.update([b, remote]).changed.get("0,0,0")).toEqual([b]);
  });

  it("force marks all current chunks while retaining unchanged arrays and removed keys", () => {
    const chunks = new SceneChunks();
    const a = block([0, 0, 0]),
      b = block([16, 0, 0]);
    const previous = chunks.update([a, b]).chunks.get("0,0,0");
    const forced = chunks.update([a], true);
    expect(forced.changed.get("0,0,0")).toBe(previous);
    expect(forced.removed).toEqual(["1,0,0"]);
    chunks.clear();
    const reset = chunks.update([a]);
    expect(reset.changed.size).toBe(1);
    expect(reset.chunks.get("0,0,0")).not.toBe(previous);
    expect(reset.removed).toEqual([]);
  });

  it("includes explicit air and leaves frozen source data untouched", () => {
    const a = block([0, 0, 0], "air", "minecraft:air");
    Object.freeze(a.pos);
    Object.freeze(a.state.properties);
    Object.freeze(a.state);
    Object.freeze(a);
    const source = Object.freeze([a]);
    const chunks = new SceneChunks();
    const result = chunks.update(source);
    expect(result.chunks.get("0,0,0")).toEqual(source);
    expect(result.chunks.get("0,0,0")).not.toBe(source);
    expect(chunks.update(source).changed.size).toBe(0);
    expect(source).toEqual([block([0, 0, 0], "air", "minecraft:air")]);
  });
});
