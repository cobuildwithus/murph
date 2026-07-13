import type { Prisma, PrismaClient } from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
  readHostedPhoneHint,
} from "./contact-privacy";
import {
  projectHostedLinqLineForDeliveryReceiptTx,
  upsertHostedLinqLineForPhoneTx,
} from "./linq-line-store";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
  createHostedLinqDeliverySourceRefLookupKey,
} from "./linq-observability-identifiers";
import {
  buildHostedLinqInviteSignupEffectId,
  parseHostedLinqInviteSignupEffectId,
} from "./linq-invite-signup-effect-id";
import {
  compareHostedLinqProviderEventProgress,
  createHostedLinqProviderEventProgress,
} from "./linq-provider-event-progress";
import {
  sanitizeHostedOnboardingPersistedErrorCode,
  sanitizeHostedOnboardingPersistedErrorMessage,
} from "./http";
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import { toHostedOnboardingLogIdSuffix } from "./logging";
import { normalizePhoneNumber } from "./phone";
import { generateHostedRandomPrefixedId, sha256Hex } from "../primitives";
import {
  acquireHostedLinqChatOwnershipLockTx,
} from "../hosted-routing/linq-chat-ownership-lock";

type HostedLinqDeliveryClient = PrismaClient | Prisma.TransactionClient;
const HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS =
  "provider_dispatch_started";
type HostedLinqDeliveryProviderDispatchData = {
  attemptedAt: Date;
  failedAt: null;
  failureCode: null;
  failureReason: null;
  linqChatLookupKey: string | null;
  phoneNumberHint: string | null;
  phoneNumberLookupKey: string | null;
  retryAfterAt: null;
  skippedAt: null;
  skipReason: null;
  source: string;
  sourceRef: string | null;
  status:
    | "attempted"
    | typeof HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS;
  targetKind: string | null;
  template: string | null;
};
export const HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS = 15 * 60 * 1000;
const HOSTED_AI_USAGE_LINQ_NOTICE_DELIVERY_SOURCE =
  "hosted_webhook_side_effect";
const HOSTED_AI_USAGE_RUNTIME_NOTICE_DELIVERY_SOURCE =
  "hosted_runtime_ai_usage_limit_notice";

type HostedAiUsageLimitNoticeDeliveryClaim =
  | {
    idempotencyKey: string;
    status: "claimed";
  }
  | {
    retryAt?: Date;
    status: "in_flight";
  }
  | {
    status: "already_notified";
  };

type HostedAiUsageLimitNoticeDeliverySource =
  | typeof HOSTED_AI_USAGE_LINQ_NOTICE_DELIVERY_SOURCE
  | typeof HOSTED_AI_USAGE_RUNTIME_NOTICE_DELIVERY_SOURCE;

type HostedLinqDeliveryReceiptData = {
  deliveryStatus: "delivered" | "failed";
  eventId: string;
  failureCode: string | null;
  failureReason: string | null;
  phoneNumberLookupKey?: string | null;
  providerCreatedAt: Date;
  service: string | null;
};

type HostedLinqReopenOnboardingLink = {
  memberId: string;
  occurredAt: string;
};

export async function recordHostedLinqDeliveryAttemptTx(input: {
  attemptedAt?: Date;
  idempotencyKey?: string | null;
  linqChatId?: string | null;
  phoneNumber?: string | null;
  prisma: HostedLinqDeliveryClient;
  source: string;
  sourceRef?: string | null;
  targetKind?: string | null;
  template?: string | null;
}): Promise<{ id: string }> {
  const attemptedAt = input.attemptedAt ?? new Date();
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(
    normalizeNullable(input.idempotencyKey),
  );
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  const phoneNumberLookupKey = await ensureHostedLinqDeliveryLineTx({
    observedAt: attemptedAt,
    phoneNumber,
    prisma: input.prisma,
  });
  const data = {
    attemptedAt,
    linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
    phoneNumberHint: phoneNumber ? readHostedPhoneHint(phoneNumber) : null,
    phoneNumberLookupKey,
    retryAfterAt: null,
    source: input.source,
    sourceRef: normalizeHostedLinqDeliverySourceRef({
      sourceRef: input.sourceRef,
      template: input.template,
    }),
    status: "attempted",
    targetKind: normalizeNullable(input.targetKind),
    template: normalizeNullable(input.template),
  };

  if (!idempotencyKey) {
    const created = await input.prisma.hostedLinqDelivery.create({
      data: {
        ...data,
        id: generateHostedRandomPrefixedId("hld"),
      },
      select: { id: true },
    });
    return created;
  }

  const id = buildHostedLinqDeliveryId(idempotencyKey);
  const createData = {
    ...data,
    id,
    idempotencyKey,
  };
  const updateData = {
    ...data,
    failedAt: null,
    failureCode: null,
    failureReason: null,
    retryAfterAt: null,
    skippedAt: null,
    skipReason: null,
    status: "attempted",
  };

  const existing = await input.prisma.hostedLinqDelivery.findUnique({
    where: { idempotencyKey },
    select: hostedLinqDeliveryLifecycleSelect,
  });
  if (existing) {
    return updateHostedLinqDeliveryAttemptIfPreProvider({
      data: updateData,
      delivery: existing,
      prisma: input.prisma,
    });
  }

  try {
    return await input.prisma.hostedLinqDelivery.create({
      data: createData,
      select: { id: true },
    });
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }
    const concurrent = await input.prisma.hostedLinqDelivery.findUnique({
      where: { idempotencyKey },
      select: hostedLinqDeliveryLifecycleSelect,
    });
    if (!concurrent) {
      throw error;
    }
    return updateHostedLinqDeliveryAttemptIfPreProvider({
      data: updateData,
      delivery: concurrent,
      prisma: input.prisma,
    });
  }
}

const HOSTED_LINQ_INVITE_SIGNUP_MAX_ATTEMPTS_PER_DAY = 5;

/**
 * Resolves which signup-link delivery attempt an inbound-driven send should
 * run as. Attempts are first-class delivery rows: a row whose provider
 * conclusively failed (terminal receipt) can never be re-dispatched under its
 * own idempotency key (the provider would dedupe against the dead message),
 * so the retry advances to the next attempt ordinal. A synchronous send
 * failure keeps its ordinal: the row is not provider-correlated and the
 * existing stale-attempt re-claim on the same key stays dedupe-safe against
 * a provider that may have half-processed it. Returns null when the day's
 * attempt budget is exhausted.
 */
export async function resolveHostedLinqInviteSignupDispatchEffectIdTx(input: {
  effectId: string;
  prisma: HostedLinqDeliveryClient;
}): Promise<string | null> {
  const parsed = parseHostedLinqInviteSignupEffectId(input.effectId);
  if (!parsed) {
    return input.effectId;
  }

  const candidates = Array.from(
    { length: HOSTED_LINQ_INVITE_SIGNUP_MAX_ATTEMPTS_PER_DAY },
    (_, index) => buildHostedLinqInviteSignupEffectId({
      attempt: index + 1,
      memberId: parsed.memberId,
      occurredAt: parsed.dayUtc,
    }),
  );
  const lookupKeys = candidates.map(
    (candidate) => createHostedLinqDeliveryIdempotencyLookupKey(candidate),
  );
  const rows = await input.prisma.hostedLinqDelivery.findMany({
    where: {
      idempotencyKey: {
        in: lookupKeys.filter((key): key is string => key !== null),
      },
    },
    select: {
      acceptedAt: true,
      deliveredAt: true,
      idempotencyKey: true,
      lastReceiptAt: true,
      messageLookupKey: true,
      status: true,
    },
  });
  const rowsByKey = new Map(rows.map((row) => [row.idempotencyKey, row]));

  for (const [index, candidate] of candidates.entries()) {
    const lookupKey = lookupKeys[index];
    const row = lookupKey ? rowsByKey.get(lookupKey) : undefined;
    if (!row) {
      return candidate;
    }
    if (row.status !== "failed" || !isHostedLinqDeliveryProviderCorrelated(row)) {
      return candidate;
    }
  }

  return null;
}

