import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/member-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { getHostedInviteStatus } from "@/src/lib/hosted-onboarding/invite-service";
import { requirePrivyCompletionSession } from "@/src/lib/hosted-onboarding/request-auth";
import { issueHostedAppSession } from "@/src/lib/hosted-onboarding/app-session";
import { resolveHostedSignupTimeZone } from "@/src/lib/hosted-onboarding/time-zone-hint";

export const POST = withJsonError(async (request: Request) => {
  const timing = startHostedOnboardingTiming("hosted-onboarding.route.privy-complete");

  try {
    assertHostedOnboardingMutationOrigin(request);
    const auth = await requirePrivyCompletionSession(request);
    const body = await readOptionalJsonObject(request);
    const timeZone = resolveHostedSignupTimeZone({
      clientTimeZone: body.timeZone,
      headers: request.headers,
    });
    const result = await completeHostedPrivyVerification({
      identity: auth.identity,
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
      ...(timeZone ? { timeZone } : {}),
      verifiedPrivyUser: auth.verifiedPrivyUser,
    });
    const status = await getHostedInviteStatus({
      authenticatedSessionIdentity: auth.identity,
      inviteCode: result.inviteCode,
    });
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
