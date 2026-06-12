import type {
  HostedRuntimeLogEntry,
  HostedRuntimeRedactedJson,
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
// between mailbox import and provider start (see the "observability writes
// are never user latency" invariant in docs/contracts/00-invariants.md).
// Info-level entries are durable diagnostics, not control flow: queue them so
// the caller returns immediately while writes flush in the background in
// enqueue order. warn/error entries write directly and block only on their
// own write — the crash-diagnostic tail must be durable before the runtime
// proceeds, and must not wait behind a queued info backlog. `at` is stamped
// at enqueue, so persisted ordering still reflects logical time even when a
// direct warn write lands before older queued info writes. A single
// module-level tail is enough: hosted runner processes hold one live log
// port per invocation. The chain never rejects (each write swallows its own
// failure).
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

  const write = async () => {
    try {
      await logPort.write({
        entries: [entry],
      });
    } catch (error) {
      console.warn("Hosted runtime durable log write failed.", {
        component: entry.component,
        errorName: error instanceof Error ? error.name : typeof error,
        eventCode: entry.eventCode,
      });
    }
  };

  if (entry.level !== "info") {
    await write();
    return;
  }
  pendingHostedRuntimeLogWriteTail = pendingHostedRuntimeLogWriteTail.then(write);
}

// Awaited at invocation end so a normal shutdown never drops queued entries.
// Queued writes swallow their own failures, so this never rejects. Re-reads
// the tail after each await in case settled writes enqueued more entries.
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
