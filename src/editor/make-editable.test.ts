import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS, defaultState } from "../core/catalog";
import { executeHistory, undoHistory, redoHistory } from "./history";
import { newEditorDocument, sceneBlocks, type EditorObject } from "./model";
import { makeComponentsEditable, ungroupObjects, updateObjectState } from "./operations";
import { createPlacedObject } from "./placement";
import { assertViewEdit, emptyEditorViewState } from "./view-state";

const catalog = DEMO_MATERIALS;
function fixture() {
  const child = createPlacedObject(defaultState("minecraft:oak_log", catalog), [2, 1, -3], catalog, undefined, "child");
  const copy: EditorObject = { id: "copy", name: "Beam copy", kind: "component", componentId: "asset",
    cells: [], children: [child], pivot2: [5, 3, -5], orientation: 1 };
  const other = createPlacedObject(defaultState("minecraft:stone", catalog), [10, 0, 0], catalog, undefined, "other");
  return { ...newEditorDocument(), objects: [copy, other] };
}
describe("explicit editable component copies", () => {
  it("keeps geometry, children, IDs and other roots; Undo restores provenance", () => {
    const source = fixture(), before = structuredClone(source);
    const next = makeComponentsEditable(source, ["copy"], catalog);
    expect(next.objects[0]).toEqual({ ...before.objects[0], kind: "group", componentId: undefined });
    expect(Object.hasOwn(next.objects[0], "componentId")).toBe(false);
    expect(next.objects[0].children).toBe(source.objects[0].children);
    expect(next.objects[1]).toBe(source.objects[1]);
    expect(sceneBlocks(next)).toEqual(sceneBlocks(source));
    const history = executeHistory({ document: source, past: [], future: [] }, next, "Make editable");
    expect(history.past).toHaveLength(1);
    expect(undoHistory(history).document).toEqual(source);
    expect(redoHistory(undoHistory(history)).document).toEqual(next);
    const ungrouped = ungroupObjects(next, ["copy"], catalog);
    const edited = updateObjectState(ungrouped, "child", "axis", "x", catalog);
    expect(edited.objects[0].cells[0].state.properties.axis).toBe("x");
    expect(source).toEqual(before);
  });
  it("handles cell-backed copies without inventing a child ID or splitting pairs", () => {
    const source = fixture(), cell = source.objects[1];
    source.objects = [{ ...cell, kind: "component", componentId: "asset" }];
    const next = makeComponentsEditable(source, [cell.id], catalog);
    expect(next.objects[0].kind).toBe("block");
    expect(next.objects[0].id).toBe(cell.id);
    expect(next.objects[0].cells).toBe(cell.cells);
  });
  it("rejects mixed, stale and duplicate selections atomically and respects final view guards", () => {
    const source = fixture();
    for (const ids of [[], ["missing"], ["copy", "copy"], ["copy", "other"]])
      expect(() => makeComponentsEditable(source, ids, catalog)).toThrow();
    const next = makeComponentsEditable(source, ["copy"], catalog);
    for (const view of [
      { ...emptyEditorViewState(), locked: ["copy"] },
      { ...emptyEditorViewState(), hidden: ["copy"] },
      { ...emptyEditorViewState(), isolated: ["other"] },
    ]) expect(() => assertViewEdit(source, next, view)).toThrow();
  });
});
