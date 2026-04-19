import {
  HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
  parseHostedEmailRouteResolutionCallbackRequest,
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

  if (callbackUserId !== HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID) {
    throw hostedOnboardingError({
      code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      message: "Hosted Cloudflare callback is not authorized.",
      httpStatus: 401,
    });
  }

  const body = parseHostedEmailRouteResolutionCallbackRequest(
    await readOptionalJsonObject(request),
  );
  const prisma = getPrisma();
  const aliasKey = body.aliasKey?.trim() ?? "";

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
        envelopeFrom: body.envelopeFrom,
        hasRepeatedHeaderFrom: body.hasRepeatedHeaderFrom,
        headerFrom: body.headerFrom,
        verifiedEmailAddress: emailAuthorization?.verifiedEmail?.address ?? null,
      })
        ? memberId
        : null,
    });
  }

  const senderAddress = resolveHostedEmailDirectSenderLookupAddress({
    envelopeFrom: body.envelopeFrom,
    hasRepeatedHeaderFrom: body.hasRepeatedHeaderFrom,
    headerFrom: body.headerFrom,
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
