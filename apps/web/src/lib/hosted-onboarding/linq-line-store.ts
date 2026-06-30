import type { Prisma, PrismaClient } from "@prisma/client";

import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import {
  createHostedPhoneLookupKey,
  readHostedPhoneHint,
} from "./contact-privacy";
import {
  type HostedLinqProviderEventProgress,
  createHostedLinqProviderEventProgress,
} from "./linq-provider-event-progress";
import { normalizePhoneNumber } from "./phone";

type HostedLinqLineClient = PrismaClient | Prisma.TransactionClient;

export async function upsertHostedLinqLineForPhoneTx(input: {
  activeMemberLimit?: number | null;
  observedAt: Date;
  phoneNumber: string;
  prisma: HostedLinqLineClient;
  source: "configured" | "provider" | "webhook";
}) {
  const normalizedPhoneNumber = normalizePhoneNumber(input.phoneNumber);
  const lookupKey = createHostedPhoneLookupKey(normalizedPhoneNumber);

  if (!normalizedPhoneNumber || !lookupKey) {
    throw new TypeError("Hosted Linq line upsert requires a valid phone number.");
  }

  return input.prisma.hostedLinqLine.upsert({
    where: {
      phoneNumberLookupKey: lookupKey,
    },
    create: {
      assignmentWeight: 100,
      ...(input.activeMemberLimit === undefined ? {} : { activeMemberLimit: input.activeMemberLimit }),
      configuredAt: input.source === "configured" ? input.observedAt : null,
      egressPolicy: "enabled",
      healthStatus: "unknown",
      phoneNumberHint: readHostedPhoneHint(normalizedPhoneNumber),
      phoneNumberLookupKey: lookupKey,
      providerSeenAt: input.source === "provider" ? input.observedAt : null,
      source: input.source,
    },
    update: {
      ...(input.activeMemberLimit === undefined ? {} : { activeMemberLimit: input.activeMemberLimit }),
      ...(input.source === "configured" ? { configuredAt: input.observedAt } : {}),
      ...(input.source === "provider" ? { providerSeenAt: input.observedAt } : {}),
      phoneNumberHint: readHostedPhoneHint(normalizedPhoneNumber),
      ...(input.source === "webhook" ? {} : { source: input.source }),
    },
  });
}

export async function syncHostedLinqConfiguredLinesTx(input: {
  activeMemberLimit: number | null;
  observedAt?: Date;
  phoneNumbers: readonly string[];
  prisma: HostedLinqLineClient;
}): Promise<void> {
  const observedAt = input.observedAt ?? new Date();
  for (const phoneNumber of input.phoneNumbers) {
    await upsertHostedLinqLineForPhoneTx({
      activeMemberLimit: input.activeMemberLimit,
      observedAt,
      phoneNumber,
      prisma: input.prisma,
      source: "configured",
    });
  }
}

export async function projectHostedLinqLineForProviderEventTx(input: {
  event: ParsedHostedLinqProviderEvent;
  lineLookupKey?: string | null;
  prisma: HostedLinqLineClient;
}): Promise<boolean> {
  const lineLookupKey = input.lineLookupKey ?? await ensureHostedLinqLineForProviderEventTx(input);
  if (!lineLookupKey) {
    return false;
  }

  switch (input.event.eventType) {
    case "message.received":
      return projectMessageReceived(input.prisma, lineLookupKey, input.event);
    case "message.delivered":
      return projectMessageDelivered(input.prisma, lineLookupKey, input.event);
    case "message.failed":
      return projectMessageFailed(input.prisma, lineLookupKey, input.event);
    case "phone_number.status_updated":
      return projectPhoneNumberStatusUpdated(input.prisma, lineLookupKey, input.event);
  }
}

export async function projectHostedLinqLineForDeliveryReceiptTx(input: {
  deliveryStatus: "delivered" | "failed";
  eventId: string;
  failureCode: string | null;
  failureReason: string | null;
  lineLookupKey: string;
  prisma: HostedLinqLineClient;
  providerCreatedAt: Date;
}): Promise<boolean> {
  if (input.deliveryStatus === "delivered") {
    return projectMessageDelivered(input.prisma, input.lineLookupKey, input);
  }

  return projectMessageFailed(input.prisma, input.lineLookupKey, input);
}

