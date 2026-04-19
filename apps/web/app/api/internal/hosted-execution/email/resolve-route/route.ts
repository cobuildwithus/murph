import {
  HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID,
} from "@murphai/hosted-execution/hosted-email";
import {
  isHostedEmailInboundSenderAuthorized,
  resolveHostedEmailDirectSenderLookupAddress,
} from "@murphai/runtime-state";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, readOptionalJsonObject } from "@/src/lib/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  readHostedMemberEmailAuthorization,
  readHostedMemberIdByAuthorizedDirectPublicSenderAddress,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  readHostedMemberIdByReplyAliasLookupKey,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const callbackUserId = await requireHostedCloudflareCallbackRequest(request);

  if (callbackUserId !== HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID) {
    throw hostedOnboardingError({
      code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      message: "Hosted Cloudflare callback is not authorized.",
      httpStatus: 401,
    });
  }

  const body = await readOptionalJsonObject(request);
  const prisma = getPrisma();
  const aliasKey = typeof body.aliasKey === "string" ? body.aliasKey.trim() : "";

  if (aliasKey) {
    const memberId = await readHostedMemberIdByReplyAliasLookupKey({
      prisma,
      replyAliasLookupKey: aliasKey,
    });
    if (!memberId) {
      return jsonOk({ userId: null });
    }

    const emailAuthorization = await readHostedMemberEmailAuthorization({
      memberId,
      prisma,
    });

    return jsonOk({
      userId: isHostedEmailInboundSenderAuthorized({
        envelopeFrom: typeof body.envelopeFrom === "string" ? body.envelopeFrom : null,
        hasRepeatedHeaderFrom: body.hasRepeatedHeaderFrom === true,
        headerFrom: typeof body.headerFrom === "string" ? body.headerFrom : null,
        verifiedEmailAddress: emailAuthorization?.verifiedEmail?.address ?? null,
      })
        ? memberId
        : null,
    });
  }

  const senderAddress = resolveHostedEmailDirectSenderLookupAddress({
    envelopeFrom: typeof body.envelopeFrom === "string" ? body.envelopeFrom : null,
    hasRepeatedHeaderFrom: body.hasRepeatedHeaderFrom === true,
    headerFrom: typeof body.headerFrom === "string" ? body.headerFrom : null,
  });
  const userId = senderAddress
    ? await readHostedMemberIdByAuthorizedDirectPublicSenderAddress({
      address: senderAddress,
      prisma,
    })
    : null;

  return jsonOk({
    userId,
  });
});
