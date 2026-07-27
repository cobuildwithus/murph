import { NextResponse } from "next/server";

import {
  getHostedAppSessionFromRequest,
  requireHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import {
  buildHostedPulseTrialContinuationCookie,
  readHostedPulseTrialContinuationRequest,
  readHostedPulseTrialPaymentReturnAction,
} from "@/src/lib/hosted-onboarding/billing-pulse-trial-continuation";
import {
  HOSTED_PULSE_TRIAL_CONTINUATION_ACTION_HEADER,
  HOSTED_PULSE_TRIAL_CONTINUATION_ACTION_PARAM,
  HOSTED_PULSE_TRIAL_CONTINUATION_EXPIRES_PARAM,
  HOSTED_PULSE_TRIAL_CONTINUATION_SIGNATURE_PARAM,
  HOSTED_START_PAID_PULSE_RETURN_PARAM,
  HOSTED_START_PAID_PULSE_RETURN_VALUE,
  type HostedPulseTrialContinuationAction,
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
    // The signature is bound to a member id that is not in the URL, so it can
    // only be verified once a session exists. Carry the signed params to
    // settings, which prompts for sign-in and then sends them back here.
    return NextResponse.redirect(buildSignedInReturnUrl(request.url));
  }

  const action = readHostedPulseTrialPaymentReturnAction({
    memberId: auth.member.id,
    request,
  });
  // Drop the params on a failed verification so settings stops handing the
  // request back here and the visitor cannot be bounced in a loop.
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
  const renderedAction = readRenderedContinuationAction(request);
  if (renderedAction !== action) {
    throw hostedOnboardingError({
      code: "HOSTED_PULSE_TRIAL_CONTINUATION_CHANGED",
      httpStatus: 409,
      message:
        "This Pulse choice changed in another tab. Continue from the latest return.",
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
  return jsonOk(
    result.status === "payment_required"
      ? {
        billingPlanCode: result.billingPlanCode,
        paymentUrl: result.paymentUrl,
        status: result.status,
      }
      : result,
  );
});

function buildSignedInReturnUrl(requestUrl: string): URL {
  const requested = new URL(requestUrl);
  const settingsUrl = new URL("/settings", requestUrl);

  for (const param of [
    HOSTED_PULSE_TRIAL_CONTINUATION_ACTION_PARAM,
    HOSTED_PULSE_TRIAL_CONTINUATION_EXPIRES_PARAM,
    HOSTED_PULSE_TRIAL_CONTINUATION_SIGNATURE_PARAM,
  ]) {
    const values = requested.searchParams.getAll(param);
    if (values.length === 1) {
      settingsUrl.searchParams.set(param, values[0]);
    }
  }

  settingsUrl.hash = "subscription";
  return settingsUrl;
}

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

function readRenderedContinuationAction(
  request: Request,
): HostedPulseTrialContinuationAction | null {
  const value = request.headers.get(
    HOSTED_PULSE_TRIAL_CONTINUATION_ACTION_HEADER,
  );
  return value === "continue_pulse" || value === "start_pulse_now"
    ? value
    : null;
}
