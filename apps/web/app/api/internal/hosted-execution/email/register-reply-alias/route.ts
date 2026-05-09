import {
  normalizeHostedEmailReplyAliasLookupKey,
  parseHostedEmailReplyAliasRegistrationCallbackRequest,
} from "@murphai/hosted-execution/hosted-email";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, readRawBodyBuffer } from "@/src/lib/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  upsertHostedMemberReplyAliasLookupKeyTx,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_EMAIL_REPLY_ALIAS_REGISTRATION_MAX_BODY_BYTES = 2 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = await readReplyAliasRegistrationPayloadText(request);
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_EMAIL_REPLY_ALIAS_REGISTRATION_MAX_BODY_BYTES,
    payloadText,
  });
  const body = parseHostedEmailReplyAliasRegistrationCallbackRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );
  const aliasKey = normalizeHostedEmailReplyAliasLookupKey(body.aliasKey);

  if (!aliasKey) {
    throw hostedOnboardingError({
      code: "HOSTED_EMAIL_REPLY_ALIAS_INVALID",
      message: "Hosted email reply alias registration requires a current-format alias key.",
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

async function readReplyAliasRegistrationPayloadText(request: Request): Promise<string> {
  try {
    return (await readRawBodyBuffer(request, {
      limitBytes: HOSTED_EMAIL_REPLY_ALIAS_REGISTRATION_MAX_BODY_BYTES,
    })).toString("utf8");
  } catch (error) {
    if (error instanceof RangeError) {
      throw hostedOnboardingError({
        code: "HOSTED_EMAIL_REPLY_ALIAS_BODY_TOO_LARGE",
        message: "Hosted email reply alias registration body is too large.",
        httpStatus: 413,
      });
    }

    throw error;
  }
}
