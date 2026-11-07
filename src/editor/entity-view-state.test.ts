import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS } from "../core/catalog";
import type { SceneEntity } from "../core/schema";
import { newEditorDocument } from "./model";
import { applyEntityAction, editableEntityIds, planEntityAction } from "./entity-action";
import { rotateEntities } from "./entity-operations";
import {
  assertViewEdit, createEntityViewResolver, createRootViewResolver, emptyEditorViewState,
  isolateEntities, isolateRoots, pruneEditorViewState, resetEditorViewState,
  toggleEntityHidden, toggleEntityLocked, type EditorViewState,
} from "./view-state";

const pig = (id: string, y = .5, yaw = 15): SceneEntity => ({ id, type: "minecraft:pig", position: [.25, y, -.75], yaw });
function fixture() {
  return {
    ...newEditorDocument(), id: "doc",
    entities: [pig("shared"), pig("second", 1, 270)],
    objects: [{ id: "shared", name: "Stone", kind: "block" as const,
      cells: [{ pos: [0, 0, 0] as [number, number, number], state: { name: "minecraft:stone", properties: {} } }],
      children: [], pivot2: [1, 1, 1] as [number, number, number], orientation: 0 as const }],
  };
}
const base = { documentId: "doc", sessionEpoch: "epoch", revision: 1 };

