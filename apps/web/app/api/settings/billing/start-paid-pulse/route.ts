import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import {
  buildHostedStartPaidPulseContinuationClearCookie,
  buildHostedStartPaidPulseContinuationCookie,
  hasHostedStartPaidPulseContinuationRequest,
} from "@/src/lib/hosted-onboarding/billing-start-paid-pulse-continuation";
import { HOSTED_START_PAID_PULSE_CONTINUATION_HEADER } from "@/src/lib/hosted-onboarding/billing-start-paid-pulse-continuation-contract";
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
  const automaticContinuation = readAutomaticContinuation(request);

  if (
    automaticContinuation
    && !hasHostedStartPaidPulseContinuationRequest({
      memberId: auth.member.id,
      request,
      sessionId: auth.sessionId,
    })
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_START_PAID_CONTINUATION_INVALID",
      httpStatus: 403,
      message: "Your Start Pulse confirmation expired. Try again.",
    });
  }

  const result = await startHostedPulseTrialPaidPlan({
    browserContinuationAfterPaymentMethodSetup: true,
    memberId: auth.member.id,
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
  response.headers.append(
    "Set-Cookie",
    result.status === "payment_required"
      && result.resumeStartAfterPaymentMethodSetup === true
      && !automaticContinuation
      ? buildHostedStartPaidPulseContinuationCookie({
        memberId: auth.member.id,
        sessionId: auth.sessionId,
      })
      : buildHostedStartPaidPulseContinuationClearCookie(),
  );
  return response;
});

function readAutomaticContinuation(request: Request): boolean {
  const value = request.headers.get(HOSTED_START_PAID_PULSE_CONTINUATION_HEADER);
  if (value === null) {
    return false;
  }

  if (value === "1") {
    return true;
  }

  throw hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_START_PAID_CONTINUATION_INVALID",
    httpStatus: 400,
    message: "Start Pulse continuation is invalid.",
  });
}

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
