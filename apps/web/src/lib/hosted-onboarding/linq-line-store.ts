import type { Prisma, PrismaClient } from "@prisma/client";

import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import {
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
  readHostedPhoneHint,
} from "./contact-privacy";
import {
  type HostedLinqProviderEventProgress,
  createHostedLinqProviderEventProgress,
} from "./linq-provider-event-progress";
import {
  decryptHostedLinqLinePhoneNumber,
  encryptHostedLinqLinePhoneNumber,
} from "./linq-line-phone-codec";
import {
  filterHostedLinqNewConversationLines,
} from "./linq-provider-health-store";
import {
  parseHostedLinqLineReputationStatus,
  parseHostedLinqLineServiceStatus,
  type HostedLinqLineReputationStatus,
  type HostedLinqLineServiceStatus,
} from "./linq-provider-status";
import { hostedOnboardingError } from "./errors";
import { normalizePhoneNumber } from "./phone";
import { normalizeNullableString } from "./shared";

type HostedLinqLineClient = PrismaClient | Prisma.TransactionClient;

export const HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT = 250;

export type HostedLinqAssignableHomeLine = {
  assignmentWeight: number;
  maxNewConversationsPerDay: number | null;
  phoneNumber: string;
  phoneNumberHint: string;
  phoneNumberLookupKey: string;
  proactiveConversationCount: number | null;
  proactiveConversationDayUtc: Date | null;
};

export type HostedLinqContactCardLine = {
  phoneNumber: string;
  phoneNumberHint: string;
  phoneNumberLookupKey: string;
  providerReputationStatus: HostedLinqLineReputationStatus | null;
  providerServiceStatus: HostedLinqLineServiceStatus | null;
};

type HostedLinqAssignableHomeLineRow = {
  assignmentWeight: number;
  maxNewConversationsPerDay: number | null;
  phoneNumberEncrypted: string | null;
  phoneNumberHint: string;
  phoneNumberLookupKey: string;
  proactiveConversationCount: number | null;
  proactiveConversationDayUtc: Date | null;
};

type HostedLinqContactCardLineRow = {
  phoneNumberEncrypted: string | null;
  phoneNumberHint: string;
  phoneNumberLookupKey: string;
};

export async function upsertHostedLinqLineForPhoneTx(input: {
  /** @deprecated Additive-rollout compatibility; assignment does not read it. */
  activeMemberLimit?: number | null;
  observedAt: Date;
  phoneNumber: string;
  prisma: HostedLinqLineClient;
  providerPhoneNumberId?: string | null;
  providerReason?: string | null;
  providerStatus?: string | null;
  source: "configured" | "provider" | "webhook";
}) {
  if ("$transaction" in input.prisma && typeof input.prisma.$transaction === "function") {
    return input.prisma.$transaction((tx) => upsertHostedLinqLineForPhoneInTransaction({
      ...input,
      prisma: tx,
    }));
  }

  return upsertHostedLinqLineForPhoneInTransaction(input);
}

