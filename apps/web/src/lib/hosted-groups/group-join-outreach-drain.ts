import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { sha256Hex } from "../primitives";
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
import {
  chooseHostedLinqSignupWelcomeLine,
  resolveHostedLinqSignupWelcomeDailyLimit,
} from "../hosted-onboarding/linq-routing-policy";
import { countHostedMemberHomeLinqBindingsByRecipientPhone } from "../hosted-onboarding/hosted-member-routing-linq";
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
const HOSTED_GROUP_JOIN_OUTREACH_LINE_PACE_MS = 60_000;
const HOSTED_GROUP_JOIN_OUTREACH_PACE_JITTER_MS = 30_000;
const HOSTED_GROUP_JOIN_OUTREACH_MAX_PER_SWEEP = 10;
const HOSTED_GROUP_JOIN_OUTREACH_SWEEP_BUDGET_MS = 20_000;
const HOSTED_GROUP_JOIN_OUTREACH_RESERVED_WELCOME_SLOTS = 10;
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

/**
 * Variants for the one private first-contact text.
 *
 * Deliverability requires that many recipients not receive byte-identical copy,
 * and equally forbids faking variation with padding or synonym churn. So these
 * are a small set of genuinely different openers that each keep the same
 * properties: they name the actual group, contain no link, ask for a reply, and
 * read as one person writing to another.
 *
 * Selection is by digest of the outreach id, so a retried or replayed dispatch
 * always composes the identical message and the provider idempotency key stays
 * meaningful.
 */
const HOSTED_GROUP_JOIN_OUTREACH_MESSAGES: readonly ((groupName: string) => string)[] = [
  (g) => `You liked the invite to ${g}. Reply here and I'll help you join.`,
  (g) => `Your like on the invite to ${g} came through. Reply here and I'll get you set up.`,
  (g) => `You're in for ${g}? Reply here and I'll take it from there.`,
  (g) => `Thanks for the like on the invite to ${g}. Send me a message here and I'll sort your spot.`,
  (g) => `Got your like on the invite to ${g}. Reply here whenever and I'll set you up.`,
  (g) => `That was you liking the invite to ${g}, right? Reply here and I'll finish it off.`,
  (g) => `I saw your like on the invite to ${g}. Say hi here and I'll walk you in.`,
  (g) => `You hearted the invite to ${g}. Reply here and I'll handle the rest.`,
  (g) => `Noticed your like on the invite to ${g}. Message me here and I'll get you in.`,
  (g) => `You liked the invite to ${g}. Say hi here and I'll sort the rest.`,
  (g) => `Your like came through on the invite to ${g}. Reply here and I'll set it up.`,
  (g) => `Looks like you want in on ${g}. Reply here and I'll make it happen.`,
  (g) => `You're keen on ${g} by the look of it. Reply here and I'll get you added.`,
  (g) => `You liked the invite to ${g}. Message me here and I'll do the rest.`,
  (g) => `Saw the like on your end for ${g}. Reply here and I'll take care of it.`,
  (g) => `You tapped like on the invite to ${g}. Reply here and I'll get you joined.`,
  (g) => `Your like on ${g} landed with me. Say hi here and I'll set you up.`,
  (g) => `You liked the invite to ${g}. Drop me a line here and I'll get you in.`,
  (g) => `Getting you into ${g} takes one message. Reply here and I'll start it.`,
  (g) => `You liked the invite to ${g}. Tell me here and I'll get it moving.`,
  (g) => `Happy to get you into ${g}. Reply here and I'll set it up.`,
  (g) => `You liked the invite to ${g}. Reply here and I'll get you in.`,
  (g) => `Your like on the invite to ${g} reached me. Message me here and I'll finish it.`,
  (g) => `You liked the invite to ${g}. A quick reply here is all I need.`,
  (g) => `One reply and you're into ${g}. Send me a message here whenever.`,
];

export const HOSTED_GROUP_JOIN_OUTREACH_VARIANT_COUNT =
  HOSTED_GROUP_JOIN_OUTREACH_MESSAGES.length;

export function buildHostedGroupJoinOutreachMessage(input: {
  groupDisplayName: string | null | undefined;
  outreachId: string;
}): string {
  const groupName = normalizeHostedGroupJoinOutreachGroupName(input.groupDisplayName);
  const variantIndex = readHostedGroupJoinOutreachVariantIndex(input.outreachId);

  return HOSTED_GROUP_JOIN_OUTREACH_MESSAGES[variantIndex]!(groupName);
}

