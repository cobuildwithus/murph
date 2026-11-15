import { ZodError } from "@murphai/contracts/zod-runtime";
import { RequestInputError } from "@murphai/hosted-execution/request-input";
import {
  parseHostedSubscriptionControlRequest,
} from "@murphai/hosted-execution/subscription";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  handleHostedSubscriptionTool,
} from "@/src/lib/hosted-execution/subscription-tool";
import { parseRequestJson, readRawBodyBuffer } from "@/src/lib/http";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 1_024;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: BODY_LIMIT_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
    payloadText,
  });
  const body = parseSubscriptionControlRequest(payloadText);

  return jsonOk(await handleHostedSubscriptionTool({
    memberId,
    request: body,
  }));
});

function parseSubscriptionControlRequest(payloadText: string) {
  try {
    return parseHostedSubscriptionControlRequest(
      payloadText.trim() ? parseRequestJson(payloadText) : {},
    );
  } catch (error) {
    if (!(error instanceof ZodError) && !(error instanceof RequestInputError)) throw error;
    throw hostedOnboardingError({
      code: "HOSTED_SUBSCRIPTION_REQUEST_INVALID",
      httpStatus: 400,
      message: "Subscription action request is invalid.",
    });
  }
}
