import { useMemo, useState } from 'react'
import { indexComponentCatalogue, queryComponentCatalogue, type ComponentCatalogueSort } from '../editor/component-catalogue'
import type { ComponentAsset } from '../editor/model'
import { download } from '../io/storage'
import { Icon } from './Icon'
import './ComponentLibrary.css'

type Props = {
  assets: ComponentAsset[]
  selected: string | null
  onSelect: (asset: ComponentAsset) => void
  onEdit: (asset: ComponentAsset) => void
  onDelete: (id: string) => void
  onImport: (file: File) => void
}
const PAGE_SIZE = 24

export function ComponentLibrary({ assets, selected, onSelect, onEdit, onDelete, onImport }: Props) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ComponentCatalogueSort>('name')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const entries = useMemo(() => indexComponentCatalogue(assets), [assets])
  const results = useMemo(() => queryComponentCatalogue(entries, query, sort), [entries, query, sort])
  const shown = results.slice(0, limit)
  const changeQuery = (value: string) => { setQuery(value); setLimit(PAGE_SIZE) }

  return <>
    <div className="panel-heading"><span>Components</span><span>{assets.length}</span></div>
    <div className="browser-tools component-catalogue-tools">
      <label className="resource-search"><Icon name="search" size={16} /><input aria-label="Search components" placeholder="Search names or block IDs…" value={query} onChange={event => changeQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Clear component search" onClick={() => changeQuery('')}><Icon name="close" size={13} /></button>}</label>
      <label className="component-sort"><span>Sort</span><select aria-label="Sort components" value={sort} onChange={event => { setSort(event.target.value as ComponentCatalogueSort); setLimit(PAGE_SIZE) }}><option value="name">Name</option><option value="cells-asc">Cells: fewest first</option><option value="cells-desc">Cells: most first</option></select></label>
    </div>
    <div className="component-catalogue-count" role="status" aria-label="Component results">Showing {shown.length} of {results.length}{results.length !== assets.length && <span> · {assets.length} total</span>}</div>
    <div className="component-assets">
      {shown.map(({ asset, cells }) => <article className={`component-asset${selected === asset.id ? ' chosen' : ''}`} data-component-id={asset.id} key={asset.id}>
        <button className="component-asset-main" aria-pressed={selected === asset.id} onClick={() => onSelect(asset)}><Icon name="blocks" size={24} /><span><strong>{asset.name}</strong><small>{asset.size.join(' × ')} blocks</small><small title="Stored block cells, including explicit air; not a survival item count">{cells.toLocaleString()} {cells === 1 ? 'cell' : 'cells'}</small></span></button>
        <div className="component-asset-actions"><button onClick={() => onEdit(asset)}>Edit</button><button aria-label={`Export component ${asset.name}`} onClick={() => download(`${asset.name}.component.json`, JSON.stringify(asset, null, 2), 'application/json')}><Icon name="file" size={13} /></button><button aria-label={`Remove component ${asset.name}`} onClick={() => onDelete(asset.id)}><Icon name="trash" size={13} /></button></div>
      </article>)}
      {!assets.length && <div className="empty-state"><Icon name="blocks" size={30} /><strong>Your building kit</strong><p>Group a selection and save it as a component, or design one in Component Editor.</p></div>}
      {!!assets.length && !results.length && <div className="empty-state"><Icon name="search" size={30} /><strong>No matching components</strong><button className="button" onClick={() => changeQuery('')}>Clear component search</button></div>}
      {shown.length < results.length && <button aria-label="Show more components" className="load-more component-show-more" onClick={() => setLimit(value => value + PAGE_SIZE)}>Show more components ({PAGE_SIZE})</button>}
    </div>
    <label className="button library-import"><Icon name="upload" size={14} />Import component<input className="visually-hidden" type="file" accept=".json" aria-label="Import component JSON" onChange={event => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = '' }} /></label>
  </>
}
