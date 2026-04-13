import { after } from "next/server";

import { preProvisionManagedUserCryptoInHostedExecutionBestEffort } from "@/src/lib/hosted-execution/control";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/member-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { requireHostedPrivyCompletionAuth } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (request: Request) => {
  const timing = startHostedOnboardingTiming("hosted-onboarding.route.privy-complete");

  try {
    assertHostedOnboardingMutationOrigin(request);
    const auth = await requireHostedPrivyCompletionAuth(request);
    const body = await readOptionalJsonObject(request);
    const result = await completeHostedPrivyVerification({
      identity: auth.identity,
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
    });
    const warmupScheduled = result.stage === "checkout";

    if (warmupScheduled) {
      after(async () => {
        await preProvisionManagedUserCryptoInHostedExecutionBestEffort({
          trigger: "privy-complete-checkout",
          userId: result.memberId,
        });
      });
    }

    finishHostedOnboardingTiming(timing, "completed", {
      stage: result.stage,
      warmupScheduled,
    });

    return jsonOk({
      inviteCode: result.inviteCode,
      joinUrl: result.joinUrl,
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
