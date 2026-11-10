import { validateState, type Material } from "../core/catalog";
import type { GameProfile } from "../core/profile";
import { stateKey, type Block, type SceneBlock } from "../core/schema";
import type { ComponentAsset, EditorObject } from "../editor/model";
import { assessAppearance } from "./appearance-capability";
import type { ModelResolver } from "./models";

export type ComponentPreviewInspection = {
  blocks: SceneBlock[];
  issues: string[];
  totalIssues: number;
  checkedStates: number;
  complete: boolean;
  status: "ready" | "partial" | "unavailable" | "limited";
  storedCells: number;
  nonAirCells: number;
};
export const COMPONENT_PREVIEW_CELL_LIMIT = 10000;
const STATE_LIMIT = 256;
const air = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);

/** Resource availability for one requested preview, never placement/export or world proof.
 * The library validates assets before publishing them; retain finite traversal guards here.
 */
export function inspectComponentPreview(
  asset: ComponentAsset,
  catalog: Material[],
  profile: GameProfile | null,
  resolver: ModelResolver,
): ComponentPreviewInspection {
  const issues: string[] = [], issueKeys = new Set<string>();
  function issue(message: string) {
    if (issueKeys.has(message)) return;
    issueKeys.add(message);
    if (issues.length < 20) issues.push(message);
  }
  if (asset.objects.length > 100000) throw new Error("Component preview exceeds object limits");
  const frames: { iterator: Iterator<EditorObject>; depth: number }[] = [
    { iterator: asset.objects.values(), depth: 1 },
  ];
  const seen = new Set<EditorObject>(), cells: Block[] = [];
  let storedCells = 0, nonAirCells = 0;
  while (frames.length) {
    const frame = frames[frames.length - 1], next = frame.iterator.next();
    if (next.done) { frames.pop(); continue; }
    const object = next.value;
    if (seen.has(object) || frame.depth > 16 || seen.size >= 100000)
      throw new Error("Component preview tree exceeds limits or contains a cycle");
    seen.add(object);
    storedCells += object.cells.length;
    if (storedCells > 100000 || seen.size + object.children.length > 100000)
      throw new Error("Component preview exceeds cell/object limits");
    for (const cell of object.cells) {
      if (air.has(cell.state.name)) continue;
      nonAirCells++;
      if (nonAirCells <= COMPONENT_PREVIEW_CELL_LIMIT) cells.push(cell);
    }
    if (object.children.length)
      frames.push({ iterator: object.children.values(), depth: frame.depth + 1 });
  }
  if (nonAirCells > COMPONENT_PREVIEW_CELL_LIMIT) return {
    blocks: [], issues: [`3D preview is limited to ${COMPONENT_PREVIEW_CELL_LIMIT.toLocaleString()} non-air cells; this component has ${nonAirCells.toLocaleString()}. Its stored data is unchanged.`],
    totalIssues: 1, checkedStates: 0, complete: false, status: "limited", storedCells, nonAirCells,
  };
  const materials = new Map(catalog.map(material => [material.id, material]));
  const checked = new Set<string>();
  let complete = true, supported = 0, partial = false;
  for (const cell of cells) {
    const signature = stateKey(cell.state);
    if (checked.has(signature)) continue;
    if (checked.size >= STATE_LIMIT) { complete = false; continue; }
    checked.add(signature);
    const material = materials.get(cell.state.name);
    if (!material) { issue(`Registry unavailable: ${cell.state.name}. Import the matching game profile.`); continue; }
    try {
      validateState(cell.state, [material]);
      const appearance = assessAppearance({ kind: "block", id: cell.state.name,
        state: cell.state, material, profile, resolver });
      if (appearance.supported) supported++;
      if (appearance.status !== "supported") {
        partial = true;
        issue(`${cell.state.name}: ${appearance.reason}`);
      }
    } catch (error) {
      issue(`${cell.state.name}: ${error instanceof Error ? error.message : "Unsupported block state"}`);
    }
  }
  if (!complete) issue(`Resource inspection is limited to ${STATE_LIMIT} distinct blockstates; remaining states have not been checked.`);
  const minimum = [Infinity, Infinity, Infinity];
  for (const cell of cells) for (let axis = 0; axis < 3; axis++) minimum[axis] = Math.min(minimum[axis], cell.pos[axis]);
  return {
    blocks: cells.map(cell => ({ ...cell, owner: asset.id,
      pos: cell.pos.map((value, axis) => value - minimum[axis]) as SceneBlock["pos"] })),
    issues, totalIssues: issueKeys.size, checkedStates: checked.size, complete,
    status: !complete ? "limited" : !nonAirCells ? "ready" : !supported ? "unavailable" : partial || issueKeys.size ? "partial" : "ready",
    storedCells, nonAirCells,
  };
}
