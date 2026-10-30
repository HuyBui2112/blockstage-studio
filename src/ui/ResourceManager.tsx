import { useEffect, useMemo, useRef, useState } from 'react'
import type { ResourcePack } from '../io/resources'
import type { useResources } from '../resources/useResources'
import { Dialog } from './Dialog'
import { Icon } from './Icon'

type Resources = ReturnType<typeof useResources>

function PackContents({ pack }: { pack: ResourcePack }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [imageError, setImageError] = useState(false)
  const image = useRef<HTMLImageElement>(null)
  const paths = useMemo(() => Object.keys(pack.files).filter(path => path.endsWith('.png')).sort(), [pack.files])
  const filtered = useMemo(() => paths.filter(path => path.toLowerCase().includes(query.toLowerCase())), [paths, query])
  const bytes = pack.files[selected]
  useEffect(() => {
    if (!bytes || !image.current) return
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'image/png' }))
    image.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [bytes])
  return <div className="pack-contents"><label className="resource-search"><Icon name="search" size={15} /><input aria-label={`Search textures in ${pack.name}`} placeholder="Find a texture…" value={query} onChange={event => setQuery(event.target.value)} /></label><div className="texture-browser"><div className="texture-paths">{filtered.slice(0, 50).map(path => <button key={path} className={path === selected ? 'selected' : ''} title={path} onClick={() => setSelected(path)}>{path.replace(/^assets\//, '')}</button>)}{!filtered.length && <span className="muted">No textures</span>}</div><div className="texture-preview">{selected ? <><img ref={image} alt={selected} hidden={imageError} onLoad={() => setImageError(false)} onError={() => setImageError(true)} />{imageError && <span className="muted">Cannot decode this texture</span>}</> : <Icon name="grid" size={28} />}</div></div><small className="muted">{filtered.length.toLocaleString()} textures{filtered.length > 50 ? ' · refine search to see more' : ''}</small></div>
}

function PackRow({ pack, resources, index }: { pack: ResourcePack; resources: Resources; index: number }) {
  const [expanded, setExpanded] = useState(false)
  return <article className={`pack-card${pack.enabled ? '' : ' disabled'}`} data-pack={pack.id}>
    <div className="pack-main"><Icon name={pack.source === 'client' ? 'cube' : 'layers'} size={22} /><div className="pack-identity"><strong title={pack.name}>{pack.name}</strong><small>{pack.source === 'client' ? 'Client assets' : pack.source === 'resource' ? 'Resource pack' : 'Imported assets'} · Java {pack.gameVersion}</small></div><label className="pack-toggle"><input type="checkbox" aria-label={`Enable ${pack.name}`} checked={pack.enabled} disabled={resources.busy} onChange={() => void resources.togglePack(pack.id)} /><span /></label></div>
    <div className="pack-summary"><span>{pack.counts.textures.toLocaleString()} textures</span><span>{pack.counts.models.toLocaleString()} models</span><span>{pack.counts.blockstates.toLocaleString()} states</span></div>
    <div className="pack-actions"><span className="pack-priority">{index === 0 ? 'Highest priority' : `Priority ${index + 1}`}</span><button className="icon-button" aria-label={`Move ${pack.name} up`} title="Higher priority" disabled={resources.busy || index === 0} onClick={() => void resources.movePack(pack.id, 'up')}><Icon name="arrow-up" size={15} /></button><button className="icon-button" aria-label={`Move ${pack.name} down`} title="Lower priority" disabled={resources.busy || index === resources.packs.length - 1} onClick={() => void resources.movePack(pack.id, 'down')}><Icon name="arrow-down" size={15} /></button><button className="icon-button" aria-label={`Remove ${pack.name}`} title="Remove pack" disabled={resources.busy} onClick={() => void resources.removePack(pack.id)}><Icon name="trash" size={15} /></button></div>
    <details className="quiet-details" onToggle={event => setExpanded(event.currentTarget.open)}><summary>Browse textures & details</summary>{expanded && <><PackContents pack={pack} /><dl className="pack-metadata"><dt>Entity textures</dt><dd>{pack.counts.entityTextures}</dd>{pack.fingerprint && <><dt>SHA-256</dt><dd><code>{pack.fingerprint}</code></dd></>}</dl></>}</details>
  </article>
}

export function ResourceManager({ resources, onClose }: { resources: Resources; onClose: () => void }) {
  const { busy, ready, profile, packs, error } = resources
  return <Dialog title="Resources" onClose={onClose}>
    <div className="dialog-content">
      <div className="import-actions"><label className={`button primary${busy ? ' is-disabled' : ''}`}><Icon name="upload" size={16} />{busy ? 'Working…' : 'Import ZIP / JAR'}<input className="visually-hidden" disabled={busy || !ready} type="file" accept=".zip,.jar" aria-label="Import resource pack" onChange={event => { const file = event.target.files?.[0]; if (file) void resources.importPack(file); event.target.value = '' }} /></label><label className={`button${busy ? ' is-disabled' : ''}`}><Icon name="file" size={16} />Import game profile<input className="visually-hidden" disabled={busy || !ready} type="file" accept=".json" aria-label="Import game profile" onChange={event => { const file = event.target.files?.[0]; if (file) void resources.importProfile(file); event.target.value = '' }} /></label></div>
      {error && <div className="inline-error" role="alert"><Icon name="warning" size={16} /><span>{error}</span><button className="icon-button" aria-label="Dismiss import error" onClick={resources.clearError}><Icon name="close" size={14} /></button></div>}
      <div className="profile-summary"><Icon name={profile ? 'check' : 'info'} size={17} /><div><strong>{profile ? `Java ${profile.gameVersion} registry` : 'Sample registry'}</strong><span>{profile ? `${profile.blocks.length.toLocaleString()} blocks · ${profile.entities.length} entities · ${profile.creativeTabs.length} creative tabs` : 'Import a game profile for the full catalog and entity geometry'}</span></div><span className="preview-badge">{profile ? profile.dataVersion : 'Limited'}</span></div>
      <div className="section-title"><h3>Asset stack</h3><span>{packs.length} packs</span></div>
      {!packs.length ? <div className="empty-state"><Icon name="layers" size={34} /><strong>Your resources, locally</strong><p>Import the Minecraft Java 26.2 client JAR or a compatible resource pack.</p></div> : <div className="pack-list">{packs.map((pack, index) => <PackRow key={pack.id} pack={pack} resources={resources} index={index} />)}</div>}
      <details className="quiet-details import-help"><summary>Which files should I import?</summary><p>Use the vanilla <code>26.2.jar</code> client file for base models and textures. A Fabric Loader JAR contains the loader, not the game assets. Resource pack ZIPs must support format 88.0; packs higher in the stack override matching files below.</p><p>The game profile is a separate <code>26.2.profile.json</code> extracted from your client JAR. In this repository, run <code>pnpm prepare:game</code> and import the file from <code>public/generated/</code>. Development can load that local profile automatically.</p><p>Files stay in this browser's IndexedDB. Changing browser, site address or port uses a different resource store. Saved architecture projects remain untouched.</p></details>
    </div>
    <footer className="dialog-footer"><Icon name="eye" size={14} /><span>Stored on this device · no uploads</span><button className="button" onClick={onClose}>Done</button></footer>
  </Dialog>
}
