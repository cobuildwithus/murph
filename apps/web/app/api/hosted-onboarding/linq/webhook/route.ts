import { after } from "next/server";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";
import { readRawBodyBuffer } from "@/src/lib/http";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "@/src/lib/hosted-onboarding/logging";

const HOSTED_LINQ_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

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
    const rawBody = await readHostedLinqWebhookRawBody(request);
    const rawBodyBytes = new TextEncoder().encode(rawBody).byteLength;
    finishHostedOnboardingTiming(bodyTiming, "completed", {
      rawBodyBytes,
      signalAbortedAfterRead: request.signal.aborted,
    });

    const response = await handleHostedOnboardingLinqWebhook({
      rawBody,
      scheduleAfterResponse: scheduleAfterResponseOrFireAndForget,
      signature,
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

function scheduleAfterResponseOrFireAndForget(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

async function readHostedLinqWebhookRawBody(request: Request): Promise<string> {
  try {
    return (await readRawBodyBuffer(request, {
      limitBytes: HOSTED_LINQ_WEBHOOK_MAX_BODY_BYTES,
    })).toString("utf8");
  } catch (error) {
    if (error instanceof RangeError) {
      throw hostedOnboardingError({
        code: "LINQ_WEBHOOK_BODY_TOO_LARGE",
        httpStatus: 413,
        message: "Linq webhook body is too large.",
      });
    }

    throw error;
  }
}
