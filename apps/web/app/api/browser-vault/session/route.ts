import { parseHostedUserRecipientPublicKeyJwk } from "@murphai/runtime-state";

import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireActivePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (request: Request) => {
  const auth = await requireActivePrivyMemberAuth(request);
  const body = await readJsonObject(request);
  const browserPublicKeyJwk = parseHostedUserRecipientPublicKeyJwk(
    body.browserPublicKeyJwk,
    "Browser vault session request browserPublicKeyJwk",
  );
  const client = readHostedExecutionControlClientIfConfigured();

  if (!client) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
      message: "Hosted execution control plane is not configured.",
      httpStatus: 503,
    });
  }

  try {
    return jsonOk(
      await client.createBrowserVaultSession(auth.member.id, browserPublicKeyJwk),
    );
  } catch (error) {
    if (error instanceof TypeError) {
      throw hostedOnboardingError({
        code: "HOSTED_EXECUTION_CONTROL_INVALID_RESPONSE",
        message: "Hosted execution control plane returned an invalid browser vault session.",
        httpStatus: 502,
      });
    }

    throw error;
  }
});
