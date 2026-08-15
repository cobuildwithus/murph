import { createCloudflareHostedControlClient } from "@murphai/cloudflare-hosted-control/client";
import { isDeviceSyncError } from "@murphai/device-syncd/errors";
import { DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA } from "@murphai/device-syncd/prepared-webhook";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedWebCryptoConfig: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
}));

vi.mock("../src/lib/hosted-crypto/env", () => ({
  getHostedWebCryptoConfig: mocks.getHostedWebCryptoConfig,
}));
vi.mock("../src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));

import { enqueueHostedDeviceWebhook } from "../src/lib/device-sync/webhook-queue";
import { jsonError } from "../src/lib/device-sync/http";

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  mocks.getHostedWebCryptoConfig.mockReturnValue({
    cloudflareAutomationPublicJwk:
      await crypto.subtle.exportKey("jwk", keyPair.publicKey),
    cloudflareAutomationRecipientKeyId: "automation:test",
    env: "test",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hosted device webhook Queue enqueue", () => {
  it.each([
    "enqueue_failed",
    "invalid_request",
    "persistence_failure_unclassified",
    "persistence_key_unavailable",
    "persistence_reseal_failed",
    "queue_unavailable",
    "transport_context_mismatch",
    "transport_metadata_invalid",
    "transport_payload_open_failed",
    "transport_recipient_key_unavailable",
    "transport_root_key_unwrap_failed",
    "future_unknown_code",
  ])("projects control failure %s into a value-free log stage", async (
    controlCode,
  ) => {
    const expectedLogType = controlCode === "future_unknown_code"
      ? "enqueue_failed"
      : controlCode;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => Response.json(
      {
        code: controlCode,
        error: "Unauthenticated device webhook envelope.",
      },
      { status: 400 },
    ));
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(
      createCloudflareHostedControlClient({
        baseUrl: "https://runner.example.test",
        fetchImpl,
        getBearerToken: async () => "synthetic-oidc-token",
      }),
    );

    try {
      await enqueueHostedDeviceWebhook({
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
      });
      throw new Error("Expected device webhook Queue enqueue to fail.");
    } catch (error) {
      expect(isDeviceSyncError(error)).toBe(true);
      if (!isDeviceSyncError(error)) {
        throw error;
      }
      expect(error).toMatchObject({
        code: "DEVICE_WEBHOOK_QUEUE_ENQUEUE_FAILED",
        details: { type: controlCode },
        httpStatus: 503,
        retryable: true,
      });
      const response = jsonError(error);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "DEVICE_WEBHOOK_QUEUE_ENQUEUE_FAILED",
          message: "Device webhook durable transport did not confirm acceptance.",
          retryable: true,
        },
      });
      expect(warn).toHaveBeenCalledWith(
        "Hosted device-sync route failed.",
        expect.objectContaining({
          deviceWebhookQueueFailureType: expectedLogType,
          errorResponseCode: "DEVICE_WEBHOOK_QUEUE_ENQUEUE_FAILED",
          errorResponseStatus: 503,
        }),
      );
    }
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
