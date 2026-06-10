import {
  hasHostedMemberActiveAccess,
} from "../hosted-onboarding/entitlement";
import {
  hostedOnboardingError,
} from "../hosted-onboarding/errors";
import {
  readHostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import { getPrisma } from "../prisma";

// Shared fail-closed gate for the internal hosted-mailbox runtime routes
// (fetch and consume): only members with active hosted access may touch their
// mailbox runtime surface.
export async function requireHostedRuntimeMailboxActiveAccess(userId: string): Promise<void> {
  const member = await readHostedMemberCoreState({
    memberId: userId,
    prisma: getPrisma(),
  });

  if (member && hasHostedMemberActiveAccess(member)) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_RUNTIME_MAILBOX_USER_INACTIVE",
    httpStatus: 403,
    message: "Hosted runtime mailbox access is not active.",
  });
}
