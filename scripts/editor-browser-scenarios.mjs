import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runExportScenarios } from "./export-browser-scenarios.mjs";
import { runPlacementScenarios } from "./placement-browser-scenarios.mjs";
import { runStateEditScenarios } from "./state-edit-browser-scenarios.mjs";
import { runNeighborScenarios } from "./neighbor-browser-scenarios.mjs";
import { runSaveScenarios } from "./save-browser-scenarios.mjs";
import { runDocumentScenarios } from "./documents-browser-scenarios.mjs";
import { runRecoveryScenarios } from "./recovery-browser-scenarios.mjs";
import { runPortableScenarios } from "./portable-browser-scenarios.mjs";
import { runNbtImportScenarios } from "./nbt-import-browser-scenarios.mjs";
import { runDataSafetyScenarios } from "./data-safety-browser-scenarios.mjs";
import { runQuickBuildScenarios } from "./quickbuild-browser-scenarios.mjs";
import { runPrimitiveScenarios } from "./primitive-browser-scenarios.mjs";
import { runMaterialScenarios } from "./material-browser-scenarios.mjs";
import { runHouseScenarios } from "./house-browser-scenarios.mjs";
import { runVisibilityScenarios } from "./visibility-browser-scenarios.mjs";
import { runYRangeScenarios } from "./y-range-browser-scenarios.mjs";
import { runInteriorScenarios } from "./interior-browser-scenarios.mjs";
import { runComponentReuseScenarios } from "./component-reuse-browser-scenarios.mjs";
import { runComponentLibraryScenarios } from "./component-library-browser-scenarios.mjs";
import { runInteractionScenarios } from "./interaction-browser-scenarios.mjs";
import { runR1HouseScenarios } from "./r1-house-browser-scenarios.mjs";
import { runPerformanceScenarios } from "./performance-browser-scenarios.mjs";
import { runEntityScenarios } from "./entity-browser-scenarios.mjs";
import { runEntityViewportScenarios } from "./entity-viewport-browser-scenarios.mjs";
import { runContextScenarios } from "./context-browser-scenarios.mjs";
import { runBuildingToolsScenarios } from "./building-tools-browser-scenarios.mjs";
import { runMirrorScenarios } from "./mirror-browser-scenarios.mjs";

