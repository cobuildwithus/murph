import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/member-service";
import {
  isHostedPrivyAuthMethod,
  type HostedPrivyAuthMethod,
} from "@/src/lib/hosted-onboarding/types";
import {
  readHostedPrivyVerifiedAuthMethods,
  resolveHostedPrivyAuthMethodFromIdentity,
} from "@/src/lib/hosted-onboarding/privy-auth-method";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";
import { requirePrivyCompletionSession } from "@/src/lib/hosted-onboarding/request-auth";
import { issueHostedAppSession } from "@/src/lib/hosted-onboarding/app-session";
import { resolveHostedSignupTimeZone } from "@/src/lib/hosted-onboarding/time-zone-hint";
import { readHostedConsentStatus } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";
import {
  remapHostedPrivyCompletionLagError,
  type HostedPrivyIdentity,
} from "@/src/lib/hosted-onboarding/privy";

export const POST = withJsonError(async (request: Request) => {
  const timing = startHostedOnboardingTiming("hosted-onboarding.route.privy-complete");

  try {
    assertHostedOnboardingMutationOrigin(request);
    const auth = await requirePrivyCompletionSession(request);
    const body = await readOptionalJsonObject(request);
    const authMethod = resolveHostedPrivyCompletionAuthMethod({
      body,
      identity: auth.identity,
    });
    const timeZone = resolveHostedSignupTimeZone({
      clientTimeZone: body.timeZone,
      headers: request.headers,
    });
    const result = await completeHostedPrivyVerification({
      authMethod,
      identity: auth.identity,
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
      ...(timeZone ? { timeZone } : {}),
      verifiedPrivyUser: auth.verifiedPrivyUser,
    }).catch((error: unknown) => {
      throw remapHostedPrivyCompletionLagError(error);
    });
    const [status, launchConsentGranted] = await Promise.all([
      getHostedInviteStatus({
        authenticatedMember: result.member,
        inviteCode: result.inviteCode,
      }),
      readHostedCompletionLaunchConsentGranted(result.memberId),
    ]);
    const appSession = await issueHostedAppSession({
      memberId: result.memberId,
      privyUserId: auth.identity.userId,
    });

    finishHostedOnboardingTiming(timing, "completed", {
      stage: result.stage,
      messagingSetupRequired: result.messagingSetupRequired,
    });

    const response = jsonOk({
      inviteCode: result.inviteCode,
      joinUrl: result.joinUrl,
      launchConsentGranted,
      messagingSetupRequired: result.messagingSetupRequired,
      ok: true,
      stage: result.stage,
      status,
    });
    response.headers.append("Set-Cookie", appSession.cookie);
    return response;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
});

async function readHostedCompletionLaunchConsentGranted(memberId: string): Promise<boolean> {
  try {
    const status = await readHostedConsentStatus({
      memberId,
      prisma: getPrisma(),
    });
    return status.launchGranted;
  } catch {
    return false;
  }
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
