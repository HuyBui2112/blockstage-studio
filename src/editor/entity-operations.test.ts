import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS } from "../core/catalog";
import type { SceneEntity, Vec3 } from "../core/schema";
import {
  createHistory,
  executeHistory,
  redoHistory,
  undoHistory,
} from "./history";
import type { EditorDocument } from "./model";
import {
  addEntity,
  duplicateEntities,
  entityEditCapability,
  moveEntities,
  removeEntities,
  setEntityYaw,
} from "./entity-operations";

const catalog = DEMO_MATERIALS;
const pig = (id = "pig"): SceneEntity => ({
  id,
  type: "minecraft:pig",
  position: [0.25, 0.5, -0.75],
  yaw: 12.5,
});
function fixture(): EditorDocument {
  return {
    schemaVersion: 2,
    id: "doc",
    name: "Entities",
    workspace: "architecture",
    target: { gameVersion: "26.2", dataVersion: 4903 },
    objects: [
      {
        id: "group",
        name: "Group",
        kind: "group",
        cells: [],
        pivot2: [1, 1, 1],
        orientation: 0,
        children: [
          {
            id: "nested",
            name: "Stone",
            kind: "block",
            cells: [
              {
                pos: [0, 0, 0],
                state: { name: "minecraft:stone", properties: {} },
              },
            ],
            children: [],
            pivot2: [1, 1, 1],
            orientation: 0,
          },
        ],
      },
    ],
    entities: [pig(), pig("other")],
  };
}

