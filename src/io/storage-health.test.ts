import { afterEach, describe, expect, it, vi } from "vitest";
import { createStorageHealth } from "./storage-health";

describe("storage health without document or storage mutations", () => {
  afterEach(() => vi.useRealTimers());
  it("probes independently and never requests persistence during read", async () => {
    const persist = vi.fn(async () => true);
    const controller = createStorageHealth({
      estimate: async () => ({ usage: 90, quota: 100 }),
      persisted: async () => false,
      persist,
    });
    expect(await controller.read()).toEqual({
      estimate: { status: "available", usage: 90, quota: 100, ratio: 0.9 },
      persistence: { status: "best-effort" },
      canRequest: true,
    });
    expect(persist).not.toHaveBeenCalled();
  });
  it("handles unsupported or partially supported APIs without assuming permission", async () => {
    expect(await createStorageHealth({}).read()).toEqual({
      estimate: { status: "unsupported" },
      persistence: { status: "unsupported" },
      canRequest: false,
    });
    expect(await createStorageHealth({}).request()).toEqual({
      status: "unsupported",
    });
    const partial = await createStorageHealth({
      estimate: async () => ({ usage: 0 }),
    }).read();
    expect(partial.estimate).toEqual({
      status: "available",
      usage: 0,
      quota: null,
      ratio: null,
    });
    expect(partial.persistence.status).toBe("unsupported");
  });
  it("does not invent quota/remaining space or clamp valid over-quota readings", async () => {
    const invalid = await createStorageHealth({
      estimate: async () => ({ usage: NaN, quota: -1 }),
    }).read();
    expect(invalid.estimate).toEqual({
      status: "available",
      usage: null,
      quota: null,
      ratio: null,
    });
    const zero = await createStorageHealth({
      estimate: async () => ({ usage: 123, quota: 0 }),
    }).read();
    expect(zero.estimate).toEqual({
      status: "available",
      usage: 123,
      quota: 0,
      ratio: null,
    });
    const exceeded = await createStorageHealth({
      estimate: async () => ({ usage: 120, quota: 100 }),
    }).read();
    expect(exceeded.estimate).toEqual({
      status: "available",
      usage: 120,
      quota: 100,
      ratio: 1.2,
    });
  });
  it("retains one successful probe when another rejects or throws synchronously", async () => {
    const health = await createStorageHealth({
      estimate: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
      persisted: async () => true,
    }).read();
    expect(health.estimate).toEqual({ status: "error", message: "Blocked" });
    expect(health.persistence.status).toBe("persistent");
    expect(
      (
        await createStorageHealth({
          persisted: async () => {
            throw new Error("Read denied");
          },
        }).read()
      ).persistence,
    ).toEqual({ status: "error", message: "Read denied" });
  });
  it("requests synchronously once per in-flight action and reports denial honestly", async () => {
    let finish!: (value: boolean) => void;
    const persist = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = createStorageHealth({ persist });
    const first = controller.request(),
      second = controller.request();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    finish(false);
    expect(await first).toEqual({ status: "denied" });
    const next = controller.request();
    expect(persist).toHaveBeenCalledTimes(2);
    finish(true);
    expect(await next).toEqual({ status: "granted" });
  });
  it("reports failed persistence without a false granted acknowledgement", async () => {
    expect(
      await createStorageHealth({
        persist: async () => {
          throw new DOMException("No quota", "QuotaExceededError");
        },
      }).request(),
    ).toEqual({ status: "error", message: "No quota" });
    expect(
      await createStorageHealth({
        persist: () => {
          throw new Error("Unavailable");
        },
      }).request(),
    ).toEqual({ status: "error", message: "Unavailable" });
  });
  it("bounds stalled browser APIs and clears timeout resources", async () => {
    vi.useFakeTimers();
    const controller = createStorageHealth(
      {
        estimate: () => new Promise(() => {}),
        persisted: async () => true,
        persist: () => new Promise(() => {}),
      },
      50,
    );
    const read = controller.read(),
      request = controller.request();
    await vi.advanceTimersByTimeAsync(50);
    expect((await read).estimate.status).toBe("error");
    expect((await request).status).toBe("error");
    expect(vi.getTimerCount()).toBe(0);
  });
});
