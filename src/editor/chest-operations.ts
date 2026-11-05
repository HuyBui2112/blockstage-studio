import type { Material } from "../core/catalog";
import { blockEntitySchema, type Block } from "../core/schema";
import { validateDocument, type EditorDocument, type EditorObject } from "./model";

/** Changes one cell payload; positions and orientation are never embedded in it. */
export function setChestInventory(
  document: EditorDocument,
  rootId: string,
  position: readonly number[],
  items: NonNullable<Block["blockEntity"]>["items"],
  catalog: Material[],
): EditorDocument {
  validateDocument(document, catalog);
  const payload = blockEntitySchema.parse({ kind: "chest", items });
  const root = document.objects.find((object) => object.id === rootId);
  if (!root) throw new Error("Selected chest owner no longer exists");
  let found = false;
  function update(object: EditorObject): EditorObject {
    const cells = object.cells.map((cell) => {
      if (!cell.pos.every((value, axis) => value === position[axis])) return cell;
      if (cell.state.name !== "minecraft:chest" || cell.state.properties.type !== "single")
        throw new Error("Inventory editing requires one single chest");
      found = true;
      if (JSON.stringify(cell.blockEntity) === JSON.stringify(payload)) return cell;
      return { ...cell, blockEntity: payload };
    });
    const children = object.children.map(update);
    return cells.some((cell, index) => cell !== object.cells[index]) ||
      children.some((child, index) => child !== object.children[index])
      ? { ...object, cells, children } : object;
  }
  const nextRoot = update(root);
  if (!found) throw new Error("Selected chest cell no longer exists");
  if (nextRoot === root) return document;
  const next = { ...document, objects: document.objects.map((object) => object === root ? nextRoot : object) };
  validateDocument(next, catalog);
  return next;
}
