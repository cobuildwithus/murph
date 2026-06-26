import type { Prisma, PrismaClient } from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
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
type HostedLinqDeliveryReceiptData = {
  deliveryStatus: "delivered" | "failed";
  eventId: string;
  failureCode: string | null;
  failureReason: string | null;
  providerCreatedAt: Date;
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
  const idempotencyKey = normalizeNullable(input.idempotencyKey);
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
      linqChatLookupKey: data.linqChatLookupKey,
      phoneNumberHint: data.phoneNumberHint,
      phoneNumberLookupKey: data.phoneNumberLookupKey,
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
  const messageLookupKey = createHostedLinqMessageLookupKey(input.messageId);
  const messageLookupKeyCandidates = createHostedLinqMessageLookupKeyReadCandidates(input.messageId);
  await runHostedLinqDeliveryStoreTransaction(input.prisma, async (prisma) => {
    const updated = await prisma.hostedLinqDelivery.updateMany({
      where: {
        deliveredAt: null,
        failedAt: null,
        idempotencyKey: input.idempotencyKey,
        skippedAt: null,
        OR: [
          { messageLookupKey: null },
          ...(messageLookupKey ? [{ messageLookupKey }] : []),
        ],
      },
      data: {
        acceptedAt: input.acceptedAt ?? new Date(),
        linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId),
        messageIdSuffix: toHostedOnboardingLogIdSuffix(input.messageId),
        messageLookupKey,
        status: "accepted",
      },
    });
    if (updated.count !== 1) {
      return;
    }

    await applyLatestHostedLinqDeliveryReceiptForAcceptedMessageTx({
      idempotencyKey: input.idempotencyKey,
      messageLookupKeyCandidates,
      messageLookupKey,
      prisma,
    });
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
    where: {
      acceptedAt: null,
      deliveredAt: null,
      idempotencyKey: input.idempotencyKey,
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
  const idempotencyKey = normalizeNullable(input.idempotencyKey);
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

  const existing = await input.prisma.hostedLinqDelivery.findUnique({
    where: { idempotencyKey },
    select: {
      acceptedAt: true,
      deliveredAt: true,
      failedAt: true,
      id: true,
      lastReceiptAt: true,
      messageLookupKey: true,
      skippedAt: true,
      status: true,
    },
  });

  if (existing) {
    if (isHostedLinqDeliveryLifecycleFinal(existing)) {
      return { id: existing.id };
    }

    return input.prisma.hostedLinqDelivery.update({
      where: { id: existing.id },
      data,
      select: { id: true },
    });
  }

  return input.prisma.hostedLinqDelivery.create({
    data: {
      ...data,
      id: buildHostedLinqDeliveryId(idempotencyKey),
      idempotencyKey,
    },
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
      OR: buildReceiptOrderingWhere(input.event),
    },
    data: buildReceiptUpdate(input.event),
  });
  return {
    advanced: updated.count === 1,
    deliveryId: delivery.id,
  };
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
  const base = {
    lastProviderEventId: receipt.eventId,
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
}): Promise<void> {
  if (!input.messageLookupKey) {
    return;
  }
  const messageLookupKeys = input.messageLookupKeyCandidates && input.messageLookupKeyCandidates.length > 0
    ? [...input.messageLookupKeyCandidates]
    : [input.messageLookupKey];

  const receipt = await input.prisma.hostedLinqProviderEvent.findFirst({
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
      providerCreatedAt: true,
      service: true,
    },
  });

  if (!isHostedLinqTerminalReceiptData(receipt)) {
    return;
  }

  await input.prisma.hostedLinqDelivery.updateMany({
    where: {
      idempotencyKey: input.idempotencyKey,
      OR: buildReceiptOrderingWhere(receipt),
    },
    data: buildReceiptUpdateFromData(receipt),
  });
}

function buildReceiptOrderingWhere(
  receipt: Pick<HostedLinqDeliveryReceiptData, "eventId" | "providerCreatedAt">,
): Prisma.HostedLinqDeliveryWhereInput[] {
  return [
    { lastReceiptAt: null },
    { lastReceiptAt: { lt: receipt.providerCreatedAt } },
    {
      lastProviderEventId: null,
      lastReceiptAt: receipt.providerCreatedAt,
    },
    {
      lastProviderEventId: { lt: receipt.eventId },
      lastReceiptAt: receipt.providerCreatedAt,
    },
  ];
}

function isHostedLinqTerminalReceiptData(
  value: {
    deliveryStatus: string | null;
    eventId: string;
    failureCode: string | null;
    failureReason: string | null;
    providerCreatedAt: Date;
    service: string | null;
  } | null,
): value is HostedLinqDeliveryReceiptData {
  return value?.deliveryStatus === "delivered" || value?.deliveryStatus === "failed";
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
