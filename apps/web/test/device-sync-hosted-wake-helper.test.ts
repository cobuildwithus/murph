import { describe, expect, it } from "vitest";

import { buildHostedDeviceSyncWakeFromSignal } from "@/src/lib/device-sync/wake";

describe("buildHostedDeviceSyncWakeFromSignal", () => {
  it("parses a nested wake hint through the device-sync owner parser", () => {
    const wake = buildHostedDeviceSyncWakeFromSignal({
      connectionId: "conn_123",
      eventId: "evt_123",
      occurredAt: "2026-04-09T00:00:31Z",
      provider: "oura",
      signalKind: "webhook_hint",
      signalPayload: {
        eventType: "webhook",
        jobs: [
          {
            availableAt: "2026-04-09T00:00:00Z",
            dedupeKey: null,
            kind: "resource",
            maxAttempts: 5,
            payload: {
              resourceId: "sleep_123",
            },
            priority: 4,
          },
        ],
        nextReconcileAt: "2026-04-09T01:00:00Z",
        occurredAt: "2026-04-09T00:00:30Z",
        reason: "webhook_hint",
        resourceCategory: "sleep",
        revokeWarning: {
          code: "TOKEN_REVOKED",
          message: "Token was revoked.",
        },
        scopes: ["sleep"],
        traceId: "trace_123",
      },
      userId: "user_123",
    });

    expect(wake).toMatchObject({
      connectionId: "conn_123",
      hint: {
        eventType: "webhook",
        jobs: [
          {
            availableAt: "2026-04-09T00:00:00.000Z",
            dedupeKey: null,
            kind: "resource",
            maxAttempts: 5,
            payload: {
              resourceId: "sleep_123",
            },
            priority: 4,
          },
        ],
        nextReconcileAt: "2026-04-09T01:00:00.000Z",
        occurredAt: "2026-04-09T00:00:30.000Z",
        reason: "webhook_hint",
        resourceCategory: "sleep",
        revokeWarning: {
          code: "TOKEN_REVOKED",
          message: "Token was revoked.",
        },
        scopes: ["sleep"],
        traceId: "trace_123",
      },
      eventId: "evt_123",
      kind: "device-sync.wake",
      occurredAt: "2026-04-09T00:00:31Z",
      provider: "oura",
      reason: "webhook_hint",
      userId: "user_123",
    });
  });

  it("fails closed when the nested wake hint payload is invalid", () => {
    expect(() =>
      buildHostedDeviceSyncWakeFromSignal({
        connectionId: "conn_123",
        eventId: "evt_123",
        occurredAt: "2026-04-09T00:00:31Z",
        provider: "oura",
        signalKind: "webhook_hint",
        signalPayload: {
          jobs: [
            {
              kind: "resource",
              payload: ["not", "an", "object"],
            },
          ],
        },
        userId: "user_123",
      })
    ).toThrow(/jobs\[0\]\.payload must be an object/i);
  });
});
