import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedMailboxConsumedItem,
  HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";

import {
  createHostedLinqChatLookupKey,
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
type HostedLinqDeliveryClient = PrismaClient | Prisma.TransactionClient;
const HOSTED_LINQ_PROVIDER_DISPATCH_STALE_ATTEMPT_MS = 15 * 60 * 1000;

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
  source: string;
  sourceRef?: string | null;
  targetKind?: string | null;
  template?: string | null;
}): Promise<{ claimed: boolean; id: string | null }> {
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
    skippedAt: null,
    skipReason: null,
    source: input.source,
    sourceRef: normalizeHostedLinqDeliverySourceRef({
      sourceRef: input.sourceRef,
      template: input.template,
    }),
    status: "attempted",
    targetKind: normalizeNullable(input.targetKind),
    template: normalizeNullable(input.template),
  };
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
    });
  }

  try {
    const created = await input.prisma.hostedLinqDelivery.create({
      data: createData,
      select: { id: true },
    });
    return {
      claimed: true,
      id: created.id,
    };
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
    return claimExistingHostedLinqDeliveryProviderDispatchTx({
      attemptedAt,
      data,
      delivery: concurrent,
      prisma: input.prisma,
    });
  }
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
  const baseData = {
    attemptedAt,
    id: deliveryId,
    idempotencyKey,
    linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
    phoneNumberHint: line.phoneNumberHint,
    phoneNumberLookupKey: line.phoneNumberLookupKey,
    source: "hosted_runtime_linq_delivery",
    sourceRef: createHostedLinqDeliverySourceRefLookupKey(normalizeNullable(input.sourceRef)),
    targetKind: normalizeNullable(input.targetKind),
    template: null,
  };

  return await runHostedLinqDeliveryStoreTransaction(input.prisma, async (prisma) => {
    let acceptedAdvanced = false;
    let deliveryAccepted = false;
    let answeredItemsDeliveryId = deliveryId;
    const answeredMailboxItemIds = acceptedAt
      ? await resolveHostedLinqDeliveryAnsweredMailboxItemIdsTx({
          mailboxItemIds: input.answeredMailboxItemIds ?? [],
          prisma,
          userId: input.userId,
        })
      : [];
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
                status: "accepted",
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
        deliveryAccepted = Boolean(acceptedAt);
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
        });
        answeredItemsDeliveryId = concurrent.id;
        deliveryAccepted = acceptedAdvanced
          || hasHostedLinqDeliveryAcceptedFact(concurrent);
      }
    } else if (acceptedAt) {
      answeredItemsDeliveryId = existing.id;
      deliveryAccepted = hasHostedLinqDeliveryAcceptedFact(existing);
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
      });
      deliveryAccepted = deliveryAccepted || acceptedAdvanced;
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
      });
    }

    if (deliveryAccepted && acceptedAt) {
      await insertHostedLinqDeliveryAnsweredMailboxItemsTx({
        deliveryId: answeredItemsDeliveryId,
        mailboxItemIds: answeredMailboxItemIds,
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
        linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
        messageIdSuffix: toHostedOnboardingLogIdSuffix(input.messageId),
        messageLookupKey: input.messageLookupKey,
        phoneNumberHint: input.line.phoneNumberHint,
        phoneNumberLookupKey: input.line.phoneNumberLookupKey,
        source: "hosted_runtime_linq_delivery",
        sourceRef: createHostedLinqDeliverySourceRefLookupKey(normalizeNullable(input.sourceRef)),
        skippedAt: null,
        skipReason: null,
        status: "accepted",
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

export async function markHostedLinqDeliverySendFailedTx(input: {
  failedAt?: Date;
  failureCode?: string | null;
  failureReason?: string | null;
  idempotencyKey: string;
  prisma: HostedLinqDeliveryClient;
}): Promise<void> {
  const idempotencyKey = createHostedLinqDeliveryIdempotencyLookupKey(input.idempotencyKey);
  if (!idempotencyKey) {
    return;
  }
  await input.prisma.hostedLinqDelivery.updateMany({
    where: {
      acceptedAt: null,
      deliveredAt: null,
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
      status: "failed",
    },
  });
}

export async function markHostedLinqDeliverySkippedTx(input: {
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
    failureCode: "HOSTED_LINQ_RECIPIENT_RECENT_REPLY_REQUIRED",
    failureReason: "Linq/iMessage send skipped because the recipient has not replied within the allowed window.",
    linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
    phoneNumberHint: phoneNumber ? readHostedPhoneHint(phoneNumber) : null,
    phoneNumberLookupKey,
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

export async function readHostedLinqAcceptedDeliveryConsumedItemsForMailboxItems(input: {
  items: readonly HostedMailboxItem[];
  prisma: HostedLinqDeliveryClient;
}): Promise<HostedMailboxConsumedItem[]> {
  const candidates = input.items.filter((item) =>
    item.kind === "conversation.message"
    && item.lane === "conversation"
  );
  if (candidates.length === 0) {
    return [];
  }
  const itemIds = candidates.map((item) => item.id);
  const rows = await input.prisma.hostedLinqDeliveryAnsweredMailboxItem.findMany({
    where: {
      mailboxItemId: {
        in: itemIds,
      },
    },
    select: {
      mailboxItemId: true,
    },
  });
  const consumedItemIds = new Set<string>();
  for (const row of rows) {
    const mailboxItemId = normalizeNullable(row.mailboxItemId ?? null);
    if (!mailboxItemId) {
      continue;
    }
    consumedItemIds.add(mailboxItemId);
  }

  return candidates
    .filter((item) => consumedItemIds.has(item.id))
    .map((item) => ({
      itemId: item.id,
      lane: "conversation",
      laneSeq: item.laneSeq,
    }));
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

async function resolveHostedLinqDeliveryAnsweredMailboxItemIdsTx(input: {
  mailboxItemIds: readonly string[];
  prisma: HostedLinqDeliveryClient;
  userId: string;
}): Promise<string[]> {
  const itemIds = normalizeHostedLinqDeliveryAnsweredMailboxItemIds(
    input.mailboxItemIds,
  );
  if (itemIds.length === 0) {
    return [];
  }
  const rows = await input.prisma.hostedMailboxItem.findMany({
    where: {
      id: { in: itemIds },
      kind: "conversation.message",
      lane: "conversation",
      userId: input.userId,
    },
    select: {
      id: true,
    },
  });

  const foundItemIds = new Set(rows.map((item) => item.id));
  return itemIds.filter((itemId) => foundItemIds.has(itemId));
}

async function insertHostedLinqDeliveryAnsweredMailboxItemsTx(input: {
  deliveryId: string;
  mailboxItemIds: readonly string[];
  prisma: HostedLinqDeliveryClient;
}): Promise<void> {
  const itemIds = normalizeHostedLinqDeliveryAnsweredMailboxItemIds(
    input.mailboxItemIds,
  );
  if (itemIds.length === 0) {
    return;
  }
  await input.prisma.hostedLinqDeliveryAnsweredMailboxItem.createMany({
    data: itemIds.map((mailboxItemId) => ({
      deliveryId: input.deliveryId,
      mailboxItemId,
    })),
    skipDuplicates: true,
  });
}

function normalizeHostedLinqDeliveryAnsweredMailboxItemIds(
  value: readonly string[],
): string[] {
  const seen = new Set<string>();
  const itemIds: string[] = [];
  for (const candidate of value) {
    const itemId = normalizeNullable(candidate);
    if (!itemId || seen.has(itemId)) {
      continue;
    }
    seen.add(itemId);
    itemIds.push(itemId);
  }
  return itemIds;
}

const hostedLinqDeliveryLifecycleSelect = {
  acceptedAt: true,
  attemptedAt: true,
  deliveredAt: true,
  failedAt: true,
  id: true,
  lastReceiptAt: true,
  messageLookupKey: true,
  phoneNumberLookupKey: true,
  skippedAt: true,
  status: true,
} satisfies Prisma.HostedLinqDeliverySelect;

function hasHostedLinqDeliveryAcceptedFact(delivery: {
  acceptedAt: Date | null;
}): boolean {
  return delivery.acceptedAt !== null;
}

async function claimExistingHostedLinqDeliveryProviderDispatchTx(input: {
  attemptedAt: Date;
  data: Prisma.HostedLinqDeliveryUpdateInput;
  delivery: {
    acceptedAt: Date | null;
    attemptedAt: Date;
    deliveredAt: Date | null;
    failedAt: Date | null;
    id: string;
    lastReceiptAt: Date | null;
    messageLookupKey: string | null;
    skippedAt: Date | null;
    status: string;
  };
  prisma: HostedLinqDeliveryClient;
}): Promise<{ claimed: boolean; id: string | null }> {
  if (isHostedLinqDeliveryProviderCorrelated(input.delivery)) {
    return {
      claimed: false,
      id: input.delivery.id,
    };
  }

  const staleAttemptBefore = new Date(
    input.attemptedAt.getTime() - HOSTED_LINQ_PROVIDER_DISPATCH_STALE_ATTEMPT_MS,
  );
  const updated = await input.prisma.hostedLinqDelivery.updateMany({
    where: {
      acceptedAt: null,
      deliveredAt: null,
      id: input.delivery.id,
      lastReceiptAt: null,
      messageLookupKey: null,
      OR: [
        { failedAt: { not: null } },
        { skippedAt: { not: null } },
        { status: { in: ["failed", "skipped"] } },
        {
          attemptedAt: {
            lte: staleAttemptBefore,
          },
          status: "attempted",
        },
      ],
    },
    data: input.data,
  });

  return {
    claimed: updated.count === 1,
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
