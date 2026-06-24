import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { readHostedMemberCoreState } from "@/src/lib/hosted-onboarding/hosted-member-store";
import { issueHostedInviteTx } from "@/src/lib/hosted-onboarding/invite-service";
import { deriveHostedPostVerificationStage } from "@/src/lib/hosted-onboarding/lifecycle";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);

  const { member } = await requireHostedAppSessionFromRequest(request);

  const redirectPath = await getPrisma().$transaction(async (tx) => {
    await lockHostedMemberRow(tx, member.id);
    const currentMember = await readHostedMemberCoreState({
      memberId: member.id,
      prisma: tx,
    });

    if (
      !currentMember
      || deriveHostedPostVerificationStage({
        billingStatus: currentMember.billingStatus,
        suspendedAt: currentMember.suspendedAt,
      }) !== "checkout"
    ) {
      return null;
    }

    const invite = await issueHostedInviteTx({
      channel: "web",
      memberId: currentMember.id,
      prisma: tx,
    });

    return `/join/${encodeURIComponent(invite.inviteCode)}`;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return jsonOk({
    redirectPath,
  });
});
