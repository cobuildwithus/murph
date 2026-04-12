/**
 * Owns hosted member messaging-routing lookup and binding surfaces.
 */
import {
  HostedBillingStatus,
  type HostedMember,
  Prisma,
} from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedPhoneLookupKey,
  createHostedTelegramUserLookupKey,
  createHostedTelegramUserLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  buildHostedMemberRoutingPrivateColumns,
  readHostedMemberRoutingPrivateState,
} from "./member-private-codecs";
import { normalizePhoneNumber } from "./phone";
import {
  type HostedOnboardingPrismaClient,
  withHostedOnboardingTransaction,
} from "./shared";

const hostedMemberRoutingStateSelect = Prisma.validator<Prisma.HostedMemberRoutingSelect>()({
  linqChatIdEncrypted: true,
  linqRecipientPhoneEncrypted: true,
  memberId: true,
  pendingLinqChatIdEncrypted: true,
  pendingLinqRecipientPhoneEncrypted: true,
  telegramUserLookupKey: true,
  telegramUserIdEncrypted: true,
});

type HostedMemberRoutingRecord = Prisma.HostedMemberRoutingGetPayload<{
  select: typeof hostedMemberRoutingStateSelect;
}>;

const hostedMemberRoutingLookupSelect = Prisma.validator<Prisma.HostedMemberRoutingSelect>()({
  linqChatIdEncrypted: true,
  linqRecipientPhoneEncrypted: true,
  memberId: true,
  pendingLinqChatIdEncrypted: true,
  pendingLinqRecipientPhoneEncrypted: true,
  telegramUserLookupKey: true,
  telegramUserIdEncrypted: true,
  member: {
    select: {
      billingStatus: true,
      id: true,
      suspendedAt: true,
    },
  },
});

type HostedMemberRoutingLookupRecord = Prisma.HostedMemberRoutingGetPayload<{
  select: typeof hostedMemberRoutingLookupSelect;
}>;

export interface HostedMemberRoutingStateSnapshot {
  linqChatId: string | null;
  linqRecipientPhone: string | null;
  memberId: string;
  pendingLinqChatId: string | null;
  pendingLinqRecipientPhone: string | null;
  telegramUserLookupKey: string | null;
}

export interface HostedMemberRoutingLookupSnapshot {
  hasTelegramUserBinding: boolean;
  linqChatId: string | null;
  memberId: string;
}

export type HostedMemberRoutingLookupMatch =
  | "telegramUserLookupKey"
  | "telegramUserId";

export interface HostedMemberRoutingLookup {
  core: Pick<HostedMember, "billingStatus" | "id" | "suspendedAt">;
  matchedBy: HostedMemberRoutingLookupMatch;
  routing: HostedMemberRoutingLookupSnapshot;
}

export async function lookupHostedMemberRoutingByTelegramUserLookupKey(input: {
  prisma: HostedOnboardingPrismaClient;
  telegramUserLookupKey: string;
}): Promise<HostedMemberRoutingLookup | null> {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      telegramUserLookupKey: input.telegramUserLookupKey,
    },
    select: hostedMemberRoutingLookupSelect,
  });

  return routingRecord
    ? projectHostedMemberRoutingLookup(routingRecord, "telegramUserLookupKey")
    : null;
}

export async function lookupHostedMemberRoutingByTelegramUserId(input: {
  prisma: HostedOnboardingPrismaClient;
  telegramUserId: string;
}): Promise<HostedMemberRoutingLookup | null> {
  const telegramUserLookupKeys = createHostedTelegramUserLookupKeyReadCandidates(
    input.telegramUserId,
  );

  if (telegramUserLookupKeys.length === 0) {
    return null;
  }

  const routingRecord = await input.prisma.hostedMemberRouting.findFirst({
    where: {
      telegramUserLookupKey: {
        in: telegramUserLookupKeys,
      },
    },
    select: hostedMemberRoutingLookupSelect,
  });

  return routingRecord
    ? projectHostedMemberRoutingLookup(routingRecord, "telegramUserId")
    : null;
}

