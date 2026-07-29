import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { sha256Hex } from "../primitives";
import {
  claimHostedLinqDeliveryProviderDispatchTx,
  markHostedLinqDeliveryAcceptedTx,
  markHostedLinqDeliverySendFailedTx,
} from "../hosted-onboarding/linq-delivery-store";
import {
  claimHostedLinqProactiveConversationCapacityTx,
  listHostedLinqHealthyProactiveLines,
  readHostedLinqRecentMessageEffectCountsTx,
  type HostedLinqAssignableHomeLine,
} from "../hosted-onboarding/linq-line-store";
import { createHostedLinqChat } from "../hosted-onboarding/linq-client";
import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import {
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
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
  acquireHostedLinqParticipantPhoneLockTx,
} from "../hosted-onboarding/linq-participant-contact";
import {
  decideHostedGroupJoinOutreachSendWindow,
} from "./group-join-outreach-window";
import {
  HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
  HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
  acquireHostedGroupJoinOutreachDrainLockTx,
  buildHostedGroupJoinOutreachIdempotencyKey,
  markHostedGroupJoinOutreachSkippedDeliveryTx,
  readHostedGroupJoinOutreachParticipantPhone,
} from "./group-join-outreach-store";
import {
  beginHostedGroupJoinProviderRequest,
  createHostedGroupJoinProviderFenceState,
  HOSTED_GROUP_JOIN_PROVIDER_FENCE_LOCK_TIMEOUT_MS,
  HOSTED_GROUP_JOIN_PROVIDER_FENCE_TRANSACTION_OPTIONS,
  type HostedGroupJoinProviderFenceState,
} from "./group-join-provider-fence";

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

/**
 * Variants for the one private first-contact text.
 *
 * Deliverability requires that many recipients not receive byte-identical copy,
 * and equally forbids faking variation with padding or synonym churn. So these
 * are a bank of genuinely different leads that each name the actual
 * group, contain no link, and never claim a specific gesture that the durable
 * outreach row does not retain. One shared handoff sentence owns the product
 * invariant that replying starts, but does not complete, the next step.
 *
 * Selection is by digest of the outreach id, so a retried or replayed dispatch
 * always composes the identical message and the provider idempotency key stays
 * meaningful.
 */
