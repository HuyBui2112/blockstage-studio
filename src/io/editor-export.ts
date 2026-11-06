import { bounds } from "../core/assembly";
import { DEMO_MATERIALS, type Material } from "../core/catalog";
import { resolveEntityCapability } from "../core/capabilities";
import type { Vec3 } from "../core/schema";
import {
  editorDocumentSchema,
  sceneBlocks,
  type EditorDocument,
  type EditorObject,
} from "../editor/model";
import { validateLogicalObject } from "../editor/placement";
import { assessSupport } from "../editor/support";
import {
  exportDatapackScene,
  exportStructureScene,
  structureStateError,
  type StructureScene,
} from "./structure";

export type EditorExportIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  objectId?: string;
  pos?: Vec3;
  supportPos?: Vec3;
};
export type EditorExportPreflight = {
  valid: boolean;
  issues: EditorExportIssue[];
  origin: Vec3;
  size: Vec3;
  blockCount: number;
  entityCount: number;
};

const demoIds = new Set(DEMO_MATERIALS.map((material) => material.id));
const airIds = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
]);
const maxReportedErrors = 100;

/** Read-only checks against committed document cells, never viewport meshes or previews. */
export function preflightEditorExport(
  document: EditorDocument,
  catalog: Material[],
): EditorExportPreflight {
  const issues: EditorExportIssue[] = [];
  const parsed = editorDocumentSchema.safeParse(document);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, maxReportedErrors))
      issues.push({
        severity: "error",
        code:
          issue.path[0] === "target"
            ? "target_profile"
            : /collision/i.test(issue.message)
              ? "duplicate_cell"
              : "invalid_document",
        message: `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
      });
    if (parsed.error.issues.length > maxReportedErrors)
      issues.push({
        severity: "error",
        code: "additional_errors",
        message: `${parsed.error.issues.length - maxReportedErrors} additional schema errors. Fix the reported errors and check again.`,
      });
    return {
      valid: false,
      issues,
      origin: [0, 0, 0],
      size: [0, 0, 0],
      blockCount: 0,
      entityCount: 0,
    };
  }
  const committed = parsed.data;
  const blocks = sceneBlocks(committed);
  const box = bounds([
    ...blocks,
    ...committed.entities.map((entity) => ({
      pos: entity.position.map(Math.floor) as Vec3,
    })),
  ]);
  const materials = new Map(catalog.map((material) => [material.id, material]));
  const reportedErrors = new Set<string>();
  let omittedErrors = 0;
  const addError = (code: string, message: string, objectId?: string) => {
    const signature = `${code}\0${objectId ?? ""}\0${message}`;
    if (reportedErrors.has(signature)) return;
    reportedErrors.add(signature);
    if (issues.length >= maxReportedErrors) {
      omittedErrors++;
      return;
    }
    issues.push({
      severity: "error",
      code,
      message,
      ...(objectId ? { objectId } : {}),
    });
  };
  if (!blocks.length && !committed.entities.length)
    addError(
      "empty_scene",
      "Add at least one block or supported entity before exporting.",
    );
  if (box.size.some((value) => value > 48))
    addError(
      "structure_bounds",
      `Structure size ${box.size.join(" × ")} exceeds the 48-block limit on each axis. Split the design before exporting.`,
    );

  const visit = (object: EditorObject) => {
    let statesValid = true;
    for (const cell of object.cells) {
      const material = materials.get(cell.state.name);
      const error = structureStateError(cell.state, materials, cell.blockEntity);
      if (error) {
        statesValid = false;
        const code =
          !demoIds.has(cell.state.name) && material?.source !== "game-profile"
            ? "profile_required"
            : material?.hasBlockEntity
              ? "block_entity"
              : "invalid_state";
        addError(code, error, object.id);
      }
    }
    if (statesValid) {
      const leafCatalog = [
        ...new Set(object.cells.map((cell) => cell.state.name)),
      ].map((id) => materials.get(id)!);
      try {
        validateLogicalObject({ ...object, children: [] }, leafCatalog);
      } catch (error) {
        addError(
          "logical_pair",
          error instanceof Error ? error.message : "Invalid logical object.",
          object.id,
        );
      }
    }
    for (const child of object.children) visit(child);
  };
  for (const object of committed.objects) visit(object);
  for (const entity of committed.entities) {
    const capability = resolveEntityCapability(entity.type, "structure-export", { target: committed.target });
    if (!capability.supported)
      addError(
        "unsupported_entity",
        capability.reason,
        entity.id,
      );
  }
  if (omittedErrors)
    issues.push({
      severity: "error",
      code: "additional_errors",
      message: `${omittedErrors} additional export errors. Fix the reported errors and check again.`,
    });

  for (const issue of assessSupport(blocks, catalog))
    issues.push({ severity: "warning", ...issue });

  issues.push(
    {
      severity: "warning",
      code: "design_placement",
      message:
        "Support diagnostics cover a finite set of vanilla rules. The editor does not simulate world support, neighbors, fluids, redstone or ticks. Minecraft can change states during placement or later updates.",
    },
    {
      severity: "warning",
      code: "sparse_cells_unchanged",
      message:
        "Only explicit cells are exported. Empty cells in the bounding box leave the destination unchanged.",
    },
  );
  if (blocks.some((block) => airIds.has(block.state.name)))
    issues.push({
      severity: "warning",
      code: "explicit_air",
      message:
        "Explicit air cells are included and clear their destination cells when placed.",
    });
  if (
    blocks.length &&
    !blocks.some(
      (block) => materials.get(block.state.name)?.source === "game-profile",
    )
  )
    issues.push({
      severity: "warning",
      code: "demo_registry",
      message:
        "No game profile is used by these blocks. Only the built-in finite demo states can export without an imported 26.2 profile.",
    });
  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
    origin: box.min,
    size: box.size,
    blockCount: blocks.length,
    entityCount: committed.entities.length,
  };
}

function exportScene(
  document: EditorDocument,
  catalog: Material[],
): StructureScene {
  const preflight = preflightEditorExport(document, catalog);
  if (!preflight.valid)
    throw new Error(
      preflight.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join("\n"),
    );
  return {
    name: document.name,
    target: document.target,
    blocks: sceneBlocks(document).map(({ owner: _owner, ...cell }) => cell),
    entities: document.entities,
  };
}

export function exportEditorStructure(
  document: EditorDocument,
  catalog: Material[],
) {
  return exportStructureScene(exportScene(document, catalog), catalog);
}
export function exportEditorDatapack(
  document: EditorDocument,
  catalog: Material[],
): Uint8Array {
  return exportDatapackScene(exportScene(document, catalog), catalog);
}
