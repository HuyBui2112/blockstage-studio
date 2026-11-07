import type { SceneBlock, SceneEntity } from "../core/schema";
import { sceneBlocks, type EditorDocument, type EditorObject } from "./model";

/** Transient root-owner policy. Never serialize into a document or history. */
export type EditorViewState = Readonly<{
  hidden: readonly string[];
  locked: readonly string[];
  isolated: readonly string[] | null;
  yRange?: Readonly<{ min: number; max: number }> | null;
  entityHidden?: readonly string[];
  entityLocked?: readonly string[];
  entityIsolated?: readonly string[] | null;
}>;
export function emptyEditorViewState(): EditorViewState {
  return { hidden: [], locked: [], isolated: null };
}
export type ViewYRange = NonNullable<EditorViewState["yRange"]>;
function validateYRange(range: EditorViewState["yRange"]): void {
  if (
    range != null &&
    (!Number.isInteger(range.min) ||
      !Number.isInteger(range.max) ||
      range.min < -2048 ||
      range.max > 2048 ||
      range.min > range.max)
  ) {
    throw new Error(
      "Y range requires integer bounds from -2048 to 2048, with minimum ≤ maximum",
    );
  }
}
export function setViewYRange(
  view: EditorViewState,
  range: ViewYRange | null,
): EditorViewState {
  validateYRange(range);
  if (
    (view.yRange ?? null) === range ||
    (range != null &&
      view.yRange?.min === range.min &&
      view.yRange.max === range.max)
  )
    return view;
  return { ...view, yRange: range === null ? null : { ...range } };
}
export function inYRange(y: number, view: EditorViewState): boolean {
  validateYRange(view.yRange);
  return view.yRange == null || (y >= view.yRange.min && y <= view.yRange.max);
}
export function createRootViewResolver(
  view: EditorViewState,
  objects?: readonly EditorObject[],
) {
  validateYRange(view.yRange);
  const hidden = new Set(view.hidden),
    locked = new Set(view.locked),
    isolated = view.isolated === null ? null : new Set(view.isolated);
  const bounds = new Map<string, { min: number; max: number; any: boolean }>();
  if (view.yRange != null && objects)
    for (const root of objects) {
      let min = Infinity,
        max = -Infinity,
        any = false;
      const pending = [root];
      while (pending.length) {
        const object = pending.pop()!;
        for (const cell of object.cells) {
          const y = cell.pos[1];
          min = Math.min(min, y);
          max = Math.max(max, y);
          if (y >= view.yRange.min && y <= view.yRange.max) any = true;
        }
        for (const child of object.children) pending.push(child);
      }
      bounds.set(root.id, { min, max, any });
    }
  return (id: string) => {
    const extent = bounds.get(id),
      range = view.yRange;
    const intersects = range == null || !objects || extent?.any === true;
    const contained =
      range == null ||
      (extent !== undefined &&
        extent.min >= range.min &&
        extent.max <= range.max);
    const drawn =
      !hidden.has(id) && (isolated === null || isolated.has(id)) &&
      (view.entityIsolated == null || isolated !== null) && intersects;
    const editable = drawn && !locked.has(id) && contained;
    return { drawn, selectable: editable, editable };
  };
}
/** Free entities use their real-valued position anchor, not mesh or registry bounds. */
export function createEntityViewResolver(view: EditorViewState) {
  validateYRange(view.yRange);
  const hidden = new Set(view.entityHidden ?? []),
    locked = new Set(view.entityLocked ?? []),
    isolated = view.entityIsolated == null ? null : new Set(view.entityIsolated);
  return (entity: SceneEntity) => {
    const drawn = !hidden.has(entity.id) &&
      (isolated === null || isolated.has(entity.id)) &&
      (view.isolated === null || isolated !== null) &&
      inYRange(entity.position[1], view);
    const editable = drawn && !locked.has(entity.id);
    return { drawn, selectable: editable, editable };
  };
}
export function rootViewPolicy(
  id: string,
  view: EditorViewState,
  objects?: readonly EditorObject[],
) {
  return createRootViewResolver(view, objects)(id);
}
/** Only root IDs survive; children always inherit their owner's complete policy. */
export function pruneEditorViewState(
  document: EditorDocument,
  view: EditorViewState,
): EditorViewState {
  validateYRange(view.yRange);
  const roots = new Set(document.objects.map((object) => object.id));
  const prune = (ids: readonly string[]) =>
    [...new Set(ids)].filter((id) => roots.has(id));
  const hidden = prune(view.hidden),
    locked = prune(view.locked),
    isolated = view.isolated === null ? null : prune(view.isolated);
  const entities = new Set(document.entities.map((entity) => entity.id));
  const pruneEntities = (ids: readonly string[]) => [...new Set(ids)].filter((id) => entities.has(id));
  const entityHidden = view.entityHidden === undefined ? undefined : pruneEntities(view.entityHidden),
    entityLocked = view.entityLocked === undefined ? undefined : pruneEntities(view.entityLocked),
    entityIsolated = view.entityIsolated == null ? view.entityIsolated : pruneEntities(view.entityIsolated);
  // A vanished isolate target must not leave an accidentally invisible workspace.
  const next = {
    ...view,
    hidden,
    locked,
    isolated: isolated?.length === 0 ? null : isolated,
    ...(entityHidden === undefined ? {} : { entityHidden }),
    ...(entityLocked === undefined ? {} : { entityLocked }),
    ...(entityIsolated === undefined ? {} : { entityIsolated: entityIsolated?.length === 0 ? null : entityIsolated }),
  };
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((id, i) => id === b[i]);
  return same(view.hidden, hidden) &&
    same(view.locked, locked) &&
    same(view.entityHidden ?? [], next.entityHidden ?? []) &&
    same(view.entityLocked ?? [], next.entityLocked ?? []) &&
    (view.entityIsolated === next.entityIsolated ||
      (view.entityIsolated != null && next.entityIsolated != null && same(view.entityIsolated, next.entityIsolated))) &&
    (view.isolated === next.isolated ||
      (view.isolated !== null &&
        next.isolated !== null &&
        same(view.isolated, next.isolated)))
    ? view
    : next;
}
function toggle(
  ids: readonly string[],
  targets: readonly string[],
): readonly string[] {
  if (!targets.length) return ids;
  const values = new Set(ids),
    remove = targets.every((id) => values.has(id));
  for (const id of targets) {
    if (remove) values.delete(id);
    else values.add(id);
  }
  return [...values];
}
export function toggleRootHidden(
  view: EditorViewState,
  ids: readonly string[],
): EditorViewState {
  return ids.length ? { ...view, hidden: toggle(view.hidden, ids) } : view;
}
export function toggleRootLocked(
  view: EditorViewState,
  ids: readonly string[],
): EditorViewState {
  return ids.length ? { ...view, locked: toggle(view.locked, ids) } : view;
}
export function isolateRoots(
  view: EditorViewState,
  ids: readonly string[],
): EditorViewState {
  if (!ids.length) throw new Error("Select at least one root to isolate");
  return { ...view, isolated: [...new Set(ids)], entityIsolated: null };
}
export function toggleEntityHidden(view: EditorViewState, ids: readonly string[]): EditorViewState {
  return ids.length ? { ...view, entityHidden: toggle(view.entityHidden ?? [], ids) } : view;
}
export function toggleEntityLocked(view: EditorViewState, ids: readonly string[]): EditorViewState {
  return ids.length ? { ...view, entityLocked: toggle(view.entityLocked ?? [], ids) } : view;
}
export function isolateEntities(view: EditorViewState, ids: readonly string[]): EditorViewState {
  if (!ids.length) throw new Error("Select at least one entity to isolate");
  return { ...view, isolated: null, entityIsolated: [...new Set(ids)] };
}
export function resetEditorViewState(view: EditorViewState): EditorViewState {
  return !view.hidden.length &&
    !view.locked.length &&
    view.isolated === null &&
    !(view.entityHidden?.length) &&
    !(view.entityLocked?.length) &&
    view.entityIsolated == null &&
    view.yRange == null
    ? view
    : emptyEditorViewState();
}
export function editableRootIds(
  document: EditorDocument,
  view: EditorViewState,
): string[] {
  const policy = createRootViewResolver(view, document.objects);
  return document.objects
    .filter((object) => policy(object.id).editable)
    .map((object) => object.id);
}
export function visibleSceneBlocks(
  document: EditorDocument,
  view: EditorViewState,
): SceneBlock[] {
  const policy = createRootViewResolver(view, document.objects);
  return sceneBlocks({
    ...document,
    objects: document.objects.filter((object) => policy(object.id).drawn),
  }).filter((cell) => inYRange(cell.pos[1], view));
}
function unchanged(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = Object.keys(a),
    right = Object.keys(b);
  if (left.length !== right.length) return false;
  const leftRecord = a as Record<string, unknown>,
    rightRecord = b as Record<string, unknown>;
  return left.every(
    (key) =>
      Object.hasOwn(rightRecord, key) &&
      unchanged(leftRecord[key], rightRecord[key]),
  );
}
/** Guard the final candidate, including automatic neighbor changes, before commit. */
export function assertViewEdit(
  before: EditorDocument,
  candidate: EditorDocument,
  view: EditorViewState,
): void {
  if (
    !view.hidden.length &&
    !view.locked.length &&
    view.isolated === null &&
    view.entityIsolated == null &&
    view.yRange == null
  )
    return;
  const after = new Map(candidate.objects.map((object) => [object.id, object])),
    policy = createRootViewResolver(view, before.objects);
  const previous = new Map(before.objects.map((object) => [object.id, object]));
  if (view.entityIsolated != null && view.isolated === null &&
    candidate.objects.some((root) => !previous.has(root.id)))
    throw new Error("Block creation is unavailable while entity isolation is active");
  if (view.yRange != null) {
    const candidateRangePolicy = createRootViewResolver(
      { hidden: [], locked: [], isolated: null, yRange: view.yRange },
      candidate.objects,
    );
    for (const root of candidate.objects) {
      if (
        !unchanged(root, previous.get(root.id)) &&
        !candidateRangePolicy(root.id).editable
      ) {
        throw new Error(
          "Object extends outside the active Y range: " +
            root.name +
            " (" +
            root.id +
            ")",
        );
      }
    }
  }
  for (const root of before.objects) {
    if (!policy(root.id).editable && !unchanged(root, after.get(root.id))) {
      throw new Error(
        `Protected object cannot be changed: ${root.name} (${root.id})`,
      );
    }
  }
}
