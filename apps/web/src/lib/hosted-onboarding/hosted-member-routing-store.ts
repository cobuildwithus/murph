/**
 * Owns hosted member messaging-routing lookup and binding surfaces.
 */
import { Prisma } from "@prisma/client";
import { normalizeHostedEmailReplyAliasLookupKey } from "@murphai/hosted-execution/hosted-email";

import {
  buildHostedMemberRoutingPrivateColumns,
  readHostedMemberRoutingHomeLinqRecipientPhones,
} from "./member-private-codecs";
import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
  createHostedTelegramUserLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import {
  createHostedLinqParticipantContactLookupKeyReadCandidates,
  type HostedLinqParticipantContact,
} from "./linq-participant-contact";
import {
  hostedMemberRoutingLookupSelect,
  hostedMemberRoutingStateSelect,
  projectHostedMemberRoutingLookup,
  projectHostedMemberRoutingState,
  type HostedMemberRoutingLookup,
  type HostedMemberRoutingLookupRecord,
} from "./hosted-member-routing-state";
import { lockHostedMemberRow, type HostedOnboardingReadClient } from "./shared";

export {
  acquireHostedMemberHomeLinqRouteLockTx,
  countHostedMemberHomeLinqBindingsByRecipientPhone,
  demoteHostedMemberLinqGroupChatBindingsTx,
  readHostedMemberHomeLinqRouteAuthorityTx,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
  upsertHostedMemberPendingLinqBindingTx,
  upsertHostedMemberPendingLinqParticipantContactTx,
  tryCreateHostedMemberPendingLinqParticipantContactTx,
} from "./hosted-member-routing-linq";
export {
  upsertHostedMemberTelegramRoutingBindingTx,
} from "./hosted-member-routing-telegram";
export {
  hostedMemberRoutingRecordsEqual,
  projectHostedMemberRoutingState,
  readHostedMemberRoutingControlRootKeyIds,
  type HostedMemberRoutingLookupMatch,
  type HostedMemberRoutingLookupSnapshot,
  type HostedMemberRoutingRecord,
  type HostedMemberRoutingStateSnapshot,
} from "./hosted-member-routing-state";

export type HostedMemberRoutingByTelegramUserIdResolution =
  | {
      lookup: HostedMemberRoutingLookup;
      status: "found";
    }
  | {
      memberIds: string[];
      status: "ambiguous";
    }
  | {
      status: "missing";
    };

export type HostedMemberCoreLookupResolution =
  | {
      core: HostedMemberRoutingLookup["core"];
      status: "found";
    }
  | {
      memberIds: string[];
      status: "ambiguous";
    }
  | {
      status: "missing";
    };

const hostedMemberRoutingCoreLookupSelect =
  Prisma.validator<Prisma.HostedMemberRoutingSelect>()({
    memberId: true,
    member: {
      select: {
        billingStatus: true,
        createdAt: true,
        id: true,
        suspendedAt: true,
        updatedAt: true,
      },
    },
  });

type HostedMemberRoutingCoreLookupRecord =
  Prisma.HostedMemberRoutingGetPayload<{
    select: typeof hostedMemberRoutingCoreLookupSelect;
  }>;

export async function readHostedMemberIdByReplyAliasLookupKey(input: {
  prisma: HostedOnboardingReadClient;
  replyAliasLookupKey: string | null | undefined;
}): Promise<string | null> {
  const lookupKey = typeof input.replyAliasLookupKey === "string"
    ? input.replyAliasLookupKey.trim()
    : "";
  if (!lookupKey) {
    return null;
  }

  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      replyAliasLookupKey: lookupKey,
    },
    select: {
      memberId: true,
    },
  });

  return routingRecord?.memberId ?? null;
}

export async function hasHostedMemberEstablishedLinqHomeRoute(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: {
      linqChatLookupKey: true,
    },
  });

  return Boolean(routingRecord?.linqChatLookupKey);
}

export interface HostedMemberReplyAliasState {
  generation: number;
  lookupKey: string | null;
}

