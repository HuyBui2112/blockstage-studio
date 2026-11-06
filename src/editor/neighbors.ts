import { blockAdapter } from "../core/adapter-registry";
import type { NeighborRule, NeighborRules } from "../core/profile";
import {
  key,
  stateKey,
  type BlockState,
  type SceneBlock,
  type Vec3,
} from "../core/schema";
import {
  objectCells,
  sceneBlocks,
  type EditorDocument,
  type EditorObject,
} from "./model";

const directions = ["north", "east", "south", "west"] as const;
const offsets: Vec3[] = [
  [0, 0, -1],
  [1, 0, 0],
  [0, 0, 1],
  [-1, 0, 0],
];
const air: BlockState = { name: "minecraft:air", properties: {} };
const isNeighborStair = (id: string) => blockAdapter(id)?.neighbors === "stairs";
function stairShape(
  state: BlockState,
  at: (offset: Vec3) => BlockState,
  rules: NeighborRules,
): BlockState {
  const facing = directions.indexOf(state.properties.facing as typeof directions[number]);
  if (facing < 0 || !["top", "bottom"].includes(state.properties.half))
    throw new Error("Unsupported stair facing/half");
  const read = (i: number) => {
    const other = at(offsets[i]);
    if (!rules[other.name]) throw new Error(`No neighbor predicates for ${other.name}`);
    if (!isNeighborStair(other.name) && "shape" in other.properties && "half" in other.properties)
      throw new Error(`Unsupported stair neighbor: ${other.name}`);
    if (isNeighborStair(other.name) &&
        (!directions.includes(other.properties.facing as typeof directions[number]) ||
         !["top", "bottom"].includes(other.properties.half)))
      throw new Error(`Unsupported stair facing/half: ${other.name}`);
    return other;
  };
  const matches = (other: BlockState) => isNeighborStair(other.name) &&
    other.properties.half === state.properties.half;
  const canTakeShape = (i: number) => {
    const other = read(i);
    return !(matches(other) && other.properties.facing === state.properties.facing);
  };
  let shape = "straight";
  for (const outer of [true, false]) {
    const other = read(outer ? facing : (facing + 2) % 4);
    if (!matches(other)) continue;
    const direction = directions.indexOf(other.properties.facing as typeof directions[number]);
    if (direction % 2 === facing % 2 ||
        !canTakeShape((direction + (outer ? 2 : 0)) % 4)) continue;
    shape = `${outer ? "outer" : "inner"}_${direction === (facing + 3) % 4 ? "left" : "right"}`;
    break;
  }
  return { ...state, properties: { ...state.properties, shape } };
}
const neighbors = (pos: Vec3) => [
  pos,
  ...offsets.map((d) => pos.map((v, i) => v + d[i]) as Vec3),
  [pos[0], pos[1] - 1, pos[2]] as Vec3,
];
function shape(
  state: BlockState,
  rule: NeighborRule,
): [number, number] | undefined {
  const signature = rule.properties
    .map((property) => `${property}=${state.properties[property]}`)
    .join(",");
  return rule.shapes[signature];
}
function derived(
  state: BlockState,
  at: (offset: Vec3) => BlockState,
  rules: NeighborRules,
): BlockState {
  if (isNeighborStair(state.name)) return stairShape(state, at, rules);
  const own = rules[state.name];
  if (!own || !["fence", "wall", "gate"].includes(own.kind)) return state;
  const properties = { ...state.properties };
  const read = (other: BlockState) => {
    const rule = rules[other.name];
    if (!rule) throw new Error(`No neighbor predicates for ${other.name}`);
    return rule;
  };
  if (own.kind === "gate") {
    const indices = ["north", "south"].includes(properties.facing)
      ? [1, 3]
      : [0, 2];
    properties.in_wall = String(indices.some((i) => read(at(offsets[i])).wall));
  } else {
    for (let i = 0; i < 4; i++) {
      const other = at(offsets[i]),
        rule = read(other);
      const gate =
        rule.kind === "gate" &&
        ["east", "west"].includes(other.properties.facing) !== (i % 2 === 1);
      let connects =
        own.kind === "fence"
          ? rule.fence && rule.wooden === own.wooden
          : rule.wall || rule.kind === "pane";
      connects ||= gate;
      if (!connects && !rule.exception) {
        const masks = shape(other, rule);
        if (!masks)
          throw new Error(`Dynamic/unavailable neighbor shape: ${other.name}`);
        connects = !!(masks[0] & (1 << ((i + 2) % 4)));
      }
      properties[directions[i]] = String(connects);
    }
    if (own.kind === "wall") {
      const above = at([0, 1, 0]),
        rule = read(above),
        masks = shape(above, rule);
      if (!masks)
        throw new Error(`Dynamic/unavailable wall cover: ${above.name}`);
      for (let i = 0; i < 4; i++)
        properties[directions[i]] =
          properties[directions[i]] === "true"
            ? masks[1] & (1 << i)
              ? "tall"
              : "low"
            : "none";
      const [n, e, s, w] = directions.map((d) => properties[d]);
      const asymmetric =
        (n === "none") !== (s === "none") || (e === "none") !== (w === "none");
      const empty = [n, e, s, w].every((v) => v === "none");
      const tall =
        (n === "tall" && s === "tall") || (e === "tall" && w === "tall");
      properties.up = String(
        (rule.kind === "wall" && above.properties.up === "true") ||
          empty ||
          asymmetric ||
          (!tall && (rule.forcePost || !!(masks[1] & 16))),
      );
    }
  }
  return { ...state, properties };
}

