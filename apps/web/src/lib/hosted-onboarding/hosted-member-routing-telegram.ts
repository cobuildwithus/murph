import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { getPrisma } from "../prisma";
import { createHostedTelegramUserLookupKey } from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import { buildHostedMemberRoutingPrivateColumns } from "./member-private-codecs";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "./shared";

export async function upsertHostedMemberTelegramRoutingBindingTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
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

  try {
    await input.prisma.hostedMemberRouting.upsert({
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
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw hostedOnboardingError({
        code: "TELEGRAM_IDENTITY_CONFLICT",
        message:
          "That Telegram account is already linked to a different Murph account. Contact support so we can merge it safely.",
        httpStatus: 409,
      });
    }

    throw error;
  }
}

export async function syncHostedMemberTelegramRoutingBinding(input: {
  memberId: string;
  prisma?: PrismaClient;
  telegramUserId: string;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();

  await prisma.$transaction(
    (tx) => upsertHostedMemberTelegramRoutingBindingTx({
      memberId: input.memberId,
      prisma: tx,
      telegramUserId: input.telegramUserId,
    }),
    HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  );
}

function isPrismaUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
