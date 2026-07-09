import {
  isHostedLinqConversationMessageWake,
  isHostedTelegramConversationMessageWake,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  buildCloudflareHostedControlTelegramUsageLimitNoticeAuthorityBody,
  readCloudflareHostedControlTelegramUsageLimitNoticeAuthoritySecret,
  readCloudflareHostedControlHttpErrorStatus,
  signCloudflareHostedControlTelegramUsageLimitNoticeAuthority,
  type CloudflareHostedControlTelegramUsageLimitNoticeCode,
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
import type {
  HostedMailboxLaneConsumed,
  HostedMailboxLaneLag,
} from "@murphai/hosted-execution/runtime-control";

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
  buildHostedAiUsageGateLegacyNoticeIdempotencyKeys,
  buildHostedAiUsageGateNoticeIdempotencyKey,
  HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
  markHostedAiUsageLimitNoticeSent,
} from "../hosted-execution/usage-allowance";
import {
  readHostedExecutionControlClientIfConfigured,
} from "../hosted-execution/control";
import {
  type HostedAiUsageLimitNoticeDeliveryResult,
  sendClaimedHostedAiUsageLimitNoticeToLinqChat,
  sendHostedAiUsageNoticeToLinqChat,
} from "../hosted-execution/usage-limit-notice";
import {
  claimHostedLinqDeliveryProviderDispatchTx,
  hasHostedLinqProviderCorrelatedDeliveryForIdempotencyKeysTx,
  hasHostedLinqTerminalTelegramUsageLimitFailureForIdempotencyKeysTx,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliveryProviderDispatchStartedTx,
  markHostedLinqDeliverySendFailedTx,
  resolveHostedLinqAiUsageLimitNoticeDeliveryClaimTx,
} from "../hosted-onboarding/linq-delivery-store";
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
const HOSTED_TELEGRAM_USAGE_LIMIT_NOTICE_TIMEOUT_MS = 15_000;
const HOSTED_RUNTIME_RECONCILIATION_ENGAGEMENT_PAUSE_RETRY_MS =
  24 * 60 * 60 * 1000;

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
  prisma: NonNullable<Parameters<typeof readHostedMailboxMaxSeqByLane>[0]["prisma"]>;
  userId: string;
}): Promise<HostedRuntimeAiUsageLimitNoticeResult> {
  const decision = input.gate.decision;
  if (
    !decision.userNotice ||
    !hasHostedFreshConversationMailboxLag({
      consumedSeqByLane: input.consumedSeqByLane,
      mailboxLag: input.mailboxLag,
    })
  ) {
    return { status: "not_applicable" };
  }

  const wake = await readHostedRuntimePendingUsageNoticeWake({
    consumedSeqByLane: input.consumedSeqByLane,
    decision,
    mailboxLag: input.mailboxLag,
    prisma: input.prisma,
    userId: input.userId,
  });
  if (!wake) {
    return { status: "not_applicable" };
  }

  if (isHostedTelegramConversationMessageWake(wake)) {
    if (decision.reason !== "ai_usage_limit_exceeded") {
      return { status: "not_applicable" };
    }
    if (!parseTelegramThreadTarget(wake.message.telegramMessage.threadId)) {
      return { status: "not_applicable" };
    }
    const noticeCode = readHostedRuntimeTelegramUsageLimitNoticeCode(
      decision.userNotice.code,
    );
    if (!noticeCode) {
      return { status: "not_applicable" };
    }

    const sentAt = input.now;
    const idempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey({
      memberId: input.userId,
      periodStart: decision.periodStart,
    });
    const legacyIdempotencyKeys = buildHostedAiUsageGateLegacyNoticeIdempotencyKeys({
      memberId: input.userId,
      periodStart: decision.periodStart,
    });
    const deliveryClaim =
      await resolveHostedLinqAiUsageLimitNoticeDeliveryClaimTx({
        attemptedAt: sentAt,
        currentIdempotencyKey: idempotencyKey,
        legacyIdempotencyKeys,
        prisma: input.prisma,
        source: "hosted_runtime_ai_usage_limit_notice",
      });
    if (deliveryClaim.status === "already_claimed") {
      return { status: "already_notified" };
    }
    if (deliveryClaim.status === "in_flight") {
      return deliveryClaim.retryAt
        ? {
            retryAt: deliveryClaim.retryAt.toISOString(),
            status: "in_flight",
          }
        : buildHostedRuntimeAiUsageNoticeInFlightResult(input.now);
    }
    const claimed = await claimHostedLinqDeliveryProviderDispatchTx({
      attemptedAt: sentAt,
      idempotencyKey: deliveryClaim.idempotencyKey,
      prisma: input.prisma,
      reclaimStalePreProviderAttempt: true,
      source: "hosted_runtime_ai_usage_limit_notice",
      sourceRef: wake.eventId,
      targetKind: "telegram_thread",
      template: "ai_usage_quota",
    });
    if (!claimed.claimed) {
      const claimedCurrentDeliverySentNotice =
        await hasHostedLinqProviderCorrelatedDeliveryForIdempotencyKeysTx({
          idempotencyKeys: [deliveryClaim.idempotencyKey],
          prisma: input.prisma,
        });
      if (claimedCurrentDeliverySentNotice) {
        return { status: "already_notified" };
      }
      const claimedCurrentDeliveryTerminalFailure =
        await hasHostedLinqTerminalTelegramUsageLimitFailureForIdempotencyKeysTx({
          idempotencyKeys: [deliveryClaim.idempotencyKey],
          prisma: input.prisma,
        });
      if (claimed.retryAt) {
        return {
          retryAt: claimed.retryAt.toISOString(),
          status: "in_flight",
        };
      }
      return claimedCurrentDeliveryTerminalFailure
        ? { status: "already_notified" }
        : buildHostedRuntimeAiUsageNoticeInFlightResult(input.now);
    }

    const controlClient = readHostedExecutionControlClientIfConfigured(
      HOSTED_TELEGRAM_USAGE_LIMIT_NOTICE_TIMEOUT_MS,
    );
    if (!controlClient) {
      const error = new HostedRuntimeTelegramUsageLimitNoticeUnavailableError();
      await markHostedLinqDeliverySendFailedTx({
        failedAt: sentAt,
        failureCode: error.name,
        failureReason: error.message,
        idempotencyKey: deliveryClaim.idempotencyKey,
        prisma: input.prisma,
      });
      return buildHostedRuntimeAiUsageNoticeInFlightResult(input.now);
    }

    let controlRequestAttempted = false;
    let dispatchStartFailure: unknown = null;
    let deliveryResult: Awaited<ReturnType<typeof controlClient.sendTelegramUsageLimitNotice>>;
    try {
      const authoritySecret =
        readCloudflareHostedControlTelegramUsageLimitNoticeAuthoritySecret(process.env);
      if (!authoritySecret) {
        throw new HostedRuntimeTelegramUsageLimitNoticeUnavailableError(
          "Hosted Telegram usage-limit notice authority signing is not configured.",
        );
      }
      deliveryResult = await controlClient.sendTelegramUsageLimitNotice({
        authority: await signCloudflareHostedControlTelegramUsageLimitNoticeAuthority({
          body: buildCloudflareHostedControlTelegramUsageLimitNoticeAuthorityBody({
            expiresAt: new Date(
              sentAt.getTime() + HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
            ),
            idempotencyKey: deliveryClaim.idempotencyKey,
            issuedAt: sentAt,
            message: decision.userNotice.message,
            noticeCode,
            periodStart: decision.periodStart,
            replyToMessageId: wake.message.telegramMessage.messageId,
            sourceEventId: wake.eventId,
            target: wake.message.telegramMessage.threadId,
            userId: input.userId,
          }),
          secret: authoritySecret,
        }),
        onRequestAttempted: async () => {
          try {
            const dispatchStarted =
              await markHostedLinqDeliveryProviderDispatchStartedTx({
                idempotencyKey: deliveryClaim.idempotencyKey,
                prisma: input.prisma,
                startedAt: sentAt,
              });
            if (!dispatchStarted) {
              throw new HostedRuntimeTelegramUsageLimitNoticeUnavailableError(
                "Hosted Telegram usage-limit notice delivery claim is no longer available before hosted-control dispatch.",
              );
            }
          } catch (cause) {
            dispatchStartFailure = cause;
            throw cause;
          }
          controlRequestAttempted = true;
        },
      });
    } catch (cause) {
      if (
        dispatchStartFailure === cause
        && !(cause instanceof HostedRuntimeTelegramUsageLimitNoticeUnavailableError)
      ) {
        throw cause;
      }
      const hostedControlHttpStatus =
        readCloudflareHostedControlHttpErrorStatus(cause);
      const retryableUnavailable =
        cause instanceof HostedRuntimeTelegramUsageLimitNoticeUnavailableError
        || !controlRequestAttempted
        || isHostedTelegramControlPreProviderFailureStatus(hostedControlHttpStatus);
      const error = retryableUnavailable
        ? cause instanceof HostedRuntimeTelegramUsageLimitNoticeUnavailableError
          ? cause
          : new HostedRuntimeTelegramUsageLimitNoticeUnavailableError(
            hostedControlHttpStatus === 404
              ? "Hosted Telegram usage-limit notice delivery route is unavailable through hosted control."
              : "Hosted Telegram usage-limit notice delivery could not complete through hosted control.",
          )
        : new HostedRuntimeTelegramUsageLimitNoticeUnknownError();
      await markHostedLinqDeliverySendFailedTx({
        failedAt: sentAt,
        failureCode: error.name,
        failureReason: error.message,
        idempotencyKey: deliveryClaim.idempotencyKey,
        prisma: input.prisma,
      });
      return retryableUnavailable
        ? buildHostedRuntimeAiUsageNoticeInFlightResult(input.now)
        : { status: "already_notified" };
    }

    if (deliveryResult.status === "failed") {
      const retryAfterAt = readHostedRuntimeTelegramUsageLimitNoticeRetryAfterAt({
        result: deliveryResult,
        sentAt,
      });
      if (deliveryResult.retryable) {
        const error = new HostedRuntimeTelegramUsageLimitNoticeRetryAfterError(
          formatHostedRuntimeTelegramUsageLimitNoticeRetryableFailure(deliveryResult),
        );
        await markHostedLinqDeliverySendFailedTx({
          failedAt: sentAt,
          failureCode: error.name,
          failureReason: error.message,
          idempotencyKey: deliveryClaim.idempotencyKey,
          prisma: input.prisma,
          ...(retryAfterAt === null ? {} : { retryAfterAt }),
        });
        return retryAfterAt === null
          ? buildHostedRuntimeAiUsageNoticeInFlightResult(input.now)
          : {
              retryAt: retryAfterAt.toISOString(),
              status: "in_flight",
            };
      }
      await markHostedLinqDeliverySendFailedTx({
        failedAt: sentAt,
        failureCode: deliveryResult.failureCode,
        failureReason: deliveryResult.failureReason,
        idempotencyKey: deliveryClaim.idempotencyKey,
        prisma: input.prisma,
      });
      return { status: "already_notified" };
    }

    await markHostedLinqDeliveryAcceptedTx({
      acceptedAt: sentAt,
      idempotencyKey: deliveryClaim.idempotencyKey,
      prisma: input.prisma,
    });
    await markHostedAiUsageLimitNoticeSent({
      memberId: input.userId,
      periodStart: decision.periodStart,
      prisma: input.prisma,
      sentAt,
    });
    return { status: "sent" };
  }

  if (!isHostedLinqConversationMessageWake(wake)) {
    return { status: "not_applicable" };
  }
  if (decision.userNotice.code === "trial_conversion_pending") {
    await sendHostedAiUsageNoticeToLinqChat({
      chatId: wake.message.linqMessage.chatId,
      claimToken: null,
      memberId: input.userId,
      message: decision.userNotice.message,
      noticeCode: decision.userNotice.code,
      occurredAt: wake.occurredAt,
      prisma: input.prisma,
      replyToMessageId: wake.message.linqMessage.messageId,
      routeAuthority: wake.message.routeAuthority ?? null,
      sourceEventId: wake.eventId,
    });
    return { status: "sent" };
  }
  if (decision.reason !== "ai_usage_limit_exceeded") {
    return { status: "not_applicable" };
  }

  const sentAt = input.now;
  const linqNoticeResult = await sendClaimedHostedAiUsageLimitNoticeToLinqChat({
    chatId: wake.message.linqMessage.chatId,
    claimToken: {
      periodStart: decision.periodStart.toISOString(),
      sentAt: sentAt.toISOString(),
    },
    memberId: input.userId,
    message: decision.userNotice.message,
    noticeCode: decision.userNotice.code,
    occurredAt: wake.occurredAt,
    prisma: input.prisma,
    replyToMessageId: wake.message.linqMessage.messageId,
    routeAuthority: wake.message.routeAuthority ?? null,
    sourceEventId: wake.eventId,
  });
  return mapHostedRuntimeAiUsageLinqNoticeResult(linqNoticeResult, input.now);
}

