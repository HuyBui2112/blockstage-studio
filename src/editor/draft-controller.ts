import type { DraftWrite } from "../io/draft-repository";
import type { DraftHead } from "../io/draft-storage";

export type DraftStatus = {
  phase: "idle" | "pending" | "writing" | "protected" | "error";
  revision?: number;
  error?: string;
};
type Options = {
  write: (snapshot: DraftWrite) => Promise<DraftHead>;
  onStatus: (status: DraftStatus) => void;
  delay?: number;
  maxDelay?: number;
};

/** One latest pending snapshot and one in-flight write. Preview/UI state never enters here. */
export function createDraftController({
  write,
  onStatus,
  delay = 750,
  maxDelay = 5000,
}: Options) {
  let latest: DraftWrite | null = null,
    pending: DraftWrite | null = null;
  let flight: Promise<void> | null = null,
    timer: ReturnType<typeof setTimeout> | undefined;
  let firstPending = 0,
    generation = 0,
    paused = false,
    stopped = false,
    blocked = false;
  let status: DraftStatus = { phase: "idle" };
  const key = (value: DraftWrite | null) =>
    value ? `${value.id}:${value.epoch}` : "";
  function publish(next: DraftStatus) {
    if (
      stopped ||
      (next.phase === status.phase &&
        next.revision === status.revision &&
        next.error === status.error)
    )
      return;
    status = next;
    onStatus(next);
  }
  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  function schedule() {
    clearTimer();
    if (!pending || flight || paused || stopped || blocked) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        void start();
      },
      Math.max(0, Math.min(delay, maxDelay - (Date.now() - firstPending))),
    );
  }
  function start(force = false): Promise<void> {
    if (flight) return flight;
    if (!pending || stopped || blocked || (paused && !force))
      return Promise.resolve();
    clearTimer();
    const job = pending,
      jobGeneration = generation;
    pending = null;
    firstPending = 0;
    publish({ phase: "writing", revision: job.revision });
    flight = Promise.resolve()
      .then(() => write(job))
      .then(() => {
        if (jobGeneration === generation && !pending)
          publish({ phase: "protected", revision: job.revision });
      })
      .catch((error) => {
        if (jobGeneration !== generation || stopped) return;
        blocked = true;
        pending ??= job;
        publish({
          phase: "error",
          revision: pending.revision,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        flight = null;
        if (pending && !blocked) {
          publish({ phase: "pending", revision: pending.revision });
          schedule();
        }
      });
    return flight;
  }
  function update(value: DraftWrite | null) {
    if (stopped) return;
    if (key(value) !== key(latest)) {
      generation++;
      blocked = false;
      pending = null;
      firstPending = 0;
      clearTimer();
    }
    if (!value) {
      latest = null;
      pending = null;
      clearTimer();
      publish({ phase: "idle" });
      return;
    }
    if (
      latest &&
      key(value) === key(latest) &&
      value.revision <= latest.revision
    )
      return;
    latest = value;
    if (!pending) firstPending = Date.now();
    pending = value;
    if (!blocked) publish({ phase: "pending", revision: value.revision });
    schedule();
  }
  return {
    update,
    async pause() {
      paused = true;
      clearTimer();
      await flight;
    },
    resume() {
      paused = false;
      schedule();
    },
    async flush() {
      clearTimer();
      await flight;
      while (pending && !blocked && !stopped) await start(true);
      return !pending && !blocked && !stopped;
    },
    retry() {
      blocked = false;
      if (pending) publish({ phase: "pending", revision: pending.revision });
      return this.flush();
    },
    adopt(value: DraftWrite) {
      update(value);
      clearTimer();
      pending = null;
      blocked = false;
      publish({ phase: "protected", revision: value.revision });
    },
    stop() {
      stopped = true;
      generation++;
      clearTimer();
      pending = null;
      latest = null;
    },
    get status() {
      return status;
    },
  };
}
export type DraftController = ReturnType<typeof createDraftController>;
