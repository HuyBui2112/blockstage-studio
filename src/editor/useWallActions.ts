import { useEffect, useMemo, useRef, useState } from "react";
import type { Material } from "../core/catalog";
import type { NeighborRules } from "../core/profile";
import type { BlockState, Vec3 } from "../core/schema";
import type { EditorDocument } from "./model";
import type { EditorScope } from "./useEditorSession";
import { planWall, type WallIntent, type WallPlan } from "./wall-plan";

type Inputs = {
  document: EditorDocument;
  scope: EditorScope;
  revision: number;
  epoch: string;
  catalog: Material[];
  rules?: NeighborRules;
  state: BlockState;
  enabled: boolean;
  resourceKey: unknown;
  onCommit: (scope: EditorScope, plan: WallPlan) => boolean;
};
type Operation = Omit<Inputs, "enabled" | "onCommit"> & {
  id: string;
  controller: AbortController;
  intent: WallIntent;
};

/** Numeric-only wall gesture; its Design template and operation identity stay fixed. */
export function useWallActions({ document, scope, revision, epoch, catalog, rules,
  state, enabled, resourceKey, onCommit }: Inputs) {
  const [operation, setOperation] = useState<Operation | null>(null);
  const owned = useRef<AbortController | null>(null);
  const active = operation && enabled && operation.document === document &&
    operation.scope === scope && operation.revision === revision && operation.epoch === epoch &&
    operation.catalog === catalog && operation.rules === rules && operation.state === state &&
    operation.resourceKey === resourceKey ? operation : null;
  if (operation && !active) setOperation(null);
  useEffect(() => () => {
    owned.current?.abort();
    owned.current = null;
  }, [document, scope, revision, epoch, enabled, catalog, rules, state, resourceKey]);
  const result = useMemo(() => {
    if (!active) return null;
    try {
      return { plan: planWall(document, active.intent, catalog, {
        base: { documentId: document.id, sessionEpoch: epoch, revision },
        operationId: active.id,
        signal: active.controller.signal,
      }, rules), error: "" };
    } catch (error) {
      return { plan: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [active, document, catalog, epoch, revision, rules]);
  function cancel() {
    owned.current?.abort();
    owned.current = null;
    setOperation(null);
  }
  function begin(start: Vec3) {
    if (!enabled) return;
    cancel();
    const controller = new AbortController();
    owned.current = controller;
    setOperation({ document, scope, revision, epoch, catalog, rules, state, resourceKey,
      id: crypto.randomUUID(), controller,
      intent: { start: [...start], axis: "x", direction: 1, length: 5, height: 3,
        openings: [], state: structuredClone(state) },
    });
  }
  function change(intent: WallIntent) {
    setOperation(previous => previous ? { ...previous,
      intent: { ...intent, state: previous.intent.state },
    } : null);
  }
  function confirm() {
    if (active && result?.plan && onCommit(scope, result.plan)) {
      cancel();
      return true;
    }
    return false;
  }
  return { active, result, begin, change, confirm, cancel };
}
