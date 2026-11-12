import { sanitizeHostedRuntimeDiagnosticText } from "@murphai/device-syncd/hosted-runtime";
import { resolveDeviceSyncStoreNextJobWakeAt } from "@murphai/device-syncd/service";

import type { HostedAssistantRuntimeDeviceSyncConfig } from "./models.ts";
import type { HostedRuntimePlatform } from "./platform.ts";
import { writeHostedRuntimeLogBestEffort } from "./runtime-logs.ts";

// A queued reply waits on this projection before it is sent. Keep this module
// free of the deferred maintenance graph (provider registry and SDK): loading
// that graph here held first replies on a cold container for seconds.

const HOSTED_DEVICE_SYNC_YIELDED_RETRY_DELAY_MS = 30_000;

export function resolveHostedDeviceSyncYieldRetryAt(now = new Date()): string {
  return new Date(now.getTime() + HOSTED_DEVICE_SYNC_YIELDED_RETRY_DELAY_MS).toISOString();
}

export function resolveHostedDeviceSyncNextWakeAt(input: {
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null;
  platform?: Pick<HostedRuntimePlatform, "logPort"> | null;
  vaultRoot: string;
}): string | null {
  if (!input.deviceSyncConfig) {
    return null;
  }

  try {
    // Web's scheduled reconciler owns provider cadence; only unfinished jobs
    // need a runtime wake. Including cadence creates a connectionless pass.
    return resolveDeviceSyncStoreNextJobWakeAt({ vaultRoot: input.vaultRoot });
  } catch (error) {
    if (input.platform?.logPort) {
      void writeHostedRuntimeLogBestEffort({
        entry: {
          component: "device-sync",
          eventCode: "device-sync.wake_projection_failed",
          level: "warn",
          phase: "invoke",
          redactedJson: {
            errorSummary: sanitizeHostedRuntimeDiagnosticText(
              error instanceof Error ? error.message : String(error),
            ) ?? "device sync wake projection failed",
          },
        },
        platform: input.platform,
      });
    }
    return resolveHostedDeviceSyncYieldRetryAt();
  }
}
