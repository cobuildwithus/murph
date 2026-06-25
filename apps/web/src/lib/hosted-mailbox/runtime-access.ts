import {
  hasHostedMemberActiveAccess,
} from "../hosted-onboarding/entitlement";
import {
  hostedOnboardingError,
} from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";

interface HostedRuntimeMailboxActiveAccessOptions {
  code?: string;
  message?: string;
}

// Shared fail-closed gate for the internal hosted-mailbox runtime routes
// (fetch, payload fetch, and consume): only members with active hosted access
// and, for thread containers, active owner authority may touch mailbox runtime
// surfaces.
export async function requireHostedRuntimeMailboxActiveAccess(
  userId: string,
  options: HostedRuntimeMailboxActiveAccessOptions = {},
): Promise<void> {
  const member = await getPrisma().hostedMember.findUnique({
    where: {
      id: userId,
    },
    select: {
      billingStatus: true,
      suspendedAt: true,
      threadContainer: {
        select: {
          owner: {
            select: {
              billingStatus: true,
              suspendedAt: true,
            },
          },
        },
      },
    },
  });

  if (
    member
    && hasHostedMemberActiveAccess(member)
    && (
      !member.threadContainer
      || hasHostedMemberActiveAccess(member.threadContainer.owner)
    )
  ) {
    return;
  }

  throw hostedOnboardingError({
    code: options.code ?? "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE",
    httpStatus: 403,
    message: options.message ?? "Hosted runtime mailbox access is not active.",
  });
}
