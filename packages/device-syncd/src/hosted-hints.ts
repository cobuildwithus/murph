import { shapeConfiguredDeviceSyncHostedHintPayload } from "./config/provider-manifests.ts";

import type { DeviceSyncJobInput } from "./types.ts";

export function shapeHostedDeviceSyncJobHintPayload(
  provider: string,
  job: Pick<DeviceSyncJobInput, "kind" | "payload">,
): Record<string, unknown> {
  return shapeConfiguredDeviceSyncHostedHintPayload(provider, job);
}
