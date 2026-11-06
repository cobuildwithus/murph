import {
  deleteHostedAccountData,
  parseHostedAccountDeletionRequest,
} from "@/src/lib/hosted-privacy/account-data-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { withRetryableServerFailures } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  buildHostedAppSessionClearCookies,
  requireHostedAccountDeletionSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import { HOSTED_ACCOUNT_DELETION_UNEXPECTED_FAILURE_MESSAGE, HOSTED_ACCOUNT_PRIVACY_REQUEST_BODY_LIMIT_BYTES } from "@/src/lib/hosted-privacy/account-data-shared";
import { getPrisma } from "@/src/lib/prisma";

// Account deletion can span the hosted cleanup boundary, so keep the route
// within Vercel's absolute predecessor limit.
export const maxDuration = 300;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await withRetryableServerFailures(() => requireHostedAccountDeletionSessionFromRequest(request),
    HOSTED_ACCOUNT_DELETION_UNEXPECTED_FAILURE_MESSAGE);
  const body = await readJsonObject(request, {
    limitBytes: HOSTED_ACCOUNT_PRIVACY_REQUEST_BODY_LIMIT_BYTES,
  });
  const deletionRequest = parseHostedAccountDeletionRequest(body);

  const result = await withRetryableServerFailures(() => deleteHostedAccountData({
    exitFeedback: deletionRequest.exitFeedback,
    memberId: auth.member.id,
    prisma,
    providerAccessRemovalConfirmationToken:
      deletionRequest.providerAccessRemovalConfirmationToken,
    request,
  }), HOSTED_ACCOUNT_DELETION_UNEXPECTED_FAILURE_MESSAGE);

  const response = jsonOk({ ok: true, result });
  for (const cookie of buildHostedAppSessionClearCookies()) response.headers.append("Set-Cookie", cookie);
  return response;
});
