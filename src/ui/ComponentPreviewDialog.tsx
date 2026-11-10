import { lazy, Suspense, useMemo, useState } from "react";
import type { ComponentAsset } from "../editor/model";
import type { ResourceSession } from "../resources/useResources";
import { inspectComponentPreview } from "../render/component-preview";
import type { RenderDiagnostics, ViewCommand } from "../viewport/Viewport";
import { Dialog } from "./Dialog";

const Viewport = lazy(() => import("../viewport/Viewport").then((module) => ({ default: module.Viewport })));
const noop = () => {};
const EMPTY: [] = [];

export function ComponentPreviewDialog({ asset, resources, onClose, onResources }: {
  asset: ComponentAsset;
  resources: ResourceSession;
  onClose: () => void;
  onResources: () => void;
}) {
  const plan = useMemo(() => {
    try {
      return inspectComponentPreview(asset, resources.catalog, resources.profile, resources.resolver);
    } catch (error) {
      return { blocks: [], issues: [error instanceof Error ? error.message : "Preview unavailable"],
        totalIssues: 1, checkedStates: 0, complete: false, status: "unavailable" as const,
        storedCells: 0, nonAirCells: 0 };
    }
  },
    [asset, resources.catalog, resources.profile, resources.resolver]);
  const [command, setCommand] = useState<ViewCommand>();
  const [diagnostics, setDiagnostics] = useState<{ plan: typeof plan; value: RenderDiagnostics } | null>(null);
  const currentDiagnostics = diagnostics?.plan === plan ? diagnostics.value : null;
  return <div onKeyDown={(event) => event.stopPropagation()}>
    <Dialog title="Component preview" className="component-preview-dialog" onClose={onClose}>
    <div className="component-preview-content">
      <div className="component-preview-heading"><strong>{asset.name}</strong>
        <span role="status">{plan.status} · {plan.storedCells.toLocaleString()} stored cells</span>
        <button type="button" aria-label="Frame component preview" disabled={!plan.blocks.length}
          onClick={() => setCommand((previous) => ({ id: (previous?.id ?? 0) + 1, kind: "frame-all" }))}>Frame</button>
      </div>
      <div className="component-preview-canvas">
        {plan.blocks.length > 0 ? <Suspense fallback={<p role="status">Opening preview…</p>}>
          <Viewport blocks={plan.blocks} packs={resources.packs} catalog={resources.catalog}
            profile={resources.profile} resolver={resources.resolver} selected={null}
            tool="select" layer={0} ghost={EMPTY} clip={null} local={false} entities={EMPTY}
            previewMode command={command} frameKey={asset.id}
            onPick={noop} onDelete={noop} onUndo={noop} onRotate={noop} onMessage={noop}
            onHover={noop} onEntityPick={noop} onDiagnostics={(value) => setDiagnostics({ plan, value })} />
        </Suspense> : <p role="status">{plan.status === "limited" ? "This component exceeds the preview limit." :
          plan.status === "unavailable" ? "Preview unavailable. See the notes below." : "No visible non-air cells."}</p>}
      </div>
      <small>Read-only · MMB orbit · Shift MMB pan · wheel zoom · fixed preview lighting/tint</small>
      {(plan.totalIssues > 0 || !!currentDiagnostics?.issues.length) && <details open className="component-preview-issues">
        <summary>Resource and appearance notes</summary>
        <ul>{[...new Set([...plan.issues, ...(currentDiagnostics?.issues ?? [])])].slice(0, 24).map((issue) => <li key={issue}>{issue}</li>)}</ul>
        {!plan.complete && <p>Inspection is limited; remaining states are not confirmed.</p>}
        <button type="button" aria-label="Open component preview resources" onClick={onResources}>Open Resources</button>
      </details>}
    </div>
  </Dialog></div>;
}