export async function claimHostedLinqDeliveryProviderDispatchTx(input: {
  attemptedAt?: Date;
  idempotencyKey?: string | null;
  linqChatId?: string | null;
  phoneNumber?: string | null;
  prisma: HostedLinqDeliveryClient;
  reclaimStalePreProviderAttempt?: boolean;
  source: string;
  sourceRef?: string | null;
  status?: HostedLinqDeliveryProviderDispatchData["status"];
  targetKind?: string | null;
  template?: string | null;
}): Promise<{
  claimed: boolean;
  confirmationPending?: true;
  id: string | null;
  retryAt?: Date;
}> {
  const attemptedAt = input.attemptedAt ?? new Date();
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(
    normalizeNullable(input.idempotencyKey),
  );
  if (!idempotencyKey) {
    return {
      claimed: true,
      id: null,
    };
  }

  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  const phoneNumberLookupKey = await ensureHostedLinqDeliveryLineTx({
    observedAt: attemptedAt,
    phoneNumber,
    prisma: input.prisma,
  });
  const data = {
    attemptedAt,
    failedAt: null,
    failureCode: null,
    failureReason: null,
    linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
    phoneNumberHint: phoneNumber ? readHostedPhoneHint(phoneNumber) : null,
    phoneNumberLookupKey,
    retryAfterAt: null,
    skippedAt: null,
    skipReason: null,
    source: input.source,
    sourceRef: normalizeHostedLinqDeliverySourceRef({
      sourceRef: input.sourceRef,
      template: input.template,
    }),
    status: input.status ?? "attempted",
    targetKind: normalizeNullable(input.targetKind),
    template: normalizeNullable(input.template),
  } satisfies HostedLinqDeliveryProviderDispatchData;
  const createData = {
    ...data,
    id: buildHostedLinqDeliveryId(idempotencyKey),
    idempotencyKey,
  };
  const existing = await input.prisma.hostedLinqDelivery.findUnique({
    where: { idempotencyKey },
    select: hostedLinqDeliveryLifecycleSelect,
  });
  if (existing) {
    return claimExistingHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      data,
      delivery: existing,
      prisma: input.prisma,
      reclaimStalePreProviderAttempt: input.reclaimStalePreProviderAttempt,
      source: input.source,
    });
  }

  const created = await input.prisma.hostedLinqDelivery.createMany({
    data: [createData],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return {
      claimed: true,
      id: createData.id,
    };
  }

  const concurrent = await input.prisma.hostedLinqDelivery.findUnique({
    where: { idempotencyKey },
    select: hostedLinqDeliveryLifecycleSelect,
  });
  if (!concurrent) {
    throw new Error("Hosted Linq delivery claim conflict did not preserve a row.");
  }
  return claimExistingHostedLinqDeliveryProviderDispatchTx({
    attemptedAt,
    data,
    delivery: concurrent,
    prisma: input.prisma,
    reclaimStalePreProviderAttempt: input.reclaimStalePreProviderAttempt,
    source: input.source,
  });
}

export async function recordHostedLinqRuntimeProviderDispatchFenceTx(input: {
  attemptedAt?: Date;
  idempotencyKey: string;
  linqChatId?: string | null;
  phoneNumber?: string | null;
  prisma: HostedLinqDeliveryClient;
  sourceRef?: string | null;
  targetKind?: string | null;
}): Promise<{
  claimed: boolean;
  confirmationPending?: true;
  id: string | null;
  retryAt?: Date;
}> {
  const attemptedAt = input.attemptedAt ?? new Date();
  return await claimHostedLinqDeliveryProviderDispatchTx({
    attemptedAt,
    idempotencyKey: input.idempotencyKey,
    linqChatId: input.linqChatId,
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
    source: "hosted_runtime_linq_delivery",
    sourceRef: input.sourceRef,
    status: HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS,
    targetKind: input.targetKind,
  });
}

export async function hasUnresolvedHostedLinqProviderDispatchForChatTx(input: {
  linqChatId: string;
  prisma: HostedLinqDeliveryClient;
}): Promise<boolean> {
  const linqChatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(
    input.linqChatId,
  );
  if (linqChatLookupKeys.length === 0) {
    return false;
  }

  const delivery = await input.prisma.hostedLinqDelivery.findFirst({
    select: { id: true },
    where: {
      acceptedAt: null,
      deliveredAt: null,
      lastReceiptAt: null,
      linqChatLookupKey: {
        in: linqChatLookupKeys,
      },
      messageLookupKey: null,
      skippedAt: null,
      failedAt: null,
      status: HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS,
    },
  });

  return delivery !== null;
}

export async function startHostedAiUsageLimitNoticeDispatchTx(input: {
  assertDispatchAuthority?: (
    prisma: Prisma.TransactionClient,
  ) => Promise<void>;
  attemptedAt: Date;
  linqChatId?: string | null;
  memberId: string;
  periodStart: Date;
  phoneNumber?: string | null;
  prisma: PrismaClient;
  source: HostedAiUsageLimitNoticeDeliverySource;
  sourceRef: string;
  targetKind: string;
}): Promise<HostedAiUsageLimitNoticeDeliveryClaim> {
  const markerConflict = new Error(
    "Hosted AI usage-limit notice marker was not claimable after delivery ownership.",
  );

  try {
    return await input.prisma.$transaction(async (prisma) => {
      if (input.linqChatId) {
        await acquireHostedLinqChatOwnershipLockTx({
          chatId: input.linqChatId,
          tx: prisma,
        });
      }
      await input.assertDispatchAuthority?.(prisma);

      const candidates = buildHostedLinqDeliveryClaimCandidates({
        currentIdempotencyKey: buildHostedAiUsageGateNoticeIdempotencyKey(input),
        legacyIdempotencyKeys: buildHostedAiUsageGateLegacyNoticeIdempotencyKeys(input),
      });
      const deliveries = candidates.length === 0
        ? []
        : await prisma.hostedLinqDelivery.findMany({
            where: {
              idempotencyKey: {
                in: candidates.map((candidate) => candidate.lookupKey),
              },
            },
            select: hostedLinqDeliveryClaimResolutionSelect,
          });
      const deliveriesByLookupKey = new Map(
        deliveries.map((delivery) => [delivery.idempotencyKey, delivery]),
      );
      const existingCandidates = candidates
        .map((candidate) => ({
          ...candidate,
          delivery: deliveriesByLookupKey.get(candidate.lookupKey),
        }))
        .filter((candidate): candidate is typeof candidate & {
          delivery: NonNullable<typeof candidate.delivery>;
        } => Boolean(candidate.delivery));

      if (
        existingCandidates.some((candidate) =>
          isHostedLinqDeliveryProviderCorrelated(candidate.delivery)
          || isHostedLinqTerminalTelegramUsageLimitFailure(candidate.delivery)
        )
      ) {
        return { status: "already_notified" };
      }

      const currentCandidate = existingCandidates.find((candidate) => !candidate.legacy);
      const legacyCandidates = existingCandidates.filter((candidate) => candidate.legacy);
      if (currentCandidate && legacyCandidates.length > 0) {
        return { status: "already_notified" };
      }

      let selectedCandidate = candidates.find((candidate) => !candidate.legacy);
      let selectedDelivery = currentCandidate?.delivery;
      if (legacyCandidates.length > 0) {
        if (
          legacyCandidates.length !== 1
          || input.source !== HOSTED_AI_USAGE_LINQ_NOTICE_DELIVERY_SOURCE
          || legacyCandidates[0].delivery.source
            !== HOSTED_AI_USAGE_LINQ_NOTICE_DELIVERY_SOURCE
        ) {
          return { status: "already_notified" };
        }
        selectedCandidate = legacyCandidates[0];
        selectedDelivery = legacyCandidates[0].delivery;
      }
      if (!selectedCandidate) {
        return { status: "already_notified" };
      }

      if (selectedDelivery) {
        const inFlight = resolveHostedLinqDeliveryInFlightState({
          attemptedAt: input.attemptedAt,
          delivery: selectedDelivery,
        });
        if (inFlight.inFlight) {
          return inFlight.retryAt
            ? { retryAt: inFlight.retryAt, status: "in_flight" }
            : { status: "in_flight" };
        }
      }

      const claim = await claimHostedLinqDeliveryProviderDispatchTx({
        attemptedAt: input.attemptedAt,
        idempotencyKey: selectedCandidate.idempotencyKey,
        linqChatId: input.linqChatId,
        phoneNumber: input.phoneNumber,
        prisma,
        reclaimStalePreProviderAttempt: true,
        source: input.source,
        sourceRef: selectedCandidate.legacy
          ? selectedCandidate.idempotencyKey
          : input.sourceRef,
        status: HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS,
        targetKind: input.targetKind,
        template: "ai_usage_quota",
      });
      if (claim.claimed) {
        const markerClaim = await prisma.hostedAiUsagePeriod.updateMany({
          where: {
            AND: [
              { periodStart: { lte: input.attemptedAt } },
              { periodEnd: { gt: input.attemptedAt } },
            ],
            blockedAt: { not: null },
            ...(selectedDelivery
              ? {
                  OR: [
                    { limitNoticeSentAt: null },
                    { limitNoticeSentAt: selectedDelivery.attemptedAt },
                  ],
                }
              : { limitNoticeSentAt: null }),
            memberId: input.memberId,
            periodStart: input.periodStart,
          },
          data: {
            limitNoticeSentAt: input.attemptedAt,
          },
        });
        if (markerClaim.count !== 1) {
          throw markerConflict;
        }
        return {
          idempotencyKey: selectedCandidate.idempotencyKey,
          status: "claimed",
        };
      }
      if (claim.retryAt) {
        return { retryAt: claim.retryAt, status: "in_flight" };
      }

      const delivery = await prisma.hostedLinqDelivery.findUnique({
        where: {
          idempotencyKey: selectedCandidate.lookupKey,
        },
        select: hostedLinqDeliveryClaimResolutionSelect,
      });
      if (
        !delivery
        || isHostedLinqDeliveryProviderCorrelated(delivery)
        || isHostedLinqTerminalTelegramUsageLimitFailure(delivery)
      ) {
        return { status: "already_notified" };
      }
      const inFlight = resolveHostedLinqDeliveryInFlightState({
        attemptedAt: input.attemptedAt,
        delivery,
      });
      if (inFlight.inFlight) {
        return inFlight.retryAt
          ? { retryAt: inFlight.retryAt, status: "in_flight" }
          : { status: "in_flight" };
      }
      return { status: "already_notified" };
    });
  } catch (error) {
    if (error === markerConflict) {
      return { status: "already_notified" };
    }
    throw error;
  }
}

