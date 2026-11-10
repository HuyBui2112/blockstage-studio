import type { ResourceManifest } from "../core/resource-manifest";
import type { ComponentAsset } from "../editor/model";

export const THUMBNAIL_DATABASE = "blockstage-component-thumbnails";
export const THUMBNAIL_MAX_BYTES = 256 * 1024;
export const THUMBNAIL_CACHE_BYTES = 8 * 1024 * 1024;
export const THUMBNAIL_CACHE_ENTRIES = 64;
const validKey = (key: string) => /^[a-f0-9]{64}$/.test(key);
const png = [137, 80, 78, 71, 13, 10, 26, 10];

/** Render identity excludes editable labels, but includes the exact ordered resource stack. */
export async function thumbnailKey(asset: ComponentAsset, manifest: ResourceManifest): Promise<string | null> {
  const enabled = manifest.packs.filter((pack) => pack.enabled);
  if (!manifest.profile || !enabled.length || enabled.some((pack) => !pack.fingerprint)) return null;
  const text = JSON.stringify({ renderer: "component-thumbnail-v1", objects: asset.objects,
    size: asset.size, pivot2: asset.pivot2, orientation: asset.orientation,
    profile: manifest.profile,
    packs: manifest.packs.map(({ fingerprint, enabled }) => ({ fingerprint, enabled })),
  });
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > 16 * 1024 * 1024) throw new Error("Component thumbnail identity exceeds 16 MiB");
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function validThumbnailBlob(blob: unknown): Promise<boolean> {
  if (!(blob instanceof Blob) || blob.type !== "image/png" || blob.size < 8 || blob.size > THUMBNAIL_MAX_BYTES) return false;
  const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  return png.every((value, index) => bytes[index] === value);
}

type Entry = { key: string; blob: Blob; used: number };
function validEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Entry;
  return typeof entry.key === "string" && validKey(entry.key) && entry.blob instanceof Blob &&
    entry.blob.type === "image/png" && entry.blob.size >= 8 && entry.blob.size <= THUMBNAIL_MAX_BYTES &&
    Number.isFinite(entry.used) && entry.used >= 0;
}
let opened: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(THUMBNAIL_DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("thumbnails"))
        request.result.createObjectStore("thumbnails", { keyPath: "key" });
    };
    request.onblocked = () => { blocked = true; reject(new Error("Thumbnail cache is blocked by another tab")); };
    request.onerror = () => reject(request.error ?? new Error("Thumbnail cache unavailable"));
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); opened = undefined; };
      resolve(db);
    };
  }).catch((error) => { opened = undefined; throw error; });
  return opened;
}

/** Disposable derived-image cache. Never opens or evicts the editor's document database. */
export const thumbnailCache = {
  async get(key: string): Promise<Blob | null> {
    if (!validKey(key)) throw new Error("Invalid thumbnail key");
    const db = await database();
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction("thumbnails", "readwrite"), store = tx.objectStore("thumbnails");
      let result: Blob | null = null;
      const request = store.get(key);
      request.onsuccess = () => {
        if (validEntry(request.result) && request.result.key === key) {
          result = request.result.blob;
          store.put({ ...request.result, used: Date.now() });
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? request.error ?? new Error("Thumbnail cache read failed"));
    });
    return await validThumbnailBlob(blob) ? blob : null;
  },
  async put(key: string, blob: Blob): Promise<void> {
    if (!validKey(key)) throw new Error("Invalid thumbnail key");
    if (!await validThumbnailBlob(blob)) throw new Error("Thumbnail must be a PNG of at most 256 KiB");
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("thumbnails", "readwrite"), store = tx.objectStore("thumbnails");
      const entries: { key: IDBValidKey; bytes: number; used: number }[] = [];
      let count = 0, failure: Error | undefined;
      store.put({ key, blob, used: Date.now() } satisfies Entry);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (++count > 256) {
            failure = new Error("Thumbnail cache contains too many records"); tx.abort(); return;
          }
          if (validEntry(cursor.value)) entries.push({ key: cursor.primaryKey, bytes: cursor.value.blob.size, used: cursor.value.used });
          else cursor.delete();
          cursor.continue();
          return;
        }
        entries.sort((a, b) => Number(a.key === key) - Number(b.key === key) || a.used - b.used || String(a.key).localeCompare(String(b.key)));
        let bytes = entries.reduce((total, entry) => total + entry.bytes, 0), remaining = entries.length;
        for (const entry of entries) {
          if (remaining <= THUMBNAIL_CACHE_ENTRIES && bytes <= THUMBNAIL_CACHE_BYTES) break;
          store.delete(entry.key); remaining--; bytes -= entry.bytes;
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? request.error ?? new Error("Thumbnail cache write failed"));
    });
  },
};
