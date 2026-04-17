import type {
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/contracts";
import { Prisma } from "@prisma/client";
import {
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/parsers";

import {
  type HostedExecutionDispatchPayload,
  readHostedExecutionDispatchPayload,
} from "../hosted-execution/dispatch-payload";
import { hostedOnboardingError } from "./errors";

export type HostedWebhookDispatchSideEffectPayload = HostedExecutionDispatchPayload;
export type HostedWebhookStoredDispatchSideEffectPayload = HostedExecutionDispatchPayload;

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
  return readHostedExecutionDispatchPayload(value as Prisma.InputJsonValue | Prisma.JsonValue | null);
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
