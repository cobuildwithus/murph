import { hostedOnboardingError } from "./errors";
import { projectHostedMemberRoutingState } from "./hosted-member-routing-store";
import {
  resolveHostedMemberMessagingState,
} from "./messaging-state";
import type { HostedOnboardingReadClient } from "./shared";

export async function assertHostedMemberBillingStartMessagingReady(input: {
  identity: Parameters<typeof resolveHostedMemberMessagingState>[0]["identity"];
  prisma: HostedOnboardingReadClient;
  routing: Parameters<typeof projectHostedMemberRoutingState>[0] | null;
}): Promise<void> {
  const routing = input.routing
    ? await projectHostedMemberRoutingState(input.routing, input.prisma)
    : null;
  if (resolveHostedMemberMessagingState({
    identity: input.identity,
    routing,
  }).hasDirectMessagingChannel) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
    message:
      "Verify your phone number or message Murph on Telegram before checkout so Murph can reply.",
    httpStatus: 409,
  });
}
