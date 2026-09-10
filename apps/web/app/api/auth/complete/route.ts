import { getPrisma } from "@/src/lib/prisma";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { readHostedAuthenticationCompletion } from "@/src/lib/hosted-onboarding/authentication-completion";
import { readHostedAuthenticationResponse } from "@/src/lib/hosted-onboarding/authentication-response";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

// Retryable product bootstrap follows durable authentication. All access,
// consent, checkout and messaging decisions keep their existing owners.
export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const session = await requireHostedAppSessionFromRequest(request);
  const prisma = getPrisma();
  const result = await readHostedAuthenticationCompletion({ member: session.member, prisma });
  return jsonOk(await readHostedAuthenticationResponse(result, prisma));
});
