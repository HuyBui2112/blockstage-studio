import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Native rays/keys against public UI. Fixture JSON supplies controlled occlusion only. */
export async function runEntityViewportScenarios({ command, evaluate, until, click, aria, input, upload, key, screenshot, directory }) {
  const ready = `document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`;
  const data = ".editor-diagnostics";
  const entities = () => evaluate(`JSON.parse(document.querySelector('${data}').dataset.entities)`);
  const selected = () => evaluate(`JSON.parse(document.querySelector('${data}').dataset.entitySelection)`);
  const blockSelection = () => evaluate(`JSON.parse(document.querySelector('${data}').dataset.selection)`);
  const status = () => evaluate(`(()=>{const d=document.querySelector('${data}').dataset;return {history:d.history,revision:d.revision}})()`);
  const candidate = () => evaluate(`JSON.parse(document.querySelector('${data}').dataset.entityPreview||'null')`);
  const pending = () => until(`document.querySelector('${data}').dataset.entityPreview!==''`);
  const focus = () => evaluate(`document.querySelector('.editor-workspace canvas').focus()`);
  const visible = () => evaluate(`JSON.parse(document.querySelector('${data}').dataset.visibleEntities)`);
  async function panel() {
    if (!await evaluate(`!!document.querySelector('.editor-inspector')`)) await click(aria("Toggle editor inspector"));
    if (!await evaluate(`document.querySelector('.entity-panel')?.open`)) await click(".entity-panel > summary");
  }
  async function view(label) { await click(".object-view-menu > summary"); await click(aria(label)); }
  async function point(world) {
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    return evaluate(`(()=>{const m=JSON.parse(document.querySelector('canvas').dataset.editorCamera).projection,p=${JSON.stringify(world)},q=[0,0,0,0];for(let r=0;r<4;r++)q[r]=m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r];const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x+(q[0]/q[3]+1)*b.width/2,y:b.y+(1-q[1]/q[3])*b.height/2}})()`);
  }
  async function hover(world) {
    const p = await point(world);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    return p;
  }
  async function press(p, modifiers = 0) {
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", buttons: 1, clickCount: 1, modifiers });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", buttons: 0, clickCount: 1, modifiers });
  }
  async function typeNumber(value) {
    for (const character of String(value)) await key(character === "." ? "Period" : character === "-" ? "Minus" : `Digit${character}`, character);
  }
  const stone = (id, pos) => ({ id, name: id, kind: "block", cells: [{ pos, state: { name: "minecraft:stone", properties: {} } }], children: [], pivot2: pos.map(value => 2 * value + 1), orientation: 0 });
  const fixture = {
    schemaVersion: 2, id: "entity-viewport-fixture", name: "Entity viewport verification", workspace: "architecture",
    target: { gameVersion: "26.2", dataVersion: 4903 },
    objects: [stone("rear-stone", [0, 0, 0]), stone("front-stone", [3, 0, 2])],
    entities: [
      { id: "front-pig", type: "minecraft:pig", position: [0.5, 0, 2.5], yaw: 0 },
      { id: "rear-pig", type: "minecraft:pig", position: [3.5, 0, 0.5], yaw: 30 },
      { id: "side-pig", type: "minecraft:pig", position: [-2.5, 0.25, 0.5], yaw: 15 },
    ],
  };
  await command("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  await click(aria("Architecture workspace")); await until(ready);
  const fixturePath = join(directory, "entity-viewport-fixture.json");
  await writeFile(fixturePath, JSON.stringify(fixture));
  await upload(aria("Import editor document"), fixturePath);
  await until(`document.querySelector('[aria-label="Document name"]').value===${JSON.stringify(fixture.name)}`);
  await panel();
  await click(aria("Select tool")); await click(aria("Editor Z view")); await click(aria("Frame editor scene"));
  const initialStatus = await status();
  await press(await hover([0.5, 0.65, 2.5]));
  await until(`document.querySelector('${data}').dataset.entitySelection==='["front-pig"]'`);
  assert.deepEqual(await blockSelection(), [], "Front entity beats rear occupied block cell");
  await press(await hover([3.5, 0.65, 2.5]));
  await until(`document.querySelector('${data}').dataset.selection==='["front-stone"]'`);
  assert.deepEqual(await selected(), [], "Front block cell beats rear entity");
  assert.deepEqual(await status(), initialStatus, "Ray selection is not a document edit");

  await press(await hover([0.5, 0.65, 2.5]));
  await until(`document.querySelector('${data}').dataset.entitySelection==='["front-pig"]'`);
  await focus(); await key("KeyG", "g"); await key("KeyX", "x"); await typeNumber("0.5"); await pending();
  const movedPreview = await candidate();
  assert.deepEqual((await entities())[0], fixture.entities[0], "Numeric entity preview does not mutate committed data");
  assert.deepEqual(movedPreview.find(entity => entity.id === "front-pig").position, [1, 0, 2.5]);
  await key("Escape", "Escape");
  await until(`document.querySelector('${data}').dataset.entityPreview===''`);
  assert.deepEqual(await status(), initialStatus, "Escape cancels entity movement without history");
  await focus(); await key("KeyG", "g"); await key("KeyX", "x"); await typeNumber("0.25"); await pending();
  await key("KeyQ", "q");
  await until(`document.querySelector('${data}').dataset.entityPreview===''`);
  assert.deepEqual(await status(), initialStatus, "Q cancels numeric entity movement");
  await key("KeyR", "r"); await typeNumber("15"); await pending(); await key("KeyE", "e");
  await until(`document.querySelector('${data}').dataset.entityPreview===''&&document.querySelector('[aria-label="Place tool"]').classList.contains('active')`);
  assert.deepEqual(await entities(), fixture.entities, "E retires entity preview before restoring block placement");
  await key("KeyQ", "q");
  await focus(); await key("KeyG", "g"); await key("KeyX", "x"); await typeNumber("0.5"); await pending();
  const exactMoved = await candidate(); await key("Enter", "Enter");
  await until(`document.querySelector('${data}').dataset.entityPreview===''`);
  assert.deepEqual(await entities(), exactMoved, "Enter commits the exact fractional candidate");
  assert.equal(Number((await status()).history), Number(initialStatus.history) + 1);
  await focus(); await key("KeyR", "r"); await typeNumber("45"); await pending();
  const exactRotated = await candidate(); await key("Enter", "Enter");
  await until(`document.querySelector('${data}').dataset.entityPreview===''`);
  assert.equal((await entities()).find(entity => entity.id === "front-pig").yaw, 45);
  assert.deepEqual(await entities(), exactRotated);
  await click(aria("Undo editor")); assert.deepEqual(await entities(), exactMoved);
  await click(aria("Redo editor")); assert.deepEqual(await entities(), exactRotated);
  await click(aria("Move tool"));
  await until(`document.querySelector('canvas').dataset.entityGizmo==='translate'`);
  assert.equal(await evaluate(`!!document.querySelector('.entity-transform-hud')`), false, "Confirmed modal HUD must be retired");
  await screenshot("entity-viewport-selected-gizmo");
  const beforeGizmo = await status();
  async function gizmo(axis) {
    await until(`JSON.parse(document.querySelector('canvas').dataset.entityGizmoHandles).handles.some(handle=>handle.axis===${JSON.stringify(axis)})`);
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    return evaluate(`(()=>{const d=JSON.parse(document.querySelector('canvas').dataset.entityGizmoHandles),r=document.querySelector('canvas').getBoundingClientRect(),h=d.handles.find(handle=>handle.axis===${JSON.stringify(axis)});return {x:r.x+h.x,y:r.y+h.y,ox:r.x+d.origin.x,oy:r.y+d.origin.y}})()`);
  }
  async function drag(start, end) {
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 5; step++) await command("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: start.x + (end.x-start.x)*step/5, y: start.y + (end.y-start.y)*step/5, buttons: 1,
    });
    await pending();
    const preview = await candidate();
    assert.deepEqual(await entities(), exactRotated, "Gizmo preview keeps committed entities intact");
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...end, button: "left", buttons: 0, clickCount: 1 });
    await until(`document.querySelector('${data}').dataset.entityPreview===''`);
    assert.deepEqual(await entities(), preview, "Gizmo release commits the exact candidate");
    return preview;
  }
  const moveHandle = await gizmo("X");
  const dragMoved = await drag(moveHandle, { x: moveHandle.x + 27, y: moveHandle.y });
  const movedPig = dragMoved.find(entity=>entity.id==='front-pig');
  assert.ok(Math.abs(movedPig.position[0]-1)>.001 && !Number.isInteger(movedPig.position[0]), "Entity gizmo retains fractional movement");
  assert.deepEqual(movedPig.position.slice(1), [0, 2.5]);
  assert.equal(Number((await status()).history), Number(beforeGizmo.history)+1);
  await click(aria("Undo editor")); assert.deepEqual(await entities(), exactRotated);
  await click(aria("Editor Y view")); await click(aria("Rotate tool"));
  const ring = await gizmo("Y"), angle = Math.PI/180*37.5;
  const vector = { x: ring.x-ring.ox, y: ring.y-ring.oy };
  const ringEnd = { x: ring.ox+vector.x*Math.cos(angle)-vector.y*Math.sin(angle), y: ring.oy+vector.x*Math.sin(angle)+vector.y*Math.cos(angle) };
  const dragRotated = await drag(ring, ringEnd);
  const rotatedPig = dragRotated.find(entity=>entity.id==='front-pig');
  assert.ok(Math.abs(rotatedPig.yaw-82.5)<.1, "Y ring applies fractional clockwise yaw delta");
  assert.deepEqual(rotatedPig.position, [1,0,2.5]);
  await click(aria("Undo editor")); assert.deepEqual(await entities(), exactRotated);
  await click(aria("Select tool"));
  await click(aria("Editor Z view"));

  const beforeView = await status();
  await panel(); await click(aria("Lock entity front-pig"));
  assert.deepEqual(await selected(), [], "Lock prunes entity selection");
  assert.ok((await visible()).includes("front-pig"), "Locked entity remains drawn");
  assert.equal(await evaluate(`document.querySelector('[aria-label="Select entity front-pig"]').disabled`), true);
  await press(await hover([1, 0.65, 2.5]));
  assert.ok(!(await selected()).includes("front-pig"), "Locked entity cannot steal a ray");
  await click(aria("Unlock entity front-pig")); await click(aria("Select entity front-pig"));
  await view("Hide selected"); assert.ok(!(await visible()).includes("front-pig"));
  assert.deepEqual(await selected(), []);
  await view("Show all");
  await click(aria("Select entity side-pig")); await view("Isolate selected");
  assert.deepEqual(await visible(), ["side-pig"]);
  assert.equal(await evaluate(`document.querySelector('.editor-view-diagnostics').dataset.visible`), "0", "Entity isolate hides block roots");
  await panel(); await input(aria("Entity action"), "duplicate"); await input(aria("Entity X"), "1");
  await click(aria("Preview entity action")); await pending();
  const isolatePreview = await candidate();
  const isolateCopy = isolatePreview.find(entity => !exactRotated.some(previous => previous.id === entity.id));
  assert.ok((await visible()).includes(isolateCopy.id), "New duplicate ghost is visible inside entity isolation");
  assert.deepEqual(await entities(), exactRotated);
  await click(aria("Cancel entity action"));
  assert.deepEqual(await visible(), ["side-pig"]);
  assert.deepEqual(await status(), beforeView);
  await screenshot("entity-viewport-isolated");
  await view("Exit isolate");
  await click(".object-view-menu > summary");
  await input(aria("Show Y min"), "1"); await input(aria("Show Y max"), "2"); await click(aria("Apply Y range"));
  assert.deepEqual(await visible(), [], "Y filtering uses entity anchor positions");
  await view("Clear Y range");
  assert.equal((await visible()).length, 3);
  assert.deepEqual(await status(), beforeView, "Entity visibility never changes revision/history");
  assert.deepEqual(await entities(), exactRotated);

  // Pointer placement keeps one ID through hover and click; no block grid snapping.
  await panel(); await click(aria("Place pig in viewport"));
  await click(aria("Editor Y view"));
  await hover([-2.25, 0, -1.75]); await pending();
  const firstPlacement = await candidate(), newId = firstPlacement.find(entity => !exactRotated.some(previous => previous.id === entity.id)).id;
  await hover([-1.25, 0, -1.75]); await pending();
  const secondPlacement = await candidate();
  assert.equal(secondPlacement.find(entity => !exactRotated.some(previous => previous.id === entity.id)).id, newId, "Hover keeps placement identity stable");
  assert.equal((await entities()).length, 3);
  await focus(); await key("Escape", "Escape");
  await until(`document.querySelector('${data}').dataset.entityPreview===''`);
  assert.deepEqual(await status(), beforeView);
  await panel(); await click(aria("Place pig in viewport"));
  const target = await hover([-2.25, 0, -1.75]); await pending();
  await press(target);
  const frozen = await candidate();
  await hover([-1.25, 0, -1.75]);
  assert.deepEqual(await candidate(), frozen, "Click freezes pointer placement until explicit confirmation");
  const created = frozen.find(entity => !exactRotated.some(previous => previous.id === entity.id));
  assert.ok(Math.abs(created.position[0] + 2.25) < 0.02);
  assert.ok(Math.abs(created.position[2] + 1.75) < 0.02);
  assert.ok(Math.abs(created.position[1]) < 0.001);
  await focus(); await key("Enter", "Enter");
  await until(`document.querySelector('${data}').dataset.entityPreview===''`);
  assert.deepEqual(await entities(), frozen, "Pointer placement commits its exact candidate");
  await click(aria("Undo editor")); assert.deepEqual(await entities(), exactRotated);
  await click(aria("Redo editor")); assert.deepEqual(await entities(), frozen);

  const downloads = join(directory, "entity-viewport-downloads"); await mkdir(downloads, { recursive: true });
  await command("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await click(aria("Export editor document"));
  let exported;
  for (let i = 0; i < 100; i++) { try { exported = JSON.parse(await readFile(join(downloads, `${fixture.name}.blockstage.json`), "utf8")); break; } catch { await delay(100); } }
  assert.ok(exported, "Download must produce full document JSON");
  assert.deepEqual(exported.objects, fixture.objects, "Entity edits retain every block root unchanged");
  assert.deepEqual(exported.entities, frozen);
  await click(".document-actions > button.primary"); await until(`!!document.querySelector('.document-saved')`);
  const origin = await evaluate("performance.timeOrigin"); await command("Page.reload"); await until(`performance.timeOrigin!==${origin}&&(${ready})`);
  assert.deepEqual(await entities(), frozen, "Save/reload preserves exact positions, yaw and IDs");
  await panel();
  await command("Emulation.setDeviceMetricsOverride", { width: 620, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('.entity-panel').scrollIntoView({block:'start'})`);
  await screenshot("entity-viewport-compact");
  assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`), false);
  await command("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  console.log(JSON.stringify({ entityViewportResult: "passed", checks: ["nearest eligible entity/block rays", "fractional modal preview/cancel/exact commit", "Q/E retire numeric previews without commit", "yaw delta and atomic Undo/Redo", "native fractional move and yaw gizmo exact commits", "confirmed modal HUD hidden", "hide/lock/isolate/Y-anchor policy without document edits", "new duplicate preview visible inside isolate", "pointer placement stable ID/freeze/Enter/Escape", "unchanged whole block roots and full JSON download", "Save/reload exact entity data", "620px panel"] }));
}
