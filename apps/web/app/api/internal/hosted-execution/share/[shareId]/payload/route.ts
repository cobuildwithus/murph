import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  deleteHostedSharePayload,
  HOSTED_SHARE_PAYLOAD_SCHEMA,
  projectHostedSharePayloadState,
} from "@/src/lib/hosted-share/shared";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ shareId: string }> },
) => {
  const ownerUserId = await requireHostedCloudflareCallbackRequest(request);
  const shareId = await resolveDecodedRouteParam(context.params, "shareId");
  const prisma = getPrisma();
  const record = await prisma.hostedSharePayload.findUnique({
    where: {
      shareId,
    },
    include: {
      share: {
        select: {
          acceptedAt: true,
          acceptedByMemberId: true,
          consumedAt: true,
          expiresAt: true,
          senderMemberId: true,
        },
      },
    },
  });

  const now = new Date();
  const payloadExpired = Boolean(record && record.share.expiresAt <= now);
  const payloadConsumed = Boolean(record?.share.consumedAt);
  const payloadReady = Boolean(
    record !== null
    && record.share.senderMemberId === ownerUserId
    && record.share.acceptedAt
    && record.share.acceptedByMemberId
    && !payloadExpired
    && !payloadConsumed,
  );

  if ((payloadExpired || payloadConsumed) && record) {
    await deleteHostedSharePayload({
      prisma,
      shareId,
    });
  }

  if (!record || !payloadReady) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_PAYLOAD_NOT_FOUND",
      message: "That shared bundle is no longer available.",
      httpStatus: 404,
    });
  }

  const payload = projectHostedSharePayloadState(record);

  return jsonOk({
    fetchedAt: now.toISOString(),
    payload: {
      ownerUserId,
      pack: payload.pack,
      payloadSchema: HOSTED_SHARE_PAYLOAD_SCHEMA,
      shareId,
    },
    unavailable: null,
  });
});
