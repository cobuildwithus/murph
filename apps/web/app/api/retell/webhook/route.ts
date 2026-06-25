import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";
import { retellWebhookPayloadSchema } from "@/src/lib/phone-calls/retell-payloads";
import {
  handleRetellCallAnalyzed,
  handleRetellCallEnded,
} from "@/src/lib/phone-calls/result";
import { verifyRetellSignature } from "@/src/lib/phone-calls/retell-signature";

const RETELL_WEBHOOK_MAX_BODY_BYTES = 512 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const rawBody = (await readRawBodyBuffer(request, {
    limitBytes: RETELL_WEBHOOK_MAX_BODY_BYTES,
  })).toString("utf8");

  verifyRetellSignature({
    rawBody,
    signature: request.headers.get("x-retell-signature"),
  });

  const payload = retellWebhookPayloadSchema.parse(JSON.parse(rawBody));
  switch (payload.event) {
    case "call_ended":
      await handleRetellCallEnded({ call: payload.call });
      break;
    case "call_analyzed":
      await handleRetellCallAnalyzed({ call: payload.call });
      break;
  }

  return new Response(null, { status: 204 });
});
