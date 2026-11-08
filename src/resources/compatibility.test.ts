import { describe, expect, it } from "vitest";
import type { ResourceManifest } from "../io/portable-backup";
import { compareResourceManifest } from "./compatibility";

const profile = { sourceSha1: "a".repeat(40), sha256: "b".repeat(64) };
const pack = (fingerprint: string | null, enabled = true, name = "Pack") => ({
  name, fingerprint, enabled, source: "resource" as const,
});
const manifest = (packs: ResourceManifest["packs"] = [],
  value: ResourceManifest["profile"] = profile): ResourceManifest => ({
  adapter: "blockstage-editor-v2-copy", profile: value, packs,
});
const a = "a".repeat(64), b = "b".repeat(64);

describe("recorded resource compatibility", () => {
  it("compares both profile hashes and distinguishes absent references", () => {
    expect(compareResourceManifest(manifest(), manifest()).profile).toBe("matched");
    expect(compareResourceManifest(manifest(), manifest([], null)).profile).toBe("missing");
    expect(compareResourceManifest(manifest([], null), manifest()).profile).toBe("unrecorded");
    for (const different of [{ ...profile, sha256: a }, { ...profile, sourceSha1: "c".repeat(40) }])
      expect(compareResourceManifest(manifest(), manifest([], different)).profile).toBe("different");
  });
  it("distinguishes missing and disabled exact packs without matching names", () => {
    const result = compareResourceManifest(manifest([pack(a), pack(b)]), manifest([pack(a, false), pack("c".repeat(64))]));
    expect(result.packs.map((entry) => entry.status)).toEqual(["disabled", "missing"]);
    expect(result.extraEnabled).toBe(1);
    expect(result.orderMatches).toBe(false);
  });
  it("never uses unavailable fingerprints as compatibility proof", () => {
    const result = compareResourceManifest(manifest([pack(null)]), manifest([pack(null)]));
    expect(result.packs[0].status).toBe("unverifiable");
    expect(result.orderMatches).toBe(false);
    expect(result.extraEnabled).toBe(1);
  });
  it("checks exact enabled precedence while ignoring recorded disabled packs", () => {
    const required = manifest([pack(a), pack(b), pack(null, false)]);
    expect(compareResourceManifest(required, manifest([pack(a), pack(b)])).orderMatches).toBe(true);
    const reordered = compareResourceManifest(required, manifest([pack(b), pack(a)]));
    expect(reordered.packs.every((entry) => entry.status === "matched")).toBe(true);
    expect(reordered.orderMatches).toBe(false);
    expect(reordered.extraEnabled).toBe(0);
    expect(compareResourceManifest(manifest(), manifest()).orderMatches).toBe(true);
  });
  it("consumes duplicate fingerprints once per occurrence, preferring enabled packs", () => {
    const required = manifest([pack(a), pack(a)]);
    const current = manifest([pack(a, false), pack(a)]);
    expect(compareResourceManifest(required, current).packs.map((entry) => entry.status)).toEqual(["matched", "disabled"]);
    expect(compareResourceManifest(required, manifest([pack(a)])).packs.map((entry) => entry.status)).toEqual(["matched", "missing"]);
    const extra = compareResourceManifest(manifest([pack(a)]), manifest([pack(a), pack(a)]));
    expect(extra.extraEnabled).toBe(1);
    expect(extra.orderMatches).toBe(false);
  });
  it("does not mutate either manifest or reorder the input stack", () => {
    const required = manifest([pack(a), pack(b)]), current = manifest([pack(b), pack(a)]);
    const before = structuredClone({ required, current });
    compareResourceManifest(required, current);
    expect({ required, current }).toEqual(before);
  });
});
