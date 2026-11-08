import { useEffect, useRef, useState } from "react";
import type { EditorDocument } from "../editor/model";
import type { Material } from "../core/catalog";
import { importStructureFile } from "../io/import-structure-file";
import type { StructureImport } from "../io/structure-import";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import "./documents.css";

export function ImportStructureDialog({
  document,
  catalog,
  onImport,
  onClose,
  error,
}: {
  document: EditorDocument;
  catalog: Material[];
  onImport: (next: EditorDocument, current: EditorDocument) => Promise<boolean>;
  onClose: () => void;
  error: string;
}) {
  const [result, setResult] = useState<StructureImport | null>(null),
    [busy, setBusy] = useState(false),
    [committing, setCommitting] = useState(false),
    [failure, setFailure] = useState(""),
    [ack, setAck] = useState(false);
  const job = useRef<AbortController | null>(null),
    mounted = useRef(true);
  const commitLock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      job.current?.abort();
    };
  }, []);
  async function inspect(file: File) {
    job.current?.abort();
    const controller = new AbortController();
    job.current = controller;
    setResult(null);
    setFailure("");
    setAck(false);
    setBusy(true);
    try {
      const value = await importStructureFile(
        file,
        document.workspace,
        catalog,
        controller.signal,
      );
      if (mounted.current && !controller.signal.aborted) setResult(value);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted)
        setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current && job.current === controller) setBusy(false);
    }
  }
  async function commit() {
    if (!result || !ack || commitLock.current) return;
    commitLock.current = true;
    setCommitting(true);
    try {
      if (await onImport(result.document, document)) onClose();
    } finally {
      commitLock.current = false;
      if (mounted.current) setCommitting(false);
    }
  }
  return (
    <Dialog
      title="Import Structure NBT"
      onClose={() => {
        if (!committing) onClose();
      }}
      className="export-dialog"
    >
      <div className="dialog-content" aria-busy={busy || committing}>
        <label className="button">
          <Icon name="upload" size={15} />
          Choose .nbt
          <input
            className="visually-hidden"
            type="file"
            accept=".nbt"
            aria-label="Import Structure NBT file"
            disabled={committing}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void inspect(file);
            }}
          />
        </label>
        <p className="backup-note">
          Java Structure NBT · 26.2 / DataVersion 4903 · gzip or uncompressed ·
          blocks and single chests with basic inventory
        </p>
        {busy && <p role="status">Reading and validating structure…</p>}
        {result && (
          <section
            className="backup-report"
            aria-label="Structure import report"
          >
            <strong>{result.document.name}</strong>
            <small>
              {result.blockCount.toLocaleString()} cells · {result.multiBlocks}{" "}
              multi-blocks · {result.airCount} explicit air
            </small>
            <p>Declared size: {result.size.join(" × ")} blocks</p>
            <ul>
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <label className="backup-library">
              <input
                type="checkbox"
                aria-label="Accept Structure NBT import policy"
                checked={ack}
                onChange={(event) => setAck(event.target.checked)}
                disabled={committing}
              />
              Import these cells as a new saved document
            </label>
          </section>
        )}
        {(failure || error) && (
          <p className="document-manager-error" role="alert">
            {failure || error}
          </p>
        )}
        <details className="quiet-details storage-details">
          <summary>Supported scope</summary>
          <p>
            Requires legal states from the current registry and complete
            bed/door/plant pairs. Existing work is protected before switching.
            No data changes until you confirm.
          </p>
          <p>
            Single chests support 27 slots, four supported plain item IDs and stacks 1–64.
            Unsupported versions, multiple palettes, entities, item components,
            other block-entity payloads and unknown fields are rejected. No conversion or silent
            removal. Input: 16 MiB; decompressed: 32 MiB; 100,000 explicit
            blocks, dimensions at most 2048 each. This is not a .schem,
            .litematic or world importer.
          </p>
        </details>
      </div>
      <footer className="dialog-footer">
        <button className="button" disabled={committing} onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          aria-label="Confirm Structure NBT import"
          disabled={!result || busy || !ack || committing}
          onClick={() => void commit()}
        >
          {committing ? "Importing…" : "Import as new"}
        </button>
      </footer>
    </Dialog>
  );
}
