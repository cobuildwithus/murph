import {
  parseHostedRuntimeLinqContactCardShareAfterOutboundRequest,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  maybeShareHostedLinqContactCardAfterOutboundWithAuthority,
} from "@/src/lib/hosted-onboarding/linq-contact-card-share";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_LINQ_CONTACT_CARD_SHARE_AFTER_OUTBOUND_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_LINQ_CONTACT_CARD_SHARE_AFTER_OUTBOUND_BODY_LIMIT_BYTES,
  });
  const body = parseHostedRuntimeLinqContactCardShareAfterOutboundRequest(
    await readOptionalJsonObject(request),
  );

  const prisma = getPrisma();
  await maybeShareHostedLinqContactCardAfterOutboundWithAuthority({
    authority: body.authority,
    boundUserId: userId,
    chatId: body.chatId,
    eligibility: {
      service: body.service,
      threadIsDirect: body.threadIsDirect,
    },
    prisma,
  });
  return jsonOk({
    ok: true,
  });
});
