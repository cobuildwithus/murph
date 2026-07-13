import {
  isHostedLinqConversationMessageWake,
  type HostedExecutionConversationMessageWake,
  type HostedExecutionLinqConversationMessagePayload,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionWake,
  parseHostedRuntimeReconciliationFacts,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeReconciliationBlockedReason,
  HostedRuntimeReconciliationFacts,
  HostedRuntimeReconciliationFactsRequest,
  HostedRuntimeReconciliationFactsWorkspace,
} from "@murphai/hosted-execution/orchestration-control";
import {
  isHostedRuntimeFutureMailboxContinuation,
  type HostedMailboxLaneConsumed,
  type HostedMailboxLaneLag,
} from "@murphai/hosted-execution/runtime-control";
import type { PrismaClient } from "@prisma/client";

import {
  computeHostedMailboxLaneLag,
  readHostedMailboxRedactedStatusRecord,
} from "../hosted-mailbox/lag";
import {
  decodeHostedMailboxStoredPayload,
  readHostedMailboxConsumedSeqByLane,
  readHostedMailboxEarliestConversationItem,
  readHostedMailboxLatestPendingConversationItem,
  readHostedMailboxPendingSystemItemsNeedAiUsageGate,
  readHostedMailboxMaxSeqByLane,
  readHostedMailboxPayload,
} from "../hosted-mailbox/store";
import {
  sendHostedTrialConversionNoticeToLinqChat,
} from "../hosted-execution/usage-limit-notice";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import {
  readHostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import {
  hasHostedMemberEstablishedLinqHomeRoute,
} from "../hosted-onboarding/hosted-member-routing-store";
import {
  hasHostedLinqInboundWithinDays,
} from "../hosted-onboarding/linq-daily-state";
import type {
  HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";
import {
  hasHostedMemberEstablishedLinqThreadRoute,
} from "../hosted-routing/thread-route-store";
import {
  readHostedWorkspace,
  type HostedWorkspaceRecord,
} from "../hosted-workspace/store";
import {
  getPrisma,
} from "../prisma";
import {
  resolveHostedRuntimeAiUsageGate,
  type HostedRuntimeUsageGateCheck,
} from "./runtime-usage-decision";

type HostedRuntimeReconciliationUsageGateStatus =
  | HostedRuntimeUsageGateCheck["status"]
  | "not_required";

type HostedRuntimeReconciliationUsageGateMode = "mutating" | "read_only";
type HostedRuntimeReconciliationDecisionSource = "workflow" | "status";
type HostedRuntimeDeniedAiUsageDecision =
  Extract<HostedRuntimeUsageGateCheck, { status: "denied" }>["decision"];

const HOSTED_RUNTIME_RECONCILIATION_FACTS_LOG_SCHEMA =
  "murph.hosted-runtime.reconciliation-facts.v1";
const HOSTED_RUNTIME_RECONCILIATION_ENGAGEMENT_PAUSE_RETRY_MS =
  24 * 60 * 60 * 1000;

export async function readHostedRuntimeOwnerReleaseMailboxLagActionable(input: {
  now?: Date | string;
  userId: string;
}): Promise<boolean> {
  const prisma = getPrisma();
  const now = normalizeHostedRuntimeReconciliationDate(input.now);
  const [workspace, maxSeqByLane] = await Promise.all([
    readHostedWorkspace({ prisma, userId: input.userId }),
    readHostedMailboxMaxSeqByLane({ prisma, userId: input.userId }),
  ]);
  if (!workspace) {
    return false;
  }

  const redactedStatus = readHostedMailboxRedactedStatusRecord(
    workspace.redactedStatusJson,
  );
  const mailboxLag = maxSeqByLane.map((highWater) =>
    computeHostedMailboxLaneLag({
      highWater,
      redactedStatusJson: redactedStatus,
    })
  );
  if (!hasHostedMailboxLag(mailboxLag)) {
    return false;
  }

  const deferredMailboxContinuation =
    isHostedRuntimeFutureMailboxContinuation({
      nextWakeAt: workspace.nextWakeAt,
      nextWakeReason: workspace.nextWakeReason,
      redactedStatus,
    }, now.getTime());

  return !deferredMailboxContinuation;
}

export async function readHostedRuntimeReconciliationFacts(
  input: HostedRuntimeReconciliationFactsRequest & {
    decisionSource?: HostedRuntimeReconciliationDecisionSource;
    now?: Date | string;
    processingModeSupported: boolean;
    usageGateMode?: HostedRuntimeReconciliationUsageGateMode;
  },
): Promise<HostedRuntimeReconciliationFacts> {
  const prisma = getPrisma();
  const now = normalizeHostedRuntimeReconciliationDate(input.now);
  const [
    accessActive,
    member,
    workspace,
    maxSeqByLane,
    consumedSeqByLane,
  ] = await Promise.all([
    readActiveHostedMemberAccess({
      memberId: input.userId,
      prisma,
    }),
    readHostedMemberCoreState({
      memberId: input.userId,
      prisma,
    }),
    readHostedWorkspace({ prisma, userId: input.userId }),
    readHostedMailboxMaxSeqByLane({ prisma, userId: input.userId }),
    readHostedMailboxConsumedSeqByLane({
      lanes: ["conversation"],
      prisma,
      userId: input.userId,
    }),
  ]);
  const projectedWorkspace = projectHostedRuntimeReconciliationWorkspace(workspace);
  const redactedStatus = readHostedMailboxRedactedStatusRecord(
    workspace?.redactedStatusJson,
  );
  const mailboxImportLag = maxSeqByLane.map((highWater) =>
    computeHostedMailboxLaneLag({
      highWater,
      redactedStatusJson: redactedStatus,
    })
  );
  const freshConversationMailboxLag = hasHostedFreshConversationMailboxLag({
    consumedSeqByLane,
    mailboxLag: mailboxImportLag,
  });
  const replayMailboxLag = projectHostedRuntimeProcessingMailboxLag({
    consumedSeqByLane,
    mailboxImportLag,
  });
  const conversationWorkPending = hasHostedMailboxLag(
    replayMailboxLag,
    "conversation",
  );
  const processingMode = input.processingModeSupported
    && member
    && member.suspendedAt === null
    && !accessActive
    && conversationWorkPending
    ? "conversation_replay" as const
    : null;
  const mailboxLag = processingMode === "conversation_replay"
    ? replayMailboxLag.filter((laneLag) => laneLag.lane === "conversation")
    : mailboxImportLag;
  const mailboxWorkPending = hasHostedMailboxLag(mailboxLag);

  if (
    !member
    || (!accessActive && processingMode === null)
  ) {
    const facts = buildHostedRuntimeBlockedFacts({
      mailboxLag: [],
      reason: "user_not_active",
      retryAt: projectedWorkspace
        ? readHostedRuntimeFutureTimestamp(projectedWorkspace.inboxMediaRetentionWakeAt, now)
        : null,
      workspace: projectedWorkspace,
    });
    emitHostedRuntimeReconciliationFacts({
      facts,
      request: input,
      usageGateRequired: false,
      usageGateStatus: "not_required",
    });
    return facts;
  }

  if (!projectedWorkspace) {
    const facts = buildHostedRuntimeBlockedFacts({
      mailboxLag,
      reason: "hosted_runtime_not_configured",
      retryAt: null,
      workspace: null,
    });
    emitHostedRuntimeReconciliationFacts({
      facts,
      request: input,
      usageGateRequired: false,
      usageGateStatus: "not_required",
    });
    return facts;
  }

  if (
    processingMode === "conversation_replay"
    && isHostedRuntimeFutureMailboxContinuation({
      nextWakeAt: projectedWorkspace.nextWakeAt,
      nextWakeReason: projectedWorkspace.nextWakeReason,
      redactedStatus,
    }, now.getTime())
  ) {
    const facts = parseHostedRuntimeReconciliationFacts({
      acceptedConversationAt: null,
      acceptedConversationSeq: null,
      blocked: null,
      mailboxLag: [],
      processingMode: null,
      workspace: projectedWorkspace,
    });
    emitHostedRuntimeReconciliationFacts({
      facts,
      request: input,
      usageGateRequired: false,
      usageGateStatus: "not_required",
    });
    return facts;
  }

  if (
    !mailboxWorkPending
    && hostedRuntimeReconciliationNeedsAutomationEngagement({
      freshConversationMailboxLag,
      now,
      workspace: projectedWorkspace,
    })
    && await hasHostedMemberEstablishedLinqRoute({
      memberId: input.userId,
      prisma,
    })
    && !(await hasHostedLinqInboundWithinDays({
      memberId: input.userId,
      now,
      prisma,
    }))
  ) {
    const facts = buildHostedRuntimeBlockedFacts({
      mailboxLag,
      reason: "automation_engagement_paused",
      retryAt: new Date(
        now.getTime() + HOSTED_RUNTIME_RECONCILIATION_ENGAGEMENT_PAUSE_RETRY_MS,
      ).toISOString(),
      workspace: projectedWorkspace,
    });
    emitHostedRuntimeReconciliationFacts({
      facts,
      request: input,
      usageGateRequired: false,
      usageGateStatus: "not_required",
    });
    return facts;
  }

  const acceptedConversationItem = processingMode === "conversation_replay"
    ? await readHostedMailboxEarliestConversationItem({
        afterSeq: readHostedMailboxLaneImportedSeq(replayMailboxLag, "conversation"),
        prisma,
        userId: input.userId,
      })
    : null;
  const usageGateRequired = processingMode === "conversation_replay"
    ? acceptedConversationItem?.consumedAt === null
    : await hostedRuntimeReconciliationNeedsAiUsageGate({
        consumedSeqByLane,
        freshConversationMailboxLag,
        mailboxLag: mailboxImportLag,
        now,
        prisma,
        userId: input.userId,
        workspace: projectedWorkspace,
      });
  const acceptedConversationAt = processingMode === "conversation_replay"
    ? acceptedConversationItem?.createdAt ?? null
    : null;
  const acceptedConversationPeriodStart = processingMode === "conversation_replay"
    ? acceptedConversationItem?.acceptedAllowancePeriodStart ?? null
    : null;
  const acceptedConversationSeq = processingMode === "conversation_replay"
    ? acceptedConversationItem?.laneSeq ?? null
    : null;

  if (usageGateRequired) {
    const gate = await resolveHostedRuntimeAiUsageGate({
      ...(processingMode === "conversation_replay"
        ? {
            access: "accepted_conversation" as const,
            acceptedConversationPeriodStart:
              acceptedConversationPeriodStart ?? undefined,
          }
        : {}),
      mode: input.usageGateMode ?? "mutating",
      now,
      userId: input.userId,
    });

    if (gate.status === "denied") {
      if ((input.usageGateMode ?? "mutating") === "mutating") {
        await sendHostedRuntimeTrialConversionNoticeForPendingConversation({
          consumedSeqByLane,
          decision: gate.decision,
          mailboxLag,
          prisma,
          userId: input.userId,
        });
      }
      const facts = buildHostedRuntimeBlockedFacts({
        mailboxLag,
        reason: "ai_usage_denied",
        retryAt: resolveHostedRuntimeAiBlockedRetryAt({
          aiRetryAt: gate.decision.retryAfter.toISOString(),
          now,
          workspace: projectedWorkspace,
        }),
        workspace: projectedWorkspace,
      });
      emitHostedRuntimeReconciliationFacts({
        facts,
        request: input,
        usageGateRequired: true,
        usageGateStatus: gate.status,
      });
      return facts;
    }

    if (gate.status === "unavailable") {
      const facts = buildHostedRuntimeBlockedFacts({
        mailboxLag,
        reason: "ai_usage_gate_unavailable",
        retryAt: resolveHostedRuntimeAiBlockedRetryAt({
          aiRetryAt: gate.retryAt,
          now,
          workspace: projectedWorkspace,
        }),
        workspace: projectedWorkspace,
      });
      emitHostedRuntimeReconciliationFacts({
        facts,
        request: input,
        usageGateRequired: true,
        usageGateStatus: gate.status,
      });
      return facts;
    }

    const facts = parseHostedRuntimeReconciliationFacts({
      acceptedConversationAt,
      acceptedConversationSeq,
      blocked: null,
      mailboxLag,
      processingMode,
      workspace: projectedWorkspace,
    });
    emitHostedRuntimeReconciliationFacts({
      facts,
      request: input,
      usageGateRequired: true,
      usageGateStatus: gate.status,
    });
    return facts;
  }

  const facts = parseHostedRuntimeReconciliationFacts({
    acceptedConversationAt,
    acceptedConversationSeq,
    blocked: null,
    mailboxLag,
    processingMode,
    workspace: projectedWorkspace,
  });
  emitHostedRuntimeReconciliationFacts({
    facts,
    request: input,
    usageGateRequired: false,
    usageGateStatus: "not_required",
  });
  return facts;
}

function buildHostedRuntimeBlockedFacts(input: {
  mailboxLag: HostedMailboxLaneLag[];
  reason: HostedRuntimeReconciliationBlockedReason;
  retryAt: string | null;
  workspace: HostedRuntimeReconciliationFactsWorkspace | null;
}): HostedRuntimeReconciliationFacts {
  return parseHostedRuntimeReconciliationFacts({
    acceptedConversationAt: null,
    acceptedConversationSeq: null,
    blocked: {
      reason: input.reason,
      retryAt: input.retryAt,
    },
    mailboxLag: input.mailboxLag,
    processingMode: null,
    workspace: input.workspace,
  });
}

async function hostedRuntimeReconciliationNeedsAiUsageGate(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  freshConversationMailboxLag: boolean;
  mailboxLag: readonly HostedMailboxLaneLag[];
  now: Date;
  prisma: Parameters<typeof readHostedMailboxMaxSeqByLane>[0]["prisma"];
  userId: string;
  workspace: HostedRuntimeReconciliationFactsWorkspace;
}): Promise<boolean> {
  if (input.freshConversationMailboxLag) {
    return true;
  }

  if (hasHostedMailboxLag(input.mailboxLag, "system")) {
    const gatedSystemItemPending =
      await readHostedMailboxPendingSystemItemsNeedAiUsageGate({
        afterSeq: readHostedMailboxLaneImportedSeq(input.mailboxLag, "system"),
        prisma: input.prisma,
        userId: input.userId,
      });
    if (gatedSystemItemPending) {
      return true;
    }
  }

  return isHostedRuntimeWakeDue(input.workspace.nextWakeAt, input.now)
    && isHostedRuntimeModelCapableWorkspaceWakeReason(input.workspace.nextWakeReason);
}

function hostedRuntimeReconciliationNeedsAutomationEngagement(input: {
  freshConversationMailboxLag: boolean;
  now: Date;
  workspace: HostedRuntimeReconciliationFactsWorkspace;
}): boolean {
  return !input.freshConversationMailboxLag
    && isHostedRuntimeWakeDue(input.workspace.nextWakeAt, input.now)
    && isHostedRuntimeModelCapableWorkspaceWakeReason(input.workspace.nextWakeReason);
}

async function hasHostedMemberEstablishedLinqRoute(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  if (await hasHostedMemberEstablishedLinqHomeRoute(input)) {
    return true;
  }

  return await hasHostedMemberEstablishedLinqThreadRoute(input);
}

function resolveHostedRuntimeAiBlockedRetryAt(input: {
  aiRetryAt: string | null;
  now: Date;
  workspace: HostedRuntimeReconciliationFactsWorkspace;
}): string | null {
  return earliestHostedRuntimeReconciliationTimestamp([
    input.aiRetryAt,
    readHostedRuntimeFutureTimestamp(input.workspace.inboxMediaRetentionWakeAt, input.now),
  ]);
}

async function sendHostedRuntimeTrialConversionNoticeForPendingConversation(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  decision: HostedRuntimeDeniedAiUsageDecision;
  mailboxLag: readonly HostedMailboxLaneLag[];
  prisma: PrismaClient;
  userId: string;
}): Promise<void> {
  const decision = input.decision;
  if (
    decision.reason !== "trial_expired_pending_billing"
    || decision.userNotice?.code !== "trial_conversion_pending"
    || !hasHostedFreshConversationMailboxLag({
      consumedSeqByLane: input.consumedSeqByLane,
      mailboxLag: input.mailboxLag,
    })
  ) {
    return;
  }

  const wake = await readHostedRuntimePendingTrialConversionWake({
    consumedSeqByLane: input.consumedSeqByLane,
    mailboxLag: input.mailboxLag,
    prisma: input.prisma,
    userId: input.userId,
  });
  if (!wake) {
    return;
  }

  await sendHostedTrialConversionNoticeToLinqChat({
    chatId: wake.message.linqMessage.chatId,
    memberId: input.userId,
    message: decision.userNotice.message,
    occurredAt: wake.occurredAt,
    prisma: input.prisma,
    replyToMessageId: wake.message.linqMessage.messageId,
    routeAuthority: wake.message.routeAuthority ?? null,
    sourceEventId: wake.eventId,
  });
}

