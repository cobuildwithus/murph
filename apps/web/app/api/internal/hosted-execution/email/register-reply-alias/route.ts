import { parseHostedEmailReplyAliasRegistrationCallbackRequest } from "@murphai/hosted-execution/hosted-email";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, readOptionalJsonObject } from "@/src/lib/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  upsertHostedMemberReplyAliasLookupKeyTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedEmailReplyAliasRegistrationCallbackRequest(
    await readOptionalJsonObject(request),
  );
  const aliasKey = body.aliasKey?.trim() ?? "";

  if (!aliasKey) {
    throw hostedOnboardingError({
      code: "HOSTED_EMAIL_REPLY_ALIAS_INVALID",
      message: "Hosted email reply alias registration requires a non-empty alias key.",
      httpStatus: 400,
    });
  }

  await getPrisma().$transaction((tx) =>
    upsertHostedMemberReplyAliasLookupKeyTx({
      memberId,
      prisma: tx,
      replyAliasLookupKey: aliasKey,
    })
  );

  return jsonOk({
    ok: true,
  });
});
