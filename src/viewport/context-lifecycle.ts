/** Register after WebGLRenderer so its internal context is restored first. */
export class ContextLifecycle {
  lost = false;
  private disposed = false;
  private canvas: EventTarget;
  private pause: () => void;
  private resume: () => void;

  constructor(
    canvas: EventTarget,
    pause: () => void,
    resume: () => void,
  ) {
    this.canvas = canvas;
    this.pause = pause;
    this.resume = resume;
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
  }

  private onLost = (event: Event) => {
    event.preventDefault();
    if (this.disposed || this.lost) return;
    this.lost = true;
    this.pause();
  };

  private onRestored = () => {
    if (this.disposed || !this.lost) return;
    this.lost = false;
    this.resume();
  };

  dispose() {
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
  }
}

