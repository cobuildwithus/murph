import type { HostedExecutionDispatchRequest } from "@murphai/hosted-execution";

import { buildHostedWebhookDispatchFromPayload } from "./webhook-dispatch-payload";
import type {
  HostedWebhookReceiptState,
  HostedWebhookSideEffect,
} from "./webhook-receipt-types";

export { buildHostedWebhookDispatchFromPayload } from "./webhook-dispatch-payload";

export function readHostedWebhookReceiptDispatchByEventId(
  value: HostedWebhookReceiptState | readonly HostedWebhookSideEffect[],
  eventId: string,
): HostedExecutionDispatchRequest | null {
  if ("sideEffects" in value) {
    return readHostedWebhookDispatchByEventIdFromSideEffects(value.sideEffects, eventId);
  }

  return readHostedWebhookDispatchByEventIdFromSideEffects(value, eventId);
}

function readHostedWebhookDispatchByEventIdFromSideEffects(
  sideEffects: readonly HostedWebhookSideEffect[],
  eventId: string,
): HostedExecutionDispatchRequest | null {
  for (const sideEffect of sideEffects) {
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
