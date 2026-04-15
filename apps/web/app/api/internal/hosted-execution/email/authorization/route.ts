import { isHostedEmailInboundSenderAuthorized } from "@murphai/runtime-state";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, readOptionalJsonObject } from "@/src/lib/http";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  readHostedMemberEmailAuthorization,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request);
  const body = await readOptionalJsonObject(request);
  const emailAuthorization = await readHostedMemberEmailAuthorization({
    memberId,
    prisma: getPrisma(),
  });

  return jsonOk({
    authorized: isHostedEmailInboundSenderAuthorized({
      envelopeFrom: typeof body.envelopeFrom === "string" ? body.envelopeFrom : null,
      hasRepeatedHeaderFrom: body.hasRepeatedHeaderFrom === true,
      headerFrom: typeof body.headerFrom === "string" ? body.headerFrom : null,
      verifiedEmailAddress: emailAuthorization?.verifiedEmail?.address ?? null,
    }),
  });
});
