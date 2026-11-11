import type { Texture } from "three";
import { TextureImages } from "./texture-image";

export const FOLIAGE_COLORMAP = "assets/minecraft/textures/colormap/foliage.png";
export const FOLIAGE_COLORMAP_MAX_BYTES = 1024 * 1024;
export const FOLIAGE_PREVIEW_LABEL = "Plains · studio light";
// Java 26.2 ColorMapColorUtil.get: trunc((1-T)*255), trunc((1-H*T)*255).
// This is one explicit preview environment, never a document/world biome.
export const FOLIAGE_PREVIEW_SAMPLE = Object.freeze({ x: 50, y: 173 });

/** Header gate only. Native image decoding and sampled alpha are checked later. */
export function inspectFoliageColormap(bytes: Uint8Array | undefined): { valid: boolean; reason?: string } {
  if (!bytes) return { valid: false, reason: `Missing foliage colormap: ${FOLIAGE_COLORMAP}` };
  if (bytes.byteLength < 33 || bytes.byteLength > FOLIAGE_COLORMAP_MAX_BYTES)
    return { valid: false, reason: "Foliage colormap must be a 256×256 PNG of at most 1 MiB." };
  const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
  if (!signature.every((value, index) => bytes[index] === value))
    return { valid: false, reason: "Foliage colormap has an invalid PNG header." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(16) !== 256 || view.getUint32(20) !== 256)
    return { valid: false, reason: "Foliage colormap must have dimensions 256×256." };
  return { valid: true };
}

/** Owns one native decode and its temporary texture. No timers, frame loop or
 * global cache. Resource owners clear this before publishing a different stack. */
export class PreviewFoliageTint {
  private images = new TextureImages();
  private texture: Texture | null = null;
  private generation = 0;
  private value = "#ffffff";
  private loading = false;
  private failure = false;
  private onChange: (error?: string) => void;

  constructor(onChange: (error?: string) => void) { this.onChange = onChange; }
  get color(): string { return this.value; }
  get pending(): boolean { return this.loading; }
  get failed(): boolean { return this.failure; }

  load(bytes: Uint8Array | undefined): void {
    this.clear();
    const version = this.generation;
    const inspection = inspectFoliageColormap(bytes);
    if (!inspection.valid) {
      this.failure = true;
      this.onChange(inspection.reason);
      return;
    }
    this.loading = true;
    const finish = (error?: string) => {
      if (version !== this.generation) return;
      this.texture?.dispose();
      this.texture = null;
      this.loading = false;
      this.failure = !!error;
      this.onChange(error);
    };
    try {
      this.texture = this.images.load(bytes!, () => {
        if (version !== this.generation) return;
        let failure: string | undefined;
        try {
          const image = this.texture?.image as HTMLImageElement | undefined;
          if (!image || image.naturalWidth !== 256 || image.naturalHeight !== 256)
            throw new Error("Decoded foliage colormap must have dimensions 256×256.");
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 256;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Foliage colormap pixel sampling is unavailable.");
          context.drawImage(image, 0, 0);
          const { x, y } = FOLIAGE_PREVIEW_SAMPLE;
          const pixel = context.getImageData(x, y, 1, 1).data;
          if (pixel.length !== 4 || pixel[3] !== 255)
            throw new Error("Foliage colormap preview sample must be opaque.");
          this.value = "#" + Array.from(pixel.slice(0, 3), (value) => value.toString(16).padStart(2, "0")).join("");
        } catch (error) {
          failure = error instanceof Error ? error.message : "Foliage colormap pixel sampling failed.";
        }
        finish(failure);
      }, () => finish("Could not decode the foliage colormap PNG."));
    } catch (error) {
      finish(error instanceof Error ? error.message : "Could not load the foliage colormap.");
    }
  }

  clear(): void {
    this.generation++;
    this.images.clear();
    this.texture?.dispose();
    this.texture = null;
    this.value = "#ffffff";
    this.loading = this.failure = false;
  }
}