/** Real input integration scenarios, called by the existing isolated-browser harness. */
export async function runEditorScenarios({
  command,
  evaluate,
  until,
  click,
  aria,
  input,
  upload,
  key,
  screenshot,
  directory,
  profilePath,
  createPeer,
}) {
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "mirror")
    return runMirrorScenarios({command,evaluate,until,click,aria,input,upload,key,screenshot,directory,profilePath});
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "building-tools")
    return runBuildingToolsScenarios({command,evaluate,until,click,aria,input,upload,key,screenshot,directory});
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "context") {
    await click(aria("Architecture workspace"));
    await until(`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`);
    console.log(JSON.stringify({ contextResult: await runContextScenarios({ evaluate, until }) }));
    return;
  }
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "placement") {
    await click(aria("Component Editor workspace"));
    await until(`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`);
    return runPlacementScenarios({ command, evaluate, until, click, aria, input, upload, key, screenshot, directory, profilePath });
  }
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "entities")
    return runEntityScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      key,
      screenshot,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "entity-viewport")
    return runEntityViewportScenarios({ command, evaluate, until, click, aria, input, upload, key, screenshot, directory });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "performance")
    return runPerformanceScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      upload,
      key,
      screenshot,
      directory,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "r1-house")
    return runR1HouseScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      key,
      screenshot,
      directory,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "interaction")
    return runInteractionScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      upload,
      key,
      screenshot,
      directory,
      profilePath,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "component-library")
    return runComponentLibraryScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      upload,
      screenshot,
      directory,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "component-reuse")
    return runComponentReuseScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      key,
      screenshot,
      directory,
      profilePath,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "interior")
    return runInteriorScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      key,
      screenshot,
      directory,
      profilePath,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "y-range")
    return runYRangeScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      upload,
      key,
      screenshot,
      directory,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "visibility")
    return runVisibilityScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      upload,
      key,
      screenshot,
      directory,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "house")
    return runHouseScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      key,
      screenshot,
      directory,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "materials")
    return runMaterialScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      upload,
      key,
      screenshot,
      directory,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "primitives")
    return runPrimitiveScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      key,
      screenshot,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "quickbuild")
    return runQuickBuildScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      upload,
      key,
      screenshot,
      directory,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "data-safety")
    return runDataSafetyScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      upload,
      screenshot,
      directory,
      createPeer,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "recovery")
    return runRecoveryScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      input,
      upload,
      key,
      screenshot,
      createPeer,
      directory,
    });
  if (process.env.BLOCKSTAGE_EDITOR_SLICE === "nbt")
    return runNbtImportScenarios({
      command,
      evaluate,
      until,
      click,
      aria,
      upload,
      key,
      screenshot,
      directory,
    });
  const editor = ".editor-diagnostics";
  const snapshot = () =>
    evaluate(
      `JSON.parse(document.querySelector('${editor}').dataset.snapshot)`,
    );
  const count = async (objects, cells) =>
    until(
      `document.querySelector('${editor}')?.dataset.objects === '${objects}' && document.querySelector('${editor}')?.dataset.blocks === '${cells}'`,
    );
  const focus = () => evaluate(`document.querySelector('canvas').focus()`);
  async function mouse(x, y, modifiers = 0) {
    await command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      modifiers,
    });
    await command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers,
    });
    await command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
      modifiers,
    });
  }
  const rect = () =>
    evaluate(
      `(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; })()`,
    );
  async function outline(index, toggle = false) {
    await evaluate(
      `document.querySelectorAll('.outliner-object > button')[${index}].scrollIntoView({block:'nearest'})`,
    );
    const point = await evaluate(
      `(() => { const r = document.querySelectorAll('.outliner-object > button')[${index}].getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`,
    );
    await mouse(point.x, point.y, toggle ? 8 : 0);
  }
  async function modal(keys, commit = true) {
    await focus();
    for (const [code, value] of keys) await key(code, value);
    if (commit) await key("Enter", "Enter");
  }
  const moveX = (value, commit = true) =>
    modal(
      [
        ["KeyG", "g"],
        ["KeyX", "x"],
        ...String(value)
          .split("")
          .map((value) => [
            value === "-"
              ? "Minus"
              : value === "."
                ? "Period"
                : `Digit${value}`,
            value,
          ]),
      ],
      commit,
    );
  const rotate = (value, commit = true) =>
    modal(
      [
        ["KeyR", "r"],
        ...String(value)
          .split("")
          .map((value) => [`Digit${value}`, value]),
      ],
      commit,
    );
  const history = () =>
    evaluate(`Number(document.querySelector('${editor}').dataset.history)`);

  await command("Emulation.setDeviceMetricsOverride", {
    width: 1500,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click(aria("Architecture workspace"));
  await until(
    `document.querySelector('.editor-workspace')?.dataset.editorReady === 'true'`,
  );
  // The resource smoke ends in a compact view. Ensure both editor panels are open.
  if (!(await evaluate(`Boolean(document.querySelector('.editor-library'))`)))
    await click(aria("Toggle editor library"));
  if (!(await evaluate(`Boolean(document.querySelector('.editor-inspector'))`)))
    await click(aria("Toggle editor inspector"));
  await until(
    `document.querySelector('.editor-workspace canvas') && document.querySelector('.editor-library') && document.querySelector('.editor-inspector')`,
  );
  assert.ok(
    await evaluate(
      `(()=>{const canvas=document.querySelector('canvas').getBoundingClientRect(),library=document.querySelector('.editor-library').getBoundingClientRect(),inspector=document.querySelector('.editor-inspector').getBoundingClientRect();return canvas.width > 700 && library.width < 340 && inspector.width < 320 && Math.abs(library.top-inspector.top)<2})()`,
    ),
    "Editor must retain its three-column viewport layout after switching from Assets",
  );
  await count(0, 0);
  await input(aria("Search resources"), "minecraft:red_bed");
  await click('.resource-item[title="minecraft:red_bed"]');
  await click(aria("Editor Y view"));
  const bedCanvas = await rect();
  await mouse(
    bedCanvas.x + bedCanvas.width / 2 + 10,
    bedCanvas.y + bedCanvas.height / 2,
  );
  await count(1, 2);
  let placed = await snapshot();
  assert.deepEqual(
    placed.cells.map((cell) => cell.state.properties.part).sort(),
    ["foot", "head"],
  );
  assert.ok(
    placed.cells.every((cell) => cell.state.name === "minecraft:red_bed"),
  );
  const firstHistory = await history();
  await click(aria("Select tool"));
  await click(aria("Frame editor scene"));
  const bedView = await rect();
  await mouse(
    bedView.x + bedView.width / 2 + 10,
    bedView.y + bedView.height / 2,
  );
  await until(
    `document.querySelector('canvas').dataset.selectionCount === '1'`,
  );
  await focus();
  await key("Delete", "Delete");
  await count(0, 0);
  await click(aria("Undo editor"));
  await count(1, 2);
  assert.equal(
    await history(),
    firstHistory,
    "Deleting and undoing a bed must be one action",
  );
  await outline(0);
  await input(aria("State facing"), "west");
  await until(
    `JSON.parse(document.querySelector('${editor}').dataset.snapshot).cells.every(cell=>cell.state.properties.facing === 'west')`,
  );
  placed = await snapshot();
  const foot = placed.cells.find(
    (cell) => cell.state.properties.part === "foot",
  );
  const head = placed.cells.find(
    (cell) => cell.state.properties.part === "head",
  );
  assert.deepEqual(
    head.pos,
    [foot.pos[0] - 1, foot.pos[1], foot.pos[2]],
    "Bed state edit must move the head, preserving a complete pair",
  );
  await screenshot("editor-bed");

  // Import deterministic states to verify mouse/keyboard transforms and multi-object ownership.
  const { readFile } = await import("node:fs/promises");
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  const cell = (name, pos, properties = {}) => ({
    pos,
    state: {
      name: `minecraft:${name}`,
      properties: {
        ...profile.blocks.find((block) => block.id === `minecraft:${name}`)
          .defaults,
        ...properties,
      },
    },
  });
  const block = (id, name, pos, properties = {}) => ({
    id,
    name,
    kind: "block",
    cells: [cell(name, pos, properties)],
    children: [],
    pivot2: pos.map((value) => value * 2 + 1),
    orientation: 0,
  });
  const document = {
    schemaVersion: 2,
    id: "editor-browser-fixture",
    name: "Editor verification",
    workspace: "architecture",
    target: { gameVersion: "26.2", dataVersion: 4903 },
    entities: [],
    objects: [
      block("log", "oak_log", [0, 0, 0], { axis: "x" }),
      block("stairs", "oak_stairs", [4, 0, 0], {
        facing: "north",
        half: "top",
        shape: "inner_left",
      }),
      block("slab", "stone_brick_slab", [0, 0, 4], { type: "top" }),
      block("furnace", "furnace", [4, 0, 4], { facing: "north" }),
      {
        id: "door",
        name: "oak door",
        kind: "multiblock",
        cells: [
          cell("oak_door", [8, 0, 0], { half: "lower" }),
          cell("oak_door", [8, 1, 0], { half: "upper" }),
        ],
        children: [],
        pivot2: [17, 1, 1],
        orientation: 0,
      },
      {
        id: "sunflower",
        name: "sunflower",
        kind: "multiblock",
        cells: [
          cell("sunflower", [8, 0, 4], { half: "lower" }),
          cell("sunflower", [8, 1, 4], { half: "upper" }),
        ],
        children: [],
        pivot2: [17, 1, 9],
        orientation: 0,
      },
    ],
  };
  const file = join(directory, "editor-verification.json");
  await writeFile(file, JSON.stringify(document));
  await upload(aria("Import editor document"), file);
  await count(6, 8);
  await until(
    `document.querySelector('[aria-label="Document name"]').value === 'Editor verification'`,
  );
  await outline(0);
  const original = await snapshot(),
    initialHistory = await history();
  await moveX(2, false);
  await until(`document.querySelector('.transform-hud.valid')`);
  assert.deepEqual(
    await snapshot(),
    original,
    "Transform preview must not change committed cells",
  );
  await key("Escape", "Escape");
  assert.deepEqual(await snapshot(), original);
  assert.equal(
    await history(),
    initialHistory,
    "Cancel must not create an undo entry",
  );
  await moveX(4);
  await until(
    `document.querySelector('.editor-feedback')?.textContent.includes('collision')`,
  );
  assert.deepEqual(
    await snapshot(),
    original,
    "Collision must reject the complete command",
  );
  await click(aria("Dismiss editor message"));
  await moveX("1.5");
  assert.deepEqual(
    await snapshot(),
    original,
    "Fractional numeric translation must be rejected",
  );
  await rotate(45);
  assert.deepEqual(
    await snapshot(),
    original,
    "Illegal numeric rotation must be rejected",
  );
  await click(aria("Dismiss editor message"));
  await moveX(2);
  await until(
    `JSON.parse(document.querySelector('${editor}').dataset.snapshot).cells.find(cell=>cell.owner==='log').pos[0] === 2`,
  );
  assert.equal(await history(), initialHistory + 1);
  await click(aria("Undo editor"));
  assert.deepEqual(await snapshot(), original);
  await click(aria("Redo editor"));
  await until(
    `JSON.parse(document.querySelector('${editor}').dataset.snapshot).cells.find(cell=>cell.owner==='log').pos[0] === 2`,
  );
  await rotate(90);
  await until(
    `JSON.parse(document.querySelector('${editor}').dataset.snapshot).cells.find(cell=>cell.owner==='log').state.properties.axis === 'z'`,
  );
  await input(aria("Transform space"), "local");
  await moveX(2);
  await until(
    `JSON.parse(document.querySelector('${editor}').dataset.snapshot).cells.find(cell=>cell.owner==='log').pos[2] === 2`,
  );
  await input(aria("Transform space"), "global");
  // Actual gizmo pointer drag; metadata comes from the installed Three.js picker geometry.
  await click(aria("Move tool"));
  await until(
    `JSON.parse(document.querySelector('canvas').dataset.gizmoHandles).handles.some(handle=>handle.axis==='X')`,
  );
  let handles = await evaluate(
    `JSON.parse(document.querySelector('canvas').dataset.gizmoHandles)`,
  );
  let canvas = await rect(),
    handle = handles.handles.find((handle) => handle.axis === "X");
  const dragStart = { x: canvas.x + handle.x, y: canvas.y + handle.y };
  const dragEnd = {
    x: dragStart.x + (handle.x - handles.origin.x) * 1.8,
    y: dragStart.y + (handle.y - handles.origin.y) * 1.8,
  };
  const beforeDrag = await snapshot(),
    beforeDragHistory = await history();
  await command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...dragStart,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...dragStart,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  for (let step = 1; step <= 5; step++)
    await command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: dragStart.x + ((dragEnd.x - dragStart.x) * step) / 5,
      y: dragStart.y + ((dragEnd.y - dragStart.y) * step) / 5,
      buttons: 1,
    });
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...dragEnd,
    button: "left",
    clickCount: 1,
  });
  await until(
    `Number(document.querySelector('${editor}').dataset.history) > ${beforeDragHistory}`,
  );
  assert.notDeepEqual(
    await snapshot(),
    beforeDrag,
    "Dragging a gizmo handle must move actual document cells",
  );
  assert.equal(
    await history(),
    beforeDragHistory + 1,
    "A whole gizmo drag must commit one undo action",
  );
  await click(aria("Undo editor"));
  assert.deepEqual(await snapshot(), beforeDrag);
  await click(aria("Rotate tool"));
  await until(
    `JSON.parse(document.querySelector('canvas').dataset.gizmoHandles).mode === 'rotate'`,
  );
  handles = await evaluate(
    `JSON.parse(document.querySelector('canvas').dataset.gizmoHandles)`,
  );
  canvas = await rect();
  handle = handles.handles.find((handle) => handle.axis === "Y");
  assert.ok(handle, "The legal Y rotation ring must be available");
  const rotationOrigin = {
    x: canvas.x + handles.origin.x,
    y: canvas.y + handles.origin.y,
  };
  const vector = {
    x: handle.x - handles.origin.x,
    y: handle.y - handles.origin.y,
  };
  const ringStart = {
    x: rotationOrigin.x + vector.x,
    y: rotationOrigin.y + vector.y,
  };
  await command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...ringStart,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...ringStart,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  let ringEnd;
  for (let step = 1; step <= 8; step++) {
    const angle = ((Math.PI / 2) * step) / 8;
    ringEnd = {
      x:
        rotationOrigin.x +
        vector.x * Math.cos(angle) -
        vector.y * Math.sin(angle),
      y:
        rotationOrigin.y +
        vector.x * Math.sin(angle) +
        vector.y * Math.cos(angle),
    };
    await command("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...ringEnd,
      buttons: 1,
    });
  }
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...ringEnd,
    button: "left",
    clickCount: 1,
  });
  await until(
    `Number(document.querySelector('${editor}').dataset.history) > ${beforeDragHistory}`,
  );
  assert.equal(
    (await snapshot()).cells.find((cell) => cell.owner === "log").state
      .properties.axis,
    "x",
    "Dragging the rotation ring must transform blockstate, not just the mesh",
  );
  assert.equal(await history(), beforeDragHistory + 1);
  await click(aria("Undo editor"));
  assert.deepEqual(await snapshot(), beforeDrag);
  await click(aria("Select tool"));
  await outline(1);
  await outline(0, true);
  await until(
    `document.querySelector('canvas').dataset.selectionCount === '2'`,
  );
  const rootSelection = () =>
    evaluate(
      `JSON.parse(document.querySelector('${editor}').dataset.selection)`,
    );
  const orderedSelection = await rootSelection();
  assert.deepEqual(
    orderedSelection,
    ["stairs", "log"],
    "Selection order differs from document order",
  );
  const beforeBatch = await snapshot(),
    beforeBatchHistory = await history();
  await modal([
    ["KeyG", "g"],
    ["KeyY", "y"],
    ["Digit2", "2"],
    ["Digit5", "5"],
    ["Digit6", "6"],
  ]);
  await until(
    `JSON.parse(document.querySelector('${editor}').dataset.snapshot).cells.find(cell=>cell.owner==='log').pos[1]===256`,
  );
  const movedBatch = await snapshot();
  assert.equal(await history(), beforeBatchHistory + 1);
  await click(aria("Undo editor"));
  assert.deepEqual(await snapshot(), beforeBatch);
  assert.deepEqual(
    await rootSelection(),
    orderedSelection,
    "Undo retains surviving selection order and active root",
  );
  await click(aria("Redo editor"));
  assert.deepEqual(await snapshot(), movedBatch);
  assert.deepEqual(
    await rootSelection(),
    orderedSelection,
    "Redo retains surviving selection order",
  );
  await click(aria("Undo editor"));
  assert.deepEqual(
    await snapshot(),
    beforeBatch,
    "Batch move remains one undo action",
  );
  const beforeGroup = await snapshot();
  await click(aria("Group selection"));
  await count(5, 8);
  const grouped = await snapshot();
  assert.equal(
    grouped.objects.filter((object) => object.kind === "group").length,
    1,
  );
  await click(aria("Undo editor"));
  await count(6, 8);
  assert.deepEqual((await snapshot()).cells, beforeGroup.cells);
  assert.deepEqual(
    await rootSelection(),
    [],
    "Undo grouping drops the vanished selected group ID",
  );
  await click(aria("Redo editor"));
  await count(5, 8);
  assert.deepEqual(await snapshot(), grouped);
  assert.deepEqual(
    await rootSelection(),
    [],
    "Redo restores the group without implicitly selecting it",
  );
  await outline(0);
  await click(aria("Ungroup selection"));
  await count(6, 8);
  assert.deepEqual(
    (await snapshot()).cells,
    beforeGroup.cells,
    "Ungroup must preserve positions, ownership and states",
  );
  // Box through-selection with real pointer bounds, then save a reusable component.
  await click(aria("Box tool"));
  canvas = await rect();
  const boxStart = { x: canvas.x + 4, y: canvas.y + 4 },
    boxEnd = {
      x: canvas.x + canvas.width - 5,
      y: canvas.y + canvas.height - 5,
    };
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...boxStart,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...boxEnd,
    buttons: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...boxEnd,
    button: "left",
    clickCount: 1,
  });
  await until(
    `Number(document.querySelector('canvas').dataset.selectionCount) >= 4`,
  );
  await click(aria("Select tool"));
  await outline(0);
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Save selection as component').click()`,
  );
  await until(
    `document.querySelector('.editor-library-tabs')?.textContent.includes('1')`,
  );
  await click(".editor-library-tabs button:nth-child(2)");
  await until(`document.querySelector('.component-asset')`);
  await click(".component-asset-actions button:first-child");
  await until(
    `document.querySelector('${editor}').dataset.workspace === 'component'`,
  );
  await count(1, 1);
  await evaluate(
    `document.querySelector('[aria-label="Document name"]').focus()`,
  );
  await input(aria("Document name"), "Test beam");
  await evaluate(
    `document.querySelector('[aria-label="Document name"]').blur()`,
  );
  await outline(0);
  await input(aria("State axis"), "y");
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='Save to component library').click()`,
  );
  await until(`document.querySelector('.document-saved')`);
  await click(aria("Architecture workspace"));
  await count(6, 8);
  assert.deepEqual(
    (await snapshot()).cells,
    beforeGroup.cells,
    "Editing a component must not mutate its source architecture",
  );
  await click(".editor-library-tabs button:nth-child(2)");
  await click(".component-asset-main");
  await input(aria("Placement grid Y"), "3");
  canvas = await rect();
  await mouse(canvas.x + canvas.width * 0.83, canvas.y + canvas.height * 0.72);
  await count(7, 9);
  assert.equal(
    (await snapshot()).objects.filter((object) => object.kind === "component")
      .length,
    1,
    "A saved component must place as a reusable logical object",
  );
  const instanceCells = (await snapshot()).cells.filter(
    (cell) =>
      !beforeGroup.cells.some((previous) => previous.owner === cell.owner),
  );
  assert.equal(instanceCells[0].state.properties.axis, "y");
  await click(aria("3D Preview workspace"));
  await until(
    `document.querySelector('${editor}').dataset.workspace === 'preview'`,
  );
  const previewBefore = await snapshot();
  assert.equal(
    await evaluate(
      `Boolean(document.querySelector('.editor-tools button[aria-label="Move tool"]'))`,
    ),
    false,
  );
  await focus();
  await key("Delete", "Delete");
  await key("KeyG", "g");
  assert.deepEqual(
    await snapshot(),
    previewBefore,
    "Preview workspace must be read-only",
  );
  await screenshot("editor-preview");
  await click(aria("Architecture workspace"));
  await evaluate(
    `Array.from(document.querySelectorAll('.document-actions button')).find(button=>button.textContent.trim()==='Save').click()`,
  );
  await until(`document.querySelector('.document-saved')`);
  const savedScene = await snapshot();
  await screenshot("editor-architecture");
  const previous = await evaluate("performance.timeOrigin");
  await command("Page.reload");
  await until(
    `performance.timeOrigin !== ${previous} && document.querySelector('.editor-workspace')?.dataset.editorReady === 'true'`,
  );
  assert.deepEqual(
    await snapshot(),
    savedScene,
    "Saved architecture must restore after reload",
  );
  await click(aria("Component Editor workspace"));
  await count(1, 1);
  assert.equal(
    (await snapshot()).cells[0].state.properties.axis,
    "y",
    "Component draft must persist independently",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[aria-label="Document name"]').value`,
    ),
    "Test beam",
  );
  assert.notEqual(
    (await snapshot()).id,
    savedScene.id,
    "Architecture and component documents remain independent",
  );
  await screenshot("editor-component");
  await runExportScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    key,
    screenshot,
    directory,
    profilePath,
  });
  await runPlacementScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    key,
    screenshot,
    directory,
    profilePath,
  });
  await runStateEditScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    key,
    screenshot,
    directory,
    profilePath,
  });
  await runNeighborScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    key,
    screenshot,
    directory,
    profilePath,
  });
  await runSaveScenarios({ command, evaluate, until, click, aria, input, key });
  await runDocumentScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    key,
    screenshot,
    createPeer,
    directory,
  });
  await runNbtImportScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    upload,
    key,
    screenshot,
    directory,
  });
  await runPortableScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    upload,
    screenshot,
    createPeer,
    directory,
  });
  await runQuickBuildScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    key,
    screenshot,
    directory,
  });
  await runPrimitiveScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    key,
    screenshot,
  });
  await runMaterialScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    key,
    screenshot,
    directory,
  });
  await runHouseScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    key,
    screenshot,
    directory,
  });
  await runVisibilityScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    key,
    screenshot,
    directory,
  });
  await runYRangeScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    key,
    screenshot,
    directory,
  });
  await runInteriorScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    key,
    screenshot,
    directory,
    profilePath,
  });
  await runComponentReuseScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    key,
    screenshot,
    directory,
    profilePath,
  });
  await runR1HouseScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    key,
    screenshot,
    directory,
  });
  await runComponentLibraryScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    screenshot,
    directory,
  });
  await runInteractionScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    key,
    screenshot,
    directory,
    profilePath,
  });
  await runEntityScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    key,
    screenshot,
  });
  await runEntityViewportScenarios({ command, evaluate, until, click, aria, input, upload, key, screenshot, directory });
  await runBuildingToolsScenarios({ command, evaluate, until, click, aria, input, upload, key, screenshot, directory });
  await runMirrorScenarios({ command, evaluate, until, click, aria, input, upload, key, screenshot, directory, profilePath });
  await runDataSafetyScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    screenshot,
    directory,
    createPeer,
  });
  await runRecoveryScenarios({
    command,
    evaluate,
    until,
    click,
    aria,
    input,
    upload,
    key,
    screenshot,
    createPeer,
    directory,
  });
  await command("Emulation.setDeviceMetricsOverride", {
    width: 620,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const compactReload = await evaluate("performance.timeOrigin");
  await command("Page.reload");
  await until(
    `performance.timeOrigin !== ${compactReload} && document.querySelector('.editor-workspace')?.dataset.editorReady === 'true' && document.querySelector('canvas')`,
  );
  assert.equal(
    await evaluate(`document.documentElement.scrollWidth > innerWidth`),
    false,
    "Compact editor must not overflow horizontally",
  );
  assert.ok(
    await evaluate(
      `(()=>{const header=document.querySelector('.topbar').getBoundingClientRect();return [...document.querySelectorAll('.workspace-tabs button')].every(button=>{const rect=button.getBoundingClientRect();return rect.top>=header.top&&rect.bottom<=header.bottom})})()`,
    ),
    "Workspace tabs must remain fully visible in the compact header",
  );
  await click(aria("Toggle editor library"));
  await until(
    `document.querySelector('.editor-library') && getComputedStyle(document.querySelector('.editor-library')).display !== 'none'`,
  );
  await click(aria("Toggle editor library"));
  await click(aria("Toggle editor inspector"));
  await until(
    `document.querySelector('.editor-inspector') && getComputedStyle(document.querySelector('.editor-inspector')).display !== 'none'`,
  );
  await screenshot("editor-compact");
  console.log(
    JSON.stringify({
      editorResult: "passed",
      checks: [
        "paired bed placement/selection/delete",
        "paired state update",
        "immutable preview/cancel",
        "collision and fractional rejection",
        "numeric move/rotate",
        "undo/redo",
        "local space",
        "native move and rotate gizmos",
        "Shift selection",
        "group/ungroup",
        "through box selection",
        "reusable component edit/place",
        "workspace isolation",
        "read-only preview",
        "independent persistence",
      ],
    }),
  );
}