function formatHostedRuntimeTelegramUsageLimitNoticeRetryableFailure(input: {
  failureCode: string;
  failureReason: string;
}): string {
  const failureCode = input.failureCode.trim() || "unknown";
  const failureReason = input.failureReason.trim();
  return failureReason
    ? `Hosted Telegram usage-limit notice delivery is retryable through hosted control (${failureCode}: ${failureReason}).`
    : `Hosted Telegram usage-limit notice delivery is retryable through hosted control (${failureCode}).`;
}

function readHostedRuntimeTelegramUsageLimitNoticeRetryAfterAt(input: {
  result: {
    retryable: boolean;
    retryAfterSeconds?: number | null;
  };
  sentAt: Date;
}): Date | null {
  if (!input.result.retryable) {
    return null;
  }
  const retryAfterSeconds = input.result.retryAfterSeconds;
  return typeof retryAfterSeconds === "number"
    && Number.isSafeInteger(retryAfterSeconds)
    && retryAfterSeconds > 0
    ? new Date(input.sentAt.getTime() + retryAfterSeconds * 1000)
    : null;
}

function readHostedRuntimeTelegramUsageLimitNoticeCode(
  value: string,
): CloudflareHostedControlTelegramUsageLimitNoticeCode | null {
  switch (value) {
    case "edge_usage_limit_reached":
    case "family_usage_limit_reached":
    case "pulse_upgrade_edge":
    case "trial_usage_limit_reached":
      return value;
    default:
      return null;
  }
}

