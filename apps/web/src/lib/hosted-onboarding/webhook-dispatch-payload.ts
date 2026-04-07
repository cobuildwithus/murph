import type {
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";
import { Prisma } from "@prisma/client";
import {
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";

import {
  deleteHostedStoredDispatchPayloadBestEffort as deleteHostedStoredDispatchPayloadBestEffortFromControl,
  maybeStageHostedExecutionDispatchPayload,
} from "../hosted-execution/control";
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
  if (payload.storage === "reference") {
    const storedPayload = readHostedWebhookStoredDispatchSideEffectPayload(payload);

    if (storedPayload) {
      return storedPayload;
    }

    throw hostedOnboardingError({
      code: "HOSTED_WEBHOOK_DISPATCH_PAYLOAD_INVALID",
      message: "Hosted webhook dispatch side effects must keep a valid staged payload envelope.",
      httpStatus: 500,
      retryable: false,
    });
  }

  const stagedPayload = await maybeStageHostedExecutionDispatchPayload(payload.dispatch);
  const storedPayload = readHostedWebhookStoredDispatchSideEffectPayload(stagedPayload);

  if (storedPayload) {
    return storedPayload;
  }

  throw hostedOnboardingError({
    code: "HOSTED_WEBHOOK_DISPATCH_PAYLOAD_REF_REQUIRED",
    message: `Hosted webhook dispatch ${payload.dispatch.eventId} requires a staged Cloudflare payload id.`,
    httpStatus: 500,
    retryable: false,
  });
}

export function readHostedWebhookStoredDispatchSideEffectPayload(
  value: unknown,
): HostedWebhookStoredDispatchSideEffectPayload | null {
  const payload = readHostedExecutionOutboxPayload(value as Prisma.InputJsonValue | Prisma.JsonValue | null);

  return payload?.storage === "reference" && payload.stagedPayloadId
    ? payload
    : null;
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
  return payload.storage === "pending"
    ? parseHostedExecutionDispatchRequest(payload.dispatch)
    : null;
}

export const deleteHostedStoredDispatchPayloadBestEffort =
  deleteHostedStoredDispatchPayloadBestEffortFromControl;