export async function startHostedAiUsageDeniedResponseDispatchTx(input: {
  attemptedAt: Date;
  linqChatId?: string | null;
  memberId: string;
  phoneNumber?: string | null;
  prisma: PrismaClient;
  sourceEventId: string;
  targetKind: string;
}): Promise<HostedAiUsageLimitNoticeDeliveryClaim> {
  const idempotencyKey = buildHostedAiUsageDeniedResponseIdempotencyKey(input);
  const claim = await claimHostedLinqDeliveryProviderDispatchTx({
    attemptedAt: input.attemptedAt,
    idempotencyKey,
    linqChatId: input.linqChatId,
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
    reclaimStalePreProviderAttempt: true,
    source: HOSTED_AI_USAGE_RUNTIME_NOTICE_DELIVERY_SOURCE,
    sourceRef: input.sourceEventId,
    status: "attempted",
    targetKind: input.targetKind,
    template: "ai_usage_status",
  });
  if (claim.claimed) {
    return {
      idempotencyKey,
      status: "claimed",
    };
  }
  if (claim.confirmationPending) {
    return { status: "in_flight" };
  }
  return claim.retryAt
    ? {
        retryAt: claim.retryAt,
        status: "in_flight",
      }
    : { status: "already_notified" };
}

export async function markHostedAiUsageDeniedResponseDispatchStartedTx(input: {
  expectedAttemptedAt: Date;
  idempotencyKey: string;
  prisma: HostedLinqDeliveryClient;
}): Promise<boolean> {
  return markHostedLinqDeliveryProviderDispatchStartedTx({
    ...input,
    source: HOSTED_AI_USAGE_RUNTIME_NOTICE_DELIVERY_SOURCE,
    template: "ai_usage_status",
  });
}

export async function markHostedLinqDeliveryProviderDispatchStartedTx(input: {
  expectedAttemptedAt: Date;
  idempotencyKey: string;
  prisma: HostedLinqDeliveryClient;
  source: string;
  template: string;
}): Promise<boolean> {
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(
    input.idempotencyKey,
  );
  if (!idempotencyKey) {
    return false;
  }

  const updated = await input.prisma.hostedLinqDelivery.updateMany({
    where: {
      acceptedAt: null,
      attemptedAt: input.expectedAttemptedAt,
      deliveredAt: null,
      failedAt: null,
      idempotencyKey,
      lastReceiptAt: null,
      messageLookupKey: null,
      skippedAt: null,
      source: input.source,
      status: "attempted",
      template: input.template,
    },
    data: {
      status: HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS,
    },
  });
  return updated.count === 1;
}

export function buildHostedAiUsageGateNoticeIdempotencyKey(input: {
  memberId: string;
  periodStart: Date | string;
}): string {
  const periodStart = normalizeHostedAiUsageNoticePeriodStart(input.periodStart);
  return `ai-usage-gate:${sha256Hex(JSON.stringify({
    memberId: input.memberId,
    periodStart: periodStart.toISOString(),
  })).slice(0, 32)}`;
}

export function buildHostedAiUsageDeniedResponseIdempotencyKey(input: {
  memberId: string;
  sourceEventId: string;
}): string {
  return `ai-usage-response:${sha256Hex(JSON.stringify({
    memberId: input.memberId,
    sourceEventId: input.sourceEventId,
  })).slice(0, 32)}`;
}

function buildHostedAiUsageGateLegacyNoticeIdempotencyKeys(input: {
  memberId: string;
  periodStart: Date | string;
}): string[] {
  const periodStart = normalizeHostedAiUsageNoticePeriodStart(input.periodStart);
  return [
    "edge_usage_limit_reached",
    "family_usage_limit_reached",
    "pulse_upgrade_edge",
    "thread_usage_limit_reached",
    "trial_usage_limit_reached",
  ].map((noticeCode) => `ai-usage-gate:${sha256Hex(JSON.stringify({
    memberId: input.memberId,
    noticeCode,
    periodStart: periodStart.toISOString(),
  })).slice(0, 32)}`);
}

function normalizeHostedAiUsageNoticePeriodStart(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Hosted AI usage notice period start must be a valid date.");
  }
  return date;
}

async function updateHostedLinqDeliveryAttemptIfPreProvider(input: {
  data: Prisma.HostedLinqDeliveryUpdateInput;
  delivery: {
    acceptedAt: Date | null;
    deliveredAt: Date | null;
    failedAt: Date | null;
    id: string;
    lastReceiptAt: Date | null;
    messageLookupKey: string | null;
    skippedAt: Date | null;
    status: string;
  };
  prisma: HostedLinqDeliveryClient;
}): Promise<{ id: string }> {
  if (isHostedLinqDeliveryProviderCorrelated(input.delivery)) {
    return { id: input.delivery.id };
  }

  return input.prisma.hostedLinqDelivery.update({
    where: { id: input.delivery.id },
    data: input.data,
    select: { id: true },
  });
}

export async function markHostedLinqDeliveryAcceptedTx(input: {
  acceptedAt?: Date;
  idempotencyKey: string;
  linqChatId?: string | null;
  messageId?: string | null;
  prisma: HostedLinqDeliveryClient;
}): Promise<{
  reopenOnboardingLink: HostedLinqReopenOnboardingLink | null;
  restoreOnboardingLink: HostedLinqReopenOnboardingLink | null;
}> {
  const none = {
    reopenOnboardingLink: null,
    restoreOnboardingLink: null,
  };
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(input.idempotencyKey);
  if (!idempotencyKey) {
    return none;
  }
  const messageLookupKey = createHostedLinqMessageLookupKey(input.messageId);
  const messageLookupKeyCandidates = createHostedLinqMessageLookupKeyReadCandidates(input.messageId);
  return runHostedLinqDeliveryStoreTransaction(input.prisma, async (prisma) => {
    const updated = await prisma.hostedLinqDelivery.updateMany({
      where: {
        deliveredAt: null,
        idempotencyKey,
        lastReceiptAt: null,
        skippedAt: null,
        OR: [
          {
            failedAt: null,
            OR: [
              { messageLookupKey: null },
              ...(messageLookupKey ? [{ messageLookupKey }] : []),
            ],
          },
          {
            acceptedAt: null,
            failedAt: { not: null },
            messageLookupKey: null,
          },
        ],
      },
      data: {
        acceptedAt: input.acceptedAt ?? new Date(),
        failedAt: null,
        failureCode: null,
        failureReason: null,
        retryAfterAt: null,
        linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
        messageIdSuffix: toHostedOnboardingLogIdSuffix(input.messageId),
        messageLookupKey,
        status: "accepted",
      },
    });
    if (updated.count !== 1) {
      return none;
    }

    const replay = await applyLatestHostedLinqDeliveryReceiptForAcceptedMessageTx({
      idempotencyKey,
      messageLookupKeyCandidates,
      messageLookupKey,
      prisma,
    });
    if (!replay.advanced || !replay.receipt) {
      return none;
    }

    // A receipt buffered before this milestone wrote the message lookup key
    // just resolved the delivery terminally; surface the same reopen/restore
    // signal the live receipt-ingestion path emits so the orchestration layer
    // keeps daily state consistent (a failed link reopens the member/day).
    const delivery = await prisma.hostedLinqDelivery.findUnique({
      where: { idempotencyKey },
      select: {
        sourceRef: true,
        template: true,
      },
    });
    const onboardingLink = resolveHostedLinqReopenOnboardingLink({
      idempotencyKey: input.idempotencyKey,
      sourceRef: delivery?.sourceRef ?? null,
      template: delivery?.template ?? null,
    });
    if (!onboardingLink) {
      return none;
    }
    return replay.receipt.deliveryStatus === "failed"
      ? { reopenOnboardingLink: onboardingLink, restoreOnboardingLink: null }
      : { reopenOnboardingLink: null, restoreOnboardingLink: onboardingLink };
  });
}

