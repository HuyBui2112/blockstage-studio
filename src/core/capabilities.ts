import { DEMO_MATERIALS, validateState, type Material } from "./catalog";
import { blockEntitySchema, type Block, type BlockState } from "./schema";
import type { GameProfile } from "./profile";
import { mirrorStateCapability, type MirrorPlane } from "./mirror";
import {
  GAME_TARGET,
  blockAdapter,
  entityAdapter,
  isSupportedTarget,
  WOOD_TYPES,
  DYE_COLORS,
} from "./adapter-registry";

export type CapabilityAction =
  | "registry" | "appearance" | "design" | "context"
  | "translate" | "yaw" | "mirror" | "copy" | "remove" | "replace"
  | "neighbors" | "support"
  | "payload-preserve" | "payload-edit" | "payload-copy" | "payload-transform"
  | "structure-import" | "structure-export" | "datapack-export" | "world";
export type CapabilityTarget = Readonly<{ gameVersion: string; dataVersion: number }>;
export type CapabilityDecision = Readonly<{
  action: CapabilityAction;
  supported: boolean;
  status: "supported" | "partial" | "unsupported" | "unverified";
  adapterId: string;
  target: CapabilityTarget;
  reason: string;
  evidence: readonly string[];
  requiredContext: readonly string[];
  derivedProperties?: readonly string[];
  preservedProperties?: readonly string[];
}>;
type DecisionOptions = {
  target?: CapabilityTarget;
  evidence?: readonly string[];
  requiredContext?: readonly string[];
  derivedProperties?: readonly string[];
  preservedProperties?: readonly string[];
};

/** Adapter declarations describe code coverage, never proof of a destination world. */
export function capabilityDecision(
  action: CapabilityAction,
  adapterId: string,
  status: CapabilityDecision["status"],
  reason: string,
  options: DecisionOptions = {},
): CapabilityDecision {
  return {
    action, adapterId, status,
    supported: status === "supported" || status === "partial",
    target: { ...(options.target ?? GAME_TARGET) },
    reason,
    evidence: [...new Set([...(options.evidence ?? ["editor-contract:capabilities-v1"]), "world-readback:unverified"])],
    requiredContext: [...(options.requiredContext ?? [])],
    ...(options.derivedProperties ? { derivedProperties: [...options.derivedProperties] } : {}),
    ...(options.preservedProperties ? { preservedProperties: [...options.preservedProperties] } : {}),
  };
}

type CapabilityProfile = Pick<GameProfile, "entities" | "neighborRules">;
type ResolverOptions = { target?: CapabilityTarget; profile?: CapabilityProfile | null };
type BlockOptions = {
  mirrorPlane?: MirrorPlane;
  payload?: Block["blockEntity"];
  appearance?: CapabilityDecision;
};
const demoRegistry = new Map(DEMO_MATERIALS.map((material) => [material.id, material]));
const contextProperties = {
  pillar: ["axis"], chain: ["axis"], lantern: ["hanging"], slab: ["type"],
  stairs: ["half", "facing"], bed: ["facing"], door: ["facing"],
} as const;

/** Shared with actual yaw operations. This is a string-state adapter, not a mesh rotation. */
export function blockYawError(state: BlockState): string | undefined {
  for (const [property, value] of Object.entries(state.properties)) {
    if (property === "orientation")
      return "This block needs a specialized rotation adapter";
    if (
      ["north", "east", "south", "west", "x", "y", "z"].includes(value) &&
      !["facing", "axis", "north", "east", "south", "west"].includes(property)
    ) return `Rotation adapter does not support ${property}`;
    if (property === "rotation" && !/^(?:[0-9]|1[0-5])$/.test(value))
      return "Rotation adapter requires a 16-step block rotation";
  }
}

