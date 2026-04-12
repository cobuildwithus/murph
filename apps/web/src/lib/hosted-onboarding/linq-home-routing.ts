import { type HostedMemberSnapshot } from "./hosted-member-store";
import {
  countHostedMemberHomeLinqBindingsByRecipientPhone,
  upsertHostedMemberHomeLinqBinding,
} from "./hosted-member-routing-store";
import {
  buildHostedLinqConversationHomeWelcome,
  createHostedLinqChat,
} from "./linq";
import { chooseHostedLinqConversationRecipientPhone } from "./linq-routing-policy";
import { normalizePhoneNumber } from "./phone";
import { getHostedOnboardingEnvironment } from "./runtime";
import { type HostedOnboardingPrismaClient } from "./shared";
import { hostedOnboardingError } from "./errors";

export interface HostedMemberActivationLinqRouteResolution {
  firstContactLinqChatId: string | null;
}

export async function resolveHostedMemberActivationLinqRoute(input: {
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingPrismaClient;
  signal?: AbortSignal;
  sourceEventId: string;
  sourceType: string;
}): Promise<HostedMemberActivationLinqRouteResolution> {
  const routing = input.member.routing;

  if (routing?.linqChatId) {
    if (routing.pendingLinqChatId) {
      await upsertHostedMemberHomeLinqBinding({
        clearPending: true,
        linqChatId: routing.linqChatId,
        memberId: input.member.core.id,
        prisma: input.prisma,
        recipientPhone: routing.linqRecipientPhone,
      });
    }

    return {
      firstContactLinqChatId: routing.linqChatId,
    };
  }

  const targetRecipientPhone = normalizePhoneNumber(
    await resolveHostedMemberActivationTargetRecipientPhone({
      member: input.member,
      prisma: input.prisma,
    }),
  );

  if (
    routing?.pendingLinqChatId
    && targetRecipientPhone
    && normalizePhoneNumber(routing.pendingLinqRecipientPhone) === targetRecipientPhone
  ) {
    await upsertHostedMemberHomeLinqBinding({
      clearPending: true,
      linqChatId: routing.pendingLinqChatId,
      memberId: input.member.core.id,
      prisma: input.prisma,
      recipientPhone: targetRecipientPhone,
    });

    return {
      firstContactLinqChatId: routing.pendingLinqChatId,
    };
  }

  if (!targetRecipientPhone) {
    throw hostedOnboardingError({
      code: "LINQ_CONVERSATION_PHONE_REQUIRED",
      message: "Configure HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS before activating members without an existing Linq conversation thread.",
      httpStatus: 500,
    });
  }

  const memberPhoneNumber = input.member.identity?.phoneNumber;

  if (!memberPhoneNumber) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_PHONE_REQUIRED",
      message: "A verified hosted member phone number is required before a Linq home line can be assigned.",
      httpStatus: 500,
    });
  }

  const createdChat = await createHostedLinqChat({
    from: targetRecipientPhone,
    idempotencyKey: buildHostedMemberActivationHomeChatIdempotencyKey({
      memberId: input.member.core.id,
      sourceEventId: input.sourceEventId,
      sourceType: input.sourceType,
    }),
    message: buildHostedLinqConversationHomeWelcome(),
    signal: input.signal,
    to: [memberPhoneNumber],
  });

  if (!createdChat.chatId) {
    throw hostedOnboardingError({
      code: "LINQ_HOME_CHAT_MISSING",
      message: "Linq home-line assignment did not return a chat id.",
      httpStatus: 502,
      retryable: true,
    });
  }

  await upsertHostedMemberHomeLinqBinding({
    clearPending: true,
    linqChatId: createdChat.chatId,
    memberId: input.member.core.id,
    prisma: input.prisma,
    recipientPhone: targetRecipientPhone,
  });

  return {
    firstContactLinqChatId: createdChat.chatId,
  };
}

async function resolveHostedMemberActivationTargetRecipientPhone(input: {
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingPrismaClient;
}): Promise<string | null> {
  const environment = getHostedOnboardingEnvironment();
  const preferredRecipientPhone = input.member.routing?.linqRecipientPhone
    ?? input.member.routing?.pendingLinqRecipientPhone
    ?? null;

  if (environment.linqConversationPhoneNumbers.length === 0) {
    return preferredRecipientPhone;
  }

  const activeMembersByRecipientPhone = await countHostedMemberHomeLinqBindingsByRecipientPhone({
    prisma: input.prisma,
    recipientPhones: environment.linqConversationPhoneNumbers,
  });

  return chooseHostedLinqConversationRecipientPhone({
    activeMembersByRecipientPhone,
    maxActiveMembersPerPhoneNumber: environment.linqMaxActiveMembersPerConversationPhone,
    preferredRecipientPhone,
    recipientPhones: environment.linqConversationPhoneNumbers,
  });
}

function buildHostedMemberActivationHomeChatIdempotencyKey(input: {
  memberId: string;
  sourceEventId: string;
  sourceType: string;
}): string {
  return `member-activation-home:${input.sourceType}:${input.memberId}:${input.sourceEventId}`;
}
