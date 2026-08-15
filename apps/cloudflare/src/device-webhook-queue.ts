import {
  createDeviceWebhookTransportPrivateKeyringFromJson,
  DEVICE_WEBHOOK_ADMISSION_BATCH_SCHEMA,
  DEVICE_WEBHOOK_ADMISSION_MAX_BODY_BYTES,
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

const deviceWebhookAdmissionBodyEncoder = new TextEncoder();
const deviceWebhookAdmissionBodyPrefix = "{\"entries\":[";
const deviceWebhookAdmissionBodySuffix = `],\"schema\":${JSON.stringify(
  DEVICE_WEBHOOK_ADMISSION_BATCH_SCHEMA,
)}}`;
const deviceWebhookAdmissionEmptyBodyBytes = deviceWebhookAdmissionBodyEncoder
  .encode(deviceWebhookAdmissionBodyPrefix + deviceWebhookAdmissionBodySuffix)
  .byteLength;

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

  for (const subbatch of partitionDeviceWebhookDeliveries(deliveries)) {
    await deliverDeviceWebhookSubbatch(subbatch, environment);
  }
}

function partitionDeviceWebhookDeliveries(
  deliveries: readonly {
    messages: readonly Message<DeviceWebhookQueueEnvelopeV1>[];
    payload: DeviceWebhookQueuePayloadV1;
  }[],
): Array<Array<{
  messages: readonly Message<DeviceWebhookQueueEnvelopeV1>[];
  payload: DeviceWebhookQueuePayloadV1;
}>> {
  const batches: Array<Array<{
    messages: readonly Message<DeviceWebhookQueueEnvelopeV1>[];
    payload: DeviceWebhookQueuePayloadV1;
  }>> = [];
  let current: Array<{
    messages: readonly Message<DeviceWebhookQueueEnvelopeV1>[];
    payload: DeviceWebhookQueuePayloadV1;
  }> = [];
  let currentBodyBytes = deviceWebhookAdmissionEmptyBodyBytes;
  for (const delivery of deliveries) {
    const payloadBytes = deviceWebhookAdmissionBodyEncoder
      .encode(JSON.stringify(delivery.payload))
      .byteLength;
    const candidateBodyBytes = currentBodyBytes
      + (current.length > 0 ? 1 : 0)
      + payloadBytes;
    if (
      current.length > 0
      && (
        current.length + 1 > DEVICE_WEBHOOK_ADMISSION_MAX_BATCH_SIZE
        || candidateBodyBytes > DEVICE_WEBHOOK_ADMISSION_MAX_BODY_BYTES
      )
    ) {
      batches.push(current);
      current = [delivery];
      currentBodyBytes = deviceWebhookAdmissionEmptyBodyBytes + payloadBytes;
      continue;
    }
    current.push(delivery);
    currentBodyBytes = candidateBodyBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function serializeDeviceWebhookAdmissionBody(
  deliveries: readonly { payload: DeviceWebhookQueuePayloadV1 }[],
): string {
  return deviceWebhookAdmissionBodyPrefix
    + deliveries.map(({ payload }) => JSON.stringify(payload)).join(",")
    + deviceWebhookAdmissionBodySuffix;
}

async function deliverDeviceWebhookSubbatch(
  subbatch: readonly {
    messages: readonly Message<DeviceWebhookQueueEnvelopeV1>[];
    payload: DeviceWebhookQueuePayloadV1;
  }[],
  environment: ReturnType<typeof readHostedExecutionEnvironment>,
): Promise<void> {
  const startedAt = Date.now();
  let failureCode = "device-webhook-admission-request-failed";
  const body = serializeDeviceWebhookAdmissionBody(subbatch);
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
      failureCode = "device-webhook-admission-response-rejected";
      throw new Error("Device webhook admission callback failed.");
    }
    failureCode = "device-webhook-admission-response-invalid";
    const result = parseDeviceWebhookAdmissionResult(await response.json());
    const expectedIds = new Set(subbatch.map(({ payload }) => payload.transportId));
    const returnedIds = new Set(result.entries.map((entry) => entry.transportId));
    if (
      result.entries.length !== subbatch.length
      || returnedIds.size !== subbatch.length
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
    const acceptedCount = result.entries.filter(
      (entry) => entry.disposition === "accepted",
    ).length;
    const duplicateCount = result.entries.filter(
      (entry) => entry.disposition === "duplicate",
    ).length;
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: {
        acceptedCount,
        batchSize: subbatch.length,
        duplicateCount,
        durationMs: Date.now() - startedAt,
        reason: "device-webhook-admission-callback-completed",
        retryCount: result.entries.length - acceptedCount - duplicateCount,
      },
      level: "info",
      message: "Device webhook Queue consumer completed a Web admission batch.",
      phase: "checkpoint",
    });
  } catch {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: {
        batchSize: subbatch.length,
        durationMs: Date.now() - startedAt,
        reason: failureCode,
      },
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
