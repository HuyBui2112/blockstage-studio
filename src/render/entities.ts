import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import type { EntityModelPart, GameProfile } from "../core/profile";
import { chestAppearanceBinding, entityAdapter } from "../core/adapter-registry";
import type { BakedMesh } from "./block-mesh";
import type { ModelResolver } from "./models";

export type EntityAppearance = { layer: string; texture: string };
export function entityAppearance(
  id: string,
  profile: GameProfile | null,
  resolver: ModelResolver,
): EntityAppearance | undefined {
  const binding = entityAdapter(id)?.appearance;
  if (!binding) return undefined;
  const { layer, texture } = binding;
  return profile?.entityModels[layer] && resolver.files.has(texture)
    ? { layer, texture }
    : undefined;
}
export function bakeEntity(
  root: EntityModelPart,
  texture: string,
  space: "entity" | "block" = "entity",
): BakedMesh {
  const positions: number[] = [],
    uvs: number[] = [];
  let omitted = 0,
    partCount = 0;
  function visit(part: EntityModelPart, parent: Matrix4, depth: number) {
    if (depth > 64 || ++partCount > 4096)
      throw new Error("Entity hierarchy quá lớn");
    omitted += part.omittedPolygons;
    const transform = parent
      .clone()
      .multiply(
        new Matrix4().compose(
          new Vector3(...part.position).multiplyScalar(1 / 16),
          new Quaternion().setFromEuler(new Euler(...part.rotation, "ZYX")),
          new Vector3(...part.scale),
        ),
      );
    for (const polygon of part.polygons)
      for (const n of [0, 1, 2, 0, 2, 3]) {
        const [x, y, z, u, v] = polygon[n],
          p = new Vector3(x / 16, y / 16, z / 16).applyMatrix4(transform);
        positions.push(p.x, p.y, p.z);
        uvs.push(u, 1 - v);
      }
    for (const child of Object.values(part.children))
      visit(child, transform, depth + 1);
  }
  const base =
    space === "entity"
      ? new Matrix4()
          .makeTranslation(0, 1.5, 0)
          .multiply(new Matrix4().makeScale(1, -1, -1))
      : new Matrix4().makeTranslation(-0.5, -0.5, -0.5);
  visit(root, base, 0);
  if (omitted)
    throw new Error(
      `Model có ${omitted} polygon UV không hợp lệ; cần adapter riêng`,
    );
  if (!positions.length) throw new Error("Model entity không có geometry");
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.addGroup(0, positions.length / 3, 0);
  return { geometry, surfaces: [{ texture, tint: false, shade: true }] };
}

export function blockEntityAppearance(
  id: string,
  state: Record<string, string>,
): EntityAppearance | undefined {
  return chestAppearanceBinding(id, state);
}