export function resolveHostedGroupJoinOutreachDailyLimit(
  line: Parameters<typeof resolveHostedLinqSignupWelcomeDailyLimit>[0],
): number {
  return Math.max(
    0,
    resolveHostedLinqSignupWelcomeDailyLimit(line)
      - HOSTED_GROUP_JOIN_OUTREACH_RESERVED_WELCOME_SLOTS,
  );
}

function readHostedGroupJoinOutreachPaceJitterMs(outreachId: string): number {
  const digest = sha256Hex(`group-join-outreach-pace:${outreachId}`);

  return Number.parseInt(digest.slice(0, 8), 16)
    % HOSTED_GROUP_JOIN_OUTREACH_PACE_JITTER_MS;
}

export function readHostedGroupJoinOutreachVariantIndex(outreachId: string): number {
  // A digest, not the raw id, so the choice does not correlate with id ordering.
  const digest = sha256Hex(`group-join-outreach-message:${outreachId}`);

  return Number.parseInt(digest.slice(0, 8), 16)
    % HOSTED_GROUP_JOIN_OUTREACH_MESSAGES.length;
}

export type HostedGroupJoinOutreachSweepResult = {
  attempted: number;
  results: HostedGroupJoinOutreachDrainResult[];
  sent: number;
};

/**
 * Drains up to a bounded number of due outreaches per sweep.
 *
 * Throughput comes from using several lines in the same minute, not from one line
 * sending faster: each attempt re-reads line state, and a line that dispatched
 * inside its jittered pace window is excluded from selection. So the real ceiling
 * is the size of the healthy pool, and a small pool naturally paces itself instead
 * of bursting. Stops early on the first non-sending outcome so a blocked backlog
 * costs one attempt rather than the whole budget.
 */