export type NeighborPlan = {
  document: EditorDocument;
  changed: SceneBlock[];
  notes: string[];
};
const indexes = new WeakMap<
  EditorDocument,
  { roots: Map<string, EditorObject>; cells: Map<string, SceneBlock> }
>();
function index(document: EditorDocument) {
  let cached = indexes.get(document);
  if (!cached) {
    cached = {
      roots: new Map(document.objects.map((object) => [object.id, object])),
      cells: new Map(
        sceneBlocks(document).map((block) => [key(block.pos), block]),
      ),
    };
    indexes.set(document, cached);
  }
  return cached;
}
/** Opt-in scene policy: absent cells are empty design space, not a claim about
 * an export destination. Recompute changed cells, side neighbors and dependents
 * below; never tick fluids/redstone/support or rewrite unrelated custom states.
 */
export function planNeighborConnections(
  before: EditorDocument,
  next: EditorDocument,
  rules: NeighborRules,
): NeighborPlan {
  if (before.objects === next.objects)
    return { document: next, changed: [], notes: [] };
  const cached = index(before),
    old = cached.cells;
  // Overlay only changed roots. Pointer previews reuse the immutable source
  // index instead of flattening and hashing every unchanged cell on each hit.
  const current = new Map<string, SceneBlock | undefined>(),
    ids = new Set(next.objects.map((object) => object.id));
  for (const object of before.objects)
    if (!ids.has(object.id))
      for (const cell of objectCells(object))
        current.set(key(cell.pos), undefined);
  const altered = next.objects.filter(
    (object) => cached.roots.get(object.id) !== object,
  );
  for (const object of altered) {
    const previous = cached.roots.get(object.id);
    if (previous)
      for (const cell of objectCells(previous))
        current.set(key(cell.pos), undefined);
  }
  for (const object of altered)
    for (const cell of objectCells(object))
      current.set(key(cell.pos), { ...cell, owner: object.id });
  const lookup = (id: string) =>
    current.has(id) ? current.get(id) : old.get(id);
  const queue: Vec3[] = [],
    queued = new Set<string>(),
    changed = new Map<string, SceneBlock>(),
    notes = new Set<string>();
  const enqueue = (pos: Vec3) => {
    const id = key(pos);
    if (!queued.has(id)) {
      queued.add(id);
      queue.push(pos);
    }
  };
  for (const id of current.keys()) {
    const a = old.get(id),
      b = lookup(id);
    if (!a || !b || stateKey(a.state) !== stateKey(b.state))
      for (const pos of neighbors((b ?? a)!.pos)) enqueue(pos);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (cursor > 2_000_000)
      throw new Error(
        "Neighbor update work limit exceeded; the edit was not committed",
      );
    const pos = queue[cursor],
      id = key(pos);
    queued.delete(id);
    const block = lookup(id);
    if (
      !block ||
      (!isNeighborStair(block.state.name) &&
       !["fence", "wall", "gate"].includes(rules[block.state.name]?.kind))
    )
      continue;
    try {
      const state = derived(
        block.state,
        (offset) =>
          lookup(key(pos.map((v, i) => v + offset[i]) as Vec3))?.state ?? air,
        rules,
      );
      if (stateKey(state) === stateKey(block.state)) continue;
      const updated = { ...block, state };
      current.set(id, updated);
      changed.set(id, updated);
      for (const neighbor of neighbors(pos)) enqueue(neighbor);
    } catch (error) {
      if (notes.size < 20)
        notes.add(
          `${block.state.name} at ${id}: ${error instanceof Error ? error.message : String(error)}; explicit connections preserved.`,
        );
    }
  }
  if (!changed.size) return { document: next, changed: [], notes: [...notes] };
  const touched = new Set([...changed.values()].map((block) => block.owner));
  const rewrite = (object: EditorObject): EditorObject => {
    const cells = object.cells.map((cell) =>
      changed.get(key(cell.pos))
        ? { ...cell, state: changed.get(key(cell.pos))!.state }
        : cell,
    );
    const children = object.children.map(rewrite);
    return cells.some((cell, i) => cell !== object.cells[i]) ||
      children.some((child, i) => child !== object.children[i])
      ? { ...object, cells, children }
      : object;
  };
  return {
    document: {
      ...next,
      objects: next.objects.map((object) =>
        touched.has(object.id) ? rewrite(object) : object,
      ),
    },
    changed: [...changed.values()],
    notes: [...notes],
  };
}
