import {
  parseHostedRuntimeDemand,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeDemand,
  HostedRuntimeDemandRequest,
  HostedRuntimeDemandRunSource,
  HostedRuntimeDemandWorkspaceProjection,
} from "@murphai/hosted-execution/orchestration-control";
import type {
  HostedMailboxLaneLag,
  HostedWorkspaceInvocationReason,
} from "@murphai/hosted-execution/runtime-control";

import {
  computeHostedMailboxLaneLag,
  readHostedMailboxRedactedStatusRecord,
} from "../hosted-mailbox/lag";
import {
  readHostedMailboxMaxSeqByLane,
} from "../hosted-mailbox/store";
import {
  readHostedWorkspace,
  type HostedWorkspaceRecord,
} from "../hosted-workspace/store";
import {
  resolveHostedRuntimeAiUsageDemandGate,
} from "./runtime-usage-decision";

const HOSTED_RUNTIME_AI_USAGE_SOURCES = new Set<HostedRuntimeDemandRunSource>([
  "manual",
]);

export async function readHostedRuntimeDemand(
  input: HostedRuntimeDemandRequest & {
    now?: Date | string;
  },
): Promise<HostedRuntimeDemand> {
  const [workspace, maxSeqByLane] = await Promise.all([
    readHostedWorkspace({ userId: input.userId }),
    readHostedMailboxMaxSeqByLane({ userId: input.userId }),
  ]);
  const redactedStatus = readHostedMailboxRedactedStatusRecord(
    workspace?.redactedStatusJson,
  );
  const mailboxLag = maxSeqByLane.map((highWater) =>
    computeHostedMailboxLaneLag({
      highWater,
      redactedStatusJson: redactedStatus,
    })
  );

  return buildHostedRuntimeDemand({
    ...input,
    mailboxLag,
    workspace,
  });
}

export async function buildHostedRuntimeDemand(input: HostedRuntimeDemandRequest & {
  mailboxLag: HostedMailboxLaneLag[];
  now?: Date | string;
  workspace: HostedWorkspaceRecord | null;
}): Promise<HostedRuntimeDemand> {
  const now = normalizeHostedRuntimeDemandDate(input.now);
  const workspace = projectHostedRuntimeDemandWorkspace(input.workspace);
  const run = selectHostedRuntimeRunDemand({
    browserVaultRefreshRequested: input.browserVaultRefreshRequested === true,
    deviceSyncRecoveryRequested: input.deviceSyncRecoveryRequested === true,
    ignoredWorkspaceWakeKey: input.ignoredWorkspaceWakeKey ?? null,
    lagRecoveryObserved: input.lagRecoveryObserved === true,
    mailboxLag: input.mailboxLag,
    manualRunRequested: input.manualRunRequested === true,
    now,
    runtimeResultWakeAt: input.runtimeResultWakeAt ?? null,
    workspace,
  });

  if (!run) {
    return parseHostedRuntimeDemand({
      kind: "idle",
      mailboxLag: input.mailboxLag,
      nextWakeAt: readEarliestFutureWakeAt({
        now,
        runtimeResultWakeAt: input.runtimeResultWakeAt ?? null,
        workspace,
      }),
      workspace,
    });
  }

  const requiresAiUsageDecision = hostedRuntimeDemandRequiresAiUsageDecision(
    run.source,
    {
      mailboxLag: input.mailboxLag,
      now,
      runtimeResultWakeReason: input.runtimeResultWakeReason ?? null,
      workspace,
    },
  );

  if (requiresAiUsageDecision) {
    const gate = await resolveHostedRuntimeAiUsageDemandGate({
      now,
      userId: input.userId,
    });

    if (gate.status === "denied") {
      return parseHostedRuntimeDemand({
        kind: "blocked",
        mailboxLag: input.mailboxLag,
        reason: "ai_usage_denied",
        retryAt: null,
        workspace,
      });
    }

    if (gate.status === "unavailable") {
      return parseHostedRuntimeDemand({
        kind: "blocked",
        mailboxLag: input.mailboxLag,
        reason: "ai_usage_gate_unavailable",
        retryAt: gate.retryAt,
        workspace,
      });
    }
  }

  return parseHostedRuntimeDemand({
    kind: "run",
    mailboxLag: input.mailboxLag,
    reason: run.reason,
    requiresAiUsageDecision,
    source: run.source,
    workspace,
  });
}

export function buildHostedRuntimeWorkspaceWakeKey(
  workspace: HostedRuntimeDemandWorkspaceProjection | null,
): string | null {
  if (!workspace?.nextWakeAt) {
    return null;
  }

  return [
    workspace.version ?? "0",
    workspace.nextWakeAt,
    workspace.nextWakeReason ?? "",
  ].join(":");
}

