import type {
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/contracts";
import { Prisma } from "@prisma/client";
import {
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/parsers";

import {
  type HostedExecutionOutboxPayload,
  readHostedExecutionOutboxPayload,
} from "../hosted-execution/outbox-payload";
import { hostedOnboardingError } from "./errors";

export type HostedWebhookPendingDispatchSideEffectPayload = {
  dispatch: HostedExecutionDispatchRequest;
  storage: "pending";
};

export type HostedWebhookStoredDispatchSideEffectPayload = HostedExecutionOutboxPayload;

export type HostedWebhookDispatchSideEffectPayload =
  | HostedWebhookPendingDispatchSideEffectPayload
  | HostedWebhookStoredDispatchSideEffectPayload;

export function createHostedWebhookDispatchSideEffectPayload(
  dispatch: HostedExecutionDispatchRequest,
): HostedWebhookPendingDispatchSideEffectPayload {
  return {
    dispatch: parseHostedExecutionDispatchRequest(dispatch),
    storage: "pending",
  };
}

export async function stageHostedWebhookDispatchSideEffectPayload(
  payload: HostedWebhookDispatchSideEffectPayload,
): Promise<HostedWebhookStoredDispatchSideEffectPayload> {
  if (payload.storage !== "pending") {
    return payload;
  }

  return {
    dispatch: parseHostedExecutionDispatchRequest(payload.dispatch),
    storage: "inline",
  };
}

export function readHostedWebhookStoredDispatchSideEffectPayload(
  value: unknown,
): HostedWebhookStoredDispatchSideEffectPayload | null {
  return readHostedExecutionOutboxPayload(value as Prisma.InputJsonValue | Prisma.JsonValue | null);
}

export function requireHostedWebhookStoredDispatchSideEffectPayload(
  payload: HostedWebhookDispatchSideEffectPayload,
  effectId: string,
): HostedWebhookStoredDispatchSideEffectPayload {
  const storedPayload = readHostedWebhookStoredDispatchSideEffectPayload(payload);

  if (storedPayload) {
    return storedPayload;
  }

  throw hostedOnboardingError({
    code: "HOSTED_WEBHOOK_DISPATCH_PAYLOAD_NOT_STAGED",
    message: `Hosted webhook dispatch side effect ${effectId} must be staged before it is persisted or enqueued.`,
    httpStatus: 500,
    retryable: false,
  });
}

export function buildHostedWebhookDispatchFromPayload(
  payload: HostedWebhookDispatchSideEffectPayload,
): HostedExecutionDispatchRequest | null {
  if (payload.storage === "pending" || payload.storage === "inline") {
    return parseHostedExecutionDispatchRequest(payload.dispatch);
  }

  return null;
}

export async function deleteHostedStoredDispatchPayloadBestEffort(
  _payload?: HostedWebhookStoredDispatchSideEffectPayload,
): Promise<void> {}
