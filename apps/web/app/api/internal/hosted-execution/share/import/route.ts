import {
  parseHostedRuntimeShareImportRequest,
} from "@murphai/hosted-execution";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { finalizeHostedShareAcceptance, releaseHostedShareAcceptance } from "@/src/lib/hosted-share/shared";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const ownerUserId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedRuntimeShareImportRequest(await readOptionalJsonObject(request));
  const prisma = getPrisma();

  if (body.ownerUserId !== ownerUserId) {
    return jsonOk({
      recorded: false,
      shareId: body.shareId,
      status: body.status,
    });
  }

  const share = await prisma.hostedShareLink.findFirst({
    select: {
      acceptedByMemberId: true,
      id: true,
      lastEventId: true,
      senderMemberId: true,
    },
    where: {
      id: body.shareId,
      senderMemberId: ownerUserId,
    },
  });

  const memberId = share?.acceptedByMemberId ?? null;
  const eventId = share?.lastEventId ?? null;

  if (!share || !memberId || !eventId) {
    return jsonOk({
      recorded: false,
      shareId: body.shareId,
      status: body.status,
    });
  }

  const recorded = body.status === "imported"
    ? (await finalizeHostedShareAcceptance({
        eventId,
        memberId,
        prisma,
        shareId: share.id,
      })).finalized
    : await releaseHostedShareAcceptance({
        eventId,
        memberId,
        prisma,
        shareId: share.id,
      });

  return jsonOk({
    recorded,
    shareId: body.shareId,
    status: body.status,
  });
});
