import type { Material } from "../core/catalog";
import type { SceneEntity, Vec3 } from "../core/schema";
import {
  addEntity,
  duplicateEntities,
  entityEditCapability,
  moveEntities,
  removeEntities,
  setEntityYaw,
} from "./entity-operations";
import { validateDocument, type EditorDocument } from "./model";
import {
  assertCurrentPlan,
  checkPlanCancelled,
  validateOperationBase,
  type OperationBase,
} from "./operation-plan";
import { inYRange, type EditorViewState } from "./view-state";

export type EntityActionIntent =
  | { kind: "add"; entity: SceneEntity }
  | { kind: "move"; delta: Vec3 }
  | { kind: "yaw"; yaw: number }
  | { kind: "duplicate"; newIds: string[]; offset: Vec3 }
  | { kind: "remove" };

export function editableEntityIds(
  document: EditorDocument,
  view: EditorViewState,
): string[] {
  inYRange(0, view);
  if (view.isolated !== null) return [];
  return document.entities
    .filter(
      (entity) =>
        entityEditCapability(entity.type).supported &&
        inYRange(entity.position[1], view),
    )
    .map((entity) => entity.id);
}

export type EntityActionPlan = Readonly<{
  source: EditorDocument;
  document: EditorDocument;
  base: OperationBase;
  catalog: Material[];
  view: EditorViewState;
  selection: string[];
  kind: EntityActionIntent["kind"];
  label: string;
  signal?: AbortSignal;
}>;

function assertEntityView(
  source: EditorDocument,
  candidate: EditorDocument,
  ids: readonly string[],
  view: EditorViewState,
): void {
  // Hidden/locked IDs belong to block roots, including legacy cross-kind IDs.
  inYRange(0, view);
  if (view.isolated !== null)
    throw new Error(
      "Entity editing is unavailable while block isolation is active",
    );
  if (candidate.objects !== source.objects)
    throw new Error("Entity actions cannot change block objects");
  const selected = new Set(ids),
    previous = new Map(source.entities.map((entity) => [entity.id, entity]));
  for (const entity of source.entities)
    if (selected.has(entity.id) && !inYRange(entity.position[1], view))
      throw new Error(
        "Selected entity is outside the active Y range: " + entity.id,
      );
  for (const entity of candidate.entities)
    if (
      entity !== previous.get(entity.id) &&
      !inYRange(entity.position[1], view)
    )
      throw new Error(
        "Entity extends outside the active Y range: " + entity.id,
      );
}

export function planEntityAction(
  document: EditorDocument,
  ids: string[],
  intent: EntityActionIntent,
  catalog: Material[],
  options: { base: OperationBase; view: EditorViewState; signal?: AbortSignal },
): EntityActionPlan {
  checkPlanCancelled(options.signal);
  validateOperationBase(document, options.base);
  const selection = [...ids];
  let candidate: EditorDocument,
    nextSelection = selection,
    label: string;
  switch (intent.kind) {
    case "add":
      candidate = addEntity(document, intent.entity, catalog);
      nextSelection = [intent.entity.id];
      label = "Add entity";
      break;
    case "move":
      candidate = moveEntities(document, selection, [...intent.delta], catalog);
      label = "Move entities";
      break;
    case "yaw":
      candidate = setEntityYaw(document, selection, intent.yaw, catalog);
      label = "Rotate entities";
      break;
    case "duplicate":
      nextSelection = [...intent.newIds];
      candidate = duplicateEntities(
        document,
        selection,
        nextSelection,
        [...intent.offset],
        catalog,
      );
      label = "Duplicate entities";
      break;
    case "remove":
      candidate = removeEntities(document, selection, catalog);
      nextSelection = [];
      label = "Remove entities";
      break;
  }
  assertEntityView(
    document,
    candidate,
    intent.kind === "add" ? [] : selection,
    options.view,
  );
  checkPlanCancelled(options.signal);
  return {
    source: document,
    document: candidate,
    base: { ...options.base },
    catalog,
    view: options.view,
    selection: nextSelection,
    kind: intent.kind,
    label,
    signal: options.signal,
  };
}

export function applyEntityAction(
  plan: EntityActionPlan,
  current: EditorDocument,
  base: OperationBase,
  catalog: Material[],
  view: EditorViewState,
): EditorDocument {
  checkPlanCancelled(plan.signal);
  assertCurrentPlan(plan.source, plan.base, current, base);
  if (plan.catalog !== catalog)
    throw new Error("Materials changed. Rebuild the entity preview.");
  if (plan.view !== view)
    throw new Error("View policy changed. Rebuild the entity preview.");
  validateDocument(current, catalog);
  validateDocument(plan.document, catalog);
  // Recheck the final candidate without rebuilding or changing its identity.
  const finalEntities = new Map(
    plan.document.entities.map((entity) => [entity.id, entity]),
  );
  const changedIds = current.entities
    .filter((entity) => finalEntities.get(entity.id) !== entity)
    .map((entity) => entity.id);
  assertEntityView(current, plan.document, changedIds, view);
  checkPlanCancelled(plan.signal);
  return plan.document;
}
