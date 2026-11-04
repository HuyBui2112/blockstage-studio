import type { Material } from "../core/catalog";
import type { Vec3 } from "../core/schema";
import type { EditorDocument } from "./model";
import {
  applyObjectCopyPlan,
  planObjectCopies,
  selectedCopyObjects,
  type CopyPlanOptions,
  type ObjectCopyPlan,
} from "./copy-plan";
import type { OperationBase } from "./operation-plan";

export type RepeatIntent = Readonly<{
  axis: "x" | "y" | "z";
  count: number;
  spacing: number;
}>;
export type RepeatPlan = ObjectCopyPlan &
  Readonly<{ kind: "repeat"; intent: RepeatIntent }>;

/** Count is the number of NEW copies. Signed spacing is anchor-to-anchor, in world block units. */
export function planRepeat(
  document: EditorDocument,
  ids: string[],
  intent: RepeatIntent,
  catalog: Material[],
  options: CopyPlanOptions,
): RepeatPlan {
  if (!["x", "y", "z"].includes(intent.axis))
    throw new Error("Repeat axis must be x, y or z");
  if (!Number.isSafeInteger(intent.spacing) || intent.spacing === 0)
    throw new Error("Repeat spacing must be a nonzero integer in block units");
  const step: Vec3 = [0, 0, 0];
  step[["x", "y", "z"].indexOf(intent.axis)] = intent.spacing;
  const plan = planObjectCopies(
    document,
    selectedCopyObjects(document, ids),
    { count: intent.count, offset: step, step },
    catalog,
    options,
  );
  return { ...plan, kind: "repeat", intent: { ...intent } };
}
export function applyRepeatPlan(
  plan: RepeatPlan,
  current: EditorDocument,
  base: OperationBase,
  catalog: Material[],
): EditorDocument {
  return applyObjectCopyPlan(plan, current, base, catalog);
}
