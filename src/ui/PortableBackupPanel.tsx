import { useEffect,useRef,useState } from 'react'
import type { EditorDocument,ComponentAsset } from '../editor/model'
import type { ResourceSession } from '../resources/useResources'
import { decodePortableBackup,encodePortableBackup,parsePortableBackup,reportPortableBackup,resourceManifest,PORTABLE_MAX_BYTES,type PortableBackup,type BackupReport } from '../io/portable-backup'
import { download } from '../io/storage'
import { Icon } from './Icon'

export type BackupProps={
  document:EditorDocument;components:ComponentAsset[];resources:ResourceSession
  onRestoreBackup:(bundle:PortableBackup,current:EditorDocument)=>Promise<boolean>
}
export function PortableBackupPanel({document,components,resources,onRestoreBackup,onClose,error,onBusy}:BackupProps&{onClose:()=>void;error:string;onBusy:(busy:boolean)=>void}) {
  const [includeLibrary,setIncludeLibrary]=useState(true),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[status,setStatus]=useState('')
  const [candidate,setCandidate]=useState<{bundle:PortableBackup;report:BackupReport;current:EditorDocument}|null>(null)
  const [ack,setAck]=useState(false)
  const mounted=useRef(true),running=useRef(false)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  async function run(work:()=>Promise<void>){
    if(running.current)return
    running.current=true;setBusy(true);onBusy(true);setFailure('');setStatus('')
    try{await work()}catch(error){if(mounted.current)setFailure(error instanceof Error?error.message:String(error))}
    finally{running.current=false;if(mounted.current){setBusy(false);onBusy(false)}}
  }
  async function exportBackup(){
    const snapshot=structuredClone({document,components:includeLibrary?components:[]}),packs=resources.packs,profile=resources.profile
    await run(async()=>{
      const manifest=await resourceManifest(packs,profile)
      const bundle=parsePortableBackup({format:'blockstage-portable',version:1,...snapshot,resources:manifest})
      const text=encodePortableBackup(bundle)
      if(!mounted.current)return
      download(`${snapshot.document.name}.blockstage-backup.json`,text,'application/json')
      setStatus('Backup created. Keep the downloaded file outside the browser.')
    })
  }
  async function inspect(file:File){
    setCandidate(null);setAck(false)
    const current=document
    await run(async()=>{
      if(file.size>PORTABLE_MAX_BYTES)throw new Error('Portable backup must be at most 32 MiB')
      const bundle=decodePortableBackup(await file.text())
      if(bundle.document.workspace!==current.workspace)throw new Error(`This backup belongs to ${bundle.document.workspace}. Switch workspace before importing.`)
      const manifest=await resourceManifest(resources.packs,resources.profile)
      const report=reportPortableBackup(bundle,manifest,resources.catalog)
      if(mounted.current)setCandidate({bundle,report,current})
    })
  }
  async function restore(){
    if(!candidate||candidate.report.totalIssues>0&&!ack)return
    await run(async()=>{if(await onRestoreBackup(candidate.bundle,candidate.current))onClose()})
  }
  return <section className="portable-backup" aria-label="Portable backup" aria-busy={busy}>
    <div className="storage-health-heading"><strong>File backup</strong><Icon name="file" size={18}/></div>
    <p className="backup-note">Current document and optional component copies. Game assets stay in your source files.</p>
    <label className="backup-library"><input type="checkbox" aria-label="Include component library in backup" checked={includeLibrary} disabled={busy} onChange={event=>setIncludeLibrary(event.target.checked)}/>Include component library · {components.length}</label>
    <div className="backup-actions"><button className="button" aria-label="Download portable backup" disabled={busy} onClick={()=>void exportBackup()}><Icon name="file" size={14}/>Download backup</button><label className={`button${busy?' is-disabled':''}`}><Icon name="upload" size={14}/>Open backup<input type="file" accept=".json" className="visually-hidden" aria-label="Import portable backup" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void inspect(file)}}/></label></div>
    {candidate&&<section className="backup-report" aria-label="Backup import report"><strong>{candidate.bundle.document.name}</strong><small>{candidate.report.documentCells.toLocaleString()} cells · {candidate.report.componentCount} component definitions · Java 26.2</small>
      <p>Restore creates a new saved document and independent library copies. Existing documents, resources and library items are kept.</p>
      {candidate.report.totalIssues>0&&<details open><summary>{candidate.report.totalIssues} compatibility notes</summary><ul>{candidate.report.issues.map(note=><li key={note}>{note}</li>)}</ul>{candidate.report.totalIssues>candidate.report.issues.length&&<p>{candidate.report.totalIssues-candidate.report.issues.length} more notes.</p>}</details>}
      {candidate.report.totalIssues>0&&<label className="backup-library"><input type="checkbox" aria-label="Accept missing backup resources" checked={ack} disabled={busy} onChange={event=>setAck(event.target.checked)}/>Keep original data and restore despite these notes</label>}
      <div className="backup-actions"><button className="button" disabled={busy} aria-label="Cancel backup import" onClick={()=>{setCandidate(null);setAck(false)}}>Cancel</button><button className="button primary" aria-label="Restore portable backup" disabled={busy||candidate.report.totalIssues>0&&!ack} onClick={()=>void restore()}>Restore as new</button></div>
    </section>}
    {(failure||error)&&<p role="alert" className="document-manager-error">{failure||error}</p>}
    <p role="status" className="storage-request-result">{busy?'Working…':status}</p>
    <details className="quiet-details storage-details"><summary>Backup scope</summary><p>The file includes one committed document snapshot, component copy definitions and pack/profile fingerprints in precedence order. Camera, transform previews, undo history, recovery drafts and browser settings are excluded. A component’s source ID is provenance, not a live link.</p><p>Missing resources are reported, never downloaded automatically. Reimport matching packs/profile in Resources. Unknown states stay unchanged; editing/export may remain unavailable until matching data is supplied. Unsupported versions, fields and NBT payloads are rejected.</p><p>Limits: 32 MiB JSON, 256 component definitions and 100,000 cells/objects across the bundle. For larger libraries, turn off library inclusion.</p></details>
  </section>
}
