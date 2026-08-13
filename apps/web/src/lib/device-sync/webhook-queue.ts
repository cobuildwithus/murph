import {
  canQueueDeviceWebhook,
  copyDeviceWebhookTransportHeaders,
  sealDeviceWebhookQueueEnvelope,
  type DeviceWebhookTransportHeader,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import { deviceSyncError } from "@murphai/device-syncd/errors";

import { getHostedWebCryptoConfig } from "../hosted-crypto/env";
import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";

const QUEUE_PROVIDER_ENV = "HOSTED_DEVICE_WEBHOOK_QUEUE_PROVIDERS";
const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const QUEUE_CAPABLE_PROVIDERS = new Set(["junction", "oura", "strava", "whoop"]);

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
  headers: Headers;
  provider: string;
  rawBody: Uint8Array;
  source?: Readonly<Record<string, string | undefined>>;
}): { enabled: boolean; headers: DeviceWebhookTransportHeader[] } {
  const providerEnabled = readHostedDeviceWebhookQueueProviders(input.source).has(
    input.provider.toLowerCase(),
  );
  if (!providerEnabled) {
    return { enabled: false, headers: [] };
  }
  try {
    const headers = copyDeviceWebhookTransportHeaders(input.headers);
    return {
      enabled: canQueueDeviceWebhook({ headers, rawBody: input.rawBody }),
      headers,
    };
  } catch {
    return { enabled: false, headers: [] };
  }
}

export async function enqueueHostedDeviceWebhook(input: {
  headers: readonly DeviceWebhookTransportHeader[];
  provider: string;
  rawBody: Uint8Array;
  receivedAt: string;
}): Promise<{ accepted: true; transportId: string }> {
  const cryptoConfig = getHostedWebCryptoConfig();
  const envelope = await sealDeviceWebhookQueueEnvelope({
    env: cryptoConfig.env,
    headers: input.headers,
    provider: input.provider,
    rawBody: input.rawBody,
    receivedAt: input.receivedAt,
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
    throw deviceSyncError({
      cause,
      code: "DEVICE_WEBHOOK_QUEUE_ENQUEUE_FAILED",
      httpStatus: 503,
      message: "Device webhook durable transport did not confirm acceptance.",
      retryable: true,
    });
  }
}
