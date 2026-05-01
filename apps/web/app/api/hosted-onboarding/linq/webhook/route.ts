import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";

export async function GET() {
  return jsonOk({
    ok: true,
    provider: "linq",
  });
}

export const POST = withJsonError(async (request: Request) => {
  const signature = request.headers.get("x-webhook-signature");
  const timestamp = request.headers.get("x-webhook-timestamp");
  const routeTiming = startHostedOnboardingTiming("hosted-onboarding.route.linq-webhook", {
    signalAbortedAtStart: request.signal.aborted,
    signaturePresent: Boolean(signature),
    timestampPresent: Boolean(timestamp),
  });

  try {
    const bodyTiming = startHostedOnboardingTiming(
      "hosted-onboarding.route.linq-webhook.read-body",
      {
        signalAbortedAtStart: request.signal.aborted,
      },
    );
    const rawBody = await request.text();
    const rawBodyBytes = new TextEncoder().encode(rawBody).byteLength;
    finishHostedOnboardingTiming(bodyTiming, "completed", {
      rawBodyBytes,
      signalAbortedAfterRead: request.signal.aborted,
    });

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody,
      signature,
      signal: request.signal,
      timestamp,
    });

    finishHostedOnboardingTiming(routeTiming, "completed", {
      duplicate: Boolean(response.duplicate),
      rawBodyBytes,
      reason: response.reason ?? null,
      signalAbortedBeforeReturn: request.signal.aborted,
    });

    return jsonOk(response, 202);
  } catch (error) {
    finishHostedOnboardingTiming(routeTiming, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      signalAbortedBeforeReturn: request.signal.aborted,
    });
    throw error;
  }
});
