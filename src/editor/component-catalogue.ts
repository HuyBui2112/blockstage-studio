import { componentCategories, type ComponentAsset, type ComponentCategory, type EditorObject } from "./model";

export const COMPONENT_CATEGORIES = componentCategories;
export function componentCategoryLabel(category: ComponentCategory): string {
  return category[0].toUpperCase() + category.slice(1);
}

export type ComponentCatalogueEntry = {
  readonly asset: ComponentAsset;
  /** Stored occupied cells, including explicit air; never a survival item count. */
  readonly cells: number;
  readonly blockIds: readonly string[];
  readonly search: string;
  readonly category: ComponentCategory;
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
      category: asset.category ?? "custom",
      search: normalize([asset.name, asset.category ?? "custom", ...ids].join(" ")),
    };
  });
}

/** All query tokens must match the name, category or a stored block ID. */
export function queryComponentCatalogue(
  entries: readonly ComponentCatalogueEntry[],
  query: string,
  sort: ComponentCatalogueSort,
  category: ComponentCategory | "all" = "all",
): ComponentCatalogueEntry[] {
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => (category === "all" || entry.category === category) &&
      tokens.every((token) => entry.search.includes(token)))
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
