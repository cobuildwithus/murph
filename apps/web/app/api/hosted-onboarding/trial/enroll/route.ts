import {
  ensureHostedAutoPulseTrialEnrollment,
} from "@/src/lib/hosted-onboarding/auto-trial-enrollment-service";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedInviteCodeFromRequest } from "@/src/lib/hosted-onboarding/route-helpers";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);

  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  const { inviteCode } = await requireHostedInviteCodeFromRequest(request);

  return jsonOk(await ensureHostedAutoPulseTrialEnrollment({
    inviteCode,
    member: {
      id: auth.member.id,
      suspendedAt: auth.member.suspendedAt,
    },
    prisma,
  }));
});
