import { afterEach, describe, expect, it, vi } from "vitest";
import { TextureImages } from "./texture-image";

class TestImage extends EventTarget {
  static instances: TestImage[] = [];
  src = "";
  constructor() {
    super();
    TestImage.instances.push(this);
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  TestImage.instances = [];
});

describe("texture image lifetime", () => {
  it("cancels obsolete requests without reporting decode errors or updating disposed textures", () => {
    vi.stubGlobal("Image", TestImage);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const loader = new TextureImages(),
      loaded = vi.fn(),
      failed = vi.fn();
    const obsolete = loader.load(new Uint8Array([1]), loaded, failed);
    const oldImage = TestImage.instances[0];
    loader.clear();
    obsolete.dispose();
    oldImage.dispatchEvent(new Event("error"));
    oldImage.dispatchEvent(new Event("load"));
    expect(oldImage.src).toBe("");
    expect(obsolete.version).toBe(0);
    expect(loaded).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("loads the replacement after cancellation and releases its URL exactly once", () => {
    vi.stubGlobal("Image", TestImage);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const loader = new TextureImages(),
      loaded = vi.fn(),
      failed = vi.fn();
    loader.load(new Uint8Array([1]), loaded, failed);
    loader.clear();
    const texture = loader.load(new Uint8Array([2]), loaded, failed);
    const image = TestImage.instances[1];
    image.dispatchEvent(new Event("load"));
    loader.clear();
    expect(texture.image).toBe(image);
    expect(texture.version).toBe(1);
    expect(loaded).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledTimes(2);
    texture.dispose();
  });

  it("still reports a real decode failure in the active resource stack", () => {
    vi.stubGlobal("Image", TestImage);
    const loader = new TextureImages(),
      loaded = vi.fn(),
      failed = vi.fn();
    const texture = loader.load(new Uint8Array([0]), loaded, failed);
    TestImage.instances[0].dispatchEvent(new Event("error"));
    loader.clear();
    expect(failed).toHaveBeenCalledOnce();
    expect(loaded).not.toHaveBeenCalled();
    expect(texture.version).toBe(0);
    texture.dispose();
  });
});