/** Resolve against one indexed material. Resources cannot grant game semantics. */
export function resolveBlockCapability(
  state: BlockState,
  action: CapabilityAction,
  material: Material | undefined,
  options: BlockOptions & ResolverOptions = {},
): CapabilityDecision {
  const target = options.target ?? GAME_TARGET;
  const adapter = blockAdapter(state.name);
  const result = (
    status: CapabilityDecision["status"], reason: string,
    adapterId = "blockstage:cell-v1", extra: DecisionOptions = {},
  ) => capabilityDecision(action, adapterId, status, reason, {
    target, evidence: adapter?.provenance, ...extra,
  });
  if (!isSupportedTarget(target))
    return result("unsupported", "Capabilities require Minecraft Java 26.2 / DataVersion 4903", "blockstage:target-v1");
  if (action === "world")
    return result("unverified", "Destination world behavior is unverified for this state and runtime", "blockstage:world-unverified");
  if (action === "appearance")
    return options.appearance?.action === "appearance" &&
      isSupportedTarget(options.appearance.target)
      ? options.appearance
      : result("unverified", "Inspect the current resource stack to assess model and texture availability", "blockstage:resource-appearance-v1", {
          requiredContext: ["effective resource stack", "renderer assessment"],
        });
  const exporting = action === "structure-export" || action === "datapack-export";
  // Keep the finite built-in export fallback; pack-only metadata is not game proof.
  if (exporting && !demoRegistry.has(state.name) && material?.source !== "game-profile")
    return result("unsupported", `${state.name}: chưa có adapter/profile game để xác nhận xuất`, "blockstage:structure-v1", {
      requiredContext: ["matching game profile"],
    });
  if (!material || material.id !== state.name)
    return result("unsupported", `Registry unavailable for ${state.name}`, "blockstage:registry-v1");
  try {
    validateState(state, [material]);
    if (exporting && material.source !== "game-profile")
      validateState(state, [demoRegistry.get(state.name)!]);
  } catch (error) {
    return result("unsupported", error instanceof Error ? error.message : "Invalid blockstate", "blockstage:registry-v1");
  }
  if (options.payload !== undefined && !blockEntitySchema.safeParse(options.payload).success)
    return result("unsupported", "Unsupported or invalid block-entity payload", "blockstage:chest-inventory-v1");
  const chest = state.name === "minecraft:chest" && state.properties.type === "single";
  if (options.payload && !chest)
    return result("unsupported", "Chest payload requires a single minecraft:chest", "blockstage:chest-inventory-v1");
  if (action.startsWith("payload-"))
    return chest
      ? result("supported", "Single chest: 27 slots, four plain item IDs, stacks 1–64; no item components", "blockstage:chest-inventory-v1", {
          evidence: ["source:src/core/schema.ts", "source:src/core/chest-items.ts"],
        })
      : result("unsupported", "No payload adapter; unknown payloads are rejected", "blockstage:payload-v1");
  if (action === "registry")
    return result("supported", material.source === "game-profile"
      ? "Complete state is legal in the imported game profile"
      : "Complete state is legal in the local catalog; this alone does not establish export support", "blockstage:registry-v1");
  if (action === "mirror") {
    const mirror = mirrorStateCapability(state, material, options.mirrorPlane ?? "yz", options.payload);
    return result(mirror.supported ? "supported" : "unsupported", mirror.reason, mirror.adapterId, {
      evidence: mirror.evidence,
      requiredContext: ["complete logical owners", "vertical World mirror plane", "validated final candidate"],
    });
  }
  if (action === "yaw") {
    const error = blockYawError(state);
    return error
      ? result("unsupported", error, "blockstage:string-state-yaw-v1")
      : result("supported", "Quarter-turn yaw transforms positions and supported string states; pivot parity and full footprints are checked by the operation", "blockstage:string-state-yaw-v1", {
          requiredContext: ["complete logical owners", "grid-compatible pivot", "validated final candidate"],
        });
  }
  if (action === "context") {
    const kind = adapter?.context;
    if (!kind)
      return result("unsupported", "No verified Context adapter; selected state is preserved.", "blockstage:context-fallback-v1");
    const derived: readonly string[] = contextProperties[kind];
    return result("partial", "Derives supported orientation/half fields from a surface hit; other states remain explicit. Support, fluids and power are separate.", `blockstage:context-${kind}-v1`, {
      requiredContext: ["surface hit", ...(derived.includes("facing") ? ["horizontal camera direction"] : [])],
      derivedProperties: derived,
      preservedProperties: Object.keys(state.properties).filter((property) => !derived.includes(property)),
    });
  }
  if (action === "neighbors") {
    const rule = options.profile?.neighborRules?.[state.name];
    if (!options.profile?.neighborRules)
      return result("unsupported", "Import a matching game profile with neighbor predicates", "blockstage:neighbors-v1", { requiredContext: ["generated neighbor predicates", "Auto connections enabled"] });
    if (adapter?.neighbors !== "stairs" && (!rule || !["fence", "wall", "gate"].includes(rule.kind)))
      return result("unsupported", "No automatic neighbor adapter; explicit states are preserved", "blockstage:neighbors-v1");
    return result("partial", "Opt-in bounded scene neighbors; unavailable or dynamic predicates preserve explicit states with a reason", "blockstage:neighbors-v1", {
      requiredContext: ["Auto connections enabled", "full scene occupancy", "generated neighbor predicates", "final view-policy guard"],
    });
  }
  if (action === "support")
    return adapter?.support
      ? result("partial", adapter.support === "unknown-plant"
        ? "Reports unknown special soil/fluid requirements; no survival rule is evaluated"
        : "Finite support diagnostics; unrecognized support and destination cells remain unknown", `blockstage:support-${adapter.support}-v1`, { requiredContext: ["scene support cells", "matching legal states"] })
      : result("unsupported", "No support diagnostic adapter; no survival behavior is inferred", "blockstage:support-v1");
  if (exporting || action === "structure-import") {
    if (material.hasBlockEntity && !(chest && (!exporting || options.payload?.kind === "chest")))
      return result("unsupported", exporting
        ? `${state.name}: cần payload block entity; chưa hỗ trợ xuất trong bản này`
        : `${state.name} requires block-entity payload support, which is not available in this import.`, "blockstage:structure-v1");
    return result("supported", "Java 26.2 single-palette Structure cells and complete logical pairs; only supported single-chest payloads", "blockstage:structure-v1", {
      requiredContext: ["complete logical pairs", "unique occupied cells", ...(exporting ? ["48 cells per axis export policy"] : ["bounded single-palette input"])],
    });
  }
  if (action === "design") {
    const structural = ["head", "foot"].includes(state.properties.part) || ["lower", "upper"].includes(state.properties.half);
    if (structural && !adapter?.logical)
      return result("unsupported", `No verified logical placement adapter for ${state.name}`, "blockstage:logical-pair-v1");
    return result(material.hasBlockEntity && !chest ? "partial" : "supported",
      material.hasBlockEntity && !chest
        ? "Stores explicit blockstate cells; block-entity payload editing/export is unsupported"
        : "Stores explicit state and creates complete logical parts; collision and final view policy are checked by the placement plan",
      adapter?.logical ? `blockstage:logical-${adapter.logical}-v1` : "blockstage:design-cell-v1");
  }
  if (["translate", "copy", "remove"].includes(action))
    return result("supported", "Whole logical owners preserve cell states and supported payloads; operations validate identity, footprint and view policy", "blockstage:logical-objects-v1");
  return result("unsupported", "No adapter for this action");
}

