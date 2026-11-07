import {
  emptyEditorViewState,
  pruneEditorViewState,
  editableRootIds,
  assertViewEdit,
  type EditorViewState,
} from "./view-state";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Material } from "../core/catalog";
import type { NeighborRules } from "../core/profile";
import { planNeighborConnections } from "./neighbors";
import { projectSchema, type Vec3 } from "../core/schema";
import { storage } from "../io/storage";
import {
  editorRepository,
  RepositoryConflict,
  type RepositoryToken,
  type StoredEditorDocument,
} from "../io/editor-repository";
import {
  createHistory,
  executeHistory,
  redoHistory,
  undoHistory,
  type EditorHistory,
} from "./history";
import {
  componentAssetSchema,
  editorDocumentSchema,
  fromLegacyProject,
  newEditorDocument,
  validateDocument,
  type ComponentAsset,
  type CoordinateSpace,
  type EditorDocument,
  type PivotMode,
  type QuarterTurn,
} from "./model";
import {
  componentFromSelection,
  groupObjects,
  insertObject,
  moveObjects,
  previewTransform,
  removeObjects,
  rotateObjects,
  setObjectPivot,
  ungroupObjects,
  updateObjectsState,
} from "./operations";
import {
  planBlockPlacement,
  planComponentPlacement,
  type PlacementHit,
  type PlacementOptions,
} from "./placement-plan";
import type { BlockState } from "../core/schema";
import { draftRepository, type DraftWrite } from "../io/draft-repository";
import { RECOVERY_CHANGED, type DraftHead } from "../io/draft-storage";
import {
  createDraftController,
  type DraftController,
  type DraftStatus,
} from "./draft-controller";
import {
  planPortableRestore,
  type PortableBackup,
} from "../io/portable-backup";
import { commitPortableRestore } from "../io/portable-repository";
import { createClipboard, type EditorClipboard } from "./clipboard";
import { applyCopyAction, type CopyActionPlan } from "./copy-action";
import {
  applyPrimitiveAction,
  type PrimitiveActionPlan,
} from "./primitive-action";
import {
  applyMaterialReplacement,
  type MaterialReplacementPlan,
} from "./material-plan";
import { applyMirrorPlan, type MirrorPlan } from "./mirror-plan";
import { measurePhase } from "../core/measurement-phases";
import { createTransformPreviewController } from "./transform-preview-controller";
import { duplicateComponentAsset, renameComponentAsset, setComponentCategory } from "./component-library-operations";
import type { ComponentCategory } from "./model";
import { setChestInventory } from "./chest-operations";
import type { Block } from "../core/schema";
import {
  applyEntityAction,
  editableEntityIds,
  planEntityAction,
  type EntityActionIntent,
  type EntityActionPlan,
} from "./entity-action";

export type EditorScope = "architecture" | "component";
export type TransformIntent =
  | { kind: "move"; delta: Vec3 }
  | { kind: "rotate"; turns: number };
type Slot = {
  history: EditorHistory;
  selection: string[];
  entitySelection: string[];
  saved: EditorDocument | null;
  editingAssetId: string | null;
  epoch: string;
  token: RepositoryToken | null;
  pristine: boolean;
  revision: number;
  savedRevision: number | null;
  draftId: string;
};
type Preview = {
  scope: EditorScope;
  result: ReturnType<typeof previewTransform>;
};
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const makeSlot = (scope: EditorScope): Slot => ({
  history: createHistory(newEditorDocument(scope)),
  selection: [],
  entitySelection: [],
  saved: null,
  editingAssetId: null,
  epoch: crypto.randomUUID(),
  token: null,
  pristine: true,
  revision: 0,
  savedRevision: null,
  draftId: crypto.randomUUID(),
});
const sameToken = (a: RepositoryToken | null, b: RepositoryToken) =>
  a?.generation === b.generation && a.version === b.version;
const draftIdentity = (slot: Slot) => ({
  id: slot.draftId,
  epoch: slot.epoch,
  documentId: slot.history.document.id,
  workspace: slot.history.document.workspace,
});
const draftWrite = (slot: Slot): DraftWrite | null =>
  slot.pristine || slot.saved === slot.history.document
    ? null
    : {
        ...draftIdentity(slot),
        document: slot.history.document,
        revision: slot.revision,
        base: slot.token,
        ...(slot.editingAssetId
          ? { componentAssetId: slot.editingAssetId }
          : {}),
      };

