import { describe, expect, it } from "vitest";
import type { ComponentAsset } from "./model";
import { duplicateComponentAsset, renameComponentAsset } from "./component-library-operations";

const asset: ComponentAsset = {
  schemaVersion: 1, id: "library", name: "Door", pivot2: [1, 0, 1], size: [1, 2, 1], orientation: 1,
  objects: [{
    id: "group", name: "Group", kind: "group", cells: [], pivot2: [1, 0, 1], orientation: 1,
    children: [{
      id: "pair", name: "Door pair", kind: "component", componentId: "source-provenance",
      pivot2: [1, 0, 1], orientation: 1, children: [],
      cells: [0, 1].map((y) => ({
        pos: [0, y, 0], state: { name: "minecraft:oak_door", properties: { half: y ? "upper" : "lower", future: "preserved" } },
      })),
    }],
  }],
};

describe("component library operations", () => {
  it("renames only library metadata and rejects invalid names", () => {
    expect(renameComponentAsset(asset, "  Entrance  ")).toEqual({ ...asset, name: "Entrance" });
    expect(asset.name).toBe("Door");
    expect(() => renameComponentAsset(asset, "  ")).toThrow();
    expect(() => renameComponentAsset(asset, "a".repeat(121))).toThrow();
  });

  it("copies nested identities independently while preserving pair cells and provenance", () => {
    const ids = ["library", "pair", "other-library", "new-library", "group", "new-group", "source-provenance", "new-pair"];
    const copy = duplicateComponentAsset(asset, [{ ...asset, id: "other-library" }], () => ids.shift()!);
    expect(copy.id).toBe("new-library");
    expect(copy.name).toBe("Door copy");
    expect(copy.objects[0].id).toBe("new-group");
    expect(copy.objects[0].children[0]).toEqual({ ...asset.objects[0].children[0], id: "new-pair" });
    copy.objects[0].children[0].cells[0].state.properties.half = "changed";
    copy.pivot2[0] = 99;
    expect(asset.objects[0].children[0].cells[0].state.properties.half).toBe("lower");
    expect(asset.pivot2[0]).toBe(1);
  });

  it("bounds repeated ID collisions and keeps long copy names valid", () => {
    expect(() => duplicateComponentAsset(asset, [], () => "library")).toThrow("fresh component ID");
    let id = 0;
    expect(duplicateComponentAsset({ ...asset, name: "a".repeat(120) }, [], () => `new-${id++}`).name).toHaveLength(120);
  });
});
