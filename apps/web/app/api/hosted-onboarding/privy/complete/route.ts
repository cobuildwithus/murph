import { readHostedAuthenticationResponse } from "@/src/lib/hosted-onboarding/authentication-response";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/authentication-service";
import {
  isHostedPrivyAuthMethod,
  type HostedPrivyAuthMethod,
} from "@/src/lib/hosted-onboarding/types";
import {
  readHostedPrivyVerifiedAuthMethods,
  resolveHostedPrivyAuthMethodFromIdentity,
} from "@/src/lib/hosted-onboarding/privy-auth-method";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { requirePrivyCompletionSession } from "@/src/lib/hosted-onboarding/request-auth";
import {
  getHostedAppSessionFromRequest,
  issueHostedAppSession,
} from "@/src/lib/hosted-onboarding/app-session";
import { resolveHostedSignupTimeZone } from "@/src/lib/hosted-onboarding/time-zone-hint";
import {
  buildHostedSignupNotificationContext,
} from "@/src/lib/hosted-onboarding/signup-notification-context";
import {
  isHostedSignupNotificationEmailConfigured,
} from "@/src/lib/hosted-onboarding/signup-notification-email-config";
import { getPrisma } from "@/src/lib/prisma";
import {
  remapHostedPrivyCompletionLagError,
  type HostedPrivyIdentity,
} from "@/src/lib/hosted-onboarding/privy";

export const POST = withJsonError(async (request: Request) => {
  const timing = startHostedOnboardingTiming("hosted-onboarding.route.privy-complete");

  try {
    assertHostedOnboardingMutationOrigin(request);
    const [auth, existingAppSession] = await Promise.all([
      requirePrivyCompletionSession(request),
      getHostedAppSessionFromRequest(request),
    ]);
    if (
      existingAppSession
      && existingAppSession.privyUserId !== auth.identity.userId
    ) {
      throw privySessionMemberMismatchError();
    }
    const body = await readOptionalJsonObject(request);
    const authMethod = resolveHostedPrivyCompletionAuthMethod({
      body,
      identity: auth.identity,
    });
    const timeZone = resolveHostedSignupTimeZone({
      clientTimeZone: body.timeZone,
      headers: request.headers,
    });
    const now = new Date();
    const signupNotificationContext = isHostedSignupNotificationEmailConfigured()
      ? buildHostedSignupNotificationContext({
          headers: request.headers,
          occurredAt: now,
          surface: "website",
          timeZone,
        })
      : undefined;
    const result = await completeHostedPrivyVerification({
      authMethod,
      identity: auth.identity,
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
      now,
      ...(signupNotificationContext ? { signupNotificationContext } : {}),
      ...(timeZone ? { timeZone } : {}),
    }).catch((error: unknown) => {
      throw remapHostedPrivyCompletionLagError(error);
    });
    if (
      existingAppSession
      && existingAppSession.member.id !== result.memberId
    ) {
      throw privySessionMemberMismatchError();
    }
    const completionResponse = await readHostedAuthenticationResponse(result, getPrisma());
    const appSession = await issueHostedAppSession({
      memberId: result.memberId,
      privyUserId: auth.identity.userId,
    });

    finishHostedOnboardingTiming(timing, "completed", {
      stage: result.stage,
      messagingSetupRequired: result.messagingSetupRequired,
    });

    const response = jsonOk(completionResponse);
    response.headers.append("Set-Cookie", appSession.cookie);
    return response;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
});

function privySessionMemberMismatchError() {
  return hostedOnboardingError({
    code: "PRIVY_SESSION_MEMBER_MISMATCH",
    message:
      "This Privy login does not match your current Murph session. Sign out and sign back in.",
    httpStatus: 409,
  });
}

function resolveHostedPrivyCompletionAuthMethod(input: {
  body: Record<string, unknown>;
  identity: HostedPrivyIdentity;
}): HostedPrivyAuthMethod {
  if ("authIntent" in input.body) {
    const authIntent = input.body.authIntent;
    const method = isRecord(authIntent) ? authIntent.method : undefined;

    if (isHostedPrivyAuthMethod(method)) {
      return method;
    }

    throw hostedOnboardingError({
      code: "HOSTED_AUTH_INTENT_INVALID",
      message: "Choose phone, email, or Telegram before continuing.",
      httpStatus: 400,
    });
  }

  const availableMethods = readHostedPrivyVerifiedAuthMethods(input.identity);

  if (availableMethods.length === 1) {
    return availableMethods[0];
  }

  if (availableMethods.length > 1) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTH_INTENT_REQUIRED",
      message: "Choose phone, email, or Telegram before continuing.",
      httpStatus: 400,
    });
  }

  return resolveHostedPrivyAuthMethodFromIdentity({
    identity: input.identity,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
