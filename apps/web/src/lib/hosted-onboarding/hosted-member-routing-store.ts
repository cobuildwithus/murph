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

export interface HostedMemberRoutingStateSnapshot {
  linqChatId: string | null;
  memberId: string;
  telegramUserLookupKey: string | null;
}

export type HostedMemberTelegramLookupSnapshot = Pick<
  HostedMember,
  "billingStatus" | "id" | "suspendedAt"
>;

export async function findHostedMemberByTelegramUserLookupKey(input: {
  prisma: HostedOnboardingPrismaClient;
  telegramUserLookupKey: string;
}): Promise<HostedMemberTelegramLookupSnapshot | null> {
  const routingRecord = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      telegramUserLookupKey: input.telegramUserLookupKey,
    },
    select: {
      member: {
        select: {
          billingStatus: true,
          id: true,
          suspendedAt: true,
        },
      },
    },
  });

  return routingRecord?.member ?? null;
}

export async function findHostedMemberByTelegramUserId(input: {
  prisma: HostedOnboardingPrismaClient;
  telegramUserId: string;
}): Promise<HostedMemberTelegramLookupSnapshot | null> {
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
    select: {
      member: {
        select: {
          billingStatus: true,
          id: true,
          suspendedAt: true,
        },
      },
    },
  });

  return routingRecord?.member ?? null;
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
            ...buildHostedMemberRoutingPrivateColumns({
              linqChatId: input.linqChatId,
              memberId: input.memberId,
              telegramUserId: null,
            }),
            memberId: input.memberId,
            linqChatLookupKey,
            telegramUserLookupKey: null,
          },
          update: {
            linqChatIdEncrypted: buildHostedMemberRoutingPrivateColumns({
              linqChatId: input.linqChatId,
              memberId: input.memberId,
              telegramUserId: null,
            }).linqChatIdEncrypted,
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

  await withHostedOnboardingTransaction(input.prisma, async (tx) => {
    await tx.hostedMemberRouting.upsert({
      where: {
        memberId: input.memberId,
      },
      create: {
        ...buildHostedMemberRoutingPrivateColumns({
          linqChatId: null,
          memberId: input.memberId,
          telegramUserId: input.telegramUserId,
        }),
        memberId: input.memberId,
        linqChatLookupKey: null,
        telegramUserLookupKey,
      },
      update: {
        telegramUserIdEncrypted: buildHostedMemberRoutingPrivateColumns({
          linqChatId: null,
          memberId: input.memberId,
          telegramUserId: input.telegramUserId,
        }).telegramUserIdEncrypted,
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

function isPrismaUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
