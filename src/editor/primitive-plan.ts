import type { Material } from "../core/catalog";
import { vecSchema, type BlockState, type Vec3 } from "../core/schema";
import type { EditorDocument } from "./model";
import { createPlacedObject } from "./placement";
import {
  applyObjectCopyPlan,
  planObjectCopiesAt,
  type CopyPlanOptions,
  type ObjectCopyPlan,
} from "./copy-plan";
import {
  checkPlanCancelled,
  validateOperationBase,
  type OperationBase,
} from "./operation-plan";

export type PrimitiveKind = "line" | "plane" | "solid-box" | "hollow-box";
export type PrimitiveIntent = {
  kind: PrimitiveKind;
  start: Vec3;
  end: Vec3;
  state: BlockState;
  /** Numeric sizing freezes pointer targeting; never part of a saved document. */
  sizing?: "dimensions";
};
export type PrimitivePlan = ObjectCopyPlan &
  Readonly<{ kind: PrimitiveKind; anchor: Vec3; size: Vec3; anchors: number }>;

function denseOffset(index: number, size: Vec3): Vec3 {
  return [
    index % size[0],
    Math.floor(index / size[0]) % size[1],
    Math.floor(index / (size[0] * size[1])),
  ];
}

/** Full Z caps + disjoint XY perimeters. O(shell anchors), never O(interior volume). */
function shellOffset(index: number, size: Vec3): Vec3 {
  const [x, y, z] = size,
    face = x * y,
    perimeter = 2 * x + 2 * (y - 2);
  if (index < face) return denseOffset(index, [x, y, 1]);
  const middle = index - face,
    sideCount = (z - 2) * perimeter;
  if (middle >= sideCount) {
    const pos = denseOffset(middle - sideCount, [x, y, 1]);
    return [pos[0], pos[1], z - 1];
  }
  const layer = 1 + Math.floor(middle / perimeter),
    at = middle % perimeter;
  if (at < x) return [at, 0, layer];
  const sides = at - x;
  if (sides < 2 * (y - 2))
    return [sides % 2 ? x - 1 : 0, 1 + Math.floor(sides / 2), layer];
  return [sides - 2 * (y - 2), y - 1, layer];
}

/** Inclusive World anchor grid. Diagonal rasterization is deliberately unsupported. */
export function planPrimitive(
  document: EditorDocument,
  intent: PrimitiveIntent,
  catalog: Material[],
  options: CopyPlanOptions,
): PrimitivePlan {
  checkPlanCancelled(options.signal);
  validateOperationBase(document, options.base);
  if (!["line", "plane", "solid-box", "hollow-box"].includes(intent.kind))
    throw new Error("Unsupported primitive kind");
  const start = vecSchema.parse(intent.start),
    end = vecSchema.parse(intent.end);
  const varying = start.filter((value, axis) => value !== end[axis]).length;
  if (intent.kind === "line" && varying > 1)
    throw new Error("Line must follow one World axis");
  if (intent.kind === "plane" && varying > 2)
    throw new Error("Plane corners must share one World coordinate");
  const anchor = start.map((value, axis) => Math.min(value, end[axis])) as Vec3;
  const size = start.map(
    (value, axis) => Math.abs(value - end[axis]) + 1,
  ) as Vec3;
  // BigInt avoids catastrophic cancellation for large legal corner ranges.
  const volume = size.reduce((total, value) => total * BigInt(value), 1n);
  const hollow =
    intent.kind === "hollow-box" && size.every((value) => value > 2);
  const inner = hollow
    ? size.reduce((total, value) => total * BigInt(value - 2), 1n)
    : 0n;
  const count = volume - inner;
  if (count > 100000n) throw new Error("Primitive exceeds 100,000 anchors");
  const anchors = Number(count);
  // A single verified Design-placement template preserves complete bed/door/plant pairs.
  // It does not count as a destination object; pair footprints may extend out of the anchor plane.
  const template = createPlacedObject(
    intent.state,
    anchor,
    catalog,
    undefined,
    `${options.operationId}:seed`,
  );
  const plan = planObjectCopiesAt(
    document,
    [template],
    anchors,
    (index) => (hollow ? shellOffset(index, size) : denseOffset(index, size)),
    catalog,
    options,
  );
  return { ...plan, kind: intent.kind, anchor, size, anchors };
}

export function applyPrimitivePlan(
  plan: PrimitivePlan,
  current: EditorDocument,
  base: OperationBase,
  catalog: Material[],
): EditorDocument {
  return applyObjectCopyPlan(plan, current, base, catalog);
}
