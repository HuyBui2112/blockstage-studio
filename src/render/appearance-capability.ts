import { chestAppearanceBinding, entityAdapter } from "../core/adapter-registry";
import { capabilityDecision, type CapabilityDecision } from "../core/capabilities";
import { validateState, type Material } from "../core/catalog";
import type { GameProfile } from "../core/profile";
import type { BlockState } from "../core/schema";
import type { ModelResolver } from "./models";
import { specialBlockSupport } from "./special-blocks";
import { FOLIAGE_COLORMAP, FOLIAGE_PREVIEW_LABEL, inspectFoliageColormap } from "./foliage-tint";

export type AppearanceAssessment = CapabilityDecision & { label: string };
type AppearanceInput = {
  kind: "block" | "entity";
  id: string;
  state: BlockState;
  material?: Material;
  profile: GameProfile | null;
  resolver: ModelResolver;
};

/** Resource availability only: no geometry allocation, game-rule or pixel-parity proof. */
export function assessAppearance(input: AppearanceInput): AppearanceAssessment {
  const { kind, id, state, material, profile, resolver } = input;
  const result = (
    label: string,
    adapterId: string,
    status: CapabilityDecision["status"],
    reason: string,
    requiredContext: readonly string[] = [],
  ): AppearanceAssessment => ({
    ...capabilityDecision("appearance", adapterId, status, reason, {
      requiredContext,
      evidence: ["resources:effective-stack", "pixel-parity:unverified"],
    }),
    label,
  });
  if (kind === "entity") {
    const binding = entityAdapter(id)?.appearance;
    if (!binding)
      return result("Bounds preview", "appearance:entity-static", "unsupported",
        "No static renderer adapter is declared for this entity.");
    if (!profile?.entityModels[binding.layer])
      return result("Bounds preview", "appearance:entity-static", "unsupported",
        `Import a matching game profile; missing model layer: ${binding.layer}`,
        ["game-profile:model-layers"]);
    if (!resolver.files.has(binding.texture))
      return result("Bounds preview", "appearance:entity-static", "unsupported",
        `Missing entity texture: ${binding.texture}`, ["resource-pack:textures"]);
    return result("Static model", "appearance:entity-static", "partial",
      "Static default pose is available. Animation, equipment and runtime variants are not supported.");
  }
  if (["minecraft:air", "minecraft:cave_air", "minecraft:void_air"].includes(id)) {
    if (state.name !== id || Object.keys(state.properties).length)
      return result("Invalid air state", "appearance:air", "unsupported",
        "Air appearance requires its exact ID and an empty property set.");
    return result("Invisible air", "appearance:air", "supported",
      "Air has an intentional empty appearance; no block model or texture is required.");
  }
  if (id === "minecraft:water" || id === "minecraft:lava")
    return result("Fluid preview unavailable", "appearance:fluid", "unsupported",
      "Fluid rendering is not supported. Registry data remains available.");
  try {
    const special = specialBlockSupport(state, profile, resolver);
    if (special)
      return result(special.available ? "Static partial model" : "Special renderer unavailable",
        "appearance:special-static", special.available ? "partial" : "unsupported",
        special.detail, special.available ? [] : ["game-profile:model-layers", "resource-pack:textures"]);
  } catch (error) {
    return result("Special renderer unavailable", "appearance:special-static", "unsupported",
      error instanceof Error ? error.message : "Unsupported special-renderer state.");
  }
  if (material?.renderShape === "INVISIBLE")
    return result("No block model", "appearance:invisible", "unsupported",
      "The registry marks this block model as invisible. Runtime appearances are not simulated.");
  const binding = chestAppearanceBinding(id, state.properties);
  let missingBinding = "";
  if (binding) {
    if (!profile?.entityModels[binding.layer])
      missingBinding = `Missing model layer: ${binding.layer}`;
    else if (!resolver.files.has(binding.texture))
      missingBinding = `Missing chest texture: ${binding.texture}`;
    else
      return result("Static model", "appearance:chest-static", "partial",
        "A static chest model is available. Runtime lid motion is not simulated; payload support is separate.");
  }
  // A resource pack can supply a JSON model even when a chest layer is unavailable.
  try {
    const resolved = resolver.resolve(state);
    let faces = 0, foliageTint = false, unknownFoliageTint = false;
    for (const part of resolved.parts)
      for (const element of part.model.elements ?? [])
        for (const face of Object.values(element.faces)) {
          resolver.texture(part.model, face.texture);
          if (id === "minecraft:oak_leaves" && face.tintindex !== undefined && face.tintindex >= 0) {
            if (face.tintindex === 0) foliageTint = true;
            else unknownFoliageTint = true;
          }
          faces++;
        }
    if (!faces && !resolved.parts.length && !resolved.warnings.length &&
      material?.source === "game-profile" && !material.hasBlockEntity &&
      material.id === id && state.name === id &&
      profile?.neighborRules?.[id]?.kind === "wall" &&
      state.properties.up === "false" &&
      ["north", "east", "south", "west"].every((direction) => state.properties[direction] === "none")) {
      validateState(state, [material]);
      return result("Empty wall state", "appearance:block-json", "supported",
        "This legal wall state has no post or sides. Its empty multipart appearance is intentional.");
    }
    if (!faces)
      return result("Partial appearance", "appearance:block-json", "unsupported",
        missingBinding || "No model faces resolved. A special renderer may be required.");
    if (foliageTint || unknownFoliageTint) {
      const map = foliageTint ? inspectFoliageColormap(resolver.files.get(FOLIAGE_COLORMAP)) : { valid: true };
      const notes = [...resolved.warnings, FOLIAGE_PREVIEW_LABEL];
      if (!map.valid) notes.push(`${map.reason ?? "Foliage colormap unavailable"} Showing untinted foliage; import or enable a matching resource pack.`);
      if (unknownFoliageTint) notes.push("Only oak foliage tint index 0 is supported; other tint indices remain untinted.");
      notes.push("Colors use fixed preview conditions and studio lighting.");
      return result(!map.valid ? "Untinted foliage preview" : unknownFoliageTint ? "Partial foliage preview" : "Model available",
        "appearance:block-json", !map.valid || unknownFoliageTint || resolved.warnings.length ? "partial" : "supported",
        notes.join(" "), !map.valid ? ["resource-pack:foliage-colormap"] : []);
    }
    return result("Model available", "appearance:block-json",
      resolved.warnings.length ? "partial" : "supported",
      resolved.warnings.length
        ? resolved.warnings.join(" ")
        : "Model faces and texture references resolve from enabled packs. The viewport reports unsupported geometry.");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Model or texture assets are missing or unsupported.";
    return result("Fallback preview", "appearance:block-json", "unsupported",
      missingBinding ? `${missingBinding}. ${detail}` : detail,
      ["resource-pack:models-and-textures"]);
  }
}
