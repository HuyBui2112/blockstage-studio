import { useEffect, useMemo, useRef, useState } from 'react'
import type { Material } from '../core/catalog'
import type { NeighborRules } from '../core/profile'
import type { EditorDocument } from './model'
import { planMaterialReplacement, type MaterialReplacementIntent, type MaterialReplacementPlan } from './material-plan'
import type { EditorScope } from './useEditorSession'

type Inputs={document:EditorDocument;scope:EditorScope;revision:number;epoch:string;selection:string[];catalog:Material[];rules?:NeighborRules;enabled:boolean;resourceKey:unknown;onCommit:(scope:EditorScope,plan:MaterialReplacementPlan)=>boolean}
type Operation=Omit<Inputs,'enabled'|'onCommit'> & {id:string;controller:AbortController;intent:MaterialReplacementIntent}
export function useMaterialActions({document,scope,revision,epoch,selection,catalog,rules,enabled,resourceKey,onCommit}:Inputs){
  const [operation,setOperation]=useState<Operation|null>(null)
  const owned=useRef<AbortController|null>(null)
  const active=operation&&enabled&&operation.document===document&&operation.scope===scope&&operation.revision===revision&&operation.epoch===epoch&&operation.selection.join('\0')===selection.join('\0')&&operation.catalog===catalog&&operation.rules===rules&&operation.resourceKey===resourceKey?operation:null
  if(operation&&!active)setOperation(null)
  useEffect(()=>()=>{owned.current?.abort();owned.current=null},[document,scope,enabled,catalog,rules,resourceKey,revision,epoch,selection])
  const result=useMemo(()=>{
    if(!active)return null
    try{return {plan:planMaterialReplacement(document,active.selection,active.intent,catalog,{base:{documentId:document.id,sessionEpoch:epoch,revision},operationId:active.id,signal:active.controller.signal},rules),error:''}}
    catch(error){return {plan:null,error:error instanceof Error?error.message:String(error)}}
  },[active,document,catalog,epoch,revision,rules])
  function cancel(){owned.current?.abort();owned.current=null;setOperation(null)}
  function begin(intent:MaterialReplacementIntent){if(!enabled||!selection.length)return;cancel();const controller=new AbortController();owned.current=controller;setOperation({document,scope,revision,epoch,selection:[...selection],catalog,rules,resourceKey,id:crypto.randomUUID(),controller,intent})}
  function change(intent:MaterialReplacementIntent){setOperation(previous=>previous?{...previous,intent}:null)}
  function confirm(){if(active&&result?.plan&&onCommit(scope,result.plan))cancel()}
  return {active,result,begin,change,confirm,cancel}
}
