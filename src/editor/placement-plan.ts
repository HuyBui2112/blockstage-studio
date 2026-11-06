import { blockAdapter } from "../core/adapter-registry";
import { bounds, rotatePos } from "../core/assembly";
import { validateState, type Material } from "../core/catalog";
import type { BlockState, Vec3 } from "../core/schema";
import {
  newEditorDocument,
  objectCells,
  validateDocument,
  type ComponentAsset,
  type EditorObject,
  type QuarterTurn,
} from "./model";
import { instantiateComponent, moveObjects, rotateObjects } from "./operations";
import { createPlacedObject, isBedBlock, isDoorBlock } from "./placement";

/** World-space ray hit; pos is the new cell, target is the clicked occupied cell.
 * look is the camera's forward direction, with +Z south and +X east. */
export type PlacementHit = {
  pos: Vec3;
  face: Vec3;
  point: Vec3;
  look?: Vec3;
  target?: Vec3;
};
export type PlacementOptions = {
  mode: "design" | "context";
  turns: QuarterTurn;
};
export type BlockPlacementPlan = {
  object: EditorObject;
  notes: string[];
  replaceObjectId?: string;
};

export { CONTEXT_CHAIN_IDS } from "../core/adapter-registry";

function validTurns(turns: QuarterTurn): void {
  if (!Number.isInteger(turns) || turns < 0 || turns > 3)
    throw new Error("Placement yaw requires zero to three quarter turns");
}
function validHit(hit: PlacementHit, pos: Vec3): void {
  if (hit.pos.some((value, axis) => value !== pos[axis]))
    throw new Error("Placement hit does not match the requested cell");
  if (
    hit.point.some((value) => !Number.isFinite(value)) ||
    hit.face.some((value) => ![-1, 0, 1].includes(value)) ||
    hit.face.filter((value) => value !== 0).length !== 1
  )
    throw new Error("Placement requires a finite hit and an axis-aligned face");
  if (hit.look?.some((value) => !Number.isFinite(value)))
    throw new Error("Placement look must be finite");
}
function horizontalFacing(look: Vec3 | undefined): string | undefined {
  if (!look || Math.hypot(look[0], look[2]) < 1e-8) return undefined;
  const yaw = (Math.atan2(-look[0], look[2]) * 180) / Math.PI;
  return ["south", "west", "north", "east"][
    ((Math.floor(yaw / 90 + 0.5) % 4) + 4) % 4
  ];
}
function contextState(
  state: BlockState,
  pos: Vec3,
  hit: PlacementHit | undefined,
  notes: string[],
): BlockState {
  const context = blockAdapter(state.name)?.context;
  const properties = { ...state.properties },
    result = { name: state.name, properties };
  if (!context) {
    notes.push("No verified Context adapter; selected state is preserved.");
    return result;
  }
  if (!hit) {
    notes.push("Context needs a surface hit; selected state is preserved.");
    return result;
  }
  validHit(hit, pos);
  if (context === "pillar" || context === "chain")
    properties.axis = hit.face[0] ? "x" : hit.face[2] ? "z" : "y";
  if (context === "chain")
    notes.push("Chain fluids are not simulated.");
  if (context === "lantern") {
    if (hit.face[1]) properties.hanging = String(hit.face[1] < 0);
    else
      notes.push(
        "Lantern Context needs a top or bottom face; selected hanging state is preserved.",
      );
    notes.push(
      "Lantern support, alternate attachment and fluids are not simulated.",
    );
  }
  if (context === "slab" || context === "stairs") {
    const top =
      hit.face[1] < 0 || (hit.face[1] === 0 && hit.point[1] - pos[1] > 0.5);
    properties[context === "slab" ? "type" : "half"] = top
      ? "top"
      : "bottom";
    notes.push(
      context === "slab"
        ? "Slab fluids are not simulated; merging is limited to exposed half surfaces of standalone same-ID slabs."
        : "Stair shape, neighbors and fluids are not simulated.",
    );
  }
  if (
    context === "stairs" ||
    isBedBlock(state.name) ||
    isDoorBlock(state.name)
  ) {
    const facing = horizontalFacing(hit.look);
    if (facing) properties.facing = facing;
    else
      notes.push(
        "Horizontal camera direction unavailable; selected facing is preserved.",
      );
  }
  if (isBedBlock(state.name))
    notes.push("Bed occupancy and neighbor updates are not simulated.");
  if (isDoorBlock(state.name))
    notes.push(
      "Door hinge, open state and power remain explicit; neighbors and power are not simulated.",
    );
  return result;
}