const HOSTED_GROUP_JOIN_OUTREACH_LEADS: readonly ((groupName: string) => string)[] = [
  (g) => `You reacted to the invite to ${g}.`,
  (g) => `Your reaction to the invite to ${g} came through.`,
  (g) => `Interested in ${g}?`,
  (g) => `Thanks for responding to the invite to ${g}.`,
  (g) => `Got your reaction to the invite to ${g}.`,
  (g) => `That was you responding to the invite to ${g}, right?`,
  (g) => `I saw your reaction to the invite to ${g}.`,
  (g) => `You responded to the invite to ${g}.`,
  (g) => `Noticed your reaction to the invite to ${g}.`,
  (g) => `You showed interest in the invite to ${g}.`,
  (g) => `Your response came through on the invite to ${g}.`,
  (g) => `Looks like ${g} caught your eye.`,
  (g) => `Looks like you're interested in ${g}.`,
  (g) => `I noticed your interest in ${g}.`,
  (g) => `Saw your response to the invite to ${g}.`,
  (g) => `You reacted to ${g}'s invite.`,
  (g) => `Your reaction to ${g} reached me.`,
  (g) => `Thanks for showing interest in ${g}.`,
  (g) => `The invite to ${g} got your reaction.`,
  (g) => `I caught your response to the invite to ${g}.`,
  (g) => `Want help with ${g}?`,
  (g) => `It looks like the invite to ${g} interested you.`,
  (g) => `Your response to the invite to ${g} reached me.`,
  (g) => `I noticed you responded to the invite to ${g}.`,
  (g) => `Want help joining ${g}?`,
  (g) => `Want to keep going with ${g}?`,
  (g) => `Would you like to continue with ${g}?`,
  (g) => `Ready for the next step with ${g}?`,
  (g) => `Want the next step for ${g}?`,
  (g) => `Should I help you continue toward ${g}?`,
  (g) => `Would a hand with joining ${g} help?`,
  (g) => `Want me to help you move forward with ${g}?`,
  (g) => `Still interested in joining ${g}?`,
  (g) => `Want to continue toward joining ${g}?`,
  (g) => `Shall we keep going with ${g}?`,
  (g) => `Want to pick up where the invite to ${g} left off?`,
  (g) => `Would you like to follow up on the invite to ${g}?`,
  (g) => `Ready to follow up on your interest in ${g}?`,
  (g) => `Want to move ahead with ${g}?`,
  (g) => `Want to see the next joining step for ${g}?`,
  (g) => `I can help you continue with ${g}.`,
  (g) => `I can help with the next step for ${g}.`,
  (g) => `We can continue with ${g} from here.`,
  (g) => `We can take the next step toward ${g} from here.`,
  (g) => `The next step for ${g} is here when you're ready.`,
  (g) => `If you'd like to join ${g}, I can help with the next step.`,
  (g) => `If ${g} still interests you, I can help you continue.`,
  (g) => `If you want to continue with ${g}, I'm here to help.`,
  (g) => `Your interest in ${g} can continue from here.`,
  (g) => `The invite to ${g} is still here if you want to continue.`,
  (g) => `There's another step toward joining ${g} whenever you're ready.`,
  (g) => `Joining ${g} can continue from this conversation.`,
  (g) => `We can keep the invite to ${g} moving when you're ready.`,
  (g) => `We can carry on with the invite to ${g} from here.`,
  (g) => `I can guide you to the next step for ${g}.`,
  (g) => `I can point you to the next step for ${g}.`,
  (g) => `I can help you follow through on the invite to ${g}.`,
  (g) => `I can help you take your next step toward ${g}.`,
  (g) => `Ready to continue from the invite to ${g}?`,
  (g) => `Want to continue from your response to ${g}?`,
  (g) => `Should we continue from your response to ${g}?`,
  (g) => `Want to follow your response to ${g} with the next step?`,
  (g) => `Would you like to take the next step toward ${g}?`,
  (g) => `Shall I help with the next step toward ${g}?`,
  (g) => `Ready to look at joining ${g}?`,
  (g) => `Want to see what comes next for joining ${g}?`,
  (g) => `Would you like to see what comes next for ${g}?`,
  (g) => `Want help following up on the invite to ${g}?`,
  (g) => `Would help with the invite to ${g} be useful?`,
  (g) => `Need a hand with the invite to ${g}?`,
  (g) => `Want some help with the invitation to ${g}?`,
  (g) => `Can I help you continue with ${g}?`,
  (g) => `Should I show you the next step for ${g}?`,
  (g) => `Want me to send the next step for ${g}?`,
  (g) => `Would you like the next step for ${g} sent here?`,
  (g) => `Ready for me to send the next step for ${g}?`,
  (g) => `Want the joining link for ${g}?`,
  (g) => `Should I send the joining link for ${g}?`,
  (g) => `Would you like the joining link for ${g}?`,
  (g) => `Ready for the joining link for ${g}?`,
  (g) => `Want me to send the joining step for ${g} here?`,
  (g) => `Would you like me to send the next step for ${g} here?`,
  (g) => `Want to begin the joining process for ${g}?`,
  (g) => `Would you like to begin joining ${g}?`,
  (g) => `Ready to begin the next step for ${g}?`,
  (g) => `Want to carry your interest in ${g} forward?`,
  (g) => `Should we carry the invite to ${g} forward?`,
  (g) => `Want to keep the invitation to ${g} moving?`,
  (g) => `Would you like to keep the invite to ${g} moving?`,
  (g) => `Ready to keep moving with ${g}?`,
  (g) => `Want to go one step further with ${g}?`,
  (g) => `Would you like to go one step further with ${g}?`,
  (g) => `Should we take one more step toward ${g}?`,
  (g) => `Want to keep your interest in ${g} moving?`,
  (g) => `Ready to turn your response to ${g} into the next step?`,
  (g) => `Would you like help turning your interest in ${g} into the next step?`,
  (g) => `Want to follow through on joining ${g}?`,
  (g) => `Ready to follow through on joining ${g}?`,
  (g) => `Would you like to keep working toward joining ${g}?`,
  (g) => `Want to take your response to ${g} one step further?`,
];

