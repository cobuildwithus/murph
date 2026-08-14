import {
  DEVICE_WEBHOOK_QUEUE_PAYLOAD_SCHEMA,
  type DeviceWebhookQueuePayloadV1,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import { DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA } from "@murphai/device-syncd/prepared-webhook";
import { describe, expect, it } from "vitest";

import { admitHostedDeviceWebhookBatch } from "../src/lib/device-sync/webhook-batch";
import {
  prepareHostedDeviceWebhookQueueTransport,
  readHostedDeviceWebhookQueueProviders,
} from "../src/lib/device-sync/webhook-queue";

describe("hosted device webhook batch admission", () => {
  it("keeps rollout disabled by default and rejects unsupported provider gates", () => {
    expect(readHostedDeviceWebhookQueueProviders({})).toEqual(new Set());
    expect(() => readHostedDeviceWebhookQueueProviders({
      HOSTED_DEVICE_WEBHOOK_QUEUE_PROVIDERS: "demo",
    })).toThrow("invalid provider");
  });

  it("uses synchronous admission only when a gated body exceeds the Queue contract", () => {
    expect(prepareHostedDeviceWebhookQueueTransport({
      provider: "oura",
      rawBody: new Uint8Array(32 * 1024),
      source: { HOSTED_DEVICE_WEBHOOK_QUEUE_PROVIDERS: "oura" },
    })).toEqual({ enabled: true });
    expect(prepareHostedDeviceWebhookQueueTransport({
      provider: "oura",
      rawBody: new Uint8Array(32 * 1024 + 1),
      source: { HOSTED_DEVICE_WEBHOOK_QUEUE_PROVIDERS: "oura" },
    })).toEqual({ enabled: false });
  });

  it("admits 100 deliveries in order with at most one active handler", async () => {
    const entries = Array.from({ length: 100 }, (_, index) => createPayload(index));
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];

    const result = await admitHostedDeviceWebhookBatch({
      entries,
      async handle(entry) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(entry.transportId);
        await Promise.resolve();
        active -= 1;
        return {
          accepted: true,
          duplicate: false,
          eventType: "demo.updated",
          provider: "demo",
          traceId: `trace-${entry.transportId}`,
        };
      },
    });

    expect(maxActive).toBe(1);
    expect(order).toEqual(entries.map((entry) => entry.transportId));
    expect(result.entries).toHaveLength(100);
    expect(result.entries.every((entry) => entry.disposition === "accepted")).toBe(true);
  });

  it("isolates duplicate and accepted results while retaining every failed admission", async () => {
    const entries = Array.from({ length: 4 }, (_, index) => createPayload(index));
    const result = await admitHostedDeviceWebhookBatch({
      entries,
      async handle(entry) {
        if (entry === entries[0]) {
          return {
            accepted: true,
            duplicate: true,
            eventType: "demo.updated",
            provider: "demo",
            traceId: "trace-duplicate",
          };
        }
        if (entry === entries[1]) {
          throw deviceSyncError({
            code: "WEBHOOK_ACCOUNT_NOT_READY",
            httpStatus: 503,
            message: "Retry later.",
            retryable: true,
          });
        }
        if (entry === entries[2]) {
          throw deviceSyncError({
            code: "PROVIDER_NOT_REGISTERED",
            httpStatus: 404,
            message: "Provider is unavailable.",
            retryable: false,
          });
        }
        return {
          accepted: true,
          duplicate: false,
          eventType: "demo.updated",
          provider: "demo",
          traceId: "trace-accepted",
        };
      },
    });

    expect(result.entries.map((entry) => entry.disposition)).toEqual([
      "duplicate",
      "retry",
      "retry",
      "accepted",
    ]);
  });

  it("stops starting admissions at its deadline and retains remaining entries", async () => {
    const entries = Array.from({ length: 3 }, (_, index) => createPayload(index));
    let admitted = 0;
    const result = await admitHostedDeviceWebhookBatch({
      entries,
      async handle() {
        admitted += 1;
        return {
          accepted: true,
          duplicate: false,
          eventType: "demo.updated",
          provider: "demo",
          traceId: "trace-accepted",
        };
      },
      shouldContinue: () => admitted < 1,
    });

    expect(result.entries.map((entry) => entry.disposition)).toEqual([
      "accepted",
      "retry",
      "retry",
    ]);
  });
});

function createPayload(index: number): DeviceWebhookQueuePayloadV1 {
  const suffix = index.toString(16).padStart(12, "0");
  return {
    preparedWebhook: {
      acceptanceMode: "level_dirty_hint",
      eventType: "demo.updated",
      externalAccountId: `opaque-account-${index}`,
      jobs: [],
      provider: "demo",
      receivedAt: "2026-04-10T12:00:00.000Z",
      schema: DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA,
      traceId: index.toString(16).padStart(64, "0"),
    },
    schema: DEVICE_WEBHOOK_QUEUE_PAYLOAD_SCHEMA,
    transportId: `00000000-0000-4000-8000-${suffix}`,
  };
}
