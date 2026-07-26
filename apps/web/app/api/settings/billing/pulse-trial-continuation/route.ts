import { NextResponse } from "next/server";

import {
  getHostedAppSessionFromRequest,
  requireHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import {
  buildHostedPulseTrialContinuationClearCookie,
  buildHostedPulseTrialContinuationCookie,
  readHostedPulseTrialContinuationRequest,
  readHostedPulseTrialPaymentReturnAction,
} from "@/src/lib/hosted-onboarding/billing-pulse-trial-continuation";
import {
  HOSTED_START_PAID_PULSE_RETURN_PARAM,
  HOSTED_START_PAID_PULSE_RETURN_VALUE,
} from "@/src/lib/hosted-onboarding/billing-pulse-trial-continuation-contract";
import {
  continueHostedPulseTrialPaidPlan,
  startHostedPulseTrialPaidPlan,
} from "@/src/lib/hosted-onboarding/billing-start-paid-pulse-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedMemberNotSuspended } from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

export async function GET(request: Request): Promise<Response> {
  const settingsUrl = buildSettingsReturnUrl(request.url, false);
  const auth = await getHostedAppSessionFromRequest(request);
  if (!auth) {
    return NextResponse.redirect(settingsUrl);
  }

  const action = readHostedPulseTrialPaymentReturnAction({
    memberId: auth.member.id,
    request,
  });
  if (action === null) {
    return NextResponse.redirect(settingsUrl);
  }

  const response = NextResponse.redirect(buildSettingsReturnUrl(request.url, true));
  response.headers.append(
    "Set-Cookie",
    buildHostedPulseTrialContinuationCookie({
      action,
      memberId: auth.member.id,
      sessionId: auth.sessionId,
    }),
  );
  return response;
}

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  await assertNoRequestBody(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  assertHostedMemberNotSuspended(auth.member);
  const action = readHostedPulseTrialContinuationRequest({
    memberId: auth.member.id,
    request,
    sessionId: auth.sessionId,
  });
  if (action === null) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_CONTINUATION_INVALID",
      httpStatus: 403,
      message: "Your Pulse confirmation expired. Try again.",
    });
  }

  const result = action === "start_pulse_now"
    ? await startHostedPulseTrialPaidPlan({
        memberId: auth.member.id,
        paymentMethodRecoveryConfirmed: true,
        paymentMethodContinuation: "conversation",
        prisma,
      })
    : await continueHostedPulseTrialPaidPlan({
        memberId: auth.member.id,
        paymentMethodRecoveryConfirmed: true,
        paymentMethodContinuation: "conversation",
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
  if (result.status !== "payment_required") {
    response.headers.append(
      "Set-Cookie",
      buildHostedPulseTrialContinuationClearCookie(),
    );
  }
  return response;
});

function buildSettingsReturnUrl(requestUrl: string, completed: boolean): URL {
  const settingsUrl = new URL("/settings", requestUrl);
  if (completed) {
    settingsUrl.searchParams.set(
      HOSTED_START_PAID_PULSE_RETURN_PARAM,
      HOSTED_START_PAID_PULSE_RETURN_VALUE,
    );
  }
  settingsUrl.hash = "subscription";
  return settingsUrl;
}

async function assertNoRequestBody(request: Request): Promise<void> {
  const body = await readRawBodyBuffer(request, {
    limitBytes: 2_048,
  });
  if (body.toString("utf8").trim().length === 0) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_PULSE_TRIAL_CONTINUATION_BODY_UNSUPPORTED",
    httpStatus: 400,
    message: "This route does not accept a request body.",
  });
}
