import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import {
  buildHostedPulseTrialContinuationCookie,
} from "@/src/lib/hosted-onboarding/billing-pulse-trial-continuation";
import {
  startHostedTrialPaidPlan,
  type HostedTrialPaidPlanCode,
} from "@/src/lib/hosted-onboarding/billing-start-paid-pulse-service";
import { parseHostedBillingPlanCode } from "@/src/lib/hosted-onboarding/billing-plans";
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
  const body = await readOptionalJsonObject(request, {
    limitBytes: 2_048,
  });
  const targetPlanCode =
    body.targetPlanCode === undefined
      ? "launch_monthly"
      : parseHostedTrialPaidPlanCode(body.targetPlanCode);
  const timing = parseHostedTrialPaidPlanTiming(body.timing);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);

  const result = await startHostedTrialPaidPlan({
    memberId: auth.member.id,
    ...(targetPlanCode === "launch_monthly" && timing === "now"
      ? { paymentMethodContinuation: "settings" as const }
      : {}),
    prisma,
    targetPlanCode,
    timing,
  });

  const response = jsonOk(
    result.status === "payment_required"
      ? {
        billingPlanCode: result.billingPlanCode,
        paymentUrl: result.paymentUrl,
        status: result.status,
      }
      : result,
  );
  if (
    result.status === "payment_required"
    && result.billingPlanCode === "launch_monthly"
    && timing === "now"
    && result.resumeStartAfterPaymentMethodSetup === true
  ) {
    response.headers.append(
      "Set-Cookie",
      buildHostedPulseTrialContinuationCookie({
        action: "start_pulse_now",
        memberId: auth.member.id,
        sessionId: auth.sessionId,
      }),
    );
  }
  return response;
});

function parseHostedTrialPaidPlanTiming(
  value: unknown,
): "at_trial_end" | "now" {
  if (value === undefined || value === "now") {
    return "now";
  }
  if (value === "at_trial_end") {
    return value;
  }
  throw hostedOnboardingError({
    code: "HOSTED_TRIAL_START_PAID_TIMING_INVALID",
    httpStatus: 400,
    message: "Choose whether the paid plan starts now or after the trial.",
  });
}

function parseHostedTrialPaidPlanCode(
  value: unknown,
): HostedTrialPaidPlanCode {
  const planCode = parseHostedBillingPlanCode(value);
  if (
    planCode === "launch_group_monthly"
    || planCode === "launch_monthly"
  ) {
    return planCode;
  }

  throw hostedOnboardingError({
    code: "HOSTED_TRIAL_START_PAID_PLAN_INVALID",
    httpStatus: 400,
    message: "Choose Group or Pulse before starting a paid trial plan.",
  });
}
