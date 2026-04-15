import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  projectHostedSharePayloadState,
} from "@/src/lib/hosted-share/shared";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ shareId: string }> },
) => {
  const ownerUserId = await requireHostedCloudflareCallbackRequest(request);
  const shareId = await resolveDecodedRouteParam(context.params, "shareId");
  const record = await getPrisma().hostedSharePayload.findUnique({
    where: {
      shareId,
    },
    include: {
      share: {
        select: {
          senderMemberId: true,
        },
      },
    },
  });

  if (!record || record.share.senderMemberId !== ownerUserId) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_PAYLOAD_NOT_FOUND",
      message: "That shared bundle is no longer available.",
      httpStatus: 404,
    });
  }

  const payload = projectHostedSharePayloadState(record);

  return jsonOk({
    ownerUserId,
    pack: payload.pack,
    shareId,
  });
});
