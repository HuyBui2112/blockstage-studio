export type StorageHealthApi = {
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
};
export type EstimateHealth =
  | {
      status: "available";
      usage: number | null;
      quota: number | null;
      ratio: number | null;
    }
  | { status: "unsupported" | "error"; message?: string };
export type PersistenceHealth = {
  status: "persistent" | "best-effort" | "unsupported" | "error";
  message?: string;
};
export type StorageHealth = {
  estimate: EstimateHealth;
  persistence: PersistenceHealth;
  canRequest: boolean;
};
export type PersistenceRequest = {
  status: "granted" | "denied" | "unsupported" | "error";
  message?: string;
};

export function browserStorageHealthApi(): StorageHealthApi {
  const manager =
    typeof navigator === "undefined" ? undefined : navigator.storage;
  return {
    estimate:
      typeof manager?.estimate === "function"
        ? () => manager.estimate()
        : undefined,
    persisted:
      typeof manager?.persisted === "function"
        ? () => manager.persisted()
        : undefined,
    persist:
      typeof manager?.persist === "function"
        ? () => manager.persist()
        : undefined,
  };
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function bounded<T>(promise: Promise<T>, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error("The browser did not respond. Refresh to try again.")),
      timeout,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
function bytes(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Read-only probe and explicit opt-in request. Never opens, writes, or deletes user data. */
export function createStorageHealth(
  api: StorageHealthApi = browserStorageHealthApi(),
  timeout = 10000,
) {
  async function estimate(): Promise<EstimateHealth> {
    if (!api.estimate) return { status: "unsupported" };
    try {
      const result = await bounded(api.estimate(), timeout);
      if (!result || typeof result !== "object")
        throw new Error("The browser returned an invalid storage estimate.");
      const usage = bytes(result.usage),
        quota = bytes(result.quota);
      return {
        status: "available",
        usage,
        quota,
        ratio:
          usage !== null && quota !== null && quota > 0 ? usage / quota : null,
      };
    } catch (error) {
      return { status: "error", message: message(error) };
    }
  }
  async function persistence(): Promise<PersistenceHealth> {
    if (!api.persisted) return { status: "unsupported" };
    try {
      const result = await bounded(api.persisted(), timeout);
      if (typeof result !== "boolean")
        throw new Error("The browser returned an invalid persistence status.");
      return { status: result ? "persistent" : "best-effort" };
    } catch (error) {
      return { status: "error", message: message(error) };
    }
  }
  let requesting: Promise<PersistenceRequest> | null = null;
  function request(): Promise<PersistenceRequest> {
    if (requesting) return requesting;
    if (!api.persist) return Promise.resolve({ status: "unsupported" });
    // Invoke directly during the click's user activation; do not await a probe first.
    let result: Promise<boolean>;
    try {
      result = api.persist();
    } catch (error) {
      return Promise.resolve({ status: "error", message: message(error) });
    }
    requesting = bounded(result, timeout)
      .then(
        (granted): PersistenceRequest => {
          if (typeof granted !== "boolean")
            return {
              status: "error",
              message: "The browser returned an invalid permission result.",
            };
          return { status: granted ? "granted" : "denied" };
        },
        (error): PersistenceRequest => ({
          status: "error",
          message: message(error),
        }),
      )
      .finally(() => {
        requesting = null;
      });
    return requesting;
  }
  return {
    async read(): Promise<StorageHealth> {
      const [estimateResult, persistenceResult] = await Promise.all([
        estimate(),
        persistence(),
      ]);
      return {
        estimate: estimateResult,
        persistence: persistenceResult,
        canRequest: !!api.persist,
      };
    },
    request,
  };
}
