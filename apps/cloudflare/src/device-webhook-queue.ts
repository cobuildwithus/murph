import {
  createDeviceWebhookTransportPrivateKeyringFromJson,
  DEVICE_WEBHOOK_ADMISSION_BATCH_SCHEMA,
  DEVICE_WEBHOOK_ADMISSION_MAX_BATCH_SIZE,
  DEVICE_WEBHOOK_ADMISSION_TIMEOUT_MS,
  DEVICE_WEBHOOK_TRANSPORT_USER_ID,
  HOSTED_DEVICE_WEBHOOK_ADMISSION_PATH,
  openDeviceWebhookQueueEnvelope,
  parseDeviceWebhookAdmissionResult,
  type DeviceWebhookQueueEnvelopeV1,
  type DeviceWebhookQueuePayloadV1,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";

import { readHostedExecutionEnvironment } from "./env.ts";
import { asWorkerStringEnvironment, type WorkerEnvironmentContract } from "./worker-contracts.ts";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "./web-control-plane.ts";

export async function handleHostedDeviceWebhookQueueBatch(
  batch: MessageBatch<DeviceWebhookQueueEnvelopeV1>,
  env: WorkerEnvironmentContract,
): Promise<void> {
  let environment: ReturnType<typeof readHostedExecutionEnvironment>;
  let privateKeyring: ReturnType<typeof createDeviceWebhookTransportPrivateKeyringFromJson>;
  try {
    environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));
    privateKeyring = createDeviceWebhookTransportPrivateKeyringFromJson({
      activePrivateJwkJson: environment.hostedCryptoCloudflareAutomationPrivateJwk,
      activeRecipientKeyId: environment.hostedCryptoCloudflareAutomationKeyId,
      keyringJson: environment.hostedCryptoCloudflareAutomationPrivateKeyringJson,
    });
  } catch {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: {
        batchSize: batch.messages.length,
        reason: "device-webhook-queue-environment-invalid",
      },
      level: "error",
      message: "Device webhook Queue consumer could not initialize its transport environment.",
      phase: "failed",
    });
    for (const message of batch.messages) retryDeviceWebhookMessage(message);
    return;
  }

  const decoded = await Promise.all(batch.messages.map(async (message) => {
    try {
      const payload = await openDeviceWebhookQueueEnvelope({
        env: environment.hostedCryptoEnv,
        envelope: message.body,
        privateKeyring,
      });
      return { message, payload };
    } catch {
      retryDeviceWebhookMessage(message);
      return null;
    }
  }));
  const valid = decoded.filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  );
  const decodeFailureCount = decoded.length - valid.length;
  if (decodeFailureCount > 0) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: {
        batchSize: batch.messages.length,
        decodeFailureCount,
        reason: "device-webhook-queue-decrypt-failed",
      },
      level: "warn",
      message: "Device webhook Queue consumer retained encrypted messages that could not be opened.",
      phase: "failed",
    });
  }
  const { conflicts, deliveries, duplicateCount } = collapseDuplicateDeliveries(valid);
  for (const conflict of conflicts) {
    for (const message of conflict) retryDeviceWebhookMessage(message);
  }
  if (duplicateCount > 0 || conflicts.length > 0) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: {
        conflictingTransportCount: conflicts.length,
        duplicateMessageCount: duplicateCount,
        reason: "device-webhook-queue-duplicate-transport-id",
      },
      level: conflicts.length > 0 ? "warn" : "info",
      message: conflicts.length > 0
        ? "Device webhook Queue consumer retained conflicting transport identifiers."
        : "Device webhook Queue consumer coalesced duplicate deliveries.",
      phase: conflicts.length > 0 ? "failed" : "scheduled",
    });
  }

  for (let index = 0; index < deliveries.length; index += DEVICE_WEBHOOK_ADMISSION_MAX_BATCH_SIZE) {
    const subbatch = deliveries.slice(index, index + DEVICE_WEBHOOK_ADMISSION_MAX_BATCH_SIZE);
    await deliverDeviceWebhookSubbatch(subbatch, environment);
  }
}