export async function drainHostedGroupJoinOutreachSweep(input: {
  max?: number;
  now?: Date;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<HostedGroupJoinOutreachSweepResult> {
  const max = Math.max(1, input.max ?? HOSTED_GROUP_JOIN_OUTREACH_MAX_PER_SWEEP);
  const results: HostedGroupJoinOutreachDrainResult[] = [];
  // This sweep shares a billing-critical cron, and each attempt makes a provider
  // call, so it yields on elapsed time as well as count. Rows it does not reach
  // stay due and the next minute picks them up.
  const startedAtMs = Date.now();

  for (let attempt = 0; attempt < max; attempt += 1) {
    if (input.signal?.aborted) {
      break;
    }
    if (
      attempt > 0
      && Date.now() - startedAtMs >= HOSTED_GROUP_JOIN_OUTREACH_SWEEP_BUDGET_MS
    ) {
      break;
    }
    const result = await drainOneHostedGroupJoinOutreach({
      ...(input.now ? { now: input.now } : {}),
      prisma: input.prisma,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    results.push(result);
    if (result.kind !== "sent") {
      break;
    }
  }

  return {
    attempted: results.length,
    results,
    sent: results.filter((result) => result.kind === "sent").length,
  };
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

  // Pacing is per line, not global. "No bursts" is a per-line property, so
  // spacing each line's own sends is what lets several lines dispatch in the same
  // minute without any one line bursting. Jitter is derived from the row id rather
  // than a clock or RNG, so a replayed dispatch keeps the same schedule.
  const linePaceWindowMs = HOSTED_GROUP_JOIN_OUTREACH_LINE_PACE_MS
    + readHostedGroupJoinOutreachPaceJitterMs(outreach.id);
  const recentlyUsedLineKeys = new Set(
    (await input.tx.hostedGroupJoinOutreach.findMany({
      where: {
        dispatchStartedAt: {
          gt: new Date(input.now.getTime() - linePaceWindowMs),
        },
        id: { not: outreach.id },
        phoneNumberLookupKey: { not: null },
      },
      select: { phoneNumberLookupKey: true },
    }))
      .map((row) => row.phoneNumberLookupKey)
      .filter((lookupKey): lookupKey is string => Boolean(lookupKey)),
  );

  const allHealthyLines = await listHostedLinqHealthyProactiveLines({
    prisma: input.tx,
  });
  const healthyLines = allHealthyLines.filter(
    (line) => !recentlyUsedLineKeys.has(line.phoneNumberLookupKey),
  );
  if (allHealthyLines.length > 0 && healthyLines.length === 0) {
    // Every healthy line sent recently. Wait rather than double up on one.
    return deferHostedGroupJoinOutreachTx({
      nextAttemptAt: new Date(input.now.getTime() + linePaceWindowMs),
      now: input.now,
      outreachId: outreach.id,
      reason: "line_pacing",
      tx: input.tx,
    });
  }
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

  // A row keeps the line it was first dispatched from, but only while that line is
  // still usable. If the pinned line has gone unhealthy or left the pool, the row
  // is re-assigned instead of waiting on it forever: the provider idempotency key
  // is derived from the outreach id rather than the line, and the row's selected
  // line is rewritten below before dispatch, so the egress authority follows it.
  // A pinned line that is merely inside its pace window is a wait, not a move.
  const pinnedLine = outreach.phoneNumberLookupKey
    ? healthyLines.find(
        (candidate) =>
          candidate.phoneNumberLookupKey === outreach.phoneNumberLookupKey,
      ) ?? null
    : null;
  const pinnedLineIsPacedOut = Boolean(
    outreach.phoneNumberLookupKey
      && !pinnedLine
      && allHealthyLines.some(
        (candidate) =>
          candidate.phoneNumberLookupKey === outreach.phoneNumberLookupKey,
      ),
  );
  if (pinnedLineIsPacedOut) {
    return deferHostedGroupJoinOutreachTx({
      nextAttemptAt: new Date(input.now.getTime() + linePaceWindowMs),
      now: input.now,
      outreachId: outreach.id,
      reason: "line_pacing",
      tx: input.tx,
    });
  }

  const line = pinnedLine
    ?? await claimHostedGroupJoinOutreachLineCapacityTx({
      lines: healthyLines,
      now: input.now,
      tx: input.tx,
    });
  if (!line) {
    return deferHostedGroupJoinOutreachTx({
      nextAttemptAt: resolveNextUtcDaySendAttempt({
        now: input.now,
        participantPhoneNumber,
      }),
      now: input.now,
      outreachId: outreach.id,
      reason: "line_capacity_exhausted",
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
      message: buildHostedGroupJoinOutreachMessage({
        groupDisplayName: offer.group.displayName,
        outreachId: outreach.id,
      }),
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
  // Reuse the shared proactive line policy instead of re-deriving one here. It
  // balances on both durable home-line load and today's new-conversation count,
  // and applies the per-line warmup limit itself, so pre-member outreach spreads
  // across the pool the same way signup welcomes do.
  const dayUtc = startOfUtcDay(input.now);
  const activeMembersByRecipientPhone =
    await countHostedMemberHomeLinqBindingsByRecipientPhone({
      now: input.now,
      prisma: input.tx,
      recipientPhones: input.lines.map((line) => line.phoneNumber),
    });
  const newAssignmentsByRecipientPhone = new Map(
    input.lines.map((line) => [
      line.phoneNumber,
      line.proactiveConversationDayUtc?.getTime() === dayUtc.getTime()
        ? line.proactiveConversationCount ?? 0
        : 0,
    ]),
  );

  for (let attempt = 0; attempt < input.lines.length; attempt += 1) {
    const line = chooseHostedLinqSignupWelcomeLine({
      activeMembersByRecipientPhone,
      lines: input.lines,
      newAssignmentsByRecipientPhone,
      preferredRecipientPhone: null,
    });
    if (!line) {
      return null;
    }

    // Signup welcomes answer someone who already joined and is waiting, so they
    // take priority over proactive outreach on a shared line budget. Outreach
    // claims against a reduced limit, leaving the remainder for onboarding.
    const limit = resolveHostedGroupJoinOutreachDailyLimit(line);
    if (
      await claimHostedLinqProactiveConversationCapacityTx({
        dayUtc,
        limit,
        phoneNumberLookupKey: line.phoneNumberLookupKey,
        prisma: input.tx,
      })
    ) {
      return line;
    }

    // Treat the losing line as full for the rest of this selection so the next
    // pass considers a different one.
    newAssignmentsByRecipientPhone.set(line.phoneNumber, limit);
  }

  return null;
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
