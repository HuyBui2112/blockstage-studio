import {
  editorDocumentSchema,
  type EditorDocument,
  type EditorObject,
} from "./model";

export type PlacedBlockCountScope =
  | { kind: "document" }
  | { kind: "selection"; objectIds: readonly string[] };
export type PlacedBlockCounts = {
  scope: "document" | "selection";
  documentId: string;
  documentName: string;
  rootCount: number;
  occupiedCells: number;
  nonAirCells: number;
  airCells: number;
  byId: { id: string; cells: number; air: boolean }[];
  byState: {
    id: string;
    properties: Record<string, string>;
    state: string;
    cells: number;
    air: boolean;
  }[];
};
const airIds = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
]);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Counts stored cells, including explicit air, rather than acquisition items.
 * Validate bounded structure without requiring a registry: unknown string states
 * remain visible in the report, even when the matching game profile is absent.
 * Entities and sparse omitted cells do not contribute to these counts.
 */
export function countPlacedBlocks(
  document: EditorDocument,
  scope: PlacedBlockCountScope = { kind: "document" },
): PlacedBlockCounts {
  const parsed = editorDocumentSchema.parse(document);
  let roots = parsed.objects;
  if (scope.kind === "selection") {
    const ids = new Set(scope.objectIds);
    const rootIds = new Set(roots.map((object) => object.id));
    for (const id of ids)
      if (!rootIds.has(id))
        throw new Error(
          `Counts selection requires a current top-level object: ${id}`,
        );
    roots = roots.filter((object) => ids.has(object.id));
  }
  const report: PlacedBlockCounts = {
    scope: scope.kind,
    documentId: parsed.id,
    documentName: parsed.name,
    rootCount: roots.length,
    occupiedCells: 0,
    nonAirCells: 0,
    airCells: 0,
    byId: [],
    byState: [],
  };
  const byId = new Map<string, PlacedBlockCounts["byId"][number]>();
  const byState = new Map<string, PlacedBlockCounts["byState"][number]>();
  const visit = (object: EditorObject) => {
    for (const cell of object.cells) {
      const id = cell.state.name,
        air = airIds.has(id);
      const properties = Object.fromEntries(
        Object.entries(cell.state.properties).sort(([a], [b]) => compare(a, b)),
      );
      const state = `${id}[${Object.entries(properties)
        .map(([key, value]) => `${key}=${value}`)
        .join(",")}]`;
      const idRow = byId.get(id) ?? { id, cells: 0, air };
      const stateRow = byState.get(state) ?? {
        id,
        properties,
        state,
        cells: 0,
        air,
      };
      idRow.cells++;
      stateRow.cells++;
      report.occupiedCells++;
      if (air) report.airCells++;
      else report.nonAirCells++;
      byId.set(id, idRow);
      byState.set(state, stateRow);
    }
    object.children.forEach(visit);
  };
  roots.forEach(visit);
  report.byId = [...byId.values()].sort((a, b) => compare(a.id, b.id));
  report.byState = [...byState.values()].sort((a, b) =>
    compare(a.state, b.state),
  );
  return report;
}

function csvField(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Each row is an exact string-state cell count; metadata keeps scope explicit. */
export function placedBlockCountsCsv(report: PlacedBlockCounts): string {
  const rows: (string | number | boolean)[][] = [
    [
      "document_id",
      "document_name",
      "scope",
      "block_id",
      "state",
      "cells",
      "explicit_air",
    ],
  ];
  for (const row of report.byState)
    rows.push([
      report.documentId,
      report.documentName,
      report.scope,
      row.id,
      row.state,
      row.cells,
      row.air,
    ]);
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

export function placedBlockCountsJson(report: PlacedBlockCounts): string {
  return (
    JSON.stringify(
      { format: "blockstage-placed-block-counts", version: 1, ...report },
      null,
      2,
    ) + "\n"
  );
}
