import type { Prisma, PrismaClient } from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedLinqMessageLookupKey,
  createHostedPhoneLookupKey,
  readHostedPhoneHint,
} from "./contact-privacy";
import {
  upsertHostedLinqLineForPhoneTx,
} from "./linq-line-store";
import {
  sanitizeHostedOnboardingPersistedErrorCode,
  sanitizeHostedOnboardingPersistedErrorMessage,
} from "./http";
import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import { toHostedOnboardingLogIdSuffix } from "./logging";
import { normalizePhoneNumber } from "./phone";
import { generateHostedRandomPrefixedId, sha256Hex } from "../primitives";

type HostedLinqDeliveryClient = PrismaClient | Prisma.TransactionClient;

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
  const idempotencyKey = normalizeNullable(input.idempotencyKey);
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  await ensureHostedLinqDeliveryLineTx({
    observedAt: attemptedAt,
    phoneNumber,
    prisma: input.prisma,
  });
  const phoneNumberLookupKey = createHostedPhoneLookupKey(phoneNumber);
  const data = {
    attemptedAt,
    linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
    phoneNumberHint: phoneNumber ? readHostedPhoneHint(phoneNumber) : null,
    phoneNumberLookupKey,
    source: input.source,
    sourceRef: normalizeNullable(input.sourceRef),
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
  const row = await input.prisma.hostedLinqDelivery.upsert({
    where: { idempotencyKey },
    create: {
      ...data,
      id,
      idempotencyKey,
    },
    update: {
      attemptedAt,
      failureCode: null,
      failureReason: null,
      linqChatLookupKey: data.linqChatLookupKey,
      phoneNumberHint: data.phoneNumberHint,
      phoneNumberLookupKey: data.phoneNumberLookupKey,
      status: "attempted",
      targetKind: data.targetKind,
      template: data.template,
    },
    select: { id: true },
  });
  return row;
}

export async function markHostedLinqDeliveryAcceptedTx(input: {
  acceptedAt?: Date;
  idempotencyKey: string;
  linqChatId?: string | null;
  messageId?: string | null;
  prisma: HostedLinqDeliveryClient;
}): Promise<void> {
  await input.prisma.hostedLinqDelivery.updateMany({
    where: { idempotencyKey: input.idempotencyKey },
    data: {
      acceptedAt: input.acceptedAt ?? new Date(),
      linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
      messageIdSuffix: toHostedOnboardingLogIdSuffix(input.messageId),
      messageLookupKey: createHostedLinqMessageLookupKey(input.messageId),
      status: "accepted",
    },
  });
}

export async function markHostedLinqDeliverySendFailedTx(input: {
  failedAt?: Date;
  failureCode?: string | null;
  failureReason?: string | null;
  idempotencyKey: string;
  prisma: HostedLinqDeliveryClient;
}): Promise<void> {
  await input.prisma.hostedLinqDelivery.updateMany({
    where: { idempotencyKey: input.idempotencyKey },
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
  const idempotencyKey = normalizeNullable(input.idempotencyKey);
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  await ensureHostedLinqDeliveryLineTx({
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
    phoneNumberLookupKey: createHostedPhoneLookupKey(phoneNumber),
    skipReason: input.reason.slice(0, 160),
    skippedAt,
    source: input.source,
    sourceRef: normalizeNullable(input.sourceRef),
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

  return input.prisma.hostedLinqDelivery.upsert({
    where: { idempotencyKey },
    create: {
      ...data,
      id: buildHostedLinqDeliveryId(idempotencyKey),
      idempotencyKey,
    },
    update: data,
    select: { id: true },
  });
}

export async function applyHostedLinqDeliveryReceiptTx(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: HostedLinqDeliveryClient;
}): Promise<{
  advanced: boolean;
  deliveryId: string | null;
}> {
  if (!input.event.messageLookupKey || !input.event.deliveryStatus) {
    return {
      advanced: true,
      deliveryId: null,
    };
  }

  const delivery = await input.prisma.hostedLinqDelivery.findUnique({
    where: {
      messageLookupKey: input.event.messageLookupKey,
    },
    select: {
      id: true,
    },
  });

  if (!delivery) {
    return {
      advanced: true,
      deliveryId: null,
    };
  }

  const updated = await input.prisma.hostedLinqDelivery.updateMany({
    where: {
      id: delivery.id,
      OR: [
        { lastReceiptAt: null },
        { lastReceiptAt: { lt: input.event.providerCreatedAt } },
        {
          lastProviderEventId: null,
          lastReceiptAt: input.event.providerCreatedAt,
        },
        {
          lastProviderEventId: { lt: input.event.eventId },
          lastReceiptAt: input.event.providerCreatedAt,
        },
      ],
    },
    data: buildReceiptUpdate(input.event),
  });
  return {
    advanced: updated.count === 1,
    deliveryId: delivery.id,
  };
}

function buildReceiptUpdate(event: ParsedHostedLinqProviderEvent): Prisma.HostedLinqDeliveryUpdateInput {
  const base = {
    lastProviderEventId: event.eventId,
    lastReceiptAt: event.providerCreatedAt,
    service: event.service,
  } satisfies Prisma.HostedLinqDeliveryUpdateInput;

  if (event.deliveryStatus === "delivered") {
    return {
      ...base,
      deliveredAt: event.providerCreatedAt,
      status: "delivered",
    };
  }

  return {
    ...base,
    failedAt: event.providerCreatedAt,
    failureCode: event.failureCode,
    failureReason: event.failureReason,
    status: "failed",
  };
}

function buildHostedLinqDeliveryId(idempotencyKey: string): string {
  return `hld_${sha256Hex(idempotencyKey).slice(0, 32)}`;
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

async function ensureHostedLinqDeliveryLineTx(input: {
  observedAt: Date;
  phoneNumber: string | null;
  prisma: HostedLinqDeliveryClient;
}): Promise<void> {
  if (!input.phoneNumber) {
    return;
  }

  await upsertHostedLinqLineForPhoneTx({
    observedAt: input.observedAt,
    phoneNumber: input.phoneNumber,
    prisma: input.prisma,
    source: "webhook",
  });
}
