import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { scheduleHostedBillingPlanSwitchToPulse } from "@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const maxDuration = 800;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);

  const result = await scheduleHostedBillingPlanSwitchToPulse({
    memberId: auth.member.id,
    prisma,
  });

  return jsonOk(result);
});
