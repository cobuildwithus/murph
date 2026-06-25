import type { Prisma, PrismaClient } from "@prisma/client";

import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import {
  createHostedPhoneLookupKey,
  readHostedPhoneHint,
} from "./contact-privacy";
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
      phoneNumber: normalizedPhoneNumber,
      phoneNumberHint: readHostedPhoneHint(normalizedPhoneNumber),
      phoneNumberLookupKey: lookupKey,
      providerSeenAt: input.source === "provider" ? input.observedAt : null,
      source: input.source,
    },
    update: {
      ...(input.activeMemberLimit === undefined ? {} : { activeMemberLimit: input.activeMemberLimit }),
      ...(input.source === "configured" ? { configuredAt: input.observedAt } : {}),
      ...(input.source === "provider" ? { providerSeenAt: input.observedAt } : {}),
      phoneNumber: normalizedPhoneNumber,
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
}): Promise<void> {
  const lineLookupKey = input.lineLookupKey ?? await ensureHostedLinqLineForProviderEventTx(input);
  if (!lineLookupKey) {
    return;
  }

  switch (input.event.eventType) {
    case "message.received":
      await projectMessageReceived(input.prisma, lineLookupKey, input.event);
      return;
    case "message.delivered":
      await projectMessageDelivered(input.prisma, lineLookupKey, input.event);
      return;
    case "message.failed":
      await projectMessageFailed(input.prisma, lineLookupKey, input.event);
      return;
    case "phone_number.status_updated":
      await projectPhoneNumberStatusUpdated(input.prisma, lineLookupKey, input.event);
      return;
  }
}

export async function ensureHostedLinqLineForProviderEventTx(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: HostedLinqLineClient;
}): Promise<string | null> {
  if (!input.event.phoneNumberLookupKey) {
    return null;
  }

  if (input.event.phoneNumberRole === "line" && input.event.phoneNumber) {
    await upsertHostedLinqLineForPhoneTx({
      observedAt: input.event.providerCreatedAt,
      phoneNumber: input.event.phoneNumber,
      prisma: input.prisma,
      source: "webhook",
    });
    return input.event.phoneNumberLookupKey;
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
): Promise<void> {
  if (event.direction === "outbound") {
    await prisma.hostedLinqLine.update({
      where: { phoneNumberLookupKey },
      data: {
        lastOutboundAt: event.providerCreatedAt,
        totalOutboundCount: { increment: 1 },
      },
    });
    return;
  }

  await prisma.hostedLinqLine.update({
    where: { phoneNumberLookupKey },
    data: {
      lastInboundAt: event.providerCreatedAt,
      totalInboundCount: { increment: 1 },
    },
  });
}

async function projectMessageDelivered(
  prisma: HostedLinqLineClient,
  phoneNumberLookupKey: string,
  event: ParsedHostedLinqProviderEvent,
): Promise<void> {
  await prisma.hostedLinqLine.update({
    where: { phoneNumberLookupKey },
    data: {
      consecutiveFailures: 0,
      healthStatus: "healthy",
      lastDeliveredAt: event.providerCreatedAt,
      totalDeliveredCount: { increment: 1 },
    },
  });
}

async function projectMessageFailed(
  prisma: HostedLinqLineClient,
  phoneNumberLookupKey: string,
  event: ParsedHostedLinqProviderEvent,
): Promise<void> {
  await prisma.hostedLinqLine.update({
    where: { phoneNumberLookupKey },
    data: {
      consecutiveFailures: { increment: 1 },
      healthStatus: "warning",
      lastFailedAt: event.providerCreatedAt,
      lastFailureCode: event.failureCode,
      lastFailureReason: event.failureReason,
      totalFailedCount: { increment: 1 },
    },
  });
}

async function projectPhoneNumberStatusUpdated(
  prisma: HostedLinqLineClient,
  phoneNumberLookupKey: string,
  event: ParsedHostedLinqProviderEvent,
): Promise<void> {
  const healthStatus = classifyHostedLinqProviderStatus(event.providerStatus);
  const egressPolicy = deriveHostedLinqEgressPolicy(event.providerStatus);
  await prisma.hostedLinqLine.update({
    where: { phoneNumberLookupKey },
    data: {
      ...(egressPolicy ? { egressPolicy } : {}),
      healthStatus,
      lastStatusEventId: event.eventId,
      providerReason: event.providerReason,
      providerStatus: event.providerStatus,
      providerUpdatedAt: event.providerCreatedAt,
    },
  });
}

function classifyHostedLinqProviderStatus(value: string | null): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (["active", "healthy", "ok", "ready"].includes(normalized)) {
    return "healthy";
  }
  if (/flagged|blocked|disabled|suspended|banned/u.test(normalized)) {
    return "unhealthy";
  }
  if (/degraded|warning|limited|throttled/u.test(normalized)) {
    return "degraded";
  }
  return "unknown";
}

function deriveHostedLinqEgressPolicy(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (/flagged|blocked|disabled|suspended|banned/u.test(normalized)) {
    return "disabled";
  }
  if (/degraded|warning|limited|throttled/u.test(normalized)) {
    return "avoid_new_assignments";
  }
  return null;
}