export async function ensureHostedLinqLineForProviderEventTx(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: HostedLinqLineClient;
}): Promise<string | null> {
  if (!input.event.phoneNumberLookupKey) {
    return null;
  }

  if (input.event.phoneNumberRole === "line" && input.event.phoneNumber) {
    const line = await upsertHostedLinqLineForPhoneTx({
      observedAt: input.event.providerCreatedAt,
      phoneNumber: input.event.phoneNumber,
      prisma: input.prisma,
      source: "webhook",
    });
    return line.phoneNumberLookupKey;
  }

  const existing = await input.prisma.hostedLinqLine.findUnique({
    where: {
      phoneNumberLookupKey: input.event.phoneNumberLookupKey,
    },
    select: {
      phoneNumberLookupKey: true,
    },
  });

  return existing?.phoneNumberLookupKey ?? null;
}

async function projectMessageReceived(
  prisma: HostedLinqLineClient,
  phoneNumberLookupKey: string,
  event: ParsedHostedLinqProviderEvent,
): Promise<boolean> {
  if (event.direction === "outbound") {
    await prisma.hostedLinqLine.update({
      where: { phoneNumberLookupKey },
      data: {
        totalOutboundCount: { increment: 1 },
      },
    });
    const updated = await prisma.hostedLinqLine.updateMany({
      where: {
        phoneNumberLookupKey,
        OR: [
          { lastOutboundAt: null },
          { lastOutboundAt: { lt: event.providerCreatedAt } },
        ],
      },
      data: {
        lastOutboundAt: event.providerCreatedAt,
      },
    });
    return updated.count === 1;
  }

  await prisma.hostedLinqLine.update({
    where: { phoneNumberLookupKey },
    data: {
      totalInboundCount: { increment: 1 },
    },
  });
  const updated = await prisma.hostedLinqLine.updateMany({
    where: {
      phoneNumberLookupKey,
      OR: [
        { lastInboundAt: null },
        { lastInboundAt: { lt: event.providerCreatedAt } },
      ],
    },
    data: {
      lastInboundAt: event.providerCreatedAt,
    },
  });
  return updated.count === 1;
}

async function projectMessageDelivered(
  prisma: HostedLinqLineClient,
  phoneNumberLookupKey: string,
  event: Pick<ParsedHostedLinqProviderEvent, "eventId" | "providerCreatedAt">,
): Promise<boolean> {
  const progress = createHostedLinqProviderEventProgress(event);
  const updated = await prisma.hostedLinqLine.updateMany({
    where: buildMessageReceiptLineProjectionWhere(phoneNumberLookupKey, progress),
    data: {
      consecutiveFailures: 0,
      healthStatus: "healthy",
      lastDeliveredAt: event.providerCreatedAt,
      lastReceiptAt: event.providerCreatedAt,
      lastReceiptEventId: progress.eventLookupKey,
      totalDeliveredCount: { increment: 1 },
    },
  });
  return updated.count === 1;
}

async function projectMessageFailed(
  prisma: HostedLinqLineClient,
  phoneNumberLookupKey: string,
  event: Pick<
    ParsedHostedLinqProviderEvent,
    "eventId" | "failureCode" | "failureReason" | "providerCreatedAt"
  >,
): Promise<boolean> {
  const progress = createHostedLinqProviderEventProgress(event);
  const updated = await prisma.hostedLinqLine.updateMany({
    where: buildMessageReceiptLineProjectionWhere(phoneNumberLookupKey, progress),
    data: {
      consecutiveFailures: { increment: 1 },
      healthStatus: "warning",
      lastFailedAt: event.providerCreatedAt,
      lastFailureCode: event.failureCode,
      lastFailureReason: event.failureReason,
      lastReceiptAt: event.providerCreatedAt,
      lastReceiptEventId: progress.eventLookupKey,
      totalFailedCount: { increment: 1 },
    },
  });
  return updated.count === 1;
}

