import { hostedPhoneCallStartRequestSchema } from "@murphai/hosted-execution/phone-calls";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";
import {
  createHostedPhoneCall,
} from "@/src/lib/phone-calls/service";

const HOSTED_PHONE_CALL_START_MAX_BODY_BYTES = 64 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const rawBody = (await readRawBodyBuffer(request, {
    limitBytes: HOSTED_PHONE_CALL_START_MAX_BODY_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_PHONE_CALL_START_MAX_BODY_BYTES,
    payloadText: rawBody,
  });
  const payload = hostedPhoneCallStartRequestSchema.parse(JSON.parse(rawBody));
  const response = await createHostedPhoneCall({
    brief: payload.brief,
    ...(payload.groupRequester
      ? { groupRequester: payload.groupRequester }
      : {}),
    ...(payload.inboundMailboxItemIds
      ? { inboundMailboxItemIds: payload.inboundMailboxItemIds }
      : {}),
    memberId,
    ...(payload.originDirectChannel
      ? { originDirectChannel: payload.originDirectChannel }
      : {}),
    originSessionId: payload.originSessionId,
    requestKey: payload.requestKey,
    signal: request.signal,
  });

  return jsonOk(response, 202);
});
