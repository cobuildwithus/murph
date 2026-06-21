import {
  buildHostedComputerCapabilitiesResponse,
} from "@murphai/hosted-execution/computer-use";

import {
  jsonOk,
  withJsonError,
} from "@/src/lib/computer-use/http";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";

const COMPUTER_USE_CAPABILITIES_BODY_LIMIT_BYTES = 0;

export const GET = withJsonError(async (request: Request) => {
  await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: COMPUTER_USE_CAPABILITIES_BODY_LIMIT_BYTES,
  });

  return jsonOk(buildHostedComputerCapabilitiesResponse());
});
