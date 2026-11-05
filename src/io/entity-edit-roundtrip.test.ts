import { gunzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS } from "../core/catalog";
import {
  addEntity,
  duplicateEntities,
  moveEntities,
  setEntityYaw,
} from "../editor/entity-operations";
import {
  createHistory,
  executeHistory,
  redoHistory,
  undoHistory,
} from "../editor/history";
import { editorDocumentSchema, newEditorDocument } from "../editor/model";
import { createPlacedObject } from "../editor/placement";
import { exportEditorStructure } from "./editor-export";
import { readNbt, type NbtTag } from "./nbt-reader";
import {
  decodePortableBackup,
  encodePortableBackup,
  planPortableRestore,
} from "./portable-backup";

function compound(tag: NbtTag): Record<string, NbtTag> {
  expect(tag.type).toBe(10);
  return tag.value as Record<string, NbtTag>;
}
function list(tag: NbtTag): NbtTag[] {
  expect(tag.type).toBe(9);
  return tag.value as NbtTag[];
}

describe("basic entity edit persistence/export boundary", () => {
  it("keeps fractional edits through atomic history, JSON, fresh-ID backup and typed NBT", () => {
    const base = {
      ...newEditorDocument(),
      objects: [
        createPlacedObject(
          { name: "minecraft:stone", properties: {} },
          [-2, 0, 1],
          DEMO_MATERIALS,
        ),
      ],
    };
    const original = structuredClone(base);
    let edited = addEntity(
      base,
      {
        id: "pig-source",
        type: "minecraft:pig",
        position: [-1.25, 1.5, 2.75],
        yaw: 0,
      },
      DEMO_MATERIALS,
    );
    edited = moveEntities(
      edited,
      ["pig-source"],
      [0.25, 0.5, -0.25],
      DEMO_MATERIALS,
    );
    edited = setEntityYaw(edited, ["pig-source"], 450, DEMO_MATERIALS);
    edited = duplicateEntities(
      edited,
      ["pig-source"],
      ["pig-copy"],
      [2, 0.25, 1],
      DEMO_MATERIALS,
    );
    const history = executeHistory(
      createHistory(base),
      edited,
      "Place edited pigs",
    );
    expect(history.past).toHaveLength(1);
    const undone = undoHistory(history);
    expect(undone.document).toEqual(base);
    expect(redoHistory(undone).document).toEqual(edited);
    expect(base).toEqual(original);

    const json = editorDocumentSchema.parse(JSON.parse(JSON.stringify(edited)));
    expect(json).toEqual(edited);
    const bundle = decodePortableBackup(
      encodePortableBackup({
        format: "blockstage-portable",
        version: 1,
        document: json,
        components: [],
        resources: {
          adapter: "blockstage-editor-v2-copy",
          profile: null,
          packs: [],
        },
      }),
    );
    let id = 0;
    const restored = planPortableRestore(
      bundle,
      () => `restored-${++id}`,
    ).document;
    expect(restored.id).not.toBe(base.id);
    expect(restored.entities.map((entity) => entity.id)).not.toEqual(
      edited.entities.map((entity) => entity.id),
    );
    expect(restored.entities.map(({ id: _id, ...entity }) => entity)).toEqual([
      { type: "minecraft:pig", position: [-1, 2, 2.5], yaw: 90 },
      { type: "minecraft:pig", position: [1, 2.25, 3.5], yaw: 90 },
    ]);

    const beforeExport = structuredClone(restored);
    const exported = exportEditorStructure(restored, DEMO_MATERIALS);
    expect(exported.origin).toEqual([-2, 0, 1]);
    const root = compound(readNbt(gunzipSync(exported.bytes)));
    expect(root.DataVersion!.value).toBe(4903);
    expect(list(root.blocks!)).toHaveLength(1);
    const entities = list(root.entities!).map(compound);
    expect(
      entities.map((entity) => list(entity.pos!).map((tag) => tag.value)),
    ).toEqual([
      [1, 2, 1.5],
      [3, 2.25, 2.5],
    ]);
    expect(
      entities.map((entity) => list(entity.blockPos!).map((tag) => tag.value)),
    ).toEqual([
      [1, 2, 1],
      [3, 2, 2],
    ]);
    for (const entity of entities) {
      expect(list(entity.pos!).every((tag) => tag.type === 6)).toBe(true);
      const nbt = compound(entity.nbt!);
      expect(nbt.id!.value).toBe("minecraft:pig");
      expect(list(nbt.Rotation!).map((tag) => tag.value)).toEqual([90, 0]);
      expect(list(nbt.Rotation!).every((tag) => tag.type === 5)).toBe(true);
    }
    expect(restored).toEqual(beforeExport);
  });
});
