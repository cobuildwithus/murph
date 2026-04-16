import { deviceSyncError } from "./errors.ts";
import { toIsoTimestamp } from "./shared.ts";

import type {
  DeviceSyncRegistry,
  DeviceSyncWebhookPreflightResponse,
} from "./types.ts";

export async function resolveDeviceSyncWebhookPreflightResponse(input: {
  provider: string;
  registry: DeviceSyncRegistry;
  method: string;
  url: URL;
  headers: Headers;
  rawBody: Buffer;
  now?: string;
}): Promise<DeviceSyncWebhookPreflightResponse | null> {
  const provider = input.registry.get(input.provider);

  if (!provider) {
    throw deviceSyncError({
      code: "PROVIDER_NOT_REGISTERED",
      message: `Device sync provider ${input.provider} is not registered.`,
      retryable: false,
      httpStatus: 404,
    });
  }

  if (!provider.descriptor.webhook?.path) {
    throw deviceSyncError({
      code: "WEBHOOKS_NOT_SUPPORTED",
      message: `Device sync provider ${provider.provider} does not accept webhooks.`,
      retryable: false,
      httpStatus: 404,
    });
  }

  return (
    (await provider.webhookAdmin?.handleWebhookPreflight?.({
      method: input.method,
      url: input.url,
      headers: input.headers,
      rawBody: input.rawBody,
      now: input.now ?? toIsoTimestamp(new Date()),
    })) ?? null
  );
}
