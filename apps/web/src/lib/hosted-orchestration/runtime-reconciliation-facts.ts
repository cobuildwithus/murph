import {
  isHostedEmailConversationMessageWake,
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  isHostedWhatsAppConversationMessageWake,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  readCloudflareHostedControlHttpError,
} from "@murphai/cloudflare-hosted-control/client";
import {
  parseTelegramThreadTarget,
} from "@murphai/messaging-ingress/telegram-webhook";
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
  readHostedMailboxLatestPendingConversationItem,
  readHostedMailboxPendingSystemItemsNeedAiUsageGate,
  readHostedMailboxMaxSeqByLane,
  readHostedMailboxPayload,
} from "../hosted-mailbox/store";
import {
  readHostedExecutionControlClientIfConfigured,
} from "../hosted-execution/control";
import {
  type HostedAiUsageLimitNoticeDeliveryResult,
  sendHostedAiUsageDeniedResponseToLinqChat,
} from "../hosted-execution/usage-limit-notice";
import {
  HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
  startHostedAiUsageDeniedResponseDispatchTx,
} from "../hosted-onboarding/linq-delivery-store";
import {
  formatHostedPersonalAiUsageStatusForConversation,
  projectHostedPersonalAiUsageStatus,
} from "../hosted-execution/usage-status";
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

const HOSTED_RUNTIME_RECONCILIATION_FACTS_LOG_SCHEMA =
  "murph.hosted-runtime.reconciliation-facts.v1";
