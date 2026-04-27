import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  HOSTED_SHARE_PAYLOAD_SCHEMA,
  projectHostedSharePayloadState,
} from "@/src/lib/hosted-share/shared";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ shareId: string }> },
) => {
  const runnerUserId = await requireHostedCloudflareCallbackRequest(request);
  const now = new Date();
  const searchParams = new URL(request.url).searchParams;
  const eventId = searchParams.get("eventId");
  const ownerUserId = searchParams.get("ownerUserId");
  if (!eventId || !ownerUserId) {
    return jsonOk({
      fetchedAt: now.toISOString(),
      payload: null,
      unavailable: {
        code: "not_found",
        retryable: false,
      },
    });
  }
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
          lastEventId: true,
          senderMemberId: true,
        },
      },
    },
  });

  const payloadOwnerMatched = Boolean(
    record
    && record.share.senderMemberId === ownerUserId
    && record.share.acceptedByMemberId === runnerUserId
    && record.share.lastEventId === eventId,
  );
  const payloadExpired = Boolean(record && payloadOwnerMatched && record.share.expiresAt <= now);
  const payloadConsumed = Boolean(record?.share.consumedAt && payloadOwnerMatched);
  const payloadReady = Boolean(
    record !== null
    && payloadOwnerMatched
    && record.share.acceptedAt
    && !payloadExpired
    && !payloadConsumed,
  );

  if (!record || !payloadReady) {
    return jsonOk({
      fetchedAt: now.toISOString(),
      payload: null,
      unavailable: {
        code: payloadExpired ? "expired" : payloadConsumed ? "gone" : "not_found",
        retryable: false,
      },
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