/** Numeric pig editing and entity export deliberately have independent coverage. */
export function resolveEntityCapability(
  id: string,
  action: CapabilityAction,
  options: ResolverOptions & { appearance?: CapabilityDecision } = {},
): CapabilityDecision {
  const target = options.target ?? GAME_TARGET, adapter = entityAdapter(id);
  const result = (status: CapabilityDecision["status"], reason: string, adapterId: string) =>
    capabilityDecision(action, adapterId, status, reason, { target, evidence: adapter?.provenance });
  if (!isSupportedTarget(target))
    return result("unsupported", "Capabilities require Minecraft Java 26.2 / DataVersion 4903", "blockstage:target-v1");
  if (action === "world")
    return result("unverified", "Entity AI, ticks and destination runtime behavior are unverified", "blockstage:world-unverified");
  if (action === "appearance")
    return options.appearance?.action === "appearance" && isSupportedTarget(options.appearance.target)
      ? options.appearance
      : result("unverified", "Inspect the current resource stack for a static entity binding", "blockstage:resource-appearance-v1");
  if (action === "registry")
    return options.profile?.entities.some((entity) => entity.id === id)
      ? result("supported", "Entity type is present in the matching game profile", "blockstage:entity-registry-v1")
      : result("unsupported", "Entity registry is unavailable", "blockstage:entity-registry-v1");
  if (action === "structure-export" || action === "datapack-export")
    return adapter?.structureExport
      ? result("supported", "Basic entity position/yaw export; no equipment, variants or arbitrary payload", "blockstage:entity-structure-v1")
      : result("unsupported", `${id}: no supported entity export adapter.`, "blockstage:entity-structure-v1");
  if (["design", "translate", "yaw", "copy", "remove"].includes(action))
    return adapter?.edit === "pig"
      ? result("supported", "Basic pig position/yaw editing; no payload or simulation", "blockstage:pig-edit-v1")
      : result("unsupported", `Entity editing is not supported for ${id}`, "blockstage:pig-edit-v1");
  return result("unsupported", action === "structure-import"
    ? "Structure import does not support entities; entity payloads are rejected"
    : "No entity adapter for this action", "blockstage:entity-v1");
}

