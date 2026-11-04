import { describe, expect, it, vi } from "vitest";
import { DEMO_MATERIALS, defaultState, type Material } from "../core/catalog";
import type { BlockState, Vec3 } from "../core/schema";
import {
  createHistory,
  executeHistory,
  redoHistory,
  undoHistory,
} from "./history";
import { newEditorDocument, type EditorObject } from "./model";
import { createPlacedObject } from "./placement";
import {
  applyPrimitivePlan,
  planPrimitive,
  type PrimitiveIntent,
} from "./primitive-plan";

const catalog: Material[] = [
  ...DEMO_MATERIALS,
  {
    id: "minecraft:oak_door",
    label: "Door",
    family: "door",
    color: "#aaa",
    properties: {
      facing: ["north", "east", "south", "west"],
      half: ["lower", "upper"],
      hinge: ["left", "right"],
      open: ["false", "true"],
      powered: ["false", "true"],
    },
    defaults: {
      facing: "north",
      half: "lower",
      hinge: "left",
      open: "false",
      powered: "false",
    },
  },
];
const base = {
  documentId: "box-document",
  sessionEpoch: "session",
  revision: 7,
};
const options = { base, operationId: "box" };
const stone = defaultState("minecraft:stone", catalog);
const document = (...objects: EditorObject[]) => ({
  ...newEditorDocument(),
  id: base.documentId,
  objects,
});
const intent = (
  kind: PrimitiveIntent["kind"],
  start: Vec3,
  end: Vec3,
  state: BlockState = stone,
): PrimitiveIntent => ({ kind, start, end, state });
function bruteForce(start: Vec3, end: Vec3, hollow: boolean): Vec3[] {
  const min = start.map((value, axis) => Math.min(value, end[axis]));
  const max = start.map((value, axis) => Math.max(value, end[axis]));
  const result: Vec3[] = [];
  for (let z = min[2]; z <= max[2]; z++)
    for (let y = min[1]; y <= max[1]; y++)
      for (let x = min[0]; x <= max[0]; x++) {
        if (
          !hollow ||
          x === min[0] ||
          x === max[0] ||
          y === min[1] ||
          y === max[1] ||
          z === min[2] ||
          z === max[2]
        )
          result.push([x, y, z]);
      }
  return result;
}

