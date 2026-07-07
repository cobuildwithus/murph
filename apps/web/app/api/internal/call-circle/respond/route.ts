import {
  hostedCallCircleRespondControlRequestSchema,
  hostedCallCircleRespondRequestSchema,
} from "@murphai/hosted-execution/call-circle";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";
import {
  handleCallCircleRespond,
} from "@/src/lib/call-circle/response-service";

const HOSTED_CALL_CIRCLE_RESPOND_MAX_BODY_BYTES = 64 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const rawBody = (await readRawBodyBuffer(request, {
    limitBytes: HOSTED_CALL_CIRCLE_RESPOND_MAX_BODY_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_CALL_CIRCLE_RESPOND_MAX_BODY_BYTES,
    payloadText: rawBody,
  });
  const payload = hostedCallCircleRespondControlRequestSchema.parse(JSON.parse(rawBody));
  const callCircleRequest = "request" in payload
    ? payload.request
    : hostedCallCircleRespondRequestSchema.parse(payload);
  const response = await handleCallCircleRespond({
    context: "request" in payload ? payload.context : undefined,
    memberId,
    request: callCircleRequest,
  });

  return jsonOk(response, 202);
});
