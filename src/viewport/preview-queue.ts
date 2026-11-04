/** Latest-value delivery at the next frame after idle or maximum scheduling deadlines. */
export class PreviewQueue<T> {
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private maximumTimer: ReturnType<typeof setTimeout> | undefined;
  private frame: number | undefined;
  private idleDeadline = 0;
  private maximumDeadline = 0;
  private pending: { value: T } | undefined;
  private disposed = false;
  private readonly deliver: (value: T) => void;
  private readonly delayMs: number;
  private readonly requestFrame: typeof requestAnimationFrame | undefined;
  private readonly cancelFrame: typeof cancelAnimationFrame | undefined;

  constructor(deliver: (value: T) => void, delayMs = 75) {
    this.deliver = deliver;
    this.delayMs = delayMs;
    if (
      typeof globalThis.requestAnimationFrame === "function" &&
      typeof globalThis.cancelAnimationFrame === "function"
    ) {
      this.requestFrame = globalThis.requestAnimationFrame.bind(globalThis);
      this.cancelFrame = globalThis.cancelAnimationFrame.bind(globalThis);
    }
  }

  schedule(value: T): void {
    if (this.disposed) return;
    const first = this.pending === undefined;
    this.pending = { value };
    if (this.requestFrame) {
      const now = performance.now();
      this.idleDeadline = now + this.delayMs;
      if (first) this.maximumDeadline = now + 200;
      if (this.frame === undefined)
        this.frame = this.requestFrame(this.onFrame);
      return;
    }
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.deliverPending(), this.delayMs);
    if (this.maximumTimer === undefined) {
      this.maximumTimer = setTimeout(() => this.deliverPending(), 200);
    }
  }

  cancel(): void {
    if (this.frame !== undefined) this.cancelFrame?.(this.frame);
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    if (this.maximumTimer !== undefined) clearTimeout(this.maximumTimer);
    this.frame = undefined;
    this.idleTimer = undefined;
    this.maximumTimer = undefined;
    this.pending = undefined;
    this.idleDeadline = 0;
    this.maximumDeadline = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private readonly onFrame = (): void => {
    this.frame = undefined;
    if (this.pending === undefined || this.disposed) return;
    if (performance.now() >= Math.min(this.idleDeadline, this.maximumDeadline))
      this.deliverPending();
    else this.frame = this.requestFrame!(this.onFrame);
  };

  private deliverPending(): void {
    const pending = this.pending;
    // Clear before calling user code so reentrant scheduling owns a fresh window.
    this.cancel();
    if (pending !== undefined && !this.disposed) this.deliver(pending.value);
  }
}
