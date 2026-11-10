import { describe, expect, it } from "vitest";
import type { ResourceManifest } from "../core/resource-manifest";
import type { ComponentAsset } from "../editor/model";
import { thumbnailCache, thumbnailKey, validThumbnailBlob, THUMBNAIL_MAX_BYTES } from "./component-thumbnails";

const asset: ComponentAsset = { schemaVersion: 1, id: "asset", name: "Column", objects: [{ id: "block", name: "Block", kind: "block",
  cells: [{ pos: [0, 0, 0], state: { name: "minecraft:stone", properties: {} } }], children: [], pivot2: [1, 1, 1], orientation: 0 }],
  size: [1, 1, 1], pivot2: [1, 1, 1], orientation: 0 };
const manifest: ResourceManifest = { adapter: "blockstage-editor-v2-copy", profile: { sourceSha1: "a".repeat(40), sha256: "b".repeat(64) }, packs: [
  { name: "Base", fingerprint: "c".repeat(64), source: "client", enabled: true },
  { name: "Override", fingerprint: "d".repeat(64), source: "resource", enabled: true },
] };

describe("derived component thumbnail identity", () => {
  it("keeps label/category edits while invalidating geometry and resource changes", async () => {
    const key = await thumbnailKey(asset, manifest);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(await thumbnailKey({ ...asset, name: "Renamed", category: "column" }, manifest)).toBe(key);
    for (const next of [
      { ...manifest, profile: { ...manifest.profile!, sha256: "e".repeat(64) } },
      { ...manifest, packs: [...manifest.packs].reverse() },
      { ...manifest, packs: manifest.packs.map((pack, index) => index ? { ...pack, enabled: false } : pack) },
      { ...manifest, packs: [{ ...manifest.packs[0], fingerprint: "f".repeat(64) }, manifest.packs[1]] },
    ]) expect(await thumbnailKey(asset, next)).not.toBe(key);
    const moved = structuredClone(asset); moved.objects[0].cells[0].pos[0] = 1;
    expect(await thumbnailKey(moved, manifest)).not.toBe(key);
    expect(asset.objects[0].cells[0].pos).toEqual([0, 0, 0]);
  });
  it("does not persist ambiguous resource identities", async () => {
    expect(await thumbnailKey(asset, { ...manifest, profile: null })).toBeNull();
    expect(await thumbnailKey(asset, { ...manifest, packs: [] })).toBeNull();
    expect(await thumbnailKey(asset, { ...manifest, packs: [{ ...manifest.packs[0], fingerprint: null }] })).toBeNull();
  });
  it("accepts bounded PNG bytes and rejects corrupt/oversized/mislabelled payloads before IDB", async () => {
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const png = new Blob([signature], { type: "image/png" });
    expect(await validThumbnailBlob(png)).toBe(true);
    for (const bad of [new Blob([signature], { type: "image/svg+xml" }), new Blob(["not a png"], { type: "image/png" }),
      new Blob([new Uint8Array(THUMBNAIL_MAX_BYTES + 1)], { type: "image/png" })]) {
      expect(await validThumbnailBlob(bad)).toBe(false);
      await expect(thumbnailCache.put("a".repeat(64), bad)).rejects.toThrow(/PNG/);
    }
    await expect(thumbnailCache.put("bad key", png)).rejects.toThrow(/key/);
    await expect(thumbnailCache.get("bad key")).rejects.toThrow(/key/);
  });
});
