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
