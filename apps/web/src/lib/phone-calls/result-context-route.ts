import type {
  HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  readHostedMemberAssistantNotificationState,
  type HostedMemberAssistantNotificationState,
} from "../hosted-onboarding/hosted-member-store";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "../hosted-onboarding/messaging-state";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";

export function resolveHostedPhoneCallResultContextRoute(input: {
  member: HostedMemberAssistantNotificationState | null;
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

export async function requireHostedPhoneCallResultContextRoute(input: {
  memberId: string;
  prisma?: HostedOnboardingReadClient;
}): Promise<HostedExecutionAssistantNotificationRoute> {
  const member = await readHostedMemberAssistantNotificationState({
    memberId: input.memberId,
    prisma: input.prisma ?? getPrisma(),
  });
  const route = resolveHostedPhoneCallResultContextRoute({
    member,
    memberId: input.memberId,
  });
  if (!route) {
    throw hostedOnboardingError({
      code: "HOSTED_PHONE_CALL_RESULT_CONTEXT_ROUTE_REQUIRED",
      httpStatus: 409,
      message: "Hosted phone calls require a bound direct result context route.",
      retryable: true,
    });
  }

  return route;
}
