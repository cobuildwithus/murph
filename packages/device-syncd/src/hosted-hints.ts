import { resolveConfiguredDeviceSyncProviderManifest } from "./config/provider-manifests.ts";

import type { DeviceSyncJobInput } from "./types.ts";

export function shapeHostedDeviceSyncJobHintPayload(
  provider: string,
  job: Pick<DeviceSyncJobInput, "kind" | "payload">,
): Record<string, unknown> {
  const manifest = resolveConfiguredDeviceSyncProviderManifest(provider);
  const allowlist = manifest?.hostedHintPayloads?.[job.kind];

  if (!allowlist) {
    return {};
  }

  return pickHostedWakePayloadFields(job.payload ?? {}, allowlist);
}

function pickHostedWakePayloadFields(
  payload: Record<string, unknown>,
  allowlist: Record<string, "boolean" | "number" | "string">,
): Record<string, unknown> {
  const shaped: Record<string, unknown> = {};

  for (const [key, valueType] of Object.entries(allowlist)) {
    const value = payload[key];
    if (typeof value === valueType) {
      shaped[key] = value;
    }
  }

  return shaped;
}