async function upsertHostedLinqLineForPhoneInTransaction(input: {
  /** @deprecated Additive-rollout compatibility; assignment does not read it. */
  activeMemberLimit?: number | null;
  observedAt: Date;
  phoneNumber: string;
  prisma: HostedLinqLineClient;
  providerPhoneNumberId?: string | null;
  providerReason?: string | null;
  providerStatus?: string | null;
  source: "configured" | "provider" | "webhook";
}) {
  const normalizedPhoneNumber = normalizePhoneNumber(input.phoneNumber);
  const lookupKey = createHostedPhoneLookupKey(normalizedPhoneNumber);
  const lookupKeyReadCandidates = createHostedPhoneLookupKeyReadCandidates(normalizedPhoneNumber);

  if (!normalizedPhoneNumber || !lookupKey || lookupKeyReadCandidates.length === 0) {
    throw new TypeError("Hosted Linq line upsert requires a valid phone number.");
  }

  await acquireHostedLinqLinePhoneLockTx({
    phoneNumber: normalizedPhoneNumber,
    prisma: input.prisma,
  });

  const providerStatus = normalizeNullableString(input.providerStatus);
  const phoneNumberEncrypted = encryptHostedLinqLinePhoneNumber(normalizedPhoneNumber);
  const existingLines = await input.prisma.hostedLinqLine.findMany({
    where: {
      phoneNumberLookupKey: {
        in: lookupKeyReadCandidates,
      },
    },
    select: {
      phoneNumberLookupKey: true,
    },
  });
  const targetLookupKey =
    chooseHostedLinqLineWriteLookupKey(existingLines, lookupKeyReadCandidates, lookupKey)
    ?? lookupKey;

  const updateData = {
    ...(input.source === "configured" ? { configuredAt: input.observedAt } : {}),
    ...(input.source === "provider"
      ? {
          providerLastSeenAt: input.observedAt,
          providerSeenAt: input.observedAt,
        }
      : {}),
    phoneNumberEncrypted,
    phoneNumberHint: readHostedPhoneHint(normalizedPhoneNumber),
    ...(input.providerPhoneNumberId === undefined
      ? {}
      : { providerPhoneNumberId: normalizeNullableString(input.providerPhoneNumberId) }),
    ...(input.providerReason === undefined
      ? {}
      : { providerReason: normalizeNullableString(input.providerReason) }),
    ...(input.providerStatus === undefined
      ? {}
      : {
          providerStatus,
          providerUpdatedAt: input.observedAt,
        }),
    ...(input.source === "configured" ? { source: input.source } : {}),
  } satisfies Prisma.HostedLinqLineUpdateInput;

  const createData = {
    assignmentWeight: 100,
    ...(input.activeMemberLimit === undefined ? {} : { activeMemberLimit: input.activeMemberLimit }),
    configuredAt: input.source === "configured" ? input.observedAt : null,
    egressPolicy: "enabled",
    healthStatus: "unknown",
    phoneNumberEncrypted,
    phoneNumberHint: readHostedPhoneHint(normalizedPhoneNumber),
    phoneNumberLookupKey: lookupKey,
    providerFirstSeenAt: input.source === "provider" ? input.observedAt : null,
    providerLastSeenAt: input.source === "provider" ? input.observedAt : null,
    providerPhoneNumberId: normalizeNullableString(input.providerPhoneNumberId),
    providerReason: normalizeNullableString(input.providerReason),
    providerSeenAt: input.source === "provider" ? input.observedAt : null,
    providerStatus,
    providerUpdatedAt: input.providerStatus === undefined ? null : input.observedAt,
    source: input.source,
  } satisfies Prisma.HostedLinqLineCreateInput;

  const line = targetLookupKey === lookupKey && existingLines.length === 0
    ? await input.prisma.hostedLinqLine.upsert({
        where: {
          phoneNumberLookupKey: lookupKey,
        },
        create: createData,
        update: updateData,
      })
    : await input.prisma.hostedLinqLine.update({
        where: {
          phoneNumberLookupKey: targetLookupKey,
        },
        data: updateData,
      });

  if (input.source === "provider") {
    await input.prisma.hostedLinqLine.updateMany({
      where: {
        phoneNumberLookupKey: line.phoneNumberLookupKey,
        providerFirstSeenAt: null,
      },
      data: {
        providerFirstSeenAt: input.observedAt,
      },
    });
  }

  if (
    input.source === "configured"
    && input.activeMemberLimit !== undefined
    && input.activeMemberLimit !== null
  ) {
    await input.prisma.hostedLinqLine.updateMany({
      where: {
        activeMemberLimit: null,
        phoneNumberLookupKey: line.phoneNumberLookupKey,
      },
      data: {
        activeMemberLimit: input.activeMemberLimit,
      },
    });
  }

  return line;
}

