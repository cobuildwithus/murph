import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  appendHostedExecutionWakePayloadTx,
  materializeHostedAssistantCronWakeTx,
} from "@/src/lib/hosted-wake/queue";
import { materializeHostedDueWakesTx } from "@/src/lib/hosted-wake/materialize";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const response = await getPrisma().$transaction((tx) => {
    return materializeHostedDueWakesTx({
      appendAssistantCronWake: ({ occurredAt, reason, userId }) => materializeHostedAssistantCronWakeTx({
        occurredAt,
        reason,
        tx,
        userId,
      }),
      appendWakePayload: ({ wake }) => appendHostedExecutionWakePayloadTx({
        tx,
        wake,
      }),
      tx,
      userId,
    });
  });

  return jsonOk(response);
});
