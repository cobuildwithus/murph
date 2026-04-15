import { type HostedMemberSnapshot } from "./hosted-member-store";
import {
  countHostedMemberHomeLinqBindingsByRecipientPhone,
  upsertHostedMemberHomeLinqBinding,
  upsertHostedMemberHomeLinqRecipientPhone,
} from "./hosted-member-routing-store";
import { chooseHostedLinqConversationRecipientPhone } from "./linq-routing-policy";
import {
  resolveHostedMemberFirstContactTarget,
  resolveHostedMemberMessagingState,
} from "./messaging-state";
import { normalizePhoneNumber } from "./phone";
import { getHostedOnboardingEnvironment } from "./runtime";
import { type HostedOnboardingPrismaClient } from "./shared";
import { hostedOnboardingError } from "./errors";
import type { HostedExecutionMemberActivatedEvent } from "@murphai/hosted-execution";

export interface HostedMemberActivationLinqRouteResolution {
  firstContact: HostedExecutionMemberActivatedEvent["firstContact"];
}

export async function resolveHostedMemberActivationLinqRoute(input: {
  member: HostedMemberSnapshot;
  prisma: HostedOnboardingPrismaClient;
}): Promise<HostedMemberActivationLinqRouteResolution> {
  const routing = input.member.routing;
  const messaging = resolveHostedMemberMessagingState({
    identity: input.member.identity,
    routing,
  });

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
      firstContact: resolveHostedMemberFirstContactTarget({
        linqChatId: routing.linqChatId,
        messaging,
      }),
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
      firstContact: resolveHostedMemberFirstContactTarget({
        linqChatId: routing.pendingLinqChatId,
        messaging,
      }),
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

  await upsertHostedMemberHomeLinqRecipientPhone({
    clearPending: true,
    memberId: input.member.core.id,
    prisma: input.prisma,
    recipientPhone: targetRecipientPhone,
  });

  return {
    firstContact: resolveHostedMemberFirstContactTarget({
      linqChatId: null,
      linqRecipientPhone: targetRecipientPhone,
      memberPhoneNumber,
      messaging,
    }),
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
