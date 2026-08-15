import {
  DEVICE_WEBHOOK_QUEUE_PAYLOAD_SCHEMA,
  type DeviceWebhookQueuePayloadV1,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import { DEVICE_SYNC_PREPARED_WEBHOOK_SCHEMA } from "@murphai/device-syncd/prepared-webhook";
import { afterEach, describe, expect, it, vi } from "vitest";

import { admitHostedDeviceWebhookBatch } from "../src/lib/device-sync/webhook-batch";
import {
  prepareHostedDeviceWebhookQueueTransport,
  readHostedDeviceWebhookQueueProviders,
} from "../src/lib/device-sync/webhook-queue";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("admits 100 same-account deliveries in order with one active event lease", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const entries = Array.from(
      { length: 100 },
      (_, index) => createPayload(index, "shared-account"),
    );
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

  it("runs at most four independent account lanes while preserving response order", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const entries = Array.from({ length: 12 }, (_, index) => createPayload(index));
    let active = 0;
    let maxActive = 0;

    const result = await admitHostedDeviceWebhookBatch({
      entries,
      async handle(entry) {
        active += 1;
        maxActive = Math.max(maxActive, active);
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

    expect(maxActive).toBe(4);
    expect(result.entries.map((entry) => entry.transportId)).toEqual(
      entries.map((entry) => entry.transportId),
    );
  });

  it("isolates one account failure from an independent account lane", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const entries = [
      createPayload(1, "failing-account"),
      createPayload(2, "healthy-account"),
    ];

    const result = await admitHostedDeviceWebhookBatch({
      entries,
      async handle(entry) {
        if (entry.preparedWebhook.externalAccountId === "failing-account") {
          throw new Error("synthetic transaction rollback");
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
      "retry",
      "accepted",
    ]);
  });

  it("isolates duplicate and accepted results while retaining every failed admission", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const entries = Array.from(
      { length: 4 },
      (_, index) => createPayload(index, "shared-account"),
    );
    const result = await admitHostedDeviceWebhookBatch({
      entries,
      async handle(entry) {
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
        if (entry === entries[0]) {
          return {
            accepted: true,
            duplicate: true,
            eventType: "demo.updated",
            provider: "demo",
            traceId: "trace-duplicate",
          };
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
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]?.[1]).toEqual({
      acceptedCount: 1,
      accountLaneCount: 1,
      activeLaneCount: 1,
      batchSize: 4,
      durationMs: expect.any(Number),
      duplicateCount: 1,
      failureCounts: {
        PROVIDER_NOT_REGISTERED: 1,
        WEBHOOK_ACCOUNT_NOT_READY: 1,
      },
      maxAccountLanes: 4,
      retryCount: 2,
    });
    const visibleLog = JSON.stringify(info.mock.calls);
    for (const privateMarker of [
      "shared-account",
      "Retry later.",
      "Provider is unavailable.",
      ...entries.map((entry) => entry.transportId),
      "trace-duplicate",
      "trace-accepted",
    ]) {
      expect(visibleLog).not.toContain(privateMarker);
    }
  });

  it("stops starting admissions at its deadline and retains remaining entries", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const entries = Array.from(
      { length: 10 },
      (_, index) => createPayload(index, "shared-account"),
    );
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
      ...Array.from({ length: 9 }, () => "retry"),
    ]);
    expect(admitted).toBe(1);
  });
});

function createPayload(
  index: number,
  externalAccountId = `opaque-account-${index}`,
): DeviceWebhookQueuePayloadV1 {
  const suffix = index.toString(16).padStart(12, "0");
  return {
    preparedWebhook: {
      acceptanceMode: "level_dirty_hint",
      eventType: "demo.updated",
      externalAccountId,
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
