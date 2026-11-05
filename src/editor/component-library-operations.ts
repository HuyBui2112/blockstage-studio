import { componentAssetSchema, type ComponentAsset, type EditorObject } from "./model";

export function renameComponentAsset(asset: ComponentAsset, name: string): ComponentAsset {
  return componentAssetSchema.parse({ ...asset, name: name.trim() });
}

/** Independent library copy: source references remain provenance, never live links. */
export function duplicateComponentAsset(
  asset: ComponentAsset,
  existingAssets: readonly ComponentAsset[],
  idFactory: () => string,
): ComponentAsset {
  const source = componentAssetSchema.parse(asset);
  const used = new Set<string>();
  const reserve = (objects: readonly EditorObject[]) => {
    for (const object of objects) {
      used.add(object.id);
      if (object.componentId) used.add(object.componentId);
      reserve(object.children);
    }
  };
  for (const existing of [...existingAssets, source]) {
    used.add(existing.id);
    reserve(existing.objects);
  }
  const freshId = () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = idFactory();
      if (typeof id === "string" && id.length > 0 && id.length <= 200 && !used.has(id)) {
        used.add(id);
        return id;
      }
    }
    throw new Error("Could not allocate a fresh component ID. Please retry.");
  };
  const copy = (object: EditorObject): EditorObject => ({
    ...object,
    id: freshId(),
    children: object.children.map(copy),
  });
  return componentAssetSchema.parse({
    ...source,
    id: freshId(),
    name: `${source.name.slice(0, 115)} copy`,
    objects: source.objects.map(copy),
  });
}
