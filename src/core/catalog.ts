import type { BlockState } from "./schema";

export type Material = {
  id: string;
  label: string;
  family: string;
  color: string;
  defaults: Record<string, string>;
  properties: Record<string, string[]>;
  tags?: string[];
  creativeTabs?: string[];
  source?: "game-profile";
  hasBlockEntity?: boolean;
  gravity?: boolean;
  renderShape?: string;
  lightEmission?: number;
};
const mat = (
  name: string,
  label: string,
  family: string,
  color: string,
  properties: Record<string, string[]> = {},
  defaults: Record<string, string> = {},
): Material => ({
  id: `minecraft:${name}`,
  label,
  family,
  color,
  properties,
  defaults,
});
export const DEMO_MATERIALS: Material[] = [
  ...(["oak", "spruce", "birch", "dark_oak"] as const).flatMap((wood, n) => [
    mat(
      `${wood}_log`,
      `${wood.replaceAll("_", " ")} log`,
      "logs",
      ["#8f7045", "#5d432e", "#d7cba2", "#49301f"][n],
      { axis: ["x", "y", "z"] },
      { axis: "y" },
    ),
    mat(
      `${wood}_planks`,
      `${wood.replaceAll("_", " ")} planks`,
      "planks",
      ["#b8935c", "#765435", "#d8c58c", "#533a26"][n],
    ),
  ]),
  mat("stone", "Stone", "solid", "#929699"),
  mat("stone_bricks", "Stone bricks", "solid", "#81858a"),
  mat("cobblestone", "Cobblestone", "solid", "#737b7b"),
  mat("glass", "Glass", "glass", "#add6dc"),
  mat(
    "stone_brick_slab",
    "Stone brick slab",
    "slabs",
    "#81858a",
    { type: ["bottom", "top", "double"], waterlogged: ["false", "true"] },
    { type: "bottom", waterlogged: "false" },
  ),
  mat(
    "oak_stairs",
    "Oak stairs",
    "stairs",
    "#b8935c",
    {
      facing: ["north", "east", "south", "west"],
      half: ["bottom", "top"],
      shape: [
        "straight",
        "inner_left",
        "inner_right",
        "outer_left",
        "outer_right",
      ],
      waterlogged: ["false", "true"],
    },
    {
      facing: "north",
      half: "bottom",
      shape: "straight",
      waterlogged: "false",
    },
  ),
];
export const defaultState = (
  id: string,
  catalog = DEMO_MATERIALS,
): BlockState => ({
  name: id,
  properties: { ...catalog.find((m) => m.id === id)?.defaults },
});
export function validateState(s: BlockState, catalog: Material[]) {
  const m = catalog.find((m) => m.id === s.name);
  if (!m) throw new Error(`Chưa có registry cho ${s.name}`);
  for (const [prop, values] of Object.entries(m.properties))
    if (!values.includes(s.properties[prop]))
      throw new Error(`${s.name}: ${prop} không hợp lệ`);
  for (const prop of Object.keys(s.properties))
    if (!m.properties[prop])
      throw new Error(`${s.name}: không có thuộc tính ${prop}`);
}
/** One synchronous validation pass only. Recreate after any document/catalog
 * change; successful checks are deduplicated by content, never object identity. */
export function createStateValidator(
  catalog: Material[],
): (state: BlockState) => void {
  const materials = new Map<
    string,
    { material: Material; required: string[] }
  >();
  for (const material of catalog)
    if (!materials.has(material.id))
      materials.set(material.id, {
        material,
        required: Object.keys(material.properties),
      });
  const validated = new Set<string>();
  return (state) => {
    const entry = materials.get(state.name);
    if (!entry) throw new Error(`Chưa có registry cho ${state.name}`);
    const { material, required } = entry;
    // The document schema supplies defaults in its parsed output only. Preserve
    // the existing validator's behavior for an unnormalized original input.
    if (state.properties === undefined || state.properties === null) {
      validateState(state, [material]);
      return;
    }
    // Required values use direct lookup in validateState, including inherited
    // or non-enumerable properties that Object.entries alone would omit.
    const signature = JSON.stringify([
      state.name,
      required.length
        ? required.map((property) => state.properties[property])
        : null,
      Object.entries(state.properties).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    ]);
    if (validated.has(signature)) return;
    validateState(state, [material]);
    validated.add(signature);
  };
}
export function family(id: string): string {
  return (
    DEMO_MATERIALS.find((m) => m.id === id)?.family ??
    (/_log$|_wood$/.test(id)
      ? "logs"
      : /_planks$/.test(id)
        ? "planks"
        : /_slab$/.test(id)
          ? "slabs"
          : /_stairs$/.test(id)
            ? "stairs"
            : id)
  );
}
// Vanilla reports/blocks.json: finite properties + default state. These are not physics reports.
export function parseBlockReport(value: unknown): Material[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Cần reports/blocks.json của Minecraft 26.2");
  const entries = Object.entries(value);
  if (entries.length > 10000) throw new Error("Registry quá lớn");
  return entries.map(([id, raw]) => {
    if (
      !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id) ||
      !raw ||
      typeof raw !== "object"
    )
      throw new Error("Registry không hợp lệ");
    const r = raw as {
      properties?: Record<string, string[]>;
      states?: { default?: boolean; properties?: Record<string, string> }[];
    };
    if (!Array.isArray(r.states) || r.states.length === 0)
      throw new Error(`Thiếu states: ${id}`);
    const properties = r.properties ?? {};
    for (const values of Object.values(properties))
      if (!Array.isArray(values) || values.some((v) => typeof v !== "string"))
        throw new Error(`Sai properties: ${id}`);
    const defaults =
      r.states.find((s) => s.default)?.properties ??
      r.states[0].properties ??
      {};
    const material = {
      id,
      label: id.split(":")[1].replaceAll("_", " "),
      family: family(id),
      color: "#a18bad",
      defaults,
      properties,
    };
    validateState({ name: id, properties: defaults }, [material]);
    return material;
  });
}
