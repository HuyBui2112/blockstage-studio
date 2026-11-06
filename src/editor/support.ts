import { validateState, type Material } from "../core/catalog";
import { key, type Block, type Vec3 } from "../core/schema";
import { blockAdapter, CONTEXT_CHAIN_IDS, WOOD_TYPES } from "../core/adapter-registry";

export type SupportIssue = {
  code: "missing_support" | "invalid_support" | "support_unknown";
  message: string;
  pos: Vec3;
  supportPos: Vec3;
  objectId?: string;
};

export const MAX_SUPPORT_ISSUES = 100;

const vanilla = (ids: string) =>
  new Set(ids.split(" ").map((id) => `minecraft:${id}`));
const air = vanilla("air cave_air void_air");
// Vanilla 26.2 SUPPORTS_VEGETATION, verified against the matching ServerLevel.
// Keep the snapshot explicit: resource/profile tags and render models do not
// establish game behavior. Custom datapack changes require a new verification.
const plantSoil = vanilla(
  "coarse_dirt dirt farmland grass_block moss_block mud muddy_mangrove_roots mycelium pale_moss_block podzol rooted_dirt",
);
const solidSupport = vanilla(
  [
    "stone stone_bricks cobblestone dirt grass_block coarse_dirt podzol rooted_dirt mycelium clay",
    ...WOOD_TYPES.map((wood) => `${wood}_planks`),
    ...WOOD_TYPES
      .filter((wood) => !["bamboo", "crimson", "warped"].includes(wood))
      .map((wood) => `${wood}_log`),
  ].join(" "),
);
const knownNonSupport = vanilla(
  "water lava short_grass fern dead_bush torch redstone_torch soul_torch",
);
/** Cache occupancy and registry indexes for an immutable committed scene. Each
 * call assesses the supplied subjects and overlays their cells for support lookup,
 * so component previews can provide their own floor without copying the scene.
 * Missing scene cells do not imply air in an export destination.
 * Beds deliberately have no floor rule: vanilla permits complete floating pairs.
 */
