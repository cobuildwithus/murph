import { describe, expect, it } from "vitest";

import { parseHostedExecutionWake } from "../src/parsers.ts";

describe("device-sync wake parser delegation", () => {
  it("parses the nested wake hint through the device-sync owner", () => {
    const parsed = parseHostedExecutionWake({
      connectionId: "conn_123",
      eventId: "evt_123",
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
      kind: "device-sync.wake",
      occurredAt: "2026-04-09T00:00:31Z",
      provider: "oura",
      reason: "webhook_hint",
      userId: "user_123",
    });

    expect(parsed).toEqual({
      connectionId: "conn_123",
      eventId: "evt_123",
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
      kind: "device-sync.wake",
      occurredAt: "2026-04-09T00:00:31Z",
      provider: "oura",
      reason: "webhook_hint",
      userId: "user_123",
    });
  });

  it("fails closed when delegated wake-hint payload fields are invalid", () => {
    expect(() =>
      parseHostedExecutionWake({
        eventId: "evt_123",
        hint: {
          jobs: [
            {
              kind: "resource",
              maxAttempts: "5",
            },
          ],
        },
        kind: "device-sync.wake",
        occurredAt: "2026-04-09T00:00:31Z",
        reason: "connected",
        userId: "user_123",
      }),
    ).toThrow(/jobs\[0\]\.maxAttempts must be a finite number/i);
  });
});
