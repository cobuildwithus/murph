import { createHash } from "node:crypto";

// Below the signed caller's default 30-second HTTP timeout, leaving room for
// its cold start and network time and for the bounded settling below.
export const HOSTED_RECOVERY_BUDGET_MS = 22_000;
// A sweep joins started work after cancellation; these bound how far past the
// deadline a started transaction can run. Never set maxWait here: a start that
// outlives a maxWait below the pool checkout limit returns its connection to
// the pool inside an open transaction.
export const HOSTED_RECOVERY_LOCK_TIMEOUT_MS = 1_000;
export const HOSTED_RECOVERY_TRANSACTION_OPTIONS = { timeout: 3_000 } as const;

export function abortAtHostedRecoveryDeadline(deadlineMs: number): AbortSignal {
  const controller = new AbortController();
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) controller.abort();
  else setTimeout(() => controller.abort(), remainingMs).unref();
  return controller.signal;
}

export const HOSTED_RECOVERY_JITTER_WINDOW_MS = 5_000;
const RECOVERY_CONCURRENCY = 5;

// Only the bounded recovery sweeps use this executor. Direct ingress and
// runtime-owned deadlines never enter it. Waiting starts before any item work,
// so it cannot retain a transaction or a pooled database connection.
export async function runHostedRecoveryBatch<T extends { userId: string }>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
  jitter: boolean,
  stop: AbortSignal,
): Promise<number> {
  const startedAt = performance.now();
  const pending = items.map((item) => ({
    item,
    offsetMs: jitter
      ? createHash("sha256").update(item.userId).digest().readUInt32BE(0)
        % (HOSTED_RECOVERY_JITTER_WINDOW_MS + 1)
      : 0,
  })).sort((left, right) => left.offsetMs - right.offsetMs);
  let nextIndex = 0;
  let started = 0;

  // Order by eligibility before taking slots: a late offset must not hide an
  // earlier one behind it. Offsets are relative to the batch, not cumulative.
  const failures: unknown[] = [];
  await Promise.all(Array.from({
    length: Math.min(RECOVERY_CONCURRENCY, pending.length),
  }, async () => {
    try {
      while (!stop.aborted && nextIndex < pending.length) {
        const { item, offsetMs } = pending[nextIndex++];
        const remainingMs = offsetMs - (performance.now() - startedAt);
        if (remainingMs > 0) {
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timer);
              stop.removeEventListener("abort", finish);
              resolve();
            };
            const timer = setTimeout(finish, remainingMs);
            stop.addEventListener("abort", finish, { once: true });
          });
        }
        if (stop.aborted) return;
        started++;
        await worker(item);
      }
    } catch (error) {
      failures.push(error);
    }
  }));
  // Drain owned siblings before reporting an unexpected failure. Ordinary
  // per-item recovery failures are accounted for by the sweep's worker.
  if (failures.length > 0) {
    throw failures[0];
  }
  return items.length - started;
}