async function readHostedRuntimePendingTrialConversionWake(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  mailboxLag: readonly HostedMailboxLaneLag[];
  prisma: NonNullable<Parameters<typeof readHostedMailboxPayload>[0]["prisma"]>;
  userId: string;
}): Promise<
  | (HostedExecutionConversationMessageWake & {
      message: HostedExecutionLinqConversationMessagePayload;
    })
  | null
> {
  const afterSeq = readHostedConversationFreshWorkFloor({
    consumedSeqByLane: input.consumedSeqByLane,
    mailboxLag: input.mailboxLag,
  }).toString();

  // Trial-conversion notices are best-effort for the current pending input.
  // Do not decode an unbounded conversation backlog here.
  const pendingItem = await readHostedMailboxLatestPendingConversationItem({
    afterSeq,
    prisma: input.prisma,
    userId: input.userId,
  });
  if (!pendingItem) {
    return null;
  }
  const pendingSeq = parseHostedMailboxReconciliationSeq(pendingItem.laneSeq);
  const cursorSeq = parseHostedMailboxReconciliationSeq(afterSeq);
  if (pendingSeq === null || cursorSeq === null || pendingSeq <= cursorSeq) {
    return null;
  }

  const wake = await readHostedRuntimePendingConversationWake({
    item: pendingItem,
    prisma: input.prisma,
  });
  if (wake && isHostedLinqConversationMessageWake(wake)) {
    return wake;
  }
  return null;
}

