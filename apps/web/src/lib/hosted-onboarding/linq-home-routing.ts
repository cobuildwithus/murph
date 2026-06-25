import { type HostedMemberSnapshot } from "./hosted-member-store";
import {
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx,
  countHostedMemberHomeLinqBindingsByRecipientPhone,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
} from "./hosted-member-routing-store";
import { chooseHostedLinqConversationRecipientPhone } from "./linq-routing-policy";
import {
  type HostedMemberAssistantNotificationRoute,
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "./messaging-state";
import {
  syncHostedLinqConfiguredLinesTx,
} from "./linq-line-store";
import { normalizePhoneNumber } from "./phone";
import { getHostedOnboardingEnvironment } from "./runtime";
import { hostedOnboardingError } from "./errors";
import type { Prisma } from "@prisma/client";

export interface HostedMemberActivationLinqRouteResolution {
  welcomeRoute: HostedMemberAssistantNotificationRoute;
}

export async function resolveHostedMemberActivationLinqRoute(input: {
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberActivationLinqRouteResolution> {
  const routing = input.member.routing;
  const messaging = resolveHostedMemberMessagingState({
    identity: input.member.identity,
    routing,
  });
  const memberPhoneNumber = input.member.identity?.phoneNumber ?? null;
  const linqContactLookupKey =
    input.member.identity?.phoneLookupKey
    ?? routing?.pendingLinqParticipantContact?.lookupKey
    ?? input.member.emailAuthorization?.verifiedEmail?.lookupKey
    ?? null;

  if (routing?.linqChatId) {
    if (routing.pendingLinqChatId) {
      await upsertHostedMemberHomeLinqBindingTx({
        clearPending: true,
        linqChatId: routing.linqChatId,
        memberId: input.member.core.id,
        prisma: input.prisma,
        recipientPhone: routing.linqRecipientPhone,
      });
    }

    return {
      welcomeRoute: resolveHostedMemberAssistantNotificationRoute({
        linqChatId: routing.linqChatId,
        linqContactLookupKey,
        memberId: input.member.core.id,
        memberPhoneNumber,
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

  const pendingLinqRecipientPhone = normalizePhoneNumber(routing?.pendingLinqRecipientPhone);

  if (
    routing?.pendingLinqChatId
    && linqContactLookupKey
    && (
      memberPhoneNumber
        ? targetRecipientPhone !== null && pendingLinqRecipientPhone === targetRecipientPhone
        : true
    )
  ) {
    const promotedRecipientPhone =
      pendingLinqRecipientPhone ?? targetRecipientPhone;
    await upsertHostedMemberHomeLinqBindingTx({
      clearPending: true,
      linqChatId: routing.pendingLinqChatId,
      memberId: input.member.core.id,
      prisma: input.prisma,
      recipientPhone: promotedRecipientPhone,
    });

    return {
      welcomeRoute: resolveHostedMemberAssistantNotificationRoute({
        linqChatId: routing.pendingLinqChatId,
        linqContactLookupKey,
        memberId: input.member.core.id,
        memberPhoneNumber,
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

  if (!memberPhoneNumber) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_PHONE_REQUIRED",
      message: "A verified hosted member phone number is required before a Linq home line can be assigned.",
      httpStatus: 500,
    });
  }

  await upsertHostedMemberHomeLinqRecipientPhoneTx({
    clearPending: true,
    memberId: input.member.core.id,
    prisma: input.prisma,
    recipientPhone: targetRecipientPhone,
  });

  return {
    welcomeRoute: resolveHostedMemberAssistantNotificationRoute({
      linqChatId: null,
      linqRecipientPhone: targetRecipientPhone,
      memberId: input.member.core.id,
      memberPhoneNumber,
      messaging,
    }),
  };
}

async function resolveHostedMemberActivationTargetRecipientPhone(input: {
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<string | null> {
  const environment = getHostedOnboardingEnvironment();
  const preferredRecipientPhone = input.member.routing?.linqRecipientPhone
    ?? input.member.routing?.pendingLinqRecipientPhone
    ?? null;

  if (environment.linqConversationPhoneNumbers.length === 0) {
    return preferredRecipientPhone;
  }

  await acquireHostedMemberHomeLinqRecipientAssignmentLockTx({
    prisma: input.prisma,
  });

  await syncHostedLinqConfiguredLinesTx({
    activeMemberLimit: environment.linqMaxActiveMembersPerConversationPhone,
    phoneNumbers: environment.linqConversationPhoneNumbers,
    prisma: input.prisma,
  });

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