export function useEditorSession(
  catalog: Material[],
  neighborRules?: NeighborRules,
) {
  const [views, setViews] = useState<Record<EditorScope, EditorViewState>>(
    () => ({
      architecture: emptyEditorViewState(),
      component: emptyEditorViewState(),
    }),
  );
  const viewRef = useRef(views);
  const [autoConnections, setAutoConnections] = useState<
    Record<EditorScope, boolean>
  >({ architecture: false, component: false });
  const [connectionNotes, setConnectionNotes] = useState<{
    scope: EditorScope;
    document: EditorDocument;
    notes: string[];
  } | null>(null);
  const [slots, setSlotState] = useState<Record<EditorScope, Slot>>(() => ({
    architecture: makeSlot("architecture"),
    component: makeSlot("component"),
  }));
  const [busy, setBusy] = useState<Record<EditorScope, boolean>>({
    architecture: false,
    component: false,
  });
  const [components, setComponents] = useState<ComponentAsset[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [entityPreview, setEntityPreview] = useState<{
    scope: EditorScope;
    plan: EntityActionPlan;
  } | null>(null);
  const entityPreviewRef = useRef<typeof entityPreview>(null);
  const transformPreviews = useRef<ReturnType<
    typeof createTransformPreviewController
  > | null>(null);
  if (!transformPreviews.current)
    transformPreviews.current = createTransformPreviewController();
  const cancelPreview = useCallback(() => {
    transformPreviews.current?.reset();
    setPreview(null);
    entityPreviewRef.current = null;
    setEntityPreview(null);
  }, []);
  useEffect(() => {
    const owned = transformPreviews.current;
    return () => {
      owned?.reset();
      entityPreviewRef.current = null;
    };
  }, []);
  const [clipboard, setClipboard] = useState<EditorClipboard | null>(null);
  const currentSlots = useRef({ ...slots });
  const saving = useRef(new Set<EditorScope>());
  const lifecycle = useRef(new Set<EditorScope>());
  const controllers = useRef<Partial<Record<EditorScope, DraftController>>>({});
  const [draftStatus, setDraftStatus] = useState<
    Record<EditorScope, DraftStatus>
  >({ architecture: { phase: "idle" }, component: { phase: "idle" } });
  const [recoveryCount, setRecoveryCount] = useState<
    Record<EditorScope, number>
  >({ architecture: 0, component: 0 });
  function changeView(scope: EditorScope, next: EditorViewState) {
    const slot = currentSlots.current[scope];
    next = pruneEditorViewState(slot.history.document, next);
    viewRef.current = { ...viewRef.current, [scope]: next };
    setViews(viewRef.current);
    const allowed = new Set(editableRootIds(slot.history.document, next));
    setSlots(
      (previous) => ({
        ...previous,
        [scope]: {
          ...slot,
          selection: slot.selection.filter((id) => allowed.has(id)),
        },
      }),
      false,
    );
    cancelPreview();
  }
  const refreshRecoveries = useCallback(async () => {
    const list = await draftRepository.list();
    const own = new Set(
      Object.values(currentSlots.current).map((slot) => slot.draftId),
    );
    const records = list.records.filter((head) => !own.has(head.id));
    const architecture = records.filter(
        (head) => head.workspace === "architecture",
      ).length,
      component = records.filter(
        (head) => head.workspace === "component",
      ).length;
    setRecoveryCount((previous) =>
      previous.architecture === architecture && previous.component === component
        ? previous
        : { architecture, component },
    );
    return { ...list, records };
  }, []);
  function setSlots(
    update: (previous: Record<EditorScope, Slot>) => Record<EditorScope, Slot>,
    protectDraft = true,
  ) {
    return measurePhase("session.publish", () =>
      setSlotsInner(update, protectDraft),
    );
  }
  function setSlotsInner(
    update: (previous: Record<EditorScope, Slot>) => Record<EditorScope, Slot>,
    protectDraft: boolean,
  ) {
    transformPreviews.current?.reset();
    entityPreviewRef.current = null;
    setEntityPreview(null);
    const before = currentSlots.current;
    let next = { ...update(before) };
    for (const scope of ["architecture", "component"] as const) {
      const slot = next[scope];
      const boundary =
        slot.epoch !== before[scope].epoch ||
        slot.history.document.id !== before[scope].history.document.id;
      let activeView = viewRef.current[scope];
      if (
        !boundary &&
        activeView.isolated !== null &&
        slot.history.document !== before[scope].history.document
      ) {
        const previousRoots = new Set(
          before[scope].history.document.objects.map((object) => object.id),
        );
        const added = slot.history.document.objects
          .filter((object) => !previousRoots.has(object.id))
          .map((object) => object.id);
        if (added.length)
          activeView = {
            ...activeView,
            isolated: [...new Set([...activeView.isolated, ...added])],
          };
      }
      if (!boundary && activeView.entityIsolated != null &&
        slot.history.document !== before[scope].history.document) {
        const previousEntities = new Set(before[scope].history.document.entities.map((entity) => entity.id));
        const added = slot.history.document.entities.filter((entity) => !previousEntities.has(entity.id)).map((entity) => entity.id);
        if (added.length) activeView = { ...activeView,
          entityIsolated: [...new Set([...activeView.entityIsolated, ...added])] };
      }
      const view = boundary
        ? emptyEditorViewState()
        : pruneEditorViewState(slot.history.document, activeView);
      if (view !== viewRef.current[scope])
        viewRef.current = { ...viewRef.current, [scope]: view };
      const allowed = new Set(editableRootIds(slot.history.document, view));
      const selection = slot.selection.filter((id) => allowed.has(id));
      if (selection.length !== slot.selection.length)
        next = { ...next, [scope]: { ...slot, selection } };
      const entityIds = new Set(editableEntityIds(slot.history.document, view));
      const entitySelection = boundary
        ? []
        : slot.entitySelection.filter((id) => entityIds.has(id));
      if (entitySelection.length !== slot.entitySelection.length)
        next = { ...next, [scope]: { ...next[scope], entitySelection } };
      if (
        slot.epoch === before[scope].epoch &&
        slot.history.document !== before[scope].history.document
      ) {
        next = {
          ...next,
          [scope]: { ...next[scope], revision: before[scope].revision + 1 },
        };
      }
    }
    currentSlots.current = next;
    setViews(viewRef.current);
    setSlotState(next);
    for (const scope of ["architecture", "component"] as const)
      if (protectDraft && next[scope] !== before[scope])
        controllers.current[scope]?.update(draftWrite(next[scope]));
  }
  async function exclusive(scope: EditorScope, work: () => Promise<void>) {
    if (lifecycle.current.has(scope) || saving.current.has(scope)) {
      setError("An operation is in progress. Retry when it finishes.");
      return false;
    }
    lifecycle.current.add(scope);
    setBusy((previous) => ({ ...previous, [scope]: true }));
    cancelPreview();
    try {
      await controllers.current[scope]?.pause();
      await work();
      setError("");
      void refreshRecoveries().catch(() => {});
      return true;
    } catch (error) {
      setError(messageOf(error));
      return false;
    } finally {
      lifecycle.current.delete(scope);
      controllers.current[scope]?.resume();
      setBusy((previous) => ({ ...previous, [scope]: false }));
    }
  }

  useEffect(() => {
    const refresh = () => {
      void refreshRecoveries().catch(() => {});
    };
    let channel: BroadcastChannel | undefined;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel(RECOVERY_CHANGED);
        channel.onmessage = refresh;
      } catch {
        /* Manual Refresh still works. */
      }
    }
    window.addEventListener(RECOVERY_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(RECOVERY_CHANGED, refresh);
      window.removeEventListener("focus", refresh);
      channel?.close();
    };
  }, [refreshRecoveries]);

  useEffect(() => {
    const owned = {} as Record<EditorScope, DraftController>;
    for (const scope of ["architecture", "component"] as const) {
      owned[scope] = createDraftController({
        write: draftRepository.write,
        onStatus: (status) =>
          setDraftStatus((previous) => ({ ...previous, [scope]: status })),
      });
      controllers.current[scope] = owned[scope];
      owned[scope].update(draftWrite(currentSlots.current[scope]));
    }
    const flush = () => {
      for (const controller of Object.values(owned)) void controller.flush();
    };
    const visibility = () => {
      if (document.hidden) flush();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (
        (["architecture", "component"] as const).some((scope) => {
          const slot = currentSlots.current[scope],
            status = owned[scope].status;
          return (
            !!draftWrite(slot) &&
            (status.phase !== "protected" || status.revision !== slot.revision)
          );
        })
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", unload);
      Object.values(owned).forEach((controller) => controller.stop());
      controllers.current = {};
    };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      editorRepository.list(),
      storage.componentAssets(),
      storage.editorPreference("architecture"),
      storage.editorPreference("component"),
    ])
      .then((results) => {
        if (!active) return;
        const issues: string[] = [];
        const restoredDocuments: EditorDocument[] = [],
          restoredComponents: ComponentAsset[] = [];
        if (results[0].status === "fulfilled") {
          restoredDocuments.push(
            ...results[0].value.records.map((record) => record.document),
          );
          issues.push(...results[0].value.issues);
        } else issues.push(messageOf(results[0].reason));
        if (results[1].status === "fulfilled")
          for (const raw of results[1].value) {
            const parsed = componentAssetSchema.safeParse(raw);
            if (parsed.success) restoredComponents.push(parsed.data);
            else
              issues.push(
                "An invalid component asset was left untouched in storage.",
              );
          }
        else issues.push(messageOf(results[1].reason));
        setComponents(restoredComponents);
        setSlots((previous) => {
          const next = { ...previous };
          for (const [scope, index] of [
            ["architecture", 2],
            ["component", 3],
          ] as const) {
            const preference = results[index];
            const id =
              preference.status === "fulfilled"
                ? preference.value?.value
                : undefined;
            const doc = restoredDocuments.find(
              (document) => document.workspace === scope && document.id === id,
            );
            if (doc) {
              const history = createHistory(doc);
              const token =
                results[0].status === "fulfilled"
                  ? results[0].value.records.find(
                      (record) => record.document.id === doc.id,
                    )!.token
                  : null;
              const record =
                results[0].status === "fulfilled"
                  ? results[0].value.records.find(
                      (record) => record.document.id === doc.id,
                    )!
                  : null;
              const assetId = record?.componentAssetId ?? doc.id;
              next[scope] = {
                history,
                selection: [],
                entitySelection: [],
                saved: history.document,
                editingAssetId:
                  scope === "component" &&
                  restoredComponents.some((asset) => asset.id === assetId)
                    ? assetId
                    : null,
                epoch: crypto.randomUUID(),
                token,
                pristine: false,
                revision: 0,
                savedRevision: 0,
                draftId: crypto.randomUUID(),
              };
            }
          }
          return next;
        });
        setError(issues.join(" "));
      })
      .finally(() => {
        if (active) {
          setReady(true);
          void refreshRecoveries().catch((error) => setError(messageOf(error)));
        }
      });
    return () => {
      active = false;
    };
  }, [refreshRecoveries]);

  function commit(
    scope: EditorScope,
    next: EditorDocument,
    label: string,
    selection?: string[],
    finalized?: { notes: string[] },
  ) {
    return measurePhase("session.commit", () =>
      commitInner(scope, next, label, selection, finalized),
    );
  }
  function commitInner(
    scope: EditorScope,
    next: EditorDocument,
    label: string,
    selection?: string[],
    finalized?: { notes: string[] },
  ) {
    if (lifecycle.current.has(scope))
      throw new Error("A document operation is in progress");
    const before = slots[scope].history.document;
    const plan = finalized
      ? { document: next, notes: finalized.notes }
      : autoConnections[scope] && neighborRules
        ? planNeighborConnections(before, next, neighborRules)
        : { document: next, notes: [] };
    next = plan.document;
    assertViewEdit(before, next, viewRef.current[scope]);
    if (!finalized) validateDocument(next, catalog);
    setConnectionNotes({ scope, document: next, notes: plan.notes });
    setSlots((previous) => {
      const slot = previous[scope];
      if (slot.history.document !== before) return previous;
      const available = new Set(next.objects.map((object) => object.id));
      const history = executeHistory(slot.history, next, label);
      return {
        ...previous,
        [scope]: {
          ...slot,
          history,
          pristine: slot.pristine && history === slot.history,
          selection: (selection ?? slot.selection).filter((id) =>
            available.has(id),
          ),
        },
      };
    });
    cancelPreview();
    setError("");
  }
  function perform(
    scope: EditorScope,
    label: string,
    operation: (document: EditorDocument) => EditorDocument,
    selection?: string[],
  ) {
    try {
      commit(scope, operation(slots[scope].history.document), label, selection);
      return true;
    } catch (error) {
      setError(messageOf(error));
      return false;
    }
  }
  function select(scope: EditorScope, ids: string[], toggle: boolean) {
    // Copy previews are session-only; selection changes never publish them.
    if (lifecycle.current.has(scope)) return;
    cancelPreview();
    setSlots((previous) => {
      const slot = previous[scope],
        available = new Set(
          editableRootIds(slot.history.document, viewRef.current[scope]),
        );
      const selection = toggle ? new Set(slot.selection) : new Set<string>();
      for (const id of ids)
        if (available.has(id)) {
          if (toggle && selection.has(id)) selection.delete(id);
          else selection.add(id);
        }
      return {
        ...previous,
        [scope]: { ...slot, selection: [...selection], entitySelection: [] },
      };
    });
  }
  function selectEntities(scope: EditorScope, ids: readonly string[], toggle: boolean) {
    if (lifecycle.current.has(scope)) return;
    cancelPreview();
    setSlots((previous) => {
      const slot = previous[scope];
      const view = viewRef.current[scope];
      const allowed = new Set(editableEntityIds(slot.history.document, view));
      const selected = new Set(toggle ? slot.entitySelection : []);
      for (const id of ids) {
        if (!allowed.has(id)) continue;
        if (toggle && selected.has(id)) selected.delete(id);
        else selected.add(id);
      }
      return {
        ...previous,
        [scope]: { ...slot, selection: [], entitySelection: [...selected] },
      };
    }, false);
  }
  function selectEntity(scope: EditorScope, id: string, toggle: boolean) {
    selectEntities(scope, [id], toggle);
  }
  function previewEntity(scope: EditorScope, intent: EntityActionIntent) {
    cancelPreview();
    if (lifecycle.current.has(scope)) return false;
    try {
      const slot = currentSlots.current[scope];
      const plan = planEntityAction(
        slot.history.document,
        slot.entitySelection,
        intent,
        catalog,
        {
          base: {
            documentId: slot.history.document.id,
            sessionEpoch: slot.epoch,
            revision: slot.revision,
          },
          view: viewRef.current[scope],
        },
      );
      entityPreviewRef.current = { scope, plan };
      setEntityPreview(entityPreviewRef.current);
      setError("");
      return true;
    } catch (error) {
      setError(messageOf(error));
      return false;
    }
  }
  function commitEntity(scope: EditorScope) {
    const pending = entityPreviewRef.current;
    if (lifecycle.current.has(scope) || pending?.scope !== scope) return false;
    try {
      const slot = currentSlots.current[scope];
      const next = applyEntityAction(
        pending.plan,
        slot.history.document,
        {
          documentId: slot.history.document.id,
          sessionEpoch: slot.epoch,
          revision: slot.revision,
        },
        catalog,
        viewRef.current[scope],
      );
      setSlots((previous) => {
        if (previous[scope] !== slot) return previous;
        const history = executeHistory(slot.history, next, pending.plan.label);
        return {
          ...previous,
          [scope]: {
            ...slot,
            history,
            selection: [],
            entitySelection: pending.plan.selection,
            pristine: slot.pristine && history === slot.history,
          },
        };
      });
      cancelPreview();
      setError("");
      return true;
    } catch (error) {
      cancelPreview();
      setError(messageOf(error));
      return false;
    }
  }
  function copySelection(scope: EditorScope) {
    if (lifecycle.current.has(scope)) return false;
    try {
      const slot = currentSlots.current[scope];
      const allowed = new Set(
        editableRootIds(slot.history.document, viewRef.current[scope]),
      );
      if (slot.selection.some((id) => !allowed.has(id)))
        throw new Error("Cannot copy protected objects");
      setClipboard(
        createClipboard(slot.history.document, slot.selection, catalog),
      );
      setError("");
      return true;
    } catch (error) {
      setError(messageOf(error));
      return false;
    }
  }
  function commitCopy(scope: EditorScope, plan: CopyActionPlan) {
    try {
      if (plan.source.workspace !== scope)
        throw new Error("Copy plan belongs to another workspace");
      const slot = currentSlots.current[scope];
      const next = applyCopyAction(
        plan,
        slot.history.document,
        {
          documentId: slot.history.document.id,
          sessionEpoch: slot.epoch,
          revision: slot.revision,
        },
        catalog,
        autoConnections[scope] ? neighborRules : undefined,
      );
      commit(
        scope,
        next,
        plan.kind === "repeat" || plan.kind === "repeat-grid"
          ? "Repeat objects"
          : plan.kind === "paste"
            ? "Paste objects"
            : "Duplicate objects",
        plan.selection,
        { notes: plan.notes },
      );
      return true;
    } catch (error) {
      setError(messageOf(error));
      return false;
    }
  }
  function commitPrimitive(scope: EditorScope, plan: PrimitiveActionPlan) {
    if (lifecycle.current.has(scope)) return false;
    try {
      if (plan.source.workspace !== scope)
        throw new Error("Primitive plan belongs to another workspace");
      const slot = currentSlots.current[scope];
      const next = applyPrimitiveAction(
        plan,
        slot.history.document,
        {
          documentId: slot.history.document.id,
          sessionEpoch: slot.epoch,
          revision: slot.revision,
        },
        catalog,
        autoConnections[scope] ? neighborRules : undefined,
      );
      commit(scope, next, "Build " + plan.kind, plan.selection, {
        notes: plan.notes,
      });
      return true;
    } catch (error) {
      setError(messageOf(error));
      return false;
    }
  }
  function commitMaterial(scope: EditorScope, plan: MaterialReplacementPlan) {
    if (lifecycle.current.has(scope)) return false;
    try {
      if (plan.source.workspace !== scope)
        throw new Error("Material plan belongs to another workspace");
      const slot = currentSlots.current[scope];
      const next = applyMaterialReplacement(
        plan,
        slot.history.document,
        {
          documentId: slot.history.document.id,
          sessionEpoch: slot.epoch,
          revision: slot.revision,
        },
        catalog,
        autoConnections[scope] ? neighborRules : undefined,
      );
      commit(scope, next, "Replace material", plan.selection, {
        notes: plan.notes,
      });
      return true;
    } catch (error) {
      setError(messageOf(error));
      return false;
    }
  }
  function commitMirror(scope: EditorScope, plan: MirrorPlan) {
    if (lifecycle.current.has(scope)) return false;
    try {
      if (plan.source.workspace !== scope)
        throw new Error("Mirror plan belongs to another workspace");
      const slot = currentSlots.current[scope];
      const next = applyMirrorPlan(plan, slot.history.document, {
        documentId: slot.history.document.id,
        sessionEpoch: slot.epoch,
        revision: slot.revision,
      }, catalog, autoConnections[scope] ? neighborRules : undefined);
      commit(scope, next, "Mirror objects", plan.selection, { notes: plan.notes });
      return true;
    } catch (error) {
      setError(messageOf(error));
      return false;
    }
  }
  function history(scope: EditorScope, redo: boolean) {
    if (lifecycle.current.has(scope)) return;
    cancelPreview();
    setError("");
    setSlots((previous) => {
      const slot = previous[scope],
        next = redo ? redoHistory(slot.history) : undoHistory(slot.history);
      const selection = measurePhase("history.selection", () => {
        // Empty/single selection needs no index allocation. Batch membership
        // uses one root index, while filter retains selection order/duplicates.
        if (slot.selection.length < 2)
          return slot.selection.filter((id) =>
            next.document.objects.some((object) => object.id === id),
          );
        const roots = new Set(next.document.objects.map((object) => object.id));
        return slot.selection.filter((id) => roots.has(id));
      });
      return { ...previous, [scope]: { ...slot, history: next, selection } };
    });
  }
  function transform(
    scope: EditorScope,
    intent: TransformIntent,
    phase: "preview" | "commit" | "cancel",
    space: CoordinateSpace,
    pivot: PivotMode,
  ) {
    if (lifecycle.current.has(scope)) return;
    if (phase === "cancel") {
      cancelPreview();
      setError("");
      return;
    }
    const slot = slots[scope];
    if (phase === "commit") transformPreviews.current?.reset();
    const result =
      phase === "preview"
        ? transformPreviews.current!.preview(
            {
              document: slot.history.document,
              catalog,
              scope,
              epoch: slot.epoch,
              revision: slot.revision,
              selection: slot.selection,
              space,
              pivot,
              view: viewRef.current[scope],
              autoConnections: autoConnections[scope],
              rules: autoConnections[scope] ? neighborRules : undefined,
            },
            intent,
          )
        : previewTransform(
            slot.history.document,
            slot.selection,
            intent,
            space,
            pivot,
            catalog,
            autoConnections[scope] ? neighborRules : undefined,
          );
    if (result.valid && result.document) {
      try {
        assertViewEdit(
          slot.history.document,
          result.document,
          viewRef.current[scope],
        );
      } catch (error) {
        result.valid = false;
        result.error = messageOf(error);
        result.document = null;
      }
    }
    if (phase === "preview") {
      setPreview({ scope, result });
      return;
    }
    cancelPreview();
    if (!result.valid || !result.document) {
      setError(result.error ?? "Cannot commit this transform");
      return;
    }
    // This result was computed and fully validated synchronously above, against
    // the current scene/rules. Commit its exact neighbor candidate once; never
    // reuse an older UI preview as proof or drop the final view-policy guard.
    try {
      commit(
        scope,
        result.document,
        intent.kind === "move" ? "Move objects" : "Rotate objects",
        undefined,
        { notes: result.notes ?? [] },
      );
    } catch (error) {
      setError(messageOf(error));
    }
  }
  function place(
    scope: EditorScope,
    state: BlockState,
    pos: Vec3,
    hit?: PlacementHit,
    options: PlacementOptions = { mode: "design", turns: 0 },
  ) {
    try {
      const before = slots[scope].history.document;
      const target = hit?.target && before.objects.find((root) => root.kind === "block" &&
        root.cells.length === 1 && root.cells[0].pos.every((value, axis) => value === hit.target![axis]));
      const { object, replaceObjectId } = planBlockPlacement(state, pos, catalog, hit, options, target || undefined);
      const next = replaceObjectId ? { ...before, objects: before.objects.map((root) => root.id === replaceObjectId ? object : root) }
        : insertObject(before, object, catalog);
      commit(
        scope,
        next,
        "Place object",
        [object.id],
      );
    } catch (error) {
      setError(messageOf(error));
    }
  }
  function group(scope: EditorScope) {
    try {
      const before = slots[scope].history.document;
      const next = groupObjects(
        before,
        slots[scope].selection,
        "Group",
        catalog,
      );
      commit(
        scope,
        next,
        "Group objects",
        next.objects
          .filter(
            (object) =>
              !before.objects.some((previous) => previous.id === object.id),
          )
          .map((object) => object.id),
      );
    } catch (error) {
      setError(messageOf(error));
    }
  }
  function ungroup(scope: EditorScope) {
    try {
      const before = slots[scope].history.document;
      const children = before.objects
        .filter(
          (object) =>
            slots[scope].selection.includes(object.id) &&
            object.kind === "group",
        )
        .flatMap((object) => object.children.map((child) => child.id));
      commit(
        scope,
        ungroupObjects(before, slots[scope].selection, catalog),
        "Ungroup objects",
        children,
      );
    } catch (error) {
      setError(messageOf(error));
    }
  }
  function remove(scope: EditorScope) {
    perform(
      scope,
      "Delete objects",
      (document) => removeObjects(document, slots[scope].selection, catalog),
      [],
    );
  }
  function updateChest(scope: EditorScope, rootId: string, position: Vec3, items: NonNullable<Block["blockEntity"]>["items"]) {
    return perform(scope, "Change chest inventory", (document) =>
      setChestInventory(document, rootId, position, items, catalog));
  }
  function updateState(scope: EditorScope, property: string, value: string) {
    perform(scope, "Change block state", (document) =>
      updateObjectsState(
        document,
        slots[scope].selection,
        property,
        value,
        catalog,
      ),
    );
  }
  function setPivot(scope: EditorScope, id: string, pivot2: Vec3) {
    perform(scope, "Set object pivot", (document) =>
      setObjectPivot(document, id, pivot2, catalog),
    );
  }
  function move(scope: EditorScope, delta: Vec3, space: CoordinateSpace) {
    perform(scope, "Move objects", (document) =>
      moveObjects(document, slots[scope].selection, delta, space, catalog),
    );
  }
  function rotate(scope: EditorScope, degrees: number, pivot: PivotMode) {
    perform(scope, "Rotate objects", (document) =>
      rotateObjects(
        document,
        slots[scope].selection,
        degrees / 90,
        pivot,
        catalog,
      ),
    );
  }
  function rename(scope: EditorScope, name: string) {
    perform(scope, "Rename document", (document) => ({
      ...document,
      name: name.trim() || "Untitled",
    }));
  }
  async function persist(scope: EditorScope) {
    if (saving.current.has(scope))
      throw new Error("A save is already in progress. Retry when it finishes.");
    saving.current.add(scope);
    const slot = currentSlots.current[scope],
      snapshot = slot.history.document;
    try {
      await controllers.current[scope]?.pause();
      const record = await editorRepository.save(snapshot, slot.token, {
        componentAssetId: slot.editingAssetId ?? undefined,
        draft: draftIdentity(slot),
      });
      setSlots((previous) =>
        previous[scope].epoch === slot.epoch
          ? {
              ...previous,
              [scope]: {
                ...previous[scope],
                saved: snapshot,
                token: record.token,
                savedRevision: slot.revision,
                draftId: crypto.randomUUID(),
              },
            }
          : previous,
      );
      setError("");
      return true;
    } catch (error) {
      setError(messageOf(error));
      throw error;
    } finally {
      saving.current.delete(scope);
      if (!lifecycle.current.has(scope)) controllers.current[scope]?.resume();
    }
  }
  async function save(scope: EditorScope) {
    if (lifecycle.current.has(scope)) {
      setError("A document operation is in progress. Retry when it finishes.");
      return false;
    }
    try {
      return await persist(scope);
    } catch (error) {
      setError(messageOf(error));
      return false;
    }
  }
  async function preserve(scope: EditorScope) {
    const slot = currentSlots.current[scope];
    if ((slot.pristine && !slot.saved) || slot.saved === slot.history.document)
      return;
    if (!(await controllers.current[scope]?.flush()))
      throw new Error(
        controllers.current[scope]?.status.error ??
          "Could not protect the draft. Save/export JSON or retry before switching.",
      );
  }
  async function newDocument(scope: EditorScope) {
    return exclusive(scope, async () => {
      if (
        currentSlots.current[scope].pristine &&
        !currentSlots.current[scope].saved
      )
        return;
      await preserve(scope);
      await editorRepository.activate(scope, null, null);
      setSlots((previous) => ({ ...previous, [scope]: makeSlot(scope) }));
    });
  }
  async function open(scope: EditorScope, document: EditorDocument) {
    return exclusive(scope, async () => {
      await preserve(scope);
      const record = await editorRepository.load(document.id);
      if (!record || record.document.workspace !== scope)
        throw new Error(
          "This saved document is no longer available. Your current document was kept.",
        );
      await editorRepository.activate(scope, document.id, record.token);
      setSlots((previous) => {
        const history = createHistory(record.document);
        const assetId = record.componentAssetId ?? record.document.id;
        return {
          ...previous,
          [scope]: {
            history,
            selection: [],
            entitySelection: [],
            saved: history.document,
            token: record.token,
            epoch: crypto.randomUUID(),
            pristine: false,
            editingAssetId:
              scope === "component" &&
              components.some((asset) => asset.id === assetId)
                ? assetId
                : null,
            revision: 0,
            savedRevision: 0,
            draftId: crypto.randomUUID(),
          },
        };
      });
    });
  }
  async function importDocument(scope: EditorScope, file: File) {
    return exclusive(scope, async () => {
      if (file.size > 32 * 1024 ** 2)
        throw new Error("Editor JSON must be at most 32 MiB");
      const raw = JSON.parse(await file.text()) as { schemaVersion?: number };
      const document =
        raw.schemaVersion === 2
          ? editorDocumentSchema.parse(raw)
          : fromLegacyProject(projectSchema.parse(raw));
      validateDocument(document, catalog);
      await preserve(scope);
      const imported = {
        ...document,
        id: crypto.randomUUID(),
        workspace: scope,
      };
      await editorRepository.activate(scope, null, null);
      setSlots((previous) => ({
        ...previous,
        [scope]: {
          history: createHistory(imported),
          selection: [],
          entitySelection: [],
          saved: null,
          editingAssetId: null,
          token: null,
          epoch: crypto.randomUUID(),
          pristine: false,
          revision: 1,
          savedRevision: null,
          draftId: crypto.randomUUID(),
        },
      }));
    });
  }
  async function saveComponent(scope: EditorScope, selectionOnly = true) {
    return exclusive(scope, async () => {
      const slot = currentSlots.current[scope],
        doc = slot.history.document;
      if (!selectionOnly && doc.entities.length)
        throw new Error(
          "Component library assets contain blocks only. Save this document or select block objects to publish.",
        );
      const ids = selectionOnly
        ? slot.selection
        : doc.objects.map((object) => object.id);
      const asset = componentFromSelection(
        doc,
        ids,
        scope === "component" ? doc.name : `Component ${components.length + 1}`,
      );
      if (scope === "component" && slot.editingAssetId) {
        const previousAsset = components.find((component) => component.id === slot.editingAssetId);
        if (previousAsset?.category) asset.category = previousAsset.category;
      }
      if (scope === "component")
        asset.id = slot.editingAssetId ?? crypto.randomUUID();
      await storage.saveComponentAsset(asset);
      setComponents((previous) => [
        ...previous.filter((component) => component.id !== asset.id),
        asset,
      ]);
      if (scope === "component") {
        setSlots((previous) =>
          previous.component.history.document.id === doc.id
            ? {
                ...previous,
                component: { ...previous.component, editingAssetId: asset.id },
              }
            : previous,
        );
        await persist("component");
      }
      setError("");
    });
  }
  const refreshDocuments = useCallback(async () => {
    return editorRepository.list();
  }, []);
  async function renameSaved(
    record: StoredEditorDocument,
    name: string,
    expectedCurrent: EditorDocument,
  ) {
    const scope = record.document.workspace;
    return exclusive(scope, async () => {
      const slot = currentSlots.current[scope],
        active = slot.history.document.id === record.document.id;
      if (
        active &&
        (slot.history.document !== expectedCurrent ||
          slot.saved !== slot.history.document)
      )
        throw new Error(
          "Save or discard current edits before renaming this saved document.",
        );
      if (active && !sameToken(slot.token, record.token))
        throw new RepositoryConflict();
      if (name.trim() === record.document.name) return;
      const next = editorDocumentSchema.parse({
        ...record.document,
        name: name.trim(),
      });
      const updated = await editorRepository.save(next, record.token, {
        activate: false,
      });
      if (active)
        setSlots((previous) => ({
          ...previous,
          [scope]: {
            ...previous[scope],
            history: executeHistory(
              previous[scope].history,
              next,
              "Rename document",
            ),
            saved: next,
            token: updated.token,
            savedRevision: previous[scope].revision + 1,
          },
        }));
    });
  }
  async function deleteDocument(
    record: StoredEditorDocument,
    expectedCurrent: EditorDocument,
  ) {
    const scope = record.document.workspace;
    return exclusive(scope, async () => {
      const slot = currentSlots.current[scope],
        active = slot.history.document.id === record.document.id;
      if (active && slot.history.document !== expectedCurrent)
        throw new Error(
          "The current document changed. Review the delete confirmation again.",
        );
      if (active && !sameToken(slot.token, record.token))
        throw new RepositoryConflict();
      await editorRepository.remove(record.document.id, record.token, scope);
      if (active)
        setSlots((previous) => ({ ...previous, [scope]: makeSlot(scope) }));
    });
  }
  async function discardChanges(
    scope: EditorScope,
    expectedCurrent: EditorDocument,
  ) {
    return exclusive(scope, async () => {
      const slot = currentSlots.current[scope];
      if (slot.history.document !== expectedCurrent)
        throw new Error(
          "The current document changed. Review the discard confirmation again.",
        );
      await draftRepository.discard(draftIdentity(slot), undefined, {
        id: slot.saved?.id ?? null,
        token: slot.token,
      });
      if (slot.saved) {
        const history = createHistory(slot.saved);
        setSlots((previous) => ({
          ...previous,
          [scope]: {
            ...slot,
            history,
            saved: history.document,
            selection: [],
            entitySelection: [],
            epoch: crypto.randomUUID(),
            revision: 0,
            savedRevision: 0,
            draftId: crypto.randomUUID(),
          },
        }));
      } else
        setSlots((previous) => ({ ...previous, [scope]: makeSlot(scope) }));
    });
  }
  async function restoreRecovery(head: DraftHead, copy: boolean) {
    const scope = head.workspace;
    return exclusive(scope, async () => {
      await preserve(scope);
      const recovered = await draftRepository.restore(head, {
        id: crypto.randomUUID(),
        epoch: crypto.randomUUID(),
        ...(copy ? { copyDocumentId: crypto.randomUUID() } : {}),
      });
      const history = createHistory(recovered.document);
      const slot: Slot = {
        history,
        saved: recovered.saved?.document ?? null,
        token: recovered.saved?.token ?? null,
        selection: [],
        entitySelection: [],
        pristine: false,
        editingAssetId: recovered.head.componentAssetId ?? null,
        epoch: recovered.head.epoch,
        draftId: recovered.head.id,
        revision: 1,
        savedRevision: recovered.saved ? 0 : null,
      };
      setSlots((previous) => ({ ...previous, [scope]: slot }));
      controllers.current[scope]?.adopt(draftWrite(slot)!);
    });
  }
  async function discardRecovery(head: DraftHead) {
    return exclusive(head.workspace, () =>
      draftRepository.discard(head, head.revision),
    );
  }
  async function recoveryDocument(head: DraftHead) {
    return draftRepository.load(head);
  }
  async function retryDraft(scope: EditorScope) {
    return controllers.current[scope]?.retry() ?? false;
  }
  async function restorePortable(
    bundle: PortableBackup,
    expectedCurrent: EditorDocument,
  ) {
    const scope = bundle.document.workspace;
    return exclusive(scope, async () => {
      if (currentSlots.current[scope].history.document !== expectedCurrent)
        throw new Error(
          "The current document changed. Review the backup again.",
        );
      const plan = planPortableRestore(bundle);
      await preserve(scope);
      const restored = await commitPortableRestore(plan);
      const history = createHistory(restored.document);
      setComponents((previous) => [...previous, ...plan.components]);
      setSlots((previous) => ({
        ...previous,
        [scope]: {
          history,
          saved: history.document,
          token: restored.token,
          selection: [],
          entitySelection: [],
          pristine: false,
          editingAssetId: null,
          epoch: crypto.randomUUID(),
          draftId: crypto.randomUUID(),
          revision: 0,
          savedRevision: 0,
        },
      }));
    });
  }
  async function importStructure(
    next: EditorDocument,
    expectedCurrent: EditorDocument,
  ) {
    return exclusive(next.workspace, async () => {
      if (
        currentSlots.current[next.workspace].history.document !==
        expectedCurrent
      )
        throw new Error("The document changed. Review the import again.");
      validateDocument(next, catalog);
      const document = editorDocumentSchema.parse({
        ...next,
        id: crypto.randomUUID(),
      });
      await preserve(next.workspace);
      const record = await commitPortableRestore({ document, components: [] });
      const history = createHistory(record.document);
      setSlots((previous) => ({
        ...previous,
        [next.workspace]: {
          history,
          saved: history.document,
          token: record.token,
          selection: [],
          entitySelection: [],
          pristine: false,
          editingAssetId: null,
          epoch: crypto.randomUUID(),
          draftId: crypto.randomUUID(),
          revision: 0,
          savedRevision: 0,
        },
      }));
    });
  }
  async function editComponent(asset: ComponentAsset) {
    return exclusive("component", async () => {
      await preserve("component");
      const document = {
        ...newEditorDocument("component"),
        name: asset.name,
        objects: structuredClone(asset.objects),
      };
      await editorRepository.activate("component", null, null);
      setSlots((previous) => ({
        ...previous,
        component: {
          history: createHistory(document),
          selection: [],
          entitySelection: [],
          saved: null,
          editingAssetId: asset.id,
          token: null,
          epoch: crypto.randomUUID(),
          pristine: false,
          revision: 1,
          savedRevision: null,
          draftId: crypto.randomUUID(),
        },
      }));
    });
  }
  function placeComponent(
    scope: EditorScope,
    asset: ComponentAsset,
    pos: Vec3,
    turns: QuarterTurn = 0,
  ) {
    try {
      const object = planComponentPlacement(asset, pos, turns, catalog);
      commit(
        scope,
        insertObject(slots[scope].history.document, object, catalog),
        "Place component",
        [object.id],
      );
    } catch (error) {
      setError(messageOf(error));
    }
  }
  async function importComponent(file: File) {
    try {
      if (file.size > 32 * 1024 ** 2)
        throw new Error("Component JSON must be at most 32 MiB");
      const source = componentAssetSchema.parse(JSON.parse(await file.text()));
      const asset = { ...source, id: crypto.randomUUID() };
      validateDocument(
        { ...newEditorDocument("component"), objects: asset.objects },
        catalog,
      );
      await storage.saveComponentAsset(asset);
      setComponents((previous) => [...previous, asset]);
      setError("");
    } catch (error) {
      setError(messageOf(error));
    }
  }
  async function changeComponentCategory(id: string, category: ComponentCategory) {
    try {
      const source = components.find((asset) => asset.id === id);
      if (!source) throw new Error("Component no longer exists");
      const asset = setComponentCategory(source, category);
      await storage.saveComponentAsset(asset);
      setComponents((previous) => previous.map((entry) => entry.id === id ? asset : entry));
      setError(""); return true;
    } catch (error) { setError(messageOf(error)); return false; }
  }
  async function renameComponent(id: string, name: string) {
    try {
      const source = components.find((asset) => asset.id === id);
      if (!source) throw new Error("Component no longer exists");
      const asset = renameComponentAsset(source, name);
      await storage.saveComponentAsset(asset);
      setComponents((previous) => previous.map((entry) => entry.id === id ? asset : entry));
      setError("");
      return true;
    } catch (error) { setError(messageOf(error)); return false; }
  }
  async function duplicateComponent(id: string) {
    try {
      const source = components.find((asset) => asset.id === id);
      if (!source) throw new Error("Component no longer exists");
      const asset = duplicateComponentAsset(source, components, () => crypto.randomUUID());
      await storage.saveComponentAsset(asset);
      setComponents((previous) => [...previous, asset]);
      setError("");
      return true;
    } catch (error) { setError(messageOf(error)); return false; }
  }
  async function removeComponent(id: string) {
    try {
      await storage.removeComponentAsset(id);
      setComponents((previous) => previous.filter((asset) => asset.id !== id));
    } catch (error) {
      setError(messageOf(error));
    }
  }
  function configureConnections(scope: EditorScope, enabled: boolean) {
    cancelPreview();
    setConnectionNotes(null);
    setAutoConnections((previous) => ({ ...previous, [scope]: enabled }));
  }
  return {
    entityPreview,
    selectEntity,
    selectEntities,
    previewEntity,
    commitEntity,
    views,
    changeView,
    clipboard,
    copySelection,
    commitCopy,
    commitPrimitive,
    commitMaterial,
    commitMirror,
    importStructure,
    restorePortable,
    draftStatus,
    recoveryCount,
    refreshRecoveries,
    restoreRecovery,
    discardRecovery,
    recoveryDocument,
    retryDraft,
    busy,
    refreshDocuments,
    renameSaved,
    deleteDocument,
    discardChanges,
    autoConnections,
    connectionNotes,
    configureConnections,
    slots,
    components,
    ready,
    error,
    setError,
    preview,
    cancelPreview,
    select,
    history,
    transform,
    place,
    group,
    ungroup,
    remove,
    updateState,
    updateChest,
    setPivot,
    move,
    rotate,
    rename,
    save,
    newDocument,
    open,
    importDocument,
    saveComponent,
    editComponent,
    placeComponent,
    importComponent,
    removeComponent,
    renameComponent,
    changeComponentCategory,
    duplicateComponent,
  };
}

export type EditorSession = ReturnType<typeof useEditorSession>;
