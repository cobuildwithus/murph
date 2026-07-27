import {
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import {
  scheduleHostedBillingPlanSwitch,
} from "@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service";
import {
  requireHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import {
  assertHostedOnboardingMutationOrigin,
} from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  readOptionalJsonObject,
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const body = await readOptionalJsonObject(request, {
    limitBytes: 2_048,
  });
  const targetPlanCode = parseHostedBillingPlanCode(
    body.targetPlanCode,
  );

  if (!targetPlanCode) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_SWITCH_INVALID",
      httpStatus: 400,
      message:
        "targetPlanCode must be a configured Murph billing plan.",
    });
  }

  const result = await scheduleHostedBillingPlanSwitch({
    memberId: auth.member.id,
    prisma: getPrisma(),
    targetPlanCode,
  });

  return jsonOk(result);
});
