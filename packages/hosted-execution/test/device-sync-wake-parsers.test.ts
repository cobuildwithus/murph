import { describe, expect, it } from "vitest";

import { parseHostedExecutionDispatchRequest } from "../src/parsers.ts";

describe("device-sync wake hint parser delegation", () => {
  it("parses the nested wake hint through the device-sync owner", () => {
    const parsed = parseHostedExecutionDispatchRequest({
      event: {
        connectionId: "conn_123",
        hint: {
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
        kind: "device-sync.wake",
        provider: "oura",
        reason: "webhook_hint",
        userId: "user_123",
      },
      eventId: "evt_123",
      occurredAt: "2026-04-09T00:00:31Z",
    });

    expect(parsed.event.kind).toBe("device-sync.wake");
    if (parsed.event.kind !== "device-sync.wake") {
      throw new Error("Expected a device-sync.wake event.");
    }

    expect(parsed.event.hint).toEqual({
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
    });
  });

  it("fails closed when delegated wake-hint payload fields are invalid", () => {
    expect(() =>
      parseHostedExecutionDispatchRequest({
        event: {
          hint: {
            jobs: [
              {
                kind: "resource",
                maxAttempts: "5",
              },
            ],
          },
          kind: "device-sync.wake",
          reason: "connected",
          userId: "user_123",
        },
        eventId: "evt_123",
        occurredAt: "2026-04-09T00:00:31Z",
      })
    ).toThrow(/jobs\[0\]\.maxAttempts must be a finite number/i);
  });
});