async function deliverDeviceWebhookSubbatch(
  subbatch: readonly {
    messages: readonly Message<DeviceWebhookQueueEnvelopeV1>[];
    payload: DeviceWebhookQueuePayloadV1;
  }[],
  environment: ReturnType<typeof readHostedExecutionEnvironment>,
): Promise<void> {
  const body = JSON.stringify({
    entries: subbatch.map(({ payload }) => payload),
    schema: DEVICE_WEBHOOK_ADMISSION_BATCH_SCHEMA,
  });
  try {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: environment.hostedWebBaseUrl,
      body,
      boundUserId: DEVICE_WEBHOOK_TRANSPORT_USER_ID,
      callbackSigning: environment.webCallbackSigning,
      method: "POST",
      path: HOSTED_DEVICE_WEBHOOK_ADMISSION_PATH,
      timeoutMs: DEVICE_WEBHOOK_ADMISSION_TIMEOUT_MS,
    });
    if (!response.ok) {
      throw new Error("Device webhook admission callback failed.");
    }
    const result = parseDeviceWebhookAdmissionResult(await response.json());
    const expectedIds = new Set(subbatch.map(({ payload }) => payload.transportId));
    if (
      result.entries.length !== subbatch.length
      || result.entries.some((entry) => !expectedIds.has(entry.transportId))
    ) {
      throw new Error("Device webhook admission callback returned incomplete dispositions.");
    }
    const dispositions = new Map(
      result.entries.map((entry) => [entry.transportId, entry.disposition]),
    );
    for (const { messages, payload } of subbatch) {
      const disposition = dispositions.get(payload.transportId);
      if (disposition === "accepted" || disposition === "duplicate") {
        for (const message of messages) message.ack();
      } else {
        for (const message of messages) retryDeviceWebhookMessage(message);
      }
    }
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: {
        batchSize: subbatch.length,
        reason: "device-webhook-admission-callback-failed",
      },
      error,
      level: "warn",
      message: "Device webhook Queue consumer retained a subbatch after Web admission did not complete.",
      phase: "failed",
    });
    for (const { messages } of subbatch) {
      for (const message of messages) retryDeviceWebhookMessage(message);
    }
  }
}

function collapseDuplicateDeliveries(
  entries: readonly {
    message: Message<DeviceWebhookQueueEnvelopeV1>;
    payload: DeviceWebhookQueuePayloadV1;
  }[],
): {
  conflicts: Array<Array<Message<DeviceWebhookQueueEnvelopeV1>>>;
  deliveries: Array<{
    messages: Array<Message<DeviceWebhookQueueEnvelopeV1>>;
    payload: DeviceWebhookQueuePayloadV1;
  }>;
  duplicateCount: number;
} {
  const byTransportId = new Map<string, {
    messages: Array<Message<DeviceWebhookQueueEnvelopeV1>>;
    payload: DeviceWebhookQueuePayloadV1;
    serializedPayload: string;
  }>();
  const conflictingIds = new Set<string>();
  let duplicateCount = 0;
  for (const entry of entries) {
    const existing = byTransportId.get(entry.payload.transportId);
    if (!existing) {
      byTransportId.set(entry.payload.transportId, {
        messages: [entry.message],
        payload: entry.payload,
        serializedPayload: JSON.stringify(entry.payload),
      });
      continue;
    }
    existing.messages.push(entry.message);
    if (existing.serializedPayload === JSON.stringify(entry.payload)) {
      duplicateCount += 1;
    } else {
      conflictingIds.add(entry.payload.transportId);
    }
  }
  const conflicts: Array<Array<Message<DeviceWebhookQueueEnvelopeV1>>> = [];
  const deliveries: Array<{
    messages: Array<Message<DeviceWebhookQueueEnvelopeV1>>;
    payload: DeviceWebhookQueuePayloadV1;
  }> = [];
  for (const [transportId, entry] of byTransportId) {
    if (conflictingIds.has(transportId)) {
      conflicts.push(entry.messages);
    } else {
      deliveries.push({ messages: entry.messages, payload: entry.payload });
    }
  }
  return { conflicts, deliveries, duplicateCount };
}

function retryDeviceWebhookMessage(
  message: Message<DeviceWebhookQueueEnvelopeV1>,
): void {
  const attempt = Math.max(1, message.attempts);
  const delaySeconds = Math.min(15 * (2 ** Math.min(attempt - 1, 6)), 900);
  message.retry({ delaySeconds });
}
