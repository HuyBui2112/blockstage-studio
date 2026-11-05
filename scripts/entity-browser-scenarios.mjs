import assert from "node:assert/strict";

export async function runEntityScenarios({
  command,
  evaluate,
  until,
  click,
  aria,
  input,
  key,
  screenshot,
}) {
  const diagnostic = ".editor-diagnostics";
  const ready = `document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`;
  const entities = () =>
    evaluate(
      `JSON.parse(document.querySelector('${diagnostic}').dataset.entities)`,
    );
  const selection = () =>
    evaluate(
      `JSON.parse(document.querySelector('${diagnostic}').dataset.entitySelection)`,
    );
  const blocks = () =>
    evaluate(`document.querySelector('${diagnostic}').dataset.snapshot`);
  const status = () =>
    evaluate(
      `(()=>{const d=document.querySelector('${diagnostic}').dataset;return {history:Number(d.history),revision:d.revision}})()`,
    );
  const pending = () =>
    until(`!!document.querySelector('[aria-label="Confirm entity action"]')`);
  const count = (n) =>
    until(
      `JSON.parse(document.querySelector('${diagnostic}').dataset.entities).length===${n}`,
    );
  async function openPanel() {
    if (!(await evaluate(`!!document.querySelector('.editor-inspector')`)))
      await click(aria("Toggle editor inspector"));
    if (
      !(await evaluate(`document.querySelector('details.entity-panel')?.open`))
    )
      await click("details.entity-panel > summary");
  }
  async function vector(values) {
    for (let i = 0; i < 3; i++)
      await input(aria(`Entity ${"XYZ"[i]}`), String(values[i]));
  }
  async function preview(action, values, yaw) {
    await input(aria("Entity action"), action);
    if (values) await vector(values);
    if (yaw !== undefined) await input(aria("Entity yaw"), String(yaw));
    await click(aria("Preview entity action"));
    await pending();
  }
  async function confirm() {
    const candidate = await evaluate(
      `JSON.parse(document.querySelector('${diagnostic}').dataset.entityPreview)`,
    );
    const before = await status();
    await click(aria("Confirm entity action"));
    await until(
      `!document.querySelector('[aria-label="Confirm entity action"]')`,
    );
    assert.deepEqual(
      await entities(),
      candidate,
      "Confirm applies exactly the displayed entity candidate",
    );
    assert.equal(
      (await status()).history,
      before.history + 1,
      "Each entity action is one undo step",
    );
    return candidate;
  }
  async function select(id, toggle = false) {
    const selector = aria(`Select entity ${id}`);
    if (!toggle) return click(selector);
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`,
    );
    const point = await evaluate(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await command("Input.dispatchMouseEvent", {
        type,
        ...point,
        modifiers: 8,
        ...(type === "mouseMoved"
          ? {}
          : {
              button: "left",
              buttons: type === "mousePressed" ? 1 : 0,
              clickCount: 1,
            }),
      });
  }
  async function createStone() {
    if (!(await evaluate(`!!document.querySelector('.editor-library')`)))
      await click(aria("Toggle editor library"));
    await input(aria("Search resources"), "minecraft:stone");
    await click('.resource-item[title="minecraft:stone"]');
    await click(aria("Primitive tools"));
    await click(aria("Build line"));
    for (const prefix of ["Primitive start", "Primitive end"])
      for (let i = 0; i < 3; i++)
        await input(aria(`${prefix} ${"XYZ"[i]}`), "0");
    await until(
      `document.querySelector('.primitive-action-diagnostics')?.dataset.valid==='true'`,
    );
    await click(aria("Confirm primitive action"));
    await until(`document.querySelector('${diagnostic}').dataset.blocks==='1'`);
  }
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1500,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click(aria("Architecture workspace"));
  await until(ready);
  await click(
    '.document-actions > button[title="Save current draft, then create a new document"]',
  );
  await until(
    `(${ready})&&document.querySelector('${diagnostic}').dataset.blocks==='0'`,
  );
  await count(0);
  await createStone();
  await openPanel();
  const initial = await status(),
    originalBlocks = await blocks();
  await preview("add", [1.25, 2.5, -3.75], 37.5);
  assert.deepEqual(
    await entities(),
    [],
    "Preview leaves committed entities unchanged",
  );
  assert.deepEqual(
    await status(),
    initial,
    "Preview leaves history and revision unchanged",
  );
  assert.ok(
    await evaluate(
      `(()=>{const r=document.querySelector('[aria-label="Confirm entity action"]').getBoundingClientRect(),p=document.querySelector('.editor-inspector').getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=p.left&&r.right<=p.right&&r.top>=0&&r.bottom<=innerHeight})()`,
    ),
    "Confirm remains visible inside the inspector after preview",
  );
  await screenshot("entities-add-preview-desktop");
  await click(aria("Cancel entity action"));
  assert.deepEqual(await entities(), []);
  assert.deepEqual(await status(), initial);
  await preview("add", [1.25, 2.5, -3.75], 37.5);
  await evaluate(`document.querySelector('.editor-workspace canvas').focus()`);
  await key("Escape", "Escape");
  await until(
    `!document.querySelector('[aria-label="Confirm entity action"]')`,
  );
  assert.deepEqual(
    await entities(),
    [],
    "Canvas Escape cancels an entity preview",
  );
  assert.deepEqual(
    await status(),
    initial,
    "Canvas Escape leaves committed history and revision unchanged",
  );
  await preview("add", [1.25, 2.5, -3.75], 37.5);
  await input(aria("Entity X"), "1.5");
  await until(
    `!document.querySelector('[aria-label="Confirm entity action"]')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('${diagnostic}').dataset.entityPreview`,
    ),
    "",
    "Changing an entity input retires the previous candidate",
  );
  assert.deepEqual(await entities(), []);
  assert.deepEqual(await status(), initial);
  await preview("add", [1.25, 2.5, -3.75], 37.5);
  const first = await confirm();
  assert.deepEqual(first[0].position, [1.25, 2.5, -3.75]);
  assert.equal(first[0].yaw, 37.5);
  assert.equal(first[0].type, "minecraft:pig");
  await click(aria("Undo editor"));
  await count(0);
  await click(aria("Redo editor"));
  await count(1);
  assert.deepEqual(await entities(), first);
  await preview("add", [-2.5, 0.125, 4.75], 112.25);
  const pair = await confirm();
  await click(".outliner-object > button");
  assert.equal(
    (await selection()).length,
    0,
    "Selecting a block clears entity selection",
  );
  assert.equal(
    (
      await evaluate(
        `JSON.parse(document.querySelector('${diagnostic}').dataset.selection)`,
      )
    ).length,
    1,
  );
  await select(pair[0].id);
  await select(pair[1].id, true);
  assert.deepEqual(
    new Set(await selection()),
    new Set(pair.map((entity) => entity.id)),
  );
  assert.deepEqual(
    await evaluate(
      `JSON.parse(document.querySelector('${diagnostic}').dataset.selection)`,
    ),
    [],
    "Entity selection is separate from block selection",
  );
  const beforeDuplicate = await entities();
  await preview("duplicate", [0.5, 0.25, -0.125]);
  assert.deepEqual(await entities(), beforeDuplicate);
  const duplicated = await confirm();
  assert.equal(duplicated.length, 4);
  assert.equal(new Set(duplicated.map((entity) => entity.id)).size, 4);
  assert.deepEqual(
    duplicated.slice(0, 2),
    pair,
    "Duplication retains both original roots",
  );
  for (let i = 0; i < 2; i++) {
    assert.ok(
      !pair.some((entity) => entity.id === duplicated[i + 2].id),
      "Duplicate IDs must be fresh",
    );
    assert.deepEqual(
      duplicated[i + 2].position,
      pair[i].position.map((value, axis) => value + [0.5, 0.25, -0.125][axis]),
    );
  }
  await click(aria("Undo editor"));
  await count(2);
  assert.deepEqual(await entities(), pair);
  await click(aria("Redo editor"));
  await count(4);
  assert.deepEqual(await entities(), duplicated);
  await select(duplicated[2].id);
  await select(duplicated[3].id, true);
  await preview("move", [0.125, -0.5, 0.25]);
  const moved = await confirm();
  assert.deepEqual(moved.slice(0, 2), pair);
  for (let i = 2; i < 4; i++)
    assert.deepEqual(
      moved[i].position,
      duplicated[i].position.map(
        (value, axis) => value + [0.125, -0.5, 0.25][axis],
      ),
      "Entity moves retain fractional coordinates",
    );
  await preview("yaw", undefined, 23.75);
  const rotated = await confirm();
  for (let i = 2; i < 4; i++) {
    assert.equal(rotated[i].yaw, 23.75);
    assert.deepEqual(rotated[i].position, moved[i].position);
  }
  await preview("remove");
  assert.deepEqual(await entities(), rotated);
  const removed = await confirm();
  assert.deepEqual(removed, pair);
  await click(aria("Undo editor"));
  await count(4);
  assert.deepEqual(await entities(), rotated);
  await click(aria("Redo editor"));
  await count(2);
  assert.deepEqual(await entities(), pair);
  assert.equal(
    await blocks(),
    originalBlocks,
    "Entity actions never mutate block content",
  );
  await input(aria("Document name"), "Entity browser verification");
  await click("details.entity-panel > summary");
  await click(".document-actions > button.primary");
  await until(`!!document.querySelector('.document-saved')`);
  const origin = await evaluate("performance.timeOrigin");
  await command("Page.reload");
  await until(`performance.timeOrigin!==${origin}&&(${ready})`);
  await count(2);
  assert.deepEqual(
    await entities(),
    pair,
    "Explicit Save/reload retains exact entity data and IDs",
  );
  await openPanel();
  await command("Emulation.setDeviceMetricsOverride", {
    width: 620,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(
    `document.querySelector('details.entity-panel').scrollIntoView({block:'start'})`,
  );
  await screenshot("entities-compact");
  assert.ok(
    await evaluate(
      `(()=>{const r=document.querySelector('.entity-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.width>180})()`,
    ),
    "Entity panel fits the compact viewport",
  );
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1500,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click(aria("3D Preview workspace"));
  await until(ready);
  assert.equal(
    await evaluate(`!!document.querySelector('details.entity-panel')`),
    false,
    "Preview workspace exposes no entity editing controls",
  );
  await click(aria("Architecture workspace"));
  await until(ready);
  assert.deepEqual(
    await entities(),
    pair,
    "Preview workspace leaves Architecture entities unchanged",
  );
  await click(aria("Component Editor workspace"));
  await until(ready);
  await click(
    '.document-actions > button[title="Save current draft, then create a new document"]',
  );
  await until(
    `(${ready})&&document.querySelector('${diagnostic}').dataset.blocks==='0'`,
  );
  await count(0);
  await createStone();
  await openPanel();
  await preview("add", [0.25, 1.5, -0.75], 15.5);
  const componentEntities = await confirm(),
    componentBlocks = await blocks(),
    componentStatus = await status();
  await click(".outliner-section > button.primary");
  await until(
    `document.querySelector('.editor-feedback')?.textContent.includes('blocks only')`,
  );
  assert.deepEqual(
    await entities(),
    componentEntities,
    "Rejected library publication preserves component entities",
  );
  assert.equal(
    await blocks(),
    componentBlocks,
    "Rejected library publication preserves component blocks",
  );
  assert.deepEqual(
    await status(),
    componentStatus,
    "Rejected library publication does not edit history",
  );
  await click(aria("Dismiss editor message"));
  await click(aria("Architecture workspace"));
  await until(ready);
  assert.deepEqual(
    await entities(),
    pair,
    "Component entity edits remain isolated from Architecture",
  );
  console.log(
    JSON.stringify({
      entityResult: "passed",
      checks: [
        "fractional pig position/yaw",
        "preview/button cancel/canvas Escape do not mutate history or committed data",
        "input changes retire preview",
        "Confirm remains visible in inspector",
        "atomic Undo/Redo",
        "independent entity selection",
        "two-root duplicate with fresh IDs",
        "fractional move and yaw",
        "delete Undo/Redo",
        "exact Save/reload",
        "read-only Preview workspace",
        "Component workspace isolation and blocks-only library publication guard",
        "desktop and 620px screenshots",
      ],
    }),
  );
}