async function readHostedRuntimePendingConversationWake(input: {
  item: Awaited<ReturnType<typeof readHostedMailboxLatestPendingConversationItem>>;
  prisma: NonNullable<Parameters<typeof readHostedMailboxPayload>[0]["prisma"]>;
}): Promise<HostedExecutionWake | null> {
  if (!input.item) {
    return null;
  }

  const payload = input.item.payloadRef
    ? await readHostedMailboxPayload({
        dedupeKey: input.item.dedupeKey,
        mailboxItemId: input.item.id,
        payloadRef: input.item.payloadRef,
        prisma: input.prisma,
        userId: input.item.userId,
      })
    : null;
  const decoded = await decodeHostedMailboxStoredPayload({
    dedupeKey: input.item.dedupeKey,
    kind: input.item.kind,
    lane: input.item.lane,
    laneSeq: input.item.laneSeq,
    mailboxItemId: input.item.id,
    occurredAt: input.item.occurredAt,
    payloadCiphertext: payload?.payloadCiphertext ?? null,
    payloadInlineCiphertext: input.item.payloadInlineCiphertext,
    payloadSchema: input.item.payloadSchema,
    prisma: input.prisma,
    userId: input.item.userId,
  });

  return decoded ? parseHostedExecutionWake(decoded) : null;
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

function hasHostedFreshConversationMailboxLag(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  mailboxLag: readonly HostedMailboxLaneLag[];
}): boolean {
  const maxSeq = parseHostedMailboxReconciliationSeq(
    input.mailboxLag.find((laneLag) => laneLag.lane === "conversation")?.maxSeq,
  );
  if (maxSeq === null) {
    return false;
  }

  return maxSeq > readHostedConversationFreshWorkFloor(input);
}

