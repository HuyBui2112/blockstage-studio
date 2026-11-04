import { describe, expect, it } from "vitest";
import {
  createStateValidator,
  defaultState,
  DEMO_MATERIALS,
  validateState,
  type Material,
} from "../core/catalog";
import type { BlockState, Vec3 } from "../core/schema";
import {
  editorDocumentSchema,
  newEditorDocument,
  objectCells,
  validateDocument,
  type EditorDocument,
  type EditorObject,
} from "./model";
import { createPlacedObject, validateLogicalObject } from "./placement";

const material = (
  id: string,
  properties: Record<string, string[]>,
  defaults: Record<string, string>,
): Material => ({
  id: `minecraft:${id}`,
  label: id,
  family: id,
  color: "#aaa",
  properties,
  defaults,
});
const facing = ["north", "east", "south", "west"];
const catalog = [
  ...DEMO_MATERIALS,
  material(
    "red_bed",
    { facing, part: ["foot", "head"], occupied: ["false", "true"] },
    { facing: "north", part: "foot", occupied: "false" },
  ),
  material(
    "oak_door",
    {
      facing,
      half: ["lower", "upper"],
      hinge: ["left", "right"],
      open: ["false", "true"],
    },
    { facing: "north", half: "lower", hinge: "left", open: "false" },
  ),
  ...["sunflower", "tall_seagrass"].map((id) =>
    material(id, { half: ["lower", "upper"] }, { half: "lower" }),
  ),
  material(
    "small_dripleaf",
    { facing, half: ["lower", "upper"], waterlogged: ["false", "true"] },
    { facing: "north", half: "lower", waterlogged: "false" },
  ),
  material(
    "pitcher_crop",
    { age: ["0", "1", "2", "3", "4"], half: ["lower", "upper"] },
    { age: "0", half: "lower" },
  ),
];
const placed = (
  id: string,
  name = "minecraft:stone",
  pos: Vec3 = [0, 0, 0],
  properties: Record<string, string> = {},
) =>
  createPlacedObject(
    {
      ...defaultState(name, catalog),
      properties: { ...defaultState(name, catalog).properties, ...properties },
    },
    pos,
    catalog,
    undefined,
    id,
  );
const document = (...objects: EditorObject[]): EditorDocument => ({
  ...newEditorDocument(),
  objects,
});
const group = (...children: EditorObject[]): EditorObject => ({
  id: "group",
  name: "Group",
  kind: "group",
  cells: [],
  children,
  pivot2: [1, 1, 1],
  orientation: 0,
});

// Reference composition before the optimization: retain the full schema and
// public strict logical validator, including their original error ordering.
function legacyValidateDocument(
  value: EditorDocument,
  materials: Material[],
): void {
  const parsed = editorDocumentSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid editor document",
    );
  for (const root of value.objects) {
    for (const cell of objectCells(root)) validateState(cell.state, materials);
    validateLogicalObject(root, materials);
  }
}
function outcome(check: () => void): string | null {
  try {
    check();
    return null;
  } catch (error) {
    return error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
  }
}
function expectParity(value: EditorDocument, materials = catalog): void {
  expect(outcome(() => validateDocument(value, materials))).toBe(
    outcome(() => legacyValidateDocument(value, materials)),
  );
}