export async function readHostedMemberReplyAliasState(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberReplyAliasState | null> {
  const routing = await input.prisma.hostedMemberRouting.findUnique({
    where: { memberId: input.memberId },
    select: {
      replyAliasGeneration: true,
      replyAliasLookupKey: true,
    },
  });
  const lookupKey = normalizeHostedEmailReplyAliasLookupKey(
    routing?.replyAliasLookupKey,
  );
  if (!routing) {
    return null;
  }
  const generation = requireHostedMemberReplyAliasGeneration(
    routing.replyAliasGeneration ?? 0,
  );
  return { generation, lookupKey };
}

export async function resolveHostedMemberReplyAliasRegistrationTx(input: {
  candidateLookupKey?: string | null;
  fallbackGeneration: number;
  fallbackLookupKey: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberReplyAliasState> {
  const candidateLookupKey = normalizeHostedEmailReplyAliasLookupKey(
    input.candidateLookupKey,
  );
  const fallbackLookupKey = normalizeHostedEmailReplyAliasLookupKey(
    input.fallbackLookupKey,
  );
  if (!fallbackLookupKey) {
    throw new TypeError("Hosted member reply alias fallback key is invalid.");
  }
  const fallbackGeneration = requireHostedMemberReplyAliasGeneration(
    input.fallbackGeneration,
  );

  await lockHostedMemberRow(input.prisma, input.memberId);
  const current = await readHostedMemberReplyAliasState({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  if ((current?.generation ?? 0) !== fallbackGeneration) {
    throw hostedOnboardingError({
      code: "HOSTED_EMAIL_REPLY_ALIAS_STALE",
      message: "Hosted email reply alias changed and must be re-resolved.",
      httpStatus: 409,
      retryable: true,
    });
  }
  if (current?.lookupKey) {
    if (candidateLookupKey && candidateLookupKey !== current.lookupKey) {
      throw hostedOnboardingError({
        code: "HOSTED_EMAIL_REPLY_ALIAS_STALE",
        message: "Hosted email reply alias changed and must be re-resolved.",
        httpStatus: 409,
        retryable: true,
      });
    }
    return current;
  }

  if (candidateLookupKey && candidateLookupKey !== fallbackLookupKey) {
    throw hostedOnboardingError({
      code: "HOSTED_EMAIL_REPLY_ALIAS_STALE",
      message: "Hosted email reply alias changed and must be re-resolved.",
      httpStatus: 409,
      retryable: true,
    });
  }

  const lookupKey = fallbackLookupKey;
  await upsertHostedMemberReplyAliasLookupKeyTx({
    memberId: input.memberId,
    prisma: input.prisma,
    replyAliasGeneration: fallbackGeneration,
    replyAliasLookupKey: lookupKey,
  });
  return { generation: fallbackGeneration, lookupKey };
}

export async function upsertHostedMemberReplyAliasLookupKeyTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  replyAliasGeneration?: number;
  replyAliasLookupKey: string | null;
}): Promise<void> {
  const lookupKey = normalizeHostedEmailReplyAliasLookupKey(
    input.replyAliasLookupKey,
  );
  if (input.replyAliasLookupKey !== null && !lookupKey) {
    throw new TypeError("Hosted member reply alias lookup key must be current-format lowercase hex.");
  }
  const generation = input.replyAliasGeneration ?? 0;
  if (!Number.isSafeInteger(generation) || generation < 0 || generation > 2_147_483_647) {
    throw new TypeError(
      "Hosted member reply alias generation must be a non-negative 32-bit integer.",
    );
  }

  const routingPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: input.memberId,
    pendingLinqChatId: null,
    pendingLinqParticipantContact: null,
    pendingLinqRecipientPhone: null,
    prisma: input.prisma,
    telegramThreadId: null,
    telegramUserId: null,
  });

  await input.prisma.hostedMemberRouting.upsert({
    where: {
      memberId: input.memberId,
    },
    create: {
      memberId: input.memberId,
      replyAliasGeneration: generation,
      replyAliasLookupKey: lookupKey,
      telegramUserLookupKey: null,
      ...routingPrivateColumns,
    },
    update: {
      replyAliasGeneration: generation,
      replyAliasLookupKey: lookupKey,
    },
  });
}

function requireHostedMemberReplyAliasGeneration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new TypeError("Hosted member reply alias generation is invalid.");
  }
  return value;
}

