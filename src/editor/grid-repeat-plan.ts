import type { Material } from "../core/catalog";
import type { Vec3 } from "../core/schema";
import type { EditorDocument } from "./model";
import {
  applyObjectCopyPlan,
  planObjectCopiesAt,
  selectedCopyObjects,
  type CopyPlanOptions,
  type ObjectCopyPlan,
} from "./copy-plan";
import { checkPlanCancelled, type OperationBase } from "./operation-plan";

export type GridRepeatIntent = Readonly<{
  /** Total lattice positions per World axis, including the original at (0,0,0). */
  counts: Vec3;
  /** Signed anchor-to-anchor spacing; an axis repeated more than once cannot use zero. */
  spacing: Vec3;
}>;
export type GridRepeatPlan = ObjectCopyPlan & Readonly<{
  kind: "repeat-grid";
  intent: GridRepeatIntent;
}>;

/** Repeat whole selected roots at X-fastest lattice sites, excluding the original origin. */
export function planGridRepeat(
  document: EditorDocument,
  ids: string[],
  intent: GridRepeatIntent,
  catalog: Material[],
  options: CopyPlanOptions,
): GridRepeatPlan {
  checkPlanCancelled(options.signal);
  if (!Array.isArray(intent.counts) || intent.counts.length !== 3 ||
    intent.counts.some((count) => !Number.isSafeInteger(count) || count < 1))
    throw new Error("Grid counts require three positive integers including the original position");
  if (!Array.isArray(intent.spacing) || intent.spacing.length !== 3 ||
    intent.spacing.some((spacing, axis) => !Number.isSafeInteger(spacing) ||
      (intent.counts[axis] > 1 && spacing === 0)))
    throw new Error("Grid spacing requires integers and must be nonzero on repeated axes");
  // Check the multiplied count before selection traversal, template reads or expansion.
  const total = intent.counts.reduce((product, count) => product * BigInt(count), 1n);
  const newCopies = total - 1n;
  if (newCopies < 1n) throw new Error("Grid needs at least two total positions");
  if (newCopies > 100000n) throw new Error("Grid exceeds 100,000 new copies");
  if (intent.spacing.some((spacing, axis) =>
    !Number.isSafeInteger(spacing * (intent.counts[axis] - 1))))
    throw new Error("Grid spacing exceeds safe integer offset limits");
  const counts: Vec3 = [...intent.counts], spacing: Vec3 = [...intent.spacing];
  const plan = planObjectCopiesAt(
    document,
    selectedCopyObjects(document, ids),
    Number(newCopies),
    (index) => {
      const site = index + 1;
      return [
        (site % counts[0]) * spacing[0],
        (Math.floor(site / counts[0]) % counts[1]) * spacing[1],
        Math.floor(site / (counts[0] * counts[1])) * spacing[2],
      ];
    },
    catalog,
    options,
  );
  return { ...plan, kind: "repeat-grid", intent: { counts, spacing } };
}

export function applyGridRepeatPlan(
  plan: GridRepeatPlan,
  current: EditorDocument,
  base: OperationBase,
  catalog: Material[],
): EditorDocument {
  return applyObjectCopyPlan(plan, current, base, catalog);
}
