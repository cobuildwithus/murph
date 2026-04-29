import {
  deleteHostedAccountData,
  parseHostedAccountDeletionRequest,
} from "@/src/lib/hosted-privacy/account-data-service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requirePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requirePrivyMemberAuth(request, prisma);
  parseHostedAccountDeletionRequest(await readJsonObject(request));

  const result = await deleteHostedAccountData({
    memberId: auth.member.id,
    prisma,
    request,
  });

  return jsonOk({ ok: true, result });
});