export async function readHostedMemberRoutingState(input: {
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
}): Promise<HostedMemberRoutingStateSnapshot | null> {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: hostedMemberRoutingStateSelect,
  });

  return routingRecord ? projectHostedMemberRoutingState(routingRecord) : null;
}

export async function upsertHostedMemberPendingLinqBinding(input: {
  linqChatId: string;
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
  recipientPhone: string | null;
}): Promise<void> {
  await writeHostedMemberLinqBinding({
    clearPending: false,
    kind: "pending",
    linqChatId: input.linqChatId,
    memberId: input.memberId,
    prisma: input.prisma,
    recipientPhone: input.recipientPhone,
  });
}

export async function upsertHostedMemberHomeLinqBinding(input: {
  clearPending?: boolean;
  linqChatId: string;
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
  recipientPhone: string | null;
}): Promise<void> {
  await writeHostedMemberLinqBinding({
    clearPending: input.clearPending ?? false,
    kind: "home",
    linqChatId: input.linqChatId,
    memberId: input.memberId,
    prisma: input.prisma,
    recipientPhone: input.recipientPhone,
  });
}

export async function countHostedMemberHomeLinqBindingsByRecipientPhone(input: {
  prisma: HostedOnboardingPrismaClient;
  recipientPhones: readonly string[];
}): Promise<Map<string, number>> {
  const recipientPhoneEntries = buildHostedRecipientPhoneLookupEntries(
    input.recipientPhones,
  );

  if (recipientPhoneEntries.length === 0) {
    return new Map();
  }

  const counts = new Map<string, number>(
    recipientPhoneEntries.map(({ recipientPhone }) => [recipientPhone, 0]),
  );
  const recipientPhoneByLookupKey = new Map(
    recipientPhoneEntries.map(({ lookupKey, recipientPhone }) => [lookupKey, recipientPhone] as const),
  );

  const routingRecords = await input.prisma.hostedMemberRouting.findMany({
    where: {
      linqChatLookupKey: {
        not: null,
      },
      linqRecipientPhoneLookupKey: {
        in: recipientPhoneEntries.map(({ lookupKey }) => lookupKey),
      },
      member: {
        is: {
          billingStatus: HostedBillingStatus.active,
          suspendedAt: null,
        },
      },
    },
    select: {
      linqRecipientPhoneLookupKey: true,
    },
  });

  for (const routingRecord of routingRecords) {
    const recipientPhone = routingRecord.linqRecipientPhoneLookupKey
      ? recipientPhoneByLookupKey.get(routingRecord.linqRecipientPhoneLookupKey)
      : null;

    if (!recipientPhone) {
      continue;
    }

    counts.set(recipientPhone, (counts.get(recipientPhone) ?? 0) + 1);
  }

  return counts;
}

export async function upsertHostedMemberTelegramRoutingBinding(input: {
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
  telegramUserId: string;
}): Promise<void> {
  const telegramUserLookupKey = createHostedTelegramUserLookupKey(input.telegramUserId);

  if (!telegramUserLookupKey) {
    throw new TypeError("Hosted Telegram routing requires a non-empty Telegram user id.");
  }

  const routingPrivateColumns = buildHostedMemberRoutingPrivateColumns({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: input.memberId,
    pendingLinqChatId: null,
    pendingLinqRecipientPhone: null,
    telegramUserId: input.telegramUserId,
  });

  await withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await tx.hostedMemberRouting.upsert({
      where: {
        memberId: input.memberId,
      },
      create: {
        ...routingPrivateColumns,
        linqChatLookupKey: null,
        linqRecipientPhoneLookupKey: null,
        memberId: input.memberId,
        pendingLinqChatLookupKey: null,
        pendingLinqRecipientPhoneLookupKey: null,
        telegramUserLookupKey,
      },
      update: {
        telegramUserIdEncrypted: routingPrivateColumns.telegramUserIdEncrypted,
        telegramUserLookupKey,
      },
    });
  });
}

