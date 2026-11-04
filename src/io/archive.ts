import { unzipSync, strFromU8 } from "fflate";
import type { ResourcePack } from "./resources";

export function parsePack(bytes: Uint8Array, name: string): ResourcePack {
  if (bytes.byteLength > 128 * 1024 ** 2)
    throw new Error("ZIP/JAR tối đa 128 MiB");
  let total = 0,
    count = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      if (++count > 60000) throw new Error("Quá nhiều tệp trong gói");
      if (
        f.name.includes("..") ||
        f.name.startsWith("/") ||
        f.name.includes("\\")
      )
        throw new Error("Đường dẫn ZIP không hợp lệ");
      const keep =
        /^(pack\.mcmeta|version\.json)$/.test(f.name) ||
        /^assets\/[a-z0-9_.-]+\/(textures\/.+\.png(?:\.mcmeta)?|models\/.+\.json|blockstates\/.+\.json|lang\/(en_us|vi_vn)\.json)$/.test(
          f.name,
        );
      if (keep) {
        // Stored ZIP entries are copied by their compressed length. Reject inconsistent
        // metadata before allocating, rather than trusting a smaller advertised size.
        if (f.compression === 0 && f.size !== f.originalSize)
          throw new Error("Invalid stored ZIP entry size");
        total += f.originalSize;
        if (f.originalSize > 32 * 1024 ** 2 || total > 256 * 1024 ** 2)
          throw new Error(
            "Gói vượt giới hạn giải nén (32 MiB/tệp, 256 MiB/gói)",
          );
      }
      return keep;
    },
  });
  const version = files["version.json"]
    ? (JSON.parse(strFromU8(files["version.json"])) as {
        id: string;
        world_version: number;
      })
    : undefined;
  if (version && (version.id !== "26.2" || version.world_version !== 4903))
    throw new Error(
      "Bản nền chỉ dùng client JAR của Java 26.2 (DataVersion 4903)",
    );
  const mcmeta = files["pack.mcmeta"]
    ? (JSON.parse(strFromU8(files["pack.mcmeta"])) as {
        pack?: {
          pack_format?: number;
          min_format?: number | number[];
          max_format?: number | number[];
        };
      })
    : undefined;
  if (!version && !mcmeta?.pack)
    throw new Error("Thiếu pack.mcmeta ở gốc ZIP hoặc version.json trong JAR");
  const packFormat = mcmeta?.pack?.pack_format ?? mcmeta?.pack?.min_format;
  const pair = (
    v: number | number[] | undefined,
  ): [number, number] | undefined => {
    if (typeof v === "number" && Number.isInteger(v)) return [v, 0];
    if (Array.isArray(v) && v.length === 2 && v.every(Number.isInteger))
      return [v[0], v[1]];
    return undefined;
  };
  if (!version) {
    const lo = pair(mcmeta?.pack?.min_format ?? mcmeta?.pack?.pack_format);
    const hi = pair(mcmeta?.pack?.max_format ?? mcmeta?.pack?.pack_format);
    if (!lo || !hi || lo[0] > 88 || (lo[0] === 88 && lo[1] > 0) || hi[0] < 88)
      throw new Error(
        "Gói không khai báo hỗ trợ resource pack format 88.0 (Java 26.2)",
      );
  }
  const paths = Object.keys(files);
  if (!paths.some((p) => p.startsWith("assets/")))
    throw new Error("Không có tài nguyên assets/");
  const pack: ResourcePack = {
    id: crypto.randomUUID(),
    name,
    gameVersion: "26.2",
    source: version ? "client" : "resource",
    enabled: true,
    priority: Date.now(),
    files,
    packFormat,
    counts: {
      textures: paths.filter(
        (p) => p.includes("/textures/") && p.endsWith(".png"),
      ).length,
      entityTextures: paths.filter(
        (p) => p.includes("/textures/entity/") && p.endsWith(".png"),
      ).length,
      models: paths.filter((p) => p.includes("/models/")).length,
      blockstates: paths.filter((p) => p.includes("/blockstates/")).length,
    },
  };
  return pack;
}
