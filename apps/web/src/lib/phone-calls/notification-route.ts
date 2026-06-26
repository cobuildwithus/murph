import type {
  HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  readHostedMemberSnapshot,
  type HostedMemberSnapshot,
} from "../hosted-onboarding/hosted-member-store";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "../hosted-onboarding/messaging-state";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";

export function resolveHostedPhoneCallResultNotificationRoute(input: {
  member: HostedMemberSnapshot | null;
  memberId: string;
}): HostedExecutionAssistantNotificationRoute | null {
  const member = input.member;
  if (!member) {
    return null;
  }

  const messaging = resolveHostedMemberMessagingState({
    identity: member.identity,
    routing: member.routing,
  });

  return resolveHostedMemberAssistantNotificationRoute({
    linqChatId: member.routing?.linqChatId ?? member.routing?.pendingLinqChatId ?? null,
    linqContactLookupKey: member.routing?.pendingLinqParticipantContact?.lookupKey ?? null,
    linqRecipientPhone: member.routing?.linqRecipientPhone ?? member.routing?.pendingLinqRecipientPhone ?? null,
    memberId: input.memberId,
    memberPhoneNumber: member.identity?.phoneNumber ?? null,
    messaging,
  });
}

export async function requireHostedPhoneCallResultNotificationRoute(input: {
  memberId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<HostedExecutionAssistantNotificationRoute> {
  const member = await readHostedMemberSnapshot({
    memberId: input.memberId,
    prisma: input.prisma ?? getPrisma(),
  });
  const route = resolveHostedPhoneCallResultNotificationRoute({
    member,
    memberId: input.memberId,
  });
  if (!route) {
    throw hostedOnboardingError({
      code: "HOSTED_PHONE_CALL_NOTIFICATION_ROUTE_REQUIRED",
      httpStatus: 409,
      message: "Hosted phone calls require a deliverable result notification route.",
      retryable: true,
    });
  }

  return route;
}
