import { Prisma } from "@prisma/client";
import { parseTelegramThreadTarget } from "@murphai/messaging-ingress/telegram-webhook";

import {
  createHostedTelegramUserLookupKey,
  createHostedTelegramUserLookupKeyReadCandidates,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import {
  buildHostedMemberRoutingPrivateColumns,
  readHostedMemberRoutingTelegramPrivateState,
} from "./member-private-codecs";
import {
  lockHostedMemberRow,
} from "./shared";

export async function upsertHostedMemberTelegramRoutingBindingTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  telegramThreadId?: string | null;
  telegramUserId: string;
}): Promise<{ effectiveRouteChanged: boolean }> {
  const telegramUserLookupKey = createHostedTelegramUserLookupKey(input.telegramUserId);

  if (!telegramUserLookupKey) {
    throw new TypeError("Hosted Telegram routing requires a non-empty Telegram user id.");
  }

  await lockHostedMemberRow(input.prisma, input.memberId);
  await assertHostedMemberTelegramRoutingBindingAvailableTx({
    memberId: input.memberId,
    prisma: input.prisma,
    telegramUserId: input.telegramUserId,
  });
  const existingRouting = await input.prisma.hostedMemberRouting.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: {
      memberId: true,
      telegramUserIdEncrypted: true,
    },
  });
  const existingTelegramRouting = existingRouting
    ? await readHostedMemberRoutingTelegramPrivateState(existingRouting, input.prisma)
    : null;
  const preferredTelegramThreadId =
    existingTelegramRouting?.telegramUserId === input.telegramUserId
      ? choosePreferredTelegramThreadTarget({
        existingTelegramThreadId: existingTelegramRouting.telegramThreadId,
        incomingTelegramThreadId: input.telegramThreadId ?? null,
      })
      : null;
  const effectiveTelegramThreadId =
    preferredTelegramThreadId ?? input.telegramThreadId ?? null;
  const effectiveRouteChanged =
    !existingTelegramRouting
    || existingTelegramRouting.telegramUserId !== input.telegramUserId
    || existingTelegramRouting.telegramThreadId !== effectiveTelegramThreadId;

  const routingPrivateColumns = await buildHostedMemberRoutingPrivateColumns({
    linqChatId: null,
    linqRecipientPhone: null,
    memberId: input.memberId,
    pendingLinqChatId: null,
    pendingLinqParticipantContact: null,
    pendingLinqRecipientPhone: null,
    prisma: input.prisma,
    telegramThreadId: effectiveTelegramThreadId,
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
      throw buildHostedTelegramIdentityConflictError();
    }

    throw error;
  }

  return { effectiveRouteChanged };
}

function isPrismaUniqueConstraintError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function assertHostedMemberTelegramRoutingBindingAvailableTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
  telegramUserId: string;
}): Promise<void> {
  const telegramUserLookupKeys = createHostedTelegramUserLookupKeyReadCandidates(
    input.telegramUserId,
  );

  if (telegramUserLookupKeys.length === 0) {
    throw new TypeError("Hosted Telegram routing requires a non-empty Telegram user id.");
  }

  const existingBindings = await input.prisma.hostedMemberRouting.findMany({
    where: {
      telegramUserLookupKey: {
        in: telegramUserLookupKeys,
      },
    },
    select: {
      memberId: true,
    },
  });

  const conflictingMemberIds = new Set(
    existingBindings
      .map((binding) => binding.memberId)
      .filter((memberId) => memberId !== input.memberId),
  );

  if (conflictingMemberIds.size > 0) {
    throw buildHostedTelegramIdentityConflictError();
  }
}

function buildHostedTelegramIdentityConflictError() {
  return hostedOnboardingError({
    code: "TELEGRAM_IDENTITY_CONFLICT",
    message:
      "That Telegram account is already linked to a different Murph account. Contact support so we can merge it safely.",
    httpStatus: 409,
  });
}

function choosePreferredTelegramThreadTarget(input: {
  existingTelegramThreadId: string | null;
  incomingTelegramThreadId: string | null;
}): string | null {
  if (!input.incomingTelegramThreadId) {
    return input.existingTelegramThreadId;
  }

  if (!input.existingTelegramThreadId) {
    return input.incomingTelegramThreadId;
  }

  const incomingSpecificity = scoreTelegramThreadTargetSpecificity(
    input.incomingTelegramThreadId,
  );
  const existingSpecificity = scoreTelegramThreadTargetSpecificity(
    input.existingTelegramThreadId,
  );

  return incomingSpecificity >= existingSpecificity
    ? input.incomingTelegramThreadId
    : input.existingTelegramThreadId;
}

function scoreTelegramThreadTargetSpecificity(target: string): number {
  const parsed = parseTelegramThreadTarget(target);

  if (!parsed) {
    return -1;
  }

  let score = 0;

  if (parsed.businessConnectionId) {
    score += 1;
  }

  if (parsed.directMessagesTopicId) {
    score += 1;
  }

  return score;
}
