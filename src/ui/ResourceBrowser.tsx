import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { Material } from '../core/catalog'
import { resourceName } from '../core/labels'
import type { GameProfile } from '../core/profile'
import { entityAppearance } from '../render/entities'
import type { ModelResolver } from '../render/models'
import { Icon } from './Icon'

type Props = { catalog: Material[]; profile: GameProfile | null; resolver: ModelResolver; kind: 'block' | 'entity'; selected: string; onKind: (kind: 'block' | 'entity') => void; onSelect: (id: string) => void; blocksOnly?: boolean }
const PAGE_SIZE = 60

function spritePath(material: Material, resolver: ModelResolver) {
  try {
    const block = resolver.resolve({ name: material.id, properties: material.defaults })
    for (const { model } of block.parts) {
      for (const key of ['all', 'side', 'front', 'top', 'particle', ...Object.keys(model.textures ?? {})]) {
        try { return resolver.texture(model, '#' + key) } catch { /* A different face may be available. */ }
      }
    }
  } catch { /* Missing or special models use an honest generic icon. */ }
  return undefined
}

const TextureThumbnail = memo(function TextureThumbnail({ material, resolver }: { material: Material; resolver: ModelResolver }) {
  const image = useRef<HTMLImageElement>(null)
  const path = useMemo(() => spritePath(material, resolver), [material, resolver])
  const bytes = path ? resolver.files.get(path) : undefined
  useEffect(() => {
    if (!bytes || !image.current) return
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'image/png' }))
    image.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [bytes])
  return <span className={`resource-thumb${bytes ? ' has-texture' : ''}`} title={bytes ? 'Texture sample · see 3D preview for appearance' : 'No texture sample'}>
    <Icon name="cube" size={23} />{bytes && <img ref={image} alt="" onLoad={event => { event.currentTarget.hidden = false }} onError={event => { event.currentTarget.hidden = true }} />}
  </span>
})

export function ResourceBrowser(p: Props) {
  const [query, setQuery] = useState('')
  const [facet, setFacet] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const tags = useMemo(() => [...new Set(p.catalog.flatMap(m => m.tags ?? []))].sort(), [p.catalog])
  const blocks = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return p.catalog.filter(m => (!needle || `${m.id} ${resourceName(m.id)} ${m.label} ${(m.tags ?? []).join(' ')}`.toLowerCase().includes(needle)) && (!facet || (facet.startsWith('tab:') ? m.creativeTabs?.includes(facet.slice(4)) : m.tags?.includes(facet.slice(4)))))
  }, [p.catalog, query, facet])
  const entities = useMemo(() => {
    const needle = query.trim().toLowerCase().replaceAll(' ', '_')
    return p.profile?.entities.filter(e => !needle || e.id.includes(needle) || e.category.toLowerCase().includes(needle)) ?? []
  }, [p.profile, query])
  const count = p.kind === 'block' ? blocks.length : entities.length
  const resetSearch = (value: string) => { setQuery(value); setLimit(PAGE_SIZE) }

  return <>
    <div className="panel-heading"><span>Asset library</span><span className="panel-eyebrow">26.2</span></div>
    <div className="resource-tabs" aria-label="Resource type">
      <button className={p.kind === 'block' ? 'active' : ''} aria-pressed={p.kind === 'block'} onClick={() => { p.onKind('block'); setLimit(PAGE_SIZE) }}><Icon name="cube" size={16} />Blocks<span>{p.catalog.length.toLocaleString()}</span></button>
      {!p.blocksOnly && <button className={p.kind === 'entity' ? 'active' : ''} aria-pressed={p.kind === 'entity'} onClick={() => { p.onKind('entity'); setLimit(PAGE_SIZE) }}><Icon name="entity" size={16} />Entities<span>{p.profile?.entities.length ?? 0}</span></button>}
    </div>
    <div className="browser-tools">
      <label className="resource-search"><Icon name="search" size={16} /><input aria-label="Search resources" placeholder={`Search ${p.kind === 'block' ? 'blocks' : 'entities'}…`} value={query} onChange={event => resetSearch(event.target.value)} />{query && <button className="icon-button" aria-label="Clear search" onClick={() => resetSearch('')}><Icon name="close" size={13} /></button>}</label>
      {p.kind === 'block' && <label className="facet-select"><Icon name="sliders" size={15} /><select aria-label="Filter blocks by creative tab or tag" value={facet} onChange={event => { setFacet(event.target.value); setLimit(PAGE_SIZE) }}>
        <option value="">All blocks</option>
        {!!p.profile?.creativeTabs.length && <optgroup label="Creative tabs">{p.profile.creativeTabs.filter(t => t.items.length).map(t => <option key={t.id} value={`tab:${t.id}`}>{t.label.startsWith('itemGroup.') ? resourceName(t.id) : t.label}</option>)}</optgroup>}
        {!!tags.length && <optgroup label="Block tags">{tags.map(tag => <option key={tag} value={`tag:${tag}`}>#{tag}</option>)}</optgroup>}
      </select></label>}
    </div>
    <div className="browser-list-heading"><span>{query || facet ? 'Results' : 'All resources'}</span><span>{count.toLocaleString()}</span></div>
    <div className="resource-list" aria-label={p.kind === 'block' ? 'Blocks' : 'Entities'}>
      {p.kind === 'block' ? blocks.slice(0, limit).map(m => <button key={m.id} className={`resource-item${m.id === p.selected ? ' selected' : ''}`} onClick={() => p.onSelect(m.id)} aria-pressed={m.id === p.selected} title={m.id}>
        <TextureThumbnail material={m} resolver={p.resolver} /><span className="resource-item-copy"><strong>{resourceName(m.id)}</strong><small>{m.id}</small></span>{m.id === p.selected && <span className="selection-mark" />}
      </button>) : entities.slice(0, limit).map(entity => {
        const supported = !!entityAppearance(entity.id, p.profile, p.resolver)
        return <button key={entity.id} className={`resource-item${entity.id === p.selected ? ' selected' : ''}`} onClick={() => p.onSelect(entity.id)} aria-pressed={entity.id === p.selected} title={`${entity.id} · ${supported ? 'Static model' : 'Bounds preview'}`}>
          <span className="resource-thumb"><Icon name="entity" size={23} /></span><span className="resource-item-copy"><strong>{resourceName(entity.id)}</strong><small>{supported ? 'Static model' : 'Bounds preview'} · {entity.category.replaceAll('_', ' ')}</small></span>{supported && <span className="support-dot" title="Static model available" />}
        </button>
      })}
      {!count && <div className="empty-state"><Icon name={p.kind === 'entity' && !p.profile ? 'layers' : 'search'} size={30} /><strong>{p.kind === 'entity' && !p.profile ? 'Add a game profile' : 'No resources found'}</strong><p>{p.kind === 'entity' && !p.profile ? 'Import a 26.2 profile in Resources to browse entities.' : 'Try another search or filter.'}</p>{(query || facet) && <button onClick={() => { resetSearch(''); setFacet('') }}>Clear filters</button>}</div>}
      {count > limit && <button className="load-more" onClick={() => setLimit(value => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, count - limit)} more<Icon name="chevron-down" size={14} /></button>}
    </div>
    <div className="library-footer"><Icon name={p.profile ? 'check' : 'info'} size={13} /><span>{p.profile ? 'Game registry' : 'Sample registry'}</span><span className="footer-note">{p.kind === 'block' ? 'Texture samples' : 'Static previews'}</span></div>
  </>
}
