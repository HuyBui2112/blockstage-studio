import type { Material } from '../core/catalog'
import { vecSchema, type BlockState, type Vec3 } from '../core/schema'
import type { EditorDocument } from './model'
import { createPlacedObject } from './placement'
import { applyObjectCopyPlan, planObjectCopiesAt, type CopyPlanOptions, type ObjectCopyPlan } from './copy-plan'
import { checkPlanCancelled, validateOperationBase, type OperationBase } from './operation-plan'

export type PrimitiveIntent = { kind:'line'|'plane';start:Vec3;end:Vec3;state:BlockState }
export type PrimitivePlan = ObjectCopyPlan & Readonly<{kind:'line'|'plane';anchor:Vec3;size:Vec3;anchors:number}>

/** Inclusive World anchor grid. Diagonal rasterization is deliberately unsupported. */
export function planPrimitive(document:EditorDocument,intent:PrimitiveIntent,catalog:Material[],options:CopyPlanOptions):PrimitivePlan {
  checkPlanCancelled(options.signal);validateOperationBase(document,options.base)
  if(intent.kind!=='line'&&intent.kind!=='plane')throw new Error('Primitive must be line or plane')
  const start=vecSchema.parse(intent.start),end=vecSchema.parse(intent.end)
  const varying=start.filter((value,axis)=>value!==end[axis]).length
  if(varying>(intent.kind==='line'?1:2))throw new Error(intent.kind==='line'?'Line must follow one World axis':'Plane corners must share one World coordinate')
  const anchor=start.map((value,axis)=>Math.min(value,end[axis])) as Vec3
  const size=start.map((value,axis)=>Math.abs(value-end[axis])+1) as Vec3
  const anchors=size[0]*size[1]*size[2]
  if(!Number.isSafeInteger(anchors)||anchors>100000)throw new Error('Primitive exceeds 100,000 anchors')
  // A single verified Design-placement template preserves complete bed/door/plant pairs.
  // It does not count as a destination object; pair footprints may extend out of the anchor plane.
  const template=createPlacedObject(intent.state,anchor,catalog,undefined,`${options.operationId}:seed`)
  const plan=planObjectCopiesAt(document,[template],anchors,index=>[
    index%size[0],Math.floor(index/size[0])%size[1],Math.floor(index/(size[0]*size[1])),
  ],catalog,options)
  return {...plan,kind:intent.kind,anchor,size,anchors}
}

export function applyPrimitivePlan(plan:PrimitivePlan,current:EditorDocument,base:OperationBase,catalog:Material[]):EditorDocument {
  return applyObjectCopyPlan(plan,current,base,catalog)
}
