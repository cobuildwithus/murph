import {
  HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
  parseHostedEmailRouteResolutionCallbackRequest,
} from "@murphai/hosted-execution/hosted-email";
import {
  isHostedEmailAuthenticatedSenderVerdictAccepted,
  isHostedEmailInboundSenderAuthorized,
  resolveHostedEmailDirectSenderLookupAddress,
} from "@murphai/runtime-state";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, readOptionalJsonObject } from "@/src/lib/http";
import {
  hasHostedMemberActiveAccess,
  isHostedMemberSuspended,
} from "@/src/lib/hosted-onboarding/entitlement";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  readHostedMemberEmailAuthorization,
  readHostedMemberCoreState,
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
  if (!isHostedEmailAuthenticatedSenderVerdictAccepted(body.authenticatedSender)) {
    return jsonOk({ userId: null });
  }

  const prisma = getPrisma();
  const aliasKey = body.aliasKey?.trim() ?? "";

  if (aliasKey) {
    const candidateMemberId = await readHostedMemberIdByReplyAliasLookupKey({
      prisma,
      replyAliasLookupKey: aliasKey,
    });
    const memberId = await resolveHostedEmailRouteMemberUserId({
      memberId: candidateMemberId,
      prisma,
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
        authenticatedSender: body.authenticatedSender,
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
    authenticatedSender: body.authenticatedSender,
    envelopeFrom: body.envelopeFrom,
    hasRepeatedHeaderFrom: body.hasRepeatedHeaderFrom,
    headerFrom: body.headerFrom,
  });
  const candidateMemberId = senderAddress
    ? await readHostedMemberIdByAuthorizedDirectPublicSenderAddress({
      address: senderAddress,
      prisma,
    })
    : null;
  const userId = await resolveHostedEmailRouteMemberUserId({
    memberId: candidateMemberId,
    prisma,
  });

  return jsonOk({
    userId,
  });
});

async function resolveHostedEmailRouteMemberUserId(input: {
  memberId: string | null;
  prisma: ReturnType<typeof getPrisma>;
}): Promise<string | null> {
  if (!input.memberId) {
    return null;
  }

  const member = await readHostedMemberCoreState({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (!member) {
    return null;
  }

  return !isHostedMemberSuspended(member.suspendedAt)
    && hasHostedMemberActiveAccess({
      billingStatus: member.billingStatus,
      suspendedAt: member.suspendedAt,
    })
    ? input.memberId
    : null;
}
