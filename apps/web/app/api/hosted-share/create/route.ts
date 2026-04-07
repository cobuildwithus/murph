import { assertContract, sharePackSchema } from "@murphai/contracts";

import { createHostedShareLink } from "@/src/lib/hosted-share/service";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireHostedPrivyActiveRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireHostedPrivyActiveRequestAuthContext(request);
  const body = await readJsonObject(request);

  return jsonOk(
    await createHostedShareLink({
      expiresInHours: typeof body.expiresInHours === "number" ? body.expiresInHours : undefined,
      inviteCode: typeof body.inviteCode === "string" ? body.inviteCode : null,
      pack: assertContract(sharePackSchema, body.pack, "share pack"),
      recipientPhoneNumber: typeof body.recipientPhoneNumber === "string" ? body.recipientPhoneNumber : null,
      senderMemberId: auth.member.id,
    }),
  );
});
