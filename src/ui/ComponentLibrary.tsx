import { useEffect, useMemo, useRef, useState } from "react";
import {
  indexComponentCatalogue,
  COMPONENT_CATEGORIES,
  componentCategoryLabel,
  queryComponentCatalogue,
  type ComponentCatalogueSort,
} from "../editor/component-catalogue";
import type { ComponentAsset, ComponentCategory } from "../editor/model";
import { download } from "../io/storage";
import { Icon } from "./Icon";
import "./ComponentLibrary.css";
import type { ResourceSession } from "../resources/useResources";
import { ComponentPreviewDialog } from "./ComponentPreviewDialog";
import { ComponentThumbnail, ComponentThumbnailRenderer } from "./ComponentThumbnail";
import { useComponentThumbnails } from "./useComponentThumbnails";

type Props = {
  assets: ComponentAsset[];
  selected: string | null;
  onSelect: (asset: ComponentAsset) => void;
  onEdit: (asset: ComponentAsset) => void;
  onDelete: (id: string) => void;
  onImport: (file: File) => void;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDuplicate: (id: string) => Promise<boolean>;
  onCategory: (id: string, category: ComponentCategory) => Promise<boolean>;
  resources: ResourceSession;
  onResources: () => void;
};
const PAGE_SIZE = 24;

