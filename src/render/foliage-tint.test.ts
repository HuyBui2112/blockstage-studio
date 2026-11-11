import { afterEach, describe, expect, it, vi } from "vitest";
import { Texture } from "three";
import { FOLIAGE_COLORMAP_MAX_BYTES, FOLIAGE_PREVIEW_SAMPLE, inspectFoliageColormap, PreviewFoliageTint } from "./foliage-tint";

class TestImage extends EventTarget {
  static instances: TestImage[] = [];
  src = "";
  naturalWidth = 256;
  naturalHeight = 256;
  constructor() { super(); TestImage.instances.push(this); }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
}
function header(width = 256, height = 256): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
function nativeStubs(pixel = [17, 51, 85, 255]) {
  vi.stubGlobal("Image", TestImage);
  const sample = vi.fn(() => ({ data: new Uint8ClampedArray(pixel) }));
  const draw = vi.fn();
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw, getImageData: sample }) };
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  return { sample, draw, canvas };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); TestImage.instances = []; });

describe("bounded effective-pack foliage tint", () => {
  it("bounds the native decode before allocating an image and honors typed-array offsets", () => {
    expect(inspectFoliageColormap(undefined).valid).toBe(false);
    expect(inspectFoliageColormap(new Uint8Array(FOLIAGE_COLORMAP_MAX_BYTES + 1)).valid).toBe(false);
    expect(inspectFoliageColormap(new Uint8Array([137])).valid).toBe(false);
    expect(inspectFoliageColormap(header(512, 256)).valid).toBe(false);
    expect(inspectFoliageColormap(header(256, 1)).valid).toBe(false);
    const bytes = new Uint8Array(80); bytes.set(header(), 8);
    expect(inspectFoliageColormap(bytes.subarray(8, 41))).toEqual({ valid: true });
    const changed = header(); changed[12] = 0;
    expect(inspectFoliageColormap(changed).valid).toBe(false);
    nativeStubs(); const done = vi.fn(), tint = new PreviewFoliageTint(done);
    tint.load(header(1, 1));
    expect(TestImage.instances).toHaveLength(0);
    expect(tint.failed).toBe(true); expect(tint.pending).toBe(false); expect(tint.color).toBe("#ffffff");
    expect(done).toHaveBeenCalledOnce();
  });
  it("samples the verified Plains pixel, publishes RGB only after decode and releases owned resources", () => {
    const { sample, draw, canvas } = nativeStubs();
    const revoke = vi.spyOn(URL, "revokeObjectURL"), dispose = vi.spyOn(Texture.prototype, "dispose");
    const done = vi.fn(), tint = new PreviewFoliageTint(done);
    tint.load(header());
    expect(tint.pending).toBe(true); expect(tint.color).toBe("#ffffff"); expect(done).not.toHaveBeenCalled();
    TestImage.instances[0].dispatchEvent(new Event("load"));
    expect(FOLIAGE_PREVIEW_SAMPLE).toEqual({ x: 50, y: 173 });
    expect(sample).toHaveBeenCalledExactlyOnceWith(50, 173, 1, 1);
    expect(draw).toHaveBeenCalledExactlyOnceWith(TestImage.instances[0], 0, 0);
    expect(canvas.width).toBe(256); expect(canvas.height).toBe(256);
    expect(tint.color).toBe("#113355"); expect(tint.pending).toBe(false); expect(tint.failed).toBe(false);
    expect(done).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(dispose).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledOnce();
    tint.clear(); expect(dispose).toHaveBeenCalledOnce(); expect(tint.color).toBe("#ffffff");
  });
  it("cancels obsolete decodes and never lets their events change replacement resources", () => {
    nativeStubs();
    const revoke = vi.spyOn(URL, "revokeObjectURL"), dispose = vi.spyOn(Texture.prototype, "dispose");
    const done = vi.fn(), tint = new PreviewFoliageTint(done);
    tint.load(header()); const old = TestImage.instances[0];
    tint.load(header()); const replacement = TestImage.instances[1];
    expect(old.src).toBe("");
    old.dispatchEvent(new Event("load")); old.dispatchEvent(new Event("error"));
    expect(done).not.toHaveBeenCalled(); expect(tint.pending).toBe(true);
    replacement.dispatchEvent(new Event("load"));
    expect(done).toHaveBeenCalledOnce(); expect(tint.color).toBe("#113355");
    expect(revoke).toHaveBeenCalledTimes(2); expect(dispose).toHaveBeenCalledTimes(2);
    tint.load(header()); const abandoned = TestImage.instances[2]; tint.clear();
    abandoned.dispatchEvent(new Event("load"));
    expect(done).toHaveBeenCalledOnce(); expect(tint.pending).toBe(false); expect(tint.failed).toBe(false);
    expect(revoke).toHaveBeenCalledTimes(3); expect(dispose).toHaveBeenCalledTimes(3);
  });
  it("keeps missing, native decode failure and non-opaque samples visibly untinted", () => {
    nativeStubs([255, 0, 0, 0]);
    const done = vi.fn(), tint = new PreviewFoliageTint(done);
    tint.load(undefined);
    expect(tint.failed).toBe(true); expect(done.mock.calls[0][0]).toContain("Missing");
    tint.load(header()); TestImage.instances[0].dispatchEvent(new Event("error"));
    expect(tint.failed).toBe(true); expect(tint.pending).toBe(false); expect(done.mock.calls[1][0]).toContain("decode");
    tint.load(header()); TestImage.instances[1].dispatchEvent(new Event("load"));
    expect(tint.failed).toBe(true); expect(tint.color).toBe("#ffffff"); expect(done.mock.calls[2][0]).toContain("opaque");
  });
  it("fails closed when decoded dimensions differ or canvas pixel access is unavailable", () => {
    nativeStubs();
    const done = vi.fn(), tint = new PreviewFoliageTint(done);
    tint.load(header()); TestImage.instances[0].naturalWidth = 1;
    TestImage.instances[0].dispatchEvent(new Event("load"));
    expect(tint.failed).toBe(true); expect(done.mock.calls[0][0]).toContain("dimensions");
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
    tint.load(header()); TestImage.instances[1].dispatchEvent(new Event("load"));
    expect(tint.failed).toBe(true); expect(tint.color).toBe("#ffffff");
    expect(done.mock.calls[1][0]).toContain("unavailable");
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ drawImage: () => { throw new Error("tainted"); } }) }) });
    tint.load(header()); TestImage.instances[2].dispatchEvent(new Event("load"));
    expect(tint.failed).toBe(true); expect(done.mock.calls[2][0]).toBe("tainted");
  });
});