/** Reuse this per catalog identity/operation; no global state or cross-call validation cache. */
export function createCapabilityResolver(catalog: readonly Material[], options: ResolverOptions = {}) {
  const registry = new Map(catalog.map((material) => [material.id, material]));
  return {
    replacement: replacementResolver(registry, options),
    block: (state: BlockState, action: CapabilityAction, context: BlockOptions = {}) =>
      resolveBlockCapability(state, action, registry.get(state.name), { ...options, ...context }),
    entity: (id: string, action: CapabilityAction, context: { appearance?: CapabilityDecision } = {}) =>
      resolveEntityCapability(id, action, { ...options, ...context }),
  };
}

/** Finite editor replacement contract, not an appearance or world-behavior claim. */
export type ReplacementCapability = CapabilityDecision & Readonly<{
  family?: string;
}>;
const woods = WOOD_TYPES;
const colors = DYE_COLORS;
const stones =
  "stone cobblestone mossy_cobblestone stone_brick mossy_stone_brick brick mud_brick sandstone smooth_sandstone cut_sandstone red_sandstone smooth_red_sandstone cut_red_sandstone granite polished_granite diorite polished_diorite andesite polished_andesite deepslate_brick deepslate_tile cobbled_deepslate polished_deepslate blackstone polished_blackstone polished_blackstone_brick tuff polished_tuff tuff_brick nether_brick red_nether_brick quartz smooth_quartz purpur end_stone_brick".split(
    " ",
  );
const ids = (names: readonly string[]) =>
  names.map((name) => `minecraft:${name}`);