export function projectHostedMemberRoutingState(
  routing: HostedMemberRoutingRecord,
): HostedMemberRoutingStateSnapshot {
  const privateState = readHostedMemberRoutingPrivateState(routing);

  return {
    linqChatId: privateState.linqChatId,
    linqRecipientPhone: privateState.linqRecipientPhone,
    memberId: routing.memberId,
    pendingLinqChatId: privateState.pendingLinqChatId,
    pendingLinqRecipientPhone: privateState.pendingLinqRecipientPhone,
    telegramUserLookupKey: routing.telegramUserLookupKey ?? null,
  };
}

async function writeHostedMemberLinqBinding(input: {
  clearPending: boolean;
  kind: "home" | "pending";
  linqChatId: string;
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
  recipientPhone: string | null;
}): Promise<void> {
  const linqChatLookupKey = createHostedLinqChatLookupKey(input.linqChatId);

  if (!linqChatLookupKey) {
    throw new TypeError("Hosted Linq routing requires a non-empty chat id.");
  }

  const recipientPhone = normalizePhoneNumber(input.recipientPhone);
  const recipientPhoneLookupKey = createHostedPhoneLookupKey(recipientPhone);
  const routingPrivateColumns = buildHostedMemberRoutingPrivateColumns({
    linqChatId: input.kind === "home" ? input.linqChatId : null,
    linqRecipientPhone: input.kind === "home" ? recipientPhone : null,
    memberId: input.memberId,
    pendingLinqChatId: input.kind === "pending" ? input.linqChatId : null,
    pendingLinqRecipientPhone: input.kind === "pending" ? recipientPhone : null,
    telegramUserId: null,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await withHostedOnboardingTransaction(input.prisma, async (tx) => {
        await clearHostedMemberLinqChatConflicts({
          linqChatLookupKey,
          memberId: input.memberId,
          tx,
        });

        await tx.hostedMemberRouting.upsert({
          where: {
            memberId: input.memberId,
          },
          create: buildHostedMemberLinqBindingCreateData({
            kind: input.kind,
            linqChatLookupKey,
            memberId: input.memberId,
            recipientPhoneLookupKey,
            routingPrivateColumns,
          }),
          update: buildHostedMemberLinqBindingUpdateData({
            clearPending: input.clearPending,
            kind: input.kind,
            linqChatLookupKey,
            recipientPhoneLookupKey,
            routingPrivateColumns,
          }),
        });
      });
      return;
    } catch (error) {
      if (attempt === 0 && isPrismaUniqueConstraintError(error)) {
        continue;
      }

      throw error;
    }
  }
}

function buildHostedMemberLinqBindingCreateData(input: {
  kind: "home" | "pending";
  linqChatLookupKey: string;
  memberId: string;
  recipientPhoneLookupKey: string | null;
  routingPrivateColumns: ReturnType<typeof buildHostedMemberRoutingPrivateColumns>;
}): Prisma.HostedMemberRoutingUncheckedCreateInput {
  return {
    linqChatIdEncrypted: input.kind === "home"
      ? input.routingPrivateColumns.linqChatIdEncrypted
      : null,
    linqChatLookupKey: input.kind === "home" ? input.linqChatLookupKey : null,
    linqRecipientPhoneEncrypted: input.kind === "home"
      ? input.routingPrivateColumns.linqRecipientPhoneEncrypted
      : null,
    linqRecipientPhoneLookupKey: input.kind === "home"
      ? input.recipientPhoneLookupKey
      : null,
    memberId: input.memberId,
    pendingLinqChatIdEncrypted: input.kind === "pending"
      ? input.routingPrivateColumns.pendingLinqChatIdEncrypted
      : null,
    pendingLinqChatLookupKey: input.kind === "pending" ? input.linqChatLookupKey : null,
    pendingLinqRecipientPhoneEncrypted: input.kind === "pending"
      ? input.routingPrivateColumns.pendingLinqRecipientPhoneEncrypted
      : null,
    pendingLinqRecipientPhoneLookupKey: input.kind === "pending"
      ? input.recipientPhoneLookupKey
      : null,
    telegramUserIdEncrypted: null,
    telegramUserLookupKey: null,
  };
}

