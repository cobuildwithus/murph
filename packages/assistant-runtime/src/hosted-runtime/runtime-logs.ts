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
// Debug/info entries are verbose diagnostics, not control flow: buffer them so
// the caller returns immediately while one background writer drains the buffer
// in enqueue order. The writer is self-clocking — everything logged while a
// request is in flight coalesces into the next request — so a busy invocation
// sends far fewer round trips without any entry waiting on a timer.
// warn/error entries still write directly and block only on their own write:
// the crash-diagnostic tail must be durable before the runtime proceeds, and
// must not wait behind queued verbose entries. `at` is stamped at enqueue, so
// persisted ordering still reflects logical time even when a direct warn write
// lands before older queued info entries. The chain never rejects (each write
// swallows its own failure).
//
// One process-global FIFO carries each entry with the port it was logged
// through. A warm runner process outlives an invocation — the invocation-end
// drain is deliberately bounded, so the next invocation's fresh log port can
// appear while an older request is still in flight — and the queue keeps
// enqueue order across that rotation without a second owner. A barrier also
// keeps an in-flight direct batch ahead of the suffix transferred on foreground
// preemption.
const HOSTED_RUNTIME_LOG_BATCH_MAX_ENTRIES = HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES;
// A conservative proxy for the callback's 256 KiB body limit, measured in
// serialized JSON length rather than encoded bytes. An oversized batch would
// fail the whole request, not one entry, so the budget stays well under the
// limit even for multi-byte diagnostics.
const HOSTED_RUNTIME_LOG_BATCH_MAX_JSON_LENGTH = 64 * 1024;
const HOSTED_RUNTIME_LOG_PREEMPTION_POLL_MS = 25;
// A stalled log endpoint must not retain unbounded verbose diagnostics in a
// warm runner process. This bounds debug/info entries across invocations and
// ports. Finite warn/error continuations are never dropped.
export const HOSTED_RUNTIME_LOG_MAX_QUEUED_ENTRIES = 500;

type HostedRuntimeLogPort = NonNullable<HostedRuntimePlatform["logPort"]>;

interface QueuedHostedRuntimeLogEntry {
  droppable: boolean;
  entry: HostedRuntimeLogEntry;
  kind: "entry";
  logPort: HostedRuntimeLogPort;
}

interface QueuedHostedRuntimeLogBarrier {
  kind: "barrier";
  readyAfter: Promise<void>;
}

type QueuedHostedRuntimeLogItem =
  | QueuedHostedRuntimeLogBarrier
  | QueuedHostedRuntimeLogEntry;

const queuedHostedRuntimeLogItems: QueuedHostedRuntimeLogItem[] = [];
let hostedRuntimeLogWriter: Promise<void> | null = null;

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

  if (entry.level === "warn" || entry.level === "error") {
    await writeHostedRuntimeLogEntries(logPort, [entry]);
    return;
  }

  queuedHostedRuntimeLogItems.push({
    droppable: true,
    entry,
    kind: "entry",
    logPort,
  });
  trimQueuedHostedRuntimeVerboseLogEntries();
  startHostedRuntimeLogWriter();
}

/**
 * Writes a finite set of direct diagnostics through the same bounded transport
 * used by the verbose queue. This keeps warn/error durability ahead of control
 * flow without paying one runner-to-Web round trip per entry.
 */
export async function writeHostedRuntimeLogEntriesBestEffort(input: {
  entries: readonly (Omit<HostedRuntimeLogEntry, "at"> & { at?: string })[];
  platform: Pick<HostedRuntimePlatform, "logPort">;
  now?: () => string;
  shouldYieldBetweenBatches?: (() => boolean) | null;
}): Promise<void> {
  const logPort = input.platform.logPort ?? null;
  if (!logPort || input.entries.length === 0) {
    return;
  }

  const entries = input.entries.map((entry): HostedRuntimeLogEntry => {
    const { at, ...rest } = entry;
    return {
      ...rest,
      at: at ?? input.now?.() ?? new Date().toISOString(),
    };
  });
  let offset = 0;
  while (offset < entries.length) {
    if (input.shouldYieldBetweenBatches?.() === true) {
      enqueueHostedRuntimeLogContinuation({
        entries: entries.slice(offset),
        logPort,
      });
      return;
    }

    const batch = takeBoundedHostedRuntimeLogEntries(entries.slice(offset));
    const writePromise = writeHostedRuntimeLogEntries(logPort, batch);
    const result = await waitForHostedRuntimeLogWriteOrYield({
      shouldYield: input.shouldYieldBetweenBatches ?? null,
      writePromise,
    });
    offset += batch.length;
    if (result === "yielded") {
      enqueueHostedRuntimeLogContinuation({
        entries: entries.slice(offset),
        logPort,
        readyAfter: writePromise,
      });
      return;
    }
  }
}

function enqueueHostedRuntimeLogContinuation(input: {
  entries: readonly HostedRuntimeLogEntry[];
  logPort: HostedRuntimeLogPort;
  readyAfter?: Promise<void>;
}): void {
  if (input.readyAfter) {
    queuedHostedRuntimeLogItems.push({
      kind: "barrier",
      readyAfter: input.readyAfter,
    });
  }
  for (const entry of input.entries) {
    queuedHostedRuntimeLogItems.push({
      droppable: false,
      entry,
      kind: "entry",
      logPort: input.logPort,
    });
  }
  startHostedRuntimeLogWriter();
}

