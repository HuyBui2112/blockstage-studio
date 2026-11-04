export type ResourcePack = {
  id: string;
  name: string;
  gameVersion: string;
  enabled: boolean;
  priority: number;
  files: Record<string, Uint8Array>;
  counts: {
    textures: number;
    models: number;
    blockstates: number;
    entityTextures: number;
  };
  packFormat?: unknown;
  source?: "client" | "resource";
  fingerprint?: string;
  sourceSha1?: string;
};
export function orderedPacks(packs: readonly ResourcePack[]): ResourcePack[] {
  return [...packs].sort(
    (a, b) =>
      b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
/** Build once per immutable stack and share this index with model/texture consumers. */
export function effectiveAssetIndex(
  packs: readonly ResourcePack[],
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const pack of orderedPacks(packs)) {
    if (!pack.enabled || pack.gameVersion !== "26.2") continue;
    for (const [path, bytes] of Object.entries(pack.files))
      if (!files.has(path)) files.set(path, bytes);
  }
  return files;
}
export async function importPack(file: File): Promise<ResourcePack> {
  if (file.size > 128 * 1024 ** 2) throw new Error("ZIP/JAR tối đa 128 MiB");
  const bytes = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./resources.worker.ts", import.meta.url),
      { type: "module" },
    );
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("Đọc gói vượt quá 30 giây"));
    }, 30000);
    const stop = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    worker.onmessage = (
      e: MessageEvent<{ pack?: ResourcePack; error?: string }>,
    ) => {
      stop();
      if (e.data.error) reject(new Error(e.data.error));
      else if (e.data.pack) resolve(e.data.pack);
      else reject(new Error("Worker không trả về gói tài nguyên"));
    };
    worker.onerror = () => {
      stop();
      reject(new Error("Không thể đọc ZIP/JAR"));
    };
    worker.onmessageerror = () => {
      stop();
      reject(new Error("Không thể nhận gói tài nguyên"));
    };
    try {
      worker.postMessage({ bytes, name: file.name }, [bytes]);
    } catch (error) {
      stop();
      reject(error);
    }
  });
}
export function asset(
  packs: ResourcePack[],
  path: string,
): Uint8Array | undefined {
  return orderedPacks(packs).find(
    (p) => p.enabled && p.gameVersion === "26.2" && p.files[path],
  )?.files[path];
}
export function texturePaths(
  id: string,
  properties: Record<string, string>,
): string[] {
  const [ns, name] = id.split(":");
  const base = `assets/${ns}/textures/block/`;
  const texture = name.endsWith("_slab")
    ? name.replace("_slab", "s")
    : name.endsWith("_stairs")
      ? name.replace("_stairs", "_planks")
      : name;
  const side = `${base}${texture}.png`,
    end = `${base}${name}_top.png`;
  if (name.endsWith("_log"))
    return properties.axis === "x"
      ? [end, end, side, side, side, side]
      : properties.axis === "z"
        ? [side, side, side, side, end, end]
        : [side, side, end, end, side, side];
  return Array(6).fill(side) as string[];
}