function projectHostedRuntimeProcessingMailboxLag(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  mailboxImportLag: readonly HostedMailboxLaneLag[];
}): HostedMailboxLaneLag[] {
  const consumedSeq = parseHostedMailboxReconciliationSeq(
    input.consumedSeqByLane.find((entry) => entry.lane === "conversation")?.consumedSeq,
  ) ?? 0n;

  return input.mailboxImportLag.map((laneLag) => {
    if (laneLag.lane !== "conversation") {
      return laneLag;
    }

    const importedSeq = parseHostedMailboxReconciliationSeq(laneLag.importedSeq) ?? 0n;
    const processingSeq = importedSeq < consumedSeq ? importedSeq : consumedSeq;
    const maxSeq = parseHostedMailboxReconciliationSeq(laneLag.maxSeq) ?? 0n;

    return {
      ...laneLag,
      importedSeq: processingSeq.toString(),
      lag: (maxSeq > processingSeq ? maxSeq - processingSeq : 0n).toString(),
    };
  });
}

function readHostedConversationFreshWorkFloor(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  mailboxLag: readonly HostedMailboxLaneLag[];
}): bigint {
  const importedSeq = parseHostedMailboxReconciliationSeq(
    readHostedMailboxLaneImportedSeq(input.mailboxLag, "conversation"),
  ) ?? 0n;
  const consumedSeq = parseHostedMailboxReconciliationSeq(
    input.consumedSeqByLane.find((entry) => entry.lane === "conversation")?.consumedSeq,
  ) ?? 0n;

  return consumedSeq > importedSeq ? consumedSeq : importedSeq;
}

