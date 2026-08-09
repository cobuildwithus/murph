import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { parseHostedBillingPlanCode } from "@/src/lib/hosted-onboarding/billing-plans";
import { upgradeHostedBillingPlan } from "@/src/lib/hosted-onboarding/billing-plan-change-service";
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
  const expectedCurrentPlanCode = parseHostedBillingPlanCode(
    body.expectedCurrentPlanCode,
  );

  if (
    targetPlanCode !== "launch_monthly"
    && targetPlanCode !== "launch_edge_monthly"
    && targetPlanCode !== "launch_max_monthly"
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_TARGET_INVALID",
      httpStatus: 400,
      message:
        "targetPlanCode must be launch_monthly, launch_edge_monthly, or launch_max_monthly.",
    });
  }
  if (
    !expectedCurrentPlanCode
    || expectedCurrentPlanCode === targetPlanCode
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_UPGRADE_SOURCE_INVALID",
      httpStatus: 400,
      message: "Confirm the current plan before upgrading.",
    });
  }

  const result = await upgradeHostedBillingPlan({
    expectedCurrentPlanCode,
    memberId: auth.member.id,
    prisma,
    targetPlanCode,
  });

  return jsonOk(result);
});