async function waitForHostedRuntimeLogWriteOrYield(input: {
  shouldYield: (() => boolean) | null;
  writePromise: Promise<void>;
}): Promise<"written" | "yielded"> {
  if (!input.shouldYield) {
    await input.writePromise;
    return "written";
  }

  return await new Promise<"written" | "yielded">((resolve) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const finish = (result: "written" | "yielded") => {
      if (settled) {
        return;
      }
      settled = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      resolve(result);
    };
    const checkForYield = () => {
      if (input.shouldYield?.() === true) {
        finish("yielded");
      }
    };

    void input.writePromise.then(
      () => finish("written"),
      () => finish("written"),
    );
    checkForYield();
    if (!settled) {
      pollTimer = setInterval(checkForYield, HOSTED_RUNTIME_LOG_PREEMPTION_POLL_MS);
      pollTimer.unref?.();
    }
  });
}

function trimQueuedHostedRuntimeVerboseLogEntries(): void {
  const verboseEntryCount = queuedHostedRuntimeLogItems.reduce(
    (count, item) => count + (item.kind === "entry" && item.droppable ? 1 : 0),
    0,
  );
  let remainingToDrop = verboseEntryCount - HOSTED_RUNTIME_LOG_MAX_QUEUED_ENTRIES;
  if (remainingToDrop <= 0) {
    return;
  }

  const droppedEntryCount = remainingToDrop;
  for (let index = 0; index < queuedHostedRuntimeLogItems.length && remainingToDrop > 0;) {
    const item = queuedHostedRuntimeLogItems[index];
    if (item?.kind === "entry" && item.droppable) {
      queuedHostedRuntimeLogItems.splice(index, 1);
      remainingToDrop -= 1;
      continue;
    }
    index += 1;
  }

  console.warn("Hosted runtime log queue is full; dropping verbose diagnostics.", {
    droppedEntryCount,
    maxQueuedEntries: HOSTED_RUNTIME_LOG_MAX_QUEUED_ENTRIES,
  });
}

// One writer at a time keeps requests in enqueue order and lets everything
// logged during an in-flight request coalesce into the next one.
function startHostedRuntimeLogWriter(): void {
  if (hostedRuntimeLogWriter) {
    return;
  }

  hostedRuntimeLogWriter = (async () => {
    try {
      let work = takeHostedRuntimeLogWork();
      while (work) {
        if (work.kind === "barrier") {
          await work.readyAfter;
        } else {
          await writeHostedRuntimeLogEntries(work.logPort, work.entries);
        }
        work = takeHostedRuntimeLogWork();
      }
    } finally {
      hostedRuntimeLogWriter = null;
      if (queuedHostedRuntimeLogItems.length > 0) {
        startHostedRuntimeLogWriter();
      }
    }
  })();
}

type HostedRuntimeLogWork =
  | { kind: "barrier"; readyAfter: Promise<void> }
  | { entries: HostedRuntimeLogEntry[]; kind: "batch"; logPort: HostedRuntimeLogPort };

// Drains the queue's leading same-port run up to the request's entry and body
// bounds. A barrier keeps a preempted direct write ahead of its queued suffix.
// Stopping at a port change keeps every entry on the port it was logged
// through; the first entry always goes, so an oversized single entry gets its
// own request instead of wedging the queue.
function takeHostedRuntimeLogWork(): HostedRuntimeLogWork | null {
  const head = queuedHostedRuntimeLogItems[0];
  if (!head) {
    return null;
  }
  if (head.kind === "barrier") {
    queuedHostedRuntimeLogItems.splice(0, 1);
    return head;
  }

  const { logPort } = head;
  const candidates: HostedRuntimeLogEntry[] = [];
  while (
    candidates.length < queuedHostedRuntimeLogItems.length
    && candidates.length < HOSTED_RUNTIME_LOG_BATCH_MAX_ENTRIES
  ) {
    const item = queuedHostedRuntimeLogItems[candidates.length];
    if (item?.kind !== "entry" || item.logPort !== logPort) {
      break;
    }
    candidates.push(item.entry);
  }
  const entries = takeBoundedHostedRuntimeLogEntries(candidates);
  queuedHostedRuntimeLogItems.splice(0, entries.length);

  return { entries, kind: "batch", logPort };
}

function takeBoundedHostedRuntimeLogEntries(
  candidates: readonly HostedRuntimeLogEntry[],
): HostedRuntimeLogEntry[] {
  const entries: HostedRuntimeLogEntry[] = [];
  let jsonLength = JSON.stringify({ entries: [] }).length;
  for (const entry of candidates) {
    if (entries.length >= HOSTED_RUNTIME_LOG_BATCH_MAX_ENTRIES) {
      break;
    }
    const entryJsonLength = JSON.stringify(entry).length
      + (entries.length === 0 ? 0 : 1);
    if (
      entries.length > 0
      && jsonLength + entryJsonLength > HOSTED_RUNTIME_LOG_BATCH_MAX_JSON_LENGTH
    ) {
      break;
    }
    jsonLength += entryJsonLength;
    entries.push(entry);
  }

  return entries;
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

// Awaited at invocation end so a normal shutdown never drops queued entries.
// Queued writes swallow their own failures, so this never rejects. Re-reads the
// writer after each await in case settled writes queued more entries.
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
    while (hostedRuntimeLogWriter) {
      await (timeout
        ? Promise.race([hostedRuntimeLogWriter, timeout])
        : hostedRuntimeLogWriter);
      if (timedOut) {
        console.warn("Hosted runtime log drain timed out; queued writes continue in the background.", {
          timeoutMs,
        });
        return;
      }
    }
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