/** One plan supplies both the ghost and the atomic insertion. Context derives
 * only verified orientation/half fields; explicit remaining properties survive. */
export function planBlockPlacement(
  state: BlockState,
  pos: Vec3,
  catalog: Material[],
  hit: PlacementHit | undefined,
  options: PlacementOptions,
  target?: EditorObject,
): BlockPlacementPlan {
  validTurns(options.turns);
  validateState(state, catalog);
  const notes: string[] = [];
  // Callers supply a standalone root, never a nested leaf. This finite editor
  // merge uses the actual exposed horizontal half surface, not an inferred cell.
  if (
    options.mode === "context" && hit?.target && target &&
    blockAdapter(state.name)?.context === "slab" && target.kind === "block" &&
    target.cells.length === 1 && target.children.length === 0 &&
    !target.componentId
  ) {
    validHit(hit, pos);
    const cell = target.cells[0],
      targetPos = hit.target,
      half = cell.state.properties.type;
    if (
      cell.state.name === state.name &&
      cell.pos.every((value, axis) => value === targetPos[axis]) &&
      ((half === "bottom" && hit.face[1] === 1) ||
        (half === "top" && hit.face[1] === -1)) &&
      Math.abs(hit.point[1] - cell.pos[1] - 0.5) < 1e-7 &&
      [0, 2].every((axis) =>
        hit.point[axis] >= cell.pos[axis] && hit.point[axis] <= cell.pos[axis] + 1,
      )
    ) {
      const merged = {
        ...cell.state,
        properties: { ...cell.state.properties, type: "double", waterlogged: "false" },
      };
      validateState(merged, catalog);
      return {
        object: { ...target, cells: [{ ...cell, state: merged }] },
        replaceObjectId: target.id,
        notes: ["Merged standalone same-ID slab; fluids are not simulated."],
      };
    }
  }
  const source =
    options.mode === "context" ? contextState(state, pos, hit, notes) : state;
  let object = createPlacedObject(source, pos, catalog);
  if (options.turns) {
    const document = { ...newEditorDocument(), objects: [object] };
    object = rotateObjects(
      document,
      [object.id],
      options.turns,
      "active",
      catalog,
    ).objects[0];
  }
  return { object, notes };
}

/** Yaw around an integer cell center, then anchor rotated minimum bounds at pos.
 * This permits non-square footprints without rounding mixed-parity pivots.
 * The saved pivot and every child pivot rotate with the cells and states. */
export function planComponentPlacement(
  asset: ComponentAsset,
  pos: Vec3,
  turns: QuarterTurn,
  catalog: Material[],
): EditorObject {
  validTurns(turns);
  let object = instantiateComponent(asset, [0, 0, 0]);
  const anchor = objectCells(object)[0]?.pos;
  if (!anchor) throw new Error("A placed component must contain cells");
  const pivot2 = anchor.map((value) => value * 2 + 1) as Vec3;
  const savedPivot = [...object.pivot2] as Vec3;
  let document = { ...newEditorDocument(), objects: [{ ...object, pivot2 }] };
  if (turns)
    document = rotateObjects(document, [object.id], turns, "active", catalog);
  object = document.objects[0];
  const rotatedPivot = rotatePos(
    savedPivot.map((value, axis) => value - pivot2[axis]) as Vec3,
    turns,
  ).map((value, axis) => value + pivot2[axis]) as Vec3;
  document = { ...document, objects: [{ ...object, pivot2: rotatedPivot }] };
  const box = bounds(objectCells(object));
  const delta = pos.map((value, axis) => value - box.min[axis]) as Vec3;
  document = moveObjects(document, [object.id], delta, "global", catalog);
  validateDocument(document, catalog);
  return document.objects[0];
}