export async function recordHostedLinqRuntimeDeliveryOutcomeTx(input: {
  acceptedAt?: Date | null;
  answeredMailboxItemIds?: readonly string[] | null;
  attemptedAt?: Date | null;
  failedAt?: Date | null;
  failureCode?: string | null;
  failureReason?: string | null;
  idempotencyKey?: string | null;
  linqChatId?: string | null;
  messageId?: string | null;
  phoneNumber?: string | null;
  phoneNumberLookupKey?: string | null;
  prisma: HostedLinqDeliveryClient;
  sourceRef?: string | null;
  targetKind?: string | null;
  threadIsDirect?: boolean | null;
  userId: string;
}): Promise<{
  deliveryId: string | null;
  recorded: boolean;
}> {
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(
    normalizeNullable(input.idempotencyKey),
  );
  if (!idempotencyKey) {
    return {
      deliveryId: null,
      recorded: false,
    };
  }

  const acceptedAt = input.acceptedAt ?? null;
  const failedAt = acceptedAt ? null : input.failedAt ?? null;
  if (!acceptedAt && !failedAt) {
    return {
      deliveryId: null,
      recorded: false,
    };
  }

  const attemptedAt = input.attemptedAt ?? acceptedAt ?? failedAt;
  if (!attemptedAt) {
    return {
      deliveryId: null,
      recorded: false,
    };
  }
  const line = await readHostedLinqDeliveryLineIdentityTx({
    phoneNumber: input.phoneNumber ?? null,
    phoneNumberLookupKey: input.phoneNumberLookupKey ?? null,
    prisma: input.prisma,
  });
  const messageLookupKey = createHostedLinqMessageLookupKey(input.messageId);
  const messageLookupKeyCandidates = createHostedLinqMessageLookupKeyReadCandidates(input.messageId);
  const deliveryId = buildHostedLinqDeliveryId(idempotencyKey);
  const acceptedStatus = resolveHostedLinqRuntimeAcceptedStatus({
    targetKind: input.targetKind ?? null,
    threadIsDirect: input.threadIsDirect ?? null,
  });
  const baseData = {
    attemptedAt,
    id: deliveryId,
    idempotencyKey,
    linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
    phoneNumberHint: line.phoneNumberHint,
    phoneNumberLookupKey: line.phoneNumberLookupKey,
    retryAfterAt: null,
    source: "hosted_runtime_linq_delivery",
    sourceRef: createHostedLinqDeliverySourceRefLookupKey(normalizeNullable(input.sourceRef)),
    targetKind: normalizeNullable(input.targetKind),
    template: null,
  };

  return await runHostedLinqDeliveryStoreTransaction(input.prisma, async (prisma) => {
    let acceptedAdvanced = false;
    const existing = await prisma.hostedLinqDelivery.findUnique({
      where: { idempotencyKey },
      select: hostedLinqDeliveryLifecycleSelect,
    });

    if (!existing) {
      try {
        await prisma.hostedLinqDelivery.create({
          data: acceptedAt
            ? {
                ...baseData,
                acceptedAt,
                messageIdSuffix: toHostedOnboardingLogIdSuffix(input.messageId),
                messageLookupKey,
                status: acceptedStatus,
              }
            : {
                ...baseData,
                failedAt: failedAt ?? attemptedAt,
                failureCode: sanitizeHostedOnboardingPersistedErrorCode(
                  normalizeNullable(input.failureCode),
                ),
                failureReason: sanitizeHostedOnboardingPersistedErrorMessage(
                  normalizeNullable(input.failureReason),
                ),
                status: "failed",
              },
        });
        acceptedAdvanced = Boolean(acceptedAt);
      } catch (error) {
        if (!isPrismaUniqueConstraintError(error)) {
          throw error;
        }
        const concurrent = await prisma.hostedLinqDelivery.findUnique({
          where: { idempotencyKey },
          select: hostedLinqDeliveryLifecycleSelect,
        });
        if (!concurrent) {
          throw error;
        }
        acceptedAdvanced = await updateHostedLinqRuntimeDeliveryOutcomeIfPreProviderTx({
          acceptedAt,
          attemptedAt,
          failedAt,
          failureCode: input.failureCode ?? null,
          failureReason: input.failureReason ?? null,
          idempotencyKey,
          line,
          linqChatId: input.linqChatId ?? null,
          messageId: input.messageId ?? null,
          messageLookupKey,
          prisma,
          sourceRef: input.sourceRef ?? null,
          targetKind: input.targetKind ?? null,
          threadIsDirect: input.threadIsDirect ?? null,
        });
      }
    } else if (acceptedAt) {
      acceptedAdvanced = await updateHostedLinqRuntimeDeliveryOutcomeIfPreProviderTx({
        acceptedAt,
        attemptedAt,
        failedAt: null,
        failureCode: input.failureCode ?? null,
        failureReason: input.failureReason ?? null,
        idempotencyKey,
        line,
        linqChatId: input.linqChatId ?? null,
        messageId: input.messageId ?? null,
        messageLookupKey,
        prisma,
        sourceRef: input.sourceRef ?? null,
        targetKind: input.targetKind ?? null,
        threadIsDirect: input.threadIsDirect ?? null,
      });
    } else if (failedAt) {
      await updateHostedLinqRuntimeDeliveryOutcomeIfPreProviderTx({
        acceptedAt: null,
        attemptedAt,
        failedAt,
        failureCode: input.failureCode ?? null,
        failureReason: input.failureReason ?? null,
        idempotencyKey,
        line,
        linqChatId: input.linqChatId ?? null,
        messageId: input.messageId ?? null,
        messageLookupKey,
        prisma,
        sourceRef: input.sourceRef ?? null,
        targetKind: input.targetKind ?? null,
        threadIsDirect: input.threadIsDirect ?? null,
      });
    }

    if (acceptedAdvanced && acceptedAt && line.phoneNumberLookupKey) {
      const outboundEchoAlreadyRecorded =
        await readHostedLinqOutboundEchoForAcceptedMessageTx({
          messageLookupKey,
          messageLookupKeyCandidates,
          prisma,
        });
      if (!outboundEchoAlreadyRecorded) {
        await projectHostedLinqLineOutboundAcceptedTx({
          acceptedAt,
          phoneNumberLookupKey: line.phoneNumberLookupKey,
          prisma,
        });
      }
      const catchup = await applyLatestHostedLinqDeliveryReceiptForAcceptedMessageTx({
        idempotencyKey,
        messageLookupKey,
        messageLookupKeyCandidates,
        prisma,
      });
      if (
        catchup.advanced
        && catchup.receipt
        && !catchup.receipt.phoneNumberLookupKey
      ) {
        await projectHostedLinqLineForDeliveryReceiptTx({
          deliveryStatus: catchup.receipt.deliveryStatus,
          eventId: catchup.receipt.eventId,
          failureCode: catchup.receipt.failureCode,
          failureReason: catchup.receipt.failureReason,
          lineLookupKey: line.phoneNumberLookupKey,
          prisma,
          providerCreatedAt: catchup.receipt.providerCreatedAt,
        });
      }
    }
    if (acceptedAt && input.answeredMailboxItemIds?.length) {
      await prisma.hostedMailboxItem.updateMany({
        data: {
          consumedAt: acceptedAt,
        },
        where: {
          consumedAt: null,
          id: {
            in: [...input.answeredMailboxItemIds],
          },
          kind: "conversation.message",
          lane: "conversation",
          userId: input.userId,
        },
      });
    }

    return {
      deliveryId,
      recorded: true,
    };
  });
}

