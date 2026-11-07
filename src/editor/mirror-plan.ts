import type { Material } from "../core/catalog";
import { mirrorBlockState, type MirrorPlane } from "../core/mirror";
import type { NeighborRules } from "../core/profile";
import type { Vec3 } from "../core/schema";
import { finalizeCopyPlan } from "./copy-action";
import { applyObjectCopyPlan, selectedCopyObjects, type CopyPlanOptions, type ObjectCopyPlan } from "./copy-plan";
import { executeHistory } from "./history";
import { objectCells, sceneBlocks, validateDocument, type EditorDocument, type EditorObject, type PivotMode, type QuarterTurn } from "./model";
import { checkPlanCancelled, operationBudget, validateOperationBase, type OperationBase } from "./operation-plan";

export type MirrorIntent = { plane: MirrorPlane; pivotMode: PivotMode | "custom"; plane2?: number };
export type MirrorPlan = ObjectCopyPlan & { kind: "mirror"; intent: MirrorIntent; notes: string[]; rules?: NeighborRules };

/** Reflect complete logical owners; never expand an unbounded or cyclic input tree. */
export function planMirror(document: EditorDocument, ids: string[], intent: MirrorIntent, catalog: Material[], options: CopyPlanOptions, rules?: NeighborRules): MirrorPlan {
  checkPlanCancelled(options.signal);
  validateOperationBase(document, options.base);
  if (intent.plane !== "yz" && intent.plane !== "xy") throw new Error("Mirror requires vertical World YZ or XY plane");
  if (!["active", "selection", "individual", "custom"].includes(intent.pivotMode)) throw new Error("Invalid mirror pivot mode");
  if (!options.operationId || options.operationId.length > 180) throw new Error("Mirror operation ID must contain 1–180 characters");
  if (intent.pivotMode === "custom") {
    if (!Number.isSafeInteger(intent.plane2) || intent.plane2! < -60000000 || intent.plane2! > 60000002) throw new Error("Mirror custom plane2 must be a bounded doubled integer coordinate");
  } else if (intent.plane2 !== undefined) throw new Error("Custom plane coordinate requires custom pivot mode");
  const budget = operationBudget(options.budget);
  if (document.objects.length > budget.maxObjects) throw new Error("Mirror exceeds object budget");
  const pending = document.objects.map(object => ({ object, depth: 1 })), seen = new Set<EditorObject>(), usedIds = new Set<string>();
  let cellCount = 0;
  for (let index = 0; index < pending.length; index++) {
    checkPlanCancelled(options.signal);
    const { object, depth } = pending[index];
    if (seen.has(object) || depth > 16) throw new Error("Mirror tree contains a cycle or exceeds depth limits");
    seen.add(object);
    if (usedIds.has(object.id)) throw new Error("Mirror tree contains duplicate object IDs");
    usedIds.add(object.id);
    cellCount += object.cells.length;
    if (cellCount > budget.maxCells || pending.length + object.children.length > budget.maxObjects) throw new Error("Mirror exceeds cell/object budget");
    for (const child of object.children) pending.push({ object: child, depth: depth + 1 });
  }
  const selected = selectedCopyObjects(document, ids), chosen = new Set(ids), axis = intent.plane === "yz" ? 0 : 2;
  validateDocument(document, catalog);
  const selectedCells = selected.flatMap(objectCells);
  if (!selectedCells.length) throw new Error("Mirror requires occupied cells");
  const positions = selectedCells.map(cell => cell.pos[axis]);
  let minimum = Infinity, maximum = -Infinity;
  for (const value of positions) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  const active = document.objects.find(object => object.id === ids[ids.length - 1])!;
  const sharedPlane = intent.pivotMode === "custom" ? intent.plane2! : intent.pivotMode === "active" ? active.pivot2[axis] : minimum + maximum + 1;
  const materials = new Map(catalog.map(material => [material.id, material]));
  function reflect(object: EditorObject, plane2: number): EditorObject {
    checkPlanCancelled(options.signal);
    return { ...object,
      cells: object.cells.map(cell => {
        const pos = [...cell.pos] as Vec3;
        pos[axis] = plane2 - pos[axis] - 1;
        return { ...cell, pos, state: mirrorBlockState(cell.state, intent.plane, materials.get(cell.state.name), cell.blockEntity) };
      }),
      children: object.children.map(child => reflect(child, plane2)),
      pivot2: object.pivot2.map((value, coordinate) => coordinate === axis ? 2 * plane2 - value : value) as Vec3,
      orientation: ((intent.plane === "yz" ? 4 - object.orientation : 6 - object.orientation) % 4) as QuarterTurn,
    };
  }
  const reflected = { ...document, objects: document.objects.map(object => chosen.has(object.id) ? reflect(object, intent.pivotMode === "individual" ? object.pivot2[axis] : sharedPlane) : object) };
  validateDocument(reflected, catalog);
  checkPlanCancelled(options.signal);
  const history = executeHistory({ document, past: [], future: [] }, reflected, "Mirror objects"), patches = history.past[0]?.patches ?? [];
  const candidate = patches.length ? reflected : document;
  const cells = sceneBlocks(candidate).filter(cell => chosen.has(cell.owner));
  const plan: ObjectCopyPlan = { base: { ...options.base }, source: document, document: candidate, selection: [...ids], addedObjectIds: [], patches, cells, changedChunks: [], cost: { addedObjects: 0, addedCells: 0, resultObjects: pending.length, resultCells: cellCount }, ...(options.signal ? { signal: options.signal } : {}) };
  const final = candidate === document ? { ...plan, notes: [], rules } : finalizeCopyPlan(plan, catalog, rules);
  const oldCells = sceneBlocks(document).filter(cell => chosen.has(cell.owner));
  return { ...final, kind: "mirror", intent: { ...intent }, changedChunks: [...new Set([...oldCells, ...final.cells].map(cell => cell.pos.map(value => Math.floor(value / 16)).join(",")))] };
}

export function applyMirrorPlan(plan: MirrorPlan, current: EditorDocument, base: OperationBase, catalog: Material[], rules?: NeighborRules): EditorDocument {
  if (plan.rules !== rules) throw new Error("Mirror connection policy changed; create a new preview");
  return applyObjectCopyPlan(plan, current, base, catalog);
}
