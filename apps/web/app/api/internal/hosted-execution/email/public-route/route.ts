import {
  HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID,
} from "@murphai/hosted-execution/hosted-email";
import {
  resolveHostedEmailDirectSenderLookupAddress,
} from "@murphai/runtime-state";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, readOptionalJsonObject } from "@/src/lib/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  readHostedMemberIdByAuthorizedDirectPublicSenderAddress,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const callbackUserId = await requireHostedCloudflareCallbackRequest(request);

  if (callbackUserId !== HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID) {
    throw hostedOnboardingError({
      code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      message: "Hosted Cloudflare callback is not authorized.",
      httpStatus: 401,
    });
  }

  const body = await readOptionalJsonObject(request);
  const senderAddress = resolveHostedEmailDirectSenderLookupAddress({
    envelopeFrom: typeof body.envelopeFrom === "string" ? body.envelopeFrom : null,
    hasRepeatedHeaderFrom: body.hasRepeatedHeaderFrom === true,
    headerFrom: typeof body.headerFrom === "string" ? body.headerFrom : null,
  });
  const userId = senderAddress
    ? await readHostedMemberIdByAuthorizedDirectPublicSenderAddress({
        address: senderAddress,
        prisma: getPrisma(),
      })
    : null;

  return jsonOk({
    userId,
  });
});
