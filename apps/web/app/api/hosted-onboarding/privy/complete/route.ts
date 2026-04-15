import { after } from "next/server";

import { scheduleManagedUserCryptoWarmupBestEffort } from "@/src/lib/hosted-execution/control";
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
    });
    const warmupScheduled = result.stage === "checkout" && !result.messagingSetupRequired;

    if (warmupScheduled) {
      scheduleManagedUserCryptoWarmupBestEffort({
        schedule: after,
        trigger: "privy-complete-checkout",
        userId: result.memberId,
      });
    }

    finishHostedOnboardingTiming(timing, "completed", {
      stage: result.stage,
      warmupScheduled,
    });

    return jsonOk({
      activationPending: result.activationPending,
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
