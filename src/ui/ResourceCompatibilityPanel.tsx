import type { ResourceManifest } from "../io/portable-backup";
import type { ResourceSession } from "../resources/useResources";
import { compareResourceManifest } from "../resources/compatibility";

export function ResourceCompatibilityPanel({ required, current, resources, disabled }: {
  required: ResourceManifest;
  current: ResourceManifest;
  resources: ResourceSession;
  disabled: boolean;
}) {
  const comparison = compareResourceManifest(required, current);
  const busy = disabled || resources.busy || !resources.ready;
  return <details className="quiet-details storage-details" open aria-label="Backup resource compatibility">
    <summary>Resources · profile {comparison.profile}</summary>
    {required.profile && <p title={`Expected profile SHA-256: ${required.profile.sha256}`}>
      Expected client SHA-1: <code>{required.profile.sourceSha1}</code>
    </p>}
    <p>Match by fingerprint. Import your original files; game assets are not included in backups.</p>
    <div className="backup-actions">
      <label className={`button${busy ? " is-disabled" : ""}`}>Import profile
        <input className="visually-hidden" type="file" accept=".json" disabled={busy}
          aria-label="Relink backup game profile" onChange={(event) => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (file) void resources.importProfile(file);
          }} />
      </label>
      <label className={`button${busy ? " is-disabled" : ""}`}>Import ZIP / JAR
        <input className="visually-hidden" type="file" accept=".zip,.jar" disabled={busy}
          aria-label="Relink backup resource pack" onChange={(event) => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (file) void resources.importPack(file);
          }} />
      </label>
    </div>
    <ol aria-label="Required backup packs">
      {comparison.packs.map((pack, index) => {
        const match = pack.fingerprint && resources.packs.find((item) => item.fingerprint === pack.fingerprint && !item.enabled);
        return <li key={`${index}:${pack.fingerprint}`} title={pack.fingerprint ?? "No fingerprint recorded"}>
          {pack.name} · {pack.status}
          {pack.status === "disabled" && match && <button type="button" disabled={busy}
            aria-label={`Enable backup pack ${pack.name}`} onClick={() => void resources.togglePack(match.id)}>Enable</button>}
        </li>;
      })}
    </ol>
    <p>{comparison.orderMatches ? "Enabled pack order matches." : "Enabled pack order/content differs."}
      {comparison.extraEnabled > 0 && ` ${comparison.extraEnabled} additional enabled packs.`}</p>
    <details><summary>Adjust current stack</summary>
      <p>Highest priority first. Changes affect the shared resource preview, not stored blockstates.</p>
      <ul>{resources.packs.map((pack, index) => <li key={pack.id}>
        {pack.name} · {pack.enabled ? "enabled" : "disabled"}
        <button type="button" disabled={busy} aria-label={`Toggle backup resource ${pack.name}`}
          onClick={() => void resources.togglePack(pack.id)}>{pack.enabled ? "Disable" : "Enable"}</button>
        <button type="button" disabled={busy || index === 0} aria-label={`Raise backup resource ${pack.name}`}
          onClick={() => void resources.movePack(pack.id, "up")}>Up</button>
        <button type="button" disabled={busy || index === resources.packs.length - 1} aria-label={`Lower backup resource ${pack.name}`}
          onClick={() => void resources.movePack(pack.id, "down")}>Down</button>
      </li>)}</ul>
    </details>
    {resources.error && <p role="alert">{resources.error}</p>}
  </details>;
}
