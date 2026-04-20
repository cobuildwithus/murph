import {
  buildHostedExecutionEmailConversationMessageWake,
  parseHostedEmailIngressWakeAppendRequest,
} from "@murphai/hosted-execution";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  appendHostedIngressEnvelopePayloadTx,
} from "@/src/lib/hosted-ingress/queue";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = parseHostedEmailIngressWakeAppendRequest(await readOptionalJsonObject(request));
  const wake = buildHostedExecutionEmailConversationMessageWake({
    eventId: body.eventId,
    identityId: body.identityId,
    occurredAt: body.occurredAt,
    rawMessageKey: body.rawMessageKey,
    ...(body.selfAddress === undefined ? {} : { selfAddress: body.selfAddress }),
    userId,
  });

  const response = await getPrisma().$transaction((tx) => {
    return appendHostedIngressEnvelopePayloadTx({
      wake,
      tx,
    });
  });

  return jsonOk(response);
});
