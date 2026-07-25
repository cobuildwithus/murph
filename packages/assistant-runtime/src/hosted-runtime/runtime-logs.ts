import {
  HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES,
  type HostedRuntimeLogEntry,
  type HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedRuntimePlatform,
} from "./platform.ts";

export interface HostedRuntimeLogContext {
  attemptId?: string | null;
  leaseGeneration?: string | null;
  workspaceVersion?: string | null;
}

export function buildHostedRuntimeLogContextFields(
  context: HostedRuntimeLogContext | null | undefined,
): Partial<Pick<HostedRuntimeLogEntry, "attemptId" | "leaseGeneration" | "workspaceVersion">> {
  if (!context) {
    return {};
  }

  return {
    ...(context.attemptId ? { attemptId: context.attemptId } : {}),
    ...(context.leaseGeneration ? { leaseGeneration: context.leaseGeneration } : {}),
    ...(context.workspaceVersion ? { workspaceVersion: context.workspaceVersion } : {}),
  };
}

// Every awaited runtime log write costs a full runner->worker->web round trip
// (~150ms in production), and several sit directly on the reply hot path
// between mailbox import and the local Codex `turn/start` request write (see
// the "observability writes are never user latency" invariant in
// docs/contracts/00-invariants.md).
// Info-level entries are durable diagnostics, not control flow: buffer them so
// the caller returns immediately while one background writer drains the buffer
// in enqueue order. The writer is self-clocking — everything logged while a
// request is in flight coalesces into the next request — so a busy invocation
// sends far fewer round trips without any entry waiting on a timer.
// warn/error entries still write directly and block only on their own write:
// the crash-diagnostic tail must be durable before the runtime proceeds, and
// must not wait behind buffered info. `at` is stamped at enqueue, so persisted
// ordering still reflects logical time even when a direct warn write lands
// before older buffered info entries. A single module-level buffer is enough:
// hosted runner processes hold one live log port per invocation. The chain
// never rejects (each write swallows its own failure).
const HOSTED_RUNTIME_LOG_BATCH_MAX_ENTRIES = HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES;
// A conservative proxy for the callback's 256 KiB body limit, measured in
// serialized JSON length rather than encoded bytes. An oversized batch would
// fail the whole request, not one entry, so the budget stays well under the
// limit even for multi-byte diagnostics.
const HOSTED_RUNTIME_LOG_BATCH_MAX_JSON_LENGTH = 64 * 1024;
// A stalled log endpoint must not retain unbounded diagnostics in a warm
// runner process. Only info entries are ever dropped here.
export const HOSTED_RUNTIME_LOG_MAX_BUFFERED_ENTRIES = 500;

type HostedRuntimeLogPort = NonNullable<HostedRuntimePlatform["logPort"]>;

interface BufferedHostedRuntimeLogEntries {
  entries: HostedRuntimeLogEntry[];
  logPort: HostedRuntimeLogPort;
}

let bufferedHostedRuntimeLogEntries: BufferedHostedRuntimeLogEntries | null = null;
let hostedRuntimeLogWriterRunning = false;
let pendingHostedRuntimeLogWriteTail: Promise<void> = Promise.resolve();

export async function writeHostedRuntimeLogBestEffort(input: {
  entry: Omit<HostedRuntimeLogEntry, "at"> & { at?: string };
  platform: Pick<HostedRuntimePlatform, "logPort">;
  now?: () => string;
}): Promise<void> {
  const logPort = input.platform.logPort ?? null;
  if (!logPort) {
    return;
  }

  const entry: HostedRuntimeLogEntry = {
    at: input.now?.() ?? new Date().toISOString(),
    ...input.entry,
  };

  if (entry.level !== "info") {
    await writeHostedRuntimeLogEntries(logPort, [entry]);
    return;
  }

  bufferHostedRuntimeInfoLog(logPort, entry);
  startHostedRuntimeLogWriter();
}

function bufferHostedRuntimeInfoLog(
  logPort: HostedRuntimeLogPort,
  entry: HostedRuntimeLogEntry,
): void {
  if (bufferedHostedRuntimeLogEntries?.logPort !== logPort) {
    // A port swap is not expected within one invocation, but hand the previous
    // buffer to the writer rather than dropping diagnostics if it happens.
    handOffBufferedHostedRuntimeLogEntries();
    bufferedHostedRuntimeLogEntries = { entries: [], logPort };
  }

  const { entries } = bufferedHostedRuntimeLogEntries;
  entries.push(entry);
  if (entries.length > HOSTED_RUNTIME_LOG_MAX_BUFFERED_ENTRIES) {
    const dropped = entries.splice(
      0,
      entries.length - HOSTED_RUNTIME_LOG_MAX_BUFFERED_ENTRIES,
    );
    console.warn("Hosted runtime log buffer is full; dropping info diagnostics.", {
      droppedEntryCount: dropped.length,
      maxBufferedEntries: HOSTED_RUNTIME_LOG_MAX_BUFFERED_ENTRIES,
    });
  }
}

