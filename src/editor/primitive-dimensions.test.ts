import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS, defaultState } from "../core/catalog";
import type { Vec3 } from "../core/schema";
import { newEditorDocument } from "./model";
import { planPrimitive } from "./primitive-plan";
import { dimensionsFromCorners, primitiveEndFromDimensions, type PrimitiveDimensions } from "./primitive-dimensions";

const dimensions: PrimitiveDimensions = { size: [5, 3, 4], direction: [1, 1, 1], axis: "x", plane: "xz" };
describe("primitive dimensions", () => {
  it("uses inclusive positive sizes while preserving the signed start corner and directions", () => {
    const start: Vec3 = [-3, 2, 5], before = structuredClone(dimensions);
    expect(primitiveEndFromDimensions("solid-box", start, dimensions)).toEqual([1, 4, 8]);
    expect(primitiveEndFromDimensions("hollow-box", start, { ...dimensions, direction: [-1, -1, -1] })).toEqual([-7, 0, 2]);
    expect(dimensions).toEqual(before); expect(start).toEqual([-3, 2, 5]);
    expect(primitiveEndFromDimensions("solid-box", start, { ...dimensions, size: [1, 1, 1] })).toEqual(start);
  });
  it("limits lines and planes to their explicitly chosen World orientation", () => {
    expect(primitiveEndFromDimensions("line", [0, 0, 0], dimensions)).toEqual([4, 0, 0]);
    expect(primitiveEndFromDimensions("line", [0, 0, 0], { ...dimensions, axis: "y" })).toEqual([0, 2, 0]);
    expect(primitiveEndFromDimensions("plane", [0, 0, 0], dimensions)).toEqual([4, 0, 3]);
    expect(primitiveEndFromDimensions("plane", [0, 0, 0], { ...dimensions, plane: "yz" })).toEqual([0, 2, 3]);
    expect(primitiveEndFromDimensions("plane", [0, 0, 0], { ...dimensions, plane: "xy" })).toEqual([4, 2, 0]);
  });
  it("rejects zero/negative/fractional/missing lengths before corner conversion can disguise them", () => {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => primitiveEndFromDimensions("solid-box", [0, 0, 0], { ...dimensions, size: [value, 1, 1] })).toThrow(/positive whole/);
    expect(() => primitiveEndFromDimensions("solid-box", [0, 0, 0], { ...dimensions, direction: [0, 1, 1] })).toThrow(/direction/);
    expect(() => primitiveEndFromDimensions("solid-box", [0.5, 0, 0], dimensions)).toThrow(/Start/);
    expect(() => primitiveEndFromDimensions("solid-box", [30000000, 2048, 30000000], dimensions)).toThrow(/limits/);
  });
  it("roundtrips reversed corners and uses a horizontal plane for the initial point", () => {
    const start: Vec3 = [3, 4, 5], end: Vec3 = [-1, 2, -2];
    const derived = dimensionsFromCorners(start, end);
    expect(derived.size).toEqual([5, 3, 8]); expect(derived.direction).toEqual([-1, -1, -1]);
    expect(primitiveEndFromDimensions("solid-box", start, derived)).toEqual(end);
    expect(dimensionsFromCorners(start, start).plane).toBe("xz");
  });
  it("feeds the existing hollow-box planner without filling interior or weakening budgets", () => {
    const document = newEditorDocument(), state = defaultState("minecraft:stone"), start: Vec3 = [-2, 0, -2];
    const size: Vec3 = [4, 3, 5];
    const end = primitiveEndFromDimensions("hollow-box", start, { ...dimensions, size });
    const plan = planPrimitive(document, { kind: "hollow-box", start, end, state, sizing: "dimensions" }, DEMO_MATERIALS, {
      base: { documentId: document.id, sessionEpoch: "dimensions", revision: 0 }, operationId: "sized-room",
    });
    expect(plan.size).toEqual(size); expect(plan.cost.addedCells).toBe(54);
    expect(plan.cells.some((cell) => cell.pos.join(",") === "-1,1,-1")).toBe(false);
    expect(document.objects).toHaveLength(0);
  });
});
