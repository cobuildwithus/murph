import {
  canQueuePreparedDeviceWebhook,
  sealDeviceWebhookQueueEnvelope,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import { readCloudflareHostedControlHttpError } from "@murphai/cloudflare-hosted-control/client";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import type { PreparedDeviceSyncWebhookV1 } from "@murphai/device-syncd/prepared-webhook";

import { getHostedWebCryptoConfig } from "../hosted-crypto/env";
import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";

const QUEUE_PROVIDER_ENV = "HOSTED_DEVICE_WEBHOOK_QUEUE_PROVIDERS";
const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const QUEUE_CAPABLE_PROVIDERS = new Set(["junction", "oura", "strava", "whoop"]);
const HOSTED_DEVICE_WEBHOOK_QUEUE_MAX_RAW_BODY_BYTES = 32 * 1024;

export function readHostedDeviceWebhookQueueProviders(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ReadonlySet<string> {
  const raw = source[QUEUE_PROVIDER_ENV]?.trim();
  if (!raw) {
    return new Set();
  }
  const providers = raw.split(",").map((provider) => provider.trim().toLowerCase());
  if (providers.some(
    (provider) => !PROVIDER_PATTERN.test(provider) || !QUEUE_CAPABLE_PROVIDERS.has(provider),
  )) {
    throw new TypeError(`${QUEUE_PROVIDER_ENV} contains an invalid provider.`);
  }
  return new Set(providers);
}

export function prepareHostedDeviceWebhookQueueTransport(input: {
  provider: string;
  rawBody: Uint8Array;
  source?: Readonly<Record<string, string | undefined>>;
}): { enabled: boolean } {
  const providerEnabled = readHostedDeviceWebhookQueueProviders(input.source).has(
    input.provider.toLowerCase(),
  );
  if (!providerEnabled) {
    return { enabled: false };
  }
  // Decide synchronous oversize fallback before provider verification. Once a
  // verified event is prepared for Queue, an enqueue failure never falls
  // through to synchronous admission; the signature/parser never runs twice.
  return {
    enabled:
      input.rawBody.byteLength <= HOSTED_DEVICE_WEBHOOK_QUEUE_MAX_RAW_BODY_BYTES,
  };
}

export async function enqueueHostedDeviceWebhook(input: {
  preparedWebhook: PreparedDeviceSyncWebhookV1;
}): Promise<{ accepted: true; transportId: string }> {
  if (!canQueuePreparedDeviceWebhook(input.preparedWebhook)) {
    throw deviceSyncError({
      code: "DEVICE_WEBHOOK_QUEUE_PREPARED_EVENT_INVALID",
      httpStatus: 500,
      message: "Device webhook prepared event cannot enter durable transport.",
      retryable: false,
    });
  }
  const cryptoConfig = getHostedWebCryptoConfig();
  const envelope = await sealDeviceWebhookQueueEnvelope({
    env: cryptoConfig.env,
    preparedWebhook: input.preparedWebhook,
    recipientKeyId: cryptoConfig.cloudflareAutomationRecipientKeyId,
    recipientPublicJwk: cryptoConfig.cloudflareAutomationPublicJwk,
  });
  const controlClient = readHostedExecutionControlClientIfConfigured();
  if (!controlClient) {
    throw deviceSyncError({
      code: "DEVICE_WEBHOOK_QUEUE_UNAVAILABLE",
      httpStatus: 503,
      message: "Device webhook durable transport is unavailable.",
      retryable: true,
    });
  }
  try {
    return await controlClient.enqueueDeviceWebhook(envelope);
  } catch (cause) {
    const controlFailure = readCloudflareHostedControlHttpError(cause);
    const diagnosticType = mapDeviceWebhookQueueControlFailureCode(
      controlFailure?.code,
    );
    throw deviceSyncError({
      cause,
      code: "DEVICE_WEBHOOK_QUEUE_ENQUEUE_FAILED",
      details: { type: diagnosticType },
      httpStatus: 503,
      message: "Device webhook durable transport did not confirm acceptance.",
      retryable: true,
    });
  }
}

function mapDeviceWebhookQueueControlFailureCode(code: string | undefined): string {
  switch (code) {
    case "enqueue_failed":
      return "DEVICE_WEBHOOK_QUEUE_ENQUEUE_FAILED";
    case "invalid_request":
      return "DEVICE_WEBHOOK_QUEUE_INVALID_REQUEST";
    case "persistence_failure_unclassified":
      return "DEVICE_WEBHOOK_QUEUE_PERSISTENCE_FAILURE_UNCLASSIFIED";
    case "persistence_key_unavailable":
      return "DEVICE_WEBHOOK_QUEUE_PERSISTENCE_KEY_UNAVAILABLE";
    case "persistence_reseal_failed":
      return "DEVICE_WEBHOOK_QUEUE_PERSISTENCE_RESEAL_FAILED";
    case "queue_unavailable":
      return "DEVICE_WEBHOOK_QUEUE_UNAVAILABLE";
    case "transport_context_mismatch":
      return "DEVICE_WEBHOOK_QUEUE_TRANSPORT_CONTEXT_MISMATCH";
    case "transport_metadata_invalid":
      return "DEVICE_WEBHOOK_QUEUE_TRANSPORT_METADATA_INVALID";
    case "transport_payload_open_failed":
      return "DEVICE_WEBHOOK_QUEUE_TRANSPORT_PAYLOAD_OPEN_FAILED";
    case "transport_recipient_key_unavailable":
      return "DEVICE_WEBHOOK_QUEUE_TRANSPORT_RECIPIENT_KEY_UNAVAILABLE";
    case "transport_root_key_unwrap_failed":
      return "DEVICE_WEBHOOK_QUEUE_TRANSPORT_ROOT_KEY_UNWRAP_FAILED";
    default:
      return "DEVICE_WEBHOOK_QUEUE_ENQUEUE_FAILED";
  }
}
