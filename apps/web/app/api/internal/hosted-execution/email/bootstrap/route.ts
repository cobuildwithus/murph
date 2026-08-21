import {
  HOSTED_EMAIL_PUBLIC_BOOTSTRAP_CALLBACK_USER_ID,
  parseHostedEmailPublicBootstrapCallbackRequest,
} from "@murphai/hosted-execution/hosted-email";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, readRawBodyBuffer } from "@/src/lib/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  sendHostedEmailPublicBootstrapChallenge,
} from "@/src/lib/hosted-onboarding/hosted-email-public-bootstrap";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";

const HOSTED_EMAIL_PUBLIC_BOOTSTRAP_MAX_BODY_BYTES = 2 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = await readHostedEmailPublicBootstrapPayloadText(request);
  const callbackUserId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_EMAIL_PUBLIC_BOOTSTRAP_MAX_BODY_BYTES,
    payloadText,
  });
  if (callbackUserId !== HOSTED_EMAIL_PUBLIC_BOOTSTRAP_CALLBACK_USER_ID) {
    throw hostedOnboardingError({
      code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      message: "Hosted Cloudflare callback is not authorized.",
      httpStatus: 401,
    });
  }

  const body = parseHostedEmailPublicBootstrapCallbackRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );
  try {
    await sendHostedEmailPublicBootstrapChallenge({
      candidateAddress: body.candidateAddress,
    });
  } catch (error) {
    // Valid callbacks are intentionally non-diagnostic: SMTP acceptance must
    // not reveal membership, access, rate-limit, or provider state.
    console.warn("Hosted public email bootstrap callback failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return jsonOk({ ok: true });
});

async function readHostedEmailPublicBootstrapPayloadText(
  request: Request,
): Promise<string> {
  try {
    return (await readRawBodyBuffer(request, {
      limitBytes: HOSTED_EMAIL_PUBLIC_BOOTSTRAP_MAX_BODY_BYTES,
    })).toString("utf8");
  } catch (error) {
    if (error instanceof RangeError) {
      throw hostedOnboardingError({
        code: "HOSTED_EMAIL_PUBLIC_BOOTSTRAP_BODY_TOO_LARGE",
        message: "Hosted email public bootstrap body is too large.",
        httpStatus: 413,
      });
    }
    throw error;
  }
}
