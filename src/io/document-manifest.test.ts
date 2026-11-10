import { describe, expect, it } from "vitest";
import { resourceManifestSchema, type ResourceManifest } from "../core/resource-manifest";
import { editorDocumentSchema, newEditorDocument } from "../editor/model";
import { decodePortableBackup, encodePortableBackup, parsePortableBackup, planPortableRestore, reportPortableBackup, type PortableBackup } from "./portable-backup";

const manifest: ResourceManifest = {
  adapter: "blockstage-editor-v2-copy",
  profile: { sourceSha1: "a".repeat(40), sha256: "b".repeat(64) },
  packs: [{ name: "Client.jar", fingerprint: "c".repeat(64), source: "client", enabled: true }],
};

describe("additive document resource manifest", () => {
  it("keeps old v2 documents unchanged and retains an optional manifest through JSON", () => {
    const legacy = newEditorDocument();
    expect(editorDocumentSchema.parse(legacy)).toEqual(legacy);
    expect(Object.hasOwn(editorDocumentSchema.parse(legacy), "resources")).toBe(false);
    const recorded = { ...legacy, resources: manifest };
    expect(editorDocumentSchema.parse(JSON.parse(JSON.stringify(recorded)))).toEqual(recorded);
  });

  it("rejects malformed hashes, unbounded stacks and asset fields instead of silently dropping them", () => {
    for (const resources of [
      { ...manifest, profile: { ...manifest.profile, sha256: "bad" } },
      { ...manifest, packs: [{ ...manifest.packs[0], fingerprint: "C".repeat(64) }] },
      { ...manifest, packs: Array.from({ length: 257 }, () => manifest.packs[0]) },
      { ...manifest, files: {} },
      { ...manifest, packs: [{ ...manifest.packs[0], files: { secret: "bytes" } }] },
      { ...manifest, profile: { ...manifest.profile, geometry: {} } },
    ]) expect(() => editorDocumentSchema.parse({ ...newEditorDocument(), resources })).toThrow();
    expect(resourceManifestSchema.parse({ ...manifest, packs: Array.from({ length: 256 }, () => manifest.packs[0]) }).packs).toHaveLength(256);
    const oversized = Array.from({ length: 257 }, () => manifest.packs[0]);
    Object.defineProperty(oversized, "0", { get() { throw new Error("PACK READ"); } });
    expect(() => editorDocumentSchema.parse({ ...newEditorDocument(), resources: { ...manifest, packs: oversized } })).toThrow(/256 packs/);
  });

  it("restores fresh IDs while retaining recorded document expectations over the backup's current stack", () => {
    const recorded = { ...manifest, packs: [{ ...manifest.packs[0], fingerprint: "d".repeat(64) }] };
    const bundle: PortableBackup = { format: "blockstage-portable", version: 1,
      document: { ...newEditorDocument(), resources: recorded }, components: [], resources: manifest };
    const plan = planPortableRestore(decodePortableBackup(encodePortableBackup(bundle)), () => "fresh-document");
    expect(plan.document.id).toBe("fresh-document");
    expect(plan.document.id).not.toBe(bundle.document.id);
    expect(plan.document.resources).toEqual(recorded);
    expect(bundle.document.resources).toEqual(recorded);
    expect(reportPortableBackup(bundle, manifest, []).issues).toContain("Recorded document pack Client.jar: missing.");
  });

  it("uses the recorded backup manifest for an older document without expectations", () => {
    const bundle: PortableBackup = { format: "blockstage-portable", version: 1,
      document: newEditorDocument(), components: [], resources: manifest };
    expect(planPortableRestore(bundle, () => "fresh-document").document.resources).toEqual(manifest);
    expect(Object.hasOwn(bundle.document, "resources")).toBe(false);
  });

  it("bounds nested document manifest stacks before reading their entries", () => {
    const packs = Array.from({ length: 257 }, () => manifest.packs[0]);
    Object.defineProperty(packs, "0", { get() { throw new Error("PACK READ"); } });
    expect(() => parsePortableBackup({ format: "blockstage-portable", version: 1,
      document: { ...newEditorDocument(), resources: { ...manifest, packs } },
      components: [], resources: manifest })).toThrow(/256 packs/);
  });
});
