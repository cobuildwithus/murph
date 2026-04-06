import type { Prisma } from "@prisma/client";
import type { HostedExecutionDispatchRequest } from "@murphai/hosted-execution";

import { readHostedWebhookReceiptState } from "./webhook-receipt-codec";
import { buildHostedWebhookDispatchFromPayload } from "./webhook-dispatch-payload";

export { buildHostedWebhookDispatchFromPayload } from "./webhook-dispatch-payload";

export function readHostedWebhookReceiptDispatchByEventId(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
  eventId: string,
): HostedExecutionDispatchRequest | null {
  const receiptState = readHostedWebhookReceiptState(payloadJson);

  for (const sideEffect of receiptState.sideEffects) {
    if (sideEffect.kind !== "hosted_execution_dispatch") {
      continue;
    }

    const dispatch = buildHostedWebhookDispatchFromPayload(sideEffect.payload);
    if (dispatch?.eventId === eventId) {
      return dispatch;
    }
  }

  return null;
}
