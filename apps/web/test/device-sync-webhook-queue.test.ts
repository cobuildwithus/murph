import { DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA } from "@murphai/device-syncd/prepared-webhook";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canQueuePreparedDeviceWebhook: vi.fn(() => true),
  enqueueDeviceWebhook: vi.fn(),
  readCloudflareHostedControlHttpError: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  sealDeviceWebhookQueueEnvelope: vi.fn(),
}));

vi.mock("@murphai/cloudflare-hosted-control/client", () => ({
  readCloudflareHostedControlHttpError:
    mocks.readCloudflareHostedControlHttpError,
}));
vi.mock("@murphai/cloudflare-hosted-control/device-webhook-queue", () => ({
  canQueuePreparedDeviceWebhook: mocks.canQueuePreparedDeviceWebhook,
  sealDeviceWebhookQueueEnvelope: mocks.sealDeviceWebhookQueueEnvelope,
}));
vi.mock("../src/lib/hosted-crypto/env", () => ({
  getHostedWebCryptoConfig: vi.fn(() => ({
    cloudflareAutomationPublicJwk: {},
    cloudflareAutomationRecipientKeyId: "automation:test",
    env: "test",
  })),
}));
vi.mock("../src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));

import { enqueueHostedDeviceWebhook } from "../src/lib/device-sync/webhook-queue";

afterEach(() => {
  vi.clearAllMocks();
});

describe("hosted device webhook Queue enqueue", () => {
  it.each([
    ["invalid_request", "DEVICE_WEBHOOK_QUEUE_INVALID_REQUEST"],
    ["queue_unavailable", "DEVICE_WEBHOOK_QUEUE_UNAVAILABLE"],
    [
      "persistence_failure_unclassified",
      "DEVICE_WEBHOOK_QUEUE_PERSISTENCE_FAILURE_UNCLASSIFIED",
    ],
    [
      "persistence_key_unavailable",
      "DEVICE_WEBHOOK_QUEUE_PERSISTENCE_KEY_UNAVAILABLE",
    ],
    [
      "persistence_reseal_failed",
      "DEVICE_WEBHOOK_QUEUE_PERSISTENCE_RESEAL_FAILED",
    ],
    [
      "transport_context_mismatch",
      "DEVICE_WEBHOOK_QUEUE_TRANSPORT_CONTEXT_MISMATCH",
    ],
    [
      "transport_metadata_invalid",
      "DEVICE_WEBHOOK_QUEUE_TRANSPORT_METADATA_INVALID",
    ],
    [
      "transport_payload_open_failed",
      "DEVICE_WEBHOOK_QUEUE_TRANSPORT_PAYLOAD_OPEN_FAILED",
    ],
    [
      "transport_recipient_key_unavailable",
      "DEVICE_WEBHOOK_QUEUE_TRANSPORT_RECIPIENT_KEY_UNAVAILABLE",
    ],
    [
      "transport_root_key_unwrap_failed",
      "DEVICE_WEBHOOK_QUEUE_TRANSPORT_ROOT_KEY_UNWRAP_FAILED",
    ],
    ["enqueue_failed", "DEVICE_WEBHOOK_QUEUE_ENQUEUE_FAILED"],
    ["future_unknown_code", "DEVICE_WEBHOOK_QUEUE_ENQUEUE_FAILED"],
  ])("projects control failure %s as value-free code %s", async (
    controlCode,
    expectedCode,
  ) => {
    const cause = new Error("Synthetic control failure.");
    mocks.sealDeviceWebhookQueueEnvelope.mockResolvedValue({
      encryptedPayload: {},
      rootKeyWrap: {},
      schema: "murph.device-webhook-queue-envelope.v1",
      transportId: "00000000-0000-4000-8000-000000000001",
    });
    mocks.enqueueDeviceWebhook.mockRejectedValue(cause);
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      enqueueDeviceWebhook: mocks.enqueueDeviceWebhook,
    });
    mocks.readCloudflareHostedControlHttpError.mockReturnValue({
      code: controlCode,
      status: 400,
    });

    await expect(enqueueHostedDeviceWebhook({
      preparedWebhook: {
        acceptanceMode: "level_dirty_hint",
        eventType: "demo.updated",
        externalAccountId: "opaque-account",
        jobs: [],
        provider: "junction",
        receivedAt: "2026-08-14T00:00:00.000Z",
        schema: DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA,
        traceId: "1".repeat(64),
      },
    })).rejects.toMatchObject({
      cause,
      code: expectedCode,
      httpStatus: 503,
      retryable: true,
    });
  });
});
