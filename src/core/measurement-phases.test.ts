import { afterEach, describe, expect, it, vi } from "vitest";
import { enableMeasurementPhases, measurePhase } from "./measurement-phases";
type Snapshot = {
  events: { sequence: number; name: string; duration: number }[];
  dropped: number;
};
const read = () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "__blockstagePhaseRead",
  );
  if (!descriptor) throw new Error("Measurement collector is not enabled");
  return (descriptor.value as () => Snapshot)();
};
const owners: (() => void)[] = [];
afterEach(() => {
  owners.splice(0).forEach((release) => release());
  vi.restoreAllMocks();
});
describe("bounded opt-in phase timing", () => {
  it("does not read a clock or expose telemetry when disabled", () => {
    const clock = vi.spyOn(performance, "now");
    expect(measurePhase("normal", () => 42)).toBe(42);
    expect(clock).not.toHaveBeenCalled();
    expect(Object.hasOwn(globalThis, "__blockstagePhaseRead")).toBe(false);
  });
  it("preserves return/errors and retains inclusive nested spans until the last owner releases", () => {
    const first = enableMeasurementPhases(),
      second = enableMeasurementPhases();
    owners.push(first, second);
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(7);
    expect(measurePhase("outer", () => measurePhase("inner", () => 9))).toBe(9);
    expect(read().events).toMatchObject([
      { name: "inner", duration: 3 },
      { name: "outer", duration: 6 },
    ]);
    expect(() =>
      measurePhase("failure", () => {
        throw new Error("unchanged");
      }),
    ).toThrow("unchanged");
    expect(read().events.at(-1)?.name).toBe("failure");
    first();
    first();
    expect(read().events.length).toBe(3);
    second();
    expect(Object.hasOwn(globalThis, "__blockstagePhaseRead")).toBe(false);
  });
  it("bounds retained events and reports truncation", () => {
    owners.push(enableMeasurementPhases());
    for (let i = 0; i < 4100; i++) measurePhase("bounded", () => i);
    expect(read().events.length).toBe(4096);
    expect(read().dropped).toBe(4);
    expect(read().events[0].sequence).toBe(5);
  });
});
