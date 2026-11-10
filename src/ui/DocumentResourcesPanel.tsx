import { useEffect, useState } from "react";
import type { EditorDocument } from "../editor/model";
import { resourceManifest, type ResourceManifest } from "../io/portable-backup";
import type { ResourceSession } from "../resources/useResources";
import { ResourceCompatibilityPanel } from "./ResourceCompatibilityPanel";

type Props = {
  document: EditorDocument;
  resources: ResourceSession;
  onRecord: (current: EditorDocument, manifest: ResourceManifest) => boolean;
  disabled: boolean;
};
type Snapshot = {
  manifest: ResourceManifest | null;
  packs: ResourceSession["packs"];
  profile: ResourceSession["profile"];
  catalog: ResourceSession["catalog"];
  error: string;
};

/** Fingerprint capture is explicit document editing; resource changes only refresh the comparison. */
export function DocumentResourcesPanel({ document, resources, onRecord, disabled }: Props) {
  const { packs, profile, catalog } = resources;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [recorded, setRecorded] = useState<{ documentId: string; manifest: string } | null>(null);
  useEffect(() => {
    let active = true;
    void resourceManifest(packs, profile).then((manifest) => {
      if (active) setSnapshot({ manifest, packs, profile, catalog, error: "" });
    }).catch((cause) => {
      if (active) setSnapshot({ manifest: null, packs, profile, catalog,
        error: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => { active = false; };
  }, [packs, profile, catalog]);
  const fresh = snapshot?.packs === packs && snapshot.profile === profile && snapshot.catalog === catalog;
  const current = fresh ? snapshot?.manifest : null;
  const error = fresh ? snapshot?.error : "";
  const unavailable = disabled || resources.busy || !resources.ready || !current;
  function record() {
    if (unavailable || !current) return;
    if (onRecord(document, current)) setRecorded({ documentId: document.id, manifest: JSON.stringify(current) });
  }
  return <section className="portable-backup" aria-label="Document resources" aria-busy={!fresh}>
    <div className="storage-health-heading"><strong>Document resources</strong></div>
    <p className="backup-note">
      Records fingerprints only. Save to keep this change. Changing packs never updates this record automatically.
    </p>
    {!document.resources && <p className="backup-note">
      No resource manifest recorded. Existing document data is unchanged.
    </p>}
    {!fresh && <p role="status">Checking current resources…</p>}
    {error && <p className="document-manager-error" role="alert">{error}</p>}
    {document.resources && current && <ResourceCompatibilityPanel
      required={document.resources} current={current} resources={resources} disabled={disabled || !fresh} />}
    <div className="backup-actions">
      <button type="button" className="button" aria-label="Record current document resources"
        disabled={unavailable} onClick={record}>
        {document.resources ? "Replace recorded resources" : "Record current resources"}
      </button>
    </div>
    {recorded?.documentId === document.id && JSON.stringify(document.resources) === recorded.manifest &&
      <p className="storage-request-result" role="status">
      Resource fingerprints recorded. Save the document to keep this change.
    </p>}
  </section>;
}