describe("per-call registry validation parity", () => {
  it("keeps the first catalogue match and the reference missing/illegal-state errors", () => {
    const first = material("test", { axis: ["x"] }, { axis: "x" });
    const second = material("test", { axis: ["y"] }, { axis: "y" });
    for (const materials of [
      [first, second],
      [second, first],
    ]) {
      const validate = createStateValidator(materials);
      for (const state of [
        { name: first.id, properties: { axis: "x" } },
        { name: first.id, properties: { axis: "y" } },
        { name: first.id, properties: {} },
        { name: first.id, properties: { axis: "x", extra: "true" } },
        { name: "minecraft:missing", properties: undefined },
        { name: first.id, properties: undefined },
      ] as BlockState[])
        expect(outcome(() => validate(state))).toBe(
          outcome(() => validateState(state, materials)),
        );
    }
  });

  it("uses state content even when the same object is mutated within a pass", () => {
    const validate = createStateValidator(catalog);
    const state = defaultState("minecraft:oak_log", catalog);
    validate(state);
    state.properties.axis = "q";
    expect(outcome(() => validate(state))).toBe(
      outcome(() => validateState(state, catalog)),
    );
    state.properties.axis = "x";
    validate(state);
    state.properties.extra = "true";
    expect(outcome(() => validate(state))).toBe(
      outcome(() => validateState(state, catalog)),
    );
    const stairs = defaultState("minecraft:oak_stairs", catalog);
    validate(stairs);
    validate({
      name: stairs.name,
      properties: Object.fromEntries(
        Object.entries(stairs.properties).reverse(),
      ),
    });
  });

  it("does not deduplicate different inherited or non-enumerable required values", () => {
    const validate = createStateValidator(catalog);
    for (const axis of ["x", "q"]) {
      const inherited = {
        name: "minecraft:oak_log",
        properties: Object.create({ axis }) as Record<string, string>,
      };
      expect(outcome(() => validate(inherited))).toBe(
        outcome(() => validateState(inherited, catalog)),
      );
      const hidden = {
        name: "minecraft:oak_log",
        properties: Object.defineProperty({}, "axis", {
          value: axis,
        }) as Record<string, string>,
      };
      expect(outcome(() => validate(hidden))).toBe(
        outcome(() => validateState(hidden, catalog)),
      );
    }
    const valid = placed("valid", "minecraft:oak_log"),
      invalid = placed("invalid", "minecraft:oak_log", [2, 0, 0]);
    valid.cells[0].state.properties = Object.create({ axis: "x" }) as Record<
      string,
      string
    >;
    invalid.cells[0].state.properties = Object.create({ axis: "q" }) as Record<
      string,
      string
    >;
    expectParity(document(valid, invalid));
  });

  it("rechecks mutable document, state, and catalogue inputs on every document call", () => {
    const materials = structuredClone(catalog);
    const value = document(placed("log", "minecraft:oak_log"));
    validateDocument(value, materials);
    value.objects[0].cells[0].state.properties.axis = "invalid";
    expectParity(value, materials);
    value.objects[0].cells[0].state.properties.axis = "x";
    validateDocument(value, materials);
    materials.find(
      (entry) => entry.id === "minecraft:oak_log",
    )!.properties.axis = ["y"];
    expectParity(value, materials);
    materials.splice(
      materials.findIndex((entry) => entry.id === "minecraft:oak_log"),
      1,
    );
    expectParity(value, materials);
  });
});

