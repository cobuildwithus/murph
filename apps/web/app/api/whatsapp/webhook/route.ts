import { after } from "next/server";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveHostedWhatsAppWebhookChallenge } from "@/src/lib/hosted-onboarding/whatsapp";
import { handleHostedOnboardingWhatsAppWebhook } from "@/src/lib/hosted-onboarding/webhook-service";
import { readRawBodyBuffer } from "@/src/lib/http";

const HOSTED_WHATSAPP_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export const runtime = "nodejs";

export const GET = withJsonError(async (request: Request) => {
  const url = new URL(request.url);
  const challenge = resolveHostedWhatsAppWebhookChallenge({
    challenge: url.searchParams.get("hub.challenge"),
    mode: url.searchParams.get("hub.mode"),
    verifyToken: url.searchParams.get("hub.verify_token"),
  });

  return new Response(challenge, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
    status: 200,
  });
});

export const POST = withJsonError(async (request: Request) => {
  const rawBody = await readHostedWhatsAppWebhookRawBody(request);

  return jsonOk(
    await handleHostedOnboardingWhatsAppWebhook({
      rawBody,
      scheduleAfterResponse: scheduleAfterResponseOrFireAndForget,
      signature: request.headers.get("x-hub-signature-256"),
      signal: request.signal,
    }),
    202,
  );
});

function scheduleAfterResponseOrFireAndForget(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

async function readHostedWhatsAppWebhookRawBody(request: Request): Promise<string> {
  try {
    return (await readRawBodyBuffer(request, {
      limitBytes: HOSTED_WHATSAPP_WEBHOOK_MAX_BODY_BYTES,
    })).toString("utf8");
  } catch (error) {
    if (error instanceof RangeError) {
      throw hostedOnboardingError({
        code: "WHATSAPP_WEBHOOK_BODY_TOO_LARGE",
        httpStatus: 413,
        message: "WhatsApp webhook body is too large.",
      });
    }

    throw error;
  }
}
