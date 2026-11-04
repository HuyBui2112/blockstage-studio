import { z } from "zod";
import type { Material } from "../core/catalog";
import type { Vec3 } from "../core/schema";
import {
  applyObjectCopyPlan,
  planObjectCopies,
  selectedCopyObjects,
  type CopyPlanOptions,
  type ObjectCopyPlan,
} from "./copy-plan";
import {
  editorDocumentSchema,
  objectCells,
  validateDocument,
  type EditorDocument,
  type EditorObject,
} from "./model";
import { checkPlanCancelled, type OperationBase } from "./operation-plan";

export type EditorClipboard = {
  format: "blockstage-clipboard";
  version: 1;
  target: EditorDocument["target"];
  anchor: Vec3;
  objects: EditorObject[];
};
export type PasteOptions = CopyPlanOptions;
export type PastePlan = ObjectCopyPlan &
  Readonly<{ kind: "paste"; position: Vec3 }>;

const integerVector = z.tuple([
  z.number().int().safe(),
  z.number().int().safe(),
  z.number().int().safe(),
]);
const envelopeSchema = z
  .object({
    format: z.literal("blockstage-clipboard"),
    version: z.literal(1),
    target: z
      .object({ gameVersion: z.literal("26.2"), dataVersion: z.literal(4903) })
      .strict(),
    anchor: integerVector,
    objects: z.unknown(),
  })
  .strict();

/** Reuse the document's bounded, strict tree parser before any recursive copying. */
function clipboardSnapshot(
  value: unknown,
  catalog: Material[],
  signal?: AbortSignal,
): EditorClipboard {
  checkPlanCancelled(signal);
  const envelope = envelopeSchema.parse(value);
  const document = editorDocumentSchema.parse({
    schemaVersion: 2,
    id: "clipboard",
    name: "Clipboard",
    workspace: "architecture",
    target: envelope.target,
    objects: envelope.objects,
    entities: [],
  });
  if (!document.objects.length)
    throw new Error("Clipboard must contain objects");
  validateDocument(document, catalog);
  checkPlanCancelled(signal);
  return { ...envelope, objects: document.objects };
}

/** Internal memory only: coordinates and provenance stay intact; entities are excluded. */
export function createClipboard(
  document: EditorDocument,
  ids: string[],
  catalog: Material[],
  anchor?: Vec3,
  signal?: AbortSignal,
): EditorClipboard {
  checkPlanCancelled(signal);
  validateDocument(document, catalog);
  const objects = selectedCopyObjects(document, ids);
  let origin: Vec3;
  if (anchor) origin = integerVector.parse(anchor);
  else {
    origin = [Infinity, Infinity, Infinity];
    for (const object of objects)
      for (const cell of objectCells(object)) {
        for (let axis = 0; axis < 3; axis++)
          origin[axis] = Math.min(origin[axis], cell.pos[axis]);
      }
  }
  return clipboardSnapshot(
    {
      format: "blockstage-clipboard",
      version: 1,
      target: document.target,
      anchor: origin,
      objects,
    },
    catalog,
    signal,
  );
}

export function planPaste(
  document: EditorDocument,
  clipboard: EditorClipboard,
  position: Vec3,
  catalog: Material[],
  options: PasteOptions,
): PastePlan {
  checkPlanCancelled(options.signal);
  const destination = integerVector.parse(position);
  const snapshot = clipboardSnapshot(clipboard, catalog, options.signal);
  const delta = destination.map(
    (value, axis) => value - snapshot.anchor[axis],
  ) as Vec3;
  const plan = planObjectCopies(
    document,
    snapshot.objects,
    { count: 1, offset: delta, step: [0, 0, 0] },
    catalog,
    options,
  );
  return { ...plan, kind: "paste", position: destination };
}

/** Apply the exact preview using the shared identity/revision/cancellation guard. */
export function applyPastePlan(
  plan: PastePlan,
  current: EditorDocument,
  base: OperationBase,
  catalog: Material[],
): EditorDocument {
  return applyObjectCopyPlan(plan, current, base, catalog);
}
