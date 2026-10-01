import { createHash } from "node:crypto";

export const HOSTED_RECOVERY_JITTER_WINDOW_MS = 5_000;
const RECOVERY_CONCURRENCY = 5;

// Only the two bounded recovery sweeps use this executor. Direct ingress and
// runtime-owned deadlines never enter it. Waiting starts before any item work,
// so it cannot retain a transaction or a pooled database connection.
export async function runHostedRecoveryBatch<T extends { userId: string }>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
  jitter: boolean,
): Promise<void> {
  const startedAt = performance.now();
  const pending = items.map((item) => ({
    item,
    offsetMs: jitter
      ? createHash("sha256").update(item.userId).digest().readUInt32BE(0)
        % (HOSTED_RECOVERY_JITTER_WINDOW_MS + 1)
      : 0,
  })).sort((left, right) => left.offsetMs - right.offsetMs);
  let nextIndex = 0;

  // Order by eligibility before taking slots: a late offset must not hide an
  // earlier one behind it. Offsets are relative to the batch, not cumulative.
  const failures: unknown[] = [];
  await Promise.all(Array.from({
    length: Math.min(RECOVERY_CONCURRENCY, pending.length),
  }, async () => {
    try {
      while (nextIndex < pending.length) {
        const { item, offsetMs } = pending[nextIndex++];
        const remainingMs = offsetMs - (performance.now() - startedAt);
        if (remainingMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
        }
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
}
