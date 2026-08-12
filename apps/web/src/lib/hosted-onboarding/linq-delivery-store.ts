import { Prisma, type PrismaClient } from "@prisma/client";

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
  type HostedLinqInviteSignupGroupJoinReplyContext,
  parseHostedLinqInviteSignupEffectId,
} from "./linq-invite-signup-effect-id";
import {
  buildHostedLinqGroupLineRecoveryAttemptEffectId,
  buildHostedLinqGroupLineRecoveryEffectId,
  HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE,
  HOSTED_LINQ_GROUP_LINE_RECOVERY_MAX_ATTEMPTS,
  isHostedLinqGroupLineRecoverySourceRefForEffect,
  parseHostedLinqGroupLineRecoverySourceRef,
} from "./linq-group-line-recovery";
import { HOSTED_LINQ_GROUP_SETUP_TEMPLATE } from "./linq-group-setup";
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
import { lockHostedMemberRow } from "./shared";
import { generateHostedRandomPrefixedId, sha256Hex } from "../primitives";
import {
  acquireHostedLinqChatOwnershipLockTx,
} from "../hosted-routing/linq-chat-ownership-lock";

type HostedLinqDeliveryClient = PrismaClient | Prisma.TransactionClient;
const HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS =
  "provider_dispatch_started";
export const HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE =
  "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY";
type HostedLinqDeliveryProviderDispatchData = {
  attemptedAt: Date;
  failedAt: null;
  failureCode: null;
  failureReason: null;
  groupJoinOutreachId: string | null;
  groupJoinReplyOccurredAt: Date | null;
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
const HOSTED_AI_USAGE_TELEGRAM_NOTICE_DELIVERY_SOURCE =
  "hosted_runtime_ai_usage_limit_notice";

export type HostedAiUsageLimitNoticeDeliveryClaim =
  | {
    idempotencyKey: string;
    providerIdempotencyKey: string;
    status: "claimed";
  }
  | {
    retryAt?: Date;
    status: "in_flight";
  }
  | {
    status: "already_notified";
  };

export type HostedAiUsageLimitNoticeDeliverySource =
  | typeof HOSTED_AI_USAGE_LINQ_NOTICE_DELIVERY_SOURCE
  | typeof HOSTED_AI_USAGE_TELEGRAM_NOTICE_DELIVERY_SOURCE;

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
  groupJoinReplyContext?: HostedLinqInviteSignupGroupJoinReplyContext;
  memberId: string;
  occurredAt: string;
  releaseDailySuppression?: true;
};

type HostedLinqAcceptedMilestoneStatus =
  | "accepted"
  | "delivered"
  | "failed"
  | null;

