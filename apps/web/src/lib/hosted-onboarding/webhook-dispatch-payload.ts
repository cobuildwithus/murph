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

export type HostedWebhookDispatchSideEffectPayload = HostedExecutionOutboxPayload;
export type HostedWebhookStoredDispatchSideEffectPayload = HostedExecutionOutboxPayload;

export function createHostedWebhookDispatchSideEffectPayload(
  dispatch: HostedExecutionDispatchRequest,
): HostedWebhookDispatchSideEffectPayload {
  return {
    dispatch: parseHostedExecutionDispatchRequest(dispatch),
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
    code: "HOSTED_WEBHOOK_DISPATCH_PAYLOAD_INVALID",
    message: `Hosted webhook dispatch side effect ${effectId} must use an inline hosted execution payload.`,
    httpStatus: 500,
    retryable: false,
  });
}

export function buildHostedWebhookDispatchFromPayload(
  payload: HostedWebhookDispatchSideEffectPayload,
): HostedExecutionDispatchRequest | null {
  return payload.storage === "inline"
    ? parseHostedExecutionDispatchRequest(payload.dispatch)
    : null;
}
