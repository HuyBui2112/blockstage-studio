import { vecSchema, type Vec3 } from "../core/schema";
import type { PrimitiveKind } from "./primitive-plan";

export type PrimitiveAxis = "x" | "y" | "z";
export type PrimitivePlane = "xy" | "xz" | "yz";
export type PrimitiveDimensions = {
  size: Vec3;
  direction: Vec3;
  axis: PrimitiveAxis;
  plane: PrimitivePlane;
};
const axes = ["x", "y", "z"] as const;

export function dimensionAxes(kind: PrimitiveKind, dimensions: Pick<PrimitiveDimensions, "axis" | "plane">): number[] {
  if (kind === "line") return [axes.indexOf(dimensions.axis)];
  if (kind === "plane") return axes.flatMap((axis, index) => dimensions.plane.includes(axis) ? [index] : []);
  return [0, 1, 2];
}

/** Inclusive anchor-grid dimensions. Logical pairs may occupy additional cells. */
export function primitiveEndFromDimensions(kind: PrimitiveKind, start: Vec3, dimensions: PrimitiveDimensions): Vec3 {
  if (!["line", "plane", "solid-box", "hollow-box"].includes(kind) ||
    !axes.includes(dimensions.axis) || !["xy", "xz", "yz"].includes(dimensions.plane))
    throw new Error("Choose a valid World axis or plane");
  if (!vecSchema.safeParse(start).success)
    throw new Error("Start requires integer coordinates within the editor limits");
  const active = dimensionAxes(kind, dimensions);
  for (const axis of active) {
    if (!Number.isSafeInteger(dimensions.size[axis]) || dimensions.size[axis] < 1)
      throw new Error("Dimensions must be positive whole block counts");
    if (![1, -1].includes(dimensions.direction[axis]))
      throw new Error("Each direction must be + or − on its World axis");
  }
  const end = start.map((value, axis) => active.includes(axis)
    ? value + dimensions.direction[axis] * (dimensions.size[axis] - 1)
    : value) as Vec3;
  if (!vecSchema.safeParse(end).success)
    throw new Error("Dimensions extend beyond the editor coordinate limits");
  return end;
}

export function dimensionsFromCorners(start: Vec3, end: Vec3): PrimitiveDimensions {
  const varying = axes.filter((_, index) => start[index] !== end[index]);
  const plane: PrimitivePlane = !varying.includes("y") ? "xz" : !varying.includes("z") ? "xy" : "yz";
  return {
    size: start.map((value, axis) => Number.isFinite(end[axis] - value) ? Math.abs(end[axis] - value) + 1 : 1) as Vec3,
    direction: start.map((value, axis) => end[axis] < value ? -1 : 1) as Vec3,
    axis: varying[0] ?? "x", plane,
  };
}
