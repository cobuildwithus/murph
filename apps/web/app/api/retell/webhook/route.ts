import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";
import { retellWebhookPayloadSchema } from "@/src/lib/phone-calls/retell-payloads";
import {
  handleRetellCallAnalyzed,
  handleRetellCallEnded,
  handleRetellTransferOutcome,
} from "@/src/lib/phone-calls/result";
import { verifyRetellSignature } from "@/src/lib/phone-calls/retell-signature";
import {
  signalHostedAssistantNotificationsBestEffort,
} from "@/src/lib/hosted-execution/assistant-notifications";

const RETELL_WEBHOOK_MAX_BODY_BYTES = 4 * 1024 * 1024;

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
    case "call_ended": {
      const result = await handleRetellCallEnded({ call: payload.call });
      await signalHostedAssistantNotificationsBestEffort(result.notificationSignals);
      break;
    }
    case "call_analyzed": {
      const result = await handleRetellCallAnalyzed({ call: payload.call });
      await signalHostedAssistantNotificationsBestEffort(result.notificationSignals);
      break;
    }
    case "transfer_bridged":
    case "transfer_cancelled": {
      const result = await handleRetellTransferOutcome({
        call: payload.call,
        event: payload.event,
      });
      await signalHostedAssistantNotificationsBestEffort(result.notificationSignals);
      break;
    }
  }

  return new Response(null, { status: 204 });
});
