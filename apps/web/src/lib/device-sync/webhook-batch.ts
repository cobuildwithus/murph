import {
  DEVICE_WEBHOOK_ADMISSION_RESULT_SCHEMA,
  type DeviceWebhookAdmissionResultV1,
  type DeviceWebhookQueuePayloadV1,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import { isDeviceSyncError } from "@murphai/device-syncd/errors";
import type { HandleWebhookResult } from "@murphai/device-syncd/types";

export async function admitHostedDeviceWebhookBatch(input: {
  entries: readonly DeviceWebhookQueuePayloadV1[];
  handle: (entry: DeviceWebhookQueuePayloadV1) => Promise<HandleWebhookResult>;
  shouldContinue?: () => boolean;
}): Promise<DeviceWebhookAdmissionResultV1> {
  const entries: DeviceWebhookAdmissionResultV1["entries"] = [];

  // This explicit serial boundary is the database-pressure invariant: a queue
  // batch may represent many webhook deliveries, but only one canonical Web /
  // Postgres admission is ever active at a time.
  for (const entry of input.entries) {
    if (input.shouldContinue?.() === false) {
      entries.push({ disposition: "retry", transportId: entry.transportId });
      continue;
    }
    try {
      const result = await input.handle(entry);
      entries.push({
        disposition: result.duplicate ? "duplicate" : "accepted",
        transportId: entry.transportId,
      });
    } catch (error) {
      console.warn("Queued device webhook admission retained for retry.", {
        failureCode: isDeviceSyncError(error)
          ? error.code
          : "DEVICE_WEBHOOK_ADMISSION_UNCLASSIFIED",
      });
      entries.push({
        // Transport owns an already provider-verified exact event until Web
        // durably accepts it. Without a durable quarantine record, even a
        // currently non-retryable contradiction must reach the encrypted DLQ
        // rather than disappear.
        disposition: "retry",
        transportId: entry.transportId,
      });
    }
  }

  return {
    entries,
    schema: DEVICE_WEBHOOK_ADMISSION_RESULT_SCHEMA,
  };
}