const HOSTED_GROUP_JOIN_OUTREACH_REPLY_HANDOFF =
  "Reply here to start the next step.";

export const HOSTED_GROUP_JOIN_OUTREACH_VARIANT_COUNT =
  HOSTED_GROUP_JOIN_OUTREACH_LEADS.length;

export function buildHostedGroupJoinOutreachMessage(input: {
  groupDisplayName: string | null | undefined;
  outreachId: string;
}): string {
  const groupName = normalizeHostedGroupJoinOutreachGroupName(input.groupDisplayName);
  const variantIndex = readHostedGroupJoinOutreachVariantIndex(input.outreachId);

  const lead = HOSTED_GROUP_JOIN_OUTREACH_LEADS[variantIndex]!(groupName);

  return `${lead} ${HOSTED_GROUP_JOIN_OUTREACH_REPLY_HANDOFF}`;
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
    % HOSTED_GROUP_JOIN_OUTREACH_LEADS.length;
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
  const result = await input.prisma.$transaction(
    async (tx) => drainOneHostedGroupJoinOutreachTx({
      now,
      ...(input.signal ? { signal: input.signal } : {}),
      providerFenceState: createHostedGroupJoinProviderFenceState(),
      tx,
    }),
    HOSTED_GROUP_JOIN_PROVIDER_FENCE_TRANSACTION_OPTIONS,
  );
  logHostedGroupJoinOutreachDrainResult(result);
  return result;
}