describe("entity view policy", () => {
  it("keeps identity namespaces separate and lock drawn while prohibiting selection", () => {
    const view = { ...emptyEditorViewState(), hidden: ["shared"], locked: ["shared"] };
    expect(createEntityViewResolver(view)(pig("shared"))).toEqual({ drawn: true, selectable: true, editable: true });
    const locked = toggleEntityLocked(view, ["shared"]);
    expect(createEntityViewResolver(locked)(pig("shared"))).toEqual({ drawn: true, selectable: false, editable: false });
    expect(createEntityViewResolver(toggleEntityHidden(locked, ["shared"]))(pig("shared")).drawn).toBe(false);
    expect(createRootViewResolver({ ...locked, hidden: [], locked: [] })("shared").editable).toBe(true);
    expect(editableEntityIds(fixture(), locked)).toEqual(["second"]);
    expect(toggleEntityHidden(view, [])).toBe(view);
    expect(toggleEntityLocked(view, [])).toBe(view);
  });

  it("applies inclusive real-valued Y anchor filtering without claiming mesh clipping", () => {
    const view = { ...emptyEditorViewState(), yRange: { min: 0, max: 1 } };
    const policy = createEntityViewResolver(view);
    for (const y of [0, .25, 1]) expect(policy(pig("p", y)).editable).toBe(true);
    for (const y of [-.001, 1.001]) expect(policy(pig("p", y))).toEqual({ drawn: false, selectable: false, editable: false });
    expect(() => createEntityViewResolver({ ...view, yRange: { min: .5, max: 1 } })).toThrow(/integer bounds/);
  });

  it("isolation selects a namespace and mixed isolation explicitly supports both", () => {
    const view = emptyEditorViewState();
    const entityOnly = isolateEntities(view, ["shared", "shared"]);
    expect(entityOnly.entityIsolated).toEqual(["shared"]);
    expect(createRootViewResolver(entityOnly)("shared").drawn).toBe(false);
    expect(createEntityViewResolver(entityOnly)(pig("shared")).editable).toBe(true);
    expect(createEntityViewResolver(entityOnly)(pig("second")).drawn).toBe(false);
    const blockOnly = isolateRoots(entityOnly, ["shared"]);
    expect(createEntityViewResolver(blockOnly)(pig("shared")).drawn).toBe(false);
    const mixed = { ...entityOnly, isolated: ["shared"] };
    expect(createRootViewResolver(mixed)("shared").drawn).toBe(true);
    expect(createEntityViewResolver(mixed)(pig("shared")).drawn).toBe(true);
    expect(() => isolateEntities(view, [])).toThrow(/at least one/);
    expect(() => assertViewEdit(fixture(), { ...fixture(), objects: [] }, entityOnly)).toThrow(/Protected object/);
    const document = fixture();
    expect(() => assertViewEdit(document, { ...document, objects: [...document.objects, { ...document.objects[0], id: "new" }] }, entityOnly)).toThrow(/Block creation/);
  });

  it("prunes stale IDs per namespace, clears vanished isolation and resets every flag", () => {
    const document = fixture();
    const view: EditorViewState = { hidden: ["shared"], locked: [], isolated: null,
      entityHidden: ["shared", "shared", "missing"], entityLocked: ["second", "missing"], entityIsolated: ["missing"] };
    const pruned = pruneEditorViewState(document, view);
    expect(pruned).toEqual({ ...view, entityHidden: ["shared"], entityLocked: ["second"], entityIsolated: null });
    expect(pruneEditorViewState(document, pruned)).toBe(pruned);
    expect(resetEditorViewState(pruned)).toEqual(emptyEditorViewState());
    expect(resetEditorViewState(isolateEntities(emptyEditorViewState(), ["shared"]))).toEqual(emptyEditorViewState());
  });

  it("guards hidden, locked and outside-isolate sources, including deleted or indirect changes", () => {
    const document = fixture();
    for (const view of [
      toggleEntityHidden(emptyEditorViewState(), ["shared"]),
      toggleEntityLocked(emptyEditorViewState(), ["shared"]),
      isolateEntities(emptyEditorViewState(), ["second"]),
    ]) {
      expect(() => planEntityAction(document, ["shared"], { kind: "remove" }, DEMO_MATERIALS, { base, view })).toThrow(/Protected entity/);
      expect(() => planEntityAction(document, ["shared"], { kind: "move", delta: [0, 0, 0] }, DEMO_MATERIALS, { base, view })).toThrow(/Protected entity/);
      const plan = planEntityAction(document, ["second"], { kind: "yaw", yaw: 20 }, DEMO_MATERIALS, { base, view });
      const tampered = { ...plan, document: { ...plan.document, entities: plan.document.entities.filter((entity) => entity.id !== "shared") } };
      expect(() => applyEntityAction(tampered, document, base, DEMO_MATERIALS, view)).toThrow(/Protected entity/);
    }
  });

  it("allows new valid anchors during entity isolation without bypassing locks and Y limits", () => {
    const document = fixture();
    const view = { ...isolateEntities(emptyEditorViewState(), ["shared"]), yRange: { min: 0, max: 1 } };
    const plan = planEntityAction(document, [], { kind: "add", entity: pig("new", 1) }, DEMO_MATERIALS, { base, view });
    expect(applyEntityAction(plan, document, base, DEMO_MATERIALS, view)).toBe(plan.document);
    expect(() => planEntityAction(document, [], { kind: "add", entity: pig("new", 1.01) }, DEMO_MATERIALS, { base, view })).toThrow(/Y range/);
    expect(() => planEntityAction(document, [], { kind: "add", entity: pig("new", 1) }, DEMO_MATERIALS, {
      base, view: { ...view, entityLocked: ["new"] },
    })).toThrow(/Protected entity/);
    expect(() => applyEntityAction(plan, document, base, DEMO_MATERIALS, toggleEntityLocked(view, ["shared"]))).toThrow(/View policy changed/);
  });

  it("relative yaw preserves heading differences, positions and zero-turn identity", () => {
    const document = fixture(), before = structuredClone(document);
    const rotated = rotateEntities(document, ["shared", "second"], 135.5, DEMO_MATERIALS);
    expect(rotated.entities.map((entity) => entity.yaw)).toEqual([150.5, 45.5]);
    expect(rotated.entities.map((entity) => entity.position)).toEqual(document.entities.map((entity) => entity.position));
    expect(rotated.entities[0].position).toBe(document.entities[0].position);
    expect(document).toEqual(before);
    expect(rotateEntities(document, ["shared", "second"], -720, DEMO_MATERIALS)).toBe(document);
    expect(() => rotateEntities(document, ["shared"], Infinity, DEMO_MATERIALS)).toThrow(/finite/);
    const plan = planEntityAction(document, ["shared", "second"], { kind: "rotate", degrees: -45 }, DEMO_MATERIALS, { base, view: emptyEditorViewState() });
    expect(plan.document.entities.map((entity) => entity.yaw)).toEqual([330, 225]);
  });
});