export function ComponentLibrary({
  assets,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onImport,
  onRename,
  onDuplicate,
  onCategory,
  resources,
  onResources,
}: Props) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = assets.find((asset) => asset.id === previewId);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!preview && previewTrigger.current) {
      if (previewTrigger.current.isConnected) previewTrigger.current.focus();
      previewTrigger.current = null;
    }
  }, [preview]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ComponentCatalogueSort>("name");
  const [category, setCategory] = useState<ComponentCategory | "all">("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const entries = useMemo(() => indexComponentCatalogue(assets), [assets]);
  const registryIds = useMemo(() => new Set(resources.catalog.map((material) => material.id)), [resources.catalog]);
  const results = useMemo(
    () => queryComponentCatalogue(entries, query, sort, category),
    [entries, query, sort, category],
  );
  const shown = useMemo(() => results.slice(0, limit), [results, limit]);
  const shownAssets = useMemo(() => shown.map((entry) => entry.asset), [shown]);
  const thumbnails = useComponentThumbnails(shownAssets, resources);
  const changeQuery = (value: string) => {
    setQuery(value);
    setLimit(PAGE_SIZE);
  };
  const renameValid = name.trim().length > 0 && name.trim().length <= 120;
  const run = async (operation: () => Promise<boolean>, renamed = false) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      if (await operation()) {
        if (renamed) setRenaming(null);
      } else {
        setError("Component was not saved. Please retry.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Component was not saved. Please retry.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div className="panel-heading">
        <span>Components</span>
        <span>{assets.length}</span>
      </div>
      <div className="browser-tools component-catalogue-tools">
        <label className="resource-search">
          <Icon name="search" size={16} />
          <input
            aria-label="Search components"
            placeholder="Search names, categories or block IDs…"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
          />
          {query && (
            <button
              className="icon-button"
              aria-label="Clear component search"
              onClick={() => changeQuery("")}
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </label>
        <label className="component-sort">
          <span>Category</span>
          <select
            aria-label="Filter component category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as ComponentCategory | "all");
              setLimit(PAGE_SIZE);
            }}
          >
            <option value="all">All categories</option>
            {COMPONENT_CATEGORIES.map((value) => (
              <option key={value} value={value}>{componentCategoryLabel(value)}</option>
            ))}
          </select>
        </label>
        <label className="component-sort">
          <span>Sort</span>
          <select
            aria-label="Sort components"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as ComponentCatalogueSort);
              setLimit(PAGE_SIZE);
            }}
          >
            <option value="name">Name</option>
            <option value="cells-asc">Cells: fewest first</option>
            <option value="cells-desc">Cells: most first</option>
          </select>
        </label>
      </div>
      <div
        className="component-catalogue-count"
        role="status"
        aria-label="Component results"
      >
        Showing {shown.length} of {results.length}
        {results.length !== assets.length && (
          <span> · {assets.length} total</span>
        )}
      </div>
      <div className="component-assets">
        {error && <div className="component-library-error" role="alert">{error}</div>}
        {shown.map(({ asset, cells, blockIds }) => (
          <article
            className={`component-asset${selected === asset.id ? " chosen" : ""}`}
            data-component-id={asset.id}
            key={asset.id}
          >
            <button
              className="component-asset-main"
              aria-pressed={selected === asset.id}
              onClick={() => onSelect(asset)}
            >
              <ComponentThumbnail asset={asset} entry={thumbnails.entries.find((entry) => entry.asset === asset)} onVisibility={thumbnails.onVisibility} />
              <span>
                <strong>{asset.name}</strong>
                <small>{asset.size.join(" × ")} blocks</small>
                <small title="Stored block cells, including explicit air; not a survival item count">
                  {cells.toLocaleString()} {cells === 1 ? "cell" : "cells"}
                </small>
                {blockIds.some((id) => !registryIds.has(id)) && <small>Missing registry entries · check Preview</small>}
              </span>
            </button>
            <label className="component-category">
              <span>Category</span>
              <select
                aria-label={`Category for component ${asset.name}`}
                value={asset.category ?? "custom"}
                disabled={pending}
                onChange={(event) => {
                  const value = event.target.value as ComponentCategory;
                  void run(() => onCategory(asset.id, value));
                }}
              >
                {COMPONENT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>{componentCategoryLabel(value)}</option>
                ))}
              </select>
            </label>
            {renaming === asset.id && (
              <form
                className="component-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (renameValid) void run(() => onRename(asset.id, name.trim()), true);
                }}
              >
                <input
                  autoFocus
                  aria-label={`New name for component ${asset.name}`}
                  aria-invalid={!renameValid}
                  value={name}
                  disabled={pending}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      if (!pending) setRenaming(null);
                    }
                  }}
                />
                <button type="submit" disabled={pending || !renameValid}>Save</button>
                <button type="button" disabled={pending} onClick={() => setRenaming(null)}>Cancel</button>
                {!renameValid && <small>Name must contain 1–120 characters.</small>}
              </form>
            )}
            <div className="component-asset-actions">
              <button onClick={() => onEdit(asset)}>Edit</button>
              <button type="button" aria-label={`Preview component ${asset.name}`}
                disabled={pending} onClick={(event) => {
                  previewTrigger.current = event.currentTarget;
                  setPreviewId(asset.id);
                }}>Preview</button>
              <button
                aria-label={`Rename component ${asset.name}`}
                title="Rename component"
                disabled={pending}
                onClick={() => {
                  setRenaming(asset.id);
                  setName(asset.name);
                  setError("");
                }}
              >
                <Icon name="rename" size={13} />
              </button>
              <button
                aria-label={`Duplicate component ${asset.name}`}
                title="Duplicate component"
                disabled={pending}
                onClick={() => { void run(() => onDuplicate(asset.id)); }}
              >
                <Icon name="blocks" size={13} />
              </button>
              <button
                aria-label={`Export component ${asset.name}`}
                onClick={() =>
                  download(
                    `${asset.name}.component.json`,
                    JSON.stringify(asset, null, 2),
                    "application/json",
                  )
                }
              >
                <Icon name="file" size={13} />
              </button>
              <button
                aria-label={`Remove component ${asset.name}`}
                onClick={() => onDelete(asset.id)}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          </article>
        ))}
        {!assets.length && (
          <div className="empty-state">
            <Icon name="blocks" size={30} />
            <strong>Your building kit</strong>
            <p>
              Group a selection and save it as a component, or design one in
              Component Editor.
            </p>
          </div>
        )}
        {!!assets.length && !results.length && (
          <div className="empty-state">
            <Icon name="search" size={30} />
            <strong>No matching components</strong>
            <button className="button" onClick={() => { changeQuery(""); setCategory("all"); }}>
              Clear component filters
            </button>
          </div>
        )}
        {shown.length < results.length && (
          <button
            aria-label="Show more components"
            className="load-more component-show-more"
            onClick={() => setLimit((value) => value + PAGE_SIZE)}
          >
            Show more components ({PAGE_SIZE})
          </button>
        )}
      </div>
      <label className="button library-import">
        <Icon name="upload" size={14} />
        Import component
        <input
          className="visually-hidden"
          type="file"
          accept=".json"
          aria-label="Import component JSON"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.target.value = "";
          }}
        />
      </label>
      {preview && <ComponentPreviewDialog key={preview.id} asset={preview} resources={resources}
        onClose={() => setPreviewId(null)} onResources={() => { setPreviewId(null); onResources(); }} />}
      {!preview && thumbnails.job && <ComponentThumbnailRenderer key={thumbnails.job.requestId}
        entry={thumbnails.job} resources={resources}
        onCapture={(blob, error) => void thumbnails.complete(thumbnails.job!, blob, error)} />}
    </>
  );
}
