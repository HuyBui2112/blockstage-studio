import { z } from "zod";
import {
  componentAssetSchema,
  editorDocumentSchema,
  type ComponentAsset,
  type EditorDocument,
  type EditorObject,
} from "../editor/model";
import type { GameProfile } from "../core/profile";
import { validateState, type Material } from "../core/catalog";
import { orderedPacks, type ResourcePack } from "./resources";

export const PORTABLE_MAX_BYTES = 32 * 1024 ** 2;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const packSchema = z
  .object({
    name: z.string().min(1).max(240),
    fingerprint: hash.nullable(),
    source: z.enum(["client", "resource", "unknown"]),
    enabled: z.boolean(),
  })
  .strict();
const manifestSchema = z
  .object({
    profile: z
      .object({ sourceSha1: z.string().regex(/^[a-f0-9]{40}$/), sha256: hash })
      .strict()
      .nullable(),
    packs: z.array(packSchema).max(256),
    adapter: z.literal("blockstage-editor-v2-copy"),
  })
  .strict();
export type ResourceManifest = z.infer<typeof manifestSchema>;
const bundleSchema = z
  .object({
    format: z.literal("blockstage-portable"),
    version: z.literal(1),
    document: editorDocumentSchema,
    components: z.array(componentAssetSchema).max(256),
    resources: manifestSchema,
  })
  .strict();
export type PortableBackup = z.infer<typeof bundleSchema>;
export type PortablePlan = {
  document: EditorDocument;
  components: ComponentAsset[];
};
export type BackupReport = {
  issues: string[];
  totalIssues: number;
  documentCells: number;
  componentCount: number;
};

