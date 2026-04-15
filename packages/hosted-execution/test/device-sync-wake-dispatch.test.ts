import { describe, expect, it } from "vitest";

import type { HostedExecutionDeviceSyncRuntimeSnapshotResponse } from "@murphai/device-syncd/hosted-runtime";

import { buildHostedExecutionDeviceSyncWakeDispatch } from "../src/builders.ts";
import { parseHostedExecutionDispatchRequest } from "../src/parsers.ts";

describe("device-sync wake dispatch", () => {
  it("round-trips a device-sync owned runtimeSnapshot through hosted-execution", () => {
    const dispatch = buildHostedExecutionDeviceSyncWakeDispatch({
      connectionId: "conn_123",
      eventId: "evt_123",
      occurredAt: "2026-04-07T00:05:30.000Z",
      provider: "oura",
      reason: "connected",
      runtimeSnapshot: {
        connections: [{
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-07T00:00:00.000Z",
            createdAt: "2026-04-07T00:00:00.000Z",
            displayName: "Oura Ring",
            externalAccountId: "acct_123",
            id: "conn_123",
            metadata: {
              source: "test",
              nested: { ignored: true },
            },
            provider: "oura",
            scopes: ["daily"],
            status: "active",
            updatedAt: "2026-04-07T00:05:00.000Z",
          },
          localState: {
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: "2026-04-07T00:04:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-04-07T00:03:00.000Z",
            lastWebhookAt: null,
            nextReconcileAt: "2026-04-07T01:00:00.000Z",
          },
          tokenBundle: {
            accessToken: "secret-token",
            accessTokenExpiresAt: null,
            keyVersion: "v1",
            refreshToken: null,
            tokenVersion: 1,
          },
        }],
        generatedAt: "2026-04-07T00:05:00.000Z",
        userId: "user_123",
      } satisfies HostedExecutionDeviceSyncRuntimeSnapshotResponse,
      userId: "user_123",
    });

    const parsed = parseHostedExecutionDispatchRequest(dispatch);

    expect(parsed.event.kind).toBe("device-sync.wake");
    if (parsed.event.kind !== "device-sync.wake") {
      throw new Error("Expected a device-sync.wake event.");
    }

    expect(parsed.event.runtimeSnapshot?.connections[0]?.connection.externalAccountId).toBe("acct_123");
    expect(parsed.event.runtimeSnapshot?.connections[0]?.connection.metadata).toEqual({
      source: "test",
    });
  });

  it("fails closed when runtimeSnapshot timestamps are not ISO-8601", () => {
    const dispatch = buildHostedExecutionDeviceSyncWakeDispatch({
      connectionId: "conn_123",
      eventId: "evt_123",
      occurredAt: "2026-04-07T00:05:30.000Z",
      provider: "oura",
      reason: "connected",
      runtimeSnapshot: {
        connections: [{
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "not-a-timestamp",
            createdAt: "2026-04-07T00:00:00.000Z",
            displayName: "Oura Ring",
            externalAccountId: "acct_123",
            id: "conn_123",
            metadata: {},
            provider: "oura",
            scopes: ["daily"],
            status: "active",
          },
          localState: {
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: "2026-04-07T00:04:00.000Z",
            lastSyncErrorAt: null,
            lastSyncStartedAt: "2026-04-07T00:03:00.000Z",
            lastWebhookAt: null,
            nextReconcileAt: "2026-04-07T01:00:00.000Z",
          },
          tokenBundle: null,
        }],
        generatedAt: "2026-04-07T00:05:00.000Z",
        userId: "user_123",
      } as HostedExecutionDeviceSyncRuntimeSnapshotResponse,
      userId: "user_123",
    });

    expect(() => parseHostedExecutionDispatchRequest(dispatch)).toThrow(
      /connectedAt must be an ISO timestamp/i,
    );
  });
});
