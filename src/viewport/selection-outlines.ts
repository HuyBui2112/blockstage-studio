import * as T from "three";

const CHUNK_SIZE = 16;
const MAX_BOXES = 100_000;
// Keep compact vertices near their origin. Wide sparse owners retain the old
// unit-box transform instead of rounding their extents into Float32 vertices.
const MAX_BATCH_EXTENT = 1024;
// Same eight-corner order and twelve edges as Three's Box3Helper.
const EDGES = [
  0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7,
];

/** A selection-only drawable owning its geometry and material. */
export class SelectionOutlineBatch extends T.LineSegments<
  T.BufferGeometry,
  T.LineBasicMaterial
> {
  private disposed = false;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class SelectionOutlineHelper extends T.Box3Helper {
  // Box3Helper always creates one LineBasicMaterial; Three's declaration is broad.
  declare material: T.LineBasicMaterial;
  private disposed = false;

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    super.dispose();
  }
}

export type SelectionOutline = SelectionOutlineBatch | SelectionOutlineHelper;

/** Input bounds already include selection padding. Never modifies those bounds. */
export function createSelectionOutlines(
  boxes: ReadonlyMap<string, T.Box3>,
  active: string | null,
): SelectionOutline[] {
  if (boxes.size > MAX_BOXES)
    throw new RangeError("Selection outlines exceed 100000 boxes");
  const groups = new Map<
    string,
    { origin: T.Vector3; active: boolean; boxes: T.Box3[] }
  >();
  const wide: { box: T.Box3; active: boolean }[] = [];
  for (const [id, box] of boxes) {
    if (box.isEmpty()) continue;
    const coordinates = [
      box.min.x,
      box.min.y,
      box.min.z,
      box.max.x,
      box.max.y,
      box.max.z,
    ];
    if (!coordinates.every(Number.isFinite))
      throw new RangeError("Selection bounds must be finite");
    if (
      Math.max(
        box.max.x - box.min.x,
        box.max.y - box.min.y,
        box.max.z - box.min.z,
      ) > MAX_BATCH_EXTENT
    ) {
      wide.push({ box, active: id === active });
      continue;
    }
    const x =
      Math.floor((box.min.x / 2 + box.max.x / 2) / CHUNK_SIZE) * CHUNK_SIZE;
    const y =
      Math.floor((box.min.y / 2 + box.max.y / 2) / CHUNK_SIZE) * CHUNK_SIZE;
    const z =
      Math.floor((box.min.z / 2 + box.max.z / 2) / CHUNK_SIZE) * CHUNK_SIZE;
    const isActive = id === active;
    const key = `${x},${y},${z},${isActive}`;
    let group = groups.get(key);
    if (!group) {
      group = { origin: new T.Vector3(x, y, z), active: isActive, boxes: [] };
      groups.set(key, group);
    }
    group.boxes.push(box);
  }
  const result: SelectionOutline[] = [];
  for (const group of groups.values()) {
    const vertexCount = group.boxes.length * 8;
    const positions = new Float32Array(vertexCount * 3);
    const indices =
      vertexCount > 65535
        ? new Uint32Array(group.boxes.length * 24)
        : new Uint16Array(group.boxes.length * 24);
    for (let i = 0; i < group.boxes.length; i++) {
      const box = group.boxes[i]!;
      const min = box.min.clone().sub(group.origin);
      const max = box.max.clone().sub(group.origin);
      const corners = [
        max.x,
        max.y,
        max.z,
        min.x,
        max.y,
        max.z,
        min.x,
        min.y,
        max.z,
        max.x,
        min.y,
        max.z,
        max.x,
        max.y,
        min.z,
        min.x,
        max.y,
        min.z,
        min.x,
        min.y,
        min.z,
        max.x,
        min.y,
        min.z,
      ];
      positions.set(corners, i * 24);
      for (let edge = 0; edge < EDGES.length; edge++)
        indices[i * 24 + edge] = i * 8 + EDGES[edge]!;
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
    geometry.setIndex(new T.BufferAttribute(indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const batch = new SelectionOutlineBatch(
      geometry,
      new T.LineBasicMaterial({
        color: group.active ? "#ffe3a1" : "#8ce1af",
        toneMapped: false,
      }),
    );
    batch.position.copy(group.origin);
    result.push(batch);
  }
  for (const entry of wide) {
    const helper = new SelectionOutlineHelper(
      entry.box.clone(),
      new T.Color(entry.active ? "#ffe3a1" : "#8ce1af"),
    );
    helper.material.toneMapped = false;
    result.push(helper);
  }
  return result;
}
