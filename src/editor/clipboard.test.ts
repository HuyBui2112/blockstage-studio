import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS, defaultState, type Material } from "../core/catalog";
import type { Vec3 } from "../core/schema";
import {
  applyPastePlan,
  createClipboard,
  planPaste,
  type EditorClipboard,
} from "./clipboard";
import {
  createHistory,
  executeHistory,
  redoHistory,
  undoHistory,
} from "./history";
import {
  newEditorDocument,
  objectCells,
  type EditorDocument,
  type EditorObject,
} from "./model";
import { createPlacedObject } from "./placement";

const catalog: Material[] = [
  ...DEMO_MATERIALS,
  {
    id: "minecraft:air",
    label: "Air",
    family: "air",
    color: "#aaa",
    properties: {},
    defaults: {},
  },
  {
    id: "minecraft:red_bed",
    label: "Bed",
    family: "bed",
    color: "#aaa",
    properties: {
      facing: ["north", "east", "south", "west"],
      part: ["foot", "head"],
      occupied: ["false", "true"],
    },
    defaults: { facing: "east", part: "foot", occupied: "false" },
  },
];
function block(
  id: string,
  pos: Vec3 = [0, 0, 0],
  name = "stone",
): EditorObject {
  return {
    ...createPlacedObject(
      defaultState(`minecraft:${name}`, catalog),
      pos,
      catalog,
    ),
    id,
  };
}
function group(id: string, children: EditorObject[]): EditorObject {
  return {
    id,
    name: id,
    kind: "group",
    children,
    cells: [],
    pivot2: [-3, 1, 5],
    orientation: 2,
  };
}
function doc(...objects: EditorObject[]): EditorDocument {
  return { ...newEditorDocument(), id: "document", objects };
}
const base = { documentId: "document", sessionEpoch: "session", revision: 3 };
const options = { base, operationId: "paste" };
const clip = () => createClipboard(doc(block("a")), ["a"], catalog);

