import {
  DEVICE_WEBHOOK_ADMISSION_ACCOUNT_CHUNK_SIZE,
  DEVICE_WEBHOOK_ADMISSION_ACCOUNT_LANES,
  DEVICE_WEBHOOK_ADMISSION_RESULT_SCHEMA,
  type DeviceWebhookAdmissionResultV1,
  type DeviceWebhookQueuePayloadV1,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import { isDeviceSyncError } from "@murphai/device-syncd/errors";
import type { HandleWebhookResult } from "@murphai/device-syncd/types";

export async function admitHostedDeviceWebhookBatch(input: {
  entries: readonly DeviceWebhookQueuePayloadV1[];
  handleBatch: (
    entries: readonly DeviceWebhookQueuePayloadV1[],
  ) => Promise<readonly PromiseSettledResult<HandleWebhookResult>[]>;
  shouldContinue?: () => boolean;
}): Promise<DeviceWebhookAdmissionResultV1> {
  const startedAt = Date.now();
  const batchSize = input.entries.length;
  const resultSlots = new Array<DeviceWebhookAdmissionResultV1["entries"][number]>(
    batchSize,
  );
  const failureCounts = new Map<string, number>();
  const accountLanes = new Map<string, Array<{
    entry: DeviceWebhookQueuePayloadV1;
    index: number;
  }>>();
  for (const [index, entry] of input.entries.entries()) {
    const key = `${entry.preparedWebhook.provider}\u0000${entry.preparedWebhook.externalAccountId}`;
    const lane = accountLanes.get(key) ?? [];
    lane.push({ entry, index });
    accountLanes.set(key, lane);
  }

  const lanes = [...accountLanes.values()];
  let laneCursor = 0;
  const recordFailureCode = (code: string) => {
    failureCounts.set(code, (failureCounts.get(code) ?? 0) + 1);
  };
  const recordFailure = (error: unknown) => {
    recordFailureCode(isDeviceSyncError(error)
      ? error.code
      : "DEVICE_WEBHOOK_ADMISSION_UNCLASSIFIED");
  };
  const retainForRetry = (item: { entry: DeviceWebhookQueuePayloadV1; index: number }) => {
    resultSlots[item.index] = {
      // Transport owns an already provider-verified exact event until Web
      // durably accepts it. Without a durable quarantine record, even a
      // currently non-retryable contradiction must reach the encrypted DLQ.
      disposition: "retry",
      transportId: item.entry.transportId,
    };
  };

  const runLane = async () => {
    while (laneCursor < lanes.length) {
      const lane = lanes[laneCursor];
      laneCursor += 1;
      if (!lane) return;

      for (
        let offset = 0;
        offset < lane.length;
        offset += DEVICE_WEBHOOK_ADMISSION_ACCOUNT_CHUNK_SIZE
      ) {
        const chunk = lane.slice(
          offset,
          offset + DEVICE_WEBHOOK_ADMISSION_ACCOUNT_CHUNK_SIZE,
        );
        if (input.shouldContinue?.() === false) {
          for (const item of lane.slice(offset)) retainForRetry(item);
          break;
        }

        let settled: readonly PromiseSettledResult<HandleWebhookResult>[];
        try {
          settled = await input.handleBatch(chunk.map(({ entry }) => entry));
        } catch (error) {
          recordFailure(error);
          for (const item of chunk) retainForRetry(item);
          continue;
        }
        if (settled.length !== chunk.length) {
          recordFailureCode("DEVICE_WEBHOOK_ADMISSION_BATCH_RESULT_INVALID");
          for (const item of chunk) retainForRetry(item);
          continue;
        }

        for (const [index, item] of chunk.entries()) {
          const outcome = settled[index];
          if (!outcome || outcome.status === "rejected") {
            recordFailure(outcome?.status === "rejected" ? outcome.reason : null);
            retainForRetry(item);
            continue;
          }
          resultSlots[item.index] = {
            disposition: outcome.value.duplicate ? "duplicate" : "accepted",
            transportId: item.entry.transportId,
          };
        }
      }
    }
  };

  const activeLaneCount = Math.min(
    DEVICE_WEBHOOK_ADMISSION_ACCOUNT_LANES,
    lanes.length,
  );
  await Promise.all(Array.from({ length: activeLaneCount }, () => runLane()));
  const entries = Array.from({ length: resultSlots.length }, (_, index) => resultSlots[index] ?? {
    disposition: "retry" as const,
    transportId: input.entries[index]!.transportId,
  });
  const acceptedCount = entries.filter((entry) => entry.disposition === "accepted").length;
  const duplicateCount = entries.filter((entry) => entry.disposition === "duplicate").length;
  const retryCount = entries.length - acceptedCount - duplicateCount;
  console.info("Queued device webhook admission batch completed.", {
    acceptedCount,
    accountLaneCount: lanes.length,
    activeLaneCount,
    batchSize,
    chunkSize: DEVICE_WEBHOOK_ADMISSION_ACCOUNT_CHUNK_SIZE,
    durationMs: Date.now() - startedAt,
    duplicateCount,
    failureCounts: Object.fromEntries([...failureCounts].sort(([left], [right]) =>
      left.localeCompare(right))),
    maxAccountLanes: DEVICE_WEBHOOK_ADMISSION_ACCOUNT_LANES,
    retryCount,
  });

  return {
    entries,
    schema: DEVICE_WEBHOOK_ADMISSION_RESULT_SCHEMA,
  };
}
