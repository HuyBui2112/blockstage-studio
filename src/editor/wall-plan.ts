import type { Material } from "../core/catalog";
import type { NeighborRules } from "../core/profile";
import { vecSchema, type BlockState, type Vec3 } from "../core/schema";
import { finalizeCopyPlan } from "./copy-action";
import { applyObjectCopyPlan, planObjectCopiesAt, type CopyPlanOptions, type ObjectCopyPlan } from "./copy-plan";
import { validateDocument, type EditorDocument, type EditorObject } from "./model";
import { checkPlanCancelled, operationBudget, validateOperationBase, type OperationBase } from "./operation-plan";
import { createPlacedObject } from "./placement";

export type WallOpening = { id: string; offset: number; bottom: number; width: number; height: number };
export type WallIntent = { start: Vec3; axis: "x" | "z"; direction: 1 | -1; length: number; height: number; openings: WallOpening[]; state: BlockState };
export type WallPlan = ObjectCopyPlan & { kind: "wall"; intent: WallIntent; notes: string[]; rules?: NeighborRules; wallCells: number; openingCells: number };
type Rectangle = { x: number; y: number; width: number; height: number; end: number };
const positive = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= 60000001;

/** One-cell-thick wall with omitted rectangular openings, never carving existing content. */
export function planWall(document: EditorDocument, intent: WallIntent, catalog: Material[], options: CopyPlanOptions, rules?: NeighborRules): WallPlan {
  checkPlanCancelled(options.signal);
  validateOperationBase(document, options.base);
  if (!options.operationId || options.operationId.length > 180) throw new Error("Wall operation ID must contain 1–180 characters");
  const start = vecSchema.parse(intent.start);
  if (intent.axis !== "x" && intent.axis !== "z") throw new Error("Wall axis must be World X or Z");
  if (intent.direction !== 1 && intent.direction !== -1) throw new Error("Wall direction must be +1 or -1");
  if (!positive(intent.length) || !positive(intent.height)) throw new Error("Wall length and height must be positive bounded integers");
  const axis = intent.axis === "x" ? 0 : 2;
  const terminal = [...start] as Vec3;
  terminal[axis] += intent.direction * (intent.length - 1);
  terminal[1] += intent.height - 1;
  // Validate the declared span, including the parts omitted by openings.
  vecSchema.parse(terminal);
  if (!Array.isArray(intent.openings) || intent.openings.length > 32) throw new Error("Wall supports at most 32 openings");
  const openings = intent.openings.map(opening => ({ ...opening })), ids = new Set<string>();
  let removed = 0n;
  for (let index = 0; index < openings.length; index++) {
    const opening = openings[index];
    if (typeof opening.id !== "string" || !opening.id.trim() || opening.id.length > 180 || ids.has(opening.id)) throw new Error("Wall opening IDs must be unique nonempty bounded strings");
    ids.add(opening.id);
    if (!Number.isSafeInteger(opening.offset) || opening.offset < 0 || !Number.isSafeInteger(opening.bottom) || opening.bottom < 0 || !positive(opening.width) || !positive(opening.height) || opening.offset + opening.width > intent.length || opening.bottom + opening.height > intent.height) throw new Error("Wall openings require positive integer rectangles contained within the wall");
    for (let before = 0; before < index; before++) {
      const other = openings[before];
      if (opening.offset < other.offset + other.width && other.offset < opening.offset + opening.width && opening.bottom < other.bottom + other.height && other.bottom < opening.bottom + opening.height) throw new Error("Wall openings must not overlap");
    }
    removed += BigInt(opening.width) * BigInt(opening.height);
  }
  const count = BigInt(intent.length) * BigInt(intent.height) - removed;
  if (!count) throw new Error("Wall openings remove every generated cell");
  const budget = operationBudget(options.budget);
  if (count > BigInt(budget.maxCells) || count > BigInt(budget.maxObjects)) throw new Error("Wall exceeds cell/object budget");
  // Count base trees before recursive schema/state validation or template expansion.
  if (BigInt(document.objects.length) + count > BigInt(budget.maxObjects)) throw new Error("Wall exceeds document object budget");
  const pending = document.objects.map(object => ({ object, depth: 1 })), seen = new Set<EditorObject>(), objectIds = new Set<string>();
  let cells = 0;
  for (let index = 0; index < pending.length; index++) {
    checkPlanCancelled(options.signal);
    const { object, depth } = pending[index];
    if (seen.has(object) || depth > 16) throw new Error("Wall base tree contains a cycle or exceeds depth limits");
    seen.add(object);
    if (objectIds.has(object.id)) throw new Error("Wall base has duplicate object IDs");
    objectIds.add(object.id);
    cells += object.cells.length;
    if (BigInt(cells) + count > BigInt(budget.maxCells) || BigInt(pending.length + object.children.length) + count > BigInt(budget.maxObjects)) throw new Error("Wall exceeds document cell/object budget");
    for (const child of object.children) pending.push({ object: child, depth: depth + 1 });
  }
  validateDocument(document, catalog);
  // Explicit ID prevents template construction from consuming randomness.
  const template = createPlacedObject(intent.state, start, catalog, undefined, `${options.operationId}:seed`);
  if (template.cells.length !== 1 || template.children.length) throw new Error("Wall requires one logical cell; paired blocks are unsupported");
  // At most 66 horizontal bands and 33 gaps per band, regardless of wall area.
  // Rectangles enumerate only retained cells; huge omitted regions never create loops.
  const cuts = [...new Set([0, intent.height, ...openings.flatMap(opening => [opening.bottom, opening.bottom + opening.height])])].sort((a, b) => a - b);
  const rectangles: Rectangle[] = [];
  let end = 0;
  for (let index = 0; index < cuts.length - 1; index++) {
    const y = cuts[index], height = cuts[index + 1] - y;
    const active = openings.filter(opening => opening.bottom <= y && opening.bottom + opening.height > y).sort((a, b) => a.offset - b.offset);
    let x = 0;
    for (const opening of [...active, { offset: intent.length, width: 0 }]) {
      const width = opening.offset - x;
      if (width) { end += width * height; rectangles.push({ x, y, width, height, end }); }
      x = opening.offset + opening.width;
    }
  }
  if (end !== Number(count)) throw new Error("Wall enumeration count mismatch");
  let rectangleIndex = 0;
  const plan = planObjectCopiesAt(document, [template], Number(count), index => {
    while (index >= rectangles[rectangleIndex].end) rectangleIndex++;
    const rectangle = rectangles[rectangleIndex];
    const local = index - (rectangle.end - rectangle.width * rectangle.height);
    const offset: Vec3 = [0, rectangle.y + Math.floor(local / rectangle.width), 0];
    offset[axis] = intent.direction * (rectangle.x + local % rectangle.width);
    return offset;
  }, catalog, options);
  const finalized = finalizeCopyPlan(plan, catalog, rules);
  return { ...finalized, kind: "wall", intent: { ...intent, start: [...start], state: { name: intent.state.name, properties: { ...intent.state.properties } }, openings }, wallCells: Number(count), openingCells: Number(removed) };
}

export function applyWallPlan(plan: WallPlan, current: EditorDocument, base: OperationBase, catalog: Material[], rules?: NeighborRules): EditorDocument {
  if (plan.rules !== rules) throw new Error("Wall connection policy changed; create a new preview");
  return applyObjectCopyPlan(plan, current, base, catalog);
}
