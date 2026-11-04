import { describe, expect, it } from "vitest";
import { keyViewCommand, viewDirection } from "./view-commands";

describe("viewport navigation commands", () => {
  it("maps opposite numpad views with Ctrl without losing Minecraft Y-up", () => {
    for (const [code, positive, negative] of [
      ["Numpad1", "front", "back"],
      ["Numpad3", "right", "left"],
      ["Numpad7", "top", "bottom"],
    ] as const) {
      expect(keyViewCommand(code, false, false)).toBe(positive);
      expect(keyViewCommand(code, true, false)).toBe(negative);
      const a = viewDirection(positive)!,
        b = viewDirection(negative)!;
      expect(a.map((value, index) => value + b[index])).toEqual([0, 0, 0]);
    }
    expect(viewDirection("top")![1]).toBe(1);
    expect(viewDirection("right")).toEqual([1, 0, 0]);
    expect(viewDirection("front")).toEqual([0, 0, 1]);
  });

  it("routes frame/projection/fly and navigation keys without claiming typing keys", () => {
    expect(keyViewCommand("Home", false, false)).toBe("frame-all");
    expect(keyViewCommand("KeyF", false, false)).toBe("frame-selected");
    expect(keyViewCommand("NumpadDecimal", false, false)).toBe(
      "frame-selected",
    );
    expect(keyViewCommand("Numpad5", false, false)).toBe("projection");
    expect(keyViewCommand("Backquote", false, false)).toBeNull();
    expect(keyViewCommand("Backquote", false, true)).toBe("fly");
    expect(keyViewCommand("KeyW", false, false)).toBeNull();
    expect(keyViewCommand("Numpad4", false, false)).toBe("orbit-left");
    expect(keyViewCommand("Numpad6", false, false)).toBe("orbit-right");
    expect(keyViewCommand("Numpad8", false, false)).toBe("orbit-up");
    expect(keyViewCommand("Numpad2", false, false)).toBe("orbit-down");
    expect(keyViewCommand("NumpadAdd", false, false)).toBe("zoom-in");
    expect(keyViewCommand("NumpadSubtract", false, false)).toBe("zoom-out");
  });
});