export async function lookupHostedMemberRoutingByTelegramUserLookupKey(input: {
  prisma: HostedOnboardingReadClient;
  telegramUserLookupKey: string;
}): Promise<HostedMemberRoutingLookup | null> {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      telegramUserLookupKey: input.telegramUserLookupKey,
    },
    select: hostedMemberRoutingLookupSelect,
  });

  return routingRecord
    ? await projectHostedMemberRoutingLookup(
        routingRecord,
        "telegramUserLookupKey",
        input.prisma,
      )
    : null;
}

export async function lookupHostedMemberRoutingByPendingLinqParticipantContact(input: {
  contact: HostedLinqParticipantContact;
  linqChatId?: string | null;
  prisma: HostedOnboardingReadClient;
  recipientPhone?: string | null;
}): Promise<HostedMemberRoutingLookup | null> {
  const contactLookupKeys =
    createHostedLinqParticipantContactLookupKeyReadCandidates({
      kind: input.contact.kind,
      value: input.contact.value,
    });
  const scopedToGroup =
    input.linqChatId !== undefined || input.recipientPhone !== undefined;
  if (
    scopedToGroup
    && (input.linqChatId === undefined || input.recipientPhone === undefined)
  ) {
    throw new TypeError(
      "Pending Linq group contact lookup requires both chat and recipient line.",
    );
  }
  const chatLookupKeys = scopedToGroup
    ? createHostedLinqChatLookupKeyReadCandidates(input.linqChatId)
    : [];
  const recipientLookupKeys = scopedToGroup
    ? createHostedPhoneLookupKeyReadCandidates(input.recipientPhone)
    : [];
  if (
    contactLookupKeys.length === 0
    || (scopedToGroup
      && (chatLookupKeys.length === 0 || recipientLookupKeys.length === 0))
  ) {
    return null;
  }

  const routingRecords = await input.prisma.hostedMemberRouting.findMany({
    where: {
      pendingLinqParticipantContactLookupKey: {
        in: contactLookupKeys,
      },
      ...(scopedToGroup
        ? {
            pendingLinqChatLookupKey: {
              in: chatLookupKeys,
            },
            pendingLinqRecipientPhoneLookupKey: {
              in: recipientLookupKeys,
            },
          }
        : {}),
    },
    select: hostedMemberRoutingLookupSelect,
  });

  return resolveUniqueHostedMemberRoutingLookup({
    ambiguityCode: "LINQ_PENDING_CONTACT_ROUTING_LOOKUP_AMBIGUOUS",
    matchedBy: "pendingLinqParticipantContactLookupKey",
    prisma: input.prisma,
    routingRecords,
  });
}

/**
 * Resolves pending-contact authority without decrypting unrelated routing
 * state. Linq webhook admission consumes only member core fields here.
 */
export async function lookupHostedMemberCoreByPendingLinqParticipantContact(input: {
  contact: HostedLinqParticipantContact;
  linqChatId?: string | null;
  prisma: HostedOnboardingReadClient;
  recipientPhone?: string | null;
}): Promise<HostedMemberRoutingLookup["core"] | null> {
  const contactLookupKeys =
    createHostedLinqParticipantContactLookupKeyReadCandidates({
      kind: input.contact.kind,
      value: input.contact.value,
    });
  const scopedToGroup =
    input.linqChatId !== undefined || input.recipientPhone !== undefined;
  if (
    scopedToGroup
    && (input.linqChatId === undefined || input.recipientPhone === undefined)
  ) {
    throw new TypeError(
      "Pending Linq group contact lookup requires both chat and recipient line.",
    );
  }
  const chatLookupKeys = scopedToGroup
    ? createHostedLinqChatLookupKeyReadCandidates(input.linqChatId)
    : [];
  const recipientLookupKeys = scopedToGroup
    ? createHostedPhoneLookupKeyReadCandidates(input.recipientPhone)
    : [];
  if (
    contactLookupKeys.length === 0
    || (scopedToGroup
      && (chatLookupKeys.length === 0 || recipientLookupKeys.length === 0))
  ) {
    return null;
  }

  const resolution = resolveHostedMemberCoreLookup(
    await input.prisma.hostedMemberRouting.findMany({
      where: {
        pendingLinqParticipantContactLookupKey: {
          in: contactLookupKeys,
        },
        ...(scopedToGroup
          ? {
              pendingLinqChatLookupKey: {
                in: chatLookupKeys,
              },
              pendingLinqRecipientPhoneLookupKey: {
                in: recipientLookupKeys,
              },
            }
          : {}),
      },
      select: hostedMemberRoutingCoreLookupSelect,
    }),
  );
  if (resolution.status === "ambiguous") {
    throw hostedOnboardingError({
      code: "LINQ_PENDING_CONTACT_ROUTING_LOOKUP_AMBIGUOUS",
      details: {
        matchCount: resolution.memberIds.length,
        matchedBy: "pendingLinqParticipantContactLookupKey",
      },
      httpStatus: 500,
      message: "Hosted member routing lookup matched multiple members.",
      retryable: true,
    });
  }
  return resolution.status === "found" ? resolution.core : null;
}

