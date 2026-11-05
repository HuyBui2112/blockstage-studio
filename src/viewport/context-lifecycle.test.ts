import { describe, expect, it, vi } from "vitest";
import { ContextLifecycle } from "./context-lifecycle";

describe("ContextLifecycle", () => {
  it("permits recovery, pauses once and resumes after the renderer listener", () => {
    const canvas = new EventTarget();
    const order: string[] = [];
    canvas.addEventListener("webglcontextrestored", () => order.push("renderer"));
    const pause = vi.fn();
    const lifecycle = new ContextLifecycle(canvas, pause, () => order.push("draw"));
    const loss = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(loss);
    canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(loss.defaultPrevented).toBe(true);
    expect(lifecycle.lost).toBe(true);
    expect(pause).toHaveBeenCalledTimes(1);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(lifecycle.lost).toBe(false);
    expect(order).toEqual(["renderer", "draw"]);
    canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("ignores unrelated restore and detaches on disposal during loss", () => {
    const canvas = new EventTarget();
    const resume = vi.fn();
    const pause = vi.fn();
    const lifecycle = new ContextLifecycle(canvas, pause, resume);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(resume).not.toHaveBeenCalled();
    canvas.dispatchEvent(new Event("webglcontextlost"));
    lifecycle.dispose();
    lifecycle.dispose();
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(resume).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
