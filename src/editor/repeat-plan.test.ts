import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS, defaultState, type Material } from "../core/catalog";
import type { Vec3 } from "../core/schema";
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
import { applyRepeatPlan, planRepeat, type RepeatIntent } from "./repeat-plan";

const catalog: Material[] = [
  ...DEMO_MATERIALS,
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
    cells: [],
    children,
    pivot2: [-1, 1, 3],
    orientation: 2,
  };
}
function document(...objects: EditorObject[]): EditorDocument {
  return { ...newEditorDocument(), id: "document", objects };
}
const base = { documentId: "document", sessionEpoch: "session", revision: 7 };
const options = { base, operationId: "repeat" };
const intent: RepeatIntent = { axis: "x", count: 2, spacing: 4 };

describe("repeat operation plans", () => {
  it("counts new copies and uses signed world axis spacing from each original anchor", () => {
    const source = document(block("a", [-3, 2, -5]));
    for (const [axis, positions] of [
      [
        "x",
        [
          [-7, 2, -5],
          [-11, 2, -5],
        ],
      ],
      [
        "y",
        [
          [-3, -2, -5],
          [-3, -6, -5],
        ],
      ],
      [
        "z",
        [
          [-3, 2, -9],
          [-3, 2, -13],
        ],
      ],
    ] as const) {
      const plan = planRepeat(
        source,
        ["a"],
        { axis, count: 2, spacing: -4 },
        catalog,
        options,
      );
      expect(plan.document.objects).toHaveLength(3);
      expect(plan.document.objects[0]).toBe(source.objects[0]);
      expect(
        plan.document.objects.slice(1).map((copy) => copy.cells[0].pos),
      ).toEqual(positions);
      expect(plan).toMatchObject({
        kind: "repeat",
        intent: { axis, count: 2, spacing: -4 },
      });
    }
    expect(
      planRepeat(source, ["a"], { ...intent, count: 1 }, catalog, options)
        .selection,
    ).toHaveLength(1);
  });

  it("preserves nested components, complete pairs, explicit states, pivots and provenance without copying entities", () => {
    const log = block("log", [-8, -3, -4], "oak_log");
    log.cells[0].state.properties.axis = "z";
    const component: EditorObject = {
      ...group("component", [block("bed", [-12, -3, -4], "red_bed"), log]),
      kind: "component",
      componentId: "library-source",
    };
    const source = document(group("root", [component]));
    source.entities = [
      { id: "entity", type: "minecraft:pig", position: [1, 2, 3], yaw: 90 },
    ];
    const snapshot = structuredClone(source);
    const plan = planRepeat(
      source,
      ["root"],
      { axis: "z", count: 2, spacing: -16 },
      catalog,
      options,
    );
    expect(source).toEqual(snapshot);
    expect(plan.document.entities).toBe(source.entities);
    for (const [index, copy] of plan.document.objects.slice(1).entries()) {
      const delta = -16 * (index + 1);
      expect(copy).toMatchObject({
        kind: "group",
        orientation: 2,
        pivot2: [-1, 1, 3 + delta * 2],
      });
      expect(copy.children[0]).toMatchObject({
        kind: "component",
        componentId: "library-source",
        orientation: 2,
        pivot2: [-1, 1, 3 + delta * 2],
      });
      expect(objectCells(copy)).toEqual([
        {
          pos: [-12, -3, -4 + delta],
          state: {
            name: "minecraft:red_bed",
            properties: { facing: "east", part: "foot", occupied: "false" },
          },
        },
        {
          pos: [-11, -3, -4 + delta],
          state: {
            name: "minecraft:red_bed",
            properties: { facing: "east", part: "head", occupied: "false" },
          },
        },
        {
          pos: [-8, -3, -4 + delta],
          state: { name: "minecraft:oak_log", properties: { axis: "z" } },
        },
      ]);
    }
    expect(plan.addedObjectIds).toEqual(
      Array.from({ length: 8 }, (_, index) => `repeat:${index}`),
    );
    expect(plan.selection).toEqual(["repeat:0", "repeat:4"]);
    expect(plan.cells.map((cell) => cell.owner)).toEqual([
      "repeat:0",
      "repeat:0",
      "repeat:0",
      "repeat:4",
      "repeat:4",
      "repeat:4",
    ]);
    expect(plan.cost).toEqual({
      addedObjects: 8,
      addedCells: 6,
      resultObjects: 12,
      resultCells: 9,
    });
  });

  it("keeps IDs stable across spacing previews and requires a fresh operation ID for subsequent commands", () => {
    const source = document(group("root", [block("child")]));
    const first = planRepeat(source, ["root"], intent, catalog, options);
    const adjusted = planRepeat(
      source,
      ["root"],
      { ...intent, spacing: -3 },
      catalog,
      options,
    );
    expect(adjusted.addedObjectIds).toEqual(first.addedObjectIds);
    const nextOptions = { base: { ...base, revision: 8 }, operationId: "next" };
    expect(
      planRepeat(
        first.document,
        ["root"],
        { ...intent, count: 1, spacing: 12 },
        catalog,
        nextOptions,
      ).selection,
    ).toEqual(["next:0"]);
    expect(() =>
      planRepeat(
        first.document,
        ["root"],
        { ...intent, spacing: 12 },
        catalog,
        { ...nextOptions, operationId: "repeat" },
      ),
    ).toThrow(/conflict/);
  });

  it("makes mutable cell, state, property and pivot copies independent of source and other repeats", () => {
    const source = document(block("log", [0, 0, 0], "oak_log"));
    const plan = planRepeat(source, ["log"], intent, catalog, options);
    const [first, second] = plan.document.objects.slice(1);
    first.cells[0].pos[1] = 9;
    first.cells[0].state.properties.axis = "z";
    first.pivot2[1] = 19;
    expect(source.objects[0].cells[0]).toMatchObject({
      pos: [0, 0, 0],
      state: { properties: { axis: "y" } },
    });
    expect(second.cells[0]).toMatchObject({
      pos: [8, 0, 0],
      state: { properties: { axis: "y" } },
    });
    expect(second.pivot2).toEqual([17, 1, 1]);
    expect(source.objects[0].pivot2).toEqual([1, 1, 1]);
  });

  it("rejects invalid count, zero or noninteger spacing, and invalid axes", () => {
    const source = document(block("a"));
    for (const count of [0, -1, 1.5, 100001, Infinity, NaN])
      expect(() =>
        planRepeat(source, ["a"], { ...intent, count }, catalog, options),
      ).toThrow(/count/i);
    for (const spacing of [
      0,
      -0,
      0.5,
      Infinity,
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() =>
        planRepeat(source, ["a"], { ...intent, spacing }, catalog, options),
      ).toThrow(/spacing/i);
    expect(() =>
      planRepeat(
        source,
        ["a"],
        { ...intent, axis: "w" as RepeatIntent["axis"] },
        catalog,
        options,
      ),
    ).toThrow(/axis/i);
  });

  it("rejects incomplete logical pairs and nested or missing selection", () => {
    const pair = block("bed", [0, 0, 0], "red_bed");
    pair.cells.pop();
    expect(() =>
      planRepeat(document(pair), ["bed"], intent, catalog, options),
    ).toThrow();
    const source = document(group("root", [block("child")]));
    for (const ids of [[], ["child"], ["missing"], ["root", "root"]])
      expect(() => planRepeat(source, ids, intent, catalog, options)).toThrow(
        /select|missing/i,
      );
  });

  it("rejects the entire result when copies hit originals, one another, or a later unselected block", () => {
    const bed = document(block("bed", [0, 0, 0], "red_bed"));
    expect(() =>
      planRepeat(bed, ["bed"], { ...intent, spacing: 1 }, catalog, options),
    ).toThrow(/collision/i);
    // The first repeat is clear; only the second meets the original's far child.
    const span = document(
      group("root", [block("left"), block("right", [6, 0, 0])]),
    );
    expect(() =>
      planRepeat(span, ["root"], { ...intent, spacing: 3 }, catalog, options),
    ).toThrow(/collision/i);
    const source = document(block("a"), block("obstacle", [12, 0, 0]));
    expect(() =>
      planRepeat(source, ["a"], { ...intent, count: 3 }, catalog, options),
    ).toThrow(/collision/i);
    expect(source.objects).toHaveLength(2);
    // Distinct selected sources can overlap only each other's translated copies.
    const multiple = document(block("a"), block("b", [3, 0, 0]));
    expect(() =>
      planRepeat(
        multiple,
        ["a", "b"],
        { ...intent, spacing: 3 },
        catalog,
        options,
      ),
    ).toThrow(/collision/i);
  });

  it("checks multiplied nested object and cell budgets against the destination before reading states", () => {
    const source = document(
      group("root", [block("child")]),
      block("other", [20, 0, 0]),
    );
    const plan = planRepeat(source, ["root"], intent, catalog, {
      ...options,
      budget: { maxObjects: 7, maxCells: 4 },
    });
    expect(plan.cost).toEqual({
      addedObjects: 4,
      addedCells: 2,
      resultObjects: 7,
      resultCells: 4,
    });
    for (const budget of [
      { maxObjects: 6, maxCells: 4 },
      { maxObjects: 7, maxCells: 3 },
    ])
      expect(() =>
        planRepeat(source, ["root"], intent, catalog, { ...options, budget }),
      ).toThrow(/budget/i);
    Object.defineProperty(source.objects[0].children[0].cells[0], "state", {
      get() {
        throw new Error("expansion must not read state");
      },
    });
    expect(() =>
      planRepeat(
        source,
        ["root"],
        { ...intent, count: 100000 },
        catalog,
        options,
      ),
    ).toThrow(/budget/i);
  });

  it("honors cancellation and source identity, document, epoch and revision guards on apply", () => {
    const source = document(block("a")),
      controller = new AbortController();
    const plan = planRepeat(source, ["a"], intent, catalog, {
      ...options,
      signal: controller.signal,
    });
    expect(applyRepeatPlan(plan, source, base, catalog)).toBe(plan.document);
    expect(() =>
      applyRepeatPlan(plan, structuredClone(source), base, catalog),
    ).toThrow(/changed/i);
    for (const currentBase of [
      { ...base, sessionEpoch: "next" },
      { ...base, revision: 8 },
    ])
      expect(() => applyRepeatPlan(plan, source, currentBase, catalog)).toThrow(
        /changed/i,
      );
    expect(() =>
      applyRepeatPlan(
        plan,
        { ...source, id: "other" },
        { ...base, documentId: "other" },
        catalog,
      ),
    ).toThrow(/changed/i);
    controller.abort();
    expect(() => applyRepeatPlan(plan, source, base, catalog)).toThrow(
      /cancelled/i,
    );
    expect(() =>
      planRepeat(source, ["a"], intent, catalog, {
        ...options,
        signal: controller.signal,
      }),
    ).toThrow(/cancelled/i);
  });

  it("commits every repeat as one undo step and restores exact nested data on redo", () => {
    const history = createHistory(
      document(group("root", [block("bed", [0, 0, 0], "red_bed")])),
    );
    const plan = planRepeat(
      history.document,
      ["root"],
      intent,
      catalog,
      options,
    );
    const committed = executeHistory(
      history,
      applyRepeatPlan(plan, history.document, base, catalog),
      "Repeat",
    );
    expect(committed.document).toBe(plan.document);
    expect(committed.past).toHaveLength(1);
    expect(committed.past[0].patches).toEqual(plan.patches);
    const undone = undoHistory(committed);
    expect(undone.document).toEqual(history.document);
    expect(redoHistory(undone).document).toEqual(plan.document);
    expect(() =>
      applyRepeatPlan(plan, undone.document, { ...base, revision: 9 }, catalog),
    ).toThrow(/changed/i);
  });
});
