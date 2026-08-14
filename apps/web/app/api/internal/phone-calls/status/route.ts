import {
  hostedPhoneCallStatusRequestSchema,
} from "@murphai/hosted-execution/phone-calls";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readHostedPhoneCallStatus } from "@/src/lib/phone-calls/status";

const HOSTED_PHONE_CALL_STATUS_MAX_BODY_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } =
    await requireHostedCloudflareCallbackJsonRequest(request, {
      maxBodyBytes: HOSTED_PHONE_CALL_STATUS_MAX_BODY_BYTES,
    });
  const parsed = hostedPhoneCallStatusRequestSchema.parse(payload);
  const response = await readHostedPhoneCallStatus({
    memberId,
    ...(parsed.phoneCallId ? { phoneCallId: parsed.phoneCallId } : {}),
  });

  return jsonOk(response);
});
