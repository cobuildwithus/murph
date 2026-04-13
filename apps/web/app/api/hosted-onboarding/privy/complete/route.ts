import { after } from "next/server";

import { preProvisionManagedUserCryptoInHostedExecutionBestEffort } from "@/src/lib/hosted-execution/control";
import { jsonOk, withJsonError, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { completeHostedPrivyVerification } from "@/src/lib/hosted-onboarding/member-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { requireHostedPrivyCompletionRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedPrivyCompletionRequestAuthContext(request);
  const body = await readOptionalJsonObject(request);
  const result = await completeHostedPrivyVerification({
    identity: auth.identity,
    inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
  });

  if (result.stage === "checkout") {
    after(async () => {
      await preProvisionManagedUserCryptoInHostedExecutionBestEffort({
        trigger: "privy-complete-checkout",
        userId: result.memberId,
      });
    });
  }

  return jsonOk({
    inviteCode: result.inviteCode,
    joinUrl: result.joinUrl,
    ok: true,
    stage: result.stage,
  });
});