function parseHostedMailboxReconciliationSeq(
  value: string | null | undefined,
): bigint | null {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? BigInt(value)
    : null;
}

function readHostedMailboxLaneImportedSeq(
  mailboxLag: readonly HostedMailboxLaneLag[],
  lane: HostedMailboxLaneLag["lane"],
): string {
  return mailboxLag.find((laneLag) => laneLag.lane === lane)?.importedSeq ?? "0";
}

function emitHostedRuntimeReconciliationFacts(event: {
  facts: HostedRuntimeReconciliationFacts;
  request: HostedRuntimeReconciliationFactsRequest & {
    decisionSource?: HostedRuntimeReconciliationDecisionSource;
  };
  usageGateRequired: boolean;
  usageGateStatus: HostedRuntimeReconciliationUsageGateStatus;
}): void {
  console.info("Hosted runtime reconciliation facts.", {
    blockedReason: event.facts.blocked?.reason ?? null,
    component: "hosted.orchestration.reconciliation",
    conversationLagPresent: hasHostedMailboxLag(event.facts.mailboxLag, "conversation"),
    decisionSource: event.request.decisionSource ?? "workflow",
    mailboxLagLaneCount: event.facts.mailboxLag.length,
    retryAtPresent: event.facts.blocked?.retryAt !== null
      && event.facts.blocked?.retryAt !== undefined,
    schema: HOSTED_RUNTIME_RECONCILIATION_FACTS_LOG_SCHEMA,
    status: event.facts.blocked
      ? "blocked"
      : hasHostedMailboxLag(event.facts.mailboxLag)
        ? "work_pending"
        : "idle",
    usageGateRequired: event.usageGateRequired,
    usageGateStatus: event.usageGateStatus,
    userIdPresent: event.request.userId.length > 0,
    workspaceInboxMediaRetentionWakeAtPresent:
      event.facts.workspace?.inboxMediaRetentionWakeAt !== null
        && event.facts.workspace?.inboxMediaRetentionWakeAt !== undefined,
    workspaceNextWakeAtPresent:
      event.facts.workspace?.nextWakeAt !== null
        && event.facts.workspace?.nextWakeAt !== undefined,
    workspaceNextWakeReason: describeHostedRuntimeWakeReasonForLog(
      event.facts.workspace?.nextWakeReason ?? null,
    ),
    workspacePresent: event.facts.workspace !== null,
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

function isHostedRuntimeWakeDue(value: string | null, now: Date): boolean {
  const timestamp = readHostedRuntimeReconciliationTimestamp(value);
  return timestamp !== null && timestamp <= now.getTime();
}

function readHostedRuntimeFutureTimestamp(value: string | null, now: Date): string | null {
  const timestamp = readHostedRuntimeReconciliationTimestamp(value);
  if (timestamp === null || timestamp <= now.getTime()) {
    return null;
  }

  return value;
}

function earliestHostedRuntimeReconciliationTimestamp(
  values: readonly (string | null)[],
): string | null {
  let selected: string | null = null;
  let selectedMs = Number.POSITIVE_INFINITY;
  for (const value of values) {
    const timestamp = readHostedRuntimeReconciliationTimestamp(value);
    if (timestamp === null || timestamp >= selectedMs) {
      continue;
    }
    selected = value;
    selectedMs = timestamp;
  }

  return selected;
}

function readHostedRuntimeReconciliationTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function projectHostedRuntimeReconciliationWorkspace(
  workspace: HostedWorkspaceRecord | null,
): HostedRuntimeReconciliationFactsWorkspace | null {
  return workspace
    ? {
        inboxMediaRetentionWakeAt: workspace.inboxMediaRetentionWakeAt,
        nextWakeAt: workspace.nextWakeAt,
        nextWakeReason: workspace.nextWakeReason,
        version: workspace.version,
      }
    : null;
}

function normalizeHostedRuntimeReconciliationDate(
  value: Date | string | undefined,
): Date {
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
