import { ViewControls } from "./ViewControls";
import {
  createRootViewResolver,
  createEntityViewResolver,
  editableRootIds,
  assertViewEdit,
  toggleRootHidden,
  toggleRootLocked,
  type EditorViewState,
} from "../editor/view-state";
import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { defaultState, validateState } from "../core/catalog";
import { blockAdapter } from "../core/adapter-registry";
import { createCapabilityResolver, type CapabilityAction } from "../core/capabilities";
import { assessAppearance } from "../render/appearance-capability";
import { bounds } from "../core/assembly";
import { resourceName } from "../core/labels";
import type { BlockState, SceneBlock, Vec3 } from "../core/schema";
import { download } from "../io/storage";
import {
  objectCells,
  sceneBlocks,
  type CoordinateSpace,
  type EditorDocument,
  type EditorObject,
  type PivotMode,
  type QuarterTurn,
} from "../editor/model";
import { selectionPivot2 } from "../editor/operations";
import { sharedStateFields } from "../editor/state-edit";
import { planNeighborConnections } from "../editor/neighbors";
import { SelectionStateFields } from "./SelectionStateFields";
import { CopyActionMenu, CopyActionPanel } from "./CopyActionPanel";
import { useCopyActions } from "../editor/useCopyActions";
import { MaterialsPanel } from "./MaterialsPanel";
import { useMaterialActions } from "../editor/useMaterialActions";
import { useMirrorActions } from "../editor/useMirrorActions";
import { MirrorActionPanel } from "./MirrorActionPanel";
import { useWallActions } from "../editor/useWallActions";
import { WallActionPanel } from "./WallActionPanel";
import { usePrimitiveActions } from "../editor/usePrimitiveActions";
import type { PrimitiveKind } from "../editor/primitive-plan";
import {
  PrimitiveActionMenu,
  PrimitiveActionPanel,
} from "./PrimitiveActionPanel";
import {
  planBlockPlacement,
  planComponentPlacement,
  type PlacementOptions,
} from "../editor/placement-plan";
import { createSupportChecker, type SupportIssue } from "../editor/support";
import type { EditorScope, EditorSession } from "../editor/useEditorSession";
import type { ResourceSession } from "../resources/useResources";
import type {
  EditorPlacementHit,
  EditorViewportState,
  RenderDiagnostics,
  ViewCommand,
  ViewCommandKind,
} from "../viewport/Viewport";
import { Icon, type IconName } from "./Icon";
import { ResourceBrowser } from "./ResourceBrowser";
import { ComponentLibrary } from "./ComponentLibrary";
import { EntityPanel } from "./EntityPanel";
import { ChestInventory } from "./ChestInventory";
import { CapabilityDetails } from "./CapabilityDetails";
import { editableEntityIds } from "../editor/entity-action";
import "./editor.css";

const Viewport = lazy(() =>
  import("../viewport/Viewport").then((module) => ({
    default: module.Viewport,
  })),
);
const ExportDialog = lazy(() =>
  import("./ExportDialog").then((module) => ({ default: module.ExportDialog })),
);
const ImportStructureDialog = lazy(() =>
  import("./ImportStructureDialog").then((module) => ({
    default: module.ImportStructureDialog,
  })),
);
const DocumentManager = lazy(() =>
  import("./DocumentManager").then((module) => ({
    default: module.DocumentManager,
  })),
);