describe("bounded entity operations", () => {
  it("declares finite editing coverage independently of registry support", () => {
    expect(entityEditCapability("minecraft:pig").supported).toBe(true);
    expect(entityEditCapability("minecraft:cow")).toMatchObject({
      supported: false,
    });
    const document = fixture();
    expect(() =>
      addEntity(document, { ...pig("cow"), type: "minecraft:cow" }, catalog),
    ).toThrow(/not supported/);
    document.entities[0].type = "minecraft:cow";
    for (const operation of [
      () => moveEntities(document, ["pig"], [0, 0, 0], catalog),
      () => setEntityYaw(document, ["pig"], 0, catalog),
      () => duplicateEntities(document, ["pig"], ["copy"], [0, 0, 0], catalog),
      () => removeEntities(document, ["pig"], catalog),
    ])
      expect(operation).toThrow(/not supported/);
    expect(
      moveEntities(document, ["other"], [1, 0, 0], catalog).entities[0],
    ).toBe(document.entities[0]);
  });

  it("preserves fractional positions, unrelated references and block data without collision or snapping", () => {
    const document = fixture(),
      before = structuredClone(document);
    const moved = moveEntities(document, ["pig"], [-0.25, -0.5, 0.75], catalog);
    expect(moved.entities[0].position).toEqual([0, 0, 0]);
    expect(moved.entities[0].yaw).toBe(12.5);
    expect(moved.objects).toBe(document.objects);
    expect(moved.entities[1]).toBe(document.entities[1]);
    expect(document).toEqual(before);
    const input = pig("added"),
      added = addEntity(document, input, catalog);
    input.position[0] = 99;
    expect(added.entities[2].position[0]).toBe(0.25);
    expect(added.entities[0]).toBe(document.entities[0]);
  });

  it("normalizes real yaw modulo 360 and preserves no-op identity", () => {
    const document = fixture();
    expect(
      setEntityYaw(document, ["pig"], -720.25, catalog).entities[0].yaw,
    ).toBe(359.75);
    expect(setEntityYaw(document, ["pig"], 732.5, catalog)).toBe(document);
    expect(moveEntities(document, ["pig"], [0, -0, 0], catalog)).toBe(document);
    expect(
      addEntity(document, { ...pig("new"), yaw: 1080 }, catalog).entities[2]
        .yaw,
    ).toBe(0);
    for (const value of [NaN, Infinity, -Infinity])
      expect(() => setEntityYaw(document, ["pig"], value, catalog)).toThrow(
        /finite/,
      );
  });

  it("duplicates in selection order with explicit independent IDs and exact yaw", () => {
    const document = fixture();
    document.entities[0].yaw = -300;
    const result = duplicateEntities(
      document,
      ["other", "pig"],
      ["copy-other", "copy-pig"],
      [0.125, 0, 0],
      catalog,
    );
    expect(result.entities.map((entity) => entity.id)).toEqual([
      "pig",
      "other",
      "copy-other",
      "copy-pig",
    ]);
    expect(result.entities[3]).toEqual({
      ...document.entities[0],
      id: "copy-pig",
      position: [0.375, 0.5, -0.75],
    });
    expect(result.entities[3].position).not.toBe(document.entities[0].position);
    expect(result.entities[0]).toBe(document.entities[0]);
    expect(removeEntities(result, ["copy-pig", "copy-other"], catalog)).toEqual(
      document,
    );
  });

  it("rejects empty, missing and duplicate selections atomically", () => {
    const document = fixture(),
      before = structuredClone(document);
    for (const ids of [[], ["missing"], ["pig", "pig"], ["pig", "missing"]]) {
      expect(() => moveEntities(document, ids, [1, 0, 0], catalog)).toThrow();
      expect(() => setEntityYaw(document, ids, 1, catalog)).toThrow();
      expect(() => removeEntities(document, ids, catalog)).toThrow();
      expect(() =>
        duplicateEntities(
          document,
          ids,
          ids.map((_, i) => `copy-${i}`),
          [0, 0, 0],
          catalog,
        ),
      ).toThrow();
    }
    expect(document).toEqual(before);
  });

  it("rejects entity and nested object ID collisions without invalidating legacy cross-kind identity", () => {
    const document = fixture();
    for (const id of ["pig", "group", "nested", " "]) {
      expect(() => addEntity(document, pig(id), catalog)).toThrow();
      expect(() =>
        duplicateEntities(document, ["pig"], [id], [0, 0, 0], catalog),
      ).toThrow();
    }
    expect(() =>
      duplicateEntities(
        document,
        ["pig", "other"],
        ["same", "same"],
        [0, 0, 0],
        catalog,
      ),
    ).toThrow();
    expect(() =>
      duplicateEntities(document, ["pig"], [], [0, 0, 0], catalog),
    ).toThrow();
    document.entities[0].id = "nested";
    const removed = removeEntities(document, ["nested"], catalog);
    expect(removed.objects).toBe(document.objects);
    expect(removed.entities.map((entity) => entity.id)).toEqual(["other"]);
  });

  it("validates finite coordinates, world bounds, full bases and the final entity budget", () => {
    const document = fixture(),
      before = structuredClone(document);
    for (const delta of [
      [NaN, 0, 0],
      [0, Infinity, 0],
      [30000000, 0, 0],
      [0, 2048, 0],
      [0, 0, -30000000],
    ] as Vec3[]) {
      expect(() =>
        moveEntities(document, ["pig", "other"], delta, catalog),
      ).toThrow();
      expect(() =>
        duplicateEntities(document, ["pig"], ["copy"], delta, catalog),
      ).toThrow();
    }
    expect(document).toEqual(before);
    expect(
      addEntity(
        document,
        { ...pig("edge"), position: [-30000000, -2048, 30000000] },
        catalog,
      ).entities[2].position,
    ).toEqual([-30000000, -2048, 30000000]);
    const invalid = fixture();
    invalid.objects[0].children[0].cells[0].state.name = "minecraft:unknown";
    expect(() => removeEntities(invalid, ["pig"], catalog)).toThrow();
    const full = fixture();
    full.entities = Array.from({ length: 1000 }, (_, i) => pig(`pig-${i}`));
    expect(() => addEntity(full, pig("overflow"), catalog)).toThrow();
    expect(() =>
      duplicateEntities(full, ["pig-0"], ["overflow"], [0, 0, 0], catalog),
    ).toThrow();
    expect(full.entities).toHaveLength(1000);
  });

  it("commits every batch as one actual history command and restores exact documents", () => {
    const original = fixture();
    for (const operation of [
      (document: EditorDocument) => addEntity(document, pig("new"), catalog),
      (document: EditorDocument) =>
        moveEntities(document, ["pig", "other"], [0.125, 1.25, -2.5], catalog),
      (document: EditorDocument) =>
        setEntityYaw(document, ["pig", "other"], -45.25, catalog),
      (document: EditorDocument) =>
        duplicateEntities(
          document,
          ["pig", "other"],
          ["copy-a", "copy-b"],
          [0, 0, 0],
          catalog,
        ),
      (document: EditorDocument) =>
        removeEntities(document, ["pig", "other"], catalog),
    ]) {
      const initial = createHistory(original),
        next = operation(initial.document);
      const history = executeHistory(initial, next, "Entity operation");
      expect(history.past).toHaveLength(1);
      expect(history.past[0].patches).toEqual([]);
      const undone = undoHistory(history);
      expect(undone.document).toEqual(original);
      expect(redoHistory(undone).document).toEqual(next);
    }
  });
});
