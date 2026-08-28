import {
  jsonOk,
  readHostedOnboardingRawBodyText,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  handleHostedVercelAnomalyWebhook,
} from "@/src/lib/hosted-operational-alert/vercel-anomaly-webhook";

const HOSTED_VERCEL_ALERT_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

export const runtime = "nodejs";

export const POST = withJsonError(async (request: Request) => {
  const rawBody = await readHostedOnboardingRawBodyText(request, {
    limitBytes: HOSTED_VERCEL_ALERT_WEBHOOK_MAX_BODY_BYTES,
    tooLargeErrorCode: "HOSTED_VERCEL_ALERT_WEBHOOK_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Vercel alert webhook body is too large.",
  });

  return jsonOk(await handleHostedVercelAnomalyWebhook({
    rawBody,
    signal: request.signal,
    signature: request.headers.get("x-vercel-signature"),
  }));
});
