import { useMemo, useState, type KeyboardEvent } from 'react'
import type { Material } from '../core/catalog'
import { createReplacementResolver } from '../core/capabilities'
import type { BlockState } from '../core/schema'
import { countPlacedBlocks, placedBlockCountsCsv, placedBlockCountsJson } from '../editor/material-counts'
import type { MaterialReplacementIntent, MaterialReplacementPlan } from '../editor/material-plan'
import type { EditorDocument } from '../editor/model'
import { download } from '../io/storage'
import './copy-actions.css'
import './materials-panel.css'

type Props={document:EditorDocument;selection:string[];selectedStates:BlockState[];catalog:Material[];readOnly:boolean;intent?:MaterialReplacementIntent;plan?:MaterialReplacementPlan|null;error:string;onBegin:(intent:MaterialReplacementIntent)=>void;onChange:(intent:MaterialReplacementIntent)=>void;onConfirm:()=>void;onCancel:()=>void;onClose:()=>void}
export function MaterialsPanel({document,selection,selectedStates,catalog,readOnly,intent,plan,error,onBegin,onChange,onConfirm,onCancel,onClose}:Props){
  const [scope,setScope]=useState<'document'|'selection'>('document')
  const [states,setStates]=useState(false)
  const [limit,setLimit]=useState(100)
  const report=useMemo(()=>countPlacedBlocks(document,scope==='document'?{kind:'document'}:{kind:'selection',objectIds:selection}),[document,scope,selection])
  const sources=useMemo(()=>[...new Set(selectedStates.map(state=>state.name))].sort(),[selectedStates])
  const [source,setSource]=useState('')
  const [target,setTarget]=useState('')
  const sourceId=intent?.sourceId??(sources.includes(source)?source:sources[0]??'')
  // One representative per exact state, once per selection/source change.
  const sourceStates=useMemo(()=>[...new Map(selectedStates.filter(state=>state.name===sourceId).map(state=>[JSON.stringify(state),state])).values()],[selectedStates,sourceId])
  const replacementCompatibility=useMemo(()=>createReplacementResolver(catalog),[catalog])
  const targets=useMemo(()=>catalog.filter(material=>sourceStates.length&&sourceStates.every(state=>replacementCompatibility(state,material.id).supported)),[catalog,sourceStates,replacementCompatibility])
  const targetId=intent?.targetId??(targets.some(item=>item.id===target)?target:targets[0]?.id??'')
  function update(next:MaterialReplacementIntent){if(intent)onChange(next);else {setSource(next.sourceId);setTarget(next.targetId)}}
  function onKeyDown(event:KeyboardEvent<HTMLElement>){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(intent)onCancel();else onClose()}}
  return <section className="copy-action-panel materials-panel" aria-label="Materials" onKeyDown={onKeyDown}>
    <header className="copy-action-heading"><strong>Materials</strong><span className="copy-action-world">Placed cells</span><button type="button" aria-label="Close materials" onClick={onClose}>×</button></header>
    <div className="materials-controls"><label>Count<select aria-label="Materials count scope" value={scope} onChange={event=>{setScope(event.target.value as typeof scope);setLimit(100)}}><option value="document">Document</option><option value="selection">Selected roots</option></select></label><label className="materials-state-toggle"><input type="checkbox" checked={states} onChange={event=>{setStates(event.target.checked);setLimit(100)}}/>States</label></div>
    <p className="materials-summary" role="status">{report.nonAirCells.toLocaleString()} non-air · {report.airCells.toLocaleString()} explicit air · {report.rootCount} roots</p>
    <div className="materials-table"><table><thead><tr><th>{states?'Block / state':'Block ID'}</th><th>Cells</th></tr></thead><tbody>{(states?report.byState.map(row=>({key:row.state,label:row.state,cells:row.cells})):report.byId.map(row=>({key:row.id,label:row.id,cells:row.cells}))).slice(0,limit).map(row=><tr key={row.key}><td>{row.label}</td><td>{row.cells.toLocaleString()}</td></tr>)}</tbody></table>{(states?report.byState.length:report.byId.length)>limit&&<button type="button" onClick={()=>setLimit(value=>value+100)}>Show more counts</button>}{!report.occupiedCells&&<p>No stored cells in this scope.</p>}</div>
    <div className="materials-downloads"><small>Stored cells, not acquisition items</small><button type="button" aria-label="Download material counts CSV" onClick={()=>download(`${document.name}.materials.csv`,placedBlockCountsCsv(report),'text/csv')}>CSV</button><button type="button" aria-label="Download material counts JSON" onClick={()=>download(`${document.name}.materials.json`,placedBlockCountsJson(report),'application/json')}>JSON</button></div>
    {!readOnly&&<fieldset className="materials-replace"><legend>Replace in selected roots</legend><label>Source<select aria-label="Replacement source material" disabled={!sources.length} value={sourceId} onChange={event=>update({sourceId:event.target.value,targetId:''})}>{sources.map(id=><option key={id} value={id}>{id}</option>)}</select></label><label>Target<select aria-label="Replacement target material" disabled={!targets.length} value={targetId} onChange={event=>update({sourceId,targetId:event.target.value})}>{intent&&!targetId&&<option value="">Choose target</option>}{targets.map(item=><option key={item.id} value={item.id}>{item.id}</option>)}</select></label>{!sources.length?<small>Select whole objects first.</small>:!targets.length?<small>No compatible registered target.</small>:null}
    {intent?<><p role="status">{plan?`${plan.matchedCells} matching cells · ${plan.matchedObjects} logical objects`:''}</p>{error&&<p role="alert" className="copy-action-error">{error}</p>}{!!plan?.notes.length&&<details className="copy-action-notes"><summary>Connection notes · {plan.notes.length}</summary><ul>{plan.notes.map(note=><li key={note}>{note}</li>)}</ul></details>}<footer className="copy-action-footer"><span>Exact preview · Enter / Esc</span><button type="button" aria-label="Cancel material replacement" onClick={onCancel}>Cancel</button><button type="button" className="copy-action-confirm" aria-label="Confirm material replacement" disabled={!plan} onClick={onConfirm}>Confirm</button></footer></>:<button type="button" aria-label="Preview material replacement" disabled={!sourceId||!targetId} onClick={()=>onBegin({sourceId,targetId})}>Preview replacement</button>}
    </fieldset>}
  </section>
}