export interface HostedMemberHomeLinqCoreLookup {
  core: HostedMemberRoutingLookup["core"];
  matchedBy: "linqChatLookupKey";
}

type HostedMemberRoutingByHomeLinqChatIdInput = {
  linqChatId: string | null | undefined;
  prisma: HostedOnboardingReadClient;
};

export async function lookupHostedMemberRoutingByHomeLinqChatId(
  input: HostedMemberRoutingByHomeLinqChatIdInput & { projection: "core" },
): Promise<HostedMemberHomeLinqCoreLookup | null>;
export async function lookupHostedMemberRoutingByHomeLinqChatId(
  input: HostedMemberRoutingByHomeLinqChatIdInput,
): Promise<HostedMemberRoutingLookup | null>;
export async function lookupHostedMemberRoutingByHomeLinqChatId(
  input: HostedMemberRoutingByHomeLinqChatIdInput & { projection?: "core" },
): Promise<HostedMemberHomeLinqCoreLookup | HostedMemberRoutingLookup | null> {
  const lookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.linqChatId);
  if (lookupKeys.length === 0) {
    return null;
  }

  if (input.projection === "core") {
    const resolution = resolveHostedMemberCoreLookup(
      await input.prisma.hostedMemberRouting.findMany({
        where: {
          linqChatLookupKey: {
            in: lookupKeys,
          },
        },
        select: hostedMemberRoutingCoreLookupSelect,
      }),
    );
    if (resolution.status === "ambiguous") {
      throw hostedOnboardingError({
        code: "LINQ_HOME_CHAT_ROUTING_LOOKUP_AMBIGUOUS",
        details: {
          matchCount: resolution.memberIds.length,
          matchedBy: "linqChatLookupKey",
        },
        httpStatus: 500,
        message: "Hosted member routing lookup matched multiple members.",
        retryable: true,
      });
    }
    return resolution.status === "found"
      ? { core: resolution.core, matchedBy: "linqChatLookupKey" }
      : null;
  }

  const routingRecords = await input.prisma.hostedMemberRouting.findMany({
    where: {
      linqChatLookupKey: {
        in: lookupKeys,
      },
    },
    select: hostedMemberRoutingLookupSelect,
  });

  return resolveUniqueHostedMemberRoutingLookup({
    ambiguityCode: "LINQ_HOME_CHAT_ROUTING_LOOKUP_AMBIGUOUS",
    matchedBy: "linqChatLookupKey",
    prisma: input.prisma,
    routingRecords,
  });
}

export async function lookupHostedMemberRoutingByTelegramUserId(input: {
  prisma: HostedOnboardingReadClient;
  telegramUserId: string;
}): Promise<HostedMemberRoutingLookup | null> {
  const resolution = await resolveHostedMemberRoutingByTelegramUserId(input);

  if (resolution.status === "ambiguous") {
    throw buildHostedTelegramRoutingLookupAmbiguousError(resolution.memberIds.length);
  }

  return resolution.status === "found" ? resolution.lookup : null;
}

