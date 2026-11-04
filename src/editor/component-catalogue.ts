import type { ComponentAsset, EditorObject } from "./model";

export type ComponentCatalogueEntry = {
  readonly asset: ComponentAsset;
  /** Stored occupied cells, including explicit air; never a survival item count. */
  readonly cells: number;
  readonly blockIds: readonly string[];
  readonly search: string;
};
export type ComponentCatalogueSort = "name" | "cells-asc" | "cells-desc";

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Index already validated assets once; retain their identities without cloning cells. */
export function indexComponentCatalogue(
  assets: readonly ComponentAsset[],
): ComponentCatalogueEntry[] {
  return assets.map((asset) => {
    let cells = 0;
    const blockIds = new Set<string>();
    // Iterator frames keep traversal memory proportional to tree depth, not cell count.
    const frames: Iterator<EditorObject>[] = [asset.objects.values()];
    while (frames.length) {
      const next = frames[frames.length - 1].next();
      if (next.done) {
        frames.pop();
        continue;
      }
      const object = next.value;
      cells += object.cells.length;
      for (const cell of object.cells) blockIds.add(cell.state.name);
      if (object.children.length) frames.push(object.children.values());
    }
    const ids = [...blockIds].sort(compare);
    return {
      asset,
      cells,
      blockIds: ids,
      search: normalize([asset.name, ...ids].join(" ")),
    };
  });
}

/** All whitespace-separated query tokens must match the name or a stored block ID. */
export function queryComponentCatalogue(
  entries: readonly ComponentCatalogueEntry[],
  query: string,
  sort: ComponentCatalogueSort,
): ComponentCatalogueEntry[] {
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => tokens.every((token) => entry.search.includes(token)))
    .sort((a, b) => {
      const sizeOrder =
        sort === "cells-asc"
          ? a.cells - b.cells
          : sort === "cells-desc"
            ? b.cells - a.cells
            : 0;
      return (
        sizeOrder ||
        compare(normalize(a.asset.name), normalize(b.asset.name)) ||
        compare(a.asset.name, b.asset.name) ||
        compare(a.asset.id, b.asset.id)
      );
    });
}
