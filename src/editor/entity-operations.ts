import type { Material } from "../core/catalog";
import type { SceneEntity, Vec3 } from "../core/schema";
import { resolveEntityCapability, type CapabilityAction } from "../core/capabilities";
import {
  validateDocument,
  type EditorDocument,
  type EditorObject,
} from "./model";

/** Editing coverage is independent of registry, rendering and export coverage. */
export function entityEditCapability(type: string) {
  return resolveEntityCapability(type, "design");
}

function requireSupported(entity: SceneEntity, action: CapabilityAction): void {
  const capability = resolveEntityCapability(entity.type, action);
  if (!capability.supported) throw new Error(capability.reason);
}

function selected(document: EditorDocument, ids: string[], action: CapabilityAction): SceneEntity[] {
  if (!ids.length) throw new Error("Select at least one entity");
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate entity selection ID");
  const index = new Map(document.entities.map((entity) => [entity.id, entity]));
  return ids.map((id) => {
    const entity = index.get(id);
    if (!entity) throw new Error("Selected entity is missing");
    requireSupported(entity, action);
    return entity;
  });
}

function finiteVector(vector: Vec3): void {
  if (vector.length !== 3 || vector.some((value) => !Number.isFinite(value)))
    throw new Error("Entity movement requires three finite coordinates");
}

function normalizedYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) throw new Error("Entity yaw must be finite");
  const value = yaw % 360;
  return value === 0 ? 0 : value < 0 ? value + 360 : value;
}

function freshIds(document: EditorDocument, ids: string[]): void {
  const used = new Set(document.entities.map((entity) => entity.id));
  const visit = (object: EditorObject) => {
    used.add(object.id);
    object.children.forEach(visit);
  };
  document.objects.forEach(visit);
  for (const id of ids) {
    if (!id.trim()) throw new Error("A fresh entity ID is required");
    if (used.has(id)) throw new Error(`Entity ID is already used: ${id}`);
    used.add(id);
  }
}

function commit(
  document: EditorDocument,
  entities: SceneEntity[],
  catalog: Material[],
): EditorDocument {
  const candidate = { ...document, entities };
  validateDocument(candidate, catalog);
  return entities.length === document.entities.length &&
    entities.every((entity, index) => entity === document.entities[index])
    ? document
    : candidate;
}

export function addEntity(
  document: EditorDocument,
  entity: SceneEntity,
  catalog: Material[],
): EditorDocument {
  validateDocument(document, catalog);
  requireSupported(entity, "design");
  freshIds(document, [entity.id]);
  if (document.entities.length >= 1000)
    throw new Error("Document exceeds 1,000 entities");
  return commit(
    document,
    [
      ...document.entities,
      {
        ...entity,
        position: [...entity.position],
        yaw: normalizedYaw(entity.yaw),
      },
    ],
    catalog,
  );
}

export function moveEntities(
  document: EditorDocument,
  ids: string[],
  delta: Vec3,
  catalog: Material[],
): EditorDocument {
  validateDocument(document, catalog);
  selected(document, ids, "translate");
  finiteVector(delta);
  const selectedIds = new Set(ids);
  const entities = document.entities.map((entity) =>
    selectedIds.has(entity.id) && delta.some((value) => value !== 0)
      ? {
          ...entity,
          position: entity.position.map(
            (value, axis) => value + delta[axis],
          ) as Vec3,
        }
      : entity,
  );
  return commit(document, entities, catalog);
}

export function setEntityYaw(
  document: EditorDocument,
  ids: string[],
  yaw: number,
  catalog: Material[],
): EditorDocument {
  validateDocument(document, catalog);
  selected(document, ids, "yaw");
  const value = normalizedYaw(yaw),
    selectedIds = new Set(ids);
  const entities = document.entities.map((entity) =>
    selectedIds.has(entity.id) && entity.yaw !== value
      ? { ...entity, yaw: value }
      : entity,
  );
  return commit(document, entities, catalog);
}

/** Relative yaw preserves each selected entity's heading difference and position. */
export function rotateEntities(
  document: EditorDocument,
  ids: string[],
  degrees: number,
  catalog: Material[],
): EditorDocument {
  validateDocument(document, catalog);
  selected(document, ids, "yaw");
  const delta = normalizedYaw(degrees), selectedIds = new Set(ids);
  const entities = document.entities.map((entity) => {
    if (!selectedIds.has(entity.id) || delta === 0) return entity;
    const yaw = normalizedYaw(entity.yaw + delta);
    return yaw === entity.yaw ? entity : { ...entity, yaw };
  });
  return commit(document, entities, catalog);
}

/** Explicit IDs correspond to selection order. Overlap with blocks/entities is permitted. */
export function duplicateEntities(
  document: EditorDocument,
  ids: string[],
  newIds: string[],
  offset: Vec3,
  catalog: Material[],
): EditorDocument {
  validateDocument(document, catalog);
  const sources = selected(document, ids, "copy");
  if (newIds.length !== sources.length)
    throw new Error("One fresh ID per entity is required");
  if (document.entities.length + sources.length > 1000)
    throw new Error("Document exceeds 1,000 entities");
  freshIds(document, newIds);
  finiteVector(offset);
  const copies = sources.map((entity, index) => ({
    ...entity,
    id: newIds[index],
    position: entity.position.map(
      (value, axis) => value + offset[axis],
    ) as Vec3,
  }));
  return commit(document, [...document.entities, ...copies], catalog);
}

export function removeEntities(
  document: EditorDocument,
  ids: string[],
  catalog: Material[],
): EditorDocument {
  validateDocument(document, catalog);
  selected(document, ids, "remove");
  const selectedIds = new Set(ids);
  return commit(
    document,
    document.entities.filter((entity) => !selectedIds.has(entity.id)),
    catalog,
  );
}