function SupportDetails({ issues }: { issues: SupportIssue[] }) {
  if (!issues.length) return null;
  return (
    <details className="quiet-details support-details">
      <summary>
        <Icon name="warning" size={13} />
        Support · {issues.length}
      </summary>
      <ul>
        {issues.slice(0, 12).map((issue, index) => (
          <li key={`${issue.code}:${issue.pos}:${index}`}>
            <code>{issue.pos.join(", ")}</code>
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
      {issues.length > 12 && (
        <small>{issues.length - 12} more · see export checks</small>
      )}
    </details>
  );
}

function PlacementControls({
  mode,
  turns,
  component,
  onMode,
  onRotate,
}: {
  mode: PlacementOptions["mode"];
  turns: QuarterTurn;
  component: boolean;
  onMode: (mode: PlacementOptions["mode"]) => void;
  onRotate: (turns: number) => void;
}) {
  return (
    <div className="placement-controls">
      {!component && (
        <label>
          Placement
          <select
            aria-label="Placement mode"
            value={mode}
            onChange={(event) =>
              onMode(event.target.value as PlacementOptions["mode"])
            }
          >
            <option value="design">Design</option>
            <option value="context">Context</option>
          </select>
        </label>
      )}
      <button
        className="icon-button"
        aria-label="Rotate placement counterclockwise"
        title="Rotate preview −90° · Shift R"
        onClick={() => onRotate(-1)}
      >
        <Icon name="undo" size={14} />
      </button>
      <span
        className="placement-angle"
        title={
          component
            ? "Rotate cells and states, then anchor minimum bounds to the target cell"
            : "Yaw offset after the selected placement policy"
        }
      >
        {turns * 90}°
      </span>
      <button
        className="icon-button"
        aria-label="Rotate placement clockwise"
        title="Rotate preview +90° · R"
        onClick={() => onRotate(1)}
      >
        <Icon name="redo" size={14} />
      </button>
    </div>
  );
}
const EMPTY_GHOST: Vec3[] = [];
const noop = () => {};
type Props = {
  resources: ResourceSession;
  session: EditorSession;
  workspace: "architecture" | "component" | "preview";
  onWorkspace: (
    workspace: "architecture" | "component" | "preview" | "assets",
  ) => void;
  onResources: () => void;
};

function NumericTransform({
  object,
  onMove,
  onRotate,
  onPivot,
}: {
  object: EditorObject;
  onMove: (delta: Vec3, absolute: boolean) => void;
  onRotate: (degrees: number) => void;
  onPivot: (pivot2: Vec3) => void;
}) {
  const origin = bounds(objectCells(object)).min;
  const [position, setPosition] = useState<Vec3>(origin);
  const [offset, setOffset] = useState<Vec3>([0, 0, 0]);
  const [angle, setAngle] = useState(90);
  const [pivot, setPivot] = useState<Vec3>(
    object.pivot2.map((value) => value / 2) as Vec3,
  );
  const vectorFields = (
    label: string,
    value: Vec3,
    set: (next: Vec3) => void,
  ) => (
    <div className="vector-fields">
      {["X", "Y", "Z"].map((axis, index) => (
        <label key={axis}>
          <span>{axis}</span>
          <input
            type="number"
            aria-label={`${label} ${axis}`}
            step={label === "Pivot" ? 0.5 : 1}
            value={Number.isFinite(value[index]) ? value[index] : ""}
            onChange={(event) =>
              set(
                value.map((item, n) =>
                  n === index ? event.target.valueAsNumber : item,
                ) as Vec3,
              )
            }
          />
        </label>
      ))}
    </div>
  );
  return (
    <section className="editor-section">
      <h2>Transform</h2>
      <label className="editor-field-label">Position · world anchor</label>
      {vectorFields("Position", position, setPosition)}
      <button
        className="button wide"
        onClick={() =>
          onMove(
            position.map((value, index) => value - origin[index]) as Vec3,
            true,
          )
        }
      >
        Set position
      </button>
      <label className="editor-field-label">Move offset · current space</label>
      {vectorFields("Move offset", offset, setOffset)}
      <button className="button wide" onClick={() => onMove(offset, false)}>
        Apply move
      </button>
      <label className="property-field">
        <span>Yaw angle</span>
        <input
          type="number"
          aria-label="Rotation degrees"
          step={90}
          value={angle}
          onChange={(event) => setAngle(event.target.valueAsNumber)}
        />
      </label>
      <button className="button wide" onClick={() => onRotate(angle)}>
        Apply rotation
      </button>
      <small className="editor-hint">Y axis · 90° steps · integer cells</small>
      <details className="quiet-details pivot-settings">
        <summary>Object pivot</summary>
        {vectorFields("Pivot", pivot, setPivot)}
        <button
          className="button wide"
          onClick={() => onPivot(pivot.map((value) => value * 2) as Vec3)}
        >
          Set pivot
        </button>
        <button
          className="button wide"
          title="Use the first cell center to rotate even-sized footprints without fractional cells"
          onClick={() =>
            onPivot(
              objectCells(object)[0].pos.map((value) => value * 2 + 1) as Vec3,
            )
          }
        >
          Use anchor cell center
        </button>
      </details>
    </section>
  );
}

function StateFields({
  state,
  resources,
  paired,
  onChange,
}: {
  state: BlockState;
  resources: ResourceSession;
  paired: boolean;
  onChange: (property: string, value: string) => void;
}) {
  const material = resources.catalog.find((item) => item.id === state.name);
  const properties = Object.entries(material?.properties ?? {}).filter(
    ([property]) => !paired || !["half", "part"].includes(property),
  );
  return (
    <div className="property-list">
      {properties.map(([property, values]) => (
        <label className="property-field" key={property}>
          <span>{property.replaceAll("_", " ")}</span>
          {values.length === 2 &&
          values.includes("true") &&
          values.includes("false") ? (
            <input
              type="checkbox"
              aria-label={`State ${property}`}
              checked={state.properties[property] === "true"}
              onChange={(event) =>
                onChange(property, String(event.target.checked))
              }
            />
          ) : (
            <select
              aria-label={`State ${property}`}
              value={state.properties[property]}
              onChange={(event) => onChange(property, event.target.value)}
            >
              {values.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          )}
        </label>
      ))}
      {!properties.length && (
        <span className="editor-hint">No editable state properties</span>
      )}
    </div>
  );
}

function ObjectTree({
  object,
  selected,
  onSelect,
  viewState,
  onView,
  selectable,
}: {
  object: EditorObject;
  selectable: boolean;
  selected: boolean;
  onSelect: (toggle: boolean) => void;
  viewState: EditorViewState;
  onView: (next: EditorViewState) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = useMemo(() => objectCells(object).length, [object]);
  return (
    <div className={`outliner-object${selected ? " chosen" : ""}`}>
      <button
        disabled={!selectable}
        title={object.id}
        aria-description={
          !selectable
            ? "Protected by the current view: hidden, locked, outside isolate or not wholly inside the Y range."
            : undefined
        }
        onClick={(event) => onSelect(event.shiftKey)}
      >
        <Icon
          name={
            object.kind === "group"
              ? "layers"
              : object.kind === "component"
                ? "blocks"
                : "cube"
          }
          size={14}
        />
        <span>{object.name}</span>
        <small>{count}</small>
      </button>
      <span className="root-view-actions">
        <button
          aria-label={
            (viewState.hidden.includes(object.id) ? "Show" : "Hide") +
            " object " +
            object.name +
            " (" +
            object.id +
            ")"
          }
          aria-pressed={viewState.hidden.includes(object.id)}
          onClick={() => onView(toggleRootHidden(viewState, [object.id]))}
        >
          <Icon name="eye" size={13} />
        </button>
        <button
          aria-label={
            (viewState.locked.includes(object.id) ? "Unlock" : "Lock") +
            " object " +
            object.name +
            " (" +
            object.id +
            ")"
          }
          aria-pressed={viewState.locked.includes(object.id)}
          onClick={() => onView(toggleRootLocked(viewState, [object.id]))}
        >
          {viewState.locked.includes(object.id) ? "Unlock" : "Lock"}
        </button>
      </span>
      {!!object.children.length && (
        <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary>{object.children.length} children</summary>
          {expanded && (
            <>
              {object.children.slice(0, 40).map((child) => (
                <span className="outliner-child" key={child.id}>
                  {child.name}
                  <small>{objectCells(child).length} cells</small>
                </span>
              ))}
              {object.children.length > 40 && (
                <small>Showing 40 children · ungroup to edit members</small>
              )}
            </>
          )}
        </details>
      )}
    </div>
  );
}

function ObjectOutliner({
  objects,
  selected,
  onSelect,
  viewState,
  onView,
}: {
  objects: EditorObject[];
  selected: Set<string>;
  onSelect: (id: string, toggle: boolean) => void;
  viewState: EditorViewState;
  onView: (next: EditorViewState) => void;
}) {
  const [limit, setLimit] = useState(100);
  const policy = useMemo(
    () => createRootViewResolver(viewState, objects),
    [viewState, objects],
  );
  return (
    <div className="outliner">
      {objects.slice(0, limit).map((object) => (
        <ObjectTree
          selectable={policy(object.id).selectable}
          viewState={viewState}
          onView={onView}
          key={object.id}
          object={object}
          selected={selected.has(object.id)}
          onSelect={(toggle) => onSelect(object.id, toggle)}
        />
      ))}
      {objects.length > limit && (
        <button
          className="load-more"
          onClick={() => setLimit((value) => value + 100)}
        >
          Show {Math.min(100, objects.length - limit)} more objects
        </button>
      )}
    </div>
  );
}

export function EditorWorkbench({
  resources,
  session,
  workspace,
  onWorkspace,
  onResources,
}: Props) {
  const [previewSource, setPreviewSource] =
    useState<EditorScope>("architecture");
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [structureImportOpen, setStructureImportOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [exportSnapshot, setExportSnapshot] = useState<{
    document: EditorDocument;
    catalog: ResourceSession["catalog"];
  } | null>(null);
  const scope: EditorScope =
    workspace === "preview" ? previewSource : workspace;
  const readOnly = workspace === "preview";
  const slot = session.slots[scope],
    document = slot.history.document;
  const [tool, setTool] = useState<EditorViewportState["tool"]>("select");
  const [entityPlacement, setEntityPlacement] = useState<string | null>(null);
  const [space, setSpace] = useState<CoordinateSpace>("global");
  const [pivotMode, setPivotMode] = useState<PivotMode>("active");
  const [requestedState, setRequestedState] = useState<BlockState>(() =>
    defaultState("minecraft:oak_log"),
  );
  const [libraryTab, setLibraryTab] = useState<"blocks" | "components">(
    "blocks",
  );
  const [componentId, setComponentId] = useState<string | null>(null);
  const [layer, setLayer] = useState(0);
  const [placementHit, setPlacementHit] = useState<EditorPlacementHit | null>(
    null,
  );
  const [placementMode, setPlacementMode] =
    useState<PlacementOptions["mode"]>("design");
  const [placementTurns, setPlacementTurns] = useState<QuarterTurn>(0);
  const [regionPlacement, setRegionPlacement] = useState(false);
  const [regionDragging, setRegionDragging] = useState(false);
  const [command, setCommand] = useState<ViewCommand>();
  const [diagnostics, setDiagnostics] = useState<RenderDiagnostics>({
    modeledBlocks: 0,
    fallbackBlocks: 0,
    entities: 0,
    issues: [],
  });
  const [libraryOpen, setLibraryOpen] = useState(
    () => matchMedia("(min-width: 761px)").matches,
  );
  const [inspectorOpen, setInspectorOpen] = useState(
    () => matchMedia("(min-width: 1000px)").matches,
  );
  const interactionKey = `${scope}:${document.id}:${slot.epoch}:${readOnly}`;
  const cancelTransformPreview = session.cancelPreview;
  useEffect(() => {
    cancelTransformPreview();
    return cancelTransformPreview;
  }, [interactionKey, cancelTransformPreview]);
  useEffect(() => {
    cancelTransformPreview();
  }, [
    resources.resolver,
    resources.profile,
    resources.packs,
    resources.catalog,
    cancelTransformPreview,
  ]);
  const [interactionOwner, setInteractionOwner] = useState(interactionKey);
  if (interactionOwner !== interactionKey) {
    setInteractionOwner(interactionKey);
    setTool("select");
    setEntityPlacement(null);
    setPlacementHit(null);
    setRegionPlacement(false);
    setRegionDragging(false);
  }
  const viewState = session.views[scope];
  const selectableEntities = useMemo(
    () => new Set(editableEntityIds(document, viewState)),
    [document, viewState],
  );
  const stagedEntity =
    !readOnly &&
    session.entityPreview?.scope === scope &&
    session.entityPreview.plan.source === document &&
    session.entityPreview.plan.catalog === resources.catalog &&
    session.entityPreview.plan.view === viewState
      ? session.entityPreview.plan
      : null;
  const selectableOwners = useMemo(
    () => editableRootIds(document, viewState),
    [document, viewState],
  );
  const blocks = useMemo(() => sceneBlocks(document), [document]);
  const visibleBlocks = useMemo(() => {
    if (viewState.entityIsolated != null && viewState.isolated === null) return [];
    if (
      !viewState.hidden.length &&
      viewState.isolated === null &&
      !viewState.yRange
    )
      return blocks;
    const hidden = new Set(viewState.hidden),
      isolated =
        viewState.isolated === null ? null : new Set(viewState.isolated);
    return blocks.filter(
      (block) =>
        !hidden.has(block.owner) &&
        (isolated === null || isolated.has(block.owner)) &&
        (!viewState.yRange ||
          (block.pos[1] >= viewState.yRange.min &&
            block.pos[1] <= viewState.yRange.max)),
    );
  }, [blocks, viewState.hidden, viewState.isolated, viewState.entityIsolated, viewState.yRange]);
  const visibleEntities = useMemo(() => {
    const candidates = stagedEntity?.document.entities ?? document.entities;
    let previewView = viewState;
    if (stagedEntity && viewState.entityIsolated != null) {
      const existing = new Set(document.entities.map((entity) => entity.id));
      const added = candidates.filter((entity) => !existing.has(entity.id)).map((entity) => entity.id);
      if (added.length) previewView = { ...viewState,
        entityIsolated: [...viewState.entityIsolated, ...added] };
    }
    const resolve = createEntityViewResolver(previewView);
    return candidates.filter((entity) => resolve(entity).drawn);
  }, [stagedEntity, document.entities, viewState]);
  const occupied = useMemo(
    () => new Map(blocks.map((block) => [block.pos.join(","), block])),
    [blocks],
  );
  const materials = useMemo(
    () => new Map(resources.catalog.map((material) => [material.id, material])),
    [resources.catalog],
  );
  const checkSupport = useMemo(
    () => createSupportChecker(blocks, resources.catalog),
    [blocks, resources.catalog],
  );
  const supportIssues = useMemo(() => checkSupport(), [checkSupport]);
  const state = useMemo(() => {
    try {
      validateState(requestedState, resources.catalog);
      return requestedState;
    } catch {
      return defaultState(
        resources.catalog.some((item) => item.id === requestedState.name)
          ? requestedState.name
          : resources.catalog[0].id,
        resources.catalog,
      );
    }
  }, [requestedState, resources.catalog]);
  const capabilities = useMemo(
    () => createCapabilityResolver(resources.catalog, { target: document.target, profile: resources.profile }),
    [resources.catalog, resources.profile, document.target],
  );
  const placementCapabilities = useMemo(() => {
    if (tool !== "place" || libraryTab === "components") return [];
    const appearance = assessAppearance({ kind: "block", id: state.name, state,
      material: materials.get(state.name), profile: resources.profile, resolver: resources.resolver });
    const actions: CapabilityAction[] = ["appearance", "design", "context", "yaw", "neighbors", "payload-edit"];
    return actions.map((action) => capabilities.block(state, action, { appearance }));
  }, [tool, libraryTab, state, materials, resources.profile, resources.resolver, capabilities]);
  const asset = session.components.find((item) => item.id === componentId);
  const placingComponent = asset && libraryTab === "components" ? asset : null;
  const placementPlan = useMemo(() => {
    if (!placementHit || tool !== "place" || readOnly || entityPlacement) return null;
    try {
      const plan = placingComponent
        ? {
            object: planComponentPlacement(
              placingComponent,
              placementHit.pos,
              placementTurns,
              resources.catalog,
            ),
            notes: [] as string[],
          }
        : planBlockPlacement(
            state,
            placementHit.pos,
            resources.catalog,
            placementHit,
            { mode: placementMode, turns: placementTurns },
            document.objects.find((root) => root.kind === "block" && root.cells.length === 1 &&
              placementHit.target && root.cells[0].pos.every((value, axis) => value === placementHit.target![axis])),
            occupied,
          );
      const replaceObjectId = "replaceObjectId" in plan ? plan.replaceObjectId : undefined;
      const candidateDocument = { ...document, objects: replaceObjectId
        ? document.objects.map((root) => root.id === replaceObjectId ? plan.object : root)
        : [...document.objects, plan.object] };
      assertViewEdit(
        document,
        candidateDocument,
        viewState,
      );
      let candidate = objectCells(plan.object).map((cell) => ({
        ...cell,
        owner: plan.object.id,
      }));
      const collision = candidate.some((cell) =>
        occupied.has(cell.pos.join(",")) && !document.objects.find((root) =>
          root.id === replaceObjectId && root.cells.some((old) => old.pos.every((value, axis) => value === cell.pos[axis]))),
      );
      if (
        !collision &&
        session.autoConnections[scope] &&
        resources.profile?.neighborRules
      ) {
        const connected = planNeighborConnections(
          document,
          candidateDocument,
          resources.profile.neighborRules,
        );
        for (const block of connected.changed) {
          const material = materials.get(block.state.name);
          if (!material)
            throw new Error(`Missing registry: ${block.state.name}`);
          validateState(block.state, [material]);
        }
        assertViewEdit(document, connected.document, viewState);
        plan.object = connected.document.objects.find(
          (object) => object.id === plan.object.id,
        )!;
        candidate = [
          ...objectCells(plan.object).map((cell) => ({
            ...cell,
            owner: plan.object.id,
          })),
          ...connected.changed.filter(
            (block) => block.owner !== plan.object.id,
          ),
        ];
        plan.notes.push(...connected.notes);
      }
      const issues = checkSupport(candidate);
      return {
        ...plan,
        blocks: candidate,
        valid: !collision,
        error: collision ? "Cell collision" : "",
        issues,
      };
    } catch (error) {
      return {
        object: null,
        blocks: [] as SceneBlock[],
        valid: false,
        error:
          error instanceof Error ? error.message : "Cannot place this object",
        notes: [] as string[],
        issues: [] as SupportIssue[],
      };
    }
  }, [
    placementHit,
    tool,
    readOnly,
    entityPlacement,
    placingComponent,
    placementTurns,
    placementMode,
    state,
    resources.catalog,
    occupied,
    checkSupport,
    session.autoConnections,
    scope,
    resources.profile,
    document,
    materials,
    viewState,
  ]);
  const active = useMemo(
    () =>
      document.objects.find((object) => object.id === slot.selection.at(-1)),
    [document, slot.selection],
  );
  const selectionSet = useMemo(() => new Set(slot.selection), [slot.selection]);
  const selectedObjects = useMemo(
    () => document.objects.filter((object) => selectionSet.has(object.id)),
    [document, selectionSet],
  );
  const commonState = useMemo(
    () => sharedStateFields(selectedObjects, resources.catalog),
    [selectedObjects, resources.catalog],
  );
  const selectedCells = useMemo(
    () => selectedObjects.flatMap(objectCells),
    [selectedObjects],
  );
  const selectionCapabilities = useMemo(() => {
    if (selectedObjects.length !== 1 ||
      (selectedCells.length !== 1 && !["block", "multiblock"].includes(selectedObjects[0].kind))) return [];
    const cell = selectedCells[0];
    if (!cell) return [];
    const appearance = assessAppearance({ kind: "block", id: cell.state.name, state: cell.state,
      material: materials.get(cell.state.name), profile: resources.profile, resolver: resources.resolver });
    const actions: CapabilityAction[] = ["appearance", "translate", "yaw", "mirror", "payload-edit", "structure-export", "world"];
    return actions.map((action) => capabilities.block(cell.state, action, { payload: cell.blockEntity, appearance }));
  }, [selectedObjects, selectedCells, materials, resources.profile, resources.resolver, capabilities]);
  const selectedBounds = useMemo(() => bounds(selectedCells), [selectedCells]);
  const diagnosticSnapshot = useMemo(
    () =>
      JSON.stringify({
        id: document.id,
        objects: document.objects
          .slice(0, 32)
          .map(({ id, kind, pivot2, orientation }) => ({
            id,
            kind,
            pivot2,
            orientation,
          })),
        cells: blocks.slice(0, 64),
      }),
    [document, blocks],
  );
  const pivot2 = useMemo(
    () =>
      active
        ? selectionPivot2(document, slot.selection, pivotMode)
        : ([0, 0, 0] as Vec3),
    [document, slot.selection, pivotMode, active],
  );
  const copyActions = useCopyActions(
    session,
    scope,
    !readOnly &&
      session.ready &&
      resources.ready &&
      !session.busy[scope] &&
      !documentsOpen &&
      !structureImportOpen &&
      !exportSnapshot,
    resources.catalog,
    session.autoConnections[scope]
      ? resources.profile?.neighborRules
      : undefined,
  );
  const primitiveResourceKey = useMemo(
    () => ({
      resolver: resources.resolver,
      profile: resources.profile,
      packs: resources.packs,
      viewState,
    }),
    [resources.resolver, resources.profile, resources.packs, viewState],
  );
  const transformConnections = session.autoConnections[scope];
  const transformContext = useMemo(
    () => ({
      resources: primitiveResourceKey,
      catalog: resources.catalog,
      connections: transformConnections,
      scope,
      pivotMode,
    }),
    [
      primitiveResourceKey,
      resources.catalog,
      transformConnections,
      scope,
      pivotMode,
    ],
  );
  const entityContext = useMemo(() => ({
    transformContext, documentId: document.id, epoch: slot.epoch,
    revision: slot.revision, readOnly, key: crypto.randomUUID(),
  }), [transformContext, document.id, slot.epoch, slot.revision, readOnly]);
  const primitiveActions = usePrimitiveActions({
    document,
    scope,
    revision: slot.revision,
    epoch: slot.epoch,
    catalog: resources.catalog,
    rules: session.autoConnections[scope]
      ? resources.profile?.neighborRules
      : undefined,
    state,
    enabled:
      !readOnly &&
      session.ready &&
      resources.ready &&
      !session.busy[scope] &&
      !documentsOpen &&
      !structureImportOpen &&
      !exportSnapshot &&
      libraryTab === "blocks",
    resourceKey: primitiveResourceKey,
    onCommit: session.commitPrimitive,
  });
  const materialActions = useMaterialActions({
    document,
    scope,
    revision: slot.revision,
    epoch: slot.epoch,
    selection: slot.selection,
    catalog: resources.catalog,
    rules: session.autoConnections[scope]
      ? resources.profile?.neighborRules
      : undefined,
    enabled:
      !readOnly &&
      session.ready &&
      resources.ready &&
      !session.busy[scope] &&
      !documentsOpen &&
      !structureImportOpen &&
      !exportSnapshot,
    resourceKey: primitiveResourceKey,
    onCommit: session.commitMaterial,
  });
  const mirrorActions = useMirrorActions({
    document, scope, revision: slot.revision, epoch: slot.epoch,
    selection: slot.selection, catalog: resources.catalog,
    rules: session.autoConnections[scope] ? resources.profile?.neighborRules : undefined,
    enabled: !readOnly && session.ready && resources.ready && !session.busy[scope] &&
      !documentsOpen && !structureImportOpen && !exportSnapshot,
    resourceKey: primitiveResourceKey,
    onCommit: session.commitMirror,
  });
  const wallActions = useWallActions({
    document, scope, revision: slot.revision, epoch: slot.epoch,
    catalog: resources.catalog, state,
    rules: session.autoConnections[scope] ? resources.profile?.neighborRules : undefined,
    enabled: !readOnly && session.ready && resources.ready && !session.busy[scope] &&
      !documentsOpen && !structureImportOpen && !exportSnapshot && libraryTab === "blocks",
    resourceKey: primitiveResourceKey,
    onCommit: session.commitWall,
  });
  function protectionError(
    plan: { document: EditorDocument } | undefined | null,
  ) {
    if (!plan) return "";
    try {
      assertViewEdit(document, plan.document, viewState);
      return "";
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Protected objects cannot be changed";
    }
  }
  function protectedPlan<T extends { document: EditorDocument }>(
    plan: T | undefined | null,
  ): T | undefined {
    return plan && !protectionError(plan) ? plan : undefined;
  }
  const materialPlan = protectedPlan(materialActions.result?.plan);
  const mirrorPlan = protectedPlan(mirrorActions.result?.plan);
  const wallPlan = protectedPlan(wallActions.result?.plan);
  const selectedStates = useMemo(
    () => selectedCells.map((cell) => cell.state),
    [selectedCells],
  );
  const primitivePlan = protectedPlan(primitiveActions.result?.plan);
  const copyPlan = protectedPlan(copyActions.result?.plan);
  const pending =
    session.preview?.scope === scope ? session.preview.result : null;
  const ghost = useMemo(
    () =>
      wallActions.active
        ? wallPlan ? { blocks: wallPlan.cells, valid: true } : undefined
        : mirrorActions.active
        ? mirrorPlan ? { blocks: mirrorPlan.cells, valid: true } : undefined
        : materialActions.active
        ? materialPlan
          ? { blocks: materialPlan.cells, valid: true }
          : undefined
        : primitiveActions.active
          ? primitivePlan
            ? { blocks: primitivePlan.cells, valid: true }
            : undefined
          : copyActions.active
            ? copyPlan
              ? { blocks: copyPlan.cells, valid: true }
              : undefined
            : pending
              ? { blocks: pending.blocks, valid: pending.valid }
              : placementPlan
                ? { blocks: placementPlan.blocks, valid: placementPlan.valid }
                : undefined,
    [
      wallActions.active,
      wallPlan,
      mirrorActions.active,
      mirrorPlan,
      materialActions.active,
      materialPlan,
      primitiveActions.active,
      primitivePlan,
      copyActions.active,
      copyPlan,
      pending,
      placementPlan,
    ],
  );
  const loaded = session.ready && resources.ready && !session.busy[scope];
  const dirty = slot.saved !== document;
  const protection = session.draftStatus[scope];
  const view = (kind: ViewCommandKind) =>
    setCommand((previous) => ({ id: (previous?.id ?? 0) + 1, kind }));
  const changeTool = (
    next: EditorViewportState["tool"],
    focusViewport = true,
  ) => {
    wallActions.cancel();
    mirrorActions.cancel();
    materialActions.cancel();
    setMaterialsOpen(false);
    primitiveActions.cancel();
    copyActions.cancel();
    session.cancelPreview();
    session.setError("");
    setRegionPlacement(false);
    setRegionDragging(false);
    setPlacementHit(null);
    setTool(next);
    if (next !== "place") setEntityPlacement(null);
    if (focusViewport) focusCopyCanvas();
  };
  const changeView = (next: EditorViewState) => {
    changeTool("select");
    session.changeView(scope, next);
  };
  const beginPrimitive = (kind: PrimitiveKind) => {
    changeTool("select");
    primitiveActions.begin(kind, placementHit?.pos ?? [0, layer, 0]);
    focusCopyCanvas();
  };
  const beginMirror = () => {
    changeTool("select");
    mirrorActions.begin();
    focusCopyCanvas();
  };
  const beginWall = () => {
    changeTool("select");
    wallActions.begin(placementHit?.pos ?? [0, layer, 0]);
    focusCopyCanvas();
  };
  const completeWall = () => {
    wallActions.confirm();
    focusCopyCanvas();
  };
  const cancelWall = () => {
    wallActions.cancel();
    focusCopyCanvas();
  };
  const completeMirror = () => {
    mirrorActions.confirm();
    focusCopyCanvas();
  };
  const cancelMirror = () => {
    mirrorActions.cancel();
    focusCopyCanvas();
  };
  const completePrimitive = () => {
    if (primitiveActions.confirm()) setRegionPlacement(false);
    focusCopyCanvas();
  };
  const cancelPrimitive = () => {
    primitiveActions.cancel();
    setRegionPlacement(false);
    focusCopyCanvas();
  };
  const beginCopy = (kind: "duplicate" | "paste" | "repeat" | "repeat-grid") => {
    changeTool("select");
    copyActions.begin(kind);
  };
  const beginEntityPlacement = () => {
    changeTool("select");
    session.select(scope, [], false);
    setEntityPlacement(crypto.randomUUID());
    setTool("place");
    setInspectorOpen(true);
    focusCopyCanvas();
  };
  const focusCopyCanvas = () =>
    globalThis.document
      .querySelector<HTMLCanvasElement>(".editor-canvas canvas")
      ?.focus();
  const completeCopy = () => {
    copyActions.confirm();
    focusCopyCanvas();
  };
  const cancelCopy = () => {
    copyActions.cancel();
    focusCopyCanvas();
  };
  const rotatePlacement = (turns: number) =>
    setPlacementTurns(
      (previous) => ((previous + turns + 4) % 4) as QuarterTurn,
    );

  function place(hit: EditorPlacementHit) {
    if (!loaded) return;
    if (placingComponent)
      session.placeComponent(scope, placingComponent, hit.pos, placementTurns);
    else
      session.place(scope, state, hit.pos, hit, {
        mode: placementMode,
        turns: placementTurns,
      });
    setPlacementHit(null);
  }
  function beginPlacementRegion(hit: EditorPlacementHit) {
    // Resolve orientation once at the first face; the existing Design planner then
    // repeats that complete logical template, including bed/door pairs.
    try {
      const template = planBlockPlacement(
        state,
        hit.pos,
        resources.catalog,
        hit,
        { mode: placementMode, turns: placementTurns },
      ).object.cells[0].state;
      wallActions.cancel();
      mirrorActions.cancel();
      materialActions.cancel();
      setMaterialsOpen(false);
      copyActions.cancel();
      session.cancelPreview();
      session.setError("");
      setPlacementHit(null);
      setRegionPlacement(true);
      setRegionDragging(true);
      primitiveActions.begin("plane", hit.pos, template);
      return true;
    } catch (error) {
      session.setError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }
  function editorCommand(
    name: Parameters<EditorViewportState["onCommand"]>[0],
  ) {
    if (!loaded) return;
    wallActions.cancel();
    mirrorActions.cancel();
    if (slot.entitySelection.length) {
      if (name === "delete" || name === "duplicate") {
        session.previewEntity(scope, name === "delete" ? { kind: "remove" } : {
          kind: "duplicate", newIds: slot.entitySelection.map(() => crypto.randomUUID()), offset: [1, 0, 0],
        });
        setInspectorOpen(true);
        return;
      }
      if (name === "select-all") {
        session.selectEntities(scope, [...selectableEntities], false); return;
      }
      if (name === "deselect") { session.selectEntities(scope, [], false); return; }
      if (["copy", "paste", "repeat", "group", "ungroup"].includes(name)) {
        session.setError("Use entity Duplicate; block clipboard and groups do not include free entities."); return;
      }
    }
    if (name === "copy") {
      materialActions.cancel();
      setMaterialsOpen(false);
      primitiveActions.cancel();
      copyActions.copy();
      return;
    }
    if (name === "duplicate" || name === "paste" || name === "repeat") {
      beginCopy(name);
      return;
    }
    materialActions.cancel();
    primitiveActions.cancel();
    copyActions.cancel();
    if (name === "undo" || name === "redo")
      session.history(scope, name === "redo");
    else if (name === "delete" && slot.selection.length) session.remove(scope);
    else if (name === "group" && slot.selection.length > 1)
      session.group(scope);
    else if (name === "ungroup" && slot.selection.length)
      session.ungroup(scope);
    else if (name === "select-all")
      session.select(
        scope,
        document.objects.map((object) => object.id),
        false,
      );
    else if (name === "deselect") session.select(scope, [], false);
  }
  const editor: EditorViewportState | undefined =
    readOnly || !loaded
      ? undefined
      : {
          revisionKey: `${scope}:${document.id}:${slot.epoch}:${slot.revision}`,
          transformContext,
          entities: {
            source: document.entities,
            selected: slot.entitySelection,
            selectable: [...selectableEntities],
            tool: entityPlacement && tool === "place" ? "place" : tool === "move" || tool === "rotate" ? tool : "select",
            placementId: entityPlacement ?? undefined,
            yaw: 0,
            contextKey: entityContext.key,
            previewing: !!stagedEntity,
            onSelect: (id, toggle) => {
              if (id) session.selectEntity(scope, id, toggle);
              else session.selectEntities(scope, [], false);
            },
            onPreview: (intent) => session.previewEntity(scope, intent),
            onConfirm: () => {
              if (session.commitEntity(scope) && entityPlacement) { setEntityPlacement(null); setTool("select"); }
            },
            onCancel: () => { session.cancelPreview(); if (entityPlacement) { setEntityPlacement(null); setTool("select"); } },
            onTool: (next) => changeTool(next),
          },
          selectableOwners,
          tool:
            wallActions.active ||
            mirrorActions.active ||
            materialActions.active ||
            primitiveActions.active ||
            copyActions.active
              ? "place"
              : tool,
          selected: slot.selection,
          active: slot.selection.at(-1) ?? null,
          space,
          pivot: pivot2.map((value) => value / 2) as [number, number, number],
          localYaw: active?.orientation ?? 0,
          ghost,
          placementSession:
            wallActions.active?.id ??
            mirrorActions.active?.id ??
            materialActions.active?.id ??
            primitiveActions.active?.id ??
            copyActions.active?.id,
          onTool: changeTool,
          onSelect: (ids, toggle) => session.select(scope, ids, toggle),
          onPlace: wallActions.active || mirrorActions.active || materialActions.active
            ? noop
            : primitiveActions.active
              ? regionPlacement
                ? noop
                : (hit) => primitiveActions.point(hit.pos)
              : copyActions.active
                ? (hit) => copyActions.point(hit.pos)
                : place,
          onPlacementRegionStart:
            tool === "place" &&
            libraryTab === "blocks" &&
            !wallActions.active &&
            !mirrorActions.active &&
            !materialActions.active &&
            !primitiveActions.active &&
            !copyActions.active
              ? beginPlacementRegion
              : undefined,
          onPlacementRegionPoint:
            regionPlacement || (tool === "place" && libraryTab === "blocks")
              ? primitiveActions.point
              : undefined,
          onPlacementRegionEnd: (cancel) => {
            setRegionDragging(false);
            if (cancel) changeTool("select");
          },
          onPlacementHover: wallActions.active || mirrorActions.active || materialActions.active
            ? noop
            : primitiveActions.active
              ? regionPlacement
                ? noop
                : (hit) => {
                    if (hit) primitiveActions.point(hit.pos);
                  }
              : copyActions.active
                ? (hit) => {
                    if (hit) copyActions.point(hit.pos);
                  }
                : setPlacementHit,
          onPlacementRotate:
            wallActions.active ||
            mirrorActions.active ||
            materialActions.active ||
            primitiveActions.active ||
            copyActions.active
              ? noop
              : rotatePlacement,
          onPlacementConfirm: wallActions.active
            ? completeWall
            : mirrorActions.active
            ? completeMirror
            : materialActions.active
            ? () => {
                materialActions.confirm();
                focusCopyCanvas();
              }
            : primitiveActions.active
              ? completePrimitive
              : copyActions.active
                ? completeCopy
                : undefined,
          onPlacementCancel: () => {
            setPlacementTurns(0);
            changeTool("select");
          },
          onTransform: (intent, phase) =>
            session.transform(scope, intent, phase, "global", pivotMode),
          onCommand: editorCommand,
        };
  function saveShortcut(event: KeyboardEvent) {
    if (event.target instanceof Element && event.target.closest(".component-preview-dialog")) return;
    if (exportSnapshot || documentsOpen || structureImportOpen) return;
    if (
      stagedEntity &&
      event.key === "Escape" &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.stopPropagation();
      session.cancelPreview();
      if (entityPlacement) { setEntityPlacement(null); setTool("select"); }
      return;
    }
    if (event.ctrlKey && event.code === "KeyS") {
      event.preventDefault();
      if (loaded && !readOnly) void session.save(scope);
    }
  }

  const tools: {
    id: EditorViewportState["tool"];
    icon: IconName;
    label: string;
    shortcut: string;
  }[] = [
    {
      id: "select",
      icon: "select",
      label: "Select",
      shortcut: "Q · Click / drag · Shift toggles · Ctrl A all",
    },
    {
      id: "box",
      icon: "box-select",
      label: "Box",
      shortcut: "B · Through selection",
    },
    {
      id: "place",
      icon: "plus",
      label: "Place",
      shortcut:
        "E · Click places · Alt click selects · Ctrl drag builds a block plane",
    },
    { id: "move", icon: "pan", label: "Move", shortcut: "G · Grid 1" },
    { id: "rotate", icon: "orbit", label: "Rotate", shortcut: "R · Y 90°" },
  ];
  return (
    <div
      className={`editor-workspace${materialsOpen || wallActions.active || mirrorActions.active || materialActions.active || copyActions.active || (primitiveActions.active && !regionDragging) ? " copying" : ""}${!libraryOpen || readOnly ? " library-hidden" : ""}${!inspectorOpen || readOnly ? " inspector-hidden" : ""}`}
      data-region-dragging={regionDragging}
      data-editor-scope={scope}
      data-editor-ready={loaded}
      data-placement-mode={placementMode}
      data-placement-turns={placementTurns}
      onKeyDownCapture={saveShortcut}
    >
      <div className="editor-document-bar">
        <div className="document-identity">
          <Icon
            name={scope === "architecture" ? "architecture" : "blocks"}
            size={17}
          />
          <input
            key={`${document.id}:${document.name}`}
            aria-label="Document name"
            defaultValue={document.name}
            readOnly={readOnly || !loaded}
            onBlur={(event) => {
              if (event.target.value !== document.name)
                session.rename(scope, event.target.value);
            }}
          />
          <span className={dirty ? "document-dirty" : "document-saved"}>
            {dirty ? "Unsaved" : "Saved"}
          </span>
        </div>
        {readOnly ? (
          <label className="preview-source">
            Source
            <select
              aria-label="Preview document source"
              value={previewSource}
              onChange={(event) => {
                session.cancelPreview();
                setPreviewSource(event.target.value as EditorScope);
              }}
            >
              <option value="architecture">Architecture</option>
              <option value="component">Component</option>
            </select>
          </label>
        ) : (
          <div className="document-actions">
            <button
              aria-label="Manage editor documents"
              title="Open, rename, delete or discard documents"
              disabled={!loaded}
              onClick={() => {
                session.cancelPreview();
                setDocumentsOpen(true);
              }}
            >
              <Icon name="file" size={14} />
              Documents
            </button>
            <button
              title="Save current draft, then create a new document"
              disabled={!loaded}
              onClick={() => void session.newDocument(scope)}
            >
              New
            </button>
            <label
              className="button"
              title="Import editor v2 or legacy project JSON"
            >
              Open JSON
              <input
                className="visually-hidden"
                type="file"
                accept=".json"
                aria-label="Import editor document"
                disabled={!loaded}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void session.importDocument(scope, file);
                  event.target.value = "";
                }}
              />
            </label>
            <button
              aria-label="Open Structure NBT import"
              disabled={!loaded}
              onClick={() => {
                session.cancelPreview();
                setStructureImportOpen(true);
              }}
            >
              Import NBT
            </button>
            <button
              aria-label="Export editor document"
              title="Back up editor document (.blockstage.json)"
              onClick={() =>
                download(
                  `${document.name}.blockstage.json`,
                  JSON.stringify(document, null, 2),
                  "application/json",
                )
              }
            >
              <Icon name="file" size={14} />
            </button>
            <button
              className="button"
              aria-label="Export Minecraft"
              disabled={!loaded}
              onClick={() =>
                setExportSnapshot({ document, catalog: resources.catalog })
              }
            >
              Export Minecraft
            </button>
            <button
              className="button primary"
              disabled={!loaded}
              onClick={() => void session.save(scope)}
            >
              <Icon name="save" size={14} />
              Save
            </button>
          </div>
        )}
      </div>
      {!readOnly &&
        ((!slot.pristine && dirty) || session.recoveryCount[scope] > 0) && (
          <div className="editor-recovery-status">
            <span
              role="status"
              aria-label="Draft protection"
              data-phase={protection.phase}
              title={
                protection.error ??
                "Recovery is separate from Save. Only completed writes are protected."
              }
            >
              {!slot.pristine && dirty
                ? protection.phase === "protected"
                  ? "Draft protected"
                  : protection.phase === "error"
                    ? "Draft not protected"
                    : "Protecting draft…"
                : ""}
            </span>
            {protection.phase === "error" && (
              <button
                aria-label="Retry draft protection"
                title={protection.error}
                onClick={() => void session.retryDraft(scope)}
              >
                Retry
              </button>
            )}
            {session.recoveryCount[scope] > 0 && (
              <button
                aria-label="Open recovery documents"
                onClick={() => {
                  setRecoveryOpen(true);
                  setDocumentsOpen(true);
                }}
              >
                Recovery · {session.recoveryCount[scope]}
              </button>
            )}
          </div>
        )}
      <div className="workbench editor-workbench" inert={session.busy[scope]}>
        {!readOnly && libraryOpen && (
          <aside className="library editor-library">
            <div className="editor-library-tabs">
              <button
                className={libraryTab === "blocks" ? "active" : ""}
                onClick={() => {
                  setLibraryTab("blocks");
                  setComponentId(null);
                }}
              >
                Blocks
              </button>
              <button
                className={libraryTab === "components" ? "active" : ""}
                onClick={() => setLibraryTab("components")}
              >
                Components<span>{session.components.length}</span>
              </button>
            </div>
            {libraryTab === "blocks" ? (
              <ResourceBrowser
                blocksOnly
                catalog={resources.catalog}
                profile={resources.profile}
                resolver={resources.resolver}
                kind="block"
                selected={state.name}
                onKind={noop}
                onSelect={(id) => {
                  setRequestedState(defaultState(id, resources.catalog));
                  changeTool("place");
                }}
              />
            ) : (
              <ComponentLibrary
                assets={session.components}
                resources={resources}
                onResources={onResources}
                selected={componentId}
                onSelect={(component) => {
                  setComponentId(component.id);
                  changeTool("place");
                }}
                onEdit={(component) => {
                  void session.editComponent(component).then((success) => {
                    if (success) {
                      onWorkspace("component");
                      changeTool("select");
                    }
                  });
                }}
                onDelete={(id) => void session.removeComponent(id)}
                onRename={session.renameComponent}
                onCategory={session.changeComponentCategory}
                onDuplicate={session.duplicateComponent}
                onImport={(file) => void session.importComponent(file)}
              />
            )}
          </aside>
        )}
        <section className="stage">
          <div className="view-toolbar editor-toolbar">
            <div className="editor-tools">
              {!readOnly && (
                <CopyActionMenu
                  enabled={loaded}
                  selected={!!slot.selection.length}
                  hasClipboard={!!session.clipboard}
                  onAction={(action) => {
                    if (action === "copy") {
                      wallActions.cancel();
                      mirrorActions.cancel();
                      materialActions.cancel();
                      setMaterialsOpen(false);
                      primitiveActions.cancel();
                      copyActions.copy();
                    } else beginCopy(action);
                    globalThis.document
                      .querySelector<HTMLCanvasElement>(".editor-canvas canvas")
                      ?.focus();
                  }}
                />
              )}
              {!readOnly && (
                <PrimitiveActionMenu
                  enabled={loaded && libraryTab === "blocks"}
                  onAction={beginPrimitive}
                  onWall={beginWall}
                />
              )}
              {!readOnly && (
                <button type="button" aria-label="Mirror selection"
                  title="Reflect selected blocks, groups or component copies in a vertical World plane"
                  disabled={!loaded || !slot.selection.length} onClick={beginMirror}>Mirror</button>
              )}
              {!readOnly && (
                <>
                  <button
                    className="icon-button"
                    title="Toggle library"
                    aria-label="Toggle editor library"
                    onClick={() => setLibraryOpen((value) => !value)}
                  >
                    <Icon name="menu" size={16} />
                  </button>
                  {tools.map((item) => (
                    <button
                      key={item.id}
                      aria-label={`${item.label} tool`}
                      title={`${item.label} · ${item.shortcut}`}
                      className={tool === item.id ? "active" : ""}
                      disabled={!loaded}
                      onClick={() => changeTool(item.id)}
                    >
                      <Icon name={item.icon} size={16} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                  <span className="toolbar-separator" />
                  <button
                    aria-label="Group selection"
                    title="Group · Ctrl G"
                    disabled={slot.selection.length < 2}
                    onClick={() => session.group(scope)}
                  >
                    <Icon name="layers" size={16} />
                  </button>
                  <button
                    aria-label="Ungroup selection"
                    title="Ungroup · Ctrl Alt G"
                    disabled={
                      !selectedObjects.some((object) => object.kind === "group")
                    }
                    onClick={() => session.ungroup(scope)}
                  >
                    <Icon name="ungroup" size={16} />
                  </button>
                </>
              )}
              {readOnly && (
                <span className="read-only-label">
                  <Icon name="eye" size={16} />
                  3D Preview
                </span>
              )}
            </div>
            <div className="view-actions">
              <ViewControls
                key={`${document.id}:${scope}`}
                view={viewState}
                selection={slot.selection}
                entitySelection={slot.entitySelection}
                selectionBounds={
                  selectedCells.length
                    ? {
                        min: selectedBounds.min[1],
                        max: selectedBounds.min[1] + selectedBounds.size[1] - 1,
                      }
                    : slot.entitySelection.length ? (() => {
                      const ys = document.entities.filter((entity) => slot.entitySelection.includes(entity.id)).map((entity) => entity.position[1]);
                      return ys.length ? { min: Math.floor(Math.min(...ys)), max: Math.ceil(Math.max(...ys)) } : null;
                    })() : null
                }
                onChange={changeView}
              />
              <button
                aria-label="Open materials"
                onClick={() => {
                  if (materialsOpen) {
                    materialActions.cancel();
                    setMaterialsOpen(false);
                  } else {
                    changeTool("select");
                    setMaterialsOpen(true);
                  }
                }}
              >
                Materials
              </button>
              <button
                className="icon-button"
                aria-label="Frame editor scene"
                title="Frame all · Home"
                onClick={() => view("frame-all")}
              >
                <Icon name="frame" size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Editor projection"
                title="Perspective / orthographic · Numpad 5"
                onClick={() => view("projection")}
              >
                <Icon name="perspective" size={17} />
              </button>
              {!readOnly && (
                <button
                  className="icon-button"
                  aria-label="Toggle editor inspector"
                  title="Toggle inspector"
                  onClick={() => setInspectorOpen((value) => !value)}
                >
                  <Icon name="sliders" size={17} />
                </button>
              )}
            </div>
          </div>
          {!readOnly && (
            <div className="editor-context-bar">
              <label>
                Space
                <select
                  aria-label="Transform space"
                  disabled={!!slot.entitySelection.length || !!entityPlacement}
                  value={space}
                  onChange={(event) => {
                    session.cancelPreview();
                    setSpace(event.target.value as CoordinateSpace);
                  }}
                >
                  <option value="global">Global</option>
                  <option value="local">Local</option>
                </select>
              </label>
              <label>
                Pivot
                <select
                  aria-label="Transform pivot"
                  disabled={!!slot.entitySelection.length || !!entityPlacement}
                  value={pivotMode}
                  onChange={(event) => {
                    session.cancelPreview();
                    setPivotMode(event.target.value as PivotMode);
                  }}
                >
                  <option value="active">Object origin</option>
                  <option value="selection">Selection center</option>
                  <option value="individual">Individual origins</option>
                </select>
              </label>
              {entityPlacement ? <span className="design-mode">Place pig · pointer surface · Enter confirms · Esc cancels</span> : tool === "place" ? (
                <PlacementControls
                  mode={placementMode}
                  turns={placementTurns}
                  component={!!placingComponent}
                  onMode={setPlacementMode}
                  onRotate={rotatePlacement}
                />
              ) : (
                <span className="design-mode">{slot.entitySelection.length ? "Entity · World move · individual yaw" : "Grid edit"}</span>
              )}
              <span className="context-spacer" />
              <button
                className="icon-button"
                aria-label="Undo editor"
                disabled={!slot.history.past.length}
                onClick={() => session.history(scope, false)}
              >
                <Icon name="undo" size={16} />
              </button>
              <button
                className="icon-button"
                aria-label="Redo editor"
                disabled={!slot.history.future.length}
                onClick={() => session.history(scope, true)}
              >
                <Icon name="redo" size={16} />
              </button>
            </div>
          )}
          <div className="canvas-wrap editor-canvas">
            {materialsOpen && (
              <MaterialsPanel
                document={document}
                selection={slot.selection}
                selectedStates={selectedStates}
                catalog={resources.catalog}
                readOnly={readOnly}
                intent={materialActions.active?.intent}
                plan={materialPlan}
                error={
                  protectionError(materialActions.result?.plan) ||
                  materialActions.result?.error ||
                  ""
                }
                onBegin={(intent) => {
                  wallActions.cancel();
                  mirrorActions.cancel();
                  primitiveActions.cancel();
                  copyActions.cancel();
                  session.cancelPreview();
                  materialActions.begin(intent);
                  focusCopyCanvas();
                }}
                onChange={materialActions.change}
                onConfirm={() => {
                  materialActions.confirm();
                  focusCopyCanvas();
                }}
                onCancel={() => {
                  materialActions.cancel();
                  focusCopyCanvas();
                }}
                onClose={() => {
                  materialActions.cancel();
                  setMaterialsOpen(false);
                  focusCopyCanvas();
                }}
              />
            )}
            {wallActions.active && (
              <WallActionPanel
                key={wallActions.active.id}
                intent={wallActions.active.intent}
                onChange={wallActions.change}
                valid={!!wallPlan}
                error={protectionError(wallActions.result?.plan) || wallActions.result?.error || ""}
                cells={wallPlan?.cost.addedCells ?? 0}
                notes={wallPlan?.notes ?? []}
                onCommit={completeWall}
                onCancel={cancelWall}
              />
            )}
            {mirrorActions.active && (
              <MirrorActionPanel
                key={mirrorActions.active.id}
                intent={mirrorActions.active.intent}
                onChange={mirrorActions.change}
                valid={!!mirrorPlan}
                error={protectionError(mirrorActions.result?.plan) || mirrorActions.result?.error || ""}
                cells={mirrorPlan?.cells.length ?? 0}
                notes={mirrorPlan?.notes ?? []}
                onCommit={completeMirror}
                onCancel={cancelMirror}
              />
            )}
            {primitiveActions.active && (
              <PrimitiveActionPanel
                key={primitiveActions.active.id}
                fixed={regionPlacement}
                intent={primitiveActions.active.intent}
                onChange={primitiveActions.change}
                valid={!!primitivePlan}
                error={
                  protectionError(primitiveActions.result?.plan) ||
                  primitiveActions.result?.error ||
                  ""
                }
                cells={primitivePlan?.cost.addedCells ?? 0}
                anchors={primitivePlan?.anchors ?? 0}
                notes={primitivePlan?.notes ?? []}
                onCommit={completePrimitive}
                onCancel={cancelPrimitive}
              />
            )}
            {copyActions.active && (
              <CopyActionPanel
                intent={copyActions.active.intent}
                onChange={copyActions.change}
                valid={!!copyPlan}
                error={
                  protectionError(copyActions.result?.plan) ||
                  copyActions.result?.error ||
                  ""
                }
                cells={copyPlan?.cost.addedCells ?? 0}
                notes={copyPlan?.notes ?? []}
                onCommit={completeCopy}
                onCancel={cancelCopy}
              />
            )}
            <Suspense
              fallback={<div className="viewport-empty">Opening editor…</div>}
            >
              <Viewport
                blocks={visibleBlocks}
                entities={visibleEntities}
                packs={resources.packs}
                resolver={resources.resolver}
                catalog={resources.catalog}
                profile={resources.profile}
                selected={slot.selection.at(-1) ?? null}
                tool="select"
                layer={layer}
                ghost={EMPTY_GHOST}
                clip={null}
                local={false}
                onPick={noop}
                onDelete={noop}
                onUndo={noop}
                onRotate={noop}
                onHover={noop}
                onEntityPick={noop}
                onMessage={session.setError}
                onDiagnostics={setDiagnostics}
                editor={editor}
                previewMode={!editor}
                frameKey={`${scope}:${document.id}`}
                command={command}
              />
            </Suspense>
            {stagedEntity && !readOnly && (
              <div className="transform-hud entity-preview-actions" role="group" aria-label="Entity preview controls">
                <span>{stagedEntity.label}</span>
                <button type="button" aria-label="Apply entity viewport preview" onClick={() => {
                  if (session.commitEntity(scope) && entityPlacement) { setEntityPlacement(null); setTool("select"); }
                  focusCopyCanvas();
                }}>Confirm</button>
                <button type="button" aria-label="Cancel entity viewport preview" onClick={() => {
                  session.cancelPreview(); setEntityPlacement(null); setTool("select"); focusCopyCanvas();
                }}>Cancel</button>
              </div>
            )}
            <div className="viewport-caption">
              <span>{document.name}</span>
              <small>
                {readOnly
                  ? "Read-only view"
                  : stagedEntity
                    ? "Entity preview · Confirm / Cancel"
                    : `${document.objects.length} objects · ${blocks.length} cells`}
              </small>
            </div>
            <div
              className="editor-placement-diagnostics"
              hidden
              data-valid={placementPlan?.valid ?? false}
              data-snapshot={
                placementPlan
                  ? JSON.stringify({
                      cells: placementPlan.blocks
                        .slice(0, 64)
                        .map(({ pos, state }) => ({ pos, state })),
                      issues: placementPlan.issues,
                      notes: placementPlan.notes,
                      error: placementPlan.error,
                    })
                  : ""
              }
            />
            <div className="editor-axis-widget">
              <button
                aria-label="Editor X view"
                title="2D YZ · Right view"
                onClick={() => view("right")}
              >
                X
              </button>
              <button
                aria-label="Editor Y view"
                title="2D XZ · Top view"
                onClick={() => view("top")}
              >
                Y
              </button>
              <button
                aria-label="Editor Z view"
                title="2D XY · Front view"
                onClick={() => view("front")}
              >
                Z
              </button>
            </div>
            {!wallActions.active && !mirrorActions.active && !primitiveActions.active && tool === "place" && placementPlan && (
              <div
                className={`placement-hud ${placementPlan.valid ? "valid" : "invalid"}`}
                role="status"
              >
                <Icon
                  name={
                    placementPlan.valid
                      ? placementPlan.issues.length
                        ? "warning"
                        : "check"
                      : "warning"
                  }
                  size={14}
                />
                <span>
                  {placementPlan.error ||
                    (placementPlan.issues.length
                      ? `${placementPlan.issues.length} support notes`
                      : `${placementPlan.blocks.length} cells · Ready`)}
                </span>
                <kbd>R</kbd>
                <span>rotate</span>
                <kbd>Esc</kbd>
                <span>cancel</span>
              </div>
            )}
            {pending && (
              <div
                className={`transform-hud ${pending.valid ? "valid" : "invalid"}`}
                role="status"
              >
                <Icon name={pending.valid ? "check" : "warning"} size={14} />
                <span>
                  {pending.valid
                    ? `${pending.blocks.length} cells · Ready`
                    : pending.error}
                </span>
                <kbd>Enter</kbd>
                <span>commit</span>
                <kbd>Esc</kbd>
                <span>cancel</span>
              </div>
            )}
            {!blocks.length &&
              !primitiveActions.active &&
              !copyActions.active && (
                <div className="editor-empty">
                  <Icon name={readOnly ? "eye" : "architecture"} size={32} />
                  <strong>
                    {readOnly
                      ? "Nothing to preview yet"
                      : scope === "architecture"
                        ? "Build your architecture"
                        : "Design a component"}
                  </strong>
                  <span>
                    {readOnly
                      ? "Add objects in an editor first."
                      : "Choose a block or component, then place it on the grid."}
                  </span>
                  {!resources.packs.some((pack) => pack.enabled) && (
                    <button onClick={onResources}>Import game assets</button>
                  )}
                </div>
              )}
            {!!diagnostics.issues.length && (
              <details className="viewport-diagnostics">
                <summary>
                  <Icon name="warning" size={14} />
                  Appearance details · {diagnostics.issues.length}
                </summary>
                <ul>
                  {diagnostics.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <footer className="editor-stage-footer">
            <span>
              {readOnly
                ? "Read-only"
                : slot.entitySelection.length
                  ? `${slot.entitySelection.length} entities selected`
                  : `${slot.selection.length} selected`}
              <span className="footer-separator">·</span>1 unit = 1 block
            </span>
            {!readOnly && (
              <label>
                Grid Y
                <input
                  type="number"
                  aria-label="Placement grid Y"
                  step={1}
                  value={layer}
                  onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    if (Number.isInteger(value))
                      setLayer(Math.max(-2048, Math.min(2048, value)));
                  }}
                />
              </label>
            )}
            <span className="editor-navigation-hint">
              MMB orbit · Shift MMB pan
            </span>
          </footer>
        </section>
        {!readOnly && inspectorOpen && (
          <aside className="inspector editor-inspector">
            <div className="panel-heading">
              <span>Inspector</span>
              <span>{tool === "place" ? "Placement" : "Selection"}</span>
            </div>
            <div className="inspector-content">
              <label
                className="neighbor-policy"
                title={
                  resources.profile?.neighborRules
                    ? "Opt-in scene connections for fence, wall and gate. Empty cells are treated as air; existing documents change only on edits. Turn off to keep explicit states."
                    : "Regenerate and import the game profile with prepare:game to enable verified neighbor predicates."
                }
              >
                <input
                  type="checkbox"
                  aria-label="Auto connections"
                  disabled={!resources.profile?.neighborRules}
                  checked={session.autoConnections[scope]}
                  onChange={(event) =>
                    session.configureConnections(scope, event.target.checked)
                  }
                />
                Auto connections
              </label>
              {session.connectionNotes?.scope === scope &&
                session.connectionNotes.document === document &&
                !!session.connectionNotes.notes.length && (
                  <details className="quiet-details support-details">
                    <summary>
                      Connection notes · {session.connectionNotes.notes.length}
                    </summary>
                    <ul>
                      {session.connectionNotes.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </details>
                )}
              {tool === "place" ? (
                <section className="editor-section">
                  <div className="asset-type">
                    <Icon name="cube" size={16} />
                    <span>
                      {asset && libraryTab === "components"
                        ? "Component"
                        : "Block"}
                    </span>
                  </div>
                  <h2 className="editor-object-title">
                    {asset && libraryTab === "components"
                      ? asset.name
                      : resourceName(state.name)}
                  </h2>
                  {!(asset && libraryTab === "components") && (
                    <>
                      <code className="block-id">{state.name}</code>
                      {placementMode === "context" && (
                        <small className="editor-field-label">
                          Palette state
                        </small>
                      )}
                      <StateFields
                        state={state}
                        resources={resources}
                        paired={!!blockAdapter(state.name)?.logical}
                        onChange={(property, value) =>
                          setRequestedState({
                            ...state,
                            properties: {
                              ...state.properties,
                              [property]: value,
                            },
                          })
                        }
                      />
                      {!!placementCapabilities.length && <CapabilityDetails decisions={placementCapabilities} />}
                    </>
                  )}
                  {!placingComponent && placementPlan?.object?.cells[0] && (
                    <div
                      className="placement-resolved"
                      aria-label="Resolved placement state"
                    >
                      {Object.entries(
                        placementPlan.object.cells[0].state.properties,
                      )
                        .filter(
                          ([property, value]) =>
                            value !== state.properties[property],
                        )
                        .map(([property, value]) => (
                          <div key={property}>
                            <span>{property}</span>
                            <strong>{value}</strong>
                          </div>
                        ))}
                    </div>
                  )}
                  <small className="editor-hint">
                    {placingComponent
                      ? "Bounds anchor · R rotates preview"
                      : placementMode === "context"
                        ? "Face / click height / view direction"
                        : "Explicit block state"}
                  </small>
                  {placementPlan?.notes.length ? (
                    <details className="quiet-details placement-notes">
                      <summary>Placement details</summary>
                      <ul>
                        {placementPlan.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {placementPlan && (
                    <SupportDetails issues={placementPlan.issues} />
                  )}
                </section>
              ) : active ? (
                <>
                  <section className="editor-section">
                    <div className="asset-type">
                      <Icon
                        name={
                          active.kind === "group"
                            ? "layers"
                            : active.kind === "component"
                              ? "blocks"
                              : "cube"
                        }
                        size={16}
                      />
                      <span>{active.kind}</span>
                      <span className="preview-badge">
                        {slot.selection.length} selected
                      </span>
                    </div>
                    <h2 className="editor-object-title">{active.name}</h2>
                    <div className="metric-row">
                      <span>Footprint</span>
                      <strong>{selectedBounds.size.join(" × ")} cells</strong>
                    </div>
                    <div className="metric-row">
                      <span>Occupied cells</span>
                      <strong>{selectedCells.length}</strong>
                    </div>
                  </section>
                  <NumericTransform
                    key={`${scope}:${slot.selection.join(",")}:${active.pivot2.join(",")}:${active.orientation}:${slot.history.past.length}:${slot.history.future.length}`}
                    object={active}
                    onMove={(delta, absolute) =>
                      session.move(scope, delta, absolute ? "global" : space)
                    }
                    onRotate={(degrees) =>
                      session.rotate(scope, degrees, pivotMode)
                    }
                    onPivot={(pivot) => {
                      session.setPivot(scope, active.id, pivot);
                      setPivotMode("active");
                    }}
                  />
                  <SelectionStateFields
                    common={commonState}
                    onChange={(property, value) =>
                      session.updateState(scope, property, value)
                    }
                  />
                  {!!selectionCapabilities.length && <CapabilityDetails decisions={selectionCapabilities} />}
                  <section className="editor-section">
                    <button
                      className="button wide"
                      onClick={() => void session.saveComponent(scope)}
                    >
                      Save selection as component
                    </button>
                    {selectedObjects.length > 0 && selectedObjects.every((object) => object.kind === "component") && (
                      <button type="button" className="button wide"
                        aria-label="Make component copies editable" disabled={!loaded}
                        title="Convert selected copies to editable objects. Library sources and other copies stay unchanged. Ungroup converted groups to edit their members."
                        onClick={() => {
                          changeTool("select");
                          session.makeEditable(scope);
                        }}>Make editable</button>
                    )}
                    <button
                      className="button wide danger-button"
                      onClick={() => session.remove(scope)}
                    >
                      <Icon name="trash" size={13} />
                      Delete selection
                    </button>
                  </section>
                </>
              ) : (
                <div className="selection-empty">
                  <Icon name="select" size={24} />
                  <span>
                    {slot.entitySelection.length
                      ? `${slot.entitySelection.length} entities selected`
                      : "Select an object in the viewport"}
                  </span>
                  <small>
                    {slot.entitySelection.length ? "G move · R yaw · Shift click toggles entities" : "Drag selects a region · Shift toggles · Ctrl A selects all"}
                  </small>
                </div>
              )}
              <SupportDetails issues={supportIssues} />
              {selectedObjects.length === 1 && selectedCells.length === 1 &&
                selectionCapabilities.some((decision) => decision.action === "payload-edit" && decision.supported) && (
                <ChestInventory key={`${slot.epoch}:${slot.revision}:${selectedObjects[0].id}`}
                  cell={selectedCells[0]} disabled={!loaded}
                  onApply={(items) => session.updateChest(scope, selectedObjects[0].id, selectedCells[0].pos, items)} />
              )}
              {!readOnly && (
                <EntityPanel
                  key={`${scope}:${slot.epoch}`}
                  entities={document.entities}
                  selection={slot.entitySelection}
                  selectableIds={selectableEntities}
                  previewing={!!stagedEntity}
                  error={session.error}
                  disabled={!loaded}
                  view={viewState}
                  onViewChange={changeView}
                  onPlace={beginEntityPlacement}
                  onSelect={(id, toggle) => {
                    changeTool("select", false);
                    session.selectEntity(scope, id, toggle);
                  }}
                  onPreview={(intent) => {
                    changeTool("select", false);
                    session.previewEntity(scope, intent);
                  }}
                  onConfirm={() => {
                    if (session.commitEntity(scope) && entityPlacement) { setEntityPlacement(null); setTool("select"); }
                  }}
                  onCancel={() => { session.cancelPreview(); if (entityPlacement) { setEntityPlacement(null); setTool("select"); } }}
                />
              )}
              <section className="editor-section outliner-section">
                <div className="section-title">
                  <h2>Objects</h2>
                  <span>{document.objects.length}</span>
                </div>
                <ObjectOutliner
                  viewState={viewState}
                  onView={changeView}
                  objects={document.objects}
                  selected={selectionSet}
                  onSelect={(id, toggle) => {
                    changeTool("select");
                    session.select(scope, [id], toggle);
                  }}
                />
                {scope === "component" && (
                  <button
                    className="button primary wide"
                    disabled={!document.objects.length}
                    onClick={() =>
                      void session.saveComponent("component", false)
                    }
                  >
                    <Icon name="save" size={14} />
                    Save to component library
                  </button>
                )}
              </section>
            </div>
          </aside>
        )}
      </div>
      {session.error && (
        <div className="editor-feedback" role="alert">
          <Icon name="warning" size={15} />
          <span>{session.error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss editor message"
            onClick={() => session.setError("")}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {documentsOpen && (
        <Suspense
          fallback={
            <div className="export-opening" role="status">
              Opening documents…
            </div>
          }
        >
          <DocumentManager
            components={session.components}
            resources={resources}
            onRestoreBackup={session.restorePortable}
            onRecordResources={(current, manifest) => session.recordResources(scope, current, manifest)}
            key={scope}
            document={document}
            saved={slot.saved}
            pristine={slot.pristine}
            error={session.error}
            onList={session.refreshDocuments}
            onOpen={(document) => session.open(scope, document)}
            onRename={session.renameSaved}
            onDelete={session.deleteDocument}
            onDiscard={(current) => session.discardChanges(scope, current)}
            onRecoveryList={session.refreshRecoveries}
            onRestore={session.restoreRecovery}
            onDiscardRecovery={session.discardRecovery}
            onRecoveryDocument={session.recoveryDocument}
            recoveryCount={session.recoveryCount[scope]}
            initialRecovery={recoveryOpen}
            onClose={() => {
              setDocumentsOpen(false);
              setRecoveryOpen(false);
            }}
          />
        </Suspense>
      )}
      {structureImportOpen && (
        <Suspense fallback={<div role="status">Opening import…</div>}>
          <ImportStructureDialog
            document={document}
            catalog={resources.catalog}
            onImport={session.importStructure}
            onClose={() => setStructureImportOpen(false)}
            error={session.error}
          />
        </Suspense>
      )}
      {exportSnapshot && (
        <Suspense
          fallback={
            <div className="export-opening" role="status">
              Opening export…
            </div>
          }
        >
          <ExportDialog
            document={exportSnapshot.document}
            catalog={exportSnapshot.catalog}
            onClose={() => setExportSnapshot(null)}
          />
        </Suspense>
      )}
      <output
        hidden
        className="material-action-diagnostics"
        data-valid={!!materialPlan}
        data-snapshot={
          materialPlan
            ? JSON.stringify({
                cells: materialPlan.cells.slice(0, 64),
                matchedCells: materialPlan.matchedCells,
                matchedObjects: materialPlan.matchedObjects,
                notes: materialPlan.notes,
              })
            : ""
        }
      />
      <output hidden className="mirror-action-diagnostics" data-valid={!!mirrorPlan}
        data-snapshot={mirrorPlan ? JSON.stringify({
          cells: mirrorPlan.cells.slice(0, 64), selection: mirrorPlan.selection,
          intent: mirrorPlan.intent, notes: mirrorPlan.notes,
        }) : ""} />
      <output hidden className="wall-action-diagnostics" data-valid={!!wallPlan}
        data-snapshot={wallPlan ? JSON.stringify({
          cells: wallPlan.cells.slice(0, 64), selection: wallPlan.selection,
          addedCells: wallPlan.cost.addedCells, notes: wallPlan.notes,
        }) : ""} />
      <output
        hidden
        className="primitive-action-diagnostics"
        data-valid={!!primitivePlan}
        data-snapshot={
          primitivePlan
            ? JSON.stringify({
                kind: primitivePlan.kind,
                cells: primitivePlan.cells.slice(0, 64),
                anchors: primitivePlan.anchors,
                selection: primitivePlan.selection,
                notes: primitivePlan.notes,
              })
            : ""
        }
      />
      <output
        hidden
        className="copy-action-diagnostics"
        data-valid={!!copyPlan}
        data-snapshot={
          copyPlan
            ? JSON.stringify({
                cells: copyPlan.cells.slice(0, 64),
                selection: copyPlan.selection,
                notes: copyPlan.notes,
              })
            : ""
        }
      />
      <output
        hidden
        className="editor-view-diagnostics"
        data-y-range={JSON.stringify(viewState.yRange ?? null)}
        data-visible={visibleBlocks.length}
        data-hidden={JSON.stringify(viewState.hidden)}
        data-locked={JSON.stringify(viewState.locked)}
        data-isolated={JSON.stringify(viewState.isolated)}
      />
      <output
        hidden
        className="editor-diagnostics"
        data-workspace={workspace}
        data-document={document.id}
        data-objects={document.objects.length}
        data-blocks={blocks.length}
        data-selection={JSON.stringify(slot.selection)}
        data-entity-selection={JSON.stringify(slot.entitySelection)}
        data-entities={JSON.stringify(document.entities)}
        data-entity-preview={
          stagedEntity ? JSON.stringify(stagedEntity.document.entities) : ""
        }
        data-visible-entities={JSON.stringify(visibleEntities.map((entity) => entity.id))}
        data-entity-placement={entityPlacement ?? ""}
        data-snapshot={diagnosticSnapshot}
        data-revision={slot.revision}
        data-saved-revision={slot.savedRevision ?? ""}
        data-history={slot.history.past.length}
        data-future={slot.history.future.length}
        data-fallback={diagnostics.fallbackBlocks}
      />
    </div>
  );
}
