import {
  parseHostedRuntimeLabsToolRequest,
} from "@murphai/hosted-execution/labs";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { executeJunctionLabsTool } from "@/src/lib/labs/junction";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 2_048;

export const POST = withJsonError(async (request: Request) => {
  const { payload } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
  });
  const toolRequest = parseHostedRuntimeLabsToolRequest(payload);

  return jsonOk(await executeJunctionLabsTool(toolRequest, {
    signal: request.signal,
  }));
});
