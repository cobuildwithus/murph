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
  type HostedLinqLineReputationStatus,
  type HostedLinqLineServiceStatus,
} from "./linq-provider-status";
import { normalizeNullableString } from "./shared";

type HostedLinqProviderHealthClient = PrismaClient | Prisma.TransactionClient;

export type HostedLinqLineProviderStateSnapshot = {
  lastStatusEventId: string | null;
  phoneNumberLookupKey: string;
  providerObservedAt: Date;
  providerUpdatedAt: Date | null;
  reputationStatus: HostedLinqLineReputationStatus | null;
  serviceStatus: HostedLinqLineServiceStatus | null;
};

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
  const serviceStatus = parseHostedLinqLineServiceStatus(input.serviceStatus);
  const reputationStatus = parseHostedLinqLineReputationStatus(input.reputationStatus);
  if (!phoneNumberLookupKey || (!serviceStatus && !reputationStatus)) {
    return false;
  }

  const providerObservedAt = input.observedAt ?? new Date();
  const providerUpdatedAt = input.providerUpdatedAt ?? providerObservedAt;
  const lastStatusEventId = input.eventId
    ? createHostedLinqProviderEventLookupKey(input.eventId)
    : null;
  const createData = {
    lastStatusEventId,
    phoneNumberLookupKey,
    providerObservedAt,
    providerUpdatedAt,
    reputationStatus,
    serviceStatus,
  } satisfies Prisma.HostedLinqLineProviderStateCreateManyInput;

  const created = await input.prisma.hostedLinqLineProviderState.createMany({
    data: createData,
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return true;
  }

  const sameTimestampWhere: Prisma.HostedLinqLineProviderStateWhereInput[] =
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
  const updated = await input.prisma.hostedLinqLineProviderState.updateMany({
    data: {
      ...(lastStatusEventId ? { lastStatusEventId } : {}),
      providerObservedAt,
      providerUpdatedAt,
      ...(reputationStatus ? { reputationStatus } : {}),
      ...(serviceStatus ? { serviceStatus } : {}),
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
  const phoneNumberLookupKey = normalizeNullableString(
    input.phoneNumberLookupKey ?? null,
  );
  const createData = {
    linqChatLookupKey,
    phoneNumberLookupKey,
    providerObservedAt,
    providerStatus,
    providerUpdatedAt: input.providerUpdatedAt,
  } satisfies Prisma.HostedLinqChatHealthCreateManyInput;

  const created = await input.prisma.hostedLinqChatHealth.createMany({
    data: createData,
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return true;
  }

  const updated = await input.prisma.hostedLinqChatHealth.updateMany({
    data: {
      ...(phoneNumberLookupKey ? { phoneNumberLookupKey } : {}),
      providerObservedAt,
      providerStatus,
      providerUpdatedAt: input.providerUpdatedAt,
    },
    where: {
      linqChatLookupKey,
      providerUpdatedAt: { lte: input.providerUpdatedAt },
    },
  });
  return updated.count === 1;
}

export async function readHostedLinqLineProviderState(input: {
  phoneNumberLookupKeys: readonly string[];
  prisma: HostedLinqProviderHealthClient;
}): Promise<HostedLinqLineProviderStateSnapshot | null> {
  const phoneNumberLookupKeys = [...new Set(
    input.phoneNumberLookupKeys
      .map((value) => normalizeNullableString(value))
      .filter((value): value is string => value !== null),
  )];
  if (phoneNumberLookupKeys.length === 0) {
    return null;
  }

  const state = await input.prisma.hostedLinqLineProviderState.findFirst({
    orderBy: [
      { providerUpdatedAt: "desc" },
      { providerObservedAt: "desc" },
    ],
    where: {
      phoneNumberLookupKey: { in: phoneNumberLookupKeys },
    },
  });
  if (!state) {
    return null;
  }
  return {
    lastStatusEventId: state.lastStatusEventId,
    phoneNumberLookupKey: state.phoneNumberLookupKey,
    providerObservedAt: state.providerObservedAt,
    providerUpdatedAt: state.providerUpdatedAt,
    reputationStatus: parseHostedLinqLineReputationStatus(state.reputationStatus),
    serviceStatus: parseHostedLinqLineServiceStatus(state.serviceStatus),
  };
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
