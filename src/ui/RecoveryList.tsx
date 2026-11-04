import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftListing } from "../io/draft-repository";
import type { DraftHead } from "../io/draft-storage";
import type { EditorDocument } from "../editor/model";
import { Icon } from "./Icon";

export type RecoveryProps = {
  onRecoveryList: () => Promise<DraftListing>;
  onRestore: (head: DraftHead, copy: boolean) => Promise<boolean>;
  onDiscardRecovery: (head: DraftHead) => Promise<boolean>;
  onRecoveryDocument: (head: DraftHead) => Promise<EditorDocument>;
};
export function RecoveryList({
  scope,
  onRecoveryList,
  onRestore,
  onDiscardRecovery,
  onRecoveryDocument,
  onClose,
  error,
  onBusy,
}: RecoveryProps & {
  scope: EditorDocument["workspace"];
  onClose: () => void;
  error: string;
  onBusy: (busy: boolean) => void;
}) {
  const [records, setRecords] = useState<DraftHead[]>([]);
  const [loading, setLoading] = useState(true),
    [working, setWorking] = useState(false);
  const [failure, setFailure] = useState("");
  const issues = [...new Set([error, failure].filter(Boolean))].join(" ");
  const [pending, setPending] = useState<{
    head: DraftHead;
    kind: "restore" | "copy" | "discard";
  } | null>(null);
  const confirmation = useRef<HTMLElement>(null);
  useEffect(() => {
    confirmation.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
  }, [pending]);
  const refresh = useCallback(async () => {
    const list = await onRecoveryList();
    setRecords(
      list.records
        .filter((head) => head.workspace === scope)
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
    );
    setFailure(list.issues.join(" "));
  }, [onRecoveryList, scope]);
  useEffect(() => {
    let active = true;
    void onRecoveryList()
      .then((list) => {
        if (!active) return;
        setRecords(
          list.records
            .filter((head) => head.workspace === scope)
            .sort(
              (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
            ),
        );
        setFailure(list.issues.join(" "));
      })
      .catch((error) => {
        if (active) setFailure(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onRecoveryList, scope]);
  async function run(work: () => Promise<void>) {
    if (working) return;
    setWorking(true);
    onBusy(true);
    try {
      await work();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
      onBusy(false);
    }
  }
  async function confirm() {
    if (!pending) return;
    await run(async () => {
      if (pending.kind === "discard") {
        if (await onDiscardRecovery(pending.head)) {
          setPending(null);
          await refresh();
        }
      } else if (await onRestore(pending.head, pending.kind === "copy"))
        onClose();
    });
  }
  async function backup(head: DraftHead) {
    await run(async () => {
      const { download } = await import("../io/storage");
      const document = await onRecoveryDocument(head);
      download(
        `${document.name}.recovery.blockstage.json`,
        JSON.stringify(document, null, 2),
        "application/json",
      );
    });
  }
  return (
    <section
      className="recovery-list"
      aria-label="Recovery drafts"
      aria-busy={loading || working}
    >
      <div className="recovery-heading">
        <span>Recovery copies · Saved checkpoints stay unchanged</span>
        <button
          className="icon-button"
          aria-label="Refresh recovery drafts"
          disabled={working}
          onClick={() => void run(refresh)}
        >
          <Icon name="refresh" size={15} />
        </button>
      </div>
      {loading ? (
        <p role="status">Loading recovery…</p>
      ) : (
        !records.length && (
          <div className="documents-empty">
            No recovery copies in this workspace
          </div>
        )
      )}
      {records.slice(0, 32).map((head) => (
        <article
          className="recovery-item"
          key={head.id}
          data-recovery-id={head.id}
        >
          <div>
            <strong>{head.name}</strong>
            <small>
              {head.cells} cells · revision {head.revision} ·{" "}
              <time dateTime={new Date(head.updatedAt).toISOString()}>
                {new Date(head.updatedAt).toLocaleString()}
              </time>
            </small>
            <code title={`${head.documentId} / ${head.id}`}>
              {head.id.slice(0, 8)}…{head.id.slice(-4)}
            </code>
          </div>
          <div className="recovery-actions">
            <button
              className="button"
              disabled={working}
              aria-label={`Restore draft ${head.name}`}
              onClick={() => setPending({ head, kind: "restore" })}
            >
              Restore
            </button>
            <button
              className="button"
              disabled={working}
              aria-label={`Recover copy ${head.name}`}
              onClick={() => setPending({ head, kind: "copy" })}
            >
              Recover copy
            </button>
            <button
              className="icon-button"
              disabled={working}
              aria-label={`Download recovery ${head.name}`}
              onClick={() => void backup(head)}
            >
              <Icon name="file" size={15} />
            </button>
            <button
              className="icon-button danger-button"
              disabled={working}
              aria-label={`Discard recovery ${head.name}`}
              onClick={() => setPending({ head, kind: "discard" })}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        </article>
      ))}
      {pending && (
        <section
          ref={confirmation}
          className="document-confirm"
          aria-label="Recovery confirmation"
        >
          <strong>
            {pending.kind === "discard"
              ? "Discard this recovery copy?"
              : pending.kind === "copy"
                ? "Recover as an independent copy?"
                : "Restore unsaved work?"}
          </strong>
          <p>
            {pending.kind === "discard"
              ? "Removes this recovery copy. Saved documents and component library items are kept."
              : pending.kind === "copy"
                ? "Uses a new document ID and keeps the saved checkpoint unchanged."
                : "Continues the original document only if its saved version is unchanged. Your current edits are protected before switching."}
          </p>
          <div>
            <button
              className="button"
              disabled={working}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={working}
              aria-label="Confirm recovery action"
              onClick={() => void confirm()}
            >
              {working
                ? "Working…"
                : pending.kind === "discard"
                  ? "Discard recovery"
                  : "Restore"}
            </button>
          </div>
        </section>
      )}
      {issues && (
        <p className="document-manager-error" role="alert">
          {issues}
        </p>
      )}
    </section>
  );
}