export function hostedRuntimeDemandRequiresAiUsageDecision(
  source: HostedRuntimeDemandRunSource,
  input: {
    mailboxLag: readonly HostedMailboxLaneLag[];
    now: Date;
    runtimeResultWakeReason: string | null;
    workspace: HostedRuntimeDemandWorkspaceProjection | null;
  },
): boolean {
  if (source === "mailbox_backlog") {
    return hasHostedMailboxLag(input.mailboxLag, "conversation");
  }

  if (source === "workspace_wake") {
    return isHostedRuntimeModelCapableWorkspaceWakeReason(
      input.workspace?.nextWakeReason ?? null,
    );
  }

  if (source === "runtime_result_wake") {
    if (
      isHostedRuntimeWakeDue(input.workspace?.nextWakeAt ?? null, input.now)
      && isHostedRuntimeModelCapableWorkspaceWakeReason(
        input.workspace?.nextWakeReason ?? null,
      )
    ) {
      return true;
    }

    return hostedRuntimeResultWakeRequiresAiUsageDecision(
      input.runtimeResultWakeReason,
    );
  }

  return HOSTED_RUNTIME_AI_USAGE_SOURCES.has(source);
}

function selectHostedRuntimeRunDemand(input: {
  browserVaultRefreshRequested: boolean;
  deviceSyncRecoveryRequested: boolean;
  ignoredWorkspaceWakeKey: string | null;
  lagRecoveryObserved: boolean;
  mailboxLag: HostedMailboxLaneLag[];
  manualRunRequested: boolean;
  now: Date;
  runtimeResultWakeAt: string | null;
  workspace: HostedRuntimeDemandWorkspaceProjection | null;
}): {
  reason: HostedWorkspaceInvocationReason;
  source: HostedRuntimeDemandRunSource;
} | null {
  if (hasHostedMailboxLag(input.mailboxLag, "conversation")) {
    return {
      reason: "nudge",
      source: "mailbox_backlog",
    };
  }

  if (input.manualRunRequested) {
    return {
      reason: "manual",
      source: "manual",
    };
  }

  if (hasHostedMailboxLag(input.mailboxLag)) {
    return {
      reason: "nudge",
      source: "mailbox_backlog",
    };
  }

  if (input.browserVaultRefreshRequested) {
    return {
      reason: "browser_vault_refresh",
      source: "browser_vault_refresh",
    };
  }

  if (input.deviceSyncRecoveryRequested) {
    return {
      reason: "nudge",
      source: "device_sync_recovery",
    };
  }

  if (input.lagRecoveryObserved) {
    return {
      reason: "nudge",
      source: "lag_recovery",
    };
  }

  if (isHostedRuntimeWakeDue(input.runtimeResultWakeAt, input.now)) {
    return {
      reason: "retry",
      source: "runtime_result_wake",
    };
  }

  if (
    isHostedRuntimeWakeDue(input.workspace?.nextWakeAt ?? null, input.now)
    && buildHostedRuntimeWorkspaceWakeKey(input.workspace)
      !== input.ignoredWorkspaceWakeKey
  ) {
    return {
      reason: "nudge",
      source: "workspace_wake",
    };
  }

  return null;
}

function readEarliestFutureWakeAt(input: {
  now: Date;
  runtimeResultWakeAt: string | null;
  workspace: HostedRuntimeDemandWorkspaceProjection | null;
}): string | null {
  const candidates = [
    input.runtimeResultWakeAt,
    input.workspace?.nextWakeAt ?? null,
  ].filter((wakeAt): wakeAt is string =>
    isHostedRuntimeWakeFuture(wakeAt, input.now)
  );

  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .map((wakeAt) => new Date(wakeAt).toISOString())
    .sort()[0] ?? null;
}

function hasHostedMailboxLag(
  mailboxLag: readonly HostedMailboxLaneLag[],
  targetLane?: HostedMailboxLaneLag["lane"],
): boolean {
  return mailboxLag.some((laneLag) => {
    if (targetLane !== undefined && laneLag.lane !== targetLane) {
      return false;
    }
    try {
      return BigInt(laneLag.lag) > 0n;
    } catch {
      return false;
    }
  });
}

function isHostedRuntimeModelCapableWorkspaceWakeReason(
  reason: string | null,
): boolean {
  return reason === "assistant" || reason === "assistant_due";
}

function hostedRuntimeResultWakeRequiresAiUsageDecision(
  reason: string | null,
): boolean {
  if (reason === "device-sync.reconcile" || reason === "mailbox") {
    return false;
  }
  return true;
}

function isHostedRuntimeWakeDue(value: string | null, now: Date): boolean {
  const timestamp = readHostedRuntimeDemandTimestamp(value);
  return timestamp !== null && timestamp <= now.getTime();
}

function isHostedRuntimeWakeFuture(value: string | null, now: Date): boolean {
  const timestamp = readHostedRuntimeDemandTimestamp(value);
  return timestamp !== null && timestamp > now.getTime();
}

function readHostedRuntimeDemandTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function projectHostedRuntimeDemandWorkspace(
  workspace: HostedWorkspaceRecord | null,
): HostedRuntimeDemandWorkspaceProjection | null {
  return workspace
    ? {
        nextWakeAt: workspace.nextWakeAt,
        nextWakeReason: workspace.nextWakeReason,
        version: workspace.version,
      }
    : null;
}

function normalizeHostedRuntimeDemandDate(value: Date | string | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}