function handOffBufferedHostedRuntimeLogEntries(): void {
  const stale = bufferedHostedRuntimeLogEntries;
  if (!stale) {
    return;
  }

  bufferedHostedRuntimeLogEntries = null;
  pendingHostedRuntimeLogWriteTail = pendingHostedRuntimeLogWriteTail.then(async () => {
    while (stale.entries.length > 0) {
      await writeHostedRuntimeLogEntries(
        stale.logPort,
        takeHostedRuntimeLogBatch(stale.entries),
      );
    }
  });
}

// One writer at a time keeps requests in enqueue order and lets everything
// logged during an in-flight request coalesce into the next one.
function startHostedRuntimeLogWriter(): void {
  if (hostedRuntimeLogWriterRunning) {
    return;
  }

  hostedRuntimeLogWriterRunning = true;
  pendingHostedRuntimeLogWriteTail = pendingHostedRuntimeLogWriteTail.then(async () => {
    try {
      while (bufferedHostedRuntimeLogEntries) {
        const { entries, logPort } = bufferedHostedRuntimeLogEntries;
        const batch = takeHostedRuntimeLogBatch(entries);
        if (entries.length === 0) {
          bufferedHostedRuntimeLogEntries = null;
        }
        await writeHostedRuntimeLogEntries(logPort, batch);
      }
    } finally {
      hostedRuntimeLogWriterRunning = false;
    }
  });
}

// Drains the front of the buffer up to the request's entry and body bounds.
// The first entry always goes, so an oversized single entry still gets its own
// request instead of wedging the buffer.
function takeHostedRuntimeLogBatch(
  entries: HostedRuntimeLogEntry[],
): HostedRuntimeLogEntry[] {
  const batch: HostedRuntimeLogEntry[] = [];
  let jsonLength = 0;
  while (entries.length > 0 && batch.length < HOSTED_RUNTIME_LOG_BATCH_MAX_ENTRIES) {
    const entryJsonLength = JSON.stringify(entries[0]).length;
    if (
      batch.length > 0
      && jsonLength + entryJsonLength > HOSTED_RUNTIME_LOG_BATCH_MAX_JSON_LENGTH
    ) {
      break;
    }
    jsonLength += entryJsonLength;
    batch.push(entries.shift()!);
  }

  return batch;
}

async function writeHostedRuntimeLogEntries(
  logPort: HostedRuntimeLogPort,
  entries: readonly HostedRuntimeLogEntry[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  try {
    await logPort.write({
      entries: [...entries],
    });
  } catch (error) {
    const lastEntry = entries[entries.length - 1]!;
    console.warn("Hosted runtime durable log write failed.", {
      component: lastEntry.component,
      entryCount: entries.length,
      errorName: error instanceof Error ? error.name : typeof error,
      eventCode: lastEntry.eventCode,
    });
  }
}

// Awaited at invocation end so a normal shutdown never drops buffered entries.
// Queued writes swallow their own failures, so this never rejects. Re-reads
// the tail after each await in case settled writes buffered more entries.
// The optional bound keeps a degraded log endpoint from delaying invocation
// completion (result commit / checkpoint / next-wake handoff): on timeout the
// drain returns while remaining writes keep flushing in the background.
export async function drainHostedRuntimeLogWritesBestEffort(
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = timeoutMs === undefined
    ? null
    : new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve();
        }, timeoutMs);
        timer.unref?.();
      });

  try {
    let observed: Promise<void>;
    do {
      observed = pendingHostedRuntimeLogWriteTail;
      await (timeout ? Promise.race([observed, timeout]) : observed);
      if (timedOut) {
        console.warn("Hosted runtime log drain timed out; queued writes continue in the background.", {
          timeoutMs,
        });
        return;
      }
    } while (observed !== pendingHostedRuntimeLogWriteTail);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export function compactHostedRuntimeLogCodes(codes: readonly string[]): string[] {
  return Array.from(new Set(codes.map(toHostedRuntimeLogCode))).sort().slice(0, 16);
}

export function toHostedRuntimeLogCode(value: string | null | undefined): string {
  const fallback = "unclassified";
  if (!value) {
    return fallback;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 96) {
    return fallback;
  }

  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized)
    ? normalized
    : fallback;
}

export function summarizeHostedRuntimeStatusCounts(
  statuses: readonly string[],
): HostedRuntimeRedactedJson {
  const counts = new Map<string, number>();
  for (const status of statuses) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return {
    statusSummary: Array.from(counts.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `${status}:${count}`)
      .join(","),
  };
}

export function summarizeHostedAssistantAutoReplyEligibleAfter(
  entries: readonly {
    channel: string;
    eligibleAfter?: unknown | null;
  }[],
): string {
  return entries
    .map((entry) =>
      `${toHostedRuntimeLogCode(entry.channel)}:${entry.eligibleAfter == null ? "none" : "present"}`
    )
    .join(",");
}