type HostedLinqDeliveredOnboardingLink = HostedLinqReopenOnboardingLink & {
  linqChatId: string | null;
  service: string | null;
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

const HOSTED_LINQ_INVITE_SIGNUP_MAX_ATTEMPTS_PER_IDENTITY = 5;

/**
 * Resolves which signup-link delivery attempt an inbound-driven send should
 * run as. Attempts are first-class delivery rows: a row whose provider
 * conclusively failed (terminal receipt) can never be re-dispatched under its
 * own idempotency key (the provider would dedupe against the dead message),
 * so the retry advances to the next attempt ordinal. A synchronous send
 * failure keeps its ordinal: the row is not provider-correlated and the
 * existing stale-attempt re-claim on the same key stays dedupe-safe against
 * a provider that may have half-processed it. An incomplete rich-link partial
 * also keeps its ordinal even when one provider identity is known, because a
 * fresh ordinal could replay an already accepted message. Returns null when
 * that exact identity's attempt budget is exhausted.
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
    { length: HOSTED_LINQ_INVITE_SIGNUP_MAX_ATTEMPTS_PER_IDENTITY },
    (_, index) => buildHostedLinqInviteSignupEffectId({
      attempt: index + 1,
      memberId: parsed.memberId,
      occurredAt: parsed.dayUtc,
      sourceEventDigest: parsed.sourceEventDigest,
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
      failureCode: true,
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
    if (
      row.status === "failed"
      && row.failureCode
        === HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE
    ) {
      return candidate;
    }
    if (row.status !== "failed" || !isHostedLinqDeliveryProviderCorrelated(row)) {
      return candidate;
    }
  }

  return null;
}

type HostedLinqDeliveryProviderDispatchClaimInput = {
  attemptedAt?: Date;
  groupJoinOutreachId?: string | null;
  groupJoinReplyOccurredAt?: Date | null;
  idempotencyKey?: string | null;
  linqChatId?: string | null;
  phoneNumber?: string | null;
  prisma: HostedLinqDeliveryClient;
  reclaimStalePreProviderAttempt?: boolean;
  returnExistingFailureCode?: boolean;
  source: string;
  sourceRef?: string | null;
  status?: HostedLinqDeliveryProviderDispatchData["status"];
  targetKind?: string | null;
  template?: string | null;
};

export type HostedLinqDeliveryProviderDispatchClaim = {
  claimed: boolean;
  failureCode?: string | null;
  id: string | null;
  outcome?: "completed" | "incompatible";
  retryAt?: Date;
};

export async function claimHostedLinqDeliveryProviderDispatchTx(
  input: HostedLinqDeliveryProviderDispatchClaimInput,
): Promise<HostedLinqDeliveryProviderDispatchClaim> {
  return claimHostedLinqDeliveryProviderDispatchWithIdTx(
    input,
    buildHostedLinqDeliveryId,
  );
}

export type HostedLinqDeliveryProviderDispatchIntent = {
  id: string;
  groupJoinOutreachId: string | null;
  groupJoinReplyOccurredAt: Date | null;
  lastProviderEventId: string | null;
  phoneNumberLookupKey: string | null;
  providerCorrelated: boolean;
  sourceRef: string | null;
  status: string;
  targetKind: string | null;
  template: string | null;
};

export type HostedLinqDeliveryIndexedProviderDispatchIntent =
  HostedLinqDeliveryProviderDispatchIntent & {
    attemptedAt: Date;
    idempotencyLookupKey: string;
  };

export async function readHostedLinqDeliveryProviderDispatchIntentsTx(input: {
  idempotencyKeys: readonly string[];
  prisma: HostedLinqDeliveryClient;
}): Promise<HostedLinqDeliveryIndexedProviderDispatchIntent[]> {
  const idempotencyKeys = [
    ...new Set(
      input.idempotencyKeys
        .map(createHostedLinqDeliveryIdempotencyLookupKey)
        .filter((key): key is string => key !== null),
    ),
  ];
  if (idempotencyKeys.length === 0) {
    return [];
  }
  const deliveries = await input.prisma.hostedLinqDelivery.findMany({
    where: {
      idempotencyKey: {
        in: idempotencyKeys,
      },
    },
    select: {
      acceptedAt: true,
      attemptedAt: true,
      deliveredAt: true,
      groupJoinOutreachId: true,
      groupJoinReplyOccurredAt: true,
      id: true,
      idempotencyKey: true,
      lastProviderEventId: true,
      lastReceiptAt: true,
      messageLookupKey: true,
      phoneNumberLookupKey: true,
      sourceRef: true,
      status: true,
      targetKind: true,
      template: true,
    },
  });
  return deliveries.flatMap((delivery) =>
    delivery.idempotencyKey
      ? [{
          attemptedAt: delivery.attemptedAt,
          id: delivery.id,
          idempotencyLookupKey: delivery.idempotencyKey,
          groupJoinOutreachId: delivery.groupJoinOutreachId,
          groupJoinReplyOccurredAt: delivery.groupJoinReplyOccurredAt,
          lastProviderEventId: delivery.lastProviderEventId,
          phoneNumberLookupKey: delivery.phoneNumberLookupKey,
          providerCorrelated: isHostedLinqDeliveryProviderCorrelated(delivery),
          sourceRef: delivery.sourceRef,
          status: delivery.status,
          targetKind: delivery.targetKind,
          template: delivery.template,
        }]
      : []
  );
}

export async function readHostedLinqDeliveryProviderDispatchIntentTx(input: {
  idempotencyKey: string;
  prisma: HostedLinqDeliveryClient;
}): Promise<HostedLinqDeliveryProviderDispatchIntent | null> {
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(
    input.idempotencyKey,
  );
  if (!idempotencyKey) {
    return null;
  }
  const delivery = await input.prisma.hostedLinqDelivery.findUnique({
    where: { idempotencyKey },
    select: {
      acceptedAt: true,
      deliveredAt: true,
      groupJoinOutreachId: true,
      groupJoinReplyOccurredAt: true,
      id: true,
      lastProviderEventId: true,
      lastReceiptAt: true,
      messageLookupKey: true,
      phoneNumberLookupKey: true,
      sourceRef: true,
      status: true,
      targetKind: true,
      template: true,
    },
  });
  if (!delivery) {
    return null;
  }
  return {
    id: delivery.id,
    groupJoinOutreachId: delivery.groupJoinOutreachId,
    groupJoinReplyOccurredAt: delivery.groupJoinReplyOccurredAt,
    lastProviderEventId: delivery.lastProviderEventId,
    phoneNumberLookupKey: delivery.phoneNumberLookupKey,
    providerCorrelated: isHostedLinqDeliveryProviderCorrelated(delivery),
    sourceRef: delivery.sourceRef,
    status: delivery.status,
    targetKind: delivery.targetKind,
    template: delivery.template,
  };
}

export type HostedLinqGroupLineRecoveryAuthority =
  | "accepted"
  | "in_flight"
  | "none";

/**
 * A completed private recovery delivery is the existing durable proof that a
 * member was told to move this exact group from one Murph line to another.
 * An exact uncorrelated attempt remains distinguishable so admission retries
 * instead of treating an unfinished provider outcome as definitive absence.
 * Bound both states to setup time so an old recovery cannot affect a later
 * "next group" setup for an unrelated retry.
 */
export async function readHostedLinqGroupLineRecoveryAuthorityTx(input: {
  memberId: string;
  occurredAt: Date;
  originalRecipientPhone: string;
  pendingGroupSetupId: string;
  prisma: HostedLinqDeliveryClient;
  recoveredRecipientPhoneLookupKey: string;
  setupArmedAt: Date;
  threadId: string;
}): Promise<HostedLinqGroupLineRecoveryAuthority> {
  const effectId = buildHostedLinqGroupLineRecoveryEffectId({
    incomingRecipientPhone: input.originalRecipientPhone,
    memberId: input.memberId,
    pendingGroupSetupId: input.pendingGroupSetupId,
    threadId: input.threadId,
  });
  const attemptEffectIds = Array.from(
    { length: HOSTED_LINQ_GROUP_LINE_RECOVERY_MAX_ATTEMPTS },
    (_, index) => buildHostedLinqGroupLineRecoveryAttemptEffectId({
      attempt: index + 1,
      effectId,
    }),
  );
  const persistedIntents =
    await readHostedLinqDeliveryProviderDispatchIntentsTx({
      idempotencyKeys: attemptEffectIds,
      prisma: input.prisma,
    });
  const matchingIntents = persistedIntents.filter((intent) =>
    intent.attemptedAt >= input.setupArmedAt
    && intent.attemptedAt <= input.occurredAt
    && intent.phoneNumberLookupKey
      === input.recoveredRecipientPhoneLookupKey
    && intent.status !== "failed"
    && intent.status !== "skipped"
    && intent.targetKind === "participant"
    && intent.template === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE
    && isHostedLinqGroupLineRecoverySourceRefForEffect({
      candidate: intent.sourceRef,
      effectId,
    })
  );
  if (matchingIntents.some((intent) => intent.providerCorrelated)) {
    return "accepted";
  }
  return matchingIntents.length > 0 ? "in_flight" : "none";
}

export async function hasHostedLinqGroupLineRecoveryAuthorityTx(input: {
  memberId: string;
  occurredAt: Date;
  originalRecipientPhone: string;
  pendingGroupSetupId: string;
  prisma: HostedLinqDeliveryClient;
  recoveredRecipientPhoneLookupKey: string;
  setupArmedAt: Date;
  threadId: string;
}): Promise<boolean> {
  return await readHostedLinqGroupLineRecoveryAuthorityTx(input) === "accepted";
}

async function claimHostedLinqDeliveryProviderDispatchWithIdTx(
  input: HostedLinqDeliveryProviderDispatchClaimInput,
  buildDeliveryId: (idempotencyKey: string) => string,
): Promise<HostedLinqDeliveryProviderDispatchClaim> {
  const attemptedAt = input.attemptedAt ?? new Date();
  const template = normalizeNullable(input.template);
  const groupJoinOutreachId = normalizeNullable(input.groupJoinOutreachId);
  const groupJoinReplyOccurredAt = normalizeNullableDate(
    input.groupJoinReplyOccurredAt,
    "Hosted Linq group-join reply occurrence time",
  );
  assertHostedLinqDeliveryGroupJoinContext({
    groupJoinOutreachId,
    groupJoinReplyOccurredAt,
    template,
  });
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
    groupJoinOutreachId,
    groupJoinReplyOccurredAt,
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
    template,
  } satisfies HostedLinqDeliveryProviderDispatchData;
  const createData = {
    ...data,
    id: buildDeliveryId(idempotencyKey),
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
      returnExistingFailureCode: input.returnExistingFailureCode,
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
    returnExistingFailureCode: input.returnExistingFailureCode,
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
}): Promise<HostedLinqDeliveryProviderDispatchClaim> {
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
  planResetAt?: Date | null;
  phoneNumber?: string | null;
  prisma: HostedLinqDeliveryClient;
  source: HostedAiUsageLimitNoticeDeliverySource;
  sourceRef: string;
  targetKind: string;
  usageCreditLedgerVersion: bigint;
}): Promise<HostedAiUsageLimitNoticeDeliveryClaim> {
  return runHostedLinqDeliveryTransaction(input.prisma, async (prisma) => {
    if (input.linqChatId) {
      await acquireHostedLinqChatOwnershipLockTx({
        chatId: input.linqChatId,
        tx: prisma,
      });
    }
    await input.assertDispatchAuthority?.(prisma);
    const idempotencyKey = buildHostedAiUsageGateNoticeIdempotencyKey(input);
    const lookupKey = createHostedLinqDeliveryIdempotencyLookupKey(idempotencyKey);
    if (!lookupKey) {
      return { status: "already_notified" };
    }

    const claim = await claimHostedLinqDeliveryProviderDispatchWithIdTx(
      {
        attemptedAt: input.attemptedAt,
        idempotencyKey,
        linqChatId: input.linqChatId,
        phoneNumber: input.phoneNumber,
        prisma,
        reclaimStalePreProviderAttempt: true,
        source: input.source,
        sourceRef: input.sourceRef,
        status: HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS,
        targetKind: input.targetKind,
        template: "ai_usage_quota",
      },
      () => generateHostedRandomPrefixedId("hld"),
    );
    if (claim.claimed) {
      if (!claim.id) {
        throw new Error("Hosted AI usage notice claim is missing its attempt id.");
      }
      return {
        idempotencyKey,
        providerIdempotencyKey:
          buildHostedAiUsageNoticeProviderIdempotencyKey(claim.id),
        status: "claimed",
      };
    }
    if (claim.retryAt) {
      return { retryAt: claim.retryAt, status: "in_flight" };
    }

    const delivery = await prisma.hostedLinqDelivery.findUnique({
      where: { idempotencyKey: lookupKey },
      select: hostedLinqDeliveryLifecycleSelect,
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
}

async function runHostedLinqDeliveryTransaction<T>(
  prisma: HostedLinqDeliveryClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if ("$transaction" in prisma) {
    return prisma.$transaction(run);
  }

  return run(prisma);
}

export function buildHostedAiUsageGateNoticeIdempotencyKey(input: {
  memberId: string;
  periodStart: Date | string;
  planResetAt?: Date | string | null;
  usageCreditLedgerVersion: bigint;
}): string {
  const periodStart = normalizeHostedAiUsageNoticePeriodStart(input.periodStart);
  const planResetAt = input.planResetAt === null || input.planResetAt === undefined
    ? null
    : normalizeHostedAiUsageNoticePeriodStart(input.planResetAt);
  if (input.usageCreditLedgerVersion < 0n) {
    throw new TypeError(
      "Hosted AI usage notice ledger version must be a non-negative integer.",
    );
  }
  const capacityEpoch = input.usageCreditLedgerVersion === 0n
    ? {
        memberId: input.memberId,
        periodStart: periodStart.toISOString(),
        ...(planResetAt ? { planResetAt: planResetAt.toISOString() } : {}),
      }
    : {
        memberId: input.memberId,
        periodStart: periodStart.toISOString(),
        ...(planResetAt ? { planResetAt: planResetAt.toISOString() } : {}),
        usageCreditLedgerVersion: input.usageCreditLedgerVersion.toString(),
      };
  return `ai-usage-gate:${sha256Hex(JSON.stringify(capacityEpoch)).slice(0, 32)}`;
}

export function buildHostedAiUsageNoticeProviderIdempotencyKey(
  deliveryId: string,
): string {
  const normalized = deliveryId.trim();
  if (!normalized) {
    throw new TypeError("Hosted AI usage notice delivery id is required.");
  }
  return `ai-usage-attempt:${normalized}`;
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
    groupJoinOutreachId: string | null;
    groupJoinReplyOccurredAt: Date | null;
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
  messageIds?: readonly string[];
  prisma: HostedLinqDeliveryClient;
}): Promise<{
  deliveryStatus: HostedLinqAcceptedMilestoneStatus;
  reopenOnboardingLink: HostedLinqReopenOnboardingLink | null;
  restoreOnboardingLink: HostedLinqDeliveredOnboardingLink | null;
}> {
  const none = {
    deliveryStatus: null,
    reopenOnboardingLink: null,
    restoreOnboardingLink: null,
  };
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(input.idempotencyKey);
  if (!idempotencyKey) {
    return none;
  }
  const acceptedAt = input.acceptedAt ?? new Date();
  const providerMessageIds = normalizeHostedLinqProviderMessageIds(
    input.messageIds,
    input.messageId,
  );
  const finalMessageId =
    providerMessageIds.at(-1) ?? normalizeNullable(input.messageId);
  const messageLookupKey = createHostedLinqMessageLookupKey(finalMessageId);
  return runHostedLinqDeliveryStoreTransaction(input.prisma, async (prisma) => {
    const signupAttempt = parseHostedLinqInviteSignupEffectId(
      input.idempotencyKey,
    );
    if (signupAttempt) {
      await lockHostedMemberRow(prisma, signupAttempt.memberId);
    }
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
        acceptedAt,
        failedAt: null,
        failureCode: null,
        failureReason: null,
        retryAfterAt: null,
        linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
        messageIdSuffix: toHostedOnboardingLogIdSuffix(finalMessageId),
        messageLookupKey,
        status: "accepted",
      },
    });
    if (updated.count !== 1) {
      const current = await prisma.hostedLinqDelivery.findUnique({
        where: { idempotencyKey },
        select: { status: true },
      });
      return {
        ...none,
        deliveryStatus: readHostedLinqAcceptedMilestoneStatus(
          current?.status ?? null,
        ),
      };
    }

    const delivery = await prisma.hostedLinqDelivery.findUnique({
      where: { idempotencyKey },
      select: {
        groupJoinOutreachId: true,
        groupJoinReplyOccurredAt: true,
        id: true,
        sourceRef: true,
        template: true,
      },
    });
    if (delivery && providerMessageIds.length > 1) {
      await recordHostedLinqDeliveryMessagesTx({
        acceptedAt,
        deliveryId: delivery.id,
        messageIds: providerMessageIds,
        prisma,
      });
    }

    const replay = await applyLatestHostedLinqDeliveryReceiptForAcceptedMessageTx({
      deliveryId: delivery?.id ?? null,
      idempotencyKey,
      messageLookupKey,
      messageLookupKeyCandidates:
        createHostedLinqMessageLookupKeyReadCandidates(finalMessageId),
      messageIds: providerMessageIds.length > 1 ? providerMessageIds : undefined,
      prisma,
    });
    if (!replay.advanced || !replay.receipt) {
      return {
        ...none,
        deliveryStatus: "accepted",
      };
    }

    // A receipt buffered before this milestone wrote the message lookup key
    // just resolved the delivery terminally; surface the same reopen/restore
    // signal the live receipt-ingestion path emits so the orchestration layer
    // projects the same complete member/day delivery truth.
    const deliveryIdentity = {
      groupJoinOutreachId: delivery?.groupJoinOutreachId ?? null,
      groupJoinReplyOccurredAt: delivery?.groupJoinReplyOccurredAt ?? null,
      idempotencyKey: input.idempotencyKey,
      sourceRef: delivery?.sourceRef ?? null,
      template: delivery?.template ?? null,
    };
    const onboardingLink = replay.receipt.deliveryStatus === "failed"
      ? await resolveHostedLinqFailedDeliveryReopenTx({
          ...deliveryIdentity,
          prisma,
        })
      : resolveHostedLinqReopenOnboardingLink(deliveryIdentity);
    if (!onboardingLink) {
      return {
        ...none,
        deliveryStatus: replay.receipt.deliveryStatus,
      };
    }
    return replay.receipt.deliveryStatus === "failed"
      ? {
          deliveryStatus: "failed",
          reopenOnboardingLink: onboardingLink,
          restoreOnboardingLink: null,
        }
      : {
          deliveryStatus: "delivered",
          reopenOnboardingLink: null,
          restoreOnboardingLink: {
            ...onboardingLink,
            linqChatId: input.linqChatId ?? null,
            service: replay.receipt.service,
          },
        };
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
  messageIds?: readonly string[];
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
  const answeredMailboxConsumedAt = acceptedAt;
  const line = await readHostedLinqDeliveryLineIdentityTx({
    phoneNumber: input.phoneNumber ?? null,
    phoneNumberLookupKey: input.phoneNumberLookupKey ?? null,
    prisma: input.prisma,
  });
  const providerMessageIds = normalizeHostedLinqProviderMessageIds(
    input.messageIds,
    input.messageId,
  );
  const finalMessageId =
    providerMessageIds.at(-1) ?? normalizeNullable(input.messageId);
  const messageLookupKey = createHostedLinqMessageLookupKey(finalMessageId);
  const messageLookupKeyCandidates =
    createHostedLinqMessageLookupKeyReadCandidates(finalMessageId);
  const recoveredPrimaryMessageLookupKey = providerMessageIds.length > 1
    ? createHostedLinqMessageLookupKey(providerMessageIds[0] ?? null)
    : null;
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
    threadIsDirect:
      typeof input.threadIsDirect === "boolean" ? input.threadIsDirect : null,
  };

  return await runHostedLinqDeliveryStoreTransaction(input.prisma, async (prisma) => {
    let acceptedAdvanced = false;
    let failedAdvanced = false;
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
                messageIdSuffix: toHostedOnboardingLogIdSuffix(finalMessageId),
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
                ...(providerMessageIds.length > 0
                  ? {
                      messageIdSuffix:
                        toHostedOnboardingLogIdSuffix(finalMessageId),
                      messageLookupKey,
                    }
                  : {}),
                status: "failed",
              },
        });
        acceptedAdvanced = Boolean(acceptedAt);
        failedAdvanced = Boolean(failedAt);
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
        const advanced =
          await updateHostedLinqRuntimeDeliveryOutcomeIfPreProviderTx({
          acceptedAt,
          attemptedAt,
          failedAt,
          failureCode: input.failureCode ?? null,
          failureReason: input.failureReason ?? null,
          idempotencyKey,
          line,
          linqChatId: input.linqChatId ?? null,
          messageId: finalMessageId,
          messageLookupKey,
          recoveredPrimaryMessageLookupKey,
          prisma,
          sourceRef: input.sourceRef ?? null,
          targetKind: input.targetKind ?? null,
          threadIsDirect: input.threadIsDirect ?? null,
        });
        acceptedAdvanced = Boolean(acceptedAt) && advanced;
        failedAdvanced = Boolean(failedAt) && advanced;
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
        messageId: finalMessageId,
        messageLookupKey,
        recoveredPrimaryMessageLookupKey,
        prisma,
        sourceRef: input.sourceRef ?? null,
        targetKind: input.targetKind ?? null,
        threadIsDirect: input.threadIsDirect ?? null,
      });
    } else if (failedAt) {
      failedAdvanced = await updateHostedLinqRuntimeDeliveryOutcomeIfPreProviderTx({
        acceptedAt: null,
        attemptedAt,
        failedAt,
        failureCode: input.failureCode ?? null,
        failureReason: input.failureReason ?? null,
        idempotencyKey,
        line,
        linqChatId: input.linqChatId ?? null,
        messageId: finalMessageId,
        messageLookupKey,
        recoveredPrimaryMessageLookupKey,
        prisma,
        sourceRef: input.sourceRef ?? null,
        targetKind: input.targetKind ?? null,
        threadIsDirect: input.threadIsDirect ?? null,
      });
    }

    if (failedAdvanced && failedAt && providerMessageIds.length > 0) {
      await recordHostedLinqDeliveryMessagesTx({
        acceptedAt: failedAt,
        deliveryId,
        messageIds: providerMessageIds,
        prisma,
      });
    }
    if (acceptedAdvanced && acceptedAt && providerMessageIds.length > 1) {
      await recordHostedLinqDeliveryMessagesTx({
        acceptedAt,
        deliveryId,
        messageIds: providerMessageIds,
        prisma,
      });
      await recomputeHostedLinqDeliveryFromMessagesTx({
        deliveryId,
        prisma,
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
        deliveryId,
        idempotencyKey,
        messageLookupKey,
        messageLookupKeyCandidates,
        messageIds: providerMessageIds.length > 1 ? providerMessageIds : undefined,
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
    if (
      acceptedAdvanced
      && answeredMailboxConsumedAt
      && input.answeredMailboxItemIds?.length
    ) {
      await prisma.hostedMailboxItem.updateMany({
        data: {
          consumedAt: answeredMailboxConsumedAt,
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
  recoveredPrimaryMessageLookupKey: string | null;
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
        OR: [
          {
            failedAt: null,
            lastReceiptAt: null,
            messageLookupKey: null,
          },
          {
            failedAt: { not: null },
            lastReceiptAt: null,
            messageLookupKey: null,
          },
          ...(input.recoveredPrimaryMessageLookupKey
            ? [{
                failedAt: { not: null },
                failureCode:
                  HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE,
                messageLookupKey: input.recoveredPrimaryMessageLookupKey,
                skippedAt: null,
                status: "failed",
              }]
            : []),
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
        threadIsDirect: input.threadIsDirect,
      },
    });
    return updated.count === 1;
  }

  if (!input.failedAt) {
    return false;
  }

  const updated = await input.prisma.hostedLinqDelivery.updateMany({
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
      ...(input.messageLookupKey
        ? {
            messageIdSuffix: toHostedOnboardingLogIdSuffix(input.messageId),
            messageLookupKey: input.messageLookupKey,
          }
        : {}),
      phoneNumberHint: input.line.phoneNumberHint,
      phoneNumberLookupKey: input.line.phoneNumberLookupKey,
      retryAfterAt: null,
      source: "hosted_runtime_linq_delivery",
      sourceRef: createHostedLinqDeliverySourceRefLookupKey(normalizeNullable(input.sourceRef)),
      skippedAt: null,
      skipReason: null,
      status: "failed",
      targetKind: normalizeNullable(input.targetKind),
      threadIsDirect: input.threadIsDirect,
    },
  });
  return updated.count === 1;
}

const HOSTED_LINQ_RUNTIME_GROUP_SENT_NO_RECEIPT_STATUS = "sent_no_receipt_expected";

function resolveHostedLinqRuntimeAcceptedStatus(input: {
  targetKind: string | null;
  threadIsDirect: boolean | null;
}): "accepted" | "sent_no_receipt_expected" {
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
  linqChatId?: string | null;
  messageIds?: readonly string[];
  prisma: HostedLinqDeliveryClient;
  retryAfterAt?: Date | null;
}): Promise<void> {
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(input.idempotencyKey);
  if (!idempotencyKey) {
    return;
  }
  const failedAt = input.failedAt ?? new Date();
  const failureCode = sanitizeHostedOnboardingPersistedErrorCode(
    normalizeNullable(input.failureCode),
  );
  const providerMessageIds = normalizeHostedLinqProviderMessageIds(
    input.messageIds,
    null,
  );
  const finalMessageId = providerMessageIds.at(-1) ?? null;
  await runHostedLinqDeliveryStoreTransaction(input.prisma, async (prisma) => {
    const updated = await prisma.hostedLinqDelivery.updateMany({
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
        failedAt,
        failureCode,
        failureReason: sanitizeHostedOnboardingPersistedErrorMessage(
          normalizeNullable(input.failureReason),
        ),
        ...(providerMessageIds.length > 0
          ? {
              linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
              messageIdSuffix: toHostedOnboardingLogIdSuffix(finalMessageId),
              messageLookupKey: createHostedLinqMessageLookupKey(finalMessageId),
            }
          : {}),
        retryAfterAt: input.retryAfterAt ?? null,
        status: "failed",
      },
    });
    if (updated.count !== 1 || providerMessageIds.length === 0) {
      return;
    }
    const delivery = await prisma.hostedLinqDelivery.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (!delivery) {
      return;
    }
    await recordHostedLinqDeliveryMessagesTx({
      acceptedAt: failedAt,
      deliveryId: delivery.id,
      messageIds: providerMessageIds,
      prisma,
    });
    if (
      failureCode
      === HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE
    ) {
      await applyLatestHostedLinqDeliveryReceiptForAcceptedMessageTx({
        deliveryId: delivery.id,
        idempotencyKey,
        messageLookupKey: createHostedLinqMessageLookupKey(finalMessageId),
        messageLookupKeyCandidates:
          createHostedLinqMessageLookupKeyReadCandidates(finalMessageId),
        messageIds: providerMessageIds,
        prisma,
      });
    }
  });
}

