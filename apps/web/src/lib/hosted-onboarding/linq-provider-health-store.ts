import type { Prisma, PrismaClient } from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedLinqChatLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  createHostedLinqProviderEventLookupKey,
} from "./linq-observability-identifiers";
import {
  parseHostedLinqChatHealthStatus,
  parseHostedLinqLineReputationStatus,
  parseHostedLinqLineServiceStatus,
  type HostedLinqChatHealthStatus,
} from "./linq-provider-status";
import { normalizeNullableString } from "./shared";

type HostedLinqProviderHealthClient = PrismaClient | Prisma.TransactionClient;

export type HostedLinqChatHealthSnapshot = {
  linqChatLookupKey: string;
  phoneNumberLookupKey: string | null;
  providerObservedAt: Date;
  providerStatus: HostedLinqChatHealthStatus;
  providerUpdatedAt: Date;
};

export async function projectHostedLinqLineProviderStateTx(input: {
  eventId?: string | null;
  observedAt?: Date;
  phoneNumberLookupKey: string;
  prisma: HostedLinqProviderHealthClient;
  providerUpdatedAt?: Date | null;
  reputationStatus?: unknown;
  serviceStatus?: unknown;
}): Promise<boolean> {
  const phoneNumberLookupKey = normalizeNullableString(input.phoneNumberLookupKey);
  const reputationStatusSupplied = input.reputationStatus !== undefined;
  const serviceStatusSupplied = input.serviceStatus !== undefined;
  const serviceStatus = parseHostedLinqLineServiceStatus(input.serviceStatus);
  const reputationStatus = parseHostedLinqLineReputationStatus(input.reputationStatus);
  if (
    !phoneNumberLookupKey
    || (!serviceStatusSupplied && !reputationStatusSupplied)
  ) {
    return false;
  }

  const providerObservedAt = input.observedAt ?? new Date();
  const providerUpdatedAt = input.providerUpdatedAt ?? providerObservedAt;
  const lastStatusEventId = input.eventId
    ? createHostedLinqProviderEventLookupKey(input.eventId)
    : null;
  const sameTimestampWhere: Prisma.HostedLinqLineWhereInput[] =
    lastStatusEventId
      ? [
          {
            providerUpdatedAt,
            OR: [
              { lastStatusEventId: null },
              { lastStatusEventId: { lt: lastStatusEventId } },
            ],
          },
        ]
      : [];
  const updated = await input.prisma.hostedLinqLine.updateMany({
    data: {
      lastStatusEventId,
      providerLastSeenAt: providerObservedAt,
      providerSeenAt: providerObservedAt,
      providerUpdatedAt,
      ...(reputationStatusSupplied
        ? { providerReputationStatus: reputationStatus }
        : {}),
      ...(serviceStatusSupplied
        ? { providerServiceStatus: serviceStatus }
        : {}),
    },
    where: {
      phoneNumberLookupKey,
      OR: [
        { providerUpdatedAt: null },
        { providerUpdatedAt: { lt: providerUpdatedAt } },
        ...sameTimestampWhere,
      ],
    },
  });
  return updated.count === 1;
}

export async function projectHostedLinqChatHealthTx(input: {
  chatId: string | null | undefined;
  observedAt?: Date;
  phoneNumberLookupKey?: string | null;
  prisma: HostedLinqProviderHealthClient;
  providerStatus: unknown;
  providerUpdatedAt: Date;
  isGroup?: boolean | null;
  service?: string | null;
}): Promise<boolean> {
  const currentLookupKey = createHostedLinqChatLookupKey(input.chatId);
  const lookupKeyCandidates = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  const providerStatus = parseHostedLinqChatHealthStatus(input.providerStatus);
  if (
    !currentLookupKey
    || lookupKeyCandidates.length === 0
    || !providerStatus
    || Number.isNaN(input.providerUpdatedAt.getTime())
  ) {
    return false;
  }

  const existing = await input.prisma.hostedLinqChatHealth.findMany({
    select: { linqChatLookupKey: true },
    where: {
      linqChatLookupKey: { in: lookupKeyCandidates },
    },
  });
  const existingKeys = new Set(existing.map((row) => row.linqChatLookupKey));
  const linqChatLookupKey = existingKeys.has(currentLookupKey)
    ? currentLookupKey
    : lookupKeyCandidates.find((candidate) => existingKeys.has(candidate))
      ?? currentLookupKey;
  const providerObservedAt = input.observedAt ?? new Date();
  const phoneNumberLookupKeySupplied =
    input.phoneNumberLookupKey !== undefined;
  const phoneNumberLookupKey = normalizeNullableString(
    input.phoneNumberLookupKey ?? null,
  );
  if (existingKeys.size === 0) {
    const created = await input.prisma.hostedLinqChatHealth.createMany({
      data: {
        linqChatLookupKey: currentLookupKey,
        phoneNumberLookupKey,
        providerObservedAt,
        providerStatus,
        providerUpdatedAt: input.providerUpdatedAt,
        isGroup: input.isGroup ?? null,
        service: normalizeNullableString(input.service ?? null),
      } satisfies Prisma.HostedLinqChatHealthCreateManyInput,
      skipDuplicates: true,
    });
    if (created.count === 1) {
      return true;
    }
  }

  const updated = await input.prisma.hostedLinqChatHealth.updateMany({
    data: {
      ...(linqChatLookupKey !== currentLookupKey
        ? { linqChatLookupKey: currentLookupKey }
        : {}),
      ...(phoneNumberLookupKeySupplied ? { phoneNumberLookupKey } : {}),
      providerObservedAt,
      providerStatus,
      providerUpdatedAt: input.providerUpdatedAt,
      ...(input.isGroup === undefined ? {} : { isGroup: input.isGroup }),
      ...(input.service === undefined
        ? {}
        : { service: normalizeNullableString(input.service) }),
    },
    where: {
      linqChatLookupKey,
      providerUpdatedAt: { lte: input.providerUpdatedAt },
    },
  });
  return updated.count === 1;
}

export async function readHostedLinqChatHealth(input: {
  chatId: string | null | undefined;
  prisma: HostedLinqProviderHealthClient;
}): Promise<HostedLinqChatHealthSnapshot | null> {
  const lookupKeyCandidates = createHostedLinqChatLookupKeyReadCandidates(input.chatId);
  if (lookupKeyCandidates.length === 0) {
    return null;
  }

  const state = await input.prisma.hostedLinqChatHealth.findFirst({
    orderBy: [
      { providerUpdatedAt: "desc" },
      { providerObservedAt: "desc" },
    ],
    where: {
      linqChatLookupKey: { in: lookupKeyCandidates },
    },
  });
  const providerStatus = parseHostedLinqChatHealthStatus(state?.providerStatus);
  if (!state || !providerStatus) {
    return null;
  }
  return {
    linqChatLookupKey: state.linqChatLookupKey,
    phoneNumberLookupKey: state.phoneNumberLookupKey,
    providerObservedAt: state.providerObservedAt,
    providerStatus,
    providerUpdatedAt: state.providerUpdatedAt,
  };
}
