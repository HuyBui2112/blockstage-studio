import { describe, expect, it } from "vitest";
import { newEditorDocument, type EditorObject } from "./model";
import {
  assertViewEdit,
  inYRange,
  setViewYRange,
  createRootViewResolver,
  editableRootIds,
  emptyEditorViewState,
  isolateRoots,
  pruneEditorViewState,
  resetEditorViewState,
  rootViewPolicy,
  toggleRootHidden,
  toggleRootLocked,
  visibleSceneBlocks,
} from "./view-state";

const block = (id: string, x = 0): EditorObject => ({
  id,
  name: id,
  kind: "block",
  cells: [
    { pos: [x, 0, 0], state: { name: "minecraft:stone", properties: {} } },
  ],
  children: [],
  pivot2: [x * 2 + 1, 1, 1],
  orientation: 0,
});
const document = () => ({
  ...newEditorDocument(),
  objects: [block("a"), block("b", 1)],
});
describe("transient root view policy", () => {
  it("derives the complete hidden/locked/isolation truth matrix", () => {
    for (const hidden of [false, true])
      for (const locked of [false, true])
        for (const isolated of [null, ["a"], ["b"]]) {
          const drawn =
            !hidden && (isolated === null || isolated.includes("a"));
          expect(
            rootViewPolicy("a", {
              hidden: hidden ? ["a"] : [],
              locked: locked ? ["a"] : [],
              isolated,
            }),
          ).toEqual({
            drawn,
            selectable: drawn && !locked,
            editable: drawn && !locked,
          });
        }
  });
  it("toggles whole batches, preserves independent flags and rejects empty isolation", () => {
    const empty = emptyEditorViewState(),
      hidden = toggleRootHidden(empty, ["a", "b", "a"]);
    expect(hidden.hidden).toEqual(["a", "b"]);
    const locked = toggleRootLocked(hidden, ["a"]);
    expect(toggleRootHidden(locked, ["a", "b"])).toEqual({
      hidden: [],
      locked: ["a"],
      isolated: null,
    });
    expect(isolateRoots(locked, ["a", "a"]).isolated).toEqual(["a"]);
    expect(() => isolateRoots(empty, [])).toThrow(/at least one/);
    expect(toggleRootHidden(empty, [])).toBe(empty);
    expect(toggleRootLocked(empty, [])).toBe(empty);
    expect(resetEditorViewState(empty)).toBe(empty);
    expect(resetEditorViewState(locked)).toEqual(empty);
  });
  it("prunes stale and child IDs and clears a vanished isolation", () => {
    const doc = document();
    const stable = { hidden: ["a"], locked: ["b"], isolated: ["a"] };
    expect(pruneEditorViewState(doc, stable)).toBe(stable);
    expect(createRootViewResolver(stable)("a")).toEqual(
      rootViewPolicy("a", stable),
    );
    expect(
      pruneEditorViewState(doc, {
        hidden: ["a", "missing", "a"],
        locked: ["b", "child"],
        isolated: ["missing"],
      }),
    ).toEqual({ hidden: ["a"], locked: ["b"], isolated: null });
    expect(
      pruneEditorViewState(doc, {
        hidden: [],
        locked: [],
        isolated: ["missing", "a"],
      }).isolated,
    ).toEqual(["a"]);
  });
  it("keeps whole grouped logical pairs and exposes locked geometry without picking it", () => {
    const pair: EditorObject = {
      ...block("pair"),
      kind: "multiblock",
      cells: [block("one").cells[0], block("two", 1).cells[0]],
    };
    const group: EditorObject = {
      ...block("group"),
      kind: "group",
      cells: [],
      children: [pair],
    };
    const doc = {
      ...newEditorDocument(),
      objects: [group, block("behind", 2)],
    };
    const view = { hidden: [], locked: ["group"], isolated: null };
    expect(visibleSceneBlocks(doc, view).map((cell) => cell.owner)).toEqual([
      "group",
      "group",
      "behind",
    ]);
    expect(editableRootIds(doc, view)).toEqual(["behind"]);
    expect(
      visibleSceneBlocks(doc, { ...view, hidden: ["group"] }).map(
        (cell) => cell.owner,
      ),
    ).toEqual(["behind"]);
  });
  it("guards every protected root including indirect neighbor updates and removals", () => {
    for (const view of [
      { hidden: ["b"], locked: [], isolated: null },
      { hidden: [], locked: ["b"], isolated: null },
      { hidden: [], locked: [], isolated: ["a"] },
    ]) {
      const before = document(),
        candidate = structuredClone(before);
      candidate.objects[1].cells[0].state.properties = { north: "true" };
      expect(() => assertViewEdit(before, candidate, view)).toThrow(
        /Protected object/,
      );
      expect(() =>
        assertViewEdit(
          before,
          { ...before, objects: [before.objects[0]] },
          view,
        ),
      ).toThrow(/Protected object/);
      expect(() =>
        assertViewEdit(before, structuredClone(before), view),
      ).not.toThrow();
      const addition = {
        ...before,
        objects: [...before.objects, block("new", 3)],
      };
      expect(() => assertViewEdit(before, addition, view)).not.toThrow();
    }
  });
  it("leaves documents, history inputs and source state unchanged", () => {
    const doc = document(),
      before = structuredClone(doc),
      view = emptyEditorViewState();
    const isolated = isolateRoots(
      toggleRootLocked(toggleRootHidden(view, ["a"]), ["b"]),
      ["b"],
    );
    visibleSceneBlocks(doc, isolated);
    editableRootIds(doc, isolated);
    assertViewEdit(doc, doc, isolated);
    expect(doc).toEqual(before);
    expect(view).toEqual(emptyEditorViewState());
    const editableChange = structuredClone(doc);
    editableChange.objects[0].name = "Renamed";
    expect(() => assertViewEdit(doc, editableChange, view)).not.toThrow();
  });
});

