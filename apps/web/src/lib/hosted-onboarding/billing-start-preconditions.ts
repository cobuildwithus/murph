import { hostedOnboardingError } from "./errors";
import { projectHostedMemberRoutingState } from "./hosted-member-routing-store";
import { isHostedMemberMessagingSetupRequired } from "./messaging-state";
import type { HostedOnboardingReadClient } from "./shared";

type HostedBillingMessagingIdentity = Exclude<
  Parameters<typeof isHostedMemberMessagingSetupRequired>[0]["identity"],
  null
> & {
  memberId?: string | null;
};

export async function assertHostedMemberBillingStartMessagingReady(input: {
  identity: HostedBillingMessagingIdentity | null;
  prisma: HostedOnboardingReadClient;
  routing: Parameters<typeof projectHostedMemberRoutingState>[0] | null;
}): Promise<void> {
  const routing = input.routing
    ? await projectHostedMemberRoutingState(input.routing, input.prisma)
    : null;

  if (!isHostedMemberMessagingSetupRequired({
    identity: input.identity,
    routing,
  })) {
    return;
  }

  const memberId = input.identity?.memberId ?? input.routing?.memberId ?? null;
  const emailAuthorization = memberId
    ? await input.prisma.hostedMemberEmailAuthorization.findUnique({
        select: {
          verifiedEmailVerifiedAt: true,
        },
        where: {
          memberId,
        },
      })
    : null;

  if (!isHostedMemberMessagingSetupRequired({
    identity: {
      ...(input.identity ?? {}),
      emailLinked: Boolean(emailAuthorization?.verifiedEmailVerifiedAt),
    },
    routing,
  })) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
    message:
      "Verify a phone number or email address, or connect Telegram before checkout so Murph can message you.",
    httpStatus: 409,
  });
}