async function projectPhoneNumberStatusUpdated(
  prisma: HostedLinqLineClient,
  phoneNumberLookupKey: string,
  event: ParsedHostedLinqProviderEvent,
): Promise<boolean> {
  const healthStatus = classifyHostedLinqProviderStatus(event.providerStatus);
  const egressPolicy = deriveHostedLinqEgressPolicy(event.providerStatus);
  const progress = createHostedLinqProviderEventProgress({
    eventId: event.eventId,
    providerCreatedAt: event.providerCreatedAt,
    rank: rankHostedLinqLineStatusProgress(event.providerStatus),
  });
  const updated = await prisma.hostedLinqLine.updateMany({
    where: buildPhoneNumberStatusProjectionWhere(phoneNumberLookupKey, progress),
    data: {
      ...(egressPolicy ? { egressPolicy } : {}),
      healthStatus,
      lastStatusEventId: progress.eventLookupKey,
      providerReason: event.providerReason,
      providerStatus: event.providerStatus,
      providerUpdatedAt: event.providerCreatedAt,
    },
  });
  return updated.count === 1;
}

function buildMessageReceiptLineProjectionWhere(
  phoneNumberLookupKey: string,
  progress: HostedLinqProviderEventProgress,
): Prisma.HostedLinqLineWhereInput {
  const orderingWhere: Prisma.HostedLinqLineWhereInput[] = [
    {
      lastReceiptAt: null,
    },
    {
      lastReceiptAt: {
        lt: progress.providerCreatedAt,
      },
    },
  ];

  orderingWhere.push({
    lastReceiptAt: progress.providerCreatedAt,
    OR: [
      { lastReceiptEventId: null },
      { lastReceiptEventId: { lt: progress.eventLookupKey } },
    ],
  });

  return {
    phoneNumberLookupKey,
    OR: orderingWhere,
  };
}

function buildPhoneNumberStatusProjectionWhere(
  phoneNumberLookupKey: string,
  progress: HostedLinqProviderEventProgress,
): Prisma.HostedLinqLineWhereInput {
  return {
    phoneNumberLookupKey,
    OR: [
      {
        providerUpdatedAt: null,
      },
      {
        providerUpdatedAt: {
          lt: progress.providerCreatedAt,
        },
      },
      ...buildSameTimestampStatusProjectionWhere(progress),
    ],
  };
}

function buildSameTimestampStatusProjectionWhere(
  progress: HostedLinqProviderEventProgress,
): Prisma.HostedLinqLineWhereInput[] {
  const sameTimestamp = progress.providerCreatedAt;
  if (progress.rank === 2) {
    return [
      {
        egressPolicy: { not: "disabled" },
        providerUpdatedAt: sameTimestamp,
      },
      {
        egressPolicy: "disabled",
        providerUpdatedAt: sameTimestamp,
        OR: [
          { lastStatusEventId: null },
          { lastStatusEventId: { lt: progress.eventLookupKey } },
        ],
      },
    ];
  }

  if (progress.rank === 1) {
    return [
      {
        egressPolicy: { notIn: ["disabled", "avoid_new_assignments"] },
        providerUpdatedAt: sameTimestamp,
      },
      {
        egressPolicy: "avoid_new_assignments",
        providerUpdatedAt: sameTimestamp,
        OR: [
          { lastStatusEventId: null },
          { lastStatusEventId: { lt: progress.eventLookupKey } },
        ],
      },
    ];
  }

  return [
    {
      egressPolicy: { notIn: ["disabled", "avoid_new_assignments"] },
      providerUpdatedAt: sameTimestamp,
      OR: [
        { lastStatusEventId: null },
        { lastStatusEventId: { lt: progress.eventLookupKey } },
      ],
    },
  ];
}

function classifyHostedLinqProviderStatus(value: string | null): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (["active", "healthy", "ok", "ready"].includes(normalized)) {
    return "healthy";
  }
  if (/critical|flagged|blocked|disabled|suspended|banned/u.test(normalized)) {
    return "unhealthy";
  }
  if (/at_risk|at-risk|degraded|warning|limited|throttled/u.test(normalized)) {
    return "degraded";
  }
  return "unknown";
}

function deriveHostedLinqEgressPolicy(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (/critical|flagged|blocked|disabled|suspended|banned/u.test(normalized)) {
    return "disabled";
  }
  if (/at_risk|at-risk|degraded|warning|limited|throttled/u.test(normalized)) {
    return "avoid_new_assignments";
  }
  return null;
}

function rankHostedLinqLineStatusProgress(value: string | null): number {
  const egressPolicy = deriveHostedLinqEgressPolicy(value);
  if (egressPolicy === "disabled") {
    return 2;
  }
  if (egressPolicy === "avoid_new_assignments") {
    return 1;
  }
  return 0;
}
