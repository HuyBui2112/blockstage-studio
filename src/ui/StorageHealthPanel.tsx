import { useEffect, useRef, useState } from 'react'
import { createStorageHealth, type PersistenceRequest, type StorageHealth } from '../io/storage-health'
import { Icon } from './Icon'

function size(value: number | null) {
  if (value === null) return 'Unavailable'
  if (value < 1024) return `${Math.round(value)} B`
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits:1 })} ${['B','KiB','MiB','GiB'][unit]}`
}
const persistenceLabel = { persistent:'Persistent', 'best-effort':'Best effort', unsupported:'Unavailable', error:'Could not read status' }
const requestLabel = { granted:'Persistent storage enabled.', denied:'The browser did not grant persistent storage. Local data was kept.', unsupported:'This browser does not offer persistence requests.', error:'Could not request persistent storage.' }

export function StorageHealthPanel() {
  const [controller] = useState(() => createStorageHealth())
  const [health, setHealth] = useState<StorageHealth | null>(null)
  const [busy, setBusy] = useState(true)
  const [result, setResult] = useState<PersistenceRequest | null>(null)
  const mounted = useRef(false), running = useRef(false)
  useEffect(() => {
    let active = true
    mounted.current = true
    void controller.read().then(value => { if (active) { setHealth(value); setBusy(false) } })
    return () => { active=false; mounted.current=false }
  }, [controller])
  async function run(request: boolean) {
    if (running.current) return
    running.current = true
    setBusy(true)
    if (request) {
      const permission = await controller.request()
      if (mounted.current) setResult(permission)
    }
    const value = await controller.read()
    if (mounted.current) { setHealth(value); setBusy(false) }
    running.current = false
  }
  const estimate = health?.estimate
  const ratio = estimate?.status === 'available' ? estimate.ratio : null
  const nearQuota = ratio !== null && ratio >= .9
  return <section className="storage-health" aria-label="Storage health" aria-busy={busy}>
    <div className="storage-health-heading"><strong>Browser storage</strong><button className="icon-button" aria-label="Refresh storage health" disabled={busy} onClick={() => void run(false)}><Icon name="refresh" size={15} /></button></div>
    <small className="storage-origin" title={location.origin}>{location.origin}</small>
    <dl className="storage-metrics">
      <div><dt>Estimated used</dt><dd aria-label="Estimated storage usage">{estimate?.status === 'available' ? size(estimate.usage) : estimate?.status === 'error' ? 'Could not read' : busy ? 'Checking…' : 'Unavailable'}</dd></div>
      <div><dt>Estimated quota</dt><dd aria-label="Estimated storage quota">{estimate?.status === 'available' ? size(estimate.quota) : estimate?.status === 'error' ? 'Could not read' : busy ? 'Checking…' : 'Unavailable'}</dd></div>
      <div><dt>Retention</dt><dd aria-label="Storage persistence">{health ? persistenceLabel[health.persistence.status] : 'Checking…'}</dd></div>
    </dl>
    {ratio !== null && <progress aria-label="Estimated storage quota used" max={1} value={Math.min(1,ratio)} />}
    {nearQuota && <p className="storage-warning" role="status">Estimated usage is near the browser quota. Export JSON backups before managing saved resources or recovery copies.</p>}
    <div className="storage-health-actions"><button className="button" aria-label="Request persistent storage" disabled={busy || !health?.canRequest || health.persistence.status === 'persistent'} onClick={() => void run(true)}>{health?.persistence.status === 'persistent' ? 'Persistence enabled' : 'Request persistent storage'}</button></div>
    <p className="storage-request-result" role="status">{result ? `${requestLabel[result.status]}${result.message ? ` ${result.message}` : ''}` : busy ? 'Checking browser storage…' : ''}</p>
    {(estimate?.status === 'error' || health?.persistence.status === 'error') && <p className="document-manager-error" role="alert">{[estimate?.status === 'error' ? estimate.message : '',health?.persistence.status === 'error' ? health.persistence.message : ''].filter(Boolean).join(' ')}</p>}
    <details className="quiet-details storage-details"><summary>Storage and backups</summary><p>Estimates cover this origin’s browser storage, including resources and recovery. They are approximate and do not measure free disk space or guarantee the next write will succeed.</p><p>Persistent storage reduces automatic eviction when granted. Clearing browser data, changing origin, device failure and write errors can still affect your work. Keep JSON files outside the browser.</p><p>This panel does not delete or move data. Use Saved or Recovery to manage individual documents. Recovery limits remain 32 live copies / 64 MiB payload; each snapshot is at most 32 MiB.</p></details>
  </section>
}
