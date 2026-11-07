import type { Material } from "../core/catalog";
import type { NeighborRules } from "../core/profile";
import { key, type Vec3 } from "../core/schema";
import { planPaste, type EditorClipboard } from "./clipboard";
import {
  applyObjectCopyPlan,
  type CopyPlanOptions,
  type ObjectCopyPlan,
} from "./copy-plan";
import { planDuplicate } from "./duplicate-plan";
import { executeHistory } from "./history";
import { sceneBlocks, validateDocument, type EditorDocument } from "./model";
import { checkPlanCancelled } from "./operation-plan";
import { planNeighborConnections } from "./neighbors";
import type { OperationBase } from "./operation-plan";
import { planRepeat } from "./repeat-plan";
import { planGridRepeat } from "./grid-repeat-plan";

export type CopyActionIntent =
  | { kind: "duplicate"; delta: Vec3 }
  | { kind: "paste"; position: Vec3 }
  | { kind: "repeat"; axis: "x" | "y" | "z"; count: number; spacing: number }
  | { kind: "repeat-grid"; counts: Vec3; spacing: Vec3 };
export type CopyActionPlan = ObjectCopyPlan &
  Readonly<{
    kind: CopyActionIntent["kind"];
    notes: string[];
    rules?: NeighborRules;
  }>;

/** Compose copying and the optional scene policy once, retaining the exact preview candidate. */
export function planCopyAction(
  document: EditorDocument,
  ids: string[],
  intent: CopyActionIntent,
  clipboard: EditorClipboard | null,
  catalog: Material[],
  options: CopyPlanOptions,
  rules?: NeighborRules,
): CopyActionPlan {
  if (intent.kind === "paste" && !clipboard)
    throw new Error("Copy objects before pasting: the clipboard is empty");
  const plan =
    intent.kind === "duplicate"
      ? planDuplicate(document, ids, intent.delta, catalog, options)
      : intent.kind === "paste"
        ? planPaste(document, clipboard!, intent.position, catalog, options)
        : intent.kind === "repeat-grid"
          ? planGridRepeat(document, ids, intent, catalog, options)
          : planRepeat(document, ids, intent, catalog, options);
  return finalizeCopyPlan(plan, catalog, rules);
}

/** Finalize scene connections once for both copies and primitive grids. */
export function finalizeCopyPlan<T extends ObjectCopyPlan>(
  plan: T,
  catalog: Material[],
  rules?: NeighborRules,
): T & { notes: string[]; rules?: NeighborRules } {
  if (!rules) return { ...plan, notes: [] };
  const document = plan.source;
  const neighbors = planNeighborConnections(document, plan.document, rules);
  validateDocument(neighbors.document, catalog);
  checkPlanCancelled(plan.signal);
  const previewKeys = new Set(
    [...plan.cells, ...neighbors.changed].map((cell) => key(cell.pos)),
  );
  const cells = sceneBlocks(neighbors.document).filter((cell) =>
    previewKeys.has(key(cell.pos)),
  );
  const history = executeHistory(
    { document, past: [], future: [] },
    neighbors.document,
    "Build objects",
  );
  return {
    ...plan,
    document: neighbors.document,
    rules,
    notes: neighbors.notes,
    cells,
    patches: history.past[0].patches,
    changedChunks: [
      ...new Set(
        cells.map((cell) =>
          cell.pos.map((value) => Math.floor(value / 16)).join(","),
        ),
      ),
    ],
  };
}

/** Policy changes require a new preview; apply never recalculates IDs, states or neighbors. */
export function applyCopyAction(
  plan: CopyActionPlan,
  current: EditorDocument,
  base: OperationBase,
  catalog: Material[],
  rules?: NeighborRules,
): EditorDocument {
  if (plan.rules !== rules)
    throw new Error("Auto connections changed. Rebuild the operation preview.");
  return applyObjectCopyPlan(plan, current, base, catalog);
}
