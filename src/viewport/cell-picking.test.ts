import { describe, expect, it } from "vitest";
import { Ray, Vector3 } from "three";
import type { SceneBlock, Vec3 } from "../core/schema";
import { CellPicker } from "./cell-picking";
import { SceneChunks } from "./scene-chunks";

const block = (
  pos: Vec3,
  name = "minecraft:iron_chain",
  owner = pos.join(","),
): SceneBlock => ({ pos, owner, state: { name, properties: {} } });
const ray = (origin: Vec3, direction: Vec3) =>
  new Ray(new Vector3(...origin), new Vector3(...direction).normalize());

describe("editor cell picking", () => {
  it("matches fresh picking after incremental move/state/rebind/removal/Undo and preserves placement filters", () => {
    const chunks = new SceneChunks(),
      picker = new CellPicker([]);
    const a = block([-1, 0, 0], "minecraft:iron_chain", "a"),
      b = block([16, 0, 0], "minecraft:stone", "b");
    const scenes = [
      [a, b],
      [{ ...a, pos: [-17, 0, 0] as Vec3 }, b],
      [
        {
          ...a,
          owner: "replacement",
          state: { name: "minecraft:stone", properties: {} },
        },
        b,
      ],
      [b],
      [a, b],
      [],
    ];
    const rays = [
      ray([-30, 0.5, 0.5], [1, 0, 0]),
      ray([30, 0.5, 0.5], [-1, 0, 0]),
      ray([-0.5, 4, 0.5], [0, -1, 0]),
    ];
    for (const scene of scenes) {
      picker.updateChunks(chunks.update(scene).chunks);
      const fresh = new CellPicker(scene);
      for (const sight of rays)
        for (const eligible of [
          undefined,
          (value: SceneBlock) => value.owner === "b",
          (value: SceneBlock) => value.state.name === "minecraft:iron_chain",
        ]) {
          expect(picker.hit(sight, eligible)).toEqual(
            fresh.hit(sight, eligible),
          );
        }
    }
  });
  it("follows new chunk order for exact edge ties, including clone-equal chunks", () => {
    const a = block([15, 0, 0], "minecraft:stone", "a"),
      b = block([16, 0, 0], "minecraft:stone", "b");
    const chunks = new SceneChunks(),
      picker = new CellPicker([]),
      sight = ray([16, 0.5, -4], [0, 0, 1]);
    picker.updateChunks(chunks.update([a, b]).chunks);
    expect(picker.hit(sight)?.block.owner).toBe("a");
    picker.updateChunks(chunks.update([b, a]).chunks);
    expect(picker.hit(sight)?.block.owner).toBe("b");
  });
  it("skips locked owners for selection while retaining their placement surfaces", () => {
    const locked = block([0, 0, 0], "minecraft:iron_chain", "locked"),
      editable = block([0, 0, 2], "minecraft:stone", "editable");
    const picker = new CellPicker([locked, editable]),
      selectable = new Set(["editable"]);
    const sight = ray([0.1, 0.9, -4], [0, 0, 1]);
    expect(picker.hit(sight, (b) => selectable.has(b.owner))?.block).toBe(
      editable,
    );
    expect(
      picker.hit(sight, (b) => b.state.name === "minecraft:iron_chain")?.block,
    ).toBe(locked);
    expect(picker.hit(sight, () => false)).toBeUndefined();
  });
  it("selects empty-looking portions of thin cells without changing model geometry", () => {
    const chain = block([0, 0, 0]);
    const hit = new CellPicker([chain]).hit(ray([0.05, 0.95, -4], [0, 0, 1]))!;
    expect(hit.block).toBe(chain);
    expect(hit.point).toEqual([0.05, 0.95, 0]);
    expect(hit.face).toEqual([0, 0, -1]);
  });
  it("returns the nearest cell across chunks and negative coordinates, regardless of input order", () => {
    const front = block([-17, 0, 0]),
      back = block([16, 0, 0]);
    const picker = new CellPicker([back, front]);
    expect(picker.hit(ray([-30, 0.5, 0.5], [1, 0, 0]))?.block).toBe(front);
    expect(picker.hit(ray([30, 0.5, 0.5], [-1, 0, 0]))?.block).toBe(back);
  });
  it("reports an exact underside face and outward face from inside a cell", () => {
    const picker = new CellPicker([block([0, 2, 0])]);
    expect(picker.hit(ray([0.1, 0, 0.1], [0, 1, 0]))).toMatchObject({
      face: [0, -1, 0],
      point: [0.1, 2, 0.1],
    });
    expect(picker.hit(ray([0.5, 2.5, 0.5], [0, 1, 0]))).toMatchObject({
      face: [0, 1, 0],
      point: [0.5, 3, 0.5],
    });
  });
  it("does not select air, holes in a group bounds, or excluded cells", () => {
    const picker = new CellPicker([
      block([0, 0, 0], "minecraft:air"),
      block([0, 2, 0]),
      block([0, 4, 0]),
    ]);
    expect(picker.hit(ray([0.5, 0.5, -4], [0, 0, 1]))).toBeUndefined();
    expect(picker.hit(ray([0.5, 3.5, -4], [0, 0, 1]))).toBeUndefined();
    expect(
      picker.hit(ray([0.5, 2.5, -4], [0, 0, 1]), (b) => b.pos[1] !== 2),
    ).toBeUndefined();
  });
  it("supports an explicit placement family filter without intercepting slab surfaces", () => {
    const picker = new CellPicker([
      block([0, 0, 0], "minecraft:stone_slab"),
      block([0, 0, 2]),
    ]);
    expect(
      picker.hit(
        ray([0.1, 0.9, -4], [0, 0, 1]),
        (b) => b.state.name === "minecraft:iron_chain",
      )?.block.pos,
    ).toEqual([0, 0, 2]);
  });
});
