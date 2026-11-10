import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentAsset } from "../editor/model";
import type { ResourceSession } from "../resources/useResources";
import { resourceManifest, type ResourceManifest } from "../io/portable-backup";
import { thumbnailCache, thumbnailKey } from "../io/component-thumbnails";
import { inspectComponentPreview, type ComponentPreviewInspection } from "../render/component-preview";

export type ThumbnailEntry = {
  requestId: string;
  asset: ComponentAsset;
  key: string | null;
  plan: ComponentPreviewInspection | null;
  blob: Blob | null;
  status: "pending" | "ready" | "unavailable";
  source?: "cache" | "render";
  note: string;
};

/** One visible-card queue and one disposable renderer; cached images never enter documents. */
export function useComponentThumbnails(assets: ComponentAsset[], resources: ResourceSession) {
  const resourceKey = useMemo(() => ({ packs: resources.packs, profile: resources.profile,
    catalog: resources.catalog, resolver: resources.resolver }),
  [resources.packs, resources.profile, resources.catalog, resources.resolver]);
  const [manifest, setManifest] = useState<{ resourceKey: typeof resourceKey; value: ResourceManifest } | null>(null);
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  const context = useMemo(() => ({ resourceKey, assets, visible }), [resourceKey, assets, visible]);
  const current = useRef(context);
  useLayoutEffect(() => { current.current = context; }, [context]);
  const [batch, setBatch] = useState<{ context: typeof context; entries: ThumbnailEntry[] } | null>(null);
  useEffect(() => {
    let active = true;
    void resourceManifest(resourceKey.packs, resourceKey.profile).then((value) => {
      if (active) setManifest({ resourceKey, value });
    }).catch(() => {
      if (active) setManifest({ resourceKey, value: { adapter: "blockstage-editor-v2-copy", profile: null, packs: [] } });
    });
    return () => { active = false; };
  }, [resourceKey]);
  useEffect(() => {
    if (manifest?.resourceKey !== resourceKey) return;
    let active = true;
    void Promise.all(assets.filter((asset) => visible.has(asset.id)).map(async (asset): Promise<ThumbnailEntry> => {
      const requestId = crypto.randomUUID();
      try {
        const plan = inspectComponentPreview(asset, resourceKey.catalog, resourceKey.profile, resourceKey.resolver);
        if (!plan.blocks.length || plan.status === "unavailable" || !plan.complete)
          return { requestId, asset, plan: null, key: null, blob: null, status: "unavailable", note: plan.issues[0] ?? "No visible cells" };
        const key = await thumbnailKey(asset, manifest.value);
        if (!key) return { requestId, asset, plan: null, key: null, blob: null, status: "unavailable", note: "Import a matching profile and fingerprinted resources to generate thumbnails." };
        let blob: Blob | null = null;
        let note = plan.status === "partial" ? "Partial appearance · inspect Preview notes" : "Rendered component preview";
        try {
          blob = await thumbnailCache.get(key);
          if (blob && typeof createImageBitmap !== "undefined") {
            try { const image = await createImageBitmap(blob); image.close(); }
            catch { blob = null; }
          }
        }
        catch { note += " · thumbnail cache unavailable"; }
        return { requestId, asset, plan, key, blob, status: blob ? "ready" : "pending", source: blob ? "cache" : undefined, note };
      } catch (error) {
        return { requestId, asset, plan: null, key: null, blob: null, status: "unavailable",
          note: error instanceof Error ? error.message : "Thumbnail unavailable" };
      }
    })).then((entries) => { if (active) setBatch({ context, entries }); });
    return () => { active = false; };
  }, [context, assets, visible, resourceKey, manifest]);
  const entries = batch?.context === context ? batch.entries : [];
  const job = entries.find((entry) => entry.status === "pending");
  const onVisibility = useCallback((id: string, shown: boolean) => {
    setVisible((previous) => {
      if (previous.has(id) === shown) return previous;
      const next = new Set(previous);
      if (shown) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  async function complete(entry: ThumbnailEntry, blob: Blob | null, error?: string) {
    if (current.current !== context || !entry.key) return;
    let note = entry.note;
    if (blob) {
      try { await thumbnailCache.put(entry.key, blob); }
      catch { note += " · image shown but could not cache; retry after reload"; }
    }
    if (current.current !== context) return;
    setBatch((previous) => previous?.context === context ? { ...previous,
      entries: previous.entries.map((item) => item === entry ? { ...item, blob,
        status: blob ? "ready" : "unavailable", source: blob ? "render" : undefined, note: error ?? note } : item) } : previous);
  }
  return { entries, job, onVisibility, complete };
}
