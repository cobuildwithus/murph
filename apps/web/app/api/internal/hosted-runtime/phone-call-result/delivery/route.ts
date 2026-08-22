import {
  parseHostedPhoneCallResultDeliveryOutcomeRequest,
} from "@murphai/hosted-execution/phone-calls";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readOptionalJsonObject } from "@/src/lib/http";
import {
  recordHostedPhoneCallResultDeliveryOutcome,
} from "@/src/lib/phone-calls/result-delivery";

const HOSTED_PHONE_CALL_RESULT_DELIVERY_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_PHONE_CALL_RESULT_DELIVERY_BODY_LIMIT_BYTES,
  });
  let body;
  try {
    body = parseHostedPhoneCallResultDeliveryOutcomeRequest(
      await readOptionalJsonObject(request),
    );
  } catch (error) {
    throw hostedOnboardingError({
      cause: error,
      code: "HOSTED_PHONE_CALL_RESULT_DELIVERY_REQUEST_INVALID",
      httpStatus: 400,
      message: "Hosted phone call result delivery request is invalid.",
    });
  }

  return jsonOk({
    ok: true,
    ...await recordHostedPhoneCallResultDeliveryOutcome({
      memberId,
      request: body,
      signal: request.signal,
    }),
  });
});
