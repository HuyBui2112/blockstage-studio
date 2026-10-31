import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorDocument, EditorObject } from '../editor/model'
import type { RepositoryListing, StoredEditorDocument } from '../io/editor-repository'
import { Dialog } from './Dialog'
import { Icon } from './Icon'
import './documents.css'
import { RecoveryList, type RecoveryProps } from './RecoveryList'
import { StorageHealthPanel } from './StorageHealthPanel'

type Props = RecoveryProps & {
  document: EditorDocument; saved: EditorDocument | null; pristine: boolean; error: string
  onList: () => Promise<RepositoryListing>
  onOpen: (document: EditorDocument) => Promise<boolean>
  onRename: (record: StoredEditorDocument, name: string, current: EditorDocument) => Promise<boolean>
  onDelete: (record: StoredEditorDocument, current: EditorDocument) => Promise<boolean>
  onDiscard: (current: EditorDocument) => Promise<boolean>
  onClose: () => void
  recoveryCount: number; initialRecovery?: boolean
}
type Pending = { kind: 'delete' | 'rename'; record: StoredEditorDocument; current: EditorDocument } | { kind: 'discard'; current: EditorDocument }
const cellCount = (objects: EditorObject[]): number => objects.reduce((sum, object) => sum + object.cells.length + cellCount(object.children), 0)