/** Bound aggregate work before recursive Zod schemas, including caller-created cyclic objects. */
function boundInput(value: unknown) {
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [
      { value, depth: 0 },
    ],
    seen = new Set<object>();
  let nodes = 0,
    cells = 0,
    objects = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry.exit) {
      seen.delete(entry.value as object);
      continue;
    }
    if (++nodes > 2000000 || entry.depth > 64)
      throw new Error("Backup exceeds nesting/work limits");
    if (!entry.value || typeof entry.value !== "object") continue;
    if (seen.has(entry.value)) throw new Error("Backup contains cyclic data");
    seen.add(entry.value);
    stack.push({ ...entry, exit: true });
    if (Array.isArray(entry.value)) {
      if (entry.value.length > 100000)
        throw new Error("Backup array exceeds limits");
      for (const item of entry.value)
        stack.push({ value: item, depth: entry.depth + 1 });
    } else
      for (const [key, item] of Object.entries(entry.value)) {
        if (key === "cells" && Array.isArray(item)) cells += item.length;
        if (key === "objects" && Array.isArray(item)) objects += item.length;
        if (key === "children" && Array.isArray(item)) objects += item.length;
        if (cells > 100000 || objects > 100000)
          throw new Error("Backup exceeds aggregate 100,000 cells/objects");
        stack.push({ value: item, depth: entry.depth + 1 });
      }
  }
}
export function parsePortableBackup(value: unknown): PortableBackup {
  boundInput(value);
  const bundle = bundleSchema.parse(value);
  if (
    new Set(bundle.components.map((asset) => asset.id)).size !==
    bundle.components.length
  )
    throw new Error("Duplicate backup component ID");
  return bundle;
}
export function decodePortableBackup(text: string): PortableBackup {
  if (
    text.length > PORTABLE_MAX_BYTES ||
    new TextEncoder().encode(text).byteLength > PORTABLE_MAX_BYTES
  )
    throw new Error("Portable backup must be at most 32 MiB");
  return parsePortableBackup(JSON.parse(text));
}
export function encodePortableBackup(input: PortableBackup): string {
  const text = JSON.stringify(parsePortableBackup(input));
  if (new TextEncoder().encode(text).byteLength > PORTABLE_MAX_BYTES)
    throw new Error(
      "Portable backup exceeds 32 MiB. Export a smaller library selection.",
    );
  return text;
}
export async function resourceManifest(
  packs: readonly ResourcePack[],
  profile: GameProfile | null,
): Promise<ResourceManifest> {
  const profileHash = profile
    ? Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify(profile)),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("")
    : null;
  return manifestSchema.parse({
    adapter: "blockstage-editor-v2-copy",
    profile: profile
      ? { sourceSha1: profile.sourceSha1, sha256: profileHash }
      : null,
    packs: orderedPacks(packs).map((pack) => ({
      name: pack.name,
      fingerprint: pack.fingerprint ?? null,
      source: pack.source ?? "unknown",
      enabled: pack.enabled,
    })),
  });
}
function walk(objects: EditorObject[], visit: (object: EditorObject) => void) {
  for (const object of objects) {
    visit(object);
    walk(object.children, visit);
  }
}
export function reportPortableBackup(
  bundle: PortableBackup,
  current: ResourceManifest,
  catalog: Material[],
): BackupReport {
  const issues: string[] = [],
    unique = new Set<string>();
  let totalIssues = 0,
    documentCells = 0;
  const issue = (message: string) => {
    if (unique.has(message)) return;
    unique.add(message);
    totalIssues++;
    if (issues.length < 100) issues.push(message);
  };
  if (!bundle.resources.profile)
    issue(
      "The backup has no profile fingerprint; block compatibility is unverified.",
    );
  else if (!current.profile)
    issue("Game profile is missing. Import the matching profile in Resources.");
  else if (
    bundle.resources.profile.sha256 !== current.profile.sha256 ||
    bundle.resources.profile.sourceSha1 !== current.profile.sourceSha1
  )
    issue("Game profile fingerprint differs from the backup.");
  const wanted = bundle.resources.packs.filter((pack) => pack.enabled),
    actual = current.packs.filter((pack) => pack.enabled);
  for (const pack of wanted) {
    if (!pack.fingerprint) issue(`Pack fingerprint unavailable: ${pack.name}`);
    else if (!actual.some((item) => item.fingerprint === pack.fingerprint))
      issue(`Missing or disabled pack: ${pack.name}`);
  }
  if (
    wanted.length !== actual.length ||
    wanted.some(
      (pack, index) => pack.fingerprint !== actual[index]?.fingerprint,
    )
  )
    issue(
      "Enabled pack order/content differs. Reimport or reorder packs in Resources; this restore will not change them.",
    );
  const assets = new Set(bundle.components.map((asset) => asset.id)),
    materials = new Map(catalog.map((material) => [material.id, material]));
  const inspect = (object: EditorObject) => {
    if (object.componentId && !assets.has(object.componentId))
      issue(
        `Component source not bundled: ${object.componentId}. Placed copies remain self-contained.`,
      );
    for (const cell of object.cells) {
      const material = materials.get(cell.state.name);
      if (!material) issue(`Unknown block preserved: ${cell.state.name}`);
      else
        try {
          validateState(cell.state, [material]);
        } catch {
          issue(`Unsupported block state preserved: ${cell.state.name}`);
        }
    }
  };
  walk(bundle.document.objects, (object) => {
    documentCells += object.cells.length;
    inspect(object);
  });
  for (const asset of bundle.components) walk(asset.objects, inspect);
  if (!wanted.length)
    issue("No enabled resource packs were recorded; appearance is unverified.");
  return {
    issues,
    totalIssues,
    documentCells,
    componentCount: bundle.components.length,
  };
}
/** IDs are allocated once for a reviewable restore; all coordinate/state data stays unchanged. */
export function planPortableRestore(
  input: PortableBackup,
  allocate: () => string = () => crypto.randomUUID(),
): PortablePlan {
  const bundle = parsePortableBackup(input),
    used = new Set<string>();
  used.add(bundle.document.id);
  for (const entity of bundle.document.entities) used.add(entity.id);
  walk(bundle.document.objects, (object) => used.add(object.id));
  for (const asset of bundle.components) {
    used.add(asset.id);
    walk(asset.objects, (object) => used.add(object.id));
  }
  const fresh = () => {
    const id = allocate();
    if (!id || id.length > 200 || used.has(id))
      throw new Error("Restore allocator must provide unique valid IDs");
    used.add(id);
    return id;
  };
  const assetIds = new Map(
    bundle.components.map((asset) => [asset.id, fresh()]),
  );
  const remap = (objects: EditorObject[]): EditorObject[] =>
    objects.map((object) => ({
      ...object,
      id: fresh(),
      children: remap(object.children),
      ...(object.componentId && assetIds.has(object.componentId)
        ? { componentId: assetIds.get(object.componentId)! }
        : {}),
    }));
  const document = {
    ...bundle.document,
    id: fresh(),
    objects: remap(bundle.document.objects),
    entities: bundle.document.entities.map((entity) => ({
      ...entity,
      id: fresh(),
    })),
  };
  const components = bundle.components.map((asset) => ({
    ...asset,
    id: assetIds.get(asset.id)!,
    objects: remap(asset.objects),
  }));
  return {
    document: editorDocumentSchema.parse(document),
    components: components.map((asset) => componentAssetSchema.parse(asset)),
  };
}
