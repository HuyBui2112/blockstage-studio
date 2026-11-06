import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { GameProfile } from "../core/profile";
import { DYE_COLORS } from "../core/adapter-registry";
import type { BlockState } from "../core/schema";
import { bakeEntity } from "./entities";
import type { BakedMesh } from "./block-mesh";
import type { ModelResolver } from "./models";

type Definition = {
  layers: string[];
  textures: string[];
  color?: string;
  angle: number;
  banner: boolean;
  note: string;
};
export function specialBlockAppearance(
  state: BlockState,
): Definition | undefined {
  if (state.name === "minecraft:conduit")
    return {
      layers: ["minecraft:conduit#shell"],
      textures: ["assets/minecraft/textures/entity/conduit/base.png"],
      angle: 0,
      banner: false,
      note: "Inactive conduit preview; activation, wind and eye effects are not simulated.",
    };
  const color = DYE_COLORS.find(
    (color) =>
      state.name === `minecraft:${color}_banner` ||
      state.name === `minecraft:${color}_wall_banner`,
  );
  if (!color) return undefined;
  const wall = state.name === `minecraft:${color}_wall_banner`,
    layer = wall ? "wall_banner" : "standing_banner";
  const angle = wall
    ? { south: 0, west: 90, north: 180, east: 270 }[state.properties.facing]
    : Number(state.properties.rotation) * 22.5;
  if (angle === undefined || !Number.isFinite(angle))
    throw new Error("Banner requires a legal orientation state");
  return {
    layers: [`minecraft:${layer}#main`, `minecraft:${layer}#flag`],
    textures: [
      "assets/minecraft/textures/entity/banner/banner_base.png",
      "assets/minecraft/textures/entity/banner/base.png",
    ],
    color,
    angle: (-angle * Math.PI) / 180,
    banner: true,
    note: "Static base-color banner; patterns, cloth animation and block-entity payload are not supported.",
  };
}
export function specialBlockSupport(
  state: BlockState,
  profile: GameProfile | null,
  resolver: ModelResolver,
): { available: boolean; detail: string } | undefined {
  const definition = specialBlockAppearance(state);
  if (!definition) return undefined;
  const missing = definition.layers.filter(
    (layer) => !profile?.entityModels[layer],
  );
  if (missing.length)
    return {
      available: false,
      detail: `Import a matching game profile; missing model layers: ${missing.join(", ")}`,
    };
  if (definition.color && profile?.dyeColors?.[definition.color] === undefined)
    return {
      available: false,
      detail:
        "Regenerate and import the game profile to supply Minecraft dye colors.",
    };
  const textures = definition.textures.filter(
    (path) => !resolver.files.has(path),
  );
  return {
    available: !textures.length,
    detail: textures.length
      ? `Missing special-renderer texture: ${textures.join(", ")}`
      : definition.note,
  };
}
/** Game-baked geometry with the 26.2 renderer's static origin/scale/orientation.
 * This deliberately does not infer block-entity state from world arrangements.
 */
export function bakeSpecialBlock(
  state: BlockState,
  profile: GameProfile | null,
  resolver: ModelResolver,
): BakedMesh | undefined {
  const definition = specialBlockAppearance(state);
  if (!definition) return undefined;
  const support = specialBlockSupport(state, profile, resolver)!;
  if (!support.available) throw new Error(support.detail);
  const parts: BakedMesh[] = [];
  try {
    for (let i = 0; i < definition.layers.length; i++) {
      const mesh = bakeEntity(
        profile!.entityModels[definition.layers[i]],
        definition.textures[i],
        "block",
      );
      parts.push(mesh);
      // Undo bakeEntity's block origin; renderer poses are applied to raw model space.
      mesh.geometry.translate(0.5, 0.5, 0.5);
      if (definition.banner) {
        mesh.geometry.scale(2 / 3, -2 / 3, -2 / 3);
        mesh.geometry.rotateY(definition.angle);
        mesh.geometry.translate(0, -0.5, 0);
      }
      mesh.geometry.clearGroups();
      if (i === 1 && definition.color)
        mesh.surfaces[0].color =
          "#" +
          profile!.dyeColors![definition.color].toString(16).padStart(6, "0");
    }
    const geometry = mergeGeometries(
      parts.map((part) => part.geometry),
      true,
    );
    if (!geometry)
      throw new Error("Special-renderer geometry could not be combined");
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, surfaces: parts.flatMap((part) => part.surfaces) };
  } finally {
    for (const part of parts) part.geometry.dispose();
  }
}
