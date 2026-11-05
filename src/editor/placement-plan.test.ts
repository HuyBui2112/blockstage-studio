import { describe, expect, it } from "vitest";
import { bounds } from "../core/assembly";
import { defaultState, DEMO_MATERIALS, type Material } from "../core/catalog";
import type { BlockState, Vec3 } from "../core/schema";
import {
  createHistory,
  executeHistory,
  redoHistory,
  undoHistory,
} from "./history";
import {
  newEditorDocument,
  objectCells,
  validateDocument,
  type ComponentAsset,
  type EditorObject,
} from "./model";
import {
  componentFromSelection,
  groupObjects,
  insertObject,
} from "./operations";
import { createPlacedObject } from "./placement";
import {
  CONTEXT_CHAIN_IDS,
  planBlockPlacement,
  planComponentPlacement,
  type PlacementHit,
  type PlacementOptions,
} from "./placement-plan";

const facing = ["north", "east", "south", "west"];
const bed: Material = {
  id: "minecraft:red_bed",
  label: "Bed",
  family: "bed",
  color: "#f00",
  properties: { facing, part: ["foot", "head"], occupied: ["false", "true"] },
  defaults: { facing: "north", part: "foot", occupied: "false" },
};
const door: Material = {
  id: "minecraft:oak_door",
  label: "Door",
  family: "door",
  color: "#fff",
  properties: {
    facing,
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
};
const chains: Material[] = [...CONTEXT_CHAIN_IDS].map((id) => ({
  id,
  label: id,
  family: "chain",
  color: "#aaa",
  properties: { axis: ["x", "y", "z"], waterlogged: ["false", "true"] },
  defaults: { axis: "y", waterlogged: "false" },
}));
const lanterns: Material[] = ["lantern", "soul_lantern", "copper_lantern"].map(
  (id) => ({
    id: `minecraft:${id}`,
    label: id,
    family: "lantern",
    color: "#aaa",
    properties: { hanging: ["false", "true"], waterlogged: ["false", "true"] },
    defaults: { hanging: "false", waterlogged: "false" },
  }),
);
const catalog = [...DEMO_MATERIALS, bed, door, ...chains, ...lanterns];
const context: PlacementOptions = { mode: "context", turns: 0 };
const design: PlacementOptions = { mode: "design", turns: 0 };
const pos: Vec3 = [-3, -4, -5];
const hit = (
  face: Vec3 = [0, 1, 0],
  y = pos[1] + 0.5,
  look: Vec3 = [0, 0, -1],
): PlacementHit => ({
  pos,
  face,
  point: [pos[0] + 0.25, y, pos[2] + 0.75],
  look,
});
const state = (
  id: string,
  properties: Record<string, string> = {},
): BlockState => ({
  ...defaultState(`minecraft:${id}`, catalog),
  properties: {
    ...defaultState(`minecraft:${id}`, catalog).properties,
    ...properties,
  },
});
const plan = (source: BlockState, surface = hit(), options = context) =>
  planBlockPlacement(source, pos, catalog, surface, options);
const firstState = (source: BlockState, surface = hit(), options = context) =>
  plan(source, surface, options).object.cells[0].state.properties;

describe("shared block placement plans", () => {
  it.each([...CONTEXT_CHAIN_IDS])(
    "orients exact chain ID %s while preserving explicit waterlogging and Design state",
    (id) => {
      const source = {
        ...defaultState(id, catalog),
        properties: { axis: "z", waterlogged: "true" },
      };
      for (const [face, axis] of [
        [[1, 0, 0], "x"],
        [[-1, 0, 0], "x"],
        [[0, 1, 0], "y"],
        [[0, -1, 0], "y"],
        [[0, 0, 1], "z"],
        [[0, 0, -1], "z"],
      ] as [Vec3, string][]) {
        expect(firstState(source, hit(face))).toEqual({
          axis,
          waterlogged: "true",
        });
        expect(firstState(source, hit(face), design)).toEqual(
          source.properties,
        );
      }
    },
  );

  it.each(lanterns.map((material) => material.id))(
    "derives vertical lantern attachment for %s without claiming side/support simulation",
    (id) => {
      const source = {
          ...defaultState(id, catalog),
          properties: { hanging: "false", waterlogged: "true" },
        },
        before = structuredClone(source);
      expect(firstState(source, hit([0, -1, 0]))).toEqual({
        hanging: "true",
        waterlogged: "true",
      });
      expect(
        firstState(
          { ...source, properties: { ...source.properties, hanging: "true" } },
          hit([0, 1, 0]),
        ),
      ).toEqual({ hanging: "false", waterlogged: "true" });
      for (const face of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
      ] as Vec3[]) {
        for (const hanging of ["false", "true"]) {
          const selected = {
            ...source,
            properties: { ...source.properties, hanging },
          };
          const result = plan(selected, hit(face));
          expect(result.object.cells[0].state).toEqual(selected);
          expect(result.notes.join()).toContain("top or bottom face");
        }
      }
      expect(plan(source, hit([0, -1, 0])).notes.join()).toContain(
        "support, alternate attachment and fluids are not simulated",
      );
      expect(firstState(source, hit([0, -1, 0]), design)).toEqual(
        source.properties,
      );
      expect(source).toEqual(before);
    },
  );

  it("places the exact hanging preview beneath a chain, rejects overlap and restores the pair through Undo/Redo", () => {
    const chain = createPlacedObject(
      state("iron_chain"),
      [pos[0], pos[1] + 1, pos[2]],
      catalog,
    );
    const document = { ...newEditorDocument(), objects: [chain] },
      before = structuredClone(document);
    const preview = plan(state("soul_lantern"), {
      ...hit([0, -1, 0]),
      target: chain.cells[0].pos,
    });
    expect(document).toEqual(before);
    expect(preview.object.cells[0]).toMatchObject({
      pos,
      state: {
        name: "minecraft:soul_lantern",
        properties: { hanging: "true" },
      },
    });
    const inserted = insertObject(document, preview.object, catalog);
    const history = executeHistory(
      createHistory(document),
      inserted,
      "Place lantern",
    );
    expect(history.document.objects[1]).toEqual(preview.object);
    expect(history.past).toHaveLength(1);
    expect(undoHistory(history).document).toEqual(document);
    expect(redoHistory(undoHistory(history)).document).toEqual(inserted);
    expect(() =>
      insertObject(inserted, plan(state("lantern")).object, catalog),
    ).toThrow("collision");
    expect(inserted.objects[0]).toEqual(chain);
  });

  it.each([
    [[1, 0, 0], "x"],
    [[-1, 0, 0], "x"],
    [[0, 1, 0], "y"],
    [[0, -1, 0], "y"],
    [[0, 0, 1], "z"],
    [[0, 0, -1], "z"],
  ] as [Vec3, string][])("orients a log from clicked face %j", (face, axis) => {
    expect(firstState(state("oak_log", { axis: "z" }), hit(face)).axis).toBe(
      axis,
    );
  });

  it.each(["stone_brick_slab", "oak_stairs"])(
    "uses strict midpoint and placed-cell height for %s on every side",
    (id) => {
      const property = id === "oak_stairs" ? "half" : "type";
      for (const face of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
      ] as Vec3[]) {
        expect(
          firstState(state(id), hit(face, pos[1] + 0.499999))[property],
        ).toBe("bottom");
        expect(firstState(state(id), hit(face, pos[1] + 0.5))[property]).toBe(
          "bottom",
        );
        expect(
          firstState(state(id), hit(face, pos[1] + 0.500001))[property],
        ).toBe("top");
      }
      expect(firstState(state(id), hit([0, 1, 0], pos[1] + 1))[property]).toBe(
        "bottom",
      );
      expect(firstState(state(id), hit([0, -1, 0], pos[1]))[property]).toBe(
        "top",
      );
    },
  );

  it.each([
    [[0, 0, -1], "north"],
    [[1, 0, 0], "east"],
    [[0, 0, 1], "south"],
    [[-1, 0, 0], "west"],
    [[1, 0, 1], "south"],
    [[-1, 0, 1], "west"],
    [[-1, 0, -1], "north"],
    [[1, 0, -1], "east"],
  ] as [Vec3, string][])(
    "uses horizontal forward direction %j for stairs, bed and door",
    (look, facing) => {
      for (const id of ["oak_stairs", "red_bed", "oak_door"])
        expect(firstState(state(id), hit([0, 1, 0], pos[1], look)).facing).toBe(
          facing,
        );
    },
  );

  it("preserves explicit non-context fields and creates both logical parts after context yaw", () => {
    const source = state("red_bed", { part: "head", occupied: "true" }),
      before = structuredClone(source);
    const bedPlan = plan(source, hit([0, 1, 0], pos[1], [0, 0, -1]), {
      ...context,
      turns: 1,
    });
    expect(bedPlan.object.cells.map((cell) => cell.pos)).toEqual([
      pos,
      [-2, -4, -5],
    ]);
    expect(bedPlan.object.cells.map((cell) => cell.state.properties)).toEqual([
      { facing: "east", part: "foot", occupied: "true" },
      { facing: "east", part: "head", occupied: "true" },
    ]);
    expect(source).toEqual(before);
    const doorPlan = plan(
      state("oak_door", {
        half: "upper",
        hinge: "right",
        open: "true",
        powered: "true",
      }),
    );
    expect(doorPlan.object.cells.map((cell) => cell.state.properties)).toEqual([
      {
        facing: "north",
        half: "lower",
        hinge: "right",
        open: "true",
        powered: "true",
      },
      {
        facing: "north",
        half: "upper",
        hinge: "right",
        open: "true",
        powered: "true",
      },
    ]);
    expect(doorPlan.notes.join(" ")).toContain("not simulated");
    expect(
      firstState(
        state("oak_stairs", { shape: "inner_left", waterlogged: "true" }),
      ),
    ).toMatchObject({ shape: "inner_left", waterlogged: "true" });
  });

  it("keeps exact selected design fields and applies legal yaw without context", () => {
    const source = state("oak_stairs", {
      facing: "west",
      half: "top",
      shape: "outer_right",
      waterlogged: "true",
    });
    expect(
      firstState(source, hit([0, 1, 0], pos[1], [1, 0, 0]), design),
    ).toEqual(source.properties);
    const result = plan(source, hit(), { ...design, turns: 1 });
    expect(result.object.cells[0].state.properties).toEqual({
      ...source.properties,
      facing: "north",
    });
    expect(result.notes).toEqual([]);
    expect(
      firstState(state("stone_brick_slab", { type: "double" }), hit(), design)
        .type,
    ).toBe("double");
  });

  it("preserves unsupported custom states without inferring adapters from names or tags", () => {
    const custom: Material = {
      id: "custom:oak_stairs",
      label: "Custom stairs",
      family: "stairs",
      color: "#aaa",
      defaults: { facing: "west", half: "top" },
      properties: { facing, half: ["top", "bottom"] },
      tags: ["minecraft:stairs"],
    };
    const source = defaultState(custom.id, [custom]);
    const result = planBlockPlacement(source, pos, [custom], hit(), context);
    expect(result.object.cells[0].state).toEqual(source);
    expect(result.notes.join()).toContain("No verified Context adapter");
  });

  it("keeps facing without a horizontal look and rejects invalid state, hit or yaw", () => {
    const source = state("oak_stairs", { facing: "west" });
    expect(firstState(source, hit([1, 0, 0], pos[1], [0, -1, 0])).facing).toBe(
      "west",
    );
    const verticalPlan = plan(
      source,
      hit([0, 1, 0], pos[1], [1e-16, -1, -1e-16]),
    );
    expect(verticalPlan.object.cells[0].state.properties.facing).toBe("west");
    expect(verticalPlan.notes.join()).toContain(
      "Horizontal camera direction unavailable",
    );
    expect(
      planBlockPlacement(source, pos, catalog, undefined, context).notes.join(),
    ).toContain("surface hit");
    expect(() => plan(state("oak_log", { axis: "invalid" }))).toThrow();
    expect(() => plan(source, { ...hit(), face: [1, 1, 0] })).toThrow(
      "axis-aligned",
    );
    expect(() => plan(source, { ...hit(), point: [0, NaN, 0] })).toThrow(
      "finite",
    );
    expect(() => plan(source, { ...hit(), pos: [0, 0, 0] })).toThrow(
      "requested cell",
    );
    expect(() =>
      plan(source, hit(), {
        ...design,
        turns: 4,
      } as unknown as PlacementOptions),
    ).toThrow("quarter turns");
    const unsupported: Material = {
      id: "custom:orientation",
      label: "Custom",
      family: "custom",
      color: "#fff",
      properties: { orientation: ["north_up"] },
      defaults: { orientation: "north_up" },
    };
    expect(() =>
      planBlockPlacement(
        defaultState(unsupported.id, [unsupported]),
        pos,
        [unsupported],
        undefined,
        { ...design, turns: 1 },
      ),
    ).toThrow("adapter");
  });

  it("inserts exactly the planned cells and rejects a collision in the second part atomically", () => {
    const result = plan(state("red_bed"));
    const empty = newEditorDocument(),
      inserted = insertObject(empty, result.object, catalog);
    expect(objectCells(inserted.objects[0])).toEqual(result.object.cells);
    const obstacle = createPlacedObject(
      state("stone"),
      result.object.cells[1].pos,
      catalog,
    );
    const document = { ...empty, objects: [obstacle] },
      before = structuredClone(document);
    expect(() => insertObject(document, result.object, catalog)).toThrow(
      "collision",
    );
    expect(document).toEqual(before);
  });
});

