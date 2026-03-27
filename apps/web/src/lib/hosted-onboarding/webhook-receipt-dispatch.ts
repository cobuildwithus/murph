import { Prisma } from "@prisma/client";
import type { HostedExecutionDispatchRequest } from "@healthybob/hosted-execution";

import { readLegacyHostedExecutionDispatch } from "../hosted-execution/outbox-payload";

export function readHostedWebhookReceiptDispatchByEventId(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
  eventId: string,
): HostedExecutionDispatchRequest | null {
  for (const sideEffect of readHostedWebhookReceiptSideEffects(payloadJson)) {
    const effectObject = toHostedWebhookReceiptObject(sideEffect);
    const kind = readHostedWebhookReceiptText(effectObject.kind);

    if (kind !== "hosted_execution_dispatch") {
      continue;
    }

    const payloadObject = toHostedWebhookReceiptObject(effectObject.payload);
    const dispatch = readLegacyHostedExecutionDispatch(payloadObject.dispatch);

    if (dispatch?.eventId === eventId) {
      return dispatch;
    }
  }

  return null;
}

function readHostedWebhookReceiptSideEffects(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null,
): readonly (Prisma.InputJsonValue | Prisma.JsonValue | null)[] {
  const payloadObject = toHostedWebhookReceiptObject(payloadJson);
  const nestedState = toHostedWebhookReceiptObject(payloadObject.receiptState);

  if (Array.isArray(nestedState.sideEffects)) {
    return nestedState.sideEffects;
  }

  return Array.isArray(payloadObject.receiptSideEffects)
    ? payloadObject.receiptSideEffects
    : [];
}

function readHostedWebhookReceiptText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function toHostedWebhookReceiptObject(
  payloadJson: Prisma.InputJsonValue | Prisma.JsonValue | null | undefined,
): Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null> {
  return payloadJson && typeof payloadJson === "object" && !Array.isArray(payloadJson)
    ? payloadJson as Record<string, Prisma.InputJsonValue | Prisma.JsonValue | null>
    : {};
}
