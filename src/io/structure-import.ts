import type { NbtTag } from "./nbt-reader";
import type { Material } from "../core/catalog";
import { resolveBlockCapability } from "../core/capabilities";
import {
  blockSchema,
  blockEntitySchema,
  stateSchema,
  type Block,
  type BlockState,
  type Vec3,
} from "../core/schema";
import {
  editorDocumentSchema,
  newEditorDocument,
  validateDocument,
  type EditorDocument,
} from "../editor/model";
import { logicalCellGroups } from "../editor/placement";

export type StructureImport = {
  document: EditorDocument;
  size: Vec3;
  blockCount: number;
  multiBlocks: number;
  airCount: number;
  notes: string[];
};
function compound(tag: NbtTag | undefined): Record<string, NbtTag> {
  if (tag?.type !== 10) throw new Error("Expected NBT compound");
  return tag.value as Record<string, NbtTag>;
}
function list(tag: NbtTag | undefined, element: number): NbtTag[] {
  if (tag?.type !== 9) throw new Error("Expected NBT list");
  const value = tag.value as NbtTag[];
  if (tag.element !== element && !(value.length === 0 && tag.element === 0))
    throw new Error("Wrong NBT list element type");
  return value;
}
function int(tag: NbtTag | undefined): number {
  if (tag?.type !== 3) throw new Error("Expected TAG_Int");
  return tag.value as number;
}
function string(tag: NbtTag | undefined): string {
  if (tag?.type !== 8) throw new Error("Expected TAG_String");
  return tag.value as string;
}
function fields(value: Record<string, NbtTag>, allowed: string[]) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new Error(
        `Unsupported Structure NBT field: ${key}. Nothing was imported.`,
      );
}
export function inspectStructure(
  root: NbtTag,
  name: string,
  workspace: EditorDocument["workspace"],
  catalog: Material[],
): StructureImport {
  const data = compound(root);
  fields(data, [
    "DataVersion",
    "size",
    "palette",
    "blocks",
    "entities",
    "author",
    "palettes",
  ]);
  if (data.palettes)
    throw new Error(
      "Multiple palettes are not supported. Export a single-palette Structure NBT.",
    );
  if (int(data.DataVersion) !== 4903)
    throw new Error(
      "Import requires Java 26.2 / DataVersion 4903. No automatic version conversion.",
    );
  const size = list(data.size, 3).map(int);
  if (size.length !== 3 || size.some((value) => value < 1 || value > 2048))
    throw new Error(
      "Structure size must contain three positive dimensions, at most 2048 each",
    );
  if (data.entities && list(data.entities, 10).length)
    throw new Error(
      "This import supports blocks only. Entity payloads are not supported and will not be discarded.",
    );
  const rawPalette = list(data.palette, 10);
  if (!rawPalette.length || rawPalette.length > 65536)
    throw new Error("Structure palette is empty or exceeds 65,536 states");
  const materials = new Map(catalog.map((material) => [material.id, material]));
  const palette: BlockState[] = rawPalette.map((tag) => {
    const entry = compound(tag);
    fields(entry, ["Name", "Properties"]);
    const properties = entry.Properties
      ? Object.fromEntries(
          Object.entries(compound(entry.Properties)).map(([key, value]) => [
            key,
            string(value),
          ]),
        )
      : {};
    const state = stateSchema.parse({ name: string(entry.Name), properties }),
      material = materials.get(state.name);
    if (!material)
      throw new Error(
        `Registry missing for ${state.name}. Import the matching game profile before importing this structure.`,
      );
    const capability = resolveBlockCapability(state, "structure-import", material);
    if (!capability.supported) throw new Error(capability.reason);
    return state;
  });
  const entries = list(data.blocks, 10);
  if (entries.length === 0 || entries.length > 100000)
    throw new Error("Structure must contain 1–100,000 explicit block entries");
  const occupied = new Set<string>();
  const blocks: Block[] = entries.map((tag) => {
    const entry = compound(tag);
    fields(entry, ["pos", "state", "nbt"]);
    const pos = list(entry.pos, 3).map(int),
      index = int(entry.state);
    if (
      pos.length !== 3 ||
      pos.some((value, axis) => value < 0 || value >= size[axis])
    )
      throw new Error("Block position is outside declared structure size");
    if (index < 0 || index >= palette.length)
      throw new Error("Palette index is out of range");
    const state = palette[index];
    const chest = state.name === "minecraft:chest" && state.properties.type === "single";
    let blockEntity: Block["blockEntity"] = chest ? { kind: "chest", items: [] } : undefined;
    if (entry.nbt) {
      if (!chest) throw new Error("Unsupported block-entity payload; nothing was imported");
      const payload = compound(entry.nbt);
      fields(payload, ["id", "Items", "x", "y", "z"]);
      if (string(payload.id) !== "minecraft:chest") throw new Error("Chest payload ID mismatch");
      const itemTags = payload.Items ? list(payload.Items, 10) : [];
      if (itemTags.length > 27) throw new Error("Chest inventory exceeds 27 entries");
      blockEntity = blockEntitySchema.parse({ kind: "chest", items: itemTags.map((tag) => {
        const item = compound(tag);
        fields(item, ["Slot", "id", "count"]);
        if (item.Slot?.type !== 1) throw new Error("Chest Slot requires TAG_Byte");
        return { slot: item.Slot.value, id: string(item.id), count: int(item.count) };
      }) });
      for (const [axis, field] of ["x", "y", "z"].entries())
        if (payload[field] && int(payload[field]) !== pos[axis])
          throw new Error("Chest payload coordinates do not match its structure cell");
    }
    const key = pos.join(",");
    if (occupied.has(key)) throw new Error(`Duplicate block position: ${key}`);
    occupied.add(key);
    return blockSchema.parse({ pos, state, ...(blockEntity ? { blockEntity } : {}) });
  });
  const groups = logicalCellGroups(blocks),
    document = newEditorDocument(workspace);
  document.name =
    name
      .replace(/\.nbt$/i, "")
      .trim()
      .slice(0, 120) || "Imported structure";
  document.objects = groups.map((cells, index) => ({
    id: `nbt-object-${index}`,
    name: cells[0].state.name.split(":")[1],
    kind: cells.length > 1 ? "multiblock" : "block",
    cells,
    children: [],
    pivot2: cells[0].pos.map((value) => value * 2 + 1) as Vec3,
    orientation: 0,
  }));
  validateDocument(document, catalog);
  const notes = [
    "Imports explicit cells at their stored coordinates. Sparse gaps remain absent; explicit air is retained.",
    "Structure bounds are reported here; empty border space is not stored in editor bounds. Export still uses the existing 48-cell policy.",
  ];
  if (data.author)
    notes.push(
      `Informational author metadata is not retained in the editor: ${string(data.author).slice(0, 200)}`,
    );
  return {
    document: editorDocumentSchema.parse(document),
    size: size as Vec3,
    blockCount: blocks.length,
    multiBlocks: groups.filter((group) => group.length > 1).length,
    airCount: blocks.filter((block) =>
      ["minecraft:air", "minecraft:cave_air", "minecraft:void_air"].includes(
        block.state.name,
      ),
    ).length,
    notes,
  };
}
