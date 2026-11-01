import { useEffect, useMemo, useRef, useState } from 'react'
import { bounds } from '../core/assembly'
import type { Material } from '../core/catalog'
import type { NeighborRules } from '../core/profile'
import type { Vec3 } from '../core/schema'
import { objectCells, type EditorDocument } from './model'
import { planCopyAction, type CopyActionIntent } from './copy-action'
import type { EditorScope, EditorSession } from './useEditorSession'

type Operation = { scope:EditorScope;source:EditorDocument;epoch:string;revision:number;ids:string[];id:string;controller:AbortController;intent:CopyActionIntent;anchor:Vec3 }
export function useCopyActions(session:EditorSession,scope:EditorScope,enabled:boolean,catalog:Material[],rules?:NeighborRules) {
  const [operation,setOperation]=useState<Operation|null>(null)
  const owned=useRef<AbortController|null>(null)
  const slot=session.slots[scope],document=slot.history.document
  const active=operation && enabled && operation.scope===scope && operation.source===document && operation.epoch===slot.epoch && operation.revision===slot.revision && operation.ids.join('\0')===slot.selection.join('\0') ? operation : null
  if(operation&&!active)setOperation(null)
  useEffect(()=>()=>{owned.current?.abort();owned.current=null},[document,scope,enabled])
  const result=useMemo(()=>{
    if(!active)return null
    try {return {plan:planCopyAction(document,active.ids,active.intent,session.clipboard,catalog,{base:{documentId:document.id,sessionEpoch:active.epoch,revision:active.revision},operationId:active.id,signal:active.controller.signal},rules),error:''}}
    catch(error){return {plan:null,error:error instanceof Error?error.message:String(error)}}
  },[active,document,session.clipboard,catalog,rules])
  function cancel(){owned.current?.abort();owned.current=null;setOperation(null)}
  function begin(kind:CopyActionIntent['kind']) {
    if(!enabled)return
    cancel();session.cancelPreview()
    const cells=document.objects.filter(object=>slot.selection.includes(object.id)).flatMap(objectCells)
    if(kind!=='paste'&&!cells.length){session.setError('Select objects first');return}
    if(kind==='paste'&&!session.clipboard){session.setError('Copy objects first');return}
    const box=bounds(cells),anchor=kind==='paste'?session.clipboard!.anchor:box.min
    const intent:CopyActionIntent=kind==='paste'?{kind,position:[...anchor]}:kind==='repeat'?{kind,axis:'x',count:2,spacing:box.size[0]}:{kind,delta:[box.size[0],0,0]}
    const controller=new AbortController();owned.current=controller
    setOperation({scope,source:document,epoch:slot.epoch,revision:slot.revision,ids:[...slot.selection],id:crypto.randomUUID(),controller,intent,anchor:[...anchor]})
    session.setError('')
  }
  function change(intent:CopyActionIntent){setOperation(previous=>previous&&previous.intent.kind===intent.kind?{...previous,intent}:previous)}
  function point(pos:Vec3){
    if(!active)return
    const delta=pos.map((value,axis)=>value-active.anchor[axis]) as Vec3
    const intent:CopyActionIntent=active.intent.kind==='duplicate'?{kind:'duplicate',delta}:active.intent.kind==='paste'?{kind:'paste',position:pos}:{...active.intent,spacing:delta[['x','y','z'].indexOf(active.intent.axis)]}
    if(JSON.stringify(intent)!==JSON.stringify(active.intent))change(intent)
  }
  function confirm(){if(result?.plan&&session.commitCopy(scope,result.plan))cancel()}
  function copy(){cancel();return session.copySelection(scope)}
  return {active,result,begin,change,point,confirm,cancel,copy}
}