function buildHostedMemberLinqBindingUpdateData(input: {
  clearPending: boolean;
  kind: "home" | "pending";
  linqChatLookupKey: string;
  recipientPhoneLookupKey: string | null;
  routingPrivateColumns: ReturnType<typeof buildHostedMemberRoutingPrivateColumns>;
}): Prisma.HostedMemberRoutingUncheckedUpdateInput {
  if (input.kind === "home") {
    return {
      linqChatIdEncrypted: input.routingPrivateColumns.linqChatIdEncrypted,
      linqChatLookupKey: input.linqChatLookupKey,
      linqRecipientPhoneEncrypted: input.routingPrivateColumns.linqRecipientPhoneEncrypted,
      linqRecipientPhoneLookupKey: input.recipientPhoneLookupKey,
      ...(input.clearPending
        ? {
            pendingLinqChatIdEncrypted: null,
            pendingLinqChatLookupKey: null,
            pendingLinqRecipientPhoneEncrypted: null,
            pendingLinqRecipientPhoneLookupKey: null,
          }
        : {}),
    };
  }

  return {
    pendingLinqChatIdEncrypted: input.routingPrivateColumns.pendingLinqChatIdEncrypted,
    pendingLinqChatLookupKey: input.linqChatLookupKey,
    pendingLinqRecipientPhoneEncrypted: input.routingPrivateColumns.pendingLinqRecipientPhoneEncrypted,
    pendingLinqRecipientPhoneLookupKey: input.recipientPhoneLookupKey,
  };
}

async function clearHostedMemberLinqChatConflicts(input: {
  linqChatLookupKey: string;
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.hostedMemberRouting.updateMany({
    where: {
      linqChatLookupKey: input.linqChatLookupKey,
      NOT: {
        memberId: input.memberId,
      },
    },
    data: {
      linqChatIdEncrypted: null,
      linqChatLookupKey: null,
      linqRecipientPhoneEncrypted: null,
      linqRecipientPhoneLookupKey: null,
    },
  });

  await input.tx.hostedMemberRouting.updateMany({
    where: {
      pendingLinqChatLookupKey: input.linqChatLookupKey,
      NOT: {
        memberId: input.memberId,
      },
    },
    data: {
      pendingLinqChatIdEncrypted: null,
      pendingLinqChatLookupKey: null,
      pendingLinqRecipientPhoneEncrypted: null,
      pendingLinqRecipientPhoneLookupKey: null,
    },
  });
}

function buildHostedRecipientPhoneLookupEntries(
  recipientPhones: readonly string[],
): Array<{ lookupKey: string; recipientPhone: string }> {
  const seenRecipientPhones = new Set<string>();
  const entries: Array<{ lookupKey: string; recipientPhone: string }> = [];

  for (const value of recipientPhones) {
    const recipientPhone = normalizePhoneNumber(value);

    if (!recipientPhone || seenRecipientPhones.has(recipientPhone)) {
      continue;
    }

    const lookupKey = createHostedPhoneLookupKey(recipientPhone);

    if (!lookupKey) {
      continue;
    }

    seenRecipientPhones.add(recipientPhone);
    entries.push({
      lookupKey,
      recipientPhone,
    });
  }

  return entries;
}

function projectHostedMemberRoutingLookup(
  routing: HostedMemberRoutingLookupRecord,
  matchedBy: HostedMemberRoutingLookupMatch,
): HostedMemberRoutingLookup {
  const routingState = projectHostedMemberRoutingState(routing);

  return {
    core: routing.member,
    matchedBy,
    routing: {
      hasTelegramUserBinding: Boolean(routing.telegramUserLookupKey),
      linqChatId: routingState.linqChatId,
      memberId: routingState.memberId,
    },
  };
}

function isPrismaUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
