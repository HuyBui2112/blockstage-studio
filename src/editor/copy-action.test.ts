import { describe, expect, it } from "vitest";
import { DEMO_MATERIALS, defaultState, type Material } from "../core/catalog";
import type { NeighborRule, NeighborRules } from "../core/profile";
import type { Vec3 } from "../core/schema";
import { createClipboard } from "./clipboard";
import {
  applyCopyAction,
  planCopyAction,
  type CopyActionIntent,
} from "./copy-action";
import { executeHistory, redoHistory, undoHistory } from "./history";
import { newEditorDocument, sceneBlocks } from "./model";
import { createPlacedObject } from "./placement";

const properties = {
  north: ["false", "true"],
  east: ["false", "true"],
  south: ["false", "true"],
  west: ["false", "true"],
};
const fence: Material = {
  id: "minecraft:oak_fence",
  label: "Fence",
  family: "fence",
  color: "#aaa",
  properties,
  defaults: { north: "false", east: "false", south: "false", west: "false" },
};
const catalog = [
  ...DEMO_MATERIALS.filter((material) => material.id !== fence.id),
  fence,
];
const rule = (kind: NeighborRule["kind"] = "other"): NeighborRule => ({
  kind,
  fence: kind === "fence",
  wooden: kind === "fence",
  wall: false,
  forcePost: false,
  exception: false,
  properties: [],
  shapes: { "": [0, 0] },
});
const rules: NeighborRules = {
  "minecraft:air": rule(),
  "minecraft:oak_fence": rule("fence"),
};
function source() {
  const object = {
    ...createPlacedObject(defaultState(fence.id, catalog), [0, 0, 0], catalog),
    id: "original",
  };
  return { ...newEditorDocument(), id: "document", objects: [object] };
}
const base = { documentId: "document", sessionEpoch: "epoch", revision: 3 };
const options = { base, operationId: "copy" };
const duplicate: CopyActionIntent = { kind: "duplicate", delta: [1, 0, 0] };

describe("copy action composition", () => {
  it("rejects invalid derived states before publishing a valid preview", () => {
    const document = source(),
      before = structuredClone(document);
    const restricted = catalog.map((material) =>
      material.id === fence.id
        ? {
            ...material,
            properties: { ...material.properties, east: ["false"] },
          }
        : material,
    );
    expect(() =>
      planCopyAction(
        document,
        ["original"],
        duplicate,
        null,
        restricted,
        options,
        rules,
      ),
    ).toThrow();
    expect(
      planCopyAction(
        document,
        ["original"],
        duplicate,
        null,
        restricted,
        options,
      ).cells,
    ).toHaveLength(1);
    expect(document).toEqual(before);
  });
  it("previews final states on copied and existing fences, commits the exact candidate and undoes both in one step", () => {
    const document = source(),
      snapshot = structuredClone(document);
    const plan = planCopyAction(
      document,
      ["original"],
      duplicate,
      null,
      catalog,
      options,
      rules,
    );
    expect(plan.cells).toHaveLength(2);
    expect(
      plan.cells.find((cell) => cell.owner === "original")?.state.properties
        .east,
    ).toBe("true");
    expect(
      plan.cells.find((cell) => cell.owner === plan.selection[0])?.state
        .properties.west,
    ).toBe("true");
    expect(plan.cells).toEqual(sceneBlocks(plan.document));
    expect(plan.patches.map((patch) => patch.id)).toEqual([
      "original",
      "copy:0",
    ]);
    expect(plan.patches[0].before?.object).toEqual(document.objects[0]);
    expect(applyCopyAction(plan, document, base, catalog, rules)).toBe(
      plan.document,
    );
    expect(document).toEqual(snapshot);
    const history = executeHistory(
      { document, past: [], future: [] },
      plan.document,
      "Duplicate",
    );
    expect(history.past).toHaveLength(1);
    expect(undoHistory(history).document).toEqual(document);
    expect(redoHistory(undoHistory(history)).document).toEqual(plan.document);
  });

  it("dispatches duplicate, paste and signed world repeat with stable preview IDs", () => {
    const document = source(),
      clipboard = createClipboard(document, ["original"], catalog);
    const intents: CopyActionIntent[] = [
      duplicate,
      { kind: "paste", position: [3, 0, 0] },
      { kind: "repeat", axis: "z", count: 2, spacing: -2 },
    ];
    const expected: Vec3[][] = [
      [[1, 0, 0]],
      [[3, 0, 0]],
      [
        [0, 0, -2],
        [0, 0, -4],
      ],
    ];
    for (const [index, intent] of intents.entries()) {
      const plan = planCopyAction(
        document,
        ["original"],
        intent,
        clipboard,
        catalog,
        options,
      );
      expect(plan.kind).toBe(intent.kind);
      expect(plan.cells.map((cell) => cell.pos)).toEqual(expected[index]);
      expect(plan.addedObjectIds).toEqual(
        planCopyAction(
          document,
          ["original"],
          intent,
          clipboard,
          catalog,
          options,
        ).addedObjectIds,
      );
      expect(applyCopyAction(plan, document, base, catalog)).toBe(
        plan.document,
      );
    }
    expect(() =>
      planCopyAction(document, [], intents[1], null, catalog, options),
    ).toThrow(/clipboard is empty/);
  });

  it("rejects changed or disabled policy instead of silently recomputing", () => {
    const document = source();
    const plan = planCopyAction(
      document,
      ["original"],
      duplicate,
      null,
      catalog,
      options,
      rules,
    );
    expect(() => applyCopyAction(plan, document, base, catalog)).toThrow(
      /Auto connections changed/,
    );
    expect(() =>
      applyCopyAction(plan, document, base, catalog, { ...rules }),
    ).toThrow(/Auto connections changed/);
    const explicit = planCopyAction(
      document,
      ["original"],
      duplicate,
      null,
      catalog,
      options,
    );
    expect(explicit.cells).toHaveLength(1);
    expect(explicit.cells[0].state.properties.west).toBe("false");
    expect(() =>
      applyCopyAction(explicit, document, base, catalog, rules),
    ).toThrow(/Auto connections changed/);
  });

  it("rejects collision, stale revisions, identity changes and cancellation without mutation", () => {
    const document = source(),
      snapshot = structuredClone(document);
    expect(() =>
      planCopyAction(
        document,
        ["original"],
        { kind: "duplicate", delta: [0, 0, 0] },
        null,
        catalog,
        options,
        rules,
      ),
    ).toThrow();
    const controller = new AbortController();
    const plan = planCopyAction(
      document,
      ["original"],
      duplicate,
      null,
      catalog,
      { ...options, signal: controller.signal },
      rules,
    );
    expect(() =>
      applyCopyAction(plan, document, { ...base, revision: 4 }, catalog, rules),
    ).toThrow(/document changed/);
    expect(() =>
      applyCopyAction(plan, { ...document }, base, catalog, rules),
    ).toThrow(/document changed/);
    controller.abort();
    expect(() => applyCopyAction(plan, document, base, catalog, rules)).toThrow(
      /cancelled/,
    );
    expect(() =>
      planCopyAction(
        document,
        ["original"],
        duplicate,
        null,
        catalog,
        { ...options, signal: controller.signal },
        rules,
      ),
    ).toThrow(/cancelled/);
    expect(document).toEqual(snapshot);
  });
});
