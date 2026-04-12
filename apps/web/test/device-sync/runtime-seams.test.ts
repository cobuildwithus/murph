import {
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
} from "@murphai/device-syncd/hosted-runtime";
import { describe, expect, it } from "vitest";

import {
  parseHostedDeviceSyncRuntimeApplyRequest,
  parseHostedDeviceSyncRuntimeSnapshotRequest,
} from "@/src/lib/device-sync/internal-runtime";
import { parseHostedLocalHeartbeatPatch } from "@/src/lib/device-sync/local-heartbeat";

describe("hosted device-sync runtime compatibility seams", () => {
  it("reuses the canonical hosted-runtime request parsers", () => {
    expect(parseHostedDeviceSyncRuntimeApplyRequest)
      .toBe(parseHostedExecutionDeviceSyncRuntimeApplyRequest);
    expect(parseHostedDeviceSyncRuntimeSnapshotRequest)
      .toBe(parseHostedExecutionDeviceSyncRuntimeSnapshotRequest);
  });

  it("normalizes runtime request timestamps through the shared hosted-runtime parser", () => {
    const parsed = parseHostedDeviceSyncRuntimeApplyRequest({
      occurredAt: "2026-04-12T10:15:00+10:00",
      updates: [
        {
          connectionId: "conn_01",
          localState: {
            lastErrorCode: "Authorization: Bearer secret-token",
            lastErrorMessage: "refresh_token=super-secret",
            lastSyncErrorAt: "2026-04-12T10:20:00+10:00",
          },
          observedTokenVersion: 1,
          seed: {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-12T09:00:00+10:00",
              createdAt: "2026-04-12T08:00:00+10:00",
              displayName: "Morning sync",
              externalAccountId: "acct_01",
              id: "conn_01",
              metadata: {
                nickname: "watch",
              },
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: "2026-04-12T10:10:00+10:00",
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: null,
            },
            tokenBundle: null,
          },
          tokenBundle: null,
        },
      ],
      userId: "user_01",
    });

    expect(parsed).toEqual({
      occurredAt: "2026-04-12T00:15:00.000Z",
      updates: [
        {
          connectionId: "conn_01",
          localState: {
            lastErrorCode: "Authorization: [redacted]",
            lastErrorMessage: "refresh_token=[redacted]",
            lastSyncErrorAt: "2026-04-12T00:20:00.000Z",
          },
          observedTokenVersion: 1,
          seed: {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-11T23:00:00.000Z",
              createdAt: "2026-04-11T22:00:00.000Z",
              displayName: "Morning sync",
              externalAccountId: "acct_01",
              id: "conn_01",
              metadata: {
                nickname: "watch",
              },
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: "2026-04-12T00:10:00.000Z",
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: null,
            },
            tokenBundle: null,
          },
          tokenBundle: null,
        },
      ],
      userId: "user_01",
    });
  });

  it("keeps local heartbeat error redaction aligned with the shared hosted-runtime sanitizer", () => {
    expect(
      parseHostedLocalHeartbeatPatch({
        lastErrorCode: "Authorization: Bearer abc123",
        lastErrorMessage: "refresh_token=xyz789",
        lastSyncErrorAt: "2026-04-12T00:20:00.000Z",
      }),
    ).toEqual({
      lastErrorCode: "Authorization: [redacted]",
      lastErrorMessage: "refresh_token=[redacted]",
      lastSyncErrorAt: "2026-04-12T00:20:00.000Z",
    });
  });
});
