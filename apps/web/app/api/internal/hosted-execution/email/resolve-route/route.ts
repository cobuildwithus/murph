import {
  HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
  parseHostedEmailRouteResolutionCallbackRequest,
} from "@murphai/hosted-execution/hosted-email";
import {
  isHostedEmailAuthenticatedSenderVerdictAccepted,
  resolveHostedEmailDirectSenderLookupAddress,
  resolveHostedEmailInboundSenderAddress,
} from "@murphai/runtime-state";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, readOptionalJsonObject } from "@/src/lib/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readActiveHostedMemberAccess } from "@/src/lib/hosted-onboarding/member-access";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  lookupHostedMemberByVerifiedEmailAddress,
  readHostedMemberIdByAuthorizedDirectPublicSenderAddress,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  readHostedMemberIdByReplyAliasLookupKey,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_BODY_LIMIT_BYTES = 16 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const callbackUserId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_BODY_LIMIT_BYTES,
  });

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
  const groupId = body.groupId?.trim() ?? "";

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

    return jsonOk({
      userId: memberId,
    });
  }

  if (groupId) {
    const senderAddress = resolveHostedEmailInboundSenderAddress({
      envelopeFrom: body.envelopeFrom,
      hasRepeatedHeaderFrom: body.hasRepeatedHeaderFrom,
      headerFrom: body.headerFrom,
    });
    if (!senderAddress) {
      return jsonOk({ userId: null });
    }

    const senderMember = await lookupHostedMemberByVerifiedEmailAddress({
      address: senderAddress,
      prisma,
    });
    const senderMemberId = senderMember?.core.id ?? null;
    if (!senderMemberId) {
      return jsonOk({ userId: null });
    }

    const group = await prisma.hostedGroup.findUnique({
      where: { id: groupId },
      select: {
        members: { select: { memberId: true } },
        runtimeMemberId: true,
      },
    });
    if (
      !group?.runtimeMemberId
      || !group.members.some((member) => member.memberId === senderMemberId)
    ) {
      return jsonOk({ userId: null });
    }
    const runtimeMemberId = group.runtimeMemberId;

    const grant = await prisma.hostedVaultShare.findFirst({
      where: {
        destinationMemberId: runtimeMemberId,
        grantorMemberId: senderMemberId,
        projectionKind: "group-email.v0",
        status: "granted",
      },
      select: { grantorMemberId: true },
    });
    if (!grant) {
      return jsonOk({ userId: null });
    }
    if (!await readActiveHostedMemberAccess({
      memberId: senderMemberId,
      prisma,
    })) {
      return jsonOk({ userId: null });
    }

    const memberId = await resolveHostedEmailRouteMemberUserId({
      memberId: runtimeMemberId,
      prisma,
    });

    return jsonOk({
      userId: memberId,
    });
  }

  if (!isHostedEmailAuthenticatedSenderVerdictAccepted(body.authenticatedSender)) {
    return jsonOk({ userId: null });
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

  return await readActiveHostedMemberAccess({
    memberId: input.memberId,
    prisma: input.prisma,
  })
    ? input.memberId
    : null;
}