async function updateHostedLinqRuntimeDeliveryOutcomeIfPreProviderTx(input: {
  acceptedAt: Date | null;
  attemptedAt: Date;
  failedAt: Date | null;
  failureCode: string | null;
  failureReason: string | null;
  idempotencyKey: string;
  line: {
    phoneNumberHint: string | null;
    phoneNumberLookupKey: string | null;
  };
  linqChatId: string | null;
  messageId: string | null;
  messageLookupKey: string | null;
  prisma: HostedLinqDeliveryClient;
  sourceRef: string | null;
  targetKind: string | null;
  threadIsDirect: boolean | null;
}): Promise<boolean> {
  if (input.acceptedAt) {
    const updated = await input.prisma.hostedLinqDelivery.updateMany({
      where: {
        acceptedAt: null,
        deliveredAt: null,
        idempotencyKey: input.idempotencyKey,
        lastReceiptAt: null,
        OR: [
          {
            failedAt: null,
            messageLookupKey: null,
          },
          {
            failedAt: { not: null },
            messageLookupKey: null,
          },
        ],
      },
      data: {
        acceptedAt: input.acceptedAt,
        attemptedAt: input.attemptedAt,
        failedAt: null,
        failureCode: null,
        failureReason: null,
        retryAfterAt: null,
        linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
        messageIdSuffix: toHostedOnboardingLogIdSuffix(input.messageId),
        messageLookupKey: input.messageLookupKey,
        phoneNumberHint: input.line.phoneNumberHint,
        phoneNumberLookupKey: input.line.phoneNumberLookupKey,
        source: "hosted_runtime_linq_delivery",
        sourceRef: createHostedLinqDeliverySourceRefLookupKey(normalizeNullable(input.sourceRef)),
        skippedAt: null,
        skipReason: null,
        status: resolveHostedLinqRuntimeAcceptedStatus({
          targetKind: input.targetKind,
          threadIsDirect: input.threadIsDirect,
        }),
        targetKind: normalizeNullable(input.targetKind),
      },
    });
    return updated.count === 1;
  }

  if (!input.failedAt) {
    return false;
  }

  await input.prisma.hostedLinqDelivery.updateMany({
    where: {
      acceptedAt: null,
      deliveredAt: null,
      idempotencyKey: input.idempotencyKey,
      lastReceiptAt: null,
      messageLookupKey: null,
    },
    data: {
      attemptedAt: input.attemptedAt,
      failedAt: input.failedAt,
      failureCode: sanitizeHostedOnboardingPersistedErrorCode(
        normalizeNullable(input.failureCode),
      ),
      failureReason: sanitizeHostedOnboardingPersistedErrorMessage(
        normalizeNullable(input.failureReason),
      ),
      linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
      phoneNumberHint: input.line.phoneNumberHint,
      phoneNumberLookupKey: input.line.phoneNumberLookupKey,
      retryAfterAt: null,
      source: "hosted_runtime_linq_delivery",
      sourceRef: createHostedLinqDeliverySourceRefLookupKey(normalizeNullable(input.sourceRef)),
      skippedAt: null,
      skipReason: null,
      status: "failed",
      targetKind: normalizeNullable(input.targetKind),
    },
  });
  return false;
}

const HOSTED_LINQ_RUNTIME_GROUP_SENT_NO_RECEIPT_STATUS = "sent_no_receipt_expected";

function resolveHostedLinqRuntimeAcceptedStatus(input: {
  targetKind: string | null;
  threadIsDirect: boolean | null;
}): string {
  return input.targetKind === "thread" && input.threadIsDirect === false
    ? HOSTED_LINQ_RUNTIME_GROUP_SENT_NO_RECEIPT_STATUS
    : "accepted";
}

export async function markHostedLinqDeliverySendFailedTx(input: {
  expectedAttemptedAt?: Date;
  failedAt?: Date;
  failureCode?: string | null;
  failureReason?: string | null;
  idempotencyKey: string;
  prisma: HostedLinqDeliveryClient;
  retryAfterAt?: Date | null;
}): Promise<void> {
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(input.idempotencyKey);
  if (!idempotencyKey) {
    return;
  }
  await input.prisma.hostedLinqDelivery.updateMany({
    where: {
      acceptedAt: null,
      deliveredAt: null,
      ...(input.expectedAttemptedAt
        ? { attemptedAt: input.expectedAttemptedAt }
        : {}),
      idempotencyKey,
      lastReceiptAt: null,
      messageLookupKey: null,
    },
    data: {
      failedAt: input.failedAt ?? new Date(),
      failureCode: sanitizeHostedOnboardingPersistedErrorCode(
        normalizeNullable(input.failureCode),
      ),
      failureReason: sanitizeHostedOnboardingPersistedErrorMessage(
        normalizeNullable(input.failureReason),
      ),
      retryAfterAt: input.retryAfterAt ?? null,
      status: "failed",
    },
  });
}

export async function markHostedAiUsageLimitNoticeDeliveryRetryableTx(input: {
  expectedAttemptedAt: Date;
  failedAt?: Date;
  failureCode?: string | null;
  failureReason?: string | null;
  idempotencyKey: string;
  memberId: string;
  periodStart: Date;
  prisma: PrismaClient;
  retryAfterAt: Date;
}): Promise<boolean> {
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(input.idempotencyKey);
  if (!idempotencyKey) {
    return false;
  }

  return input.prisma.$transaction(async (prisma) => {
    const delivery = await prisma.hostedLinqDelivery.updateMany({
      where: {
        acceptedAt: null,
        attemptedAt: input.expectedAttemptedAt,
        deliveredAt: null,
        failedAt: null,
        idempotencyKey,
        lastReceiptAt: null,
        messageLookupKey: null,
        skippedAt: null,
        source: HOSTED_AI_USAGE_RUNTIME_NOTICE_DELIVERY_SOURCE,
        status: HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS,
        template: "ai_usage_quota",
      },
      data: {
        failedAt: input.failedAt ?? new Date(),
        failureCode: sanitizeHostedOnboardingPersistedErrorCode(
          normalizeNullable(input.failureCode),
        ),
        failureReason: sanitizeHostedOnboardingPersistedErrorMessage(
          normalizeNullable(input.failureReason),
        ),
        retryAfterAt: input.retryAfterAt,
        status: "failed",
      },
    });
    if (delivery.count !== 1) {
      return false;
    }

    await prisma.hostedAiUsagePeriod.updateMany({
      where: {
        blockedAt: { not: null },
        limitNoticeSentAt: input.expectedAttemptedAt,
        memberId: input.memberId,
        periodStart: input.periodStart,
      },
      data: {
        limitNoticeSentAt: null,
      },
    });
    return true;
  });
}

export async function markHostedLinqDeliverySkippedTx(input: {
  failureCode?: string | null;
  failureReason?: string | null;
  idempotencyKey?: string | null;
  linqChatId?: string | null;
  phoneNumber?: string | null;
  prisma: HostedLinqDeliveryClient;
  reason: string;
  skippedAt?: Date;
  source: string;
  sourceRef?: string | null;
  targetKind?: string | null;
  template?: string | null;
}): Promise<{ id: string }> {
  const skippedAt = input.skippedAt ?? new Date();
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(
    normalizeNullable(input.idempotencyKey),
  );
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  const phoneNumberLookupKey = await ensureHostedLinqDeliveryLineTx({
    observedAt: skippedAt,
    phoneNumber,
    prisma: input.prisma,
  });
  const data = {
    attemptedAt: skippedAt,
    failedAt: null,
    failureCode: sanitizeHostedOnboardingPersistedErrorCode(
      normalizeNullable(input.failureCode)
        ?? "HOSTED_LINQ_DELIVERY_SKIPPED",
    ),
    failureReason: sanitizeHostedOnboardingPersistedErrorMessage(
      normalizeNullable(input.failureReason)
        ?? "Linq/iMessage send skipped before provider dispatch.",
    ),
    linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
    phoneNumberHint: phoneNumber ? readHostedPhoneHint(phoneNumber) : null,
    phoneNumberLookupKey,
    retryAfterAt: null,
    skipReason: input.reason.slice(0, 160),
    skippedAt,
    source: input.source,
    sourceRef: normalizeHostedLinqDeliverySourceRef({
      sourceRef: input.sourceRef,
      template: input.template,
    }),
    status: "skipped",
    targetKind: normalizeNullable(input.targetKind),
    template: normalizeNullable(input.template),
  };

  if (!idempotencyKey) {
    return input.prisma.hostedLinqDelivery.create({
      data: {
        ...data,
        id: generateHostedRandomPrefixedId("hld"),
      },
      select: { id: true },
    });
  }

  const existing = await input.prisma.hostedLinqDelivery.findUnique({
    where: { idempotencyKey },
    select: hostedLinqDeliveryLifecycleSelect,
  });

  if (existing) {
    return updateHostedLinqDeliverySkippedIfPreProvider({
      data,
      delivery: existing,
      prisma: input.prisma,
    });
  }

  try {
    return await input.prisma.hostedLinqDelivery.create({
      data: {
        ...data,
        id: buildHostedLinqDeliveryId(idempotencyKey),
        idempotencyKey,
      },
      select: { id: true },
    });
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }
    const concurrent = await input.prisma.hostedLinqDelivery.findUnique({
      where: { idempotencyKey },
      select: hostedLinqDeliveryLifecycleSelect,
    });
    if (!concurrent) {
      throw error;
    }
    return updateHostedLinqDeliverySkippedIfPreProvider({
      data,
      delivery: concurrent,
      prisma: input.prisma,
    });
  }
}

