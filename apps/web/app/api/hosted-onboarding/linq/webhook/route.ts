import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";

export async function GET() {
  return jsonOk({
    ok: true,
    provider: "linq",
  });
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    return jsonOk(
      await handleHostedOnboardingLinqWebhook({
        rawBody,
        signature: request.headers.get("x-webhook-signature"),
        signal: request.signal,
        timestamp: request.headers.get("x-webhook-timestamp"),
      }),
      202,
    );
  } catch (error) {
    return jsonError(error);
  }
}
