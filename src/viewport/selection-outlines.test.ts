import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import { createSelectionOutlines } from "./selection-outlines";

const box = (x = 0, y = 0, z = 0) =>
  new T.Box3(new T.Vector3(x, y, z), new T.Vector3(x + 1, y + 2, z + 3));
function segments(line: T.LineSegments): number[][] {
  line.updateMatrixWorld(true);
  const positions = line.geometry.getAttribute("position");
  const indices = line.geometry.index!;
  const result: number[][] = [];
  for (let i = 0; i < indices.count; i += 2) {
    const a = new T.Vector3()
      .fromBufferAttribute(positions, indices.getX(i))
      .applyMatrix4(line.matrixWorld);
    const b = new T.Vector3()
      .fromBufferAttribute(positions, indices.getX(i + 1))
      .applyMatrix4(line.matrixWorld);
    result.push([...a.toArray(), ...b.toArray()]);
  }
  return result;
}

describe("selection outline batches", () => {
  it("matches all twelve Box3Helper segments, colors, depth and bounds without modifying inputs", () => {
    const boxes = new Map([
      ["a", box(-2, 0, 3)],
      ["b", box(4, 2, 1)],
      ["c", box(20, 0, 0)],
    ]);
    const snapshots = [...boxes.values()].map((b) => b.clone());
    const batches = createSelectionOutlines(boxes, "b");
    const actual = batches.flatMap(segments);
    const expected = [...boxes.values()].flatMap((b) => {
      const helper = new T.Box3Helper(b);
      const result = segments(helper);
      helper.dispose();
      return result;
    });
    expect(actual.map((s) => s.join(",")).sort()).toEqual(
      expected.map((s) => s.join(",")).sort(),
    );
    expect(batches.map((b) => b.material.color.getHexString()).sort()).toEqual([
      "8ce1af",
      "8ce1af",
      "ffe3a1",
    ]);
    for (const batch of batches) {
      expect(batch.material.toneMapped).toBe(false);
      expect(batch.material.depthTest).toBe(true);
      expect(batch.material.depthWrite).toBe(true);
      expect(batch.geometry.boundingBox).not.toBeNull();
      expect(Number.isFinite(batch.geometry.boundingSphere!.radius)).toBe(true);
      batch.dispose();
    }
    expect([...boxes.values()]).toEqual(snapshots);
  });

  it("batches many same-chunk boxes and isolates the active color", () => {
    const boxes = new Map(
      Array.from({ length: 100 }, (_, i) => [String(i), box()] as const),
    );
    const batches = createSelectionOutlines(boxes, "0");
    expect(batches).toHaveLength(2);
    expect(batches.reduce((n, b) => n + b.geometry.index!.count, 0)).toBe(2400);
    batches.forEach((b) => b.dispose());
  });

  it("uses floor for negative centers and exact chunk boundaries", () => {
    const boxes = new Map([
      ["negative", box(-1, -2, -3)],
      ["boundary", box(15.5, 15, 14.5)],
      ["below", box(15.49, 14.99, 14.49)],
    ]);
    const batches = createSelectionOutlines(boxes, null);
    expect(batches.map((b) => b.position.toArray())).toEqual([
      [-16, -16, -16],
      [16, 16, 16],
      [0, 0, 0],
    ]);
    batches.forEach((b) => b.dispose());
  });

  it("preserves small far-world boxes with chunk-relative vertices", () => {
    const b = box(30_000_000.125, -30_000_000.25, 30_000_000.5);
    const [batch] = createSelectionOutlines(new Map([["far", b]]), null);
    const helper = new T.Box3Helper(b);
    expect(segments(batch!)).toEqual(segments(helper));
    expect(
      Math.max(
        ...Array.from(batch!.geometry.getAttribute("position").array).map(
          Math.abs,
        ),
      ),
    ).toBeLessThan(32);
    helper.dispose();
    batch!.dispose();
  });

  it("preserves .015 padding near negative/chunk boundaries and far-world coordinates", () => {
    const boxes = new Map([
      ["negative-boundary", box(-17, -1, -16).expandByScalar(0.015)],
      ["positive-boundary", box(15, 16, 14).expandByScalar(0.015)],
      ["far", box(30_000_000, -30_000_001, 30_000_015).expandByScalar(0.015)],
    ]);
    const snapshots = [...boxes.values()].map((b) => b.clone());
    const batches = createSelectionOutlines(boxes, null);
    const actual = batches.flatMap(segments);
    const expected = [...boxes.values()].flatMap((b) => {
      const helper = new T.Box3Helper(b);
      const result = segments(helper);
      helper.dispose();
      return result;
    });
    expect(actual).toHaveLength(boxes.size * 12);
    for (let segment = 0; segment < expected.length; segment++) {
      for (let coordinate = 0; coordinate < 6; coordinate++) {
        expect(
          Math.abs(
            actual[segment]![coordinate]! - expected[segment]![coordinate]!,
          ),
        ).toBeLessThan(1e-5);
      }
    }
    expect([...boxes.values()]).toEqual(snapshots);
    batches.forEach((b) => b.dispose());
  });
  it("uses Uint32 indices beyond 8191 boxes without overflow or expansion", () => {
    const boxes = new Map(
      Array.from({ length: 8193 }, (_, i) => [String(i), box()] as const),
    );
    const [batch] = createSelectionOutlines(boxes, null);
    expect(batch!.geometry.index!.array).toBeInstanceOf(Uint32Array);
    expect(batch!.geometry.index!.count).toBe(8193 * 24);
    expect(batch!.geometry.getAttribute("position").count).toBe(8193 * 8);
    expect(batch!.geometry.index!.getX(8192 * 24)).toBe(8192 * 8);
    batch!.dispose();
  });

  it("retains the Box3Helper transform and padding for wide sparse owners", () => {
    const bounds = new T.Box3(
      new T.Vector3(-30_000_000, -1, -30_000_000),
      new T.Vector3(30_000_001, 2, 30_000_001),
    ).expandByScalar(0.015);
    const snapshot = bounds.clone();
    const [outline] = createSelectionOutlines(
      new Map([["wide", bounds]]),
      "wide",
    );
    const expected = new T.Box3Helper(snapshot);
    expect(outline).toBeInstanceOf(T.Box3Helper);
    expect(segments(outline!)).toEqual(segments(expected));
    expect(outline!.material.color.getHexString()).toBe("ffe3a1");
    expect(outline!.material.toneMapped).toBe(false);
    expect(bounds).toEqual(snapshot);
    bounds.expandByScalar(1);
    expect(segments(outline!)).toEqual(segments(expected));
    const geometry = vi.spyOn(outline!.geometry, "dispose");
    const material = vi.spyOn(outline!.material, "dispose");
    outline!.dispose();
    outline!.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    expected.dispose();
  });

  it("keeps batching at the extent limit and falls back above it", () => {
    const compact = new T.Box3(new T.Vector3(), new T.Vector3(1024, 1, 1));
    const wide = compact.clone();
    wide.max.x += 0.03;
    const outlines = createSelectionOutlines(
      new Map([
        ["compact", compact],
        ["wide", wide],
      ]),
      null,
    );
    expect(outlines).toHaveLength(2);
    expect(outlines[0]).not.toBeInstanceOf(T.Box3Helper);
    expect(outlines[1]).toBeInstanceOf(T.Box3Helper);
    outlines.forEach((outline) => outline.dispose());
  });

  it("skips empty bounds and rejects oversized or nonfinite input", () => {
    expect(
      createSelectionOutlines(new Map([["empty", new T.Box3()]]), null),
    ).toEqual([]);
    expect(createSelectionOutlines(new Map(), null)).toEqual([]);
    const oversized = new Map(
      Array.from(
        { length: 100001 },
        (_, i) => [String(i), new T.Box3()] as const,
      ),
    );
    expect(() => createSelectionOutlines(oversized, null)).toThrow(RangeError);
    const invalid = box();
    invalid.max.x = Infinity;
    expect(() =>
      createSelectionOutlines(new Map([["invalid", invalid]]), null),
    ).toThrow(RangeError);
  });

  it("disposes only owned geometry/material once", () => {
    const source = box();
    const [first] = createSelectionOutlines(new Map([["a", source]]), null);
    const [other] = createSelectionOutlines(new Map([["a", source]]), null);
    const geometry = vi.spyOn(first!.geometry, "dispose");
    const material = vi.spyOn(first!.material, "dispose");
    const otherGeometry = vi.spyOn(other!.geometry, "dispose");
    const otherMaterial = vi.spyOn(other!.material, "dispose");
    first!.dispose();
    first!.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    expect(otherGeometry).not.toHaveBeenCalled();
    expect(otherMaterial).not.toHaveBeenCalled();
    expect(source).toEqual(box());
    other!.dispose();
  });
});