export async function applyHostedLinqDeliveryReceiptTx(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: HostedLinqDeliveryClient;
}): Promise<{
  advanced: boolean;
  deliveryId: string | null;
  phoneNumberLookupKey: string | null;
  reopenOnboardingLink: HostedLinqReopenOnboardingLink | null;
  restoreOnboardingLink: HostedLinqReopenOnboardingLink | null;
}> {
  if (!input.event.messageLookupKey || !input.event.deliveryStatus) {
    return {
      advanced: true,
      deliveryId: null,
      phoneNumberLookupKey: null,
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    };
  }
  const delivery = await input.prisma.hostedLinqDelivery.findFirst({
    where: {
      messageLookupKey: {
        in: input.event.messageLookupKeyReadCandidates.length > 0
          ? input.event.messageLookupKeyReadCandidates
          : [input.event.messageLookupKey],
      },
    },
    select: {
      id: true,
      idempotencyKey: true,
      phoneNumberLookupKey: true,
      sourceRef: true,
      template: true,
    },
  });

  if (!delivery) {
    return {
      advanced: true,
      deliveryId: null,
      phoneNumberLookupKey: null,
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    };
  }

  const updated = await input.prisma.hostedLinqDelivery.updateMany({
    where: {
      id: delivery.id,
      OR: buildReceiptOrderingWhere(input.event),
    },
    data: buildReceiptUpdate(input.event),
  });
  const advanced = updated.count === 1;
  return {
    advanced,
    deliveryId: delivery.id,
    phoneNumberLookupKey: delivery.phoneNumberLookupKey,
    reopenOnboardingLink: advanced && input.event.deliveryStatus === "failed"
      ? resolveHostedLinqReopenOnboardingLink(delivery)
      : null,
    // The symmetric signal: a delivered receipt that wins ordering after a
    // reopen re-marks the member/day as sent, so daily state always tracks
    // the latest terminal delivery truth.
    restoreOnboardingLink: advanced && input.event.deliveryStatus === "delivered"
      ? resolveHostedLinqReopenOnboardingLink(delivery)
      : null,
  };
}

export async function readHostedLinqDeliveryForProviderMessageTx(input: {
  messageLookupKey: string | null;
  messageLookupKeyCandidates?: readonly string[];
  prisma: HostedLinqDeliveryClient;
}): Promise<{
  deliveryId: string;
  phoneNumberLookupKey: string | null;
  runtimeOwned: boolean;
} | null> {
  if (!input.messageLookupKey) {
    return null;
  }
  const messageLookupKeys = input.messageLookupKeyCandidates && input.messageLookupKeyCandidates.length > 0
    ? [...input.messageLookupKeyCandidates]
    : [input.messageLookupKey];
  const delivery = await input.prisma.hostedLinqDelivery.findFirst({
    where: {
      messageLookupKey: {
        in: messageLookupKeys,
      },
    },
    select: {
      id: true,
      phoneNumberLookupKey: true,
      source: true,
    },
  });
  return delivery
    ? {
        deliveryId: delivery.id,
        phoneNumberLookupKey: delivery.phoneNumberLookupKey,
        runtimeOwned: delivery.source === "hosted_runtime_linq_delivery",
      }
    : null;
}

function buildReceiptUpdate(event: ParsedHostedLinqProviderEvent): Prisma.HostedLinqDeliveryUpdateInput {
  if (!event.deliveryStatus) {
    throw new TypeError("Hosted Linq delivery receipt update requires a terminal status.");
  }

  return buildReceiptUpdateFromData({
    deliveryStatus: event.deliveryStatus,
    eventId: event.eventId,
    failureCode: event.failureCode,
    failureReason: event.failureReason,
    providerCreatedAt: event.providerCreatedAt,
    service: event.service,
  });
}

function buildReceiptUpdateFromData(
  receipt: HostedLinqDeliveryReceiptData,
): Prisma.HostedLinqDeliveryUpdateInput {
  const progress = createHostedLinqProviderEventProgress({
    eventId: receipt.eventId,
    providerCreatedAt: receipt.providerCreatedAt,
  });
  const base = {
    lastProviderEventId: progress.eventLookupKey,
    lastReceiptAt: receipt.providerCreatedAt,
    retryAfterAt: null,
    service: receipt.service,
  } satisfies Prisma.HostedLinqDeliveryUpdateInput;

  if (receipt.deliveryStatus === "delivered") {
    return {
      ...base,
      deliveredAt: receipt.providerCreatedAt,
      status: "delivered",
    };
  }

  return {
    ...base,
    failedAt: receipt.providerCreatedAt,
    failureCode: receipt.failureCode,
    failureReason: receipt.failureReason,
    status: "failed",
  };
}

async function applyLatestHostedLinqDeliveryReceiptForAcceptedMessageTx(input: {
  idempotencyKey: string;
  messageLookupKeyCandidates?: readonly string[];
  messageLookupKey: string | null;
  prisma: HostedLinqDeliveryClient;
}): Promise<{
  advanced: boolean;
  receipt: HostedLinqDeliveryReceiptData | null;
}> {
  if (!input.messageLookupKey) {
    return {
      advanced: false,
      receipt: null,
    };
  }
  const messageLookupKeys = input.messageLookupKeyCandidates && input.messageLookupKeyCandidates.length > 0
    ? [...input.messageLookupKeyCandidates]
    : [input.messageLookupKey];

  const receipts = await input.prisma.hostedLinqProviderEvent.findMany({
    where: {
      deliveryStatus: {
        in: ["delivered", "failed"],
      },
      messageLookupKey: {
        in: messageLookupKeys,
      },
    },
    orderBy: [
      { providerCreatedAt: "desc" },
      { eventId: "desc" },
    ],
    select: {
      deliveryStatus: true,
      eventId: true,
      failureCode: true,
      failureReason: true,
      phoneNumberLookupKey: true,
      providerCreatedAt: true,
      service: true,
    },
    take: 20,
  });
  const receipt = selectLatestHostedLinqReceiptData(receipts);

  if (!isHostedLinqTerminalReceiptData(receipt)) {
    return {
      advanced: false,
      receipt: null,
    };
  }

  const updated = await input.prisma.hostedLinqDelivery.updateMany({
    where: {
      idempotencyKey: input.idempotencyKey,
      OR: buildReceiptOrderingWhere(receipt),
    },
    data: buildReceiptUpdateFromData(receipt),
  });
  return {
    advanced: updated.count === 1,
    receipt,
  };
}

async function readHostedLinqOutboundEchoForAcceptedMessageTx(input: {
  messageLookupKeyCandidates?: readonly string[];
  messageLookupKey: string | null;
  prisma: HostedLinqDeliveryClient;
}): Promise<boolean> {
  if (!input.messageLookupKey) {
    return false;
  }
  const messageLookupKeys = input.messageLookupKeyCandidates && input.messageLookupKeyCandidates.length > 0
    ? [...input.messageLookupKeyCandidates]
    : [input.messageLookupKey];
  const echo = await input.prisma.hostedLinqProviderEvent.findFirst({
    where: {
      direction: "outbound",
      eventType: "message.received",
      messageLookupKey: {
        in: messageLookupKeys,
      },
    },
    select: {
      eventId: true,
    },
  });
  return Boolean(echo);
}