export function createSupportChecker(
  blocks: readonly Block[],
  catalog: readonly Material[],
): (subjects?: readonly Block[]) => SupportIssue[] {
  const occupied = new Map(blocks.map((block) => [key(block.pos), block]));
  const materials = new Map(catalog.map((material) => [material.id, material]));
  const legal = (block: Block) => {
    const material = materials.get(block.state.name);
    if (!material) return false;
    try {
      validateState(block.state, [material]);
      return true;
    } catch {
      return false;
    }
  };
  return (subjects: readonly Block[] = blocks): SupportIssue[] => {
    const candidates =
      subjects === blocks
        ? occupied
        : new Map(subjects.map((block) => [key(block.pos), block]));
    const issues: SupportIssue[] = [],
      reported = new Set<string>();
    let omitted = 0,
      firstOmitted: SupportIssue | undefined;
    const report = (
      block: Block,
      supportPos: Vec3,
      code: SupportIssue["code"],
      reason: string,
    ) => {
      const signature = `${code}:${key(block.pos)}:${key(supportPos)}`;
      if (reported.has(signature)) return;
      reported.add(signature);
      const objectId =
        "owner" in block && typeof block.owner === "string"
          ? block.owner
          : undefined;
      const issue: SupportIssue = {
        code,
        message: `${block.state.name} at ${block.pos.join(", ")}: ${reason} (${supportPos[1] > block.pos[1] ? "above" : "below"} ${supportPos.join(", ")}).`,
        pos: [...block.pos],
        supportPos,
        ...(objectId ? { objectId } : {}),
      };
      if (issues.length < MAX_SUPPORT_ISSUES) issues.push(issue);
      else {
        omitted++;
        firstOmitted ??= issue;
      }
    };
    for (const block of subjects) {
      const id = block.state.name;
      const supportKind = blockAdapter(id)?.support;
      if (supportKind === "lantern") {
        const supportPos: Vec3 = [
          block.pos[0],
          block.pos[1] + (block.state.properties.hanging === "true" ? 1 : -1),
          block.pos[2],
        ];
        if (!legal(block)) {
          report(
            block,
            supportPos,
            "support_unknown",
            "support adapter requires a valid registered state",
          );
          continue;
        }
        const support =
          candidates.get(key(supportPos)) ?? occupied.get(key(supportPos));
        if (!support) {
          report(
            block,
            supportPos,
            "missing_support",
            "no attachment cell in this scene; destination support is unknown",
          );
          continue;
        }
        if (!legal(support)) {
          report(
            block,
            supportPos,
            "support_unknown",
            `cannot verify the supporting state ${support.state.name}`,
          );
          continue;
        }
        if (air.has(support.state.name)) {
          report(
            block,
            supportPos,
            "invalid_support",
            "explicit air cannot support this lantern",
          );
          continue;
        }
        if (
          block.state.properties.waterlogged !== "false" ||
          (CONTEXT_CHAIN_IDS.has(support.state.name) &&
            support.state.properties.waterlogged !== "false")
        ) {
          report(
            block,
            supportPos,
            "support_unknown",
            "waterlogged lantern/chain attachment is outside the verified dry support fixtures",
          );
          continue;
        }
        if (support.state.name === "minecraft:stone") continue;
        if (CONTEXT_CHAIN_IDS.has(support.state.name)) {
          if (support.state.properties.axis !== "y")
            report(
              block,
              supportPos,
              "invalid_support",
              `${support.state.name} with axis=${support.state.properties.axis} cannot support a lantern on its vertical faces`,
            );
        } else
          report(
            block,
            supportPos,
            "support_unknown",
            `lantern attachment to ${support.state.name} has not been verified`,
          );
        continue;
      }
      if (
        !supportKind ||
        block.state.properties.half !== "lower"
      )
        continue;
      const below: Vec3 = [block.pos[0], block.pos[1] - 1, block.pos[2]];
      if (!legal(block)) {
        report(
          block,
          below,
          "support_unknown",
          "support adapter requires a valid registered state",
        );
        continue;
      }
      const support = candidates.get(key(below)) ?? occupied.get(key(below));
      if (!support) {
        report(
          block,
          below,
          "missing_support",
          "no support cell in this scene; destination support is unknown",
        );
        continue;
      }
      if (!legal(support)) {
        report(
          block,
          below,
          "support_unknown",
          `cannot verify the supporting state ${support.state.name}`,
        );
        continue;
      }
      if (air.has(support.state.name)) {
        report(
          block,
          below,
          "invalid_support",
          "explicit air cannot support this block",
        );
        continue;
      }
      if (supportKind === "unknown-plant") {
        report(
          block,
          below,
          "support_unknown",
          "special soil/fluid requirements are outside the bounded support adapters",
        );
        continue;
      }
      if (supportKind === "soil-plant") {
        if (plantSoil.has(support.state.name)) continue;
        if (
          solidSupport.has(support.state.name) ||
          knownNonSupport.has(support.state.name)
        )
          report(
            block,
            below,
            "invalid_support",
            `${support.state.name} is not accepted plant soil`,
          );
        else
          report(
            block,
            below,
            "support_unknown",
            `soil predicate for ${support.state.name} has not been verified`,
          );
      } else if (!solidSupport.has(support.state.name)) {
        if (knownNonSupport.has(support.state.name))
          report(
            block,
            below,
            "invalid_support",
            `${support.state.name} does not provide a sturdy upper face`,
          );
        else
          report(
            block,
            below,
            "support_unknown",
            `sturdy upper face of ${support.state.name} has not been verified`,
          );
      }
    }
    if (firstOmitted)
      issues.push({
        ...firstOmitted,
        code: "support_unknown",
        message: `${omitted} additional support diagnostics omitted; showing the first ${MAX_SUPPORT_ISSUES}. Support checks are limited, not a world simulation.`,
      });
    return issues;
  };
}

/** Bounded diagnostics for explicit vanilla adapters, not a world simulation. */
export function assessSupport(
  blocks: readonly Block[],
  catalog: readonly Material[],
  subjects?: readonly Block[],
): SupportIssue[] {
  return createSupportChecker(blocks, catalog)(subjects);
}
