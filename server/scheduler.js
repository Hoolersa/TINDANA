'use strict';

/**
 * Real-time scheduler: thin wrapper over Date.now/setTimeout/clearTimeout.
 * Used in production.
 */
function createRealScheduler() {
  return {
    now: () => Date.now(),
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (handle) => clearTimeout(handle),
  };
}

/**
 * Fake, manually-advanced scheduler for deterministic tests.
 * Call `.advance(ms)` to move the clock forward and fire any due callbacks,
 * in the order their deadlines elapse (ties fire in schedule order).
 */
function createFakeScheduler(startTime = 0) {
  let currentTime = startTime;
  let nextHandle = 1;
  const pending = new Map(); // handle -> { fireAt, fn, cancelled }

  return {
    now: () => currentTime,
    schedule(fn, ms) {
      const handle = nextHandle++;
      pending.set(handle, { fireAt: currentTime + ms, fn, cancelled: false });
      return handle;
    },
    cancel(handle) {
      const entry = pending.get(handle);
      if (entry) entry.cancelled = true;
    },
    /** Advance the fake clock by `ms`, firing due callbacks along the way. */
    advance(ms) {
      const target = currentTime + ms;
      while (true) {
        let nextEntry = null;
        let nextHandleId = null;
        for (const [handle, entry] of pending) {
          if (entry.cancelled) {
            pending.delete(handle);
            continue;
          }
          if (entry.fireAt <= target) {
            if (nextEntry === null || entry.fireAt < nextEntry.fireAt) {
              nextEntry = entry;
              nextHandleId = handle;
            }
          }
        }
        if (nextEntry === null) break;
        pending.delete(nextHandleId);
        currentTime = nextEntry.fireAt;
        if (!nextEntry.cancelled) nextEntry.fn();
      }
      currentTime = target;
    },
  };
}

module.exports = { createRealScheduler, createFakeScheduler };
