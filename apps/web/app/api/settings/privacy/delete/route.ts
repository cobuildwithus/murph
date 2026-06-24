import {
  deleteHostedAccountData,
  parseHostedAccountDeletionRequest,
} from "@/src/lib/hosted-privacy/account-data-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  requireHostedAppSessionFromRequest,
  revokeHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import { HOSTED_ACCOUNT_PRIVACY_REQUEST_BODY_LIMIT_BYTES } from "@/src/lib/hosted-privacy/account-data-shared";
import { getPrisma } from "@/src/lib/prisma";
import {
  buildSettingsSensitiveActionBinding,
  verifyAndConsumeSensitiveActionChallenge,
} from "@/src/lib/sensitive-actions/server";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request, {
    limitBytes: HOSTED_ACCOUNT_PRIVACY_REQUEST_BODY_LIMIT_BYTES,
  });
  parseHostedAccountDeletionRequest(body);

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
    memberId: auth.member.id,
    prisma,
    request,
  });

  const response = jsonOk({ ok: true, result });
  response.headers.append("Set-Cookie", await revokeHostedAppSessionFromRequest({
    reason: "account-deleted",
    request,
  }));
  return response;
});
