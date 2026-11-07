import { AsyncLocalStorage } from "node:async_hooks";
import { isCliTimingActive, recordCliPhase } from "@murphai/runtime-state/node/cli-timing";

// Private to the two meal-owner scans. No workload counts or arbitrary labels;
// shared storage readers keep their public signatures and normal control flow.
const operations = ["source", "path", "read", "decode", "parse", "select"] as const;
type Operation = typeof operations[number];
interface Scan {
  totals: Record<Operation, bigint>;
  closed: boolean;
}
const scans = new AsyncLocalStorage<Scan>();
const noop = () => {};

export function withEventOwnerScanTiming<T>(
  kind: "meal" | "document",
  pass: "candidates" | "revisions",
  run: () => Promise<T>,
): Promise<T> {
  if (kind !== "meal" || !isCliTimingActive()) return run();
  const scan: Scan = {
    totals: { source: 0n, path: 0n, read: 0n, decode: 0n, parse: 0n, select: 0n },
    closed: false,
  };
  return scans.run(scan, async () => {
    try { return await run(); }
    finally {
      scan.closed = true;
      // One sample per category, including zero for work not reached on error
      // or absent formats. Neither span counts nor histograms reveal shard count.
      for (const operation of operations) {
        recordCliPhase(`event-owner-${pass}-${operation}`, Number(scan.totals[operation] / 1_000n));
      }
    }
  });
}

/** Sum disjoint existing operation intervals; never sample per row or emit here. */
export function startEventOwnerOperation(operation: Operation): () => void {
  const scan = scans.getStore();
  if (!scan || scan.closed) return noop;
  const started = process.hrtime.bigint();
  let ended = false;
  return () => {
    if (ended || scan.closed) return;
    ended = true;
    scan.totals[operation] += process.hrtime.bigint() - started;
  };
}