function ids(object: EditorObject): string[] {
  return [object.id, ...object.children.flatMap(ids)];
}
function component(): ComponentAsset {
  const objects = [
    createPlacedObject(
      state("red_bed", { facing: "east" }),
      [4, 2, -3],
      catalog,
    ),
    createPlacedObject(
      state("oak_door", { hinge: "right" }),
      [6, 2, -3],
      catalog,
    ),
    createPlacedObject(state("oak_log", { axis: "x" }), [7, 2, -3], catalog),
  ];
  const document = { ...newEditorDocument(), objects };
  const grouped = groupObjects(
    document,
    objects.map((object) => object.id),
    "Nested pairs",
    catalog,
  );
  return {
    ...componentFromSelection(
      grouped,
      [grouped.objects[0].id],
      "Four by two by one",
    ),
    orientation: 1,
  };
}

describe("component corner anchoring and yaw", () => {
  it.each([0, 1, 2, 3] as const)(
    "keeps complete pairs and rotates nested metadata at yaw %i",
    (turns) => {
      const asset = component(),
        before = structuredClone(asset);
      const result = planComponentPlacement(asset, [-8, 5, 9], turns, catalog);
      expect(bounds(objectCells(result))).toEqual({
        min: [-8, 5, 9],
        size: turns % 2 ? [1, 2, 4] : [4, 2, 1],
      });
      expect(result.orientation).toBe((asset.orientation + turns) % 4);
      expect(result.componentId).toBe(asset.id);
      const group = result.children[0];
      expect(group.orientation).toBe(turns);
      expect(group.children.map((child) => child.orientation)).toEqual([
        turns,
        turns,
        turns,
      ]);
      const expectedFacing = ["east", "south", "west", "north"][turns];
      expect(
        group.children[0].cells.map((cell) => cell.state.properties.facing),
      ).toEqual([expectedFacing, expectedFacing]);
      expect(group.children[2].cells[0].state.properties.axis).toBe(
        turns % 2 ? "z" : "x",
      );
      expect(
        group.children[1].cells.map((cell) => cell.state.properties.hinge),
      ).toEqual(["right", "right"]);
      expect(() =>
        validateDocument(
          { ...newEditorDocument(), objects: [result] },
          catalog,
        ),
      ).not.toThrow();
      expect(asset).toEqual(before);
      const originalIds = new Set(asset.objects.flatMap(ids));
      expect(ids(result).every((id) => !originalIds.has(id))).toBe(true);
      // Original asset/group bounds-center pivot is mixed horizontal parity (4,1).
      // It must rotate exactly rather than become the temporary anchor pivot.
      expect(result.pivot2).toEqual(turns % 2 ? [-15, 12, 22] : [-12, 12, 19]);
      expect(group.pivot2).toEqual(result.pivot2);
    },
  );

  it("makes independent instances, keeps source state immutable and rejects invalid placement", () => {
    const asset = component(),
      first = planComponentPlacement(asset, [0, 0, 0], 1, catalog),
      second = planComponentPlacement(asset, [0, 0, 0], 1, catalog);
    expect(ids(first).some((id) => new Set(ids(second)).has(id))).toBe(false);
    first.children[0].children[0].cells[0].state.properties.facing = "north";
    expect(
      second.children[0].children[0].cells[0].state.properties.facing,
    ).toBe("south");
    expect(() =>
      planComponentPlacement(asset, [0.5, 0, 0], 1, catalog),
    ).toThrow("integer");
    expect(() =>
      planComponentPlacement(asset, [0, 2048, 0], 1, catalog),
    ).toThrow();
  });
});

