/**
 * Owns hosted member messaging-routing lookup and binding surfaces.
 */
import { Prisma } from "@prisma/client";

import { buildHostedMemberRoutingPrivateColumns } from "./member-private-codecs";
import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedTelegramUserLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import {
  createHostedLinqParticipantContactLookupKeyReadCandidates,
  type HostedLinqParticipantContact,
} from "./linq-participant-contact";
import {
  hostedMemberHomeLinqRouteSelect,
  hostedMemberRoutingLookupSelect,
  hostedMemberRoutingStateSelect,
  projectHostedMemberHomeLinqRouteState,
  projectHostedMemberRoutingLookup,
  projectHostedMemberRoutingState,
  type HostedMemberHomeLinqRouteSnapshot,
  type HostedMemberRoutingLookup,
  type HostedMemberRoutingLookupRecord,
} from "./hosted-member-routing-state";
import { type HostedOnboardingReadClient } from "./shared";

export {
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx,
  countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince,
  countHostedMemberHomeLinqBindingsByRecipientPhone,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
  upsertHostedMemberPendingLinqBindingTx,
  upsertHostedMemberPendingLinqParticipantContactTx,
  tryCreateHostedMemberPendingLinqParticipantContactTx,
} from "./hosted-member-routing-linq";
export {
  syncHostedMemberTelegramRoutingBinding,
  upsertHostedMemberTelegramRoutingBindingTx,
} from "./hosted-member-routing-telegram";
export {
  type HostedMemberHomeLinqRouteSnapshot,
  projectHostedMemberRoutingState,
  type HostedMemberRoutingLookupMatch,
  type HostedMemberRoutingLookupSnapshot,
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

export async function upsertHostedMemberReplyAliasLookupKeyTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  replyAliasLookupKey: string;
}): Promise<void> {
  const lookupKey = input.replyAliasLookupKey.trim();
  if (!lookupKey) {
    throw new TypeError("Hosted member reply alias lookup key must be a non-empty string.");
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
      replyAliasLookupKey: lookupKey,
      telegramUserLookupKey: null,
      ...routingPrivateColumns,
    },
    update: {
      replyAliasLookupKey: lookupKey,
    },
  });
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
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberRoutingLookup | null> {
  const lookupKeys = createHostedLinqParticipantContactLookupKeyReadCandidates({
    kind: input.contact.kind,
    value: input.contact.value,
  });
  if (lookupKeys.length === 0) {
    return null;
  }

  const routingRecords = await input.prisma.hostedMemberRouting.findMany({
    where: {
      pendingLinqParticipantContactLookupKey: {
        in: lookupKeys,
      },
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

export async function lookupHostedMemberRoutingByHomeLinqChatId(input: {
  linqChatId: string | null | undefined;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberRoutingLookup | null> {
  const lookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.linqChatId);
  if (lookupKeys.length === 0) {
    return null;
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

export async function lookupHostedMemberRoutingByPendingLinqChatId(input: {
  linqChatId: string | null | undefined;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberRoutingLookup | null> {
  const lookupKeys = createHostedLinqChatLookupKeyReadCandidates(input.linqChatId);
  if (lookupKeys.length === 0) {
    return null;
  }

  const routingRecords = await input.prisma.hostedMemberRouting.findMany({
    where: {
      pendingLinqChatLookupKey: {
        in: lookupKeys,
      },
    },
    select: hostedMemberRoutingLookupSelect,
  });

  return resolveUniqueHostedMemberRoutingLookup({
    ambiguityCode: "LINQ_PENDING_CHAT_ROUTING_LOOKUP_AMBIGUOUS",
    matchedBy: "pendingLinqChatLookupKey",
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
export async function readHostedMemberRoutingState(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}) {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: hostedMemberRoutingStateSelect,
  });

  return routingRecord ? await projectHostedMemberRoutingState(routingRecord, input.prisma) : null;
}

export async function readHostedMemberHomeLinqRoute(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedMemberHomeLinqRouteSnapshot | null> {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: hostedMemberHomeLinqRouteSelect,
  });

  return routingRecord
    ? await projectHostedMemberHomeLinqRouteState(routingRecord, input.prisma)
    : null;
}
