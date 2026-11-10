import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { ComponentAsset } from "../editor/model";
import type { ResourceSession } from "../resources/useResources";
import type { ThumbnailEntry } from "./useComponentThumbnails";
import { Icon } from "./Icon";

const Viewport = lazy(() => import("../viewport/Viewport").then((module) => ({ default: module.Viewport })));
const EMPTY: [] = [];
const noop = () => {};

export function ComponentThumbnail({ asset, entry, onVisibility }: {
  asset: ComponentAsset;
  entry?: ThumbnailEntry;
  onVisibility: (id: string, visible: boolean) => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = host.current!;
    if (typeof IntersectionObserver === "undefined") {
      onVisibility(asset.id, true);
      return () => onVisibility(asset.id, false);
    }
    const observer = new IntersectionObserver(([entry]) => onVisibility(asset.id, entry.isIntersecting));
    observer.observe(element);
    return () => { observer.disconnect(); onVisibility(asset.id, false); };
  }, [asset.id, onVisibility]);
  useEffect(() => {
    const element = image.current;
    if (!element || !entry?.blob) return;
    const url = URL.createObjectURL(entry.blob);
    element.hidden = false;
    element.src = url;
    return () => { element.removeAttribute("src"); URL.revokeObjectURL(url); };
  }, [entry?.blob]);
  return <span ref={host} className="component-thumbnail" title={entry?.note ?? "Thumbnail loads when visible"}
    data-thumbnail-status={entry?.status ?? "loading"} data-thumbnail-source={entry?.source}>
    {entry?.blob ? <img ref={image} alt={`Thumbnail of ${asset.name}`}
      onError={(event) => { event.currentTarget.hidden = true; }} /> : <Icon name="blocks" size={24} />}
    {entry?.plan?.status === "partial" && <small>Partial</small>}
  </span>;
}

export function ComponentThumbnailRenderer({ entry, resources, onCapture }: {
  entry: ThumbnailEntry;
  resources: ResourceSession;
  onCapture: (blob: Blob | null, error?: string) => void;
}) {
  const callback = useRef(onCapture);
  useLayoutEffect(() => { callback.current = onCapture; }, [onCapture]);
  useEffect(() => {
    const timeout = setTimeout(() => callback.current(null, "Thumbnail rendering timed out. Reopen the library to retry."), 20000);
    return () => clearTimeout(timeout);
  }, [entry.requestId]);
  const capture = useMemo(() => ({ id: entry.requestId, onCapture: (blob: Blob | null, error?: string) => callback.current(blob, error) }), [entry.requestId]);
  if (!entry.plan || !entry.key) return null;
  return <div className="component-thumbnail-renderer" aria-hidden="true" inert>
    <Suspense fallback={null}>
      <Viewport blocks={entry.plan.blocks} packs={resources.packs} catalog={resources.catalog}
        profile={resources.profile} resolver={resources.resolver} selected={null} tool="select"
        layer={0} ghost={EMPTY} clip={null} local={false} entities={EMPTY} previewMode
        frameKey={entry.key} thumbnailCapture={capture}
        onPick={noop} onDelete={noop} onUndo={noop} onRotate={noop} onMessage={noop}
        onHover={noop} onEntityPick={noop} onDiagnostics={noop} />
    </Suspense>
  </div>;
}