export async function resolveHostedMemberRoutingByTelegramUserId(input: {
  prisma: HostedOnboardingReadClient;
  telegramUserId: string;
}): Promise<HostedMemberRoutingByTelegramUserIdResolution> {
  const routingRecords = await readHostedMemberRoutingRecordsByTelegramUserId(input);

  if (routingRecords.length === 0) {
    return { status: "missing" };
  }

  const routingRecordByMemberId = new Map<string, HostedMemberRoutingLookupRecord>();

  for (const routingRecord of routingRecords) {
    if (!routingRecordByMemberId.has(routingRecord.memberId)) {
      routingRecordByMemberId.set(routingRecord.memberId, routingRecord);
    }
  }

  if (routingRecordByMemberId.size !== 1) {
    return {
      memberIds: [...routingRecordByMemberId.keys()].sort(),
      status: "ambiguous",
    };
  }

  const [routingRecord] = [...routingRecordByMemberId.values()];

  return {
    lookup: await projectHostedMemberRoutingLookup(
      routingRecord,
      "telegramUserId",
      input.prisma,
    ),
    status: "found",
  };
}

/**
 * Resolves Telegram sender authority without projecting encrypted routing
 * state. Webhook admission consumes only member core fields and must not turn a
 * blind-index lookup into private-field KMS work before or during planning.
 */
export async function resolveHostedMemberCoreByTelegramUserId(input: {
  prisma: HostedOnboardingReadClient;
  telegramUserId: string;
}): Promise<HostedMemberCoreLookupResolution> {
  const telegramUserLookupKeys = createHostedTelegramUserLookupKeyReadCandidates(
    input.telegramUserId,
  );
  if (telegramUserLookupKeys.length === 0) {
    return { status: "missing" };
  }

  const records = await input.prisma.hostedMemberRouting.findMany({
    where: {
      telegramUserLookupKey: {
        in: telegramUserLookupKeys,
      },
    },
    select: hostedMemberRoutingCoreLookupSelect,
  });
  return resolveHostedMemberCoreLookup(records);
}

function resolveHostedMemberCoreLookup(
  records: readonly HostedMemberRoutingCoreLookupRecord[],
): HostedMemberCoreLookupResolution {
  const coreByMemberId = new Map<string, HostedMemberRoutingLookup["core"]>();
  for (const record of records) {
    coreByMemberId.set(record.memberId, record.member);
  }
  if (coreByMemberId.size === 0) {
    return { status: "missing" };
  }
  if (coreByMemberId.size !== 1) {
    return {
      memberIds: [...coreByMemberId.keys()].sort(),
      status: "ambiguous",
    };
  }

  return {
    core: [...coreByMemberId.values()][0]!,
    status: "found",
  };
}

async function readHostedMemberRoutingRecordsByTelegramUserId(input: {
  prisma: HostedOnboardingReadClient;
  telegramUserId: string;
}): Promise<HostedMemberRoutingLookupRecord[]> {
  const telegramUserLookupKeys = createHostedTelegramUserLookupKeyReadCandidates(
    input.telegramUserId,
  );

  if (telegramUserLookupKeys.length === 0) {
    return [];
  }

  return input.prisma.hostedMemberRouting.findMany({
    where: {
      telegramUserLookupKey: {
        in: telegramUserLookupKeys,
      },
    },
    select: hostedMemberRoutingLookupSelect,
  });
}

function buildHostedTelegramRoutingLookupAmbiguousError(matchCount: number) {
  return hostedOnboardingError({
    code: "TELEGRAM_ROUTING_LOOKUP_AMBIGUOUS",
    details: {
      matchCount,
    },
    httpStatus: 500,
    message:
      "Telegram routing lookup matched multiple Murph accounts during blind-index rotation. Repair the duplicate binding before retrying.",
    retryable: true,
  });
}

