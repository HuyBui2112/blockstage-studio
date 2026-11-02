import type { KeyboardEvent } from 'react'
import type { Vec3 } from '../core/schema'
import type { PrimitiveIntent, PrimitiveKind } from '../editor/primitive-plan'
import './copy-actions.css'
import './primitive-actions.css'

const titles:Record<PrimitiveKind,string> = {line:'Line',plane:'Plane','solid-box':'Solid box','hollow-box':'Hollow box'}
const axes=['X','Y','Z'] as const
export function PrimitiveActionMenu({enabled,onAction}:{enabled:boolean;onAction:(kind:PrimitiveKind)=>void}) {
  return <details className="copy-action-menu primitive-action-menu"><summary aria-label="Primitive tools" title="Build with the selected block Design state">Build</summary><div>{(Object.keys(titles) as PrimitiveKind[]).map(kind=><button type="button" key={kind} disabled={!enabled} aria-label={`Build ${titles[kind].toLowerCase()}`} onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');onAction(kind)}}>{titles[kind]}</button>)}</div></details>
}
type Props={intent:PrimitiveIntent;onChange:(intent:PrimitiveIntent)=>void;valid:boolean;error:string;cells:number;anchors:number;notes:string[];onCommit:()=>void;onCancel:()=>void}
export function PrimitiveActionPanel({intent,onChange,valid,error,cells,anchors,notes,onCommit,onCancel}:Props){
  function onKeyDown(event:KeyboardEvent<HTMLElement>){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel()}
    else if(event.key==='Enter'&&event.target instanceof HTMLInputElement&&!event.nativeEvent.isComposing){event.preventDefault();event.stopPropagation();if(valid)onCommit()}
  }
  function changeVector(field:'start'|'end',index:number,value:number){const vector:Vec3=[...intent[field]];vector[index]=value;onChange({...intent,[field]:vector})}
  return <section className="copy-action-panel primitive-action-panel" aria-label={`${titles[intent.kind]} preview`} onKeyDown={onKeyDown}>
    <header className="copy-action-heading"><strong>{titles[intent.kind]}</strong>{valid&&<span role="status">{cells.toLocaleString()} cells · {anchors.toLocaleString()} anchors</span>}<span className="copy-action-world">World · Design</span></header>
    <code className="primitive-action-material">{intent.state.name.replace('minecraft:','')}</code>
    {(['start','end'] as const).map(field=><fieldset className="copy-action-vector" key={field}><legend>{field==='start'?'Start':'End'}</legend><div className="copy-action-fields">{axes.map((axis,index)=><label key={axis}><span>{axis}</span><input type="number" step={1} aria-label={`Primitive ${field} ${axis}`} value={Number.isFinite(intent[field][index])?intent[field][index]:''} onChange={event=>changeVector(field,index,event.currentTarget.valueAsNumber)}/></label>)}</div></fieldset>)}
    {!valid&&<p className="copy-action-error" role="alert">{error||'Adjust endpoints to create a valid preview.'}</p>}
    {!!notes.length&&<details className="copy-action-notes"><summary>Notes ({notes.length})</summary><ul>{notes.map((note,index)=><li key={`${index}-${note}`}>{note}</li>)}</ul></details>}
    <footer className="copy-action-footer"><span title="Inclusive integer endpoints. Point or click to stage the end. Enter confirms; Escape cancels.">Point to set end · Enter / Esc</span><button type="button" aria-label="Cancel primitive action" onClick={onCancel}>Cancel</button><button type="button" className="copy-action-confirm" aria-label="Confirm primitive action" disabled={!valid} onClick={onCommit}>Confirm</button></footer>
  </section>
}