export async function markHostedAiUsageLimitNoticeDeliveryRetryableTx(input: {
  expectedAttemptedAt: Date;
  failedAt?: Date;
  failureCode?: string | null;
  failureReason?: string | null;
  idempotencyKey: string;
  prisma: PrismaClient;
  retryAfterAt: Date;
}): Promise<boolean> {
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(input.idempotencyKey);
  if (!idempotencyKey) {
    return false;
  }

  const delivery = await input.prisma.hostedLinqDelivery.updateMany({
    where: {
      acceptedAt: null,
      attemptedAt: input.expectedAttemptedAt,
      deliveredAt: null,
      failedAt: null,
      idempotencyKey,
      lastReceiptAt: null,
      messageLookupKey: null,
      skippedAt: null,
      source: HOSTED_AI_USAGE_TELEGRAM_NOTICE_DELIVERY_SOURCE,
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
  return delivery.count === 1;
}

export async function markHostedLinqDeliverySkippedTx(input: {
  failureCode?: string | null;
  failureReason?: string | null;
  groupJoinOutreachId?: string | null;
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
    groupJoinOutreachId: normalizeNullable(input.groupJoinOutreachId),
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
  restoreOnboardingLink: HostedLinqDeliveredOnboardingLink | null;
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
  const ownedMessageReceipt =
    await applyHostedLinqDeliveryMessageReceiptTx(input);
  if (ownedMessageReceipt) {
    return ownedMessageReceipt;
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
      failureCode: true,
      groupJoinOutreachId: true,
      groupJoinReplyOccurredAt: true,
      id: true,
      idempotencyKey: true,
      phoneNumberLookupKey: true,
      sourceRef: true,
      status: true,
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
  if (
    delivery.status === "failed"
    && delivery.failureCode
      === HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE
  ) {
    return {
      advanced: false,
      deliveryId: delivery.id,
      phoneNumberLookupKey: delivery.phoneNumberLookupKey,
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    };
  }
  const deliveryOnboardingLink = resolveHostedLinqReopenOnboardingLink(
    delivery,
  );
  if (deliveryOnboardingLink) {
    // Every signup attempt for one member/day shares one suppression
    // projection. Serialize terminal receipt consequences through the
    // existing member owner so concurrent failures cannot each preserve a
    // marker based on the other's not-yet-committed status.
    await lockHostedMemberRow(input.prisma, deliveryOnboardingLink.memberId);
  }

  const updated = await input.prisma.hostedLinqDelivery.updateMany({
    where: {
      id: delivery.id,
      OR: buildReceiptOrderingWhere(input.event),
    },
    data: buildReceiptUpdate(input.event),
  });
  const advanced = updated.count === 1;
  const onboardingLink = !advanced
    ? null
    : input.event.deliveryStatus === "failed"
      ? await resolveHostedLinqFailedDeliveryReopenTx({
          groupJoinOutreachId: delivery.groupJoinOutreachId,
          groupJoinReplyOccurredAt: delivery.groupJoinReplyOccurredAt,
          idempotencyKey: delivery.idempotencyKey,
          prisma: input.prisma,
          sourceRef: delivery.sourceRef,
          template: delivery.template,
        })
      : resolveHostedLinqReopenOnboardingLink(delivery);
  return {
    advanced,
    deliveryId: delivery.id,
    phoneNumberLookupKey: delivery.phoneNumberLookupKey,
    reopenOnboardingLink: advanced && input.event.deliveryStatus === "failed"
      ? onboardingLink
      : null,
    // The symmetric signal: a delivered receipt that wins ordering after a
    // reopen re-marks the member/day because that delivery remains live truth.
    restoreOnboardingLink:
      advanced
      && input.event.deliveryStatus === "delivered"
      && onboardingLink
        ? {
            ...onboardingLink,
            linqChatId: input.event.linqChatId,
            service: input.event.service,
          }
        : null,
  };
}

async function applyHostedLinqDeliveryMessageReceiptTx(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: HostedLinqDeliveryClient;
}): Promise<{
  advanced: boolean;
  deliveryId: string;
  phoneNumberLookupKey: string | null;
  reopenOnboardingLink: HostedLinqReopenOnboardingLink | null;
  restoreOnboardingLink: HostedLinqDeliveredOnboardingLink | null;
} | null> {
  const messageClient = input.prisma.hostedLinqDeliveryMessage;
  if (
    !messageClient
    || !input.event.messageLookupKey
    || !input.event.deliveryStatus
  ) {
    return null;
  }
  const messageLookupKeys =
    input.event.messageLookupKeyReadCandidates.length > 0
      ? input.event.messageLookupKeyReadCandidates
      : [input.event.messageLookupKey];
  const message = await messageClient.findFirst({
    where: {
      messageLookupKey: {
        in: messageLookupKeys,
      },
    },
    select: {
      delivery: {
        select: {
          groupJoinOutreachId: true,
          groupJoinReplyOccurredAt: true,
          id: true,
          idempotencyKey: true,
          phoneNumberLookupKey: true,
          sourceRef: true,
          template: true,
        },
      },
      id: true,
    },
  });
  if (!message) {
    return null;
  }
  const delivery = message.delivery;
  const deliveryOnboardingLink = resolveHostedLinqReopenOnboardingLink(delivery);
  if (deliveryOnboardingLink) {
    await lockHostedMemberRow(input.prisma, deliveryOnboardingLink.memberId);
  }
  await lockHostedLinqDeliveryRow(input.prisma, delivery.id);
  const receipt = buildHostedLinqDeliveryReceiptData(input.event);
  const updated = await input.prisma.hostedLinqDeliveryMessage.updateMany({
    where: {
      id: message.id,
      OR: buildHostedLinqDeliveryMessageReceiptOrderingWhere(receipt),
    },
    data: buildHostedLinqDeliveryMessageReceiptUpdate(receipt),
  });
  if (updated.count !== 1) {
    return {
      advanced: false,
      deliveryId: delivery.id,
      phoneNumberLookupKey: delivery.phoneNumberLookupKey,
      reopenOnboardingLink: null,
      restoreOnboardingLink: null,
    };
  }
  const aggregate = await recomputeHostedLinqDeliveryFromMessagesTx({
    deliveryId: delivery.id,
    prisma: input.prisma,
  });
  const terminalOnboardingLink = aggregate.terminalStatusChanged
    ? aggregate.status === "failed"
      ? await resolveHostedLinqFailedDeliveryReopenTx({
          groupJoinOutreachId: delivery.groupJoinOutreachId,
          groupJoinReplyOccurredAt: delivery.groupJoinReplyOccurredAt,
          idempotencyKey: delivery.idempotencyKey,
          prisma: input.prisma,
          sourceRef: delivery.sourceRef,
          template: delivery.template,
        })
      : resolveHostedLinqReopenOnboardingLink(delivery)
    : null;
  return {
    advanced: true,
    deliveryId: delivery.id,
    phoneNumberLookupKey: delivery.phoneNumberLookupKey,
    reopenOnboardingLink:
      aggregate.status === "failed" ? terminalOnboardingLink : null,
    restoreOnboardingLink:
      aggregate.status === "delivered" && terminalOnboardingLink
        ? {
            ...terminalOnboardingLink,
            linqChatId: input.event.linqChatId,
            service: input.event.service,
          }
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
  const ownedMessage = input.prisma.hostedLinqDeliveryMessage
    ? await input.prisma.hostedLinqDeliveryMessage.findFirst({
        where: {
          messageLookupKey: {
            in: messageLookupKeys,
          },
        },
        select: {
          delivery: {
            select: {
              id: true,
              phoneNumberLookupKey: true,
              source: true,
            },
          },
        },
      })
    : null;
  if (ownedMessage) {
    return {
      deliveryId: ownedMessage.delivery.id,
      phoneNumberLookupKey: ownedMessage.delivery.phoneNumberLookupKey,
      runtimeOwned:
        ownedMessage.delivery.source === "hosted_runtime_linq_delivery",
    };
  }
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

  return buildReceiptUpdateFromData(buildHostedLinqDeliveryReceiptData(event));
}

function buildHostedLinqDeliveryReceiptData(
  event: ParsedHostedLinqProviderEvent,
): HostedLinqDeliveryReceiptData {
  if (!event.deliveryStatus) {
    throw new TypeError("Hosted Linq delivery receipt requires a terminal status.");
  }
  return {
    deliveryStatus: event.deliveryStatus,
    eventId: event.eventId,
    failureCode: event.failureCode,
    failureReason: event.failureReason,
    providerCreatedAt: event.providerCreatedAt,
    service: event.service,
  };
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
  deliveryId?: string | null;
  idempotencyKey: string;
  messageLookupKeyCandidates?: readonly string[];
  messageLookupKey: string | null;
  messageIds?: readonly string[];
  prisma: HostedLinqDeliveryClient;
}): Promise<{
  advanced: boolean;
  receipt: HostedLinqDeliveryReceiptData | null;
}> {
  if (
    input.deliveryId
    && input.messageIds
    && input.messageIds.length > 0
  ) {
    return applyLatestHostedLinqDeliveryReceiptsForOwnedMessagesTx({
      deliveryId: input.deliveryId,
      messageIds: input.messageIds,
      prisma: input.prisma,
    });
  }
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

async function applyLatestHostedLinqDeliveryReceiptsForOwnedMessagesTx(input: {
  deliveryId: string;
  messageIds: readonly string[];
  prisma: HostedLinqDeliveryClient;
}): Promise<{
  advanced: boolean;
  receipt: HostedLinqDeliveryReceiptData | null;
}> {
  const receipts: HostedLinqDeliveryReceiptData[] = [];
  let advanced = false;
  for (const messageId of input.messageIds) {
    const messageLookupKeys =
      createHostedLinqMessageLookupKeyReadCandidates(messageId);
    const providerReceipts = await input.prisma.hostedLinqProviderEvent.findMany({
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
    const receipt = selectLatestHostedLinqReceiptData(providerReceipts);
    if (!receipt) {
      continue;
    }
    receipts.push(receipt);
    const message = await input.prisma.hostedLinqDeliveryMessage.findFirst({
      where: {
        deliveryId: input.deliveryId,
        messageLookupKey: {
          in: messageLookupKeys,
        },
      },
      select: { id: true },
    });
    if (!message) {
      continue;
    }
    const updated = await input.prisma.hostedLinqDeliveryMessage.updateMany({
      where: {
        id: message.id,
        OR: buildHostedLinqDeliveryMessageReceiptOrderingWhere(receipt),
      },
      data: buildHostedLinqDeliveryMessageReceiptUpdate(receipt),
    });
    advanced = updated.count === 1 || advanced;
  }

  if (!advanced) {
    return {
      advanced: false,
      receipt: null,
    };
  }
  const aggregate = await recomputeHostedLinqDeliveryFromMessagesTx({
    deliveryId: input.deliveryId,
    prisma: input.prisma,
  });
  const terminalReceipts = aggregate.status === "failed"
    ? receipts.filter((receipt) => receipt.deliveryStatus === "failed")
    : aggregate.status === "delivered"
      ? receipts.filter((receipt) => receipt.deliveryStatus === "delivered")
      : [];
  return {
    advanced: true,
    receipt: aggregate.terminalStatusChanged
      ? selectLatestHostedLinqReceiptData(terminalReceipts)
      : null,
  };
}

async function recordHostedLinqDeliveryMessagesTx(input: {
  acceptedAt: Date;
  deliveryId: string;
  messageIds: readonly string[];
  prisma: HostedLinqDeliveryClient;
}): Promise<void> {
  const messageIds = normalizeHostedLinqProviderMessageIds(input.messageIds, null);
  if (messageIds.length === 0) {
    return;
  }
  await input.prisma.hostedLinqDeliveryMessage.createMany({
    data: messageIds.map((messageId, ordinal) => ({
      acceptedAt: input.acceptedAt,
      deliveryId: input.deliveryId,
      id: buildHostedLinqDeliveryMessageId(input.deliveryId, ordinal),
      messageIdSuffix: toHostedOnboardingLogIdSuffix(messageId),
      messageLookupKey: requireHostedLinqMessageLookupKey(messageId),
      ordinal,
      status: "accepted",
    })),
    skipDuplicates: true,
  });
}

async function recomputeHostedLinqDeliveryFromMessagesTx(input: {
  deliveryId: string;
  prisma: HostedLinqDeliveryClient;
}): Promise<{
  status: "accepted" | "delivered" | "failed" | "sent_no_receipt_expected";
  terminalStatusChanged: boolean;
}> {
  const delivery = await input.prisma.hostedLinqDelivery.findUnique({
    where: { id: input.deliveryId },
    select: {
      failedAt: true,
      failureCode: true,
      failureReason: true,
      status: true,
      targetKind: true,
      threadIsDirect: true,
    },
  });
  if (!delivery) {
    return {
      status: "accepted",
      terminalStatusChanged: false,
    };
  }
  const messages = await input.prisma.hostedLinqDeliveryMessage.findMany({
    where: { deliveryId: input.deliveryId },
    orderBy: { ordinal: "asc" },
    select: {
      deliveredAt: true,
      failedAt: true,
      failureCode: true,
      failureReason: true,
      lastProviderEventId: true,
      lastReceiptAt: true,
      service: true,
      status: true,
    },
  });
  const failedMessages = messages.filter((message) => message.status === "failed");
  const incompletePartialDelivery =
    delivery.status === "failed"
    && delivery.failureCode
      === HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE
    && messages.length < 2;
  const allMessagesDelivered =
    messages.length > 0
    && !incompletePartialDelivery
    && messages.every((message) => message.status === "delivered");
  const aggregateStatus: "accepted" | "delivered" | "failed" =
    failedMessages.length > 0 || incompletePartialDelivery
      ? "failed"
      : allMessagesDelivered
        ? "delivered"
        : "accepted";
  const legacyGroupPolicy =
    delivery.status === HOSTED_LINQ_RUNTIME_GROUP_SENT_NO_RECEIPT_STATUS;
  const threadIsDirect = delivery.threadIsDirect ?? (
    legacyGroupPolicy ? false : null
  );
  const status = aggregateStatus === "accepted"
    ? resolveHostedLinqRuntimeAcceptedStatus({
        targetKind: delivery.targetKind ?? (legacyGroupPolicy ? "thread" : null),
        threadIsDirect,
      })
    : aggregateStatus;
  const latestMessage = selectLatestHostedLinqDeliveryMessageProgress(messages);
  const latestFailedMessage =
    selectLatestHostedLinqDeliveryMessageProgress(failedMessages);
  const deliveredAt = allMessagesDelivered
    ? selectLatestDate(messages.map((message) => message.deliveredAt))
    : null;
  const failedAt = incompletePartialDelivery
    ? delivery.failedAt
    : latestFailedMessage?.failedAt ?? null;
  const failureCode = incompletePartialDelivery
    ? delivery.failureCode
    : latestFailedMessage?.failureCode ?? null;
  const failureReason = incompletePartialDelivery
    ? delivery.failureReason
    : latestFailedMessage?.failureReason ?? null;
  const terminalStatusChanged =
    status !== delivery.status
    && (status === "delivered" || status === "failed");
  await input.prisma.hostedLinqDelivery.update({
    where: { id: input.deliveryId },
    data: {
      deliveredAt,
      failedAt,
      failureCode,
      failureReason,
      lastProviderEventId: latestMessage?.lastProviderEventId ?? null,
      lastReceiptAt: latestMessage?.lastReceiptAt ?? null,
      retryAfterAt: null,
      service: latestMessage?.service ?? null,
      status,
      threadIsDirect,
    },
  });
  return {
    status,
    terminalStatusChanged,
  };
}

function buildHostedLinqDeliveryMessageReceiptUpdate(
  receipt: HostedLinqDeliveryReceiptData,
): Prisma.HostedLinqDeliveryMessageUpdateInput {
  const progress = createHostedLinqProviderEventProgress({
    eventId: receipt.eventId,
    providerCreatedAt: receipt.providerCreatedAt,
  });
  const base = {
    lastProviderEventId: progress.eventLookupKey,
    lastReceiptAt: receipt.providerCreatedAt,
    service: receipt.service,
  } satisfies Prisma.HostedLinqDeliveryMessageUpdateInput;
  return receipt.deliveryStatus === "delivered"
    ? {
        ...base,
        deliveredAt: receipt.providerCreatedAt,
        failedAt: null,
        failureCode: null,
        failureReason: null,
        status: "delivered",
      }
    : {
        ...base,
        deliveredAt: null,
        failedAt: receipt.providerCreatedAt,
        failureCode: receipt.failureCode,
        failureReason: receipt.failureReason,
        status: "failed",
      };
}

function buildHostedLinqDeliveryMessageReceiptOrderingWhere(
  receipt: Pick<HostedLinqDeliveryReceiptData, "eventId" | "providerCreatedAt">,
): Prisma.HostedLinqDeliveryMessageWhereInput[] {
  const progress = createHostedLinqProviderEventProgress({
    eventId: receipt.eventId,
    providerCreatedAt: receipt.providerCreatedAt,
  });
  return [
    { lastReceiptAt: null },
    { lastReceiptAt: { lt: progress.providerCreatedAt } },
    {
      lastReceiptAt: progress.providerCreatedAt,
      OR: [
        { lastProviderEventId: null },
        { lastProviderEventId: { lt: progress.eventLookupKey } },
      ],
    },
  ];
}

function selectLatestHostedLinqDeliveryMessageProgress<
  T extends {
    lastProviderEventId: string | null;
    lastReceiptAt: Date | null;
  },
>(messages: readonly T[]): T | null {
  let selected: T | null = null;
  for (const message of messages) {
    if (!message.lastReceiptAt || !message.lastProviderEventId) {
      continue;
    }
    if (!selected?.lastReceiptAt || !selected.lastProviderEventId) {
      selected = message;
      continue;
    }
    const comparison = compareHostedLinqProviderEventProgress(
      {
        eventLookupKey: message.lastProviderEventId,
        providerCreatedAt: message.lastReceiptAt,
        rank: 0,
      },
      {
        eventLookupKey: selected.lastProviderEventId,
        providerCreatedAt: selected.lastReceiptAt,
        rank: 0,
      },
    );
    if (comparison > 0) {
      selected = message;
    }
  }
  return selected;
}

function selectLatestDate(values: readonly (Date | null)[]): Date | null {
  let selected: Date | null = null;
  for (const value of values) {
    if (value && (!selected || value > selected)) {
      selected = value;
    }
  }
  return selected;
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
  failureCode?: string | null;
  lastReceiptAt: Date | null;
  messageLookupKey: string | null;
  status: string;
}): boolean {
  return Boolean(
    input.acceptedAt
      || input.deliveredAt
      || input.lastReceiptAt
      || input.messageLookupKey
      || input.failureCode
        === HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE
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
  groupJoinOutreachId: true,
  groupJoinReplyOccurredAt: true,
  id: true,
  lastReceiptAt: true,
  linqChatLookupKey: true,
  messageLookupKey: true,
  phoneNumberLookupKey: true,
  retryAfterAt: true,
  skippedAt: true,
  source: true,
  sourceRef: true,
  status: true,
  targetKind: true,
  template: true,
  updatedAt: true,
} satisfies Prisma.HostedLinqDeliverySelect;

function isHostedLinqTerminalTelegramUsageLimitFailure(input: {
  failedAt: Date | null;
  retryAfterAt: Date | null;
  source: string | null;
  status: string;
}): boolean {
  return input.source === HOSTED_AI_USAGE_TELEGRAM_NOTICE_DELIVERY_SOURCE
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
    source: string;
    status: string;
  };
}): { inFlight: boolean; retryAt?: Date } {
  const retryAt = readHostedLinqTelegramUsageLimitRetryAt(input.delivery);
  if (retryAt && retryAt > input.attemptedAt) {
    return { inFlight: true, retryAt };
  }

  const staleAttemptBefore = new Date(
    input.attemptedAt.getTime() - HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
  );
  if (!isHostedLinqDeliveryPreProvider(input.delivery)) {
    return { inFlight: false };
  }

  const inFlight = input.delivery.attemptedAt > staleAttemptBefore;
  return inFlight
    ? {
        inFlight,
        retryAt: new Date(
          input.delivery.attemptedAt.getTime()
            + HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
        ),
      }
    : { inFlight };
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
    input.source !== HOSTED_AI_USAGE_TELEGRAM_NOTICE_DELIVERY_SOURCE
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
    failureCode: string | null;
    failedAt: Date | null;
    groupJoinOutreachId: string | null;
    groupJoinReplyOccurredAt: Date | null;
    id: string;
    lastReceiptAt: Date | null;
    linqChatLookupKey: string | null;
    messageLookupKey: string | null;
    phoneNumberLookupKey: string | null;
    retryAfterAt: Date | null;
    skippedAt: Date | null;
    source: string;
    sourceRef: string | null;
    status: string;
    targetKind: string | null;
    template: string | null;
    updatedAt: Date;
  };
  prisma: HostedLinqDeliveryClient;
  reclaimStalePreProviderAttempt?: boolean;
  returnExistingFailureCode?: boolean;
  source: string;
}): Promise<HostedLinqDeliveryProviderDispatchClaim> {
  if (
    (
      (input.delivery.groupJoinOutreachId ?? null)
        !== input.data.groupJoinOutreachId
      || !datesEqual(
        input.delivery.groupJoinReplyOccurredAt ?? null,
        input.data.groupJoinReplyOccurredAt,
      )
    )
    || (
      isHostedLinqPinnedTargetDeliveryTemplate(input.data.template)
      && (
        input.delivery.linqChatLookupKey !== input.data.linqChatLookupKey
        || input.delivery.phoneNumberLookupKey !== input.data.phoneNumberLookupKey
        || (
          input.data.template === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE
          && input.delivery.source !== input.source
        )
        || (
          input.data.template !== HOSTED_LINQ_GROUP_SETUP_TEMPLATE
          && input.delivery.sourceRef !== input.data.sourceRef
        )
        || input.delivery.targetKind !== input.data.targetKind
        || input.delivery.template !== input.data.template
      )
    )
  ) {
    return {
      claimed: false,
      id: input.delivery.id,
      outcome: "incompatible",
    };
  }

  if (isHostedLinqDeliveryProviderCorrelated(input.delivery)) {
    return {
      claimed: false,
      id: input.delivery.id,
      ...(isHostedLinqPinnedTargetDeliveryTemplate(input.data.template)
        ? { outcome: "completed" as const }
        : {}),
    };
  }

  // Recovery awaits provider correlation before returning, so an uncorrelated
  // row can mean the provider succeeded but the accepted write failed. Its
  // pinned provider idempotency key makes immediate exact replay safe.
  if (
    input.data.template === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE
    && isHostedLinqDeliveryPreProvider(input.delivery)
  ) {
    const updated = await input.prisma.hostedLinqDelivery.updateMany({
      where: {
        acceptedAt: null,
        attemptedAt: input.delivery.attemptedAt,
        deliveredAt: null,
        failedAt: null,
        id: input.delivery.id,
        lastReceiptAt: null,
        linqChatLookupKey: input.delivery.linqChatLookupKey,
        messageLookupKey: null,
        phoneNumberLookupKey: input.delivery.phoneNumberLookupKey,
        skippedAt: null,
        source: input.delivery.source,
        sourceRef: input.delivery.sourceRef,
        status: input.delivery.status,
        targetKind: input.delivery.targetKind,
        template: HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE,
        updatedAt: input.delivery.updatedAt,
      },
      data: {
        ...input.data,
        // This is the authority timestamp proving that the recovery instruction
        // preceded a replacement-line event. Provider-idempotent replay must
        // advance only the existing row version, never this proof.
        attemptedAt: input.delivery.attemptedAt,
        updatedAt: new Date(Math.max(
          input.attemptedAt.getTime(),
          input.delivery.updatedAt.getTime() + 1,
        )),
      },
    });
    return {
      claimed: updated.count === 1,
      id: input.delivery.id,
    };
  }

  const inFlight = resolveHostedLinqDeliveryInFlightState({
    attemptedAt: input.attemptedAt,
    delivery: input.delivery,
  });
  if (inFlight.inFlight) {
    return {
      claimed: false,
      id: input.delivery.id,
      ...(inFlight.retryAt ? { retryAt: inFlight.retryAt } : {}),
    };
  }

  const telegramRetryAfterAt = readHostedLinqTelegramUsageLimitRetryAt(input.delivery);
  if (telegramRetryAfterAt && telegramRetryAfterAt > input.attemptedAt) {
    return {
      claimed: false,
      id: input.delivery.id,
      retryAt: telegramRetryAfterAt,
    };
  }

  const staleAttemptBefore = new Date(
    input.attemptedAt.getTime() - HOSTED_AI_USAGE_LIMIT_NOTICE_CLAIM_STALE_MS,
  );
  const canReclaimStalePreProviderAttempt =
    input.reclaimStalePreProviderAttempt
    ?? input.delivery.source !== HOSTED_AI_USAGE_TELEGRAM_NOTICE_DELIVERY_SOURCE;
  const canReclaimRetryAfterTelegramAttempt =
    telegramRetryAfterAt !== null && telegramRetryAfterAt <= input.attemptedAt;
  const telegramRetryAfterReclaimPredicate = {
    failedAt: { not: null },
    retryAfterAt: {
      lte: input.attemptedAt,
    },
    source: HOSTED_AI_USAGE_TELEGRAM_NOTICE_DELIVERY_SOURCE,
  };
  const terminalPreProviderReclaimPredicates =
    input.delivery.source !== HOSTED_AI_USAGE_TELEGRAM_NOTICE_DELIVERY_SOURCE
      && !(
        input.data.template === "ai_usage_quota"
        && input.delivery.source === HOSTED_AI_USAGE_LINQ_NOTICE_DELIVERY_SOURCE
        && input.source !== HOSTED_AI_USAGE_LINQ_NOTICE_DELIVERY_SOURCE
      )
      ? [
          { failedAt: { not: null } },
          { skippedAt: { not: null } },
          { status: { in: ["failed", "skipped"] } },
        ]
      : canReclaimRetryAfterTelegramAttempt
        ? [telegramRetryAfterReclaimPredicate]
        : [];
  const stalePreProviderReclaimPredicates = canReclaimStalePreProviderAttempt
    ? [
        {
          attemptedAt: {
            lte: staleAttemptBefore,
          },
          status: "attempted",
        },
        // Linq replays this exact period identity through provider idempotency.
        // Telegram has no equivalent replay guarantee and remains ambiguous.
        ...(input.source === HOSTED_AI_USAGE_LINQ_NOTICE_DELIVERY_SOURCE
            && input.data.template === "ai_usage_quota"
          ? [{
              attemptedAt: {
                lte: staleAttemptBefore,
              },
              source: HOSTED_AI_USAGE_LINQ_NOTICE_DELIVERY_SOURCE,
              status: HOSTED_LINQ_DELIVERY_PROVIDER_DISPATCH_STARTED_STATUS,
              template: "ai_usage_quota",
            }]
          : []),
      ]
    : [];
  const reclaimPredicates = [
    ...terminalPreProviderReclaimPredicates,
    ...stalePreProviderReclaimPredicates,
  ];
  if (reclaimPredicates.length === 0) {
    return {
      claimed: false,
      ...(input.returnExistingFailureCode
        ? { failureCode: input.delivery.failureCode }
        : {}),
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

  return {
    claimed: updated.count === 1,
    ...(updated.count === 0 && input.returnExistingFailureCode
      ? { failureCode: input.delivery.failureCode }
      : {}),
    id: input.delivery.id,
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

function buildHostedLinqDeliveryMessageId(
  deliveryId: string,
  ordinal: number,
): string {
  return `hldm_${sha256Hex(`${deliveryId}:${ordinal}`).slice(0, 32)}`;
}

function normalizeHostedLinqProviderMessageIds(
  values: readonly string[] | undefined,
  finalMessageId: string | null | undefined,
): string[] {
  const finalId = normalizeNullable(finalMessageId);
  const output: string[] = [];
  for (const value of values ?? []) {
    const messageId = normalizeNullable(value);
    if (messageId && messageId !== finalId && !output.includes(messageId)) {
      output.push(messageId);
    }
  }
  if (finalId) {
    output.push(finalId);
  }
  return output;
}

function requireHostedLinqMessageLookupKey(messageId: string): string {
  const lookupKey = createHostedLinqMessageLookupKey(messageId);
  if (!lookupKey) {
    throw new TypeError("Hosted Linq provider message id is required.");
  }
  return lookupKey;
}

async function lockHostedLinqDeliveryRow(
  prisma: HostedLinqDeliveryClient,
  deliveryId: string,
): Promise<void> {
  await prisma.$queryRaw`
    select 1
    from "hosted_linq_delivery"
    where "id" = ${deliveryId}
    for update
  `;
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
  groupJoinOutreachId: string | null;
  groupJoinReplyOccurredAt: Date | null;
  idempotencyKey: string | null;
  sourceRef: string | null;
  template: string | null;
}): HostedLinqReopenOnboardingLink | null {
  if (!isHostedLinqInviteSignupDeliveryTemplate(input.template)) {
    return null;
  }

  const parsed = parseHostedLinqInviteSignupEffectId(input.sourceRef)
    ?? parseHostedLinqInviteSignupEffectId(input.idempotencyKey);
  if (!parsed) {
    return null;
  }
  const groupJoinReplyContext =
    input.groupJoinOutreachId && input.groupJoinReplyOccurredAt
      ? {
          outreachId: input.groupJoinOutreachId,
          repliedAt: input.groupJoinReplyOccurredAt.toISOString(),
        }
      : null;
  return {
    ...(groupJoinReplyContext ? { groupJoinReplyContext } : {}),
    memberId: parsed.memberId,
    occurredAt: parsed.dayUtc,
  };
}

async function resolveHostedLinqFailedDeliveryReopenTx(input: {
  groupJoinOutreachId: string | null;
  groupJoinReplyOccurredAt: Date | null;
  idempotencyKey: string | null;
  prisma: HostedLinqDeliveryClient;
  sourceRef: string | null;
  template: string | null;
}): Promise<HostedLinqReopenOnboardingLink | null> {
  const link = resolveHostedLinqReopenOnboardingLink(input);
  if (!link) {
    return null;
  }
  const failedAttempt = parseHostedLinqInviteSignupEffectId(input.sourceRef)
    ?? parseHostedLinqInviteSignupEffectId(input.idempotencyKey);
  if (!failedAttempt) {
    return link;
  }

  // The daily marker is one projection of all generic and group-aware signup
  // deliveries for the member/day. Recompute only the two bounded facts the
  // caller needs after any failed identity. The caller holds the member row
  // lock, so the result is independent of terminal receipt order, including
  // concurrent failures.
  const liveAttemptFacts = await readHostedLinqInviteSignupLiveAttemptsTx({
    dayUtc: failedAttempt.dayUtc,
    memberId: failedAttempt.memberId,
    prisma: input.prisma,
    sourceEventDigest: failedAttempt.sourceEventDigest,
  });
  if (liveAttemptFacts.sameIdentityStillLive) {
    return null;
  }
  if (liveAttemptFacts.anyIdentityLive) {
    return link.groupJoinReplyContext ? link : null;
  }
  return link.groupJoinReplyContext
    ? { ...link, releaseDailySuppression: true }
    : link;
}

export async function readHostedLinqInviteSignupLiveAttemptsTx(input: {
  dayUtc: string;
  memberId: string;
  prisma: HostedLinqDeliveryClient;
  sourceEventDigest?: string | null;
}): Promise<{
  anyIdentityLive: boolean;
  sameIdentityStillLive: boolean;
}> {
  const sourceRefPrefix = buildHostedLinqInviteSignupEffectId({
    memberId: input.memberId,
    occurredAt: input.dayUtc,
  });
  const sourceRefLikePattern = `${escapeHostedLinqSourceRefLikePrefix(
    sourceRefPrefix,
  )}%`;
  const exactIdentitySourceRefs = input.sourceEventDigest === undefined
    ? null
    : Array.from(
      { length: HOSTED_LINQ_INVITE_SIGNUP_MAX_ATTEMPTS_PER_IDENTITY },
      (_, index) => buildHostedLinqInviteSignupEffectId({
        attempt: index + 1,
        memberId: input.memberId,
        occurredAt: input.dayUtc,
        sourceEventDigest: input.sourceEventDigest,
      }),
    );
  const liveInviteSignupDeliveryPredicateSql = Prisma.sql`
    "delivery"."source_ref" IS NOT NULL
      AND "delivery"."template" IN (
        'invite_signup',
        'invite_signup_fallback'
      )
      AND "delivery"."status" IN (
        'attempted',
        'provider_dispatch_started',
        'accepted',
        'delivered'
      )
  `;
  const sameIdentityStillLiveSql = exactIdentitySourceRefs
    ? Prisma.sql`
        EXISTS (
          SELECT 1
          FROM "hosted_linq_delivery" AS "delivery"
          WHERE ${liveInviteSignupDeliveryPredicateSql}
            AND "delivery"."source_ref" IN (
              ${Prisma.join(exactIdentitySourceRefs)}
            )
          LIMIT 1
        )
      `
    : Prisma.sql`FALSE`;
  const rows = await input.prisma.$queryRaw<Array<{
    anyIdentityLive: boolean;
    sameIdentityStillLive: boolean;
  }>>(Prisma.sql`
    SELECT
      ${sameIdentityStillLiveSql} AS "sameIdentityStillLive",
      EXISTS (
        SELECT 1
        FROM "hosted_linq_delivery" AS "delivery"
        WHERE ${liveInviteSignupDeliveryPredicateSql}
          AND "delivery"."source_ref" LIKE ${sourceRefLikePattern}::text ESCAPE '!'
          AND substring(
            "delivery"."source_ref"
            FROM char_length(${sourceRefPrefix}::text) + 1
          ) ~ '^(?::a[2-5]|:e[0-9a-f]{32}(?::a[2-5])?)?$'
        LIMIT 1
      ) AS "anyIdentityLive"
  `);
  return {
    anyIdentityLive: rows[0]?.anyIdentityLive === true,
    sameIdentityStillLive: rows[0]?.sameIdentityStillLive === true,
  };
}

function escapeHostedLinqSourceRefLikePrefix(value: string): string {
  return value.replace(/[!%_]/gu, (character) => `!${character}`);
}

export async function hasHostedLinqInviteSignupLiveDeliveryTx(input: {
  dayUtc: string;
  memberId: string;
  prisma: HostedLinqDeliveryClient;
}): Promise<boolean> {
  const liveAttemptFacts = await readHostedLinqInviteSignupLiveAttemptsTx(input);
  return liveAttemptFacts.anyIdentityLive;
}

function readHostedLinqAcceptedMilestoneStatus(
  status: string | null,
): HostedLinqAcceptedMilestoneStatus {
  return status === "accepted" || status === "delivered" || status === "failed"
    ? status
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
  if (
    input.template === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE
    && parseHostedLinqGroupLineRecoverySourceRef(sourceRef)
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

function isHostedLinqPinnedTargetDeliveryTemplate(
  template: string | null | undefined,
): boolean {
  return isHostedLinqInviteSignupDeliveryTemplate(template)
    || template === HOSTED_LINQ_GROUP_LINE_RECOVERY_TEMPLATE
    || template === HOSTED_LINQ_GROUP_SETUP_TEMPLATE;
}

function assertHostedLinqDeliveryGroupJoinContext(input: {
  groupJoinOutreachId: string | null;
  groupJoinReplyOccurredAt: Date | null;
  template: string | null;
}): void {
  const isSignup = isHostedLinqInviteSignupDeliveryTemplate(input.template);
  if (
    input.groupJoinReplyOccurredAt
    && (!input.groupJoinOutreachId || !isSignup)
  ) {
    throw new TypeError(
      "Hosted Linq group-join reply occurrence requires a related signup delivery.",
    );
  }
  if (isSignup && input.groupJoinOutreachId && !input.groupJoinReplyOccurredAt) {
    throw new TypeError(
      "Hosted Linq group-aware signup delivery requires the exact reply occurrence time.",
    );
  }
}

function datesEqual(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function normalizeNullableDate(
  value: Date | null | undefined,
  label: string,
): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Number.isNaN(value.getTime())) {
    throw new TypeError(`${label} must be valid.`);
  }
  return value;
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