const families: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    "pillar",
    ids(
      woods
        .filter((wood) => !["bamboo", "crimson", "warped"].includes(wood))
        .flatMap((wood) => [
          `${wood}_log`,
          `${wood}_wood`,
          `stripped_${wood}_log`,
          `stripped_${wood}_wood`,
        ])
        .concat([
          "crimson_stem",
          "warped_stem",
          "crimson_hyphae",
          "warped_hyphae",
          "stripped_crimson_stem",
          "stripped_warped_stem",
          "stripped_crimson_hyphae",
          "stripped_warped_hyphae",
          "bamboo_block",
          "stripped_bamboo_block",
        ]),
    ),
  ],
  ["planks", ids(woods.map((wood) => `${wood}_planks`))],
  [
    "slab",
    ids([...woods, ...stones, "bamboo_mosaic"].map((name) => `${name}_slab`)),
  ],
  [
    "stairs",
    ids([...woods, ...stones, "bamboo_mosaic"].map((name) => `${name}_stairs`)),
  ],
  [
    "door",
    ids(
      woods
        .map((wood) => `${wood}_door`)
        .concat([
          "iron_door",
          "copper_door",
          "exposed_copper_door",
          "weathered_copper_door",
          "oxidized_copper_door",
          "waxed_copper_door",
          "waxed_exposed_copper_door",
          "waxed_weathered_copper_door",
          "waxed_oxidized_copper_door",
        ]),
    ),
  ],
  ["bed", ids(colors.map((color) => `${color}_bed`))],
  [
    "masonry",
    ids([
      "stone",
      "cobblestone",
      "mossy_cobblestone",
      "stone_bricks",
      "mossy_stone_bricks",
      "cracked_stone_bricks",
      "chiseled_stone_bricks",
      "bricks",
      "mud_bricks",
      "granite",
      "polished_granite",
      "diorite",
      "polished_diorite",
      "andesite",
      "polished_andesite",
      "deepslate_bricks",
      "deepslate_tiles",
      "cobbled_deepslate",
      "polished_deepslate",
      "blackstone",
      "polished_blackstone",
      "polished_blackstone_bricks",
      "tuff",
      "polished_tuff",
      "tuff_bricks",
      "end_stone_bricks",
      "nether_bricks",
      "red_nether_bricks",
    ]),
  ],
];
const replacementFamilies = new Map(
  families.flatMap(([family, names]) =>
    names.map((id) => [id, family] as const),
  ),
);

/** Exact IDs + identical property domains; tags, labels and suffixes grant no permission. */
export function replacementCompatibility(
  state: BlockState,
  targetId: string,
  catalog: readonly Material[],
  options: Pick<ResolverOptions, "target"> = {},
): ReplacementCapability {
  return createReplacementResolver(catalog, options)(state, targetId);
}

/** One registry index per operation/panel, including catalogs with thousands of IDs. */
export function createReplacementResolver(catalog: readonly Material[], options: Pick<ResolverOptions, "target"> = {}) {
  const registry = new Map(catalog.map((material) => [material.id, material]));
  return replacementResolver(registry, options);
}
function replacementResolver(registry: ReadonlyMap<string, Material>, options: Pick<ResolverOptions, "target">) {
  return (state: BlockState, targetId: string): ReplacementCapability => {
    const evidence = [
      "editor-contract:replacement-v1",
      "validation:exact-property-domains",
      "world-readback:unverified",
    ] as const;
    const fail = (reason: string): ReplacementCapability => ({
      ...capabilityDecision("replace", "blockstage:replacement-v1", "unsupported", reason, { target: options.target, evidence }),
    });
    if (!isSupportedTarget(options.target ?? GAME_TARGET))
      return fail("Replacement requires Minecraft Java 26.2 / DataVersion 4903");
    const source = registry.get(state.name),
      target = registry.get(targetId);
    if (!source || !target)
      return fail("Source or target registry is unavailable");
    try {
      validateState(state, [source]);
    } catch {
      return fail("Source block state is invalid");
    }
    if (state.name === targetId)
      return fail("Source and target material are identical");
    const family = replacementFamilies.get(state.name);
    if (!family || family !== replacementFamilies.get(targetId))
      return fail(
        "No verified editor replacement contract for this material pair",
      );
    const properties = Object.keys(source.properties);
    if (
      properties.length !== Object.keys(target.properties).length ||
      properties.some((property) => {
        const values = source.properties[property],
          other = target.properties[property];
        return (
          !other ||
          values.length !== other.length ||
          values.some((value) => !other.includes(value))
        );
      })
    )
      return fail(
        "Property domains differ; replacement cannot preserve the full state contract",
      );
    try {
      validateState({ name: targetId, properties: state.properties }, [target]);
    } catch {
      return fail("Target does not accept every source property value");
    }
    return {
      ...capabilityDecision("replace", "blockstage:replacement-v1", "supported",
        "Preserves every property and occupied cell; world behavior is unverified", { target: options.target, evidence }),
      family,
    };
  };
}
