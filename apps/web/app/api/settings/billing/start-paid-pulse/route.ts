import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import {
  buildHostedPulseTrialContinuationCookie,
} from "@/src/lib/hosted-onboarding/billing-pulse-trial-continuation";
import { startHostedPulseTrialPaidPlan } from "@/src/lib/hosted-onboarding/billing-start-paid-pulse-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  await assertNoRequestBody(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);

  const result = await startHostedPulseTrialPaidPlan({
    memberId: auth.member.id,
    paymentMethodContinuation: "settings",
    prisma,
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

async function assertNoRequestBody(request: Request): Promise<void> {
  const body = await readRawBodyBuffer(request, {
    limitBytes: 2_048,
  });

  if (body.toString("utf8").trim().length === 0) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_BODY_UNSUPPORTED",
    httpStatus: 400,
    message: "This route does not accept a request body.",
  });
}
