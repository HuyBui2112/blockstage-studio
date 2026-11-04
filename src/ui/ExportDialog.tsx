import { useMemo, useState } from "react";
import type { Material } from "../core/catalog";
import type { EditorDocument } from "../editor/model";
import {
  exportEditorDatapack,
  exportEditorStructure,
  preflightEditorExport,
} from "../io/editor-export";
import { download } from "../io/storage";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";

type Props = {
  document: EditorDocument;
  catalog: Material[];
  onClose: () => void;
};

function filename(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "blockstage-structure"
  );
}

export function ExportDialog({ document, catalog, onClose }: Props) {
  const [format, setFormat] = useState<"nbt" | "datapack">("nbt");
  const [failure, setFailure] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const preflight = useMemo(
    () => preflightEditorExport(document, catalog),
    [document, catalog],
  );
  const errors = preflight.issues.filter((issue) => issue.severity === "error");
  const warnings = preflight.issues.filter(
    (issue) => issue.severity === "warning",
  );
  const issues = [...errors, ...warnings];
  const name = filename(document.name);
  const extension = format === "nbt" ? ".nbt" : ".zip";

  function exportFile() {
    if (!preflight.valid) return;
    setFailure("");
    setDownloaded(false);
    try {
      const bytes =
        format === "nbt"
          ? exportEditorStructure(document, catalog).bytes
          : exportEditorDatapack(document, catalog);
      download(
        `${name}${extension}`,
        bytes,
        format === "nbt" ? "application/octet-stream" : "application/zip",
      );
      setDownloaded(true);
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not create the Minecraft export. Please try again.",
      );
    }
  }

  const issueItem = (issue: (typeof issues)[number], index: number) => (
    <li
      key={`${issue.code}:${issue.objectId ?? ""}:${index}`}
      className={issue.severity}
    >
      <Icon name={issue.severity === "error" ? "warning" : "info"} size={14} />
      <span>{issue.message}</span>
    </li>
  );
  return (
    <Dialog
      title="Export Minecraft"
      onClose={onClose}
      className="export-dialog"
    >
      <div className="dialog-content export-content">
        <div className="export-document">
          <Icon name="architecture" size={20} />
          <div>
            <strong>{document.name}</strong>
            <span>
              Minecraft Java {document.target.gameVersion} · DataVersion{" "}
              {document.target.dataVersion}
            </span>
          </div>
        </div>
        <label className="export-format">
          <span>Format</span>
          <select
            aria-label="Export format"
            value={format}
            onChange={(event) => {
              setFormat(event.target.value as "nbt" | "datapack");
              setDownloaded(false);
              setFailure("");
            }}
          >
            <option value="nbt">Structure NBT (.nbt)</option>
            <option value="datapack">Datapack (.zip)</option>
          </select>
        </label>
        <p className="export-format-note">
          {format === "nbt"
            ? "A vanilla structure file for a world or datapack."
            : "Install the ZIP in your world’s datapacks folder, then reload the world."}
        </p>
        {format === "datapack" && (
          <code className="export-command">
            /place template blockstage:build ~ ~ ~
          </code>
        )}
        <dl className="export-metrics">
          <div>
            <dt>Blocks</dt>
            <dd>{preflight.blockCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Entities</dt>
            <dd>{preflight.entityCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Size · X × Y × Z</dt>
            <dd>{preflight.size.join(" × ")}</dd>
          </div>
        </dl>
        <p className="export-origin">
          Document origin <code>{preflight.origin.join(", ")}</code>
          <span aria-hidden="true"> → </span>export origin <code>0, 0, 0</code>
        </p>
        {!!issues.length && (
          <section
            className={`export-preflight${errors.length ? " has-errors" : ""}`}
            aria-label="Export checks"
          >
            <strong>
              {errors.length
                ? `${errors.length} ${errors.length === 1 ? "issue blocks" : "issues block"} export`
                : `${warnings.length} ${warnings.length === 1 ? "note" : "notes"} before export`}
            </strong>
            <ul>{issues.slice(0, 4).map(issueItem)}</ul>
            {issues.length > 4 && (
              <details>
                <summary>Show {issues.length - 4} more</summary>
                <ul>{issues.slice(4, 100).map(issueItem)}</ul>
                {issues.length > 100 && (
                  <p>
                    {issues.length - 100} additional issues. Resolve these
                    checks and export again.
                  </p>
                )}
              </details>
            )}
          </section>
        )}
        <details className="quiet-details export-details">
          <summary>Export details</summary>
          <p>
            Exports the committed document captured when this dialog opened.
            Active transform previews are excluded. Object groups become blocks;
            the editor document stays unchanged.
          </p>
          <p>
            Coordinates are normalized together. Placement support, neighbor
            updates and game behavior require verification in Minecraft.
          </p>
        </details>
        {failure && (
          <p className="export-failure" role="alert">
            {failure}
          </p>
        )}
        <p className="export-download-status" role="status">
          {downloaded ? "Export created. Check your browser downloads." : ""}
        </p>
      </div>
      <footer className="dialog-footer export-footer">
        <code title={`${name}${extension}`}>
          {name}
          {extension}
        </code>
        <button
          className="button primary"
          aria-label="Download Minecraft export"
          disabled={!preflight.valid}
          onClick={exportFile}
        >
          <Icon name="file" size={15} />
          Download
        </button>
      </footer>
    </Dialog>
  );
}