export function DocumentManager({ document, saved, pristine, error, onList, onOpen, onRename, onDelete, onDiscard, onClose, recoveryCount, initialRecovery, ...recovery }: Props) {
  const [records, setRecords] = useState<StoredEditorDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [failure, setFailure] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(40)
  const [pending, setPending] = useState<Pending | null>(null)
  const [name, setName] = useState('')
  const [tab, setTab] = useState<'saved' | 'recovery' | 'storage'>(initialRecovery ? 'recovery' : 'saved')
  const confirmation = useRef<HTMLElement>(null)
  const dirty = saved !== document
  useEffect(() => {
    let active = true
    void onList().then(list => { if (active) { setRecords(list.records); setFailure(list.issues.join(' ')) } })
      .catch(error => { if (active) setFailure(String(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onList])
  useEffect(() => { confirmation.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }) }, [pending])
  const filtered = useMemo(() => records.filter(record => record.document.workspace === document.workspace && `${record.document.name} ${record.document.id}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.document.name.localeCompare(b.document.name) || a.document.id.localeCompare(b.document.id)), [records, query, document.workspace])
  async function refresh() {
    setLoading(true)
    try { const list = await onList(); setRecords(list.records); setFailure(list.issues.join(' ')) }
    catch (error) { setFailure(String(error)) }
    finally { setLoading(false) }
  }
  async function confirm() {
    if (!pending || working) return
    setWorking(true)
    try {
      const ok = pending.kind === 'delete' ? await onDelete(pending.record, pending.current)
        : pending.kind === 'rename' ? await onRename(pending.record, name, pending.current) : await onDiscard(pending.current)
      if (ok) { setPending(null); await refresh() }
    } finally { setWorking(false) }
  }
  async function open(record: StoredEditorDocument) {
    setWorking(true)
    try { if (await onOpen(record.document)) onClose() }
    finally { setWorking(false) }
  }
  return <Dialog title="Documents" className="documents-dialog" onClose={() => { if (!working) onClose() }}>
    <div className="dialog-content documents-content" aria-busy={working || loading}>
      <section className="document-current" aria-label="Current working document">
        <Icon name={document.workspace === 'architecture' ? 'architecture' : 'blocks'} size={19} />
        <div><strong>{document.name}</strong><small>{document.workspace === 'architecture' ? 'Architecture' : 'Component Editor'} · {saved ? dirty ? 'Unsaved changes' : 'Saved' : 'Not saved'}</small></div>
        <button className="button" aria-label="Discard document changes" disabled={working || !dirty || pristine} onClick={() => setPending({ kind: 'discard', current: document })}>Discard changes</button>
      </section>
      <nav className="documents-tabs" aria-label="Document storage"><button className={tab === 'saved' ? 'active' : ''} disabled={working} onClick={() => setTab('saved')}>Saved</button><button aria-label="Recovery documents" className={tab === 'recovery' ? 'active' : ''} disabled={working} onClick={() => setTab('recovery')}>Recovery{recoveryCount > 0 && <span>{recoveryCount}</span>}</button><button aria-label="Storage health tab" className={tab === 'storage' ? 'active' : ''} disabled={working} onClick={() => setTab('storage')}>Storage</button></nav>
      {tab === 'storage' ? <StorageHealthPanel /> : tab === 'recovery' ? <RecoveryList {...recovery} scope={document.workspace} onClose={onClose} error={error} onBusy={setWorking} /> : <>
      <div className="document-search"><input type="search" aria-label="Search saved documents" placeholder="Search saved documents…" value={query} onChange={event => { setQuery(event.target.value); setLimit(40) }} /><button className="icon-button" aria-label="Refresh saved documents" disabled={working || loading} onClick={() => { setPending(null); void refresh() }}><Icon name="refresh" size={16} /></button></div>
      <div className="document-list" aria-label="Saved documents">
        {loading && <p role="status">Loading documents…</p>}
        {!loading && !filtered.length && <div className="documents-empty"><Icon name="file" size={26} /><span>{query ? 'No matching documents' : 'No saved documents in this workspace'}</span></div>}
        {filtered.slice(0, limit).map(record => {
          const active = record.document.id === document.id
          return <article className={`saved-document${active ? ' current' : ''}`} key={record.document.id} data-document-id={record.document.id}>
            <button className="saved-document-open" title={`Open ${record.document.name}`} disabled={working || loading} onClick={() => void open(record)}><Icon name="file" size={17} /><div><strong>{record.document.name}{active && <span>Current</span>}</strong><small>{cellCount(record.document.objects).toLocaleString()} cells{record.updatedAt !== undefined && <> · <time dateTime={new Date(record.updatedAt).toISOString()} title={new Date(record.updatedAt).toLocaleString()}>{new Date(record.updatedAt).toLocaleDateString()}</time></>} · v{record.token.version} · <code title={record.document.id}>{record.document.id.slice(0, 8)}…{record.document.id.slice(-4)}</code></small></div></button>
            <button className="icon-button" aria-label={`Rename saved document ${record.document.name}`} title={active && dirty ? 'Save or discard current edits before renaming here' : 'Rename saved document'} disabled={working || loading || (active && dirty)} onClick={() => { setName(record.document.name); setPending({ kind: 'rename', record, current: document }) }}><Icon name="rename" size={15} /></button>
            <button className="icon-button danger-button" aria-label={`Delete saved document ${record.document.name}`} title="Delete saved document" disabled={working || loading} onClick={() => setPending({ kind: 'delete', record, current: document })}><Icon name="trash" size={15} /></button>
          </article>
        })}
        {filtered.length > limit && <button className="button" disabled={working} onClick={() => setLimit(value => value + 40)}>Show more</button>}
      </div>
      {pending && <section ref={confirmation} className="document-confirm" aria-label="Document confirmation">
        <strong>{pending.kind === 'rename' ? 'Rename saved document' : pending.kind === 'discard' ? 'Discard unsaved changes?' : `Delete “${pending.record.document.name}”?`}</strong>
        {pending.kind === 'rename' ? <input aria-label="Saved document name" value={name} maxLength={120} disabled={working} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (name.trim()) void confirm() } }} /> : <p>{pending.kind === 'discard' ? saved ? 'Returns to the saved checkpoint. The saved document is kept.' : 'Clears this unsaved document. No saved document is deleted.' : pending.record.document.id === document.id ? 'Deletes this saved document, its recovery copies and current unsaved changes. Component library items are kept.' : 'Deletes this saved document and its recovery copies. Component library items and placed copies are kept.'}</p>}
        <div><button className="button" disabled={working} onClick={() => setPending(null)}>Cancel</button><button className={`button ${pending.kind === 'rename' ? 'primary' : 'danger-button'}`} aria-label="Confirm document action" disabled={working || (pending.kind === 'rename' && !name.trim())} onClick={() => void confirm()}>{working ? 'Working…' : pending.kind === 'rename' ? 'Rename' : pending.kind === 'delete' ? 'Delete document' : 'Discard changes'}</button></div>
      </section>}
      {(failure || error) && <p className="document-manager-error" role="alert">{error || failure}</p>}
      </>}
    </div>
    <footer className="dialog-footer documents-footer"><span>{filtered.length} saved · {document.workspace === 'architecture' ? 'Architecture' : 'Component Editor'}</span><button className="button" disabled={working} onClick={onClose}>Done</button></footer>
  </Dialog>
}
