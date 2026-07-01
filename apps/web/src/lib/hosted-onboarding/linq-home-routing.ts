import { type HostedMemberSnapshot } from "./hosted-member-store";
import {
  acquireHostedMemberHomeLinqRecipientAssignmentLockTx,
  countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince,
  countHostedMemberHomeLinqBindingsByRecipientPhone,
  upsertHostedMemberHomeLinqBindingTx,
  upsertHostedMemberHomeLinqRecipientPhoneTx,
} from "./hosted-member-routing-store";
import { chooseHostedLinqHomeLine } from "./linq-routing-policy";
import {
  type HostedMemberAssistantNotificationRoute,
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "./messaging-state";
import { listHostedLinqAssignableHomeLines } from "./linq-line-store";
import { normalizePhoneNumber } from "./phone";
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

  const target = await resolveHostedMemberActivationTargetRecipientPhone({
    member: input.member,
    prisma: input.prisma,
  });
  const targetRecipientPhone = normalizePhoneNumber(target.recipientPhone);

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
      homeLineAssignedAt: target.homeLineAssignedAt,
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
      message: "Configure an enabled hosted_linq_line row before activating members without an existing Linq conversation thread.",
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
    homeLineAssignedAt: target.homeLineAssignedAt,
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
}): Promise<{ homeLineAssignedAt?: Date; recipientPhone: string | null }> {
  const existingRecipientPhone = normalizePhoneNumber(input.member.routing?.linqRecipientPhone);
  if (existingRecipientPhone) {
    return {
      recipientPhone: existingRecipientPhone,
    };
  }

  await acquireHostedMemberHomeLinqRecipientAssignmentLockTx({
    prisma: input.prisma,
  });

  const lines = await listHostedLinqAssignableHomeLines({
    prisma: input.prisma,
  });
  const recipientPhones = lines.map((line) => line.phoneNumber);

  if (recipientPhones.length === 0) {
    return {
      recipientPhone: null,
    };
  }

  const activeMembersByRecipientPhone = await countHostedMemberHomeLinqBindingsByRecipientPhone({
    prisma: input.prisma,
    recipientPhones,
  });
  const now = new Date();
  const newAssignmentsByRecipientPhone =
    await countHostedMemberHomeLinqAssignmentsByRecipientPhoneSince({
      prisma: input.prisma,
      recipientPhones,
      since: startOfUtcDay(now),
    });

  const chosen = chooseHostedLinqHomeLine({
    activeMembersByRecipientPhone,
    lines,
    newAssignmentsByRecipientPhone,
    preferredRecipientPhone: input.member.routing?.pendingLinqRecipientPhone ?? null,
  });

  return {
    ...(chosen ? { homeLineAssignedAt: now } : {}),
    recipientPhone: chosen?.phoneNumber ?? null,
  };
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}
