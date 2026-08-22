import {
  hostedPhoneCallStopRequestSchema,
} from "@murphai/hosted-execution/phone-calls";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { stopHostedPhoneCall } from "@/src/lib/phone-calls/control";

const HOSTED_PHONE_CALL_STOP_MAX_BODY_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } =
    await requireHostedCloudflareCallbackJsonRequest(request, {
      maxBodyBytes: HOSTED_PHONE_CALL_STOP_MAX_BODY_BYTES,
    });
  const parsed = hostedPhoneCallStopRequestSchema.parse(payload);
  const response = await stopHostedPhoneCall({
    memberId,
    phoneCallId: parsed.phoneCallId,
    signal: request.signal,
  });

  return jsonOk(response);
});
