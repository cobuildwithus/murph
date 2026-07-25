import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { createHostedLinqChatLookupKey } from "../hosted-onboarding/contact-privacy";
import {
  claimHostedLinqDeliveryProviderDispatchTx,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
} from "../hosted-onboarding/linq-delivery-store";
import {
  claimHostedLinqProactiveConversationCapacityTx,
  listHostedLinqHealthyProactiveLines,
  type HostedLinqAssignableHomeLine,
} from "../hosted-onboarding/linq-line-store";
import { createHostedLinqChat } from "../hosted-onboarding/linq-client";
import { assertHostedLinqGroupJoinOutreachParticipantEgressAuthority } from "../hosted-onboarding/linq-egress-engagement";
import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import {
  logHostedOnboardingDiagnostic,
  toHostedOnboardingLogIdSuffix,
} from "../hosted-onboarding/logging";
import { resolveHostedLinqSignupWelcomeDailyLimit } from "../hosted-onboarding/linq-routing-policy";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../hosted-onboarding/shared";
import {
  decideHostedGroupJoinOutreachSendWindow,
} from "./group-join-outreach-window";
import { readHostedGroupJoinOutreachParticipantPhone } from "./group-join-outreach-store";

export const HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE =
  "hosted_group_join_outreach";
const HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE = "group_join_outreach";
const HOSTED_GROUP_JOIN_OUTREACH_IDEMPOTENCY_PREFIX = "group-join-outreach:";
const HOSTED_GROUP_JOIN_OUTREACH_GLOBAL_PACE_MS = 60_000;
const HOSTED_GROUP_JOIN_OUTREACH_NO_LINE_RETRY_MS = 15 * 60_000;
const HOSTED_GROUP_JOIN_OUTREACH_PROVIDER_RETRY_MS = 15 * 60_000;
const HOSTED_GROUP_JOIN_OUTREACH_MAX_PROVIDER_ATTEMPTS = 5;
const MINUTES_PER_DAY = 24 * 60;

export type HostedGroupJoinOutreachDrainResult =
  | { kind: "deferred"; outreachId: string; reason: string }
  | { kind: "idle" }
  | { kind: "sent"; outreachId: string }
  | { kind: "skipped"; outreachId: string; reason: string };

type HostedGroupJoinOutreachClaim = {
  attemptedAt: Date;
  fromPhoneNumber: string;
  idempotencyKey: string;
  message: string;
  outreachId: string;
  participantPhoneNumber: string;
};

type HostedGroupJoinOutreachClaimResult =
  | HostedGroupJoinOutreachDrainResult
  | { kind: "dispatch"; claim: HostedGroupJoinOutreachClaim };

export function buildHostedGroupJoinOutreachIdempotencyKey(
  outreachId: string,
): string {
  return `${HOSTED_GROUP_JOIN_OUTREACH_IDEMPOTENCY_PREFIX}${outreachId}`;
}

export function buildHostedGroupJoinOutreachMessage(
  groupDisplayName: string | null | undefined,
): string {
  const groupName = normalizeHostedGroupJoinOutreachGroupName(groupDisplayName);
  return `You liked the invite to ${groupName}. Reply here and I'll help you join.`;
}

