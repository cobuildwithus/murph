import {
  deleteHostedAccountData,
  parseHostedAccountDeletionRequest,
} from "@/src/lib/hosted-privacy/account-data-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  buildHostedAppSessionClearCookie,
  requireHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import { HOSTED_ACCOUNT_PRIVACY_REQUEST_BODY_LIMIT_BYTES } from "@/src/lib/hosted-privacy/account-data-shared";
import { getPrisma } from "@/src/lib/prisma";
import {
  buildSettingsSensitiveActionBinding,
  verifyAndConsumeSensitiveActionChallenge,
} from "@/src/lib/sensitive-actions/server";

// Account deletion can span the hosted cleanup boundary, so keep the route
// within Vercel's absolute predecessor limit.
export const maxDuration = 300;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request, {
    limitBytes: HOSTED_ACCOUNT_PRIVACY_REQUEST_BODY_LIMIT_BYTES,
  });
  const deletionRequest = parseHostedAccountDeletionRequest(body);

  await verifyAndConsumeSensitiveActionChallenge({
    authorization: body.authorization,
    bindingHash: buildSettingsSensitiveActionBinding({
      kind: "account.delete",
      memberId: auth.member.id,
      sessionId: auth.sessionId,
    }),
    kind: "account.delete",
    memberId: auth.member.id,
    prisma,
    privyUserId: auth.privyUserId,
  });

  const result = await deleteHostedAccountData({
    exitFeedback: deletionRequest.exitFeedback,
    memberId: auth.member.id,
    prisma,
    providerAccessRemovalConfirmationToken:
      deletionRequest.providerAccessRemovalConfirmationToken,
    request,
  });

  const response = jsonOk({ ok: true, result });
  response.headers.append("Set-Cookie", buildHostedAppSessionClearCookie());
  return response;
});