async function resolveUniqueHostedMemberRoutingLookup(input: {
  ambiguityCode: string;
  matchedBy: Parameters<typeof projectHostedMemberRoutingLookup>[1];
  prisma: HostedOnboardingReadClient;
  routingRecords: HostedMemberRoutingLookupRecord[];
}): Promise<HostedMemberRoutingLookup | null> {
  if (input.routingRecords.length === 0) {
    return null;
  }

  const routingRecordByMemberId = new Map<string, HostedMemberRoutingLookupRecord>();
  for (const routingRecord of input.routingRecords) {
    if (!routingRecordByMemberId.has(routingRecord.memberId)) {
      routingRecordByMemberId.set(routingRecord.memberId, routingRecord);
    }
  }

  if (routingRecordByMemberId.size !== 1) {
    throw hostedOnboardingError({
      code: input.ambiguityCode,
      details: {
        matchCount: routingRecordByMemberId.size,
        matchedBy: input.matchedBy,
      },
      httpStatus: 500,
      message: "Hosted member routing lookup matched multiple members.",
      retryable: true,
    });
  }

  const [routingRecord] = [...routingRecordByMemberId.values()];
  return await projectHostedMemberRoutingLookup(
    routingRecord,
    input.matchedBy,
    input.prisma,
  );
}

export interface HostedMemberRoutingHomeLinqRecipientPhoneRecord {
  linqRecipientPhoneEncrypted: string | null;
  linqRecipientPhoneLookupKey: string | null;
  memberId: string;
}

export interface HostedMemberRoutingHomeLinqRecipientPhoneSnapshot
  extends HostedMemberRoutingHomeLinqRecipientPhoneRecord {
  linqRecipientPhone: string | null;
}

export async function readHostedMemberRoutingHomeLinqRecipientPhoneRecords(
  input: {
    memberIds: readonly string[];
    prisma: HostedOnboardingReadClient;
  },
): Promise<HostedMemberRoutingHomeLinqRecipientPhoneRecord[]> {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) {
    return [];
  }
  return input.prisma.hostedMemberRouting.findMany({
    orderBy: { memberId: "asc" },
    select: {
      linqRecipientPhoneEncrypted: true,
      linqRecipientPhoneLookupKey: true,
      memberId: true,
    },
    where: { memberId: { in: memberIds } },
  });
}

export async function readHostedMemberRoutingHomeLinqRecipientPhoneSnapshots(
  input: {
    memberIds: readonly string[];
    prisma: HostedOnboardingReadClient;
    retainFailureInScopedCache?: boolean;
  },
): Promise<HostedMemberRoutingHomeLinqRecipientPhoneSnapshot[]> {
  const records = await readHostedMemberRoutingHomeLinqRecipientPhoneRecords(input);
  return openHostedMemberRoutingHomeLinqRecipientPhoneRecords({
    prisma: input.prisma,
    records,
    retainFailureInScopedCache: input.retainFailureInScopedCache,
  });
}

export async function openHostedMemberRoutingHomeLinqRecipientPhoneRecords(
  input: {
    prisma: HostedOnboardingReadClient;
    records: readonly HostedMemberRoutingHomeLinqRecipientPhoneRecord[];
    retainFailureInScopedCache?: boolean;
  },
): Promise<HostedMemberRoutingHomeLinqRecipientPhoneSnapshot[]> {
  const phones = await readHostedMemberRoutingHomeLinqRecipientPhones(
    input.records,
    input.prisma,
    input.retainFailureInScopedCache,
  );
  return input.records.map((record, index) => ({
    ...record,
    linqRecipientPhone: phones[index] ?? null,
  }));
}

export async function readHostedMemberRoutingState(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
  retainFailureInScopedCache?: boolean;
}) {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: hostedMemberRoutingStateSelect,
  });

  return routingRecord
    ? await projectHostedMemberRoutingState(
        routingRecord,
        input.prisma,
        input.retainFailureInScopedCache,
      )
    : null;
}

/**
 * Reads the exact persisted routing snapshot without decrypting it. Prepared
 * webhook paths use this to bind an outside-transaction projection to the row
 * re-read under their routing lock.
 */
export async function readHostedMemberRoutingRecord(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}) {
  return input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: hostedMemberRoutingStateSelect,
  });
}

export async function lockHostedMemberRoutingStateTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await input.prisma.$queryRaw`
    SELECT 1
    FROM "hosted_member_routing"
    WHERE "member_id" = ${input.memberId}
    FOR UPDATE
  `;
}
