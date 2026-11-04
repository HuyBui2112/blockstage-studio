import type { WebGLRenderer } from "three";
import type { Vec3 } from "../core/schema";
import type { SceneUpdate } from "./block-scene";

/** Explicit local measurement only. CPU submission is not GPU execution/presentation. */
export class PerformanceProbe {
  frames = 0;
  readonly canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }
  frame(
    renderer: WebGLRenderer,
    started: number,
    revision: string | undefined,
    preview: boolean,
    selected: number,
    active: string | null,
    previewFirst: Vec3 | null,
    sceneUpdate?: SceneUpdate,
  ) {
    const { render, memory } = renderer.info;
    this.canvas.dataset.editorMeasurement = JSON.stringify({
      frame: ++this.frames,
      submittedAt: performance.now(),
      cpuSubmissionMs: performance.now() - started,
      revision: revision ?? null,
      preview,
      previewFirst,
      selected,
      active,
      drawCalls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      ...(sceneUpdate ? { sceneUpdate } : {}),
    });
  }
}