function buildReceiptOrderingWhere(
  receipt: Pick<HostedLinqDeliveryReceiptData, "eventId" | "providerCreatedAt">,
): Prisma.HostedLinqDeliveryWhereInput[] {
  const progress = createHostedLinqProviderEventProgress({
    eventId: receipt.eventId,
    providerCreatedAt: receipt.providerCreatedAt,
  });
  const orderingWhere: Prisma.HostedLinqDeliveryWhereInput[] = [
    { lastReceiptAt: null },
    { lastReceiptAt: { lt: progress.providerCreatedAt } },
  ];

  orderingWhere.push({
    lastReceiptAt: progress.providerCreatedAt,
    OR: [
      { lastProviderEventId: null },
      { lastProviderEventId: { lt: progress.eventLookupKey } },
    ],
  });

  return orderingWhere;
}

function isHostedLinqTerminalReceiptData(
  value: {
    deliveryStatus: string | null;
    eventId: string;
    failureCode: string | null;
    failureReason: string | null;
    phoneNumberLookupKey?: string | null;
    providerCreatedAt: Date;
    service: string | null;
  } | null,
): value is HostedLinqDeliveryReceiptData {
  return value?.deliveryStatus === "delivered" || value?.deliveryStatus === "failed";
}

function selectLatestHostedLinqReceiptData(
  receipts: readonly {
    deliveryStatus: string | null;
    eventId: string;
    failureCode: string | null;
    failureReason: string | null;
    phoneNumberLookupKey?: string | null;
    providerCreatedAt: Date;
    service: string | null;
  }[],
): HostedLinqDeliveryReceiptData | null {
  let selected: HostedLinqDeliveryReceiptData | null = null;
  for (const receipt of receipts) {
    if (!isHostedLinqTerminalReceiptData(receipt)) {
      continue;
    }
    if (!selected) {
      selected = receipt;
      continue;
    }
    if (compareHostedLinqReceiptProgress(receipt, selected) > 0) {
      selected = receipt;
    }
  }
  return selected;
}

function compareHostedLinqReceiptProgress(
  left: HostedLinqDeliveryReceiptData,
  right: HostedLinqDeliveryReceiptData,
): number {
  return compareHostedLinqProviderEventProgress(
    createHostedLinqProviderEventProgress({
      eventId: left.eventId,
      providerCreatedAt: left.providerCreatedAt,
    }),
    createHostedLinqProviderEventProgress({
      eventId: right.eventId,
      providerCreatedAt: right.providerCreatedAt,
    }),
  );
}

function isHostedLinqDeliveryLifecycleFinal(input: {
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  lastReceiptAt: Date | null;
  messageLookupKey: string | null;
  skippedAt: Date | null;
  status: string;
}): boolean {
  return Boolean(
    input.acceptedAt
      || input.deliveredAt
      || input.failedAt
      || input.lastReceiptAt
      || input.messageLookupKey
      || input.skippedAt
      || input.status !== "attempted",
  );
}

function isHostedLinqDeliveryProviderCorrelated(input: {
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  lastReceiptAt: Date | null;
  messageLookupKey: string | null;
  status: string;
}): boolean {
  return Boolean(
    input.acceptedAt
      || input.deliveredAt
      || input.lastReceiptAt
      || input.messageLookupKey
      || input.status === "accepted"
      || input.status === "delivered",
  );
}

const hostedLinqDeliveryLifecycleSelect = {
  acceptedAt: true,
  attemptedAt: true,
  deliveredAt: true,
  failureCode: true,
  failedAt: true,
  id: true,
  lastReceiptAt: true,
  messageLookupKey: true,
  phoneNumberLookupKey: true,
  retryAfterAt: true,
  skippedAt: true,
  source: true,
  status: true,
} satisfies Prisma.HostedLinqDeliverySelect;

const hostedLinqDeliveryClaimResolutionSelect = {
  ...hostedLinqDeliveryLifecycleSelect,
  idempotencyKey: true,
} satisfies Prisma.HostedLinqDeliverySelect;

function buildHostedLinqDeliveryClaimCandidates(input: {
  currentIdempotencyKey: string;
  legacyIdempotencyKeys: readonly string[];
}): {
  idempotencyKey: string;
  legacy: boolean;
  lookupKey: string;
}[] {
  const candidates: {
    idempotencyKey: string;
    legacy: boolean;
    lookupKey: string;
  }[] = [];
  const seen = new Set<string>();

  for (const legacyIdempotencyKey of input.legacyIdempotencyKeys) {
    const lookupKey = createHostedLinqDeliveryIdempotencyLookupKey(legacyIdempotencyKey);
    if (!lookupKey || seen.has(lookupKey)) {
      continue;
    }
    seen.add(lookupKey);
    candidates.push({
      idempotencyKey: legacyIdempotencyKey,
      legacy: true,
      lookupKey,
    });
  }

  const currentLookupKey = createHostedLinqDeliveryIdempotencyLookupKey(
    input.currentIdempotencyKey,
  );
  if (currentLookupKey && !seen.has(currentLookupKey)) {
    candidates.push({
      idempotencyKey: input.currentIdempotencyKey,
      legacy: false,
      lookupKey: currentLookupKey,
    });
  }

  return candidates;
}

function isHostedLinqTerminalTelegramUsageLimitFailure(input: {
  failedAt: Date | null;
  retryAfterAt: Date | null;
  source: string | null;
  status: string;
}): boolean {
  return input.source === HOSTED_AI_USAGE_RUNTIME_NOTICE_DELIVERY_SOURCE
    && (input.failedAt !== null || input.status === "failed")
    && input.retryAfterAt === null;
}

function resolveHostedLinqDeliveryInFlightState(input: {
  attemptedAt: Date;
  delivery: {
    acceptedAt: Date | null;
    attemptedAt: Date;
    deliveredAt: Date | null;
    failedAt: Date | null;
    lastReceiptAt: Date | null;
    messageLookupKey: string | null;
    retryAfterAt: Date | null;
    skippedAt: Date | null;
    source: string | null;
    status: string;
  };
}): { inFlight: boolean; retryAt?: Date } {
  const providerRetryAt = readHostedLinqTelegramUsageLimitRetryAt(input.delivery);
  if (providerRetryAt && providerRetryAt > input.attemptedAt) {
    return { inFlight: true, retryAt: providerRetryAt };
  }

  if (
    input.delivery.status
      === HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS
  ) {
    return { inFlight: true };
  }

  if (
    input.delivery.status !== "attempted"
    || !isHostedLinqDeliveryPreProvider(input.delivery)
  ) {
    return { inFlight: false };
  }

  const preProviderRetryAt = new Date(
    input.delivery.attemptedAt.getTime()
      + HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
  );
  return preProviderRetryAt > input.attemptedAt
    ? { inFlight: true, retryAt: preProviderRetryAt }
    : { inFlight: false };
}

function isHostedLinqDeliveryPreProvider(input: {
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  lastReceiptAt: Date | null;
  messageLookupKey: string | null;
  skippedAt: Date | null;
  status: string;
}): boolean {
  return input.acceptedAt === null
    && input.deliveredAt === null
    && input.failedAt === null
    && input.lastReceiptAt === null
    && input.messageLookupKey === null
    && input.skippedAt === null
    && (
      input.status === "attempted"
      || input.status === HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS
    );
}

function readHostedLinqTelegramUsageLimitRetryAt(input: {
  failedAt: Date | null;
  retryAfterAt: Date | null;
  source: string | null;
}): Date | null {
  if (
    input.source !== HOSTED_AI_USAGE_RUNTIME_NOTICE_DELIVERY_SOURCE
    || input.failedAt === null
  ) {
    return null;
  }

  return input.retryAfterAt;
}

