import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  readCurrentHostedMemberVerifiedEmailAddress,
} from "@/src/lib/hosted-routing/member-direct-route";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_EMAIL_EGRESS_RECIPIENT_BODY_LIMIT_BYTES = 2 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_EMAIL_EGRESS_RECIPIENT_BODY_LIMIT_BYTES,
  });
  const deliveryTarget = await readCurrentHostedMemberVerifiedEmailAddress({
    memberId,
    prisma: getPrisma(),
  });

  return jsonOk({ deliveryTarget });
});