export async function drainOneHostedGroupJoinOutreach(input: {
  now?: Date;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedGroupJoinOutreachDrainResult> {
  const now = input.now ?? new Date();
  const claimResult = await input.prisma.$transaction(
    async (tx) => claimOneHostedGroupJoinOutreachTx({ now, tx }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );
  if (claimResult.kind !== "dispatch") {
    logHostedGroupJoinOutreachDrainResult(claimResult);
    return claimResult;
  }

  const { claim } = claimResult;
  try {
    await assertHostedLinqGroupJoinOutreachParticipantEgressAuthority({
      fromPhoneNumber: claim.fromPhoneNumber,
      idempotencyKey: claim.idempotencyKey,
      outreachId: claim.outreachId,
      prisma: input.prisma,
      targetPhoneNumber: claim.participantPhoneNumber,
    });
    const sent = await createHostedLinqChat({
      from: claim.fromPhoneNumber,
      idempotencyKey: claim.idempotencyKey,
      message: claim.message,
      ...(input.signal ? { signal: input.signal } : {}),
      to: [claim.participantPhoneNumber],
    });

    await input.prisma.$transaction(async (tx) => {
      await markHostedLinqDeliveryAcceptedTx({
        acceptedAt: new Date(),
        idempotencyKey: claim.idempotencyKey,
        linqChatId: sent.chatId,
        messageId: sent.messageId,
        prisma: tx,
      });
      await tx.hostedGroupJoinOutreach.updateMany({
        where: {
          id: claim.outreachId,
          sentAt: null,
          skippedAt: null,
        },
        data: {
          linqChatLookupKey: createHostedLinqChatLookupKey(sent.chatId),
          sentAt: new Date(),
        },
      });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

    const result: HostedGroupJoinOutreachDrainResult = {
      kind: "sent",
      outreachId: claim.outreachId,
    };
    logHostedGroupJoinOutreachDrainResult(result);
    return result;
  } catch (error) {
    const retryable = !isHostedOnboardingError(error) || error.retryable;
    const result = await input.prisma.$transaction(async (tx) => {
      const outreach = await tx.hostedGroupJoinOutreach.findUnique({
        where: { id: claim.outreachId },
        select: { attemptCount: true },
      });
      const terminal = !retryable
        || (outreach?.attemptCount ?? HOSTED_GROUP_JOIN_OUTREACH_MAX_PROVIDER_ATTEMPTS)
          >= HOSTED_GROUP_JOIN_OUTREACH_MAX_PROVIDER_ATTEMPTS;
      const failedAt = new Date();
      const nextAttemptAt = new Date(
        failedAt.getTime() + HOSTED_GROUP_JOIN_OUTREACH_PROVIDER_RETRY_MS,
      );
      await markHostedLinqDeliverySendFailedTx({
        expectedAttemptedAt: claim.attemptedAt,
        failedAt,
        failureCode: readHostedGroupJoinOutreachFailureCode(error),
        failureReason: "Hosted group join outreach provider dispatch failed.",
        idempotencyKey: claim.idempotencyKey,
        prisma: tx,
        retryAfterAt: terminal ? null : nextAttemptAt,
      });
      await tx.hostedGroupJoinOutreach.updateMany({
        where: {
          id: claim.outreachId,
          sentAt: null,
          skippedAt: null,
        },
        data: terminal
          ? {
              skippedAt: failedAt,
              skipReason: retryable
                ? "provider_attempt_limit"
                : "provider_rejected",
            }
          : {
              lastDeferredAt: failedAt,
              lastDeferralReason: "provider_retry",
              nextAttemptAt,
            },
      });
      return terminal
        ? {
            kind: "skipped" as const,
            outreachId: claim.outreachId,
            reason: retryable ? "provider_attempt_limit" : "provider_rejected",
          }
        : {
            kind: "deferred" as const,
            outreachId: claim.outreachId,
            reason: "provider_retry",
          };
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    logHostedGroupJoinOutreachDrainResult(result);
    return result;
  }
}

async function claimOneHostedGroupJoinOutreachTx(input: {
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinOutreachClaimResult> {
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('hosted_group_join_outreach_drain'))
  `;

  const outreach = await input.tx.hostedGroupJoinOutreach.findFirst({
    orderBy: [
      { requestedAt: "asc" },
      { id: "asc" },
    ],
    where: {
      nextAttemptAt: { lte: input.now },
      sentAt: null,
      skippedAt: null,
    },
    select: {
      attemptCount: true,
      dispatchStartedAt: true,
      groupId: true,
      id: true,
      offerId: true,
      participantPhoneEncrypted: true,
      participantPhoneLookupKey: true,
      phoneNumberLookupKey: true,
      requestedAt: true,
    },
  });
  if (!outreach) {
    return { kind: "idle" };
  }

  const participantPhoneNumber = readHostedGroupJoinOutreachParticipantPhone({
    encrypted: outreach.participantPhoneEncrypted,
    outreachId: outreach.id,
  });
  if (!participantPhoneNumber) {
    return skipHostedGroupJoinOutreachTx({
      now: input.now,
      outreachId: outreach.id,
      reason: "participant_phone_unreadable",
      tx: input.tx,
    });
  }

  const offer = await input.tx.hostedGroupJoinOffer.findUnique({
    where: { id: outreach.offerId },
    select: {
      groupId: true,
      revokedAt: true,
      group: {
        select: {
          displayName: true,
          id: true,
          joinCode: true,
          runtimeMemberId: true,
        },
      },
    },
  });
  if (!offer || offer.groupId !== outreach.groupId) {
    return skipHostedGroupJoinOutreachTx({
      now: input.now,
      outreachId: outreach.id,
      reason: "offer_unavailable",
      tx: input.tx,
    });
  }
  if (offer.revokedAt) {
    return skipHostedGroupJoinOutreachTx({
      now: input.now,
      outreachId: outreach.id,
      reason: "offer_revoked",
      tx: input.tx,
    });
  }
  if (!offer.group?.runtimeMemberId || !offer.group.joinCode) {
    return skipHostedGroupJoinOutreachTx({
      now: input.now,
      outreachId: outreach.id,
      reason: "group_unavailable",
      tx: input.tx,
    });
  }

  const member = await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber: participantPhoneNumber,
    prisma: input.tx,
  });
  if (member) {
    return skipHostedGroupJoinOutreachTx({
      now: input.now,
      outreachId: outreach.id,
      reason: "recipient_now_member",
      tx: input.tx,
    });
  }

  // A reaction to a distinct offer is fresh intent, so nothing here suppresses
  // it on the basis of an earlier attempt for a different group. Duplicate work
  // is already collapsed by the unique (offerId, participantPhoneLookupKey) row,
  // and volume is bounded by global pacing, per-line caps, line health, and
  // quiet hours.
  const sendWindow = decideHostedGroupJoinOutreachSendWindow({
    now: input.now,
    participantPhoneNumber,
  });
  if (sendWindow.kind === "unsupported_region") {
    // Terminal, not deferred: no later sweep can derive a safe window for this
    // number, so recording the refusal keeps the row from retrying forever.
    return skipHostedGroupJoinOutreachTx({
      now: input.now,
      outreachId: outreach.id,
      reason: "recipient_region_unsupported",
      tx: input.tx,
    });
  }
  if (sendWindow.kind === "defer") {
    return deferHostedGroupJoinOutreachTx({
      nextAttemptAt: sendWindow.nextAttemptAt,
      now: input.now,
      outreachId: outreach.id,
      reason: sendWindow.reason,
      tx: input.tx,
    });
  }

  const latestAttempt = await input.tx.hostedGroupJoinOutreach.findFirst({
    orderBy: { dispatchStartedAt: "desc" },
    where: {
      dispatchStartedAt: { not: null },
      id: { not: outreach.id },
    },
    select: { dispatchStartedAt: true },
  });
  const globalPaceAt = latestAttempt?.dispatchStartedAt
    ? new Date(
        latestAttempt.dispatchStartedAt.getTime()
          + HOSTED_GROUP_JOIN_OUTREACH_GLOBAL_PACE_MS,
      )
    : null;
  if (globalPaceAt && globalPaceAt > input.now) {
    return deferHostedGroupJoinOutreachTx({
      nextAttemptAt: globalPaceAt,
      now: input.now,
      outreachId: outreach.id,
      reason: "global_pacing",
      tx: input.tx,
    });
  }

  const healthyLines = await listHostedLinqHealthyProactiveLines({
    prisma: input.tx,
  });
  if (healthyLines.length === 0) {
    return deferHostedGroupJoinOutreachTx({
      nextAttemptAt: new Date(
        input.now.getTime() + HOSTED_GROUP_JOIN_OUTREACH_NO_LINE_RETRY_MS,
      ),
      now: input.now,
      outreachId: outreach.id,
      reason: "no_healthy_line",
      tx: input.tx,
    });
  }

  const line = outreach.phoneNumberLookupKey
    ? healthyLines.find(
        (candidate) =>
          candidate.phoneNumberLookupKey === outreach.phoneNumberLookupKey,
      ) ?? null
    : await claimHostedGroupJoinOutreachLineCapacityTx({
        lines: healthyLines,
        now: input.now,
        tx: input.tx,
      });
  if (!line) {
    const reason = outreach.phoneNumberLookupKey
      ? "selected_line_unhealthy"
      : "line_capacity_exhausted";
    const nextAttemptAt = outreach.phoneNumberLookupKey
      ? new Date(input.now.getTime() + HOSTED_GROUP_JOIN_OUTREACH_NO_LINE_RETRY_MS)
      : resolveNextUtcDaySendAttempt({
          now: input.now,
          participantPhoneNumber,
        });
    return deferHostedGroupJoinOutreachTx({
      nextAttemptAt,
      now: input.now,
      outreachId: outreach.id,
      reason,
      tx: input.tx,
    });
  }

  const idempotencyKey = buildHostedGroupJoinOutreachIdempotencyKey(outreach.id);
  const deliveryClaim = await claimHostedLinqDeliveryProviderDispatchTx({
    attemptedAt: input.now,
    idempotencyKey,
    phoneNumber: line.phoneNumber,
    prisma: input.tx,
    reclaimStalePreProviderAttempt: true,
    source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
    sourceRef: outreach.id,
    // Ordinary reclaimable `attempted`, not `provider_dispatch_started`: only
    // the unrelated ai_usage_quota source can reclaim a stale dispatch-started
    // row, so this claim would otherwise strand the outreach in
    // delivery_in_flight forever if the process died between this commit and
    // the provider call. Replay is safe because the provider idempotency key is
    // the stable `group-join-outreach:<id>`.
    status: "attempted",
    targetKind: "participant",
    template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
  });
  if (!deliveryClaim.claimed) {
    return deferHostedGroupJoinOutreachTx({
      nextAttemptAt: deliveryClaim.retryAt
        ?? new Date(
          input.now.getTime() + HOSTED_GROUP_JOIN_OUTREACH_PROVIDER_RETRY_MS,
        ),
      now: input.now,
      outreachId: outreach.id,
      reason: "delivery_in_flight",
      tx: input.tx,
    });
  }

  await input.tx.hostedGroupJoinOutreach.update({
    where: { id: outreach.id },
    data: {
      attemptCount: { increment: 1 },
      dispatchStartedAt: input.now,
      lastDeferredAt: null,
      lastDeferralReason: null,
      nextAttemptAt: new Date(
        input.now.getTime() + HOSTED_GROUP_JOIN_OUTREACH_PROVIDER_RETRY_MS,
      ),
      phoneNumberLookupKey: line.phoneNumberLookupKey,
    },
  });

  return {
    kind: "dispatch",
    claim: {
      attemptedAt: input.now,
      fromPhoneNumber: line.phoneNumber,
      idempotencyKey,
      message: buildHostedGroupJoinOutreachMessage(offer.group.displayName),
      outreachId: outreach.id,
      participantPhoneNumber,
    },
  };
}

async function claimHostedGroupJoinOutreachLineCapacityTx(input: {
  lines: readonly HostedLinqAssignableHomeLine[];
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedLinqAssignableHomeLine | null> {
  const dayUtc = startOfUtcDay(input.now);
  const sortedLines = [...input.lines].sort((left, right) => {
    const countDifference = readHostedLinqLineDayCount(left, dayUtc)
      - readHostedLinqLineDayCount(right, dayUtc);
    if (countDifference !== 0) {
      return countDifference;
    }
    const weightDifference = right.assignmentWeight - left.assignmentWeight;
    return weightDifference !== 0
      ? weightDifference
      : left.phoneNumberLookupKey.localeCompare(right.phoneNumberLookupKey);
  });

  for (const line of sortedLines) {
    const claimed = await claimHostedLinqProactiveConversationCapacityTx({
      dayUtc,
      limit: resolveHostedLinqSignupWelcomeDailyLimit(line),
      phoneNumberLookupKey: line.phoneNumberLookupKey,
      prisma: input.tx,
    });
    if (claimed) {
      return line;
    }
  }
  return null;
}

function readHostedLinqLineDayCount(
  line: HostedLinqAssignableHomeLine,
  dayUtc: Date,
): number {
  return line.proactiveConversationDayUtc?.getTime() === dayUtc.getTime()
    ? line.proactiveConversationCount ?? 0
    : 0;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}

function resolveNextUtcDaySendAttempt(input: {
  now: Date;
  participantPhoneNumber: string;
}): Date {
  const nextDay = new Date(
    startOfUtcDay(input.now).getTime() + MINUTES_PER_DAY * 60_000,
  );
  const decision = decideHostedGroupJoinOutreachSendWindow({
    now: nextDay,
    participantPhoneNumber: input.participantPhoneNumber,
  });
  // A capacity deferral only reschedules; region support was already decided
  // before this point, so an unsupported region cannot reach here.
  return decision.kind === "defer" ? decision.nextAttemptAt : nextDay;
}

async function deferHostedGroupJoinOutreachTx(input: {
  nextAttemptAt: Date;
  now: Date;
  outreachId: string;
  reason: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinOutreachDrainResult> {
  await input.tx.hostedGroupJoinOutreach.updateMany({
    where: {
      id: input.outreachId,
      sentAt: null,
      skippedAt: null,
    },
    data: {
      lastDeferredAt: input.now,
      lastDeferralReason: input.reason,
      nextAttemptAt: input.nextAttemptAt,
    },
  });
  return {
    kind: "deferred",
    outreachId: input.outreachId,
    reason: input.reason,
  };
}

async function skipHostedGroupJoinOutreachTx(input: {
  now: Date;
  outreachId: string;
  reason: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinOutreachDrainResult> {
  await input.tx.hostedGroupJoinOutreach.updateMany({
    where: {
      id: input.outreachId,
      sentAt: null,
      skippedAt: null,
    },
    data: {
      skipReason: input.reason,
      skippedAt: input.now,
    },
  });
  return {
    kind: "skipped",
    outreachId: input.outreachId,
    reason: input.reason,
  };
}

function normalizeHostedGroupJoinOutreachGroupName(
  value: string | null | undefined,
): string {
  const normalized = value
    ?.replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 80) ?? "";
  if (
    normalized.length === 0
    || /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\.[a-z]{2,}(?:\b|\/))/iu.test(
      normalized,
    )
  ) {
    return "this group";
  }
  return normalized;
}

function readHostedGroupJoinOutreachFailureCode(error: unknown): string {
  if (isHostedOnboardingError(error)) {
    return error.code;
  }
  return error instanceof Error && error.name
    ? error.name
    : "HOSTED_GROUP_JOIN_OUTREACH_SEND_FAILED";
}

function logHostedGroupJoinOutreachDrainResult(
  result: HostedGroupJoinOutreachDrainResult,
): void {
  logHostedOnboardingDiagnostic("hosted-groups.join-outreach-drain", {
    kind: result.kind,
    outreachIdSuffix: result.kind === "idle"
      ? null
      : toHostedOnboardingLogIdSuffix(result.outreachId),
    reason: "reason" in result ? result.reason : null,
  });
}
