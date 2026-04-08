/**
 * Owns hosted member messaging-routing lookup and binding surfaces.
 */
import { type HostedMember, Prisma } from "@prisma/client";

import {
  createHostedLinqChatLookupKey,
  createHostedTelegramUserLookupKey,
  createHostedTelegramUserLookupKeyReadCandidates,
} from "./contact-privacy";
import {
  buildHostedMemberRoutingPrivateColumns,
  readHostedMemberRoutingPrivateState,
} from "./member-private-codecs";
import {
  type HostedOnboardingPrismaClient,
  withHostedOnboardingTransaction,
} from "./shared";

const hostedMemberRoutingStateSelect = Prisma.validator<Prisma.HostedMemberRoutingSelect>()({
  linqChatIdEncrypted: true,
  memberId: true,
  telegramUserLookupKey: true,
  telegramUserIdEncrypted: true,
});

type HostedMemberRoutingRecord = Prisma.HostedMemberRoutingGetPayload<{
  select: typeof hostedMemberRoutingStateSelect;
}>;

const hostedMemberRoutingLookupSelect = Prisma.validator<Prisma.HostedMemberRoutingSelect>()({
  linqChatIdEncrypted: true,
  memberId: true,
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
  memberId: string;
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

export async function upsertHostedMemberLinqChatBinding(input: {
  linqChatId: string | null;
  memberId: string;
  prisma: HostedOnboardingPrismaClient;
}): Promise<void> {
  const linqChatLookupKey = createHostedLinqChatLookupKey(input.linqChatId);

  if (!linqChatLookupKey) {
    return;
  }

  const routingPrivateColumns = buildHostedMemberRoutingPrivateColumns({
    linqChatId: input.linqChatId,
    memberId: input.memberId,
    telegramUserId: null,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await withHostedOnboardingTransaction(input.prisma, async (tx) => {
        // Hosted Linq replies and activation welcomes reuse the direct thread id, so
        // the latest observed chat binding must be exclusive to one member.
        await tx.hostedMemberRouting.updateMany({
          where: {
            linqChatLookupKey,
            NOT: {
              memberId: input.memberId,
            },
          },
          data: {
            linqChatIdEncrypted: null,
            linqChatLookupKey: null,
          },
        });

        await tx.hostedMemberRouting.upsert({
          where: {
            memberId: input.memberId,
          },
          create: {
            ...routingPrivateColumns,
            memberId: input.memberId,
            linqChatLookupKey,
            telegramUserLookupKey: null,
          },
          update: {
            linqChatIdEncrypted: routingPrivateColumns.linqChatIdEncrypted,
            linqChatLookupKey,
          },
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
    memberId: input.memberId,
    telegramUserId: input.telegramUserId,
  });

  await withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await tx.hostedMemberRouting.upsert({
      where: {
        memberId: input.memberId,
      },
      create: {
        ...routingPrivateColumns,
        memberId: input.memberId,
        linqChatLookupKey: null,
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
    memberId: routing.memberId,
    telegramUserLookupKey: routing.telegramUserLookupKey ?? null,
  };
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
