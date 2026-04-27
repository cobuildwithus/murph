import {
  parseHostedRuntimeShareImportRequest,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { finalizeHostedShareAcceptance, releaseHostedShareAcceptance } from "@/src/lib/hosted-share/shared";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const runnerUserId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedRuntimeShareImportRequest(await readOptionalJsonObject(request));
  const prisma = getPrisma();

  const share = await prisma.hostedShareLink.findFirst({
    select: {
      acceptedByMemberId: true,
      id: true,
      senderMemberId: true,
    },
    where: {
      acceptedByMemberId: runnerUserId,
      id: body.shareId,
      lastEventId: body.eventId,
      senderMemberId: body.ownerUserId,
    },
  });

  if (!share) {
    return jsonOk({
      recorded: false,
      shareId: body.shareId,
      status: body.status,
    });
  }

  const recorded = body.status === "imported"
    ? (await finalizeHostedShareAcceptance({
        eventId: body.eventId,
        memberId: runnerUserId,
        prisma,
        shareId: share.id,
      })).finalized
    : await releaseHostedShareAcceptance({
        eventId: body.eventId,
        memberId: runnerUserId,
        prisma,
        shareId: share.id,
      });

  return jsonOk({
    recorded,
    shareId: body.shareId,
    status: body.status,
  });
});
