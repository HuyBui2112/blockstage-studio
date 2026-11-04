import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewQueue } from "./preview-queue";

describe("PreviewQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("creates no timers until scheduled and coalesces a burst to its latest value", () => {
    const deliver = vi.fn();
    const queue = new PreviewQueue<number>(deliver);
    expect(vi.getTimerCount()).toBe(0);
    queue.schedule(1);
    vi.advanceTimersByTime(50);
    queue.schedule(2);
    vi.advanceTimersByTime(74);
    expect(deliver).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deliver.mock.calls).toEqual([[2]]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(500);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("delivers the latest input at 200ms despite continuous changes", () => {
    const deliver = vi.fn();
    const queue = new PreviewQueue<number>(deliver);
    queue.schedule(0);
    for (let value = 1; value <= 3; value++) {
      vi.advanceTimersByTime(50);
      queue.schedule(value);
    }
    vi.advanceTimersByTime(49);
    expect(deliver).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deliver.mock.calls).toEqual([[3]]);
    expect(vi.getTimerCount()).toBe(0);
    queue.schedule(4);
    vi.advanceTimersByTime(75);
    expect(deliver.mock.calls).toEqual([[3], [4]]);
  });

  it("cancels without delivery and can start another full window", () => {
    const deliver = vi.fn();
    const queue = new PreviewQueue<number>(deliver);
    queue.schedule(1);
    vi.advanceTimersByTime(50);
    queue.cancel();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(500);
    expect(deliver).not.toHaveBeenCalled();
    queue.schedule(2);
    vi.advanceTimersByTime(74);
    expect(deliver).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deliver.mock.calls).toEqual([[2]]);
  });

  it("disposes without delivery and ignores all subsequent schedules", () => {
    const deliver = vi.fn();
    const queue = new PreviewQueue<number>(deliver);
    queue.schedule(1);
    queue.dispose();
    queue.dispose();
    queue.schedule(2);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(500);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("preserves reentrant scheduling as a new window after maximum delivery", () => {
    const deliver = vi.fn((value: number) => {
      if (value === 3) queue.schedule(4);
    });
    const queue = new PreviewQueue<number>(deliver);
    queue.schedule(0);
    for (let value = 1; value <= 3; value++) {
      vi.advanceTimersByTime(50);
      queue.schedule(value);
    }
    vi.advanceTimersByTime(50);
    expect(deliver.mock.calls).toEqual([[3]]);
    expect(vi.getTimerCount()).toBe(2);
    vi.advanceTimersByTime(74);
    expect(deliver).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(deliver.mock.calls).toEqual([[3], [4]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("supports a custom idle delay and an undefined value", () => {
    const deliver = vi.fn();
    const queue = new PreviewQueue<undefined>(deliver, 25);
    queue.schedule(undefined);
    vi.advanceTimersByTime(24);
    expect(deliver).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deliver.mock.calls).toEqual([[undefined]]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("PreviewQueue animation frames", () => {
  let now: number;
  let nextId: number;
  let frames: Map<number, FrameRequestCallback>;
  let clock: ReturnType<typeof vi.spyOn>;

  function frameAt(time: number) {
    now = time;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(time);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    nextId = 0;
    frames = new Map();
    clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextId, callback);
      return nextId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("uses one frame and no timers, delivers the latest idle value, then stops", () => {
    const deliver = vi.fn();
    const queue = new PreviewQueue<number>(deliver);
    expect(clock).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    queue.schedule(1);
    now = 20;
    queue.schedule(2);
    expect(frames.size).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    frameAt(94);
    expect(deliver).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    frameAt(95);
    expect(deliver.mock.calls).toEqual([[2]]);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    clock.mockClear();
    frameAt(500);
    expect(clock).not.toHaveBeenCalled();
  });

  it("keeps the first maximum deadline during continuous input", () => {
    const deliver = vi.fn();
    const queue = new PreviewQueue<number>(deliver);
    queue.schedule(0);
    for (let value = 1; value <= 3; value++) {
      frameAt(value * 50);
      queue.schedule(value);
    }
    frameAt(199);
    expect(deliver).not.toHaveBeenCalled();
    frameAt(200);
    expect(deliver.mock.calls).toEqual([[3]]);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels without delivery, resets the window, and disposes permanently", () => {
    const deliver = vi.fn();
    const queue = new PreviewQueue<number>(deliver);
    queue.schedule(1);
    frameAt(50);
    queue.cancel();
    expect(frames.size).toBe(0);
    frameAt(500);
    expect(deliver).not.toHaveBeenCalled();
    queue.schedule(2);
    frameAt(574);
    expect(deliver).not.toHaveBeenCalled();
    frameAt(575);
    expect(deliver.mock.calls).toEqual([[2]]);
    queue.schedule(3);
    queue.dispose();
    queue.schedule(4);
    expect(frames.size).toBe(0);
    frameAt(1000);
    expect(deliver.mock.calls).toEqual([[2]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves reentrant scheduling as a fresh frame window", () => {
    const deliver = vi.fn((value: number) => {
      if (value === 1) queue.schedule(2);
    });
    const queue = new PreviewQueue<number>(deliver);
    queue.schedule(1);
    frameAt(75);
    expect(deliver.mock.calls).toEqual([[1]]);
    expect(frames.size).toBe(1);
    frameAt(149);
    expect(deliver).toHaveBeenCalledTimes(1);
    frameAt(150);
    expect(deliver.mock.calls).toEqual([[1], [2]]);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
