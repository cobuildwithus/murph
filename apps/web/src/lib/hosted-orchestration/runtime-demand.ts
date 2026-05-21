import {
  parseHostedRuntimeDemand,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeDemand,
  HostedRuntimeDemandBlockedReason,
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
  hasHostedMemberActiveAccess,
} from "../hosted-onboarding/entitlement";
import {
  readHostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import {
  readHostedMailboxMaxSeqByLane,
} from "../hosted-mailbox/store";
import {
  readHostedWorkspace,
  type HostedWorkspaceRecord,
} from "../hosted-workspace/store";
import {
  getPrisma,
} from "../prisma";
import {
  resolveHostedRuntimeAiUsageDemandGate,
  type HostedRuntimeUsageGateCheck,
} from "./runtime-usage-decision";

const HOSTED_RUNTIME_AI_USAGE_SOURCES = new Set<HostedRuntimeDemandRunSource>([
  "manual",
]);

type HostedRuntimeDemandUsageGateStatus =
  | HostedRuntimeUsageGateCheck["status"]
  | "not_required";

type HostedRuntimeDemandUsageGateMode = "mutating" | "read_only";
type HostedRuntimeDemandDecisionSource = "workflow" | "status";

const HOSTED_RUNTIME_DEMAND_DECISION_LOG_SCHEMA =
  "murph.hosted-runtime.demand-decision.v1";

export async function readHostedRuntimeDemand(
  input: HostedRuntimeDemandRequest & {
    decisionSource?: HostedRuntimeDemandDecisionSource;
    now?: Date | string;
    usageGateMode?: HostedRuntimeDemandUsageGateMode;
  },
): Promise<HostedRuntimeDemand> {
  const prisma = getPrisma();
  const member = await readHostedMemberCoreState({
    memberId: input.userId,
    prisma,
  });

  if (!member || !hasHostedMemberActiveAccess(member)) {
    const demand = buildHostedRuntimeBlockedDemand({
      mailboxLag: [],
      reason: "user_not_active",
      retryAt: null,
      workspace: null,
    });
    emitHostedRuntimeDemandDecision({
      demand,
      request: input,
      usageGateRequired: false,
      usageGateStatus: "not_required",
    });
    return demand;
  }

  const [workspace, maxSeqByLane] = await Promise.all([
    readHostedWorkspace({ prisma, userId: input.userId }),
    readHostedMailboxMaxSeqByLane({ prisma, userId: input.userId }),
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

  const decision = await buildHostedRuntimeDemandDecision({
    ...input,
    mailboxLag,
    workspace,
  });
  emitHostedRuntimeDemandDecision({
    demand: decision.demand,
    request: input,
    usageGateRequired: decision.usageGateRequired,
    usageGateStatus: decision.usageGateStatus,
  });
  return decision.demand;
}

export async function buildHostedRuntimeDemand(input: HostedRuntimeDemandRequest & {
  mailboxLag: HostedMailboxLaneLag[];
  now?: Date | string;
  usageGateMode?: HostedRuntimeDemandUsageGateMode;
  workspace: HostedWorkspaceRecord | null;
}): Promise<HostedRuntimeDemand> {
  return (await buildHostedRuntimeDemandDecision(input)).demand;
}

async function buildHostedRuntimeDemandDecision(input: HostedRuntimeDemandRequest & {
  mailboxLag: HostedMailboxLaneLag[];
  now?: Date | string;
  usageGateMode?: HostedRuntimeDemandUsageGateMode;
  workspace: HostedWorkspaceRecord | null;
}): Promise<{
  demand: HostedRuntimeDemand;
  usageGateRequired: boolean;
  usageGateStatus: HostedRuntimeDemandUsageGateStatus;
}> {
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
    return {
      demand: parseHostedRuntimeDemand({
        kind: "idle",
        mailboxLag: input.mailboxLag,
        nextWakeAt: readEarliestFutureWakeAt({
          now,
          runtimeResultWakeAt: input.runtimeResultWakeAt ?? null,
          workspace,
        }),
        workspace,
      }),
      usageGateRequired: false,
      usageGateStatus: "not_required",
    };
  }

  if (workspace === null) {
    return {
      demand: buildHostedRuntimeBlockedDemand({
        mailboxLag: input.mailboxLag,
        reason: "hosted_runtime_not_configured",
        retryAt: null,
        workspace,
      }),
      usageGateRequired: false,
      usageGateStatus: "not_required",
    };
  }

  const shouldGateAiUsage = hostedRuntimeDemandNeedsAiUsageGate(
    run.source,
    {
      mailboxLag: input.mailboxLag,
      now,
      runtimeResultWakeReason: input.runtimeResultWakeReason ?? null,
      workspace,
    },
  );

  if (shouldGateAiUsage) {
    const gate = await resolveHostedRuntimeAiUsageDemandGate({
      mode: input.usageGateMode ?? "mutating",
      now,
      userId: input.userId,
    });

    if (gate.status === "denied") {
      return {
        demand: parseHostedRuntimeDemand({
          kind: "blocked",
          mailboxLag: input.mailboxLag,
          reason: "ai_usage_denied",
          retryAt: null,
          workspace,
        }),
        usageGateRequired: true,
        usageGateStatus: gate.status,
      };
    }

    if (gate.status === "unavailable") {
      return {
        demand: parseHostedRuntimeDemand({
          kind: "blocked",
          mailboxLag: input.mailboxLag,
          reason: "ai_usage_gate_unavailable",
          retryAt: gate.retryAt,
          workspace,
        }),
        usageGateRequired: true,
        usageGateStatus: gate.status,
      };
    }

    return {
      demand: parseHostedRuntimeDemand({
        kind: "run",
        mailboxLag: input.mailboxLag,
        reason: run.reason,
        source: run.source,
        workspace,
      }),
      usageGateRequired: true,
      usageGateStatus: gate.status,
    };
  }

  return {
    demand: parseHostedRuntimeDemand({
      kind: "run",
      mailboxLag: input.mailboxLag,
      reason: run.reason,
      source: run.source,
      workspace,
    }),
    usageGateRequired: false,
    usageGateStatus: "not_required",
  };
}

function buildHostedRuntimeBlockedDemand(input: {
  mailboxLag: HostedMailboxLaneLag[];
  reason: HostedRuntimeDemandBlockedReason;
  retryAt: string | null;
  workspace: HostedRuntimeDemandWorkspaceProjection | null;
}): HostedRuntimeDemand {
  return parseHostedRuntimeDemand({
    kind: "blocked",
    mailboxLag: input.mailboxLag,
    reason: input.reason,
    retryAt: input.retryAt,
    workspace: input.workspace,
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

export function hostedRuntimeDemandNeedsAiUsageGate(
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

    return hostedRuntimeResultWakeNeedsAiUsageGate(
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
  if (hasHostedMailboxLag(input.mailboxLag)) {
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

function emitHostedRuntimeDemandDecision(decision: {
  demand: HostedRuntimeDemand;
  request: HostedRuntimeDemandRequest & {
    decisionSource?: HostedRuntimeDemandDecisionSource;
  };
  usageGateRequired: boolean;
  usageGateStatus: HostedRuntimeDemandUsageGateStatus;
}): void {
  console.info("Hosted runtime demand decision.", {
    blockedReason:
      decision.demand.kind === "blocked" ? decision.demand.reason : null,
    browserVaultRefreshRequested:
      decision.request.browserVaultRefreshRequested === true,
    component: "hosted.orchestration.demand",
    conversationLagPresent: hasHostedMailboxLag(
      decision.demand.mailboxLag,
      "conversation",
    ),
    decisionSource: decision.request.decisionSource ?? "workflow",
    demandKind: decision.demand.kind,
    demandReason: decision.demand.kind === "run" ? decision.demand.reason : null,
    demandSource: decision.demand.kind === "run" ? decision.demand.source : null,
    deviceSyncRecoveryRequested:
      decision.request.deviceSyncRecoveryRequested === true,
    ignoredWorkspaceWakeKeyPresent:
      Boolean(decision.request.ignoredWorkspaceWakeKey),
    lagRecoveryObserved: decision.request.lagRecoveryObserved === true,
    mailboxLagLaneCount: decision.demand.mailboxLag.length,
    manualRunRequested: decision.request.manualRunRequested === true,
    retryAtPresent:
      decision.demand.kind === "blocked" && decision.demand.retryAt !== null,
    runtimeResultWakeAtPresent: Boolean(decision.request.runtimeResultWakeAt),
    runtimeResultWakeReason: describeHostedRuntimeWakeReasonForLog(
      decision.request.runtimeResultWakeReason === undefined
        ? null
        : decision.request.runtimeResultWakeReason,
    ),
    schema: HOSTED_RUNTIME_DEMAND_DECISION_LOG_SCHEMA,
    usageGateRequired: decision.usageGateRequired,
    usageGateStatus: decision.usageGateStatus,
    userIdPresent: decision.request.userId.length > 0,
    workspaceNextWakeAtPresent:
      decision.demand.workspace?.nextWakeAt !== null
        && decision.demand.workspace?.nextWakeAt !== undefined,
    workspaceNextWakeReason: describeHostedRuntimeWakeReasonForLog(
      decision.demand.workspace?.nextWakeReason ?? null,
    ),
    workspacePresent: decision.demand.workspace !== null,
  });
}

function describeHostedRuntimeWakeReasonForLog(reason: string | null): string | null {
  switch (reason) {
    case null:
      return null;
    case "alarm":
    case "assistant":
    case "assistant_due":
    case "device-sync.reconcile":
    case "mailbox":
    case "runtime.failed":
      return reason;
    default:
      return "other";
  }
}

function isHostedRuntimeModelCapableWorkspaceWakeReason(
  reason: string | null,
): boolean {
  return reason === "assistant" || reason === "assistant_due";
}

function hostedRuntimeResultWakeNeedsAiUsageGate(
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
