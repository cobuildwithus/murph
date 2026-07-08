import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

const HOSTED_LINQ_CONTACT_CARD_SHARE_AFTER_OUTBOUND_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  // Legacy compatibility for warm runner containers on old bundles during
  // gradual rollout. New runtime bundles no longer push native contact cards.
  await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_LINQ_CONTACT_CARD_SHARE_AFTER_OUTBOUND_BODY_LIMIT_BYTES,
  });

  return jsonOk({
    ok: true,
  });
});
