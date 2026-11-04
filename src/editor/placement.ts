import { validateState, type Material } from "../core/catalog";
import {
  blockSchema,
  key,
  type Block,
  type BlockState,
  type Vec3,
} from "../core/schema";
import type { EditorObject } from "./model";

// Verified against BedBlock/DoorBlock/DoublePlantBlock subclasses in the 26.2
// client by scripts/java/EditorOracle.java. Tags and suffixes are not adapters.
const colors =
  "white orange magenta light_blue yellow lime pink gray light_gray cyan purple blue brown green red black".split(
    " ",
  );
const woods =
  "oak spruce birch jungle acacia cherry dark_oak pale_oak mangrove bamboo crimson warped".split(
    " ",
  );
const beds = new Set(colors.map((color) => `minecraft:${color}_bed`));
const doors = new Set(
  [
    ...woods.map((wood) => `${wood}_door`),
    "iron_door",
    "copper_door",
    "exposed_copper_door",
    "weathered_copper_door",
    "oxidized_copper_door",
    "waxed_copper_door",
    "waxed_exposed_copper_door",
    "waxed_weathered_copper_door",
    "waxed_oxidized_copper_door",
  ].map((id) => `minecraft:${id}`),
);
const plants = new Set(
  "tall_seagrass sunflower lilac rose_bush peony tall_grass large_fern pitcher_plant small_dripleaf"
    .split(" ")
    .map((id) => `minecraft:${id}`),
);
export const isBedBlock = (id: string): boolean => beds.has(id);
export const isDoorBlock = (id: string): boolean => doors.has(id);
const directions: Record<string, Vec3> = {
  north: [0, 0, -1],
  east: [1, 0, 0],
  south: [0, 0, 1],
  west: [-1, 0, 0],
};
type Pair = {
  property: "part" | "half";
  first: string;
  second: string;
  offset: Vec3;
};
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
// SmallDripleafBlock copies waterlogging from each cell's own fluid. It is not
// a shared orientation/state invariant of the two halves.
const sharedProperty = (state: BlockState, adapter: Pair, property: string) =>
  property !== adapter.property &&
  !(state.name === "minecraft:small_dripleaf" && property === "waterlogged");

function pair(state: BlockState): Pair | undefined {
  if (beds.has(state.name)) {
    const offset = directions[state.properties.facing];
    if (!offset) throw new Error("Bed requires a horizontal facing");
    return { property: "part", first: "foot", second: "head", offset };
  }
  if (
    doors.has(state.name) ||
    plants.has(state.name) ||
    (state.name === "minecraft:pitcher_crop" &&
      Number(state.properties.age) >= 3)
  )
    return {
      property: "half",
      first: "lower",
      second: "upper",
      offset: [0, 1, 0],
    };
  return undefined;
}

function cellsFor(state: BlockState, position: Vec3): Block[] {
  const adapter = pair(state);
  const make = (pos: Vec3, properties: Record<string, string>): Block => ({
    pos: [...pos],
    state: { name: state.name, properties: { ...properties } },
  });
  if (adapter)
    return [
      make(position, {
        ...state.properties,
        [adapter.property]: adapter.first,
      }),
      make(add(position, adapter.offset), {
        ...state.properties,
        [adapter.property]: adapter.second,
      }),
    ];
  if (state.name === "minecraft:pitcher_crop")
    return [make(position, { ...state.properties, half: "lower" })];
  if (
    ["head", "foot"].includes(state.properties.part) ||
    ["lower", "upper"].includes(state.properties.half)
  )
    throw new Error(`No verified logical placement adapter for ${state.name}`);
  return [make(position, state.properties)];
}

/** Design placement: the requested cell anchors the foot/lower cell, even if the
 * palette selected head/upper. Does not simulate support, hinges or neighbors. */
export function createPlacedObject(
  state: BlockState,
  pos: Vec3,
  catalog: Material[],
  _hit?: { face?: Vec3; point?: [number, number, number] },
  id: string = crypto.randomUUID(),
): EditorObject {
  validateState(state, catalog);
  const cells = cellsFor(state, pos);
  const object: EditorObject = {
    id,
    name: state.name.slice(state.name.indexOf(":") + 1).replaceAll("_", " "),
    kind: cells.length > 1 ? "multiblock" : "block",
    cells,
    children: [],
    pivot2: [2 * pos[0] + 1, 2 * pos[1] + 1, 2 * pos[2] + 1],
    orientation: 0,
  };
  validateLogicalObject(object, catalog);
  return object;
}

/** Explicit legacy conversion only: reconstruct pairs without changing states.
 * Orphans and mismatched halves are rejected, never repaired or dropped. */
export function logicalCellGroups(cells: Block[]): Block[][] {
  const occupied = new Map(cells.map((cell) => [key(cell.pos), cell]));
  if (occupied.size !== cells.length)
    throw new Error("Duplicate logical cells");
  const consumed = new Set<string>(),
    groups: Block[][] = [];
  for (const cell of cells) {
    if (consumed.has(key(cell.pos))) continue;
    const adapter = pair(cell.state);
    if (!adapter) {
      groups.push([structuredClone(cell)]);
      consumed.add(key(cell.pos));
      continue;
    }
    const value = cell.state.properties[adapter.property];
    if (value !== adapter.first && value !== adapter.second)
      throw new Error("Logical part is not legal");
    const firstPos =
      value === adapter.first
        ? cell.pos
        : add(cell.pos, adapter.offset.map((n) => -n) as Vec3);
    const first = occupied.get(key(firstPos)),
      second = occupied.get(key(add(firstPos, adapter.offset)));
    if (
      !first ||
      !second ||
      first.state.name !== cell.state.name ||
      second.state.name !== cell.state.name ||
      first.state.properties[adapter.property] !== adapter.first ||
      second.state.properties[adapter.property] !== adapter.second
    )
      throw new Error(`Incomplete logical pair: ${cell.state.name}`);
    for (const [property, v] of Object.entries(first.state.properties))
      if (
        sharedProperty(first.state, adapter, property) &&
        second.state.properties[property] !== v
      )
        throw new Error(`Mismatched logical pair property: ${property}`);
    groups.push(structuredClone([first, second]));
    consumed.add(key(first.pos));
    consumed.add(key(second.pos));
  }
  return groups;
}

