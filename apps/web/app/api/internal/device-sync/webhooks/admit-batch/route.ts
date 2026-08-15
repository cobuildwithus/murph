import {
  DEVICE_WEBHOOK_ADMISSION_HANDLER_MAX_DURATION_SECONDS,
  DEVICE_WEBHOOK_ADMISSION_MAX_BODY_BYTES,
  DEVICE_WEBHOOK_TRANSPORT_USER_ID,
  parseDeviceWebhookAdmissionBatch,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import { deviceSyncError } from "@murphai/device-syncd/errors";

import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { admitHostedDeviceWebhookBatch } from "@/src/lib/device-sync/webhook-batch";
import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";

export const maxDuration = 90;

if (maxDuration !== DEVICE_WEBHOOK_ADMISSION_HANDLER_MAX_DURATION_SECONDS) {
  throw new TypeError("Device webhook admission duration contract drifted.");
}

export const POST = withJsonError(async (request: Request) => {
  const stopBefore = Date.now() + (maxDuration - 10) * 1_000;
  const authenticated = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: DEVICE_WEBHOOK_ADMISSION_MAX_BODY_BYTES,
  });
  if (authenticated.userId !== DEVICE_WEBHOOK_TRANSPORT_USER_ID) {
    throw deviceSyncError({
      code: "DEVICE_WEBHOOK_BATCH_SUBJECT_INVALID",
      httpStatus: 401,
      message: "Device webhook admission subject is invalid.",
      retryable: false,
    });
  }
  const batch = parseDeviceWebhookAdmissionBatch(authenticated.payload);
  const ingress = createHostedDeviceSyncPublicIngressService(request);
  const result = await admitHostedDeviceWebhookBatch({
    entries: batch.entries,
    shouldContinue: () => Date.now() < stopBefore,
    async handleBatch(entries) {
      return ingress.handlePreparedWebhookBatch(
        entries.map((entry) => entry.preparedWebhook),
      );
    },
  });
  return jsonOk(result);
});
