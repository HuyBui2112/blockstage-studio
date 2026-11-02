import type { Material } from '../core/catalog'
import type { NeighborRules } from '../core/profile'
import type { CopyPlanOptions } from './copy-plan'
import { finalizeCopyPlan } from './copy-action'
import type { EditorDocument } from './model'
import type { OperationBase } from './operation-plan'
import { applyPrimitivePlan, planPrimitive, type PrimitiveIntent, type PrimitivePlan } from './primitive-plan'

export type PrimitiveActionPlan = PrimitivePlan & Readonly<{notes:string[];rules?:NeighborRules}>
export function planPrimitiveAction(document:EditorDocument,intent:PrimitiveIntent,catalog:Material[],options:CopyPlanOptions,rules?:NeighborRules):PrimitiveActionPlan {
  return finalizeCopyPlan(planPrimitive(document,intent,catalog,options),catalog,rules)
}
export function applyPrimitiveAction(plan:PrimitiveActionPlan,current:EditorDocument,base:OperationBase,catalog:Material[],rules?:NeighborRules):EditorDocument {
  if(plan.rules!==rules)throw new Error('Auto connections changed. Rebuild the operation preview.')
  return applyPrimitivePlan(plan,current,base,catalog)
}
