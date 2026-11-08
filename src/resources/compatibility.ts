import type { ResourceManifest } from "../io/portable-backup";

export type ResourceCompatibility = {
  profile: "matched" | "missing" | "different" | "unrecorded";
  packs: {
    name: string;
    fingerprint: string | null;
    status: "matched" | "disabled" | "missing" | "unverifiable";
  }[];
  orderMatches: boolean;
  extraEnabled: number;
};

/** Compare recorded identities only. Names never prove that two packs match. */
export function compareResourceManifest(
  required: ResourceManifest,
  current: ResourceManifest,
): ResourceCompatibility {
  const wanted = required.packs.filter((pack) => pack.enabled);
  const actual = current.packs.filter((pack) => pack.enabled);
  const used = new Set<number>();
  const packs: ResourceCompatibility["packs"] = wanted.map((pack) => {
    if (!pack.fingerprint)
      return { name: pack.name, fingerprint: null, status: "unverifiable" };
    // Prefer enabled matches, then consume disabled matches. Each actual pack
    // satisfies at most one recorded occurrence of the same fingerprint.
    let index = current.packs.findIndex((item, index) =>
      !used.has(index) && item.enabled && item.fingerprint === pack.fingerprint);
    if (index < 0)
      index = current.packs.findIndex((item, index) =>
        !used.has(index) && item.fingerprint === pack.fingerprint);
    if (index < 0)
      return { name: pack.name, fingerprint: pack.fingerprint, status: "missing" };
    used.add(index);
    return { name: pack.name, fingerprint: pack.fingerprint,
      status: current.packs[index].enabled ? "matched" : "disabled" };
  });
  const profile: ResourceCompatibility["profile"] = !required.profile
    ? "unrecorded"
    : !current.profile
      ? "missing"
      : required.profile.sha256 === current.profile.sha256 &&
          required.profile.sourceSha1 === current.profile.sourceSha1
        ? "matched" : "different";
  return {
    profile,
    packs,
    orderMatches: wanted.length === actual.length && wanted.every((pack, index) =>
      pack.fingerprint !== null && pack.fingerprint === actual[index].fingerprint),
    extraEnabled: current.packs.reduce((count, pack, index) =>
      count + Number(pack.enabled && !used.has(index)), 0),
  };
}