async function drainOneHostedGroupJoinOutreachTx(input: {
  now: Date;
  providerFenceState: HostedGroupJoinProviderFenceState;
  signal?: AbortSignal;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinOutreachDrainResult> {
  await acquireHostedGroupJoinOutreachDrainLockTx(input.tx);

  const outreach = await input.tx.hostedGroupJoinOutreach.findFirst({
    orderBy: [
      { requestedAt: "asc" },
      { id: "asc" },
    ],
    where: {
      deliveries: {
        none: {
          source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
          template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
          OR: [
            { acceptedAt: { not: null } },
            { deliveredAt: { not: null } },
            { skippedAt: { not: null } },
            { status: { in: ["accepted", "delivered", "skipped"] } },
            {
              failedAt: { not: null },
              retryAfterAt: null,
            },
            {
              retryAfterAt: null,
              status: "failed",
            },
          ],
        },
      },
      nextAttemptAt: { lte: input.now },
    },
    select: {
      attemptCount: true,
      id: true,
      offerId: true,
      participantPhoneEncrypted: true,
      participantPhoneLookupKey: true,
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

  await acquireHostedLinqParticipantPhoneLockTx({
    lockTimeoutMs: HOSTED_GROUP_JOIN_PROVIDER_FENCE_LOCK_TIMEOUT_MS,
    phoneNumber: participantPhoneNumber,
    tx: input.tx,
  });

  const offer = await input.tx.hostedGroupJoinOffer.findUnique({
    where: { id: outreach.offerId },
    select: {
      revokedAt: true,
      group: {
        select: {
          displayName: true,
          id: true,
          joinCode: true,
          runtimeMember: {
            select: { suspendedAt: true },
          },
          runtimeMemberId: true,
        },
      },
    },
  });
  if (!offer) {
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
  if (
    !offer.group?.runtimeMemberId
    || !offer.group.joinCode
    || !offer.group.runtimeMember
    || offer.group.runtimeMember.suspendedAt
  ) {
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
    (await input.tx.hostedLinqDelivery.findMany({
      where: {
        attemptedAt: {
          gt: new Date(input.now.getTime() - linePaceWindowMs),
        },
        groupJoinOutreachId: { not: outreach.id },
        phoneNumberLookupKey: { not: null },
        source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
        template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
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
  // is derived from the outreach id rather than the line, and the next delivery
  // claim carries the selected line.
  // A pinned line that is merely inside its pace window is a wait, not a move.
  const existingDelivery = await input.tx.hostedLinqDelivery.findFirst({
    orderBy: [
      { attemptedAt: "desc" },
      { id: "desc" },
    ],
    where: {
      groupJoinOutreachId: outreach.id,
      phoneNumberLookupKey: { not: null },
      source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
      template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
    },
    select: { phoneNumberLookupKey: true },
  });
  const pinnedLineKey = existingDelivery?.phoneNumberLookupKey ?? null;
  const pinnedLine = pinnedLineKey
    ? healthyLines.find(
        (candidate) =>
          candidate.phoneNumberLookupKey === pinnedLineKey,
      ) ?? null
    : null;
  const pinnedLineIsPacedOut = Boolean(
    pinnedLineKey
      && !pinnedLine
      && allHealthyLines.some(
        (candidate) =>
          candidate.phoneNumberLookupKey === pinnedLineKey,
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
    // Losing a pinned line is a health transition, not proof the pool is spent for
    // the rest of the day, so it keeps the short retry. Only a row that was never
    // pinned and found no capacity waits for the next day's window.
    const lostPinnedLine = Boolean(pinnedLineKey);
    return deferHostedGroupJoinOutreachTx({
      nextAttemptAt: lostPinnedLine
        ? new Date(
            input.now.getTime() + HOSTED_GROUP_JOIN_OUTREACH_NO_LINE_RETRY_MS,
          )
        : resolveNextUtcDaySendAttempt({
            now: input.now,
            participantPhoneNumber,
          }),
      now: input.now,
      outreachId: outreach.id,
      reason: lostPinnedLine
        ? "pinned_line_unavailable"
        : "line_capacity_exhausted",
      tx: input.tx,
    });
  }

  const idempotencyKey = buildHostedGroupJoinOutreachIdempotencyKey(outreach.id);
  const deliveryClaim = await claimHostedLinqDeliveryProviderDispatchTx({
    attemptedAt: input.now,
    groupJoinOutreachId: outreach.id,
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
      lastDeferralReason: null,
      nextAttemptAt: new Date(
        input.now.getTime() + HOSTED_GROUP_JOIN_OUTREACH_PROVIDER_RETRY_MS,
      ),
    },
  });

  try {
    beginHostedGroupJoinProviderRequest(input.providerFenceState);
    const sent = await createHostedLinqChat({
      from: line.phoneNumber,
      idempotencyKey,
      message: buildHostedGroupJoinOutreachMessage({
        groupDisplayName: offer.group.displayName,
        outreachId: outreach.id,
      }),
      ...(input.signal ? { signal: input.signal } : {}),
      to: [participantPhoneNumber],
    });
    input.providerFenceState.providerRequestCompleted = true;
    await markHostedLinqDeliveryAcceptedTx({
      acceptedAt: new Date(),
      idempotencyKey,
      linqChatId: sent.chatId,
      messageId: sent.messageId,
      prisma: input.tx,
    });
    return {
      kind: "sent",
      outreachId: outreach.id,
    };
  } catch (error) {
    if (
      !input.providerFenceState.providerRequestStarted
      || input.providerFenceState.providerRequestCompleted
    ) {
      throw error;
    }
    return recordHostedGroupJoinOutreachProviderFailureTx({
      error,
      idempotencyKey,
      nextAttemptCount: outreach.attemptCount + 1,
      now: input.now,
      outreachId: outreach.id,
      tx: input.tx,
    });
  }
}

async function claimHostedGroupJoinOutreachLineCapacityTx(input: {
  lines: readonly HostedLinqAssignableHomeLine[];
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedLinqAssignableHomeLine | null> {
  // Reuse the shared proactive line policy instead of re-deriving one here. It
  // balances on recent message effects, durable home-line load, and today's
  // new-conversation count, and applies the per-line warmup limit itself, so
  // pre-member outreach spreads across the pool the same way signup welcomes do.
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
  const recentMessageEffectsByLineLookupKey = input.lines.length > 1
    ? await readHostedLinqRecentMessageEffectCountsTx({
        lineLookupKeys: input.lines.map((line) => line.phoneNumberLookupKey),
        now: input.now,
        prisma: input.tx,
      })
    : new Map<string, number>();

  // Drop a losing line from the candidate set rather than marking it full in the
  // count map. The shared chooser filters against the full signup-welcome limit, so
  // recording the lower outreach limit would leave that line eligible and it could
  // win every iteration while another line still had outreach capacity.
  let candidates = [...input.lines];
  while (candidates.length > 0) {
    const line = chooseHostedLinqSignupWelcomeLine({
      activeMembersByRecipientPhone,
      lines: candidates,
      newAssignmentsByRecipientPhone,
      preferredRecipientPhone: null,
      recentMessageEffectsByLineLookupKey,
    });
    if (!line) {
      return null;
    }

    // Signup welcomes answer someone who already joined and is waiting, so they
    // keep a reserved share of a line's daily budget: outreach claims against a
    // reduced limit.
    if (
      await claimHostedLinqProactiveConversationCapacityTx({
        dayUtc,
        limit: resolveHostedGroupJoinOutreachDailyLimit(line),
        phoneNumberLookupKey: line.phoneNumberLookupKey,
        prisma: input.tx,
      })
    ) {
      return line;
    }

    candidates = candidates.filter(
      (candidate) => candidate.phoneNumberLookupKey !== line.phoneNumberLookupKey,
    );
  }

  return null;
}

async function recordHostedGroupJoinOutreachProviderFailureTx(input: {
  error: unknown;
  idempotencyKey: string;
  nextAttemptCount: number;
  now: Date;
  outreachId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinOutreachDrainResult> {
  const retryable = !isHostedOnboardingError(input.error) || input.error.retryable;
  const terminal = !retryable
    || input.nextAttemptCount >= HOSTED_GROUP_JOIN_OUTREACH_MAX_PROVIDER_ATTEMPTS;
  const failedAt = new Date();
  const nextAttemptAt = new Date(
    failedAt.getTime() + HOSTED_GROUP_JOIN_OUTREACH_PROVIDER_RETRY_MS,
  );
  await markHostedLinqDeliverySendFailedTx({
    expectedAttemptedAt: input.now,
    failedAt,
    failureCode: readHostedGroupJoinOutreachFailureCode(input.error),
    failureReason: "Hosted group join outreach provider dispatch failed.",
    idempotencyKey: input.idempotencyKey,
    prisma: input.tx,
    retryAfterAt: terminal ? null : nextAttemptAt,
  });
  if (!terminal) {
    await input.tx.hostedGroupJoinOutreach.updateMany({
      where: { id: input.outreachId },
      data: {
        lastDeferralReason: "provider_retry",
        nextAttemptAt,
      },
    });
  }

  return terminal
    ? {
        kind: "skipped",
        outreachId: input.outreachId,
        reason: retryable ? "provider_attempt_limit" : "provider_rejected",
      }
    : {
        kind: "deferred",
        outreachId: input.outreachId,
        reason: "provider_retry",
      };
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
    where: { id: input.outreachId },
    data: {
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
  await markHostedGroupJoinOutreachSkippedDeliveryTx({
    now: input.now,
    outreachId: input.outreachId,
    reason: input.reason,
    tx: input.tx,
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