const HOSTED_TELEGRAM_USAGE_LIMIT_NOTICE_TIMEOUT_MS = 40_000;
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
    usageGateMode?: HostedRuntimeReconciliationUsageGateMode;
  },
): Promise<HostedRuntimeReconciliationFacts> {
  const prisma = getPrisma();
  const now = normalizeHostedRuntimeReconciliationDate(input.now);
  const [member, workspace] = await Promise.all([
    readHostedMemberCoreState({
      memberId: input.userId,
      prisma,
    }),
    readHostedWorkspace({ prisma, userId: input.userId }),
  ]);
  const projectedWorkspace = projectHostedRuntimeReconciliationWorkspace(workspace);

  if (!member || !(await readActiveHostedMemberAccess({
    memberId: input.userId,
    prisma,
  }))) {
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

  const [maxSeqByLane, consumedSeqByLane] = await Promise.all([
    readHostedMailboxMaxSeqByLane({ prisma, userId: input.userId }),
    readHostedMailboxConsumedSeqByLane({
      lanes: ["conversation"],
      prisma,
      userId: input.userId,
    }),
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

  const freshConversationMailboxLag = hasHostedFreshConversationMailboxLag({
    consumedSeqByLane,
    mailboxLag,
  });

  if (
    hostedRuntimeReconciliationNeedsAutomationEngagement({
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

  const usageGateRequired = await hostedRuntimeReconciliationNeedsAiUsageGate({
    consumedSeqByLane,
    freshConversationMailboxLag,
    mailboxLag,
    now,
    prisma,
    userId: input.userId,
    workspace: projectedWorkspace,
  });

  if (usageGateRequired) {
    const gate = await resolveHostedRuntimeAiUsageGate({
      mode: input.usageGateMode ?? "mutating",
      now,
      userId: input.userId,
    });

    if (gate.status === "denied") {
      let usageNoticeResult: HostedRuntimeAiUsageLimitNoticeResult = {
        status: "not_applicable",
      };
      if ((input.usageGateMode ?? "mutating") === "mutating") {
        usageNoticeResult = await sendHostedRuntimeAiUsageLimitNoticeForPendingConversation({
          consumedSeqByLane,
          gate,
          mailboxLag,
          now,
          prisma,
          userId: input.userId,
        });
      }
      const facts = buildHostedRuntimeBlockedFacts({
        mailboxLag,
        reason: "ai_usage_denied",
        retryAt: resolveHostedRuntimeAiBlockedRetryAt({
          aiRetryAt: earliestHostedRuntimeReconciliationTimestamp([
            gate.decision.retryAfter.toISOString(),
            usageNoticeResult.status === "in_flight"
              ? usageNoticeResult.retryAt
              : null,
          ]),
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
      blocked: null,
      mailboxLag,
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
    blocked: null,
    mailboxLag,
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
    blocked: {
      reason: input.reason,
      retryAt: input.retryAt,
    },
    mailboxLag: input.mailboxLag,
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

type HostedRuntimeAiUsageLimitNoticeResult =
  | { status: "already_notified" }
  | { retryAt: string; status: "in_flight" }
  | { status: "not_applicable" }
  | { status: "sent" };

async function sendHostedRuntimeAiUsageLimitNoticeForPendingConversation(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  gate: Extract<HostedRuntimeUsageGateCheck, { status: "denied" }>;
  mailboxLag: readonly HostedMailboxLaneLag[];
  now: Date;
  prisma: PrismaClient;
  userId: string;
}): Promise<HostedRuntimeAiUsageLimitNoticeResult> {
  const decision = input.gate.decision;
  if (
    !hasHostedFreshConversationMailboxLag({
      consumedSeqByLane: input.consumedSeqByLane,
      mailboxLag: input.mailboxLag,
    })
  ) {
    return { status: "not_applicable" };
  }

  const wake = await readHostedRuntimePendingUsageNoticeWake({
    consumedSeqByLane: input.consumedSeqByLane,
    mailboxLag: input.mailboxLag,
    prisma: input.prisma,
    userId: input.userId,
  });
  if (!wake) {
    return { status: "not_applicable" };
  }

  const notice = decision.allowanceSource === "thread_container"
    ? decision.userNotice
    : {
        code: decision.userNotice?.code ?? "hosted_access_inactive",
        message: formatHostedPersonalAiUsageStatusForConversation(
          await projectHostedPersonalAiUsageStatus({
            decision,
            memberId: input.userId,
            now: input.now,
            prisma: input.prisma,
          }),
        ),
      };
  if (!notice) {
    return { status: "not_applicable" };
  }

  if (isHostedLinqConversationMessageWake(wake)) {
    const result = await sendHostedAiUsageDeniedResponseToLinqChat({
      chatId: wake.message.linqMessage.chatId,
      memberId: input.userId,
      message: notice.message,
      noticeCode: notice.code,
      occurredAt: wake.occurredAt,
      prisma: input.prisma,
      replyToMessageId: wake.message.linqMessage.messageId,
      routeAuthority: wake.message.routeAuthority ?? null,
      sourceEventId: wake.eventId,
    });
    return mapHostedRuntimeAiUsageLinqNoticeResult(result, input.now);
  }

  return sendHostedRuntimeProviderUsageNotice({
    message: notice.message,
    now: input.now,
    prisma: input.prisma,
    userId: input.userId,
    wake,
  });
}

async function sendHostedRuntimeProviderUsageNotice(input: {
  message: string;
  now: Date;
  prisma: PrismaClient;
  userId: string;
  wake: HostedExecutionWake;
}): Promise<HostedRuntimeAiUsageLimitNoticeResult> {
  const providerRequest = buildHostedRuntimeProviderUsageNoticeRequest({
    message: input.message,
    wake: input.wake,
  });
  if (!providerRequest) {
    return { status: "not_applicable" };
  }
  const controlClient = readHostedExecutionControlClientIfConfigured(
    HOSTED_TELEGRAM_USAGE_LIMIT_NOTICE_TIMEOUT_MS,
  );
  if (!controlClient) {
    return buildHostedRuntimeAiUsageNoticeInFlightResult(input.now);
  }

  const dispatch: {
    claim: Awaited<ReturnType<typeof startHostedAiUsageDeniedResponseDispatchTx>> | null;
  } = { claim: null };
  const onRequestAttempted = async () => {
    dispatch.claim = await startHostedAiUsageDeniedResponseDispatchTx({
      attemptedAt: input.now,
      memberId: input.userId,
      prisma: input.prisma,
      sourceEventId: input.wake.eventId,
      targetKind: providerRequest.targetKind,
    });
    if (dispatch.claim.status !== "claimed") {
      throw new Error("Hosted usage response delivery is already owned.");
    }
  };

  let deliveryResult: Awaited<
    ReturnType<typeof controlClient.sendTelegramUsageLimitNotice>
  >;
  try {
    deliveryResult = providerRequest.channel === "telegram"
      ? await controlClient.sendTelegramUsageLimitNotice({
          onRequestAttempted,
          request: providerRequest.request,
          userId: input.userId,
        })
      : await controlClient.sendConversationUsageNotice({
          onRequestAttempted,
          request: providerRequest.request,
          userId: input.userId,
        });
  } catch (cause) {
    if (dispatch.claim?.status === "already_notified") {
      return { status: "already_notified" };
    }
    if (dispatch.claim?.status === "in_flight") {
      return dispatch.claim.retryAt
        ? {
            retryAt: dispatch.claim.retryAt.toISOString(),
            status: "in_flight",
          }
        : buildHostedRuntimeAiUsageNoticeInFlightResult(input.now);
    }
    if (!dispatch.claim) {
      return buildHostedRuntimeAiUsageNoticeInFlightResult(input.now);
    }
    const hostedControlHttpError = readCloudflareHostedControlHttpError(cause);
    const retryableUnavailable = isHostedControlPreProviderFailure(
      hostedControlHttpError,
    );
    await markHostedLinqDeliverySendFailedTx({
      expectedAttemptedAt: input.now,
      failedAt: input.now,
      failureCode: retryableUnavailable
        ? hostedControlHttpError?.code ?? "hosted_control_unavailable"
        : "usage_response_dispatch_unconfirmed",
      idempotencyKey: dispatch.claim.idempotencyKey,
      prisma: input.prisma,
      retryAfterAt: retryableUnavailable
        ? new Date(
            input.now.getTime() + HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
          )
        : null,
    });
    return retryableUnavailable
      ? buildHostedRuntimeAiUsageNoticeInFlightResult(input.now)
      : { status: "already_notified" };
  }

  if (dispatch.claim?.status !== "claimed") {
    return buildHostedRuntimeAiUsageNoticeInFlightResult(input.now);
  }
  if (deliveryResult.status === "failed") {
    const retryAfterAt = readHostedRuntimeTelegramUsageLimitNoticeRetryAfterAt({
      result: deliveryResult,
      sentAt: input.now,
    });
    await markHostedLinqDeliverySendFailedTx({
      expectedAttemptedAt: input.now,
      failedAt: input.now,
      failureCode: deliveryResult.failureCode,
      idempotencyKey: dispatch.claim.idempotencyKey,
      prisma: input.prisma,
      retryAfterAt: deliveryResult.retryable ? retryAfterAt : null,
    });
    return deliveryResult.retryable
      ? {
          retryAt: retryAfterAt.toISOString(),
          status: "in_flight",
        }
      : { status: "already_notified" };
  }

  await markHostedLinqDeliveryAcceptedTx({
    acceptedAt: input.now,
    idempotencyKey: dispatch.claim.idempotencyKey,
    prisma: input.prisma,
  });
  return { status: "sent" };
}

type HostedRuntimeProviderUsageNoticeRequest =
  | {
    channel: "email" | "whatsapp";
    request: Parameters<
      NonNullable<ReturnType<typeof readHostedExecutionControlClientIfConfigured>>["sendConversationUsageNotice"]
    >[0]["request"];
    targetKind: string;
  }
  | {
    channel: "telegram";
    request: Parameters<
      NonNullable<ReturnType<typeof readHostedExecutionControlClientIfConfigured>>["sendTelegramUsageLimitNotice"]
    >[0]["request"];
    targetKind: string;
  };

function buildHostedRuntimeProviderUsageNoticeRequest(input: {
  message: string;
  wake: HostedExecutionWake;
}): HostedRuntimeProviderUsageNoticeRequest | null {
  if (isHostedTelegramConversationMessageWake(input.wake)) {
    const target = input.wake.message.telegramMessage.threadId;
    if (!parseTelegramThreadTarget(target)) {
      return null;
    }
    return {
      channel: "telegram",
      request: {
        message: input.message,
        replyToMessageId: input.wake.message.telegramMessage.messageId,
        target,
      },
      targetKind: "telegram_thread",
    };
  }
  if (isHostedWhatsAppConversationMessageWake(input.wake)) {
    const target = input.wake.message.whatsappMessage.threadId.trim()
      || input.wake.message.whatsappMessage.fromWaId.trim();
    if (!target) {
      return null;
    }
    return {
      channel: "whatsapp",
      request: {
        channel: "whatsapp",
        message: input.message,
        replyToMessageId: input.wake.message.whatsappMessage.messageId,
        target,
      },
      targetKind: "whatsapp_thread",
    };
  }
  if (isHostedEmailConversationMessageWake(input.wake)) {
    const threadTarget = input.wake.message.threadTarget?.trim() ?? "";
    const explicitTarget = input.wake.message.from?.trim() ?? "";
    const target = threadTarget || explicitTarget;
    if (!target) {
      return null;
    }
    const targetKind = threadTarget ? "thread" : "explicit";
    return {
      channel: "email",
      request: {
        channel: "email",
        message: input.message,
        replyToMessageId: input.wake.message.messageId ?? null,
        subject: targetKind === "thread"
          ? null
          : input.wake.message.subject ?? null,
        target,
        targetKind,
      },
      targetKind: `email_${targetKind}`,
    };
  }
  return null;
}

function readHostedRuntimeTelegramUsageLimitNoticeRetryAfterAt(input: {
  result: {
    retryable: boolean;
    retryAfterSeconds?: number;
  };
  sentAt: Date;
}): Date {
  const retryAfterSeconds = input.result.retryAfterSeconds;
  const retryDelayMs = typeof retryAfterSeconds === "number"
    && Number.isSafeInteger(retryAfterSeconds)
    && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS;
  return new Date(input.sentAt.getTime() + retryDelayMs);
}

function isHostedControlPreProviderFailure(
  error: Readonly<{ code: string | undefined; status: number }> | null,
): boolean {
  return error?.status === 400
    || error?.status === 401
    || error?.status === 404;
}

function buildHostedRuntimeAiUsageNoticeInFlightResult(
  now: Date,
): HostedRuntimeAiUsageLimitNoticeResult {
  return {
    retryAt: new Date(
      now.getTime() + HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
    ).toISOString(),
    status: "in_flight",
  };
}

function mapHostedRuntimeAiUsageLinqNoticeResult(
  result: HostedAiUsageLimitNoticeDeliveryResult,
  now: Date,
): HostedRuntimeAiUsageLimitNoticeResult {
  return result.status === "in_flight"
    ? buildHostedRuntimeAiUsageNoticeInFlightResult(now)
    : result;
}

async function readHostedRuntimePendingUsageNoticeWake(input: {
  consumedSeqByLane: readonly HostedMailboxLaneConsumed[];
  mailboxLag: readonly HostedMailboxLaneLag[];
  prisma: NonNullable<Parameters<typeof readHostedMailboxPayload>[0]["prisma"]>;
  userId: string;
}): Promise<HostedExecutionWake | null> {
  const afterSeq = readHostedConversationFreshWorkFloor({
    consumedSeqByLane: input.consumedSeqByLane,
    mailboxLag: input.mailboxLag,
  }).toString();

  // Usage notices are best-effort for the current pending input. Older rows stay
  // pending for replay after allowance returns; do not decode an unbounded backlog here.
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
  if (
    wake
    && canSendHostedRuntimeUsageNoticeForConversationWake({
      wake,
    })
  ) {
    return wake;
  }
  return null;
}

function canSendHostedRuntimeUsageNoticeForConversationWake(input: {
  wake: HostedExecutionWake;
}): boolean {
  return isHostedLinqConversationMessageWake(input.wake)
    || isHostedTelegramConversationMessageWake(input.wake)
    || isHostedWhatsAppConversationMessageWake(input.wake)
    || isHostedEmailConversationMessageWake(input.wake);
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
