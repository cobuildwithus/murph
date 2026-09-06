import {
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionConversationMessageWake,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionWake,
  parseHostedRuntimeReconciliationFacts,
} from "@murphai/hosted-execution/parsers";
import {
  classifyHostedSystemMailboxExecutionClass,
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
  type HostedRuntimeReconciliationBlockedReason,
  type HostedRuntimeReconciliationFacts,
  type HostedRuntimeReconciliationFactsRequest,
  type HostedRuntimeReconciliationFactsWorkspace,
  type HostedRuntimeSystemMailboxFrontierClass,
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
  readHostedMailboxConversationAiUsageHighWater,
  readHostedMailboxConversationAiUsageReplayFloor,
} from "../hosted-mailbox/ai-usage-gate";
import {
  decodeHostedMailboxStoredPayload,
  hasHostedMailboxMealPhotoCaptureSince,
  readHostedMailboxConsumedSeqByLane,
  readHostedMailboxFirstLiveSystemItemAfterSeq,
  readHostedMailboxLatestPendingConversationItem,
  readHostedMailboxMaxSeqByLane,
  readHostedMailboxPayload,
  tryMarkHostedMailboxConversationAiUsageDenied,
} from "../hosted-mailbox/store";
import {
  sendClaimedHostedAiUsageLimitNoticeToLinqChat,
  sendClaimedHostedAiUsageLimitNoticeToTelegramThread,
} from "../hosted-execution/usage-limit-notice";
import { projectHostedAiUsageLimitNoticeForDelivery } from "../hosted-execution/usage-limit-notice-message";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import {
  hasHostedMemberEstablishedLinqHomeRoute,
} from "../hosted-onboarding/hosted-member-routing-store";
import {
  HOSTED_AUTOMATION_ENGAGEMENT_WINDOW_DAYS,
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
import { readHostedHealthDataConsentState } from "../legal/consent";
import {
  resolveHostedRuntimeAiUsageGate,
  type HostedRuntimeUsageGateCheck,
} from "./runtime-usage-decision";
import {
  readSelectedHostedInferenceConnectionOverride,
} from "../hosted-inference/connection-store";

type HostedRuntimeReconciliationUsageGateStatus =
  | HostedRuntimeUsageGateCheck["status"]
  | "not_required";

type HostedRuntimeReconciliationUsageGateMode = "mutating" | "read_only";
type HostedRuntimeReconciliationDecisionSource = "workflow" | "status";
type HostedRuntimeDeniedAiUsageDecision =
  Extract<HostedRuntimeUsageGateCheck, { status: "denied" }>["decision"];

export type HostedRuntimeReconciliationFactsStage =
  | "canonical_access_workspace"
  | "canonical_consent"
  | "canonical_mailbox"
  | "canonical_projection"
  | "canonical_usage";

const HOSTED_RUNTIME_RECONCILIATION_FACTS_LOG_SCHEMA =
  "murph.hosted-runtime.reconciliation-facts.v1";
const HOSTED_RUNTIME_RECONCILIATION_ENGAGEMENT_PAUSE_RETRY_MS =
  24 * 60 * 60 * 1000;

export async function readHostedRuntimeOwnerReleaseActionable(input: {
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
  const deferredMailboxContinuation =
    isHostedRuntimeFutureMailboxContinuation({
      nextWakeAt: workspace.nextWakeAt,
      nextWakeReason: workspace.nextWakeReason,
      redactedStatus,
    }, now.getTime());
  if (hasHostedMailboxLag(mailboxLag) && !deferredMailboxContinuation) {
    return true;
  }

  return await readHostedRuntimeSystemMailboxFrontier({
    at: now,
    handledThroughSeq:
      readHostedRuntimeSystemHandledThroughSeq(workspace.redactedStatusJson)
        ?? "0",
    maxSeqByLane,
    prisma,
    userId: input.userId,
  }) !== null;
}

export async function readHostedRuntimeReconciliationFacts(
  input: HostedRuntimeReconciliationFactsRequest & {
    decisionSource?: HostedRuntimeReconciliationDecisionSource;
    now?: Date | string;
    usageGateMode?: HostedRuntimeReconciliationUsageGateMode;
  },
  reportStage?: (stage: HostedRuntimeReconciliationFactsStage) => void,
): Promise<HostedRuntimeReconciliationFacts> {
  reportStage?.("canonical_access_workspace");
  const prisma = getPrisma();
  const now = normalizeHostedRuntimeReconciliationDate(input.now);
  const [hasActiveAccess, workspace] = await Promise.all([
    readActiveHostedMemberAccess({
      memberId: input.userId,
      prisma,
    }),
    readHostedWorkspace({ prisma, userId: input.userId }),
  ]);
  reportStage?.("canonical_projection");
  const projectedWorkspace = projectHostedRuntimeReconciliationWorkspace(workspace);

  if (!hasActiveAccess) {
    const facts = buildHostedRuntimeBlockedFacts({
      mailboxLag: [],
      reason: "user_not_active",
      retryAt: projectedWorkspace
        ? readHostedRuntimeFutureTimestamp(projectedWorkspace.inboxMediaRetentionWakeAt, now)
        : null,
      workspace: projectedWorkspace
        ? {
            ...projectedWorkspace,
            systemMailboxFrontier: null,
          }
        : null,
    });
    emitHostedRuntimeReconciliationFacts({
      facts,
      request: input,
      usageGateRequired: false,
      usageGateStatus: "not_required",
    });
    return facts;
  }

  reportStage?.("canonical_consent");
  const healthDataConsentState = await readHostedHealthDataConsentState({
    memberId: input.userId,
    prisma,
  });
  reportStage?.("canonical_projection");
  if (healthDataConsentState === "revoked") {
    const facts = buildHostedRuntimeBlockedFacts({
      mailboxLag: [],
      reason: "health_data_consent_withdrawn",
      retryAt: null,
      workspace: projectedWorkspace,
    });
    emitHostedRuntimeReconciliationFacts({
      facts,
      request: input,
      usageGateRequired: false,
      usageGateStatus: "health_data_consent_withdrawn",
    });
    return facts;
  }

  reportStage?.("canonical_mailbox");
  const [
    maxSeqByLane,
    consumedSeqByLane,
  ] = await Promise.all([
    readHostedMailboxMaxSeqByLane({ prisma, userId: input.userId }),
    readHostedMailboxConsumedSeqByLane({
      lanes: ["conversation"],
      prisma,
      userId: input.userId,
    }),
  ]);
  reportStage?.("canonical_projection");
  const redactedStatus = readHostedMailboxRedactedStatusRecord(
    workspace?.redactedStatusJson,
  );
  const mailboxLag = maxSeqByLane.map((highWater) =>
    computeHostedMailboxLaneLag({
      highWater,
      redactedStatusJson: redactedStatus,
    })
  );

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

  reportStage?.("canonical_mailbox");
  const workspaceWithSystemMailboxFrontier = {
    ...projectedWorkspace,
    systemMailboxFrontier: await readHostedRuntimeSystemMailboxFrontier({
      at: now,
      handledThroughSeq:
        projectedWorkspace.hostedMailboxSystemHandledThroughSeq ?? "0",
      maxSeqByLane,
      prisma,
      userId: input.userId,
    }),
  } satisfies HostedRuntimeReconciliationFactsWorkspace;

  reportStage?.("canonical_projection");
  const freshConversationMailboxLag = hasHostedFreshConversationMailboxLag({
    consumedSeqByLane,
    mailboxLag,
  });

  if (
    hostedRuntimeReconciliationNeedsAutomationEngagement({
      freshConversationMailboxLag,
      now,
      workspace: workspaceWithSystemMailboxFrontier,
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
    && !(await hasHostedMailboxMealPhotoCaptureSince({
      prisma,
      since: new Date(
        now.getTime()
          - HOSTED_AUTOMATION_ENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ),
      userId: input.userId,
    }))
  ) {
    const facts = buildHostedRuntimeBlockedFacts({
      mailboxLag,
      reason: "automation_engagement_paused",
      retryAt: new Date(
        now.getTime() + HOSTED_RUNTIME_RECONCILIATION_ENGAGEMENT_PAUSE_RETRY_MS,
      ).toISOString(),
      workspace: workspaceWithSystemMailboxFrontier,
    });
    emitHostedRuntimeReconciliationFacts({
      facts,
      request: input,
      usageGateRequired: false,
      usageGateStatus: "not_required",
    });
    return facts;
  }

  reportStage?.("canonical_usage");
  const usageGateRequired = hostedRuntimeReconciliationNeedsAiUsageGate({
    freshConversationMailboxLag,
    now,
    workspace: workspaceWithSystemMailboxFrontier,
  });

  if (usageGateRequired) {
    const [gate, selectedCustomInference] = await Promise.all([
      resolveHostedRuntimeAiUsageGate({
        mode: input.usageGateMode ?? "mutating",
        now,
        userId: input.userId,
      }),
      readSelectedHostedInferenceConnectionOverride({
        memberId: input.userId,
        prisma,
      }),
    ]);

    if (gate.status === "health_data_consent_withdrawn") {
      reportStage?.("canonical_projection");
      const facts = buildHostedRuntimeBlockedFacts({
        mailboxLag,
        reason: "health_data_consent_withdrawn",
        retryAt: null,
        workspace: workspaceWithSystemMailboxFrontier,
      });
      emitHostedRuntimeReconciliationFacts({
        facts,
        request: input,
        usageGateRequired: true,
        usageGateStatus: gate.status,
      });
      return facts;
    }

    if (gate.status === "denied" && !selectedCustomInference) {
      let noticeRetryAt: Date | null = null;
      if ((input.usageGateMode ?? "mutating") === "mutating") {
        if (freshConversationMailboxLag) {
          await tryMarkHostedMailboxConversationAiUsageDenied({
            afterConversationLaneSeq: readHostedConversationFreshWorkFloor({
              consumedSeqByLane,
              mailboxLag,
            }),
            prisma,
            throughConversationLaneSeq:
              readHostedMailboxConversationAiUsageHighWater({
                lanes: mailboxLag,
              }),
            userId: input.userId,
          });
        }
        noticeRetryAt = await sendHostedRuntimeUsageDeniedNoticeForPendingConversation({
          consumedSeqByLane,
          decision: gate.decision,
          mailboxLag,
          prisma,
          userId: input.userId,
        });
      }
      reportStage?.("canonical_projection");
      const facts = buildHostedRuntimeBlockedFacts({
        mailboxLag,
        reason: "ai_usage_denied",
        retryAt: resolveHostedRuntimeAiBlockedRetryAt({
          aiRetryAt: gate.decision.retryAfter.toISOString(),
          noticeRetryAt,
          now,
          workspace: workspaceWithSystemMailboxFrontier,
        }),
        workspace: workspaceWithSystemMailboxFrontier,
      });
      emitHostedRuntimeReconciliationFacts({
        facts,
        request: input,
        usageGateRequired: true,
        usageGateStatus: gate.status,
      });
      return facts;
    }

    reportStage?.("canonical_projection");
    const facts = parseHostedRuntimeReconciliationFacts({
      blocked: null,
      mailboxLag,
      workspace: workspaceWithSystemMailboxFrontier,
    });
    emitHostedRuntimeReconciliationFacts({
      facts,
      request: input,
      usageGateRequired: true,
      usageGateStatus: gate.status,
    });
    return facts;
  }

  reportStage?.("canonical_projection");
  const facts = parseHostedRuntimeReconciliationFacts({
    blocked: null,
    mailboxLag,
    workspace: workspaceWithSystemMailboxFrontier,
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
    blocked: {
      reason: input.reason,
      retryAt: input.retryAt,
    },
    mailboxLag: input.mailboxLag,
    workspace: input.workspace,
  });
}

function hostedRuntimeReconciliationNeedsAiUsageGate(input: {
  freshConversationMailboxLag: boolean;
  now: Date;
  workspace: HostedRuntimeReconciliationFactsWorkspace;
}): boolean {
  const defaultProcessingWake = readHostedRuntimeDefaultProcessingWake(
    input.workspace,
  );
  if (
    defaultProcessingWake.reason === HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON
    && isHostedRuntimeWakeDue(defaultProcessingWake.at, input.now)
  ) {
    return false;
  }

  if (input.freshConversationMailboxLag) {
    return true;
  }

  return isHostedRuntimeWakeDue(defaultProcessingWake.at, input.now)
    && isHostedRuntimeModelCapableWorkspaceWakeReason(defaultProcessingWake.reason);
}

function hostedRuntimeReconciliationNeedsAutomationEngagement(input: {
  freshConversationMailboxLag: boolean;
  now: Date;
  workspace: HostedRuntimeReconciliationFactsWorkspace;
}): boolean {
  const defaultProcessingWake = readHostedRuntimeDefaultProcessingWake(
    input.workspace,
  );
  return !input.freshConversationMailboxLag
    && isHostedRuntimeWakeDue(defaultProcessingWake.at, input.now)
    && isHostedRuntimeModelCapableWorkspaceWakeReason(defaultProcessingWake.reason);
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
  noticeRetryAt: Date | null;
  now: Date;
  workspace: HostedRuntimeReconciliationFactsWorkspace;
}): string | null {
  const defaultProcessingWake = readHostedRuntimeDefaultProcessingWake(
    input.workspace,
  );
  return earliestHostedRuntimeReconciliationTimestamp([
    input.noticeRetryAt?.toISOString() ?? null,
    input.aiRetryAt,
    defaultProcessingWake.reason === HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON
      ? readHostedRuntimeFutureTimestamp(defaultProcessingWake.at, input.now)
      : null,
    readHostedRuntimeFutureTimestamp(input.workspace.inboxMediaRetentionWakeAt, input.now),
  ]);
}

async function sendHostedRuntimeUsageDeniedNoticeForPendingConversation(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  decision: HostedRuntimeDeniedAiUsageDecision;
  mailboxLag: readonly HostedMailboxLaneLag[];
  prisma: PrismaClient;
  userId: string;
}): Promise<Date | null> {
  const decision = input.decision;
  if (
    decision.reason !== "ai_usage_limit_exceeded"
    || !decision.userNotice
    || !hasHostedFreshConversationMailboxLag({
      consumedSeqByLane: input.consumedSeqByLane,
      mailboxLag: input.mailboxLag,
    })
  ) {
    return null;
  }

  const wake = await readHostedRuntimePendingUsageDeniedNoticeWake({
    consumedSeqByLane: input.consumedSeqByLane,
    mailboxLag: input.mailboxLag,
    prisma: input.prisma,
    userId: input.userId,
  });
  if (!wake) {
    return null;
  }

  const attemptedAt = new Date();
  if (isHostedLinqConversationMessageWake(wake)) {
    const result = await sendClaimedHostedAiUsageLimitNoticeToLinqChat({
      chatId: wake.message.linqMessage.chatId,
      claimToken: {
        periodStart: decision.periodStart.toISOString(),
        planResetAt: decision.planResetAt?.toISOString() ?? null,
        sentAt: attemptedAt.toISOString(),
        usageCreditLedgerVersion: decision.usageCreditLedgerVersion.toString(),
      },
      memberId: input.userId,
      message: await projectHostedAiUsageLimitNoticeForDelivery({
        memberId: input.userId,
        message: decision.userNotice.message,
        noticeCode: decision.userNotice.code,
        prisma: input.prisma,
      }),
      noticeCode: decision.userNotice.code,
      occurredAt: wake.occurredAt,
      prisma: input.prisma,
      replyToMessageId: wake.message.linqMessage.messageId,
      routeAuthority: wake.message.routeAuthority ?? null,
      sourceEventId: wake.eventId,
    });
    return result.status === "in_flight" ? result.retryAt : null;
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    const result = await sendClaimedHostedAiUsageLimitNoticeToTelegramThread({
      memberId: input.userId,
      message: await projectHostedAiUsageLimitNoticeForDelivery({
        memberId: input.userId,
        message: decision.userNotice.message,
        noticeCode: decision.userNotice.code,
        prisma: input.prisma,
      }),
      noticeCode: decision.userNotice.code,
      periodStart: decision.periodStart,
      planResetAt: decision.planResetAt,
      prisma: input.prisma,
      replyToMessageId: wake.message.telegramMessage.messageId,
      sentAt: attemptedAt,
      sourceEventId: wake.eventId,
      target: wake.message.telegramMessage.threadId,
      usageCreditLedgerVersion: decision.usageCreditLedgerVersion,
    });
    return result.status === "in_flight" ? result.retryAt : null;
  }

  return null;
}

async function readHostedRuntimePendingUsageDeniedNoticeWake(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  mailboxLag: readonly HostedMailboxLaneLag[];
  prisma: NonNullable<Parameters<typeof readHostedMailboxPayload>[0]["prisma"]>;
  userId: string;
}): Promise<
  | HostedExecutionConversationMessageWake
  | null
> {
  const afterSeq = readHostedConversationFreshWorkFloor({
    consumedSeqByLane: input.consumedSeqByLane,
    mailboxLag: input.mailboxLag,
  }).toString();

  // Usage-denial notices target only the current pending input.
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
  if (wake?.kind === "conversation.message") {
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

function readHostedConversationFreshWorkFloor(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  mailboxLag: readonly HostedMailboxLaneLag[];
}): bigint {
  return readHostedMailboxConversationAiUsageReplayFloor({
    consumedSeqByLane: input.consumedSeqByLane,
    lanes: input.mailboxLag,
  });
}

function parseHostedMailboxReconciliationSeq(
  value: string | null | undefined,
): bigint | null {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? BigInt(value)
    : null;
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
    workspaceNextDefaultProcessingWakeAtPresent:
      event.facts.workspace?.nextDefaultProcessingWakeAt !== null
        && event.facts.workspace?.nextDefaultProcessingWakeAt !== undefined,
    workspaceNextDefaultProcessingWakeReason:
      describeHostedRuntimeWakeReasonForLog(
        event.facts.workspace?.nextDefaultProcessingWakeReason ?? null,
      ),
    workspaceSystemMailboxProgressGenerationPresent:
      event.facts.workspace?.systemMailboxProgressGeneration !== undefined,
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
    case HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON:
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
  if (reason === HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON) {
    return false;
  }
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
  const handledThroughSeq = workspace
    ? readHostedRuntimeSystemHandledThroughSeq(workspace.redactedStatusJson)
    : undefined;
  return workspace
    ? {
        ...(handledThroughSeq === undefined
          ? {}
          : { hostedMailboxSystemHandledThroughSeq: handledThroughSeq }),
        inboxMediaRetentionWakeAt: workspace.inboxMediaRetentionWakeAt,
        ...(workspace.systemMailboxProgressGeneration === null
          ? {}
          : {
              nextDefaultProcessingWakeAt:
                workspace.nextDefaultProcessingWakeAt,
              nextDefaultProcessingWakeReason:
                workspace.nextDefaultProcessingWakeReason,
              systemMailboxProgressGeneration:
                workspace.systemMailboxProgressGeneration,
            }),
        nextWakeAt: workspace.nextWakeAt,
        nextWakeReason: workspace.nextWakeReason,
        version: workspace.version,
      }
    : null;
}

function readHostedRuntimeDefaultProcessingWake(
  workspace: HostedRuntimeReconciliationFactsWorkspace,
): { at: string | null; reason: string | null } {
  return workspace.systemMailboxProgressGeneration === undefined
    ? {
        at: workspace.nextWakeAt,
        reason: workspace.nextWakeReason,
      }
    : {
        at: workspace.nextDefaultProcessingWakeAt ?? null,
        reason: workspace.nextDefaultProcessingWakeReason ?? null,
      };
}

async function readHostedRuntimeSystemMailboxFrontier(input: {
  at: Date;
  handledThroughSeq: string;
  maxSeqByLane: readonly { lane: string; maxSeq: string }[];
  prisma: PrismaClient;
  userId: string;
}): Promise<HostedRuntimeSystemMailboxFrontierClass | null> {
  const systemMaxSeq = input.maxSeqByLane.find(({ lane }) => lane === "system")
    ?.maxSeq ?? "0";
  if (BigInt(systemMaxSeq) <= BigInt(input.handledThroughSeq)) {
    return null;
  }

  const frontier = await readHostedMailboxFirstLiveSystemItemAfterSeq({
    afterSeq: input.handledThroughSeq,
    at: input.at,
    prisma: input.prisma,
    userId: input.userId,
  });
  if (!frontier) {
    return null;
  }

  return classifyHostedFirstLiveSystemItemOwnership(frontier);
}

export function classifyHostedFirstLiveSystemItemOwnership(input: {
  dedupeKey: string | null | undefined;
  kind: string;
}): HostedRuntimeSystemMailboxFrontierClass {
  return classifyHostedSystemMailboxExecutionClass(input);
}

function readHostedRuntimeSystemHandledThroughSeq(
  redactedStatusJson: HostedWorkspaceRecord["redactedStatusJson"],
): string | undefined {
  const value = readHostedMailboxRedactedStatusRecord(redactedStatusJson)?.[
    "hostedMailboxSystemHandledThroughSeq"
  ];
  return typeof value === "string" && /^[0-9]+$/u.test(value)
    ? value
    : undefined;
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