describe("finite standalone slab merging", () => {
  it.each(["bottom", "top"])("merges the exposed %s half surface without changing identity", (half) => {
    const target = createPlacedObject(state("stone_brick_slab", { type: half, waterlogged: "true" }), pos, catalog);
    const before = structuredClone(target);
    const surface = { ...hit([0, half === "bottom" ? 1 : -1, 0]), target: pos };
    const result = planBlockPlacement(state("stone_brick_slab"), pos, catalog, surface, context, target);
    expect(result.replaceObjectId).toBe(target.id);
    expect(result.object).toEqual({ ...target, cells: [{ ...target.cells[0], state: state("stone_brick_slab", { type: "double", waterlogged: "false" }) }] });
    expect(target).toEqual(before);
    const document = { ...newEditorDocument(), objects: [result.object] };
    expect(() => validateDocument(document, catalog)).not.toThrow();
  });

  it("preserves Design insertion and refuses unrelated, nested, double or non-half surfaces", () => {
    const target = createPlacedObject(state("stone_brick_slab"), pos, catalog);
    const surface = { ...hit(), target: pos };
    const request = (owner: EditorObject, source = state("stone_brick_slab"), clicked = surface, options = context) =>
      planBlockPlacement(source, pos, catalog, clicked, options, owner);
    expect(request(target, undefined, undefined, design).replaceObjectId).toBeUndefined();
    expect(request(target, state("oak_log")).replaceObjectId).toBeUndefined();
    expect(request({ ...target, kind: "component" }).replaceObjectId).toBeUndefined();
    expect(request({ ...target, kind: "group", cells: [], children: [target] }).replaceObjectId).toBeUndefined();
    expect(request(createPlacedObject(state("stone_brick_slab", { type: "double" }), pos, catalog)).replaceObjectId).toBeUndefined();
    expect(request(target, undefined, { ...surface, face: [1, 0, 0] }).replaceObjectId).toBeUndefined();
    expect(request(target, undefined, { ...surface, point: [pos[0], pos[1] + 1, pos[2]] }).replaceObjectId).toBeUndefined();
    expect(request(target, undefined, { ...surface, target: [0, 0, 0] }).replaceObjectId).toBeUndefined();
  });
});
