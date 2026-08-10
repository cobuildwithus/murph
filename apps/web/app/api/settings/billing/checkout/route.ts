import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import {
  assertHostedBillingPlanSelectable,
} from "@/src/lib/hosted-onboarding/billing-plan-eligibility";
import {
  parseHostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { createHostedBillingCheckout } from "@/src/lib/hosted-onboarding/billing-service";
import { issueHostedInvite } from "@/src/lib/hosted-onboarding/invite-service";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const body = await readOptionalJsonObject(request, {
    limitBytes: 1_024,
  });
  const billingPlanCode = parseHostedBillingPlanCode(body.billingPlanCode);
  if (!billingPlanCode) {
    throw hostedOnboardingError({
      code: "HOSTED_BILLING_PLAN_INVALID",
      httpStatus: 400,
      message: "Choose a valid Murph plan.",
    });
  }

  await assertHostedBillingPlanSelectable({
    memberId: auth.member.id,
    prisma,
    targetPlanCode: billingPlanCode,
  });
  const invite = await issueHostedInvite({
    channel: "web",
    memberId: auth.member.id,
    prisma,
  });
  const checkout = await createHostedBillingCheckout({
    billingPlanCode,
    inviteCode: invite.inviteCode,
    member: {
      id: auth.member.id,
      suspendedAt: auth.member.suspendedAt,
    },
    prisma,
  });

  return jsonOk(checkout);
});
