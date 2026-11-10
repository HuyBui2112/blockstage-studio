import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const packSchema = z.object({
  name: z.string().min(1).max(240),
  fingerprint: hash.nullable(),
  source: z.enum(["client", "resource", "unknown"]),
  enabled: z.boolean(),
}).strict();

/** Fingerprints and precedence only; never game files or profile geometry. */
export const resourceManifestSchema = z.object({
  profile: z.object({
    sourceSha1: z.string().regex(/^[a-f0-9]{40}$/),
    sha256: hash,
  }).strict().nullable(),
  packs: z.preprocess((value, context) => {
    if (Array.isArray(value) && value.length > 256) {
      context.addIssue({ code: "custom", message: "Resource manifest exceeds 256 packs" });
      return z.NEVER;
    }
    return value;
  }, z.array(packSchema).max(256)),
  adapter: z.literal("blockstage-editor-v2-copy"),
}).strict();

export type ResourceManifest = z.infer<typeof resourceManifestSchema>;