describe("internal clipboard", () => {
  it("snapshots whole nested objects in document order with air anchor, states and provenance", () => {
    const component = {
      ...group("component", [
        block("bed", [-8, -2, 4], "red_bed"),
        block("log", [-4, -2, 4], "oak_log"),
      ]),
      kind: "component" as const,
      componentId: "library",
    };
    const source = doc(
      group("root", [component]),
      block("air", [-10, -3, -2], "air"),
    );
    source.entities = [
      { id: "pig", type: "minecraft:pig", position: [0, 0, 0], yaw: 0 },
    ];
    const before = structuredClone(source);
    const clipboard = createClipboard(source, ["air", "root"], catalog);
    expect(clipboard.anchor).toEqual([-10, -3, -2]);
    expect(clipboard.objects.map((o) => o.id)).toEqual(["root", "air"]);
    expect(source).toEqual(before);
    expect(clipboard).not.toHaveProperty("entities");
    source.objects = [];
    const destination = { ...doc(), workspace: "component" as const };
    const plan = planPaste(destination, clipboard, [0, 0, 0], catalog, options);
    const copied = plan.document.objects[0].children[0];
    expect(copied).toMatchObject({
      componentId: "library",
      orientation: 2,
      pivot2: [17, 7, 9],
    });
    expect(objectCells(copied)).toEqual(
      objectCells(component).map((cell) => ({
        pos: [cell.pos[0] + 10, cell.pos[1] + 3, cell.pos[2] + 2],
        state: cell.state,
      })),
    );
    expect(plan.document.entities).toBe(destination.entities);
  });

  it("keeps an explicit negative anchor and translates pivots without normalization", () => {
    const source = doc(block("a", [4, 2, 8]));
    const anchor: Vec3 = [-3, -2, -5];
    const clipboard = createClipboard(source, ["a"], catalog, anchor);
    anchor[0] = 100;
    source.objects[0].cells[0].state.properties.changed = "true";
    const plan = planPaste(doc(), clipboard, [-10, -4, -12], catalog, options);
    expect(plan.document.objects[0].cells[0].pos).toEqual([-3, 0, 1]);
    expect(plan.document.objects[0].pivot2).toEqual([-5, 1, 3]);
    expect(
      plan.document.objects[0].cells[0].state.properties,
    ).not.toHaveProperty("changed");
  });

  it("uses destination identity across documents and keeps source entities independent", () => {
    const source = { ...doc(block("a")), id: "source" };
    source.entities = [
      { id: "pig", type: "minecraft:pig", position: [0, 0, 0], yaw: 0 },
    ];
    const clipboard = createClipboard(source, ["a"], catalog);
    const destination = doc();
    const plan = planPaste(destination, clipboard, [0, 0, 0], catalog, options);
    expect(applyPastePlan(plan, destination, base, catalog)).toBe(
      plan.document,
    );
    expect(plan.document.entities).toEqual([]);
    expect(source.entities).toHaveLength(1);
  });

  it("keeps nested IDs stable across previews and fresh across subsequent pastes", () => {
    const clipboard = createClipboard(
      doc(group("g", [block("a")])),
      ["g"],
      catalog,
    );
    const destination = doc();
    const first = planPaste(
      destination,
      clipboard,
      [2, 0, 0],
      catalog,
      options,
    );
    expect(
      planPaste(destination, clipboard, [4, 0, 0], catalog, options)
        .addedObjectIds,
    ).toEqual(first.addedObjectIds);
    const next = { base: { ...base, revision: 4 }, operationId: "next" };
    expect(
      planPaste(first.document, clipboard, [4, 0, 0], catalog, next)
        .addedObjectIds,
    ).toEqual(["next:0", "next:1"]);
    expect(() =>
      planPaste(first.document, clipboard, [4, 0, 0], catalog, {
        ...next,
        operationId: "paste",
      }),
    ).toThrow(/conflict/);
  });

  it("rejects empty, repeated, missing and nested copy selections", () => {
    const source = doc(group("g", [block("child")]));
    for (const ids of [[], ["g", "g"], ["missing"], ["child"]])
      expect(() => createClipboard(source, ids, catalog)).toThrow();
  });

  it("never reuses snapshot IDs even when the destination is empty", () => {
    const clipboard = createClipboard(
      doc(group("paste:0", [block("original-child")])),
      ["paste:0"],
      catalog,
    );
    expect(() =>
      planPaste(doc(), clipboard, [2, 0, 0], catalog, options),
    ).toThrow(/conflict/);
    const result = planPaste(doc(), clipboard, [2, 0, 0], catalog, {
      ...options,
      operationId: "fresh",
    });
    expect(result.addedObjectIds).toEqual(["fresh:0", "fresh:1"]);
  });

  it("rejects unsupported envelopes, nested payload and incomplete logical pairs", () => {
    const valid = clip();
    const pair = createClipboard(
      doc(block("bed", [0, 0, 0], "red_bed")),
      ["bed"],
      catalog,
    );
    pair.objects[0].cells.pop();
    const nested = clip();
    Object.assign(nested.objects[0].cells[0], { nbt: {} });
    for (const value of [
      { ...valid, version: 2 },
      { ...valid, target: { gameVersion: "26.1", dataVersion: 4903 } },
      { ...valid, format: "other" },
      { ...valid, entities: [] },
      { ...valid, objects: [] },
      nested,
      pair,
    ]) {
      expect(() =>
        planPaste(doc(), value as EditorClipboard, [0, 0, 0], catalog, options),
      ).toThrow();
    }
  });

  it("revalidates against current catalog without dropping explicit states", () => {
    const clipboard = createClipboard(
      doc(block("log", [0, 0, 0], "oak_log")),
      ["log"],
      catalog,
    );
    expect(() =>
      planPaste(
        doc(),
        clipboard,
        [0, 0, 0],
        catalog.filter((m) => m.id !== "minecraft:oak_log"),
        options,
      ),
    ).toThrow();
    clipboard.objects[0].cells[0].state.properties.axis = "unknown";
    expect(() =>
      planPaste(doc(), clipboard, [0, 0, 0], catalog, options),
    ).toThrow();
  });

  it("rejects fractional anchors/positions, out of bounds and collisions", () => {
    expect(() =>
      createClipboard(doc(block("a")), ["a"], catalog, [0.5, 0, 0]),
    ).toThrow();
    for (const position of [
      [0.5, 0, 0],
      [30000001, 0, 0],
      [0, 2049, 0],
    ] as Vec3[])
      expect(() =>
        planPaste(doc(), clip(), position, catalog, options),
      ).toThrow();
    expect(() =>
      planPaste(doc(block("existing")), clip(), [0, 0, 0], catalog, options),
    ).toThrow(/collision/i);
  });

  it("bounds cyclic, shared and deep trees before recursive parsing", () => {
    const cycle = group("cycle", []);
    cycle.children.push(cycle);
    let deep = block("leaf");
    for (let i = 0; i < 16; i++) deep = group(`g${i}`, [deep]);
    const child = block("child");
    for (const object of [cycle, deep, group("shared", [child, child])])
      expect(() =>
        planPaste(
          doc(),
          { ...clip(), objects: [object] },
          [0, 0, 0],
          catalog,
          options,
        ),
      ).toThrow(/limits|cycle/);
    const overflow = clip();
    overflow.objects[0].cells = Array(100001).fill(
      overflow.objects[0].cells[0],
    );
    expect(() =>
      planPaste(doc(), overflow, [0, 0, 0], catalog, options),
    ).toThrow(/100,000/);
  });

  it("honors aggregate budgets and cancellation during copy, preview and apply", () => {
    expect(() =>
      planPaste(doc(block("existing", [2, 0, 0])), clip(), [0, 0, 0], catalog, {
        ...options,
        budget: { maxCells: 1, maxObjects: 2 },
      }),
    ).toThrow(/budget/);
    const controller = new AbortController(),
      destination = doc(),
      clipboard = clip();
    const plan = planPaste(destination, clipboard, [0, 0, 0], catalog, {
      ...options,
      signal: controller.signal,
    });
    controller.abort();
    expect(() => applyPastePlan(plan, destination, base, catalog)).toThrow(
      /cancelled/,
    );
    expect(() =>
      planPaste(destination, clipboard, [0, 0, 0], catalog, {
        ...options,
        signal: controller.signal,
      }),
    ).toThrow(/cancelled/);
    expect(() =>
      createClipboard(
        doc(block("a")),
        ["a"],
        catalog,
        undefined,
        controller.signal,
      ),
    ).toThrow(/cancelled/);
  });

  it("rejects stale document identity, epoch and revision", () => {
    const destination = doc(),
      plan = planPaste(destination, clip(), [0, 0, 0], catalog, options);
    expect(() =>
      applyPastePlan(plan, structuredClone(destination), base, catalog),
    ).toThrow(/changed/);
    for (const current of [
      { ...base, revision: 4 },
      { ...base, sessionEpoch: "new" },
    ])
      expect(() => applyPastePlan(plan, destination, current, catalog)).toThrow(
        /changed/,
      );
  });

  it("commits the exact preview in one undo step and restores it on redo", () => {
    const history = createHistory(doc()),
      plan = planPaste(history.document, clip(), [-2, 0, 0], catalog, options);
    const committed = executeHistory(
      history,
      applyPastePlan(plan, history.document, base, catalog),
      "Paste",
    );
    expect(committed.past).toHaveLength(1);
    expect(committed.past[0].patches).toEqual(plan.patches);
    const undone = undoHistory(committed);
    expect(undone.document).toEqual(history.document);
    expect(redoHistory(undone).document).toEqual(plan.document);
  });
});
