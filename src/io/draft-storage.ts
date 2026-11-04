import { z } from "zod";
import type { EditorDocument } from "../editor/model";

export const repositoryTokenSchema = z
  .object({
    generation: z.string().min(1).max(200),
    version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const draftHeadSchema = z
  .object({
    id: z.string().min(1).max(200),
    epoch: z.string().min(1).max(200),
    documentId: z.string().min(1).max(200),
    workspace: z.enum(["architecture", "component"]),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    base: repositoryTokenSchema.nullable(),
    name: z.string().min(1).max(120),
    status: z.enum(["live", "retired"]),
    bytes: z
      .number()
      .int()
      .min(0)
      .max(32 * 1024 ** 2),
    updatedAt: z.number().int().min(0).max(8640000000000000),
    cells: z.number().int().min(0).max(100000),
    componentAssetId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type DraftHead = z.infer<typeof draftHeadSchema>;
export type DraftIdentity = Pick<
  DraftHead,
  "id" | "epoch" | "documentId" | "workspace"
>;
export const DRAFT_STORES = ["editorDrafts", "editorDraftHeads"];
export const MAX_DRAFTS = 32;
export const MAX_DRAFT_BYTES = 64 * 1024 ** 2;
export const RECOVERY_CHANGED = "blockstage-recovery-change";
export function notifyRecoveryChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(RECOVERY_CHANGED));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(RECOVERY_CHANGED);
      channel.postMessage("changed");
      channel.close();
    } catch {
      /* CAS remains the concurrency boundary. */
    }
  }
}

export class DraftConflict extends Error {
  constructor(
    message = "This recovery draft changed or was discarded. Refresh the list; local edits were kept.",
  ) {
    super(message);
    this.name = "DraftConflict";
  }
}
export function sameDraft(a: DraftIdentity, b: DraftIdentity) {
  return (
    a.id === b.id &&
    a.epoch === b.epoch &&
    a.documentId === b.documentId &&
    a.workspace === b.workspace
  );
}
export function retired(identity: DraftIdentity, old?: DraftHead): DraftHead {
  return {
    id: identity.id,
    epoch: identity.epoch,
    documentId: identity.documentId,
    workspace: identity.workspace,
    name: old?.name ?? "Discarded draft",
    revision: old?.revision ?? 0,
    base: old?.base ?? null,
    status: "retired",
    bytes: 0,
    cells: 0,
    updatedAt: Date.now(),
  };
}
/** Queues all work synchronously on native transaction callbacks. No promises inside IDB. */
export function retireDraft(
  tx: IDBTransaction,
  identity: DraftIdentity,
  fail: (error: unknown) => void,
  expectedRevision?: number,
  requireLiveOrAbsent = false,
) {
  const heads = tx.objectStore("editorDraftHeads"),
    request = heads.get(identity.id);
  request.onsuccess = () => {
    try {
      const head =
        request.result === undefined
          ? undefined
          : draftHeadSchema.parse(request.result);
      if (head && !sameDraft(head, identity)) throw new DraftConflict();
      if (head?.status === "retired" && requireLiveOrAbsent)
        throw new DraftConflict();
      if (
        expectedRevision !== undefined &&
        (!head || head.status !== "live" || head.revision !== expectedRevision)
      )
        throw new DraftConflict();
      heads.put(draftHeadSchema.parse(retired(identity, head)));
      tx.objectStore("editorDrafts").delete(identity.id);
    } catch (error) {
      fail(error);
    }
  };
}
export function retireDocumentDrafts(
  tx: IDBTransaction,
  documentId: string,
  fail: (error: unknown) => void,
) {
  const cursor = tx
    .objectStore("editorDraftHeads")
    .index("documentId")
    .openCursor(documentId);
  cursor.onsuccess = () => {
    try {
      if (!cursor.result) return;
      const head = draftHeadSchema.parse(cursor.result.value);
      if (head.status === "live") {
        cursor.result.update(retired(head, head));
        tx.objectStore("editorDrafts").delete(head.id);
      }
      cursor.result.continue();
    } catch (error) {
      fail(error);
    }
  };
}
export function countDocumentCells(document: EditorDocument): number {
  const count = (objects: EditorDocument["objects"]): number =>
    objects.reduce(
      (sum, object) => sum + object.cells.length + count(object.children),
      0,
    );
  return count(document.objects);
}