const atY = (id: string, y: number): EditorObject => {
  const object = block(id);
  object.cells[0].pos[1] = y;
  return object;
};
describe("finite transient Y range", () => {
  it("validates inclusive integer bounds and preserves the range across pruning", () => {
    const empty = emptyEditorViewState(),
      view = setViewYRange(empty, { min: -2, max: -2 });
    expect(inYRange(-2, view)).toBe(true);
    expect(inYRange(-1, view)).toBe(false);
    expect(
      inYRange(-2048, setViewYRange(empty, { min: -2048, max: 2048 })),
    ).toBe(true);
    for (const range of [
      { min: 2, max: 1 },
      { min: -2049, max: 0 },
      { min: 0, max: 2049 },
      { min: 0.5, max: 1 },
      { min: NaN, max: 1 },
    ]) {
      expect(() => setViewYRange(empty, range)).toThrow(/Y range/);
      const invalid = { ...empty, yRange: range };
      expect(() => pruneEditorViewState(document(), invalid)).toThrow(
        /Y range/,
      );
      expect(() => assertViewEdit(document(), document(), invalid)).toThrow(
        /Y range/,
      );
    }
    expect(pruneEditorViewState(newEditorDocument(), view).yRange).toEqual({
      min: -2,
      max: -2,
    });
    expect(resetEditorViewState(view)).toEqual(empty);
    expect(setViewYRange(view, null).yRange).toBeNull();
  });
  it("draws only in-range cells and protects partial groups and logical pairs", () => {
    const pair: EditorObject = {
      ...atY("door", -1),
      kind: "multiblock",
      cells: [atY("lower", -1).cells[0], atY("upper", 0).cells[0]],
    };
    const group: EditorObject = {
      ...block("group"),
      kind: "group",
      cells: [],
      children: [pair],
    };
    const doc = {
      ...newEditorDocument(),
      objects: [group, atY("below", -2), atY("inside", -1)],
    };
    const view = setViewYRange(emptyEditorViewState(), { min: -1, max: -1 });
    expect(visibleSceneBlocks(doc, view).map((cell) => cell.owner)).toEqual([
      "group",
      "inside",
    ]);
    expect(editableRootIds(doc, view)).toEqual(["inside"]);
    expect(createRootViewResolver(view, doc.objects)("group")).toEqual({
      drawn: true,
      editable: false,
      selectable: false,
    });
    expect(createRootViewResolver(view)("inside").editable).toBe(false);
    expect(
      editableRootIds(doc, setViewYRange(view, { min: -1, max: 0 })),
    ).toEqual(["group", "inside"]);
    const gap = { ...group, children: [atY("low", -2), atY("high", 0)] };
    expect(createRootViewResolver(view, [gap])("group").drawn).toBe(false);
    expect(() =>
      assertViewEdit(doc, { ...doc, objects: doc.objects.slice(1) }, view),
    ).toThrow(/Protected/);
  });
  it("rejects changed or new footprints outside the range but permits unchanged protected sources", () => {
    const before = {
      ...newEditorDocument(),
      objects: [atY("inside", 0), atY("source", 2)],
    };
    const view = setViewYRange(emptyEditorViewState(), { min: 0, max: 0 });
    expect(() =>
      assertViewEdit(before, structuredClone(before), view),
    ).not.toThrow();
    const moved = structuredClone(before);
    moved.objects[0].cells[0].pos[1] = 1;
    expect(() => assertViewEdit(before, moved, view)).toThrow(/Y range/);
    expect(() =>
      assertViewEdit(
        before,
        { ...before, objects: [...before.objects, atY("new", -1)] },
        view,
      ),
    ).toThrow(/Y range/);
    const pair: EditorObject = {
      ...atY("pair", 0),
      kind: "multiblock",
      cells: [atY("lower", 0).cells[0], atY("upper", 1).cells[0]],
    };
    expect(() =>
      assertViewEdit(
        before,
        { ...before, objects: [...before.objects, pair] },
        view,
      ),
    ).toThrow(/Y range/);
    expect(() =>
      assertViewEdit(
        before,
        { ...before, objects: [...before.objects, atY("new", 0)] },
        view,
      ),
    ).not.toThrow();
  });
});
