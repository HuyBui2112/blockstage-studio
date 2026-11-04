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

export type DuplicateOptions = CopyPlanOptions;
export type DuplicatePlan = ObjectCopyPlan &
  Readonly<{ kind: "duplicate"; delta: Vec3 }>;

export function planDuplicate(
  document: EditorDocument,
  ids: string[],
  delta: Vec3,
  catalog: Material[],
  options: DuplicateOptions,
): DuplicatePlan {
  const plan = planObjectCopies(
    document,
    selectedCopyObjects(document, ids),
    { count: 1, offset: delta, step: [0, 0, 0] },
    catalog,
    options,
  );
  return { ...plan, kind: "duplicate", delta: [...delta] };
}
/** Returns the exact validated preview, ready for one executeHistory call. */
export function applyDuplicatePlan(
  plan: DuplicatePlan,
  current: EditorDocument,
  base: OperationBase,
  catalog: Material[],
): EditorDocument {
  return applyObjectCopyPlan(plan, current, base, catalog);
}