function isHostedTelegramControlPreProviderFailureStatus(status: number | null): boolean {
  return status === 400 || status === 401 || status === 404 || status === 503;
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
  decision: Extract<HostedRuntimeUsageGateCheck, { status: "denied" }>["decision"];
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
      decision: input.decision,
      wake,
    })
  ) {
    return wake;
  }
  return null;
}

function canSendHostedRuntimeUsageNoticeForConversationWake(input: {
  decision: Extract<HostedRuntimeUsageGateCheck, { status: "denied" }>["decision"];
  wake: HostedExecutionWake;
}): boolean {
  if (isHostedLinqConversationMessageWake(input.wake)) {
    return true;
  }

  return (
    input.decision.reason === "ai_usage_limit_exceeded"
    && isHostedTelegramConversationMessageWake(input.wake)
  );
}

class HostedRuntimeTelegramUsageLimitNoticeUnavailableError extends Error {
  override name = "HostedRuntimeTelegramUsageLimitNoticeUnavailableError";

  constructor(
    message = "Hosted Telegram usage-limit notice delivery is unavailable through hosted control.",
  ) {
    super(message);
  }
}

class HostedRuntimeTelegramUsageLimitNoticeRetryAfterError extends Error {
  override name = "HostedRuntimeTelegramUsageLimitNoticeRetryAfterError";
}

class HostedRuntimeTelegramUsageLimitNoticeUnknownError extends Error {
  override name = "HostedRuntimeTelegramUsageLimitNoticeUnknownError";

  constructor(
    message = "Hosted Telegram usage-limit notice delivery could not be confirmed after dispatch started.",
  ) {
    super(message);
  }
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