async function acquireHostedLinqLinePhoneLockTx(input: {
  phoneNumber: string;
  prisma: HostedLinqLineClient;
}): Promise<void> {
  await input.prisma.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('hosted_linq_line_phone'),
      hashtext(${input.phoneNumber})
    )
  `;
}

function chooseHostedLinqLineWriteLookupKey(
  existingLines: readonly { phoneNumberLookupKey: string }[],
  lookupKeyReadCandidates: readonly string[],
  currentLookupKey: string,
): string | null {
  const existingLookupKeys = new Set(
    existingLines.map((line) => line.phoneNumberLookupKey),
  );
  if (existingLookupKeys.has(currentLookupKey)) {
    return currentLookupKey;
  }
  return lookupKeyReadCandidates.find((candidate) => existingLookupKeys.has(candidate)) ?? null;
}

export async function syncHostedLinqConfiguredLinesTx(input: {
  /**
   * Additive-rollout compatibility for previous application builds only.
   * Weighted assignment never reads this value; remove the column and env
   * seam after no rollback target still owns the legacy direct-member policy.
   */
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

export async function listHostedLinqAssignableHomeLines(input: {
  prisma: HostedLinqLineClient;
}): Promise<HostedLinqAssignableHomeLine[]> {
  const limit = HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT;
  const rows = await input.prisma.hostedLinqLine.findMany({
    where: buildActiveHostedLinqManagedLineWhere(),
    orderBy: [
      { assignmentWeight: "desc" },
      { phoneNumberLookupKey: "asc" },
    ],
    take: limit + 1,
    select: {
      assignmentWeight: true,
      maxNewConversationsPerDay: true,
      phoneNumberEncrypted: true,
      phoneNumberHint: true,
      phoneNumberLookupKey: true,
      proactiveConversationCount: true,
      proactiveConversationDayUtc: true,
    },
  });

  if (rows.length > limit) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_ASSIGNABLE_LINE_LIMIT_EXCEEDED",
      httpStatus: 500,
      message: `Hosted Linq assignment has more than ${limit} configured assignable line(s). Reduce the assignable pool or raise the reviewed limit before serving assignments.`,
      retryable: false,
    });
  }

  return filterHostedLinqNewConversationLines({
    lines: mapHostedLinqAssignableHomeLineRows(rows),
    prisma: input.prisma,
  });
}

/**
 * New inbound route authority must come from the managed Linq line pool, not
 * from a recipient phone supplied by the webhook alone. Existing inbound
 * authority is independent of predictive reputation so an at-risk line can
 * still receive replies and recover.
 */
export async function hasActiveHostedLinqManagedLine(input: {
  phoneNumberLookupKeys: readonly string[];
  prisma: HostedLinqLineClient;
}): Promise<boolean> {
  const phoneNumberLookupKeys = [...input.phoneNumberLookupKeys];
  if (phoneNumberLookupKeys.length === 0) {
    return false;
  }

  const line = await input.prisma.hostedLinqLine.findFirst({
    where: {
      configuredAt: { not: null },
      phoneNumberEncrypted: { not: null },
      phoneNumberLookupKey: {
        in: phoneNumberLookupKeys,
      },
    },
    select: {
      phoneNumberLookupKey: true,
    },
  });

  return line !== null;
}

export async function listHostedLinqHealthyProactiveLines(input: {
  prisma: HostedLinqLineClient;
}): Promise<HostedLinqAssignableHomeLine[]> {
  const limit = HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT;
  const rows = await input.prisma.hostedLinqLine.findMany({
    where: {
      configuredAt: { not: null },
      egressPolicy: "enabled",
      healthStatus: "healthy",
      phoneNumberEncrypted: { not: null },
    },
    orderBy: [
      { assignmentWeight: "desc" },
      { phoneNumberLookupKey: "asc" },
    ],
    take: limit + 1,
    select: {
      assignmentWeight: true,
      maxNewConversationsPerDay: true,
      phoneNumberEncrypted: true,
      phoneNumberHint: true,
      phoneNumberLookupKey: true,
      proactiveConversationCount: true,
      proactiveConversationDayUtc: true,
    },
  });

  if (rows.length > limit) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_ASSIGNABLE_LINE_LIMIT_EXCEEDED",
      httpStatus: 500,
      message: `Hosted Linq proactive dispatch has more than ${limit} healthy line(s). Reduce the pool or raise the reviewed limit before dispatching.`,
      retryable: false,
    });
  }

  return filterHostedLinqNewConversationLines({
    lines: mapHostedLinqAssignableHomeLineRows(rows),
    prisma: input.prisma,
  });
}

export async function claimHostedLinqProactiveConversationCapacityTx(input: {
  dayUtc: Date;
  limit: number;
  phoneNumberLookupKey: string;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    return false;
  }

  const incremented = await input.prisma.hostedLinqLine.updateMany({
    where: {
      phoneNumberLookupKey: input.phoneNumberLookupKey,
      proactiveConversationCount: {
        lt: input.limit,
      },
      proactiveConversationDayUtc: input.dayUtc,
    },
    data: {
      proactiveConversationCount: {
        increment: 1,
      },
    },
  });
  if (incremented.count === 1) {
    return true;
  }

  const started = await input.prisma.hostedLinqLine.updateMany({
    where: {
      phoneNumberLookupKey: input.phoneNumberLookupKey,
      OR: [
        { proactiveConversationDayUtc: null },
        { proactiveConversationDayUtc: { not: input.dayUtc } },
      ],
    },
    data: {
      proactiveConversationCount: 1,
      proactiveConversationDayUtc: input.dayUtc,
    },
  });

  return started.count === 1;
}

export async function assertHostedLinqAssignableHomeLinePoolReady(input: {
  prisma: HostedLinqLineClient;
}): Promise<void> {
  const lines = await listHostedLinqAssignableHomeLines(input);
  if (lines.length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_ASSIGNABLE_LINE_POOL_REQUIRED",
      httpStatus: 500,
      message: "Hosted Linq DB home-line cutover requires at least one configured, enabled, healthy assignable line.",
      retryable: false,
    });
  }
}

function buildActiveHostedLinqManagedLineWhere(): Prisma.HostedLinqLineWhereInput {
  return {
    configuredAt: { not: null },
    egressPolicy: "enabled",
    healthStatus: { in: ["healthy", "unknown"] },
    phoneNumberEncrypted: { not: null },
  };
}

function mapHostedLinqAssignableHomeLineRows(
  rows: readonly HostedLinqAssignableHomeLineRow[],
): HostedLinqAssignableHomeLine[] {
  return rows.flatMap((row) => {
    const phoneNumber = normalizePhoneNumber(
      decryptHostedLinqLinePhoneNumber(row.phoneNumberEncrypted),
    );
    if (!phoneNumber) {
      return [];
    }
    return [{
      assignmentWeight: row.assignmentWeight,
      maxNewConversationsPerDay: row.maxNewConversationsPerDay,
      phoneNumber,
      phoneNumberHint: row.phoneNumberHint,
      phoneNumberLookupKey: row.phoneNumberLookupKey,
      proactiveConversationCount: row.proactiveConversationCount,
      proactiveConversationDayUtc: row.proactiveConversationDayUtc,
    }];
  });
}

export async function listHostedLinqContactCardLines(input: {
  limit?: number;
  prisma: HostedLinqLineClient;
}): Promise<HostedLinqContactCardLine[]> {
  const take = input.limit && input.limit > 0 ? input.limit : undefined;
  const configuredRows = await input.prisma.hostedLinqLine.findMany({
    where: {
      configuredAt: { not: null },
      phoneNumberEncrypted: { not: null },
    },
    orderBy: [
      { configuredAt: "desc" },
      { providerLastSeenAt: "desc" },
      { phoneNumberLookupKey: "asc" },
    ],
    ...(take ? { take } : {}),
    select: {
      phoneNumberEncrypted: true,
      phoneNumberHint: true,
      phoneNumberLookupKey: true,
    },
  });

  let rows: HostedLinqContactCardLineRow[] = configuredRows;
  if (!take || configuredRows.length < take) {
    const providerRows = await input.prisma.hostedLinqLine.findMany({
      where: {
        configuredAt: null,
        phoneNumberEncrypted: { not: null },
        providerSeenAt: { not: null },
      },
      orderBy: [
        { providerLastSeenAt: "desc" },
        { phoneNumberLookupKey: "asc" },
      ],
      ...(take ? { take: take - configuredRows.length } : {}),
      select: {
        phoneNumberEncrypted: true,
        phoneNumberHint: true,
        phoneNumberLookupKey: true,
      },
    });
    rows = [...configuredRows, ...providerRows];
  }

  const lines = mapHostedLinqContactCardRows(rows);
  const states = lines.length === 0
    ? []
    : await input.prisma.hostedLinqLineProviderState.findMany({
        select: {
          phoneNumberLookupKey: true,
          reputationStatus: true,
          serviceStatus: true,
        },
        where: {
          phoneNumberLookupKey: {
            in: lines.map((line) => line.phoneNumberLookupKey),
          },
        },
      });
  const stateByLine = new Map(
    states.map((state) => [state.phoneNumberLookupKey, state] as const),
  );
  return lines.map((line) => {
    const state = stateByLine.get(line.phoneNumberLookupKey);
    return {
      ...line,
      providerReputationStatus: parseHostedLinqLineReputationStatus(
        state?.reputationStatus,
      ),
      providerServiceStatus: parseHostedLinqLineServiceStatus(
        state?.serviceStatus,
      ),
    };
  });
}

function mapHostedLinqContactCardRows(
  rows: readonly HostedLinqContactCardLineRow[],
): Array<Omit<
  HostedLinqContactCardLine,
  "providerReputationStatus" | "providerServiceStatus"
>> {
  return rows.flatMap((row) => {
    const phoneNumber = normalizePhoneNumber(
      decryptHostedLinqLinePhoneNumber(row.phoneNumberEncrypted),
    );
    if (!phoneNumber) {
      return [];
    }
    return [{
      phoneNumber,
      phoneNumberHint: row.phoneNumberHint,
      phoneNumberLookupKey: row.phoneNumberLookupKey,
    }];
  });
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
    case "message.edited":
      return false;
    case "message.received":
      return projectMessageReceived(input.prisma, lineLookupKey, input.event);
    case "message.delivered":
      return projectMessageDelivered(input.prisma, lineLookupKey, input.event);
    case "message.failed":
      return projectMessageFailed(input.prisma, lineLookupKey, input.event);
    case "message.sent":
    case "phone_number.status_updated":
    case "participant.added":
    case "participant.removed":
    case "reaction.added":
    case "reaction.removed":
      return false;
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
      lastDeliveredAt: event.providerCreatedAt,
      lastReceiptAt: event.providerCreatedAt,
      lastReceiptEventId: progress.eventLookupKey,
      totalDeliveredCount: { increment: 1 },
    },
  });
  if (updated.count === 1) {
    await prisma.hostedLinqLine.updateMany({
      where: {
        lastReceiptAt: progress.providerCreatedAt,
        lastReceiptEventId: progress.eventLookupKey,
        phoneNumberLookupKey,
      },
      data: {
        healthStatus: "healthy",
        lastDeliveredAt: event.providerCreatedAt,
        lastReceiptAt: event.providerCreatedAt,
        lastReceiptEventId: progress.eventLookupKey,
      },
    });
  }
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