/** Validate paired footprints in any leaf, including copied component cells. */
export function validateLogicalObject(
  object: EditorObject,
  catalog: Material[],
): void {
  visitLogicalFootprints(object, (cell) => {
    blockSchema.parse(cell);
    validateState(cell.state, catalog);
  });
}

/** Internal document-validation composition: the complete document schema and
 * every cell's registry state must already have passed in this same call.
 * Standalone callers must use validateLogicalObject instead. */
export function validateLogicalFootprints(object: EditorObject): void {
  visitLogicalFootprints(object);
}

function visitLogicalFootprints(
  object: EditorObject,
  validateCell?: (cell: Block) => void,
): void {
  const occupied = new Map<string, Block>();
  for (const cell of object.cells) {
    validateCell?.(cell);
    if (occupied.has(key(cell.pos)))
      throw new Error(`Duplicate logical cell at ${key(cell.pos)}`);
    occupied.set(key(cell.pos), cell);
  }
  for (const cell of object.cells) {
    const adapter = pair(cell.state);
    if (!adapter) {
      if (
        cell.state.name === "minecraft:pitcher_crop" &&
        cell.state.properties.half !== "lower"
      )
        throw new Error("Young pitcher crop must use the lower half");
      if (object.kind === "multiblock")
        throw new Error("Multiblock requires a verified pair");
      continue;
    }
    const value = cell.state.properties[adapter.property];
    if (value !== adapter.first && value !== adapter.second)
      throw new Error("Logical part is not legal");
    const first = value === adapter.first;
    const neighbor = occupied.get(
      key(add(cell.pos, adapter.offset.map((n) => (first ? n : -n)) as Vec3)),
    );
    if (
      !neighbor ||
      neighbor.state.name !== cell.state.name ||
      neighbor.state.properties[adapter.property] !==
        (first ? adapter.second : adapter.first)
    )
      throw new Error(`Incomplete logical pair: ${cell.state.name}`);
    for (const [property, v] of Object.entries(cell.state.properties))
      if (
        sharedProperty(cell.state, adapter, property) &&
        neighbor.state.properties[property] !== v
      )
        throw new Error(`Mismatched logical pair property: ${property}`);
  }
  if (object.kind === "multiblock" && object.cells.length !== 2)
    throw new Error("Multiblock must contain exactly two cells");
  for (const child of object.children)
    visitLogicalFootprints(child, validateCell);
}

/** State changes are immutable and synchronized. Bed facing keeps the foot
 * anchored and rebuilds its head; the command layer checks document collisions. */
export function isStructuralStateProperty(
  state: BlockState,
  property: string,
): boolean {
  return (
    (property === "part" || property === "half") &&
    !!(pair(state) || state.name === "minecraft:pitcher_crop")
  );
}

export function rewriteLogicalState(
  object: EditorObject,
  property: string,
  value: string,
  catalog: Material[],
): EditorObject {
  validateLogicalObject(object, catalog);
  if (
    object.cells.some((cell) => isStructuralStateProperty(cell.state, property))
  )
    throw new Error(
      "Edit the whole logical object; part/half cannot be changed separately",
    );
  const consumed = new Set<string>(),
    cells: Block[] = [],
    originalCells = new Map(object.cells.map((cell) => [key(cell.pos), cell]));
  for (const cell of object.cells) {
    if (consumed.has(key(cell.pos))) continue;
    const adapter = pair(cell.state);
    if (adapter) {
      const first = cell.state.properties[adapter.property] === adapter.first;
      const anchor = first
        ? cell.pos
        : add(cell.pos, adapter.offset.map((n) => -n) as Vec3);
      consumed.add(key(anchor));
      consumed.add(key(add(anchor, adapter.offset)));
      const originalFirst = originalCells.get(key(anchor))!;
      const originalSecond = originalCells.get(
        key(add(anchor, adapter.offset)),
      )!;
      const state = {
        name: cell.state.name,
        properties: { ...originalFirst.state.properties, [property]: value },
      };
      validateState(state, catalog);
      const rebuilt = cellsFor(state, anchor);
      if (rebuilt.length === 2)
        rebuilt[1].state.properties = {
          ...originalSecond.state.properties,
          [property]: value,
          [adapter.property]: adapter.second,
        };
      cells.push(...rebuilt);
    } else {
      const state = {
        name: cell.state.name,
        properties: { ...cell.state.properties, [property]: value },
      };
      validateState(state, catalog);
      cells.push(...cellsFor(state, cell.pos));
    }
  }
  const result: EditorObject = {
    ...object,
    kind:
      object.kind === "block" || object.kind === "multiblock"
        ? cells.length > 1
          ? "multiblock"
          : "block"
        : object.kind,
    cells,
    children: object.children.map((child) =>
      rewriteLogicalState(child, property, value, catalog),
    ),
  };
  validateLogicalObject(result, catalog);
  return result;
}
