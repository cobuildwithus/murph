import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readOptionalJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  buildHostedPrivyAuthIntentCookie,
  issueHostedPrivyAuthIntent,
} from "@/src/lib/hosted-onboarding/privy-auth-intent";
import { isHostedPrivyAuthMethod } from "@/src/lib/hosted-onboarding/types";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const body = await readOptionalJsonObject(request);

  if (!isHostedPrivyAuthMethod(body.method)) {
    throw hostedOnboardingError({
      code: "HOSTED_AUTH_INTENT_INVALID",
      message: "Choose phone, email, or Telegram before continuing.",
      httpStatus: 400,
    });
  }

  const response = jsonOk({ ok: true });
  response.headers.append("Set-Cookie", buildHostedPrivyAuthIntentCookie(
    issueHostedPrivyAuthIntent({
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
      method: body.method,
    }),
  ));
  return response;
});
