import assert from "node:assert/strict";

/** Native graphics fault injection only; no document or resource API replacement. */
export async function runContextScenarios({ evaluate, until }) {
  const canvas = ".editor-workspace canvas";
  await until(`!!document.querySelector('${canvas}')`);
  const committed = () => evaluate(`(()=>{
    const d=document.querySelector('.editor-diagnostics').dataset;
    return {snapshot:d.snapshot,entities:d.entities,history:d.history,revision:d.revision};
  })()`);
  const before = await committed();
  const supported = await evaluate(`(()=>{
    const canvas=document.querySelector('${canvas}');
    const gl=canvas.getContext('webgl2');
    const extension=gl?.getExtension('WEBGL_lose_context');
    if(!extension)return false;
    window.__contextRecoveryProof={extension,canvas,restoredPixels:null,lostPixels:null};
    canvas.addEventListener('webglcontextrestored',()=>{
      // Registered after the controller: its draw RAF runs before this capture.
      requestAnimationFrame(()=>{
        window.__contextRecoveryProof.restoredPixels=canvas.toDataURL();
      });
    },{once:true});
    extension.loseContext();
    return true;
  })()`);
  if (!supported) return { status: "skipped", reason: "WEBGL_lose_context unavailable" };
  try {
    await until(`document.querySelector('${canvas}').dataset.contextStatus==='lost'`);
    assert.deepEqual(await committed(), before, "Context loss must retain committed data/history/revision");
    await evaluate(`(()=>{
      const proof=window.__contextRecoveryProof;
      proof.lostPixels=proof.canvas.toDataURL();
      proof.extension.restoreContext();
    })()`);
    await until(`document.querySelector('${canvas}').dataset.contextStatus==='ready'&&!!window.__contextRecoveryProof.restoredPixels`);
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert.deepEqual(await committed(), before, "Context restoration must retain committed data/history/revision");
    const pixels = await evaluate(`(()=>{
      const p=window.__contextRecoveryProof;
      return {changed:p.restoredPixels!==p.lostPixels,restoredBytes:p.restoredPixels.length,lostBytes:p.lostPixels.length};
    })()`);
    assert.ok(pixels.changed, "Restored draw must differ from the lost-context blank canvas");
    return { status: "passed", ...pixels };
  } finally {
    await evaluate(`delete window.__contextRecoveryProof`);
  }
}