async function claimExistingHostedLinqDeliveryProviderDispatchTx(input: {
  attemptedAt: Date;
  data: HostedLinqDeliveryProviderDispatchData;
  delivery: {
    acceptedAt: Date | null;
    attemptedAt: Date;
    deliveredAt: Date | null;
    failedAt: Date | null;
    id: string;
    lastReceiptAt: Date | null;
    messageLookupKey: string | null;
    retryAfterAt: Date | null;
    skippedAt: Date | null;
    source: string | null;
    status: string;
  };
  prisma: HostedLinqDeliveryClient;
  reclaimStalePreProviderAttempt?: boolean;
  source: string;
}): Promise<{
  claimed: boolean;
  confirmationPending?: true;
  id: string | null;
  retryAt?: Date;
}> {
  if (isHostedLinqDeliveryProviderCorrelated(input.delivery)) {
    return {
      claimed: false,
      id: input.delivery.id,
    };
  }

  if (
    input.delivery.status
      === HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS
  ) {
    return {
      claimed: false,
      confirmationPending: true,
      id: input.delivery.id,
    };
  }

  const inFlight = resolveHostedLinqDeliveryInFlightState({
    attemptedAt: input.attemptedAt,
    delivery: input.delivery,
  });
  if (inFlight.inFlight) {
    return inFlight.retryAt
      ? {
          claimed: false,
          id: input.delivery.id,
          retryAt: inFlight.retryAt,
        }
      : {
          claimed: false,
          id: input.delivery.id,
        };
  }

  const telegramRetryAfterAt = readHostedLinqTelegramUsageLimitRetryAt(input.delivery);
  const staleAttemptBefore = new Date(
    input.attemptedAt.getTime() - HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
  );
  const canReclaimStalePreProviderAttempt =
    input.reclaimStalePreProviderAttempt
    ?? input.delivery.source !== HOSTED_AI_USAGE_RUNTIME_NOTICE_DELIVERY_SOURCE;
  const canReclaimRetryAfterTelegramAttempt =
    telegramRetryAfterAt !== null && telegramRetryAfterAt <= input.attemptedAt;
  const telegramRetryAfterReclaimPredicate = {
    failedAt: { not: null },
    retryAfterAt: {
      lte: input.attemptedAt,
    },
    source: HOSTED_AI_USAGE_RUNTIME_NOTICE_DELIVERY_SOURCE,
  };
  const terminalPreProviderReclaimPredicates =
    input.delivery.source !== HOSTED_AI_USAGE_RUNTIME_NOTICE_DELIVERY_SOURCE
      ? [
          { failedAt: { not: null } },
          { skippedAt: { not: null } },
          { status: { in: ["failed", "skipped"] } },
        ]
      : canReclaimRetryAfterTelegramAttempt
        ? [telegramRetryAfterReclaimPredicate]
        : [];
  const reclaimPredicates = [
    ...terminalPreProviderReclaimPredicates,
    ...(canReclaimStalePreProviderAttempt
      ? [
          {
            attemptedAt: {
              lte: staleAttemptBefore,
            },
            status: "attempted",
          },
        ]
      : []),
  ];
  if (reclaimPredicates.length === 0) {
    return {
      claimed: false,
      id: input.delivery.id,
    };
  }

  const updated = await input.prisma.hostedLinqDelivery.updateMany({
    where: {
      acceptedAt: null,
      deliveredAt: null,
      id: input.delivery.id,
      lastReceiptAt: null,
      messageLookupKey: null,
      OR: reclaimPredicates,
    },
    data: input.data,
  });

  if (updated.count === 1) {
    return {
      claimed: true,
      id: input.delivery.id,
    };
  }

  return {
    claimed: false,
    id: input.delivery.id,
    retryAt: new Date(
      input.attemptedAt.getTime()
        + HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
    ),
  };
}

async function updateHostedLinqDeliverySkippedIfPreProvider(input: {
  data: Prisma.HostedLinqDeliveryUpdateInput;
  delivery: {
    acceptedAt: Date | null;
    deliveredAt: Date | null;
    failedAt: Date | null;
    id: string;
    lastReceiptAt: Date | null;
    messageLookupKey: string | null;
    skippedAt: Date | null;
    status: string;
  };
  prisma: HostedLinqDeliveryClient;
}): Promise<{ id: string }> {
  if (isHostedLinqDeliveryLifecycleFinal(input.delivery)) {
    return { id: input.delivery.id };
  }

  return input.prisma.hostedLinqDelivery.update({
    where: { id: input.delivery.id },
    data: input.data,
    select: { id: true },
  });
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === "P2002",
  );
}

function buildHostedLinqDeliveryId(idempotencyKey: string): string {
  return `hld_${sha256Hex(idempotencyKey).slice(0, 32)}`;
}

async function runHostedLinqDeliveryStoreTransaction<T>(
  prisma: HostedLinqDeliveryClient,
  operation: (transaction: HostedLinqDeliveryClient) => Promise<T>,
): Promise<T> {
  const candidate = prisma as HostedLinqDeliveryClient & {
    $transaction?: <TResult>(
      operation: (transaction: Prisma.TransactionClient) => Promise<TResult>,
    ) => Promise<TResult>;
  };

  if (candidate.$transaction) {
    return candidate.$transaction(operation);
  }

  return operation(prisma);
}

function resolveHostedLinqReopenOnboardingLink(input: {
  idempotencyKey: string | null;
  sourceRef: string | null;
  template: string | null;
}): HostedLinqReopenOnboardingLink | null {
  if (!isHostedLinqInviteSignupDeliveryTemplate(input.template)) {
    return null;
  }

  const parsed = parseHostedLinqInviteSignupEffectId(input.idempotencyKey)
    ?? parseHostedLinqInviteSignupEffectId(input.sourceRef);
  return parsed
    ? {
        memberId: parsed.memberId,
        occurredAt: parsed.dayUtc,
      }
    : null;
}

function normalizeHostedLinqDeliverySourceRef(input: {
  sourceRef: string | null | undefined;
  template: string | null | undefined;
}): string | null {
  const sourceRef = normalizeNullable(input.sourceRef);
  if (
    isHostedLinqInviteSignupDeliveryTemplate(input.template)
    && parseHostedLinqInviteSignupEffectId(sourceRef)
  ) {
    return sourceRef;
  }

  return createHostedLinqDeliverySourceRefLookupKey(sourceRef);
}

function isHostedLinqInviteSignupDeliveryTemplate(
  template: string | null | undefined,
): boolean {
  return template === "invite_signup" || template === "invite_signup_fallback";
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

async function ensureHostedLinqDeliveryLineTx(input: {
  observedAt: Date;
  phoneNumber: string | null;
  prisma: HostedLinqDeliveryClient;
}): Promise<string | null> {
  if (!input.phoneNumber) {
    return null;
  }

  const line = await upsertHostedLinqLineForPhoneTx({
    observedAt: input.observedAt,
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
    source: "webhook",
  });
  return line.phoneNumberLookupKey;
}

async function readHostedLinqDeliveryLineIdentityTx(input: {
  phoneNumber: string | null;
  phoneNumberLookupKey: string | null;
  prisma: HostedLinqDeliveryClient;
}): Promise<{
  phoneNumberHint: string | null;
  phoneNumberLookupKey: string | null;
}> {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  if (phoneNumber) {
    const phoneNumberLookupKey = createHostedPhoneLookupKey(phoneNumber);
    const line = phoneNumberLookupKey
      ? await input.prisma.hostedLinqLine.findUnique({
          where: {
            phoneNumberLookupKey,
          },
          select: {
            phoneNumberHint: true,
            phoneNumberLookupKey: true,
          },
        })
      : null;
    return {
      phoneNumberHint: line?.phoneNumberHint ?? null,
      phoneNumberLookupKey: line?.phoneNumberLookupKey ?? null,
    };
  }

  const phoneNumberLookupKey = normalizeNullable(input.phoneNumberLookupKey);
  if (!phoneNumberLookupKey) {
    return {
      phoneNumberHint: null,
      phoneNumberLookupKey: null,
    };
  }

  const line = await input.prisma.hostedLinqLine.findUnique({
    where: {
      phoneNumberLookupKey,
    },
    select: {
      phoneNumberHint: true,
      phoneNumberLookupKey: true,
    },
  });
  return {
    phoneNumberHint: line?.phoneNumberHint ?? null,
    phoneNumberLookupKey: line?.phoneNumberLookupKey ?? null,
  };
}

async function projectHostedLinqLineOutboundAcceptedTx(input: {
  acceptedAt: Date;
  phoneNumberLookupKey: string;
  prisma: HostedLinqDeliveryClient;
}): Promise<void> {
  await input.prisma.hostedLinqLine.update({
    where: {
      phoneNumberLookupKey: input.phoneNumberLookupKey,
    },
    data: {
      totalOutboundCount: { increment: 1 },
    },
  });
  await input.prisma.hostedLinqLine.updateMany({
    where: {
      phoneNumberLookupKey: input.phoneNumberLookupKey,
      OR: [
        { lastOutboundAt: null },
        { lastOutboundAt: { lt: input.acceptedAt } },
      ],
    },
    data: {
      lastOutboundAt: input.acceptedAt,
    },
  });
}