describe("inclusive World box plans", () => {
  it("matches an independent dense boundary oracle, including all thin degenerates and reversed negative corners", () => {
    const source = document();
    for (let x = 1; x <= 5; x++)
      for (let y = 1; y <= 5; y++)
        for (let z = 1; z <= 5; z++) {
          const start: Vec3 = [-4, -3, -2],
            end: Vec3 = [x - 5, y - 4, z - 3];
          for (const kind of ["solid-box", "hollow-box"] as const) {
            const expected = bruteForce(start, end, kind === "hollow-box");
            const plan = planPrimitive(
              source,
              intent(kind, end, start),
              catalog,
              options,
            );
            expect(plan.cells.map((cell) => cell.pos)).toEqual(expected);
            expect(plan).toMatchObject({
              anchor: start,
              size: [x, y, z],
              anchors: expected.length,
            });
            expect(
              new Set(plan.cells.map((cell) => cell.pos.join(","))).size,
            ).toBe(expected.length);
          }
        }
  });

  it("counts 3-cubed as 27 solid anchors and 26 shell anchors with unique corners and edges", () => {
    for (const [kind, count] of [
      ["solid-box", 27],
      ["hollow-box", 26],
    ] as const) {
      const plan = planPrimitive(
        document(),
        intent(kind, [0, 0, 0], [2, 2, 2]),
        catalog,
        options,
      );
      expect(plan.anchors).toBe(count);
      expect(plan.cells.map((cell) => cell.pos)).toEqual(
        bruteForce([0, 0, 0], [2, 2, 2], kind === "hollow-box"),
      );
      expect(
        plan.cells.filter((cell) =>
          cell.pos.every((value) => value === 0 || value === 2),
        ),
      ).toHaveLength(8);
      expect(
        plan.cells.some((cell) => cell.pos.every((value) => value === 1)),
      ).toBe(kind === "solid-box");
    }
  });

  it("accepts the 58,808-anchor shell of a 100-cubed box under exact budgets and rejects its solid volume", () => {
    const source = document();
    const plan = planPrimitive(
      source,
      intent("hollow-box", [0, 0, 0], [99, 99, 99]),
      catalog,
      { ...options, budget: { maxObjects: 58808, maxCells: 58808 } },
    );
    expect(plan.cost).toEqual({
      addedObjects: 58808,
      addedCells: 58808,
      resultObjects: 58808,
      resultCells: 58808,
    });
    expect(() =>
      planPrimitive(
        source,
        intent("solid-box", [0, 0, 0], [99, 99, 99]),
        catalog,
        options,
      ),
    ).toThrow(/100,000 anchors/i);
  });

  it("rejects enormous legal bounds before reading the template state", () => {
    for (const kind of ["solid-box", "hollow-box"] as const) {
      const huge = intent(
        kind,
        [-30000000, -2048, -30000000],
        [30000000, 2048, 30000000],
      );
      Object.defineProperty(huge, "state", {
        get() {
          throw new Error("state accessed before count bound");
        },
      });
      expect(() => planPrimitive(document(), huge, catalog, options)).toThrow(
        /100,000 anchors/i,
      );
    }
  });

  it("charges complete logical pairs and existing content against both aggregate budgets", () => {
    const source = document(
      createPlacedObject(stone, [20, 0, 0], catalog, undefined, "existing"),
    );
    const box = intent(
      "hollow-box",
      [0, 0, 0],
      [1, 0, 1],
      defaultState("minecraft:oak_door", catalog),
    );
    expect(
      planPrimitive(source, box, catalog, {
        ...options,
        budget: { maxObjects: 5, maxCells: 9 },
      }).cost,
    ).toEqual({
      addedObjects: 4,
      addedCells: 8,
      resultObjects: 5,
      resultCells: 9,
    });
    for (const budget of [
      { maxObjects: 4, maxCells: 9 },
      { maxObjects: 5, maxCells: 8 },
    ]) {
      expect(() =>
        planPrimitive(source, box, catalog, { ...options, budget }),
      ).toThrow(/budget/i);
    }
  });

  it("completes door pairs outside a single-layer box and rejects overlapping three-dimensional pairs atomically", () => {
    const source = document(),
      state = defaultState("minecraft:oak_door", catalog);
    state.properties.half = "upper";
    for (const kind of ["solid-box", "hollow-box"] as const) {
      const plan = planPrimitive(
        source,
        intent(kind, [0, 0, 0], [1, 0, 1], state),
        catalog,
        options,
      );
      expect(plan.document.objects.map((object) => object.kind)).toEqual(
        Array(4).fill("multiblock"),
      );
      expect(plan.cells.map((cell) => cell.state.properties.half)).toEqual([
        "lower",
        "upper",
        "lower",
        "upper",
        "lower",
        "upper",
        "lower",
        "upper",
      ]);
      expect(plan.cells.map((cell) => cell.pos)).toEqual([
        [0, 0, 0],
        [0, 1, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 0, 1],
        [0, 1, 1],
        [1, 0, 1],
        [1, 1, 1],
      ]);
      expect(() =>
        planPrimitive(
          source,
          intent(kind, [0, 0, 0], [2, 2, 2], state),
          catalog,
          options,
        ),
      ).toThrow(/collision/i);
    }
    expect(source.objects).toEqual([]);
  });

  it("retains occupied interior content without carving and rejects any occupied shell cell", () => {
    const interior = createPlacedObject(
      stone,
      [1, 1, 1],
      catalog,
      undefined,
      "interior",
    );
    const source = document(interior),
      snapshot = structuredClone(source);
    const box = intent("hollow-box", [0, 0, 0], [2, 2, 2]);
    const plan = planPrimitive(source, box, catalog, options);
    expect(plan.document.objects[0]).toBe(interior);
    expect(plan.cost.resultCells).toBe(27);
    expect(source).toEqual(snapshot);
    const boundary = createPlacedObject(
      stone,
      [0, 1, 1],
      catalog,
      undefined,
      "boundary",
    );
    expect(() =>
      planPrimitive(document(interior, boundary), box, catalog, options),
    ).toThrow(/collision/i);
    expect(() =>
      planPrimitive(source, { ...box, kind: "solid-box" }, catalog, options),
    ).toThrow(/collision/i);
  });

  it("preserves explicit log and slab states on every shell cell", () => {
    for (const state of [
      { name: "minecraft:oak_log", properties: { axis: "z" } },
      {
        name: "minecraft:stone_brick_slab",
        properties: { type: "top", waterlogged: "true" },
      },
    ] as BlockState[]) {
      const plan = planPrimitive(
        document(),
        intent("hollow-box", [-1, -1, -1], [1, 1, 1], state),
        catalog,
        options,
      );
      expect(plan.cells.map((cell) => cell.state)).toEqual(
        Array.from({ length: 26 }, () => state),
      );
      expect(plan.cells[0].state.properties).not.toBe(state.properties);
      expect(plan.cells[0].state.properties).not.toBe(
        plan.cells[1].state.properties,
      );
    }
  });

  it("uses stable fresh operation IDs without RNG and preserves source objects and free entities", () => {
    const source = document(
      createPlacedObject(stone, [20, 0, 0], catalog, undefined, "existing"),
    );
    source.entities = [
      { id: "pig", type: "minecraft:pig", position: [1, 2, 3], yaw: 90 },
    ];
    const snapshot = structuredClone(source),
      box = intent("hollow-box", [0, 0, 0], [2, 2, 2]);
    const random = vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("unexpected RNG");
    });
    try {
      const plan = planPrimitive(source, box, catalog, options);
      expect(
        planPrimitive(source, box, catalog, options).addedObjectIds,
      ).toEqual(plan.addedObjectIds);
      expect(plan.addedObjectIds).toEqual(
        Array.from({ length: 26 }, (_, index) => `box:${index}`),
      );
      const nextBox = intent("solid-box", [5, 0, 0], [5, 0, 0]);
      expect(() =>
        planPrimitive(plan.document, nextBox, catalog, options),
      ).toThrow(/conflict/i);
      expect(
        planPrimitive(plan.document, nextBox, catalog, {
          ...options,
          operationId: "next",
        }).selection,
      ).toEqual(["next:0"]);
      expect(plan.document.objects[0]).toBe(source.objects[0]);
      expect(plan.document.entities).toBe(source.entities);
      expect(source).toEqual(snapshot);
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });

  it("applies the exact box preview in one undo step and guards stale or cancelled plans", () => {
    const history = createHistory(document()),
      controller = new AbortController();
    const box = intent("hollow-box", [0, 0, 0], [2, 2, 2]);
    const plan = planPrimitive(history.document, box, catalog, {
      ...options,
      signal: controller.signal,
    });
    expect(applyPrimitivePlan(plan, history.document, base, catalog)).toBe(
      plan.document,
    );
    for (const changed of [
      { ...base, revision: 8 },
      { ...base, sessionEpoch: "next" },
    ])
      expect(() =>
        applyPrimitivePlan(plan, history.document, changed, catalog),
      ).toThrow(/changed/i);
    expect(() =>
      applyPrimitivePlan(
        plan,
        structuredClone(history.document),
        base,
        catalog,
      ),
    ).toThrow(/changed/i);
    const committed = executeHistory(
      history,
      applyPrimitivePlan(plan, history.document, base, catalog),
      "Box",
    );
    expect(committed.past).toHaveLength(1);
    expect(committed.past[0].patches).toEqual(plan.patches);
    expect(undoHistory(committed).document).toEqual(history.document);
    expect(redoHistory(undoHistory(committed)).document).toEqual(plan.document);
    controller.abort();
    expect(() =>
      applyPrimitivePlan(plan, history.document, base, catalog),
    ).toThrow(/cancelled/i);
    expect(() =>
      planPrimitive(history.document, box, catalog, {
        ...options,
        signal: controller.signal,
      }),
    ).toThrow(/cancelled/i);
  });
});
