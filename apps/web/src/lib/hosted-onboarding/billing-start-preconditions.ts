import { hostedOnboardingError } from "./errors";
import { projectHostedMemberRoutingState } from "./hosted-member-routing-store";
import { isHostedMemberMessagingSetupRequired } from "./messaging-state";
import type { HostedOnboardingReadClient } from "./shared";

export async function assertHostedMemberBillingStartMessagingReady(input: {
  identity: Parameters<typeof isHostedMemberMessagingSetupRequired>[0]["identity"];
  prisma: HostedOnboardingReadClient;
  routing: Parameters<typeof projectHostedMemberRoutingState>[0] | null;
}): Promise<void> {
  if (!isHostedMemberMessagingSetupRequired({
    identity: input.identity,
    routing: input.routing
      ? await projectHostedMemberRoutingState(input.routing, input.prisma)
      : null,
  })) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
    message: "Verify your phone number or connect Telegram before checkout so Murph can message you.",
    httpStatus: 409,
  });
}
