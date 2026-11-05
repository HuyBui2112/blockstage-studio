import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS } from "../core/catalog";
import type { SceneEntity } from "../core/schema";
import {
  applyEntityAction,
  editableEntityIds,
  planEntityAction,
  type EntityActionIntent,
} from "./entity-action";
import {
  createHistory,
  executeHistory,
  redoHistory,
  undoHistory,
} from "./history";
import type { EditorDocument } from "./model";
import type { OperationBase } from "./operation-plan";
import { emptyEditorViewState, type EditorViewState } from "./view-state";

const catalog = DEMO_MATERIALS;
const pig = (id = "pig", y = 0.5): SceneEntity => ({
  id,
  type: "minecraft:pig",
  position: [0.25, y, -0.75],
  yaw: 12.5,
});
function fixture(): EditorDocument {
  return {
    schemaVersion: 2,
    id: "doc",
    name: "Entities",
    workspace: "architecture",
    target: { gameVersion: "26.2", dataVersion: 4903 },
    entities: [pig()],
    objects: [
      {
        id: "block",
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
  };
}
const initialBase = (): OperationBase => ({
  documentId: "doc",
  sessionEpoch: "epoch",
  revision: 3,
});

describe("entity action plans", () => {
  it("uses one entity eligibility policy for selection, pruning and disabled rows", () => {
    const document = fixture();
    document.entities = [
      pig("block", 0.5),
      pig("outside", 2),
      { ...pig("unknown"), type: "minecraft:cow" },
    ];
    const view: EditorViewState = {
      hidden: ["block"],
      locked: ["block"],
      isolated: null,
      yRange: { min: 0, max: 1 },
    };
    expect(editableEntityIds(document, view)).toEqual(["block"]);
    expect(editableEntityIds(document, { ...view, isolated: [] })).toEqual([]);
    expect(() =>
      editableEntityIds(
        { ...document, entities: [] },
        { ...view, yRange: { min: 2, max: 1 } },
      ),
    ).toThrow();
  });
  it("applies the exact candidate and owns caller selection, IDs, input entity and base", () => {
    const source = fixture(),
      base = initialBase(),
      view = emptyEditorViewState();
    const ids = ["pig"],
      newIds = ["copy"];
    const plan = planEntityAction(
      source,
      ids,
      { kind: "duplicate", newIds, offset: [0.5, 0, 0] },
      catalog,
      { base, view },
    );
    ids[0] = "missing";
    newIds[0] = "wrong";
    (base as { revision: number }).revision = 99;
    expect(plan.selection).toEqual(["copy"]);
    expect(applyEntityAction(plan, source, initialBase(), catalog, view)).toBe(
      plan.document,
    );
    expect(plan.document.objects).toBe(source.objects);
    const entity = pig("added"),
      added = planEntityAction(source, [], { kind: "add", entity }, catalog, {
        base: initialBase(),
        view,
      });
    entity.position[0] = 99;
    entity.id = "changed";
    expect(added.selection).toEqual(["added"]);
    expect(added.document.entities[1].position[0]).toBe(0.25);
  });

  it("rejects stale identity, epoch, revision, document ID, catalog and view", () => {
    const source = fixture(),
      base = initialBase(),
      view = emptyEditorViewState();
    const plan = planEntityAction(
      source,
      ["pig"],
      { kind: "yaw", yaw: 90 },
      catalog,
      { base, view },
    );
    for (const stale of [
      { ...base, revision: 4 },
      { ...base, sessionEpoch: "other" },
      { ...base, documentId: "other" },
    ])
      expect(() =>
        applyEntityAction(plan, source, stale, catalog, view),
      ).toThrow();
    expect(() =>
      applyEntityAction(plan, { ...source }, base, catalog, view),
    ).toThrow(/changed/);
    expect(() =>
      applyEntityAction(plan, source, base, [...catalog], view),
    ).toThrow(/Materials changed/);
    expect(() =>
      applyEntityAction(plan, source, base, catalog, { ...view }),
    ).toThrow(/View policy changed/);
  });

  it("honors cancellation before planning and before apply, and preserves no-op identity", () => {
    const source = fixture(),
      base = initialBase(),
      view = emptyEditorViewState(),
      controller = new AbortController();
    const plan = planEntityAction(
      source,
      ["pig"],
      { kind: "move", delta: [0, 0, 0] },
      catalog,
      { base, view, signal: controller.signal },
    );
    expect(applyEntityAction(plan, source, base, catalog, view)).toBe(source);
    controller.abort();
    expect(() => applyEntityAction(plan, source, base, catalog, view)).toThrow(
      /cancelled/,
    );
    expect(() =>
      planEntityAction(
        source,
        [],
        { kind: "add", entity: pig("new") },
        catalog,
        { base, view, signal: controller.signal },
      ),
    ).toThrow(/cancelled/);
  });

  it("keeps legacy entity/block IDs separate from block hide/lock while blocking isolation", () => {
    const source = fixture();
    source.entities[0].id = "block";
    const base = initialBase(),
      view = { hidden: ["block"], locked: ["block"], isolated: null };
    expect(
      planEntityAction(source, ["block"], { kind: "remove" }, catalog, {
        base,
        view,
      }).document.objects,
    ).toBe(source.objects);
    expect(() =>
      planEntityAction(source, ["block"], { kind: "yaw", yaw: 0 }, catalog, {
        base,
        view: { ...view, isolated: ["block"] },
      }),
    ).toThrow(/isolation/);
    expect(() =>
      planEntityAction(
        source,
        [],
        { kind: "add", entity: pig("block") },
        catalog,
        { base, view },
      ),
    ).toThrow(/already used/);
    source.entities[0].type = "minecraft:unknown";
    expect(() =>
      planEntityAction(source, ["block"], { kind: "remove" }, catalog, {
        base,
        view,
      }),
    ).toThrow(/not supported/);
  });

  it("checks inclusive Y anchors for source selection and changed or new entities", () => {
    const source = fixture(),
      base = initialBase();
    const view: EditorViewState = {
      ...emptyEditorViewState(),
      yRange: { min: 0, max: 1 },
    };
    const run = (
      intent: EntityActionIntent,
      ids = ["pig"],
      activeView = view,
    ) =>
      planEntityAction(source, ids, intent, catalog, {
        base,
        view: activeView,
      });
    expect(
      run({ kind: "move", delta: [0, 0.5, 0] }).document.entities[0]
        .position[1],
    ).toBe(1);
    expect(run({ kind: "add", entity: pig("low", 0) }, []).selection).toEqual([
      "low",
    ]);
    for (const intent of [
      { kind: "move", delta: [0, 0.501, 0] },
      { kind: "duplicate", newIds: ["copy"], offset: [0, -0.501, 0] },
      { kind: "add", entity: pig("new", 1.001) },
    ] as EntityActionIntent[])
      expect(() => run(intent)).toThrow(/Y range/);
    source.entities[0].position[1] = -0.1;
    for (const intent of [
      { kind: "remove" },
      { kind: "move", delta: [0, 0.5, 0] },
      { kind: "yaw", yaw: 0 },
    ] as EntityActionIntent[])
      expect(() => run(intent)).toThrow(/Y range/);
    expect(() =>
      run({ kind: "add", entity: pig("new") }, [], {
        ...view,
        yRange: { min: 0.1, max: 1 },
      }),
    ).toThrow(/integer bounds/);
  });

  it("validates base and final candidate and commits each batch as one undo action", () => {
    const source = fixture(),
      base = initialBase(),
      view = emptyEditorViewState();
    for (const intent of [
      { kind: "add", entity: pig("new") },
      { kind: "move", delta: [1.25, 0, 0] },
      { kind: "yaw", yaw: 135.5 },
      { kind: "duplicate", newIds: ["copy"], offset: [0, 0, 0] },
      { kind: "remove" },
    ] as EntityActionIntent[]) {
      const plan = planEntityAction(source, ["pig"], intent, catalog, {
        base,
        view,
      });
      const history = executeHistory(
        createHistory(source),
        applyEntityAction(plan, source, base, catalog, view),
        plan.label,
      );
      expect(history.past).toHaveLength(1);
      expect(undoHistory(history).document).toEqual(source);
      expect(redoHistory(undoHistory(history)).document).toEqual(plan.document);
    }
    const invalid = fixture();
    invalid.objects[0].cells[0].state.name = "minecraft:unknown";
    expect(() =>
      planEntityAction(invalid, ["pig"], { kind: "remove" }, catalog, {
        base,
        view,
      }),
    ).toThrow();
    const plan = planEntityAction(
      source,
      ["pig"],
      { kind: "yaw", yaw: 90 },
      catalog,
      { base, view },
    );
    plan.document.entities[0].position[1] = Infinity;
    expect(() =>
      applyEntityAction(plan, source, base, catalog, view),
    ).toThrow();
  });
});
