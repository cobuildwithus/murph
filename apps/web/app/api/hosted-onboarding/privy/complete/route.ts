import {
  isHostedAuthenticationIntent,
} from "@/src/lib/hosted-onboarding/authentication-intent";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/member-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { requirePrivyCompletionSession } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (request: Request) => {
  const timing = startHostedOnboardingTiming("hosted-onboarding.route.privy-complete");

  try {
    assertHostedOnboardingMutationOrigin(request);
    const auth = await requirePrivyCompletionSession(request);
    const body = await readOptionalJsonObject(request);
    const result = await completeHostedPrivyVerification({
      identity: auth.identity,
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
      intent: isHostedAuthenticationIntent(body.intent) ? body.intent : "signup",
      verifiedPrivyUser: auth.verifiedPrivyUser,
    });

    finishHostedOnboardingTiming(timing, "completed", {
      stage: result.stage,
      messagingSetupRequired: result.messagingSetupRequired,
    });

    return jsonOk({
      inviteCode: result.inviteCode,
      joinUrl: result.joinUrl,
      messagingSetupRequired: result.messagingSetupRequired,
      ok: true,
      stage: result.stage,
    });
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
});
