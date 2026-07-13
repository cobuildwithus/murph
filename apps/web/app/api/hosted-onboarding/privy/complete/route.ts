import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/authentication-service";
import {
  buildHostedPrivyAuthIntentClearCookie,
  readHostedPrivyAuthIntentFromRequest,
  verifyHostedPrivyAuthIntent,
  verifyHostedPrivyAuthenticationProof,
} from "@/src/lib/hosted-onboarding/privy-auth-intent";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";
import { requirePrivyCompletionSession } from "@/src/lib/hosted-onboarding/request-auth";
import { issueHostedAppSession } from "@/src/lib/hosted-onboarding/app-session";
import { resolveHostedSignupTimeZone } from "@/src/lib/hosted-onboarding/time-zone-hint";
import { readHostedConsentStatus } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";
import {
  readHostedPrivyUserById,
  remapHostedPrivyCompletionLagError,
} from "@/src/lib/hosted-onboarding/privy";
import { buildHostedPrivySessionState } from "@/src/lib/hosted-onboarding/privy-user";

export const POST = withJsonError(async (request: Request) => {
  const timing = startHostedOnboardingTiming("hosted-onboarding.route.privy-complete");

  try {
    assertHostedOnboardingMutationOrigin(request);
    const auth = await requirePrivyCompletionSession(request);
    const body = await readOptionalJsonObject(request);
    const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : null;
    const verifiedAuthIntent = verifyHostedPrivyAuthIntent({
      intent: readHostedPrivyAuthIntentFromRequest(request),
      inviteCode,
    });
    const verifiedPrivyUser = await readHostedPrivyUserById(auth.identity.userId);
    const { identity, linkedAccounts } = buildHostedPrivySessionState(verifiedPrivyUser);
    const authProof = (() => {
      try {
        return verifyHostedPrivyAuthenticationProof({
          identity,
          intent: verifiedAuthIntent,
          linkedAccounts,
        });
      } catch (error) {
        throw remapHostedPrivyCompletionLagError(error);
      }
    })();
    const timeZone = resolveHostedSignupTimeZone({
      clientTimeZone: body.timeZone,
      headers: request.headers,
    });
    const result = await completeHostedPrivyVerification({
      authProof,
      identity,
      inviteCode,
      ...(timeZone ? { timeZone } : {}),
      verifiedPrivyUser,
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
      ...(result.initialVisitEligible ? { initialVisitEligible: true } : {}),
      inviteCode: result.inviteCode,
      joinUrl: `/join/${encodeURIComponent(result.inviteCode)}`,
      launchConsentGranted,
      messagingSetupRequired: result.messagingSetupRequired,
      ok: true,
      stage: result.stage,
      status,
    });
    response.headers.append("Set-Cookie", appSession.cookie);
    response.headers.append("Set-Cookie", buildHostedPrivyAuthIntentClearCookie());
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
