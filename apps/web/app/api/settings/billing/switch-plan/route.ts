import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { parseHostedBillingPlanCode } from "@/src/lib/hosted-onboarding/billing-plans";
import { scheduleHostedBillingPlanSwitch } from "@/src/lib/hosted-onboarding/billing-plan-switch-to-pulse-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readOptionalJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);

  const body = await readOptionalJsonObject(request, {
    limitBytes: 2_048,
  });
  const targetPlanCode = parseHostedBillingPlanCode(body.targetPlanCode);

  if (
    targetPlanCode !== "launch_group_monthly"
    && targetPlanCode !== "launch_monthly"
    && targetPlanCode !== "launch_edge_monthly"
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_SWITCH_TARGET_INVALID",
      httpStatus: 400,
      message:
        "targetPlanCode must be launch_group_monthly, launch_monthly, or launch_edge_monthly.",
    });
  }

  return jsonOk(await scheduleHostedBillingPlanSwitch({
    memberId: auth.member.id,
    prisma,
    targetPlanCode,
  }));
});