describe("document schema and logical-footprint composition parity", () => {
  it.each([
    "red_bed",
    "oak_door",
    "sunflower",
    "tall_seagrass",
    "small_dripleaf",
    "pitcher_crop",
  ])("preserves complete and broken %s footprints", (id) => {
    const root = placed(
      "pair",
      `minecraft:${id}`,
      [0, 0, 0],
      id === "pitcher_crop" ? { age: "3" } : {},
    );
    const value = document(root),
      before = structuredClone(value);
    expectParity(value);
    expect(value).toEqual(before);
    const incomplete = structuredClone(root);
    incomplete.kind = "block";
    incomplete.cells.pop();
    expectParity(document(incomplete));
    const mismatch = structuredClone(root);
    if ("facing" in mismatch.cells[1].state.properties)
      mismatch.cells[1].state.properties.facing = "east";
    else if (id === "pitcher_crop")
      mismatch.cells[1].state.properties.age = "4";
    else mismatch.cells[1].state.name = "minecraft:stone";
    expectParity(document(mismatch));
  });

  it("retains young-pitcher rules and independent dripleaf waterlogging", () => {
    const young = placed("young", "minecraft:pitcher_crop", [0, 0, 0], {
      age: "2",
    });
    expectParity(document(young));
    young.cells[0].state.properties.half = "upper";
    expectParity(document(young));
    const dripleaf = placed("dripleaf", "minecraft:small_dripleaf");
    dripleaf.cells[0].state.properties.waterlogged = "true";
    expectParity(document(dripleaf));
    expect(() => validateDocument(document(dripleaf), catalog)).not.toThrow();
  });

  it("preserves state-before-pair ordering within roots and pair-before-state ordering across roots", () => {
    const incomplete = placed("pair", "minecraft:red_bed");
    incomplete.kind = "block";
    incomplete.cells.pop();
    const illegal = placed("illegal", "minecraft:oak_log", [10, 0, 0]);
    illegal.cells[0].state.properties.axis = "invalid";
    expectParity(document(incomplete, illegal));
    expect(
      outcome(() => validateDocument(document(incomplete, illegal), catalog)),
    ).toMatch(/Incomplete logical pair/);
    expectParity(document(group(incomplete, illegal)));
    expect(
      outcome(() =>
        validateDocument(document(group(incomplete, illegal)), catalog),
      ),
    ).toMatch(/axis/);
  });

  it("retains schema errors, bounds, global uniqueness, and unnormalized defaults", () => {
    const cases: EditorDocument[] = [];
    const altered = (change: (value: EditorDocument) => void) => {
      const value = document(placed("a"));
      change(value);
      cases.push(value);
    };
    altered((value) => {
      Object.assign(value.objects[0], { unexpected: "payload" });
    });
    altered((value) => {
      value.objects[0].cells[0].pos[0] = 0.5;
    });
    altered((value) => {
      value.objects[0].cells[0].pos[1] = 2049;
    });
    altered((value) => {
      value.objects[0].cells[0].state.name = "minecraft:missing";
    });
    altered((value) => {
      value.objects[0].cells[0].state.properties.unknown = "true";
    });
    altered((value) => {
      Reflect.deleteProperty(value.objects[0].cells[0].state, "properties");
    });
    altered((value) => {
      value.objects.push(placed("a", "minecraft:stone", [2, 0, 0]));
    });
    altered((value) => {
      value.objects.push(placed("b"));
    });
    altered((value) => {
      value.objects[0].name = "  Trimmed label  ";
      value.entities = [
        {
          id: "pig",
          type: "minecraft:pig",
          position: [0, 0, 0],
        } as EditorDocument["entities"][number],
      ];
    });
    altered((value) => {
      value.entities = [
        { id: "pig", type: "minecraft:pig", position: [0, 0, 0], yaw: 0 },
        { id: "pig", type: "minecraft:pig", position: [2, 0, 0], yaw: 0 },
      ];
    });
    for (const value of cases) expectParity(value);
    const unnormalized = cases.at(-2)!,
      before = structuredClone(unnormalized);
    validateDocument(unnormalized, catalog);
    expect(unnormalized).toEqual(before);
  });

  it("rejects cycles, excessive depth, object limits, and aggregate cell limits before footprint traversal", () => {
    const cycle = group();
    cycle.children.push(cycle);
    expectParity(document(cycle));
    let deep = placed("leaf");
    for (let depth = 0; depth < 16; depth++)
      deep = { ...group(deep), id: `depth-${depth}` };
    expectParity(document(deep));
    const root = placed("root");
    expectParity({
      ...newEditorDocument(),
      objects: Array.from({ length: 100001 }, () => root),
    });
    const huge = {
      ...root,
      kind: "component" as const,
      cells: Array.from({ length: 100001 }, () => root.cells[0]),
    };
    expectParity(document(huge));
  });

  it("keeps standalone logical validation strict and ordered", () => {
    const fractional = placed("fractional");
    fractional.cells[0].pos[0] = 0.5;
    expect(() => validateLogicalObject(fractional, catalog)).toThrow();
    const unknown = placed("unknown");
    Object.assign(unknown.cells[0], { payload: "unsupported" });
    expect(() => validateLogicalObject(unknown, catalog)).toThrow();
    const illegal = placed("illegal", "minecraft:oak_log");
    illegal.cells[0].state.properties.axis = "q";
    expect(() => validateLogicalObject(group(illegal), catalog)).toThrow(
      /axis/,
    );
    const incomplete = placed("incomplete", "minecraft:red_bed");
    incomplete.kind = "component";
    incomplete.cells.pop();
    incomplete.children.push(fractional);
    expect(() => validateLogicalObject(incomplete, catalog)).toThrow(
      /Incomplete logical pair/,
    );
  });
});
