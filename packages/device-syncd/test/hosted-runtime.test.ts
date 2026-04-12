import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionDeviceSyncConnectLinkPath,
  buildHostedExecutionUserDeviceSyncRuntimePath,
  normalizeHostedDeviceSyncJobHints,
  parseHostedExecutionDeviceSyncConnectLinkResponse,
  parseHostedExecutionDeviceSyncWakeHint,
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncRuntimeApplyResponse,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotResponse,
  resolveHostedDeviceSyncWakeContext,
} from "../src/hosted-runtime.ts";

describe("parseHostedExecutionDeviceSyncRuntimeApplyRequest", () => {
  it("parses hosted runtime link and snapshot payloads with normalized timestamps", () => {
    expect(buildHostedExecutionDeviceSyncConnectLinkPath("oura/webhook")).toBe(
      "/api/internal/device-sync/providers/oura%2Fwebhook/connect-link",
    );
    expect(buildHostedExecutionUserDeviceSyncRuntimePath("user/123")).toBe(
      "/internal/users/user%2F123/device-sync/runtime",
    );
    expect(
      parseHostedExecutionDeviceSyncConnectLinkResponse({
        authorizationUrl: "https://sync.example.test/oauth",
        expiresAt: "2026-04-07T00:00:00.000Z",
        provider: "oura",
        providerLabel: "Oura",
      }),
    ).toEqual({
      authorizationUrl: "https://sync.example.test/oauth",
      expiresAt: "2026-04-07T00:00:00.000Z",
      provider: "oura",
      providerLabel: "Oura",
    });
    expect(
      parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
        {
          connectionId: null,
          provider: "oura",
        },
        "trusted-user",
      ),
    ).toEqual({
      connectionId: null,
      provider: "oura",
      userId: "trusted-user",
    });
    expect(
      parseHostedExecutionDeviceSyncRuntimeSnapshotResponse({
        connections: [
          {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-07T00:00:00+00:00",
              createdAt: "2026-04-06T23:59:59+00:00",
              displayName: "Oura User",
              externalAccountId: "oura-user-1",
              id: "conn_123",
              metadata: {
                __proto__: "blocked",
                accountTier: "pro",
              },
              provider: "oura",
              scopes: ["daily"],
              status: "active",
              updatedAt: null,
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: "2026-04-07T01:00:00+00:00",
            },
            tokenBundle: {
              accessToken: "access-token",
              accessTokenExpiresAt: "2026-04-07T02:00:00+00:00",
              keyVersion: "kv_1",
              refreshToken: null,
              tokenVersion: 3,
            },
          },
        ],
        generatedAt: "2026-04-07T00:00:00.000Z",
        userId: "user_123",
      }),
    ).toEqual({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-07T00:00:00.000Z",
            createdAt: "2026-04-06T23:59:59.000Z",
            displayName: "Oura User",
            externalAccountId: "oura-user-1",
            id: "conn_123",
            metadata: {
              accountTier: "pro",
            },
            provider: "oura",
            scopes: ["daily"],
            status: "active",
          },
          localState: {
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: null,
            lastSyncErrorAt: null,
            lastSyncStartedAt: null,
            lastWebhookAt: null,
            nextReconcileAt: "2026-04-07T01:00:00.000Z",
          },
          tokenBundle: {
            accessToken: "access-token",
            accessTokenExpiresAt: "2026-04-07T02:00:00.000Z",
            keyVersion: "kv_1",
            refreshToken: null,
            tokenVersion: 3,
          },
        },
      ],
      generatedAt: "2026-04-07T00:00:00.000Z",
      userId: "user_123",
    });
  });

  it("accepts string error fields while keeping timestamp fields strict", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "TOKEN_REFRESH_FAILED",
            lastErrorMessage: "Refresh token expired",
            lastSyncErrorAt: "2026-04-07T00:00:00.000Z",
          },
        },
      ],
      userId: "user_123",
    });

    expect(parsed).toEqual({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "TOKEN_REFRESH_FAILED",
            lastErrorMessage: "Refresh token expired",
            lastSyncErrorAt: "2026-04-07T00:00:00.000Z",
          },
        },
      ],
      userId: "user_123",
    });
  });

  it("normalizes timestamps and sanitizes secret-bearing local-state fields", () => {
    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
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
      }),
    ).toEqual({
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

  it("redacts secret-bearing error fields in runtime apply payloads and seeds", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "access_token=apply-secret",
            lastErrorMessage:
              "authorization=Bearer secret-token refresh_token=refresh-secret eyJhbGciOiJIUzI1NiJ9.payload.signature",
          },
          seed: {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-06T23:00:00+00:00",
              createdAt: "2026-04-06T22:00:00+00:00",
              displayName: "Seed User",
              externalAccountId: "oura-user-1",
              id: "conn_123",
              metadata: {},
              provider: "oura",
              scopes: ["daily"],
              status: "active",
            },
            localState: {
              lastErrorCode: "refresh_token=seed-secret",
              lastErrorMessage:
                "authorization=Bearer seed-token refresh_token=seed-refresh eyJhbGciOiJIUzI1NiJ9.seed.payload",
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: null,
            },
            tokenBundle: null,
          },
        },
      ],
      userId: "user_123",
    });

    expect(parsed).toMatchObject({
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastErrorCode: "access_token=[redacted]",
            lastErrorMessage: "authorization=[redacted] refresh_token=[redacted] [redacted.jwt]",
          },
          seed: {
            localState: {
              lastErrorCode: "refresh_token=[redacted]",
              lastErrorMessage: "authorization=[redacted] refresh_token=[redacted] [redacted.jwt]",
            },
          },
        },
      ],
      userId: "user_123",
    });
  });

  it("sanitizes connection metadata updates before they reach durable runtime state", () => {
    const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connection: {
            metadata: {
              "__proto__": "blocked",
              accountTier: "pro",
              attempts: 2,
              nested: {
                secret: "discarded",
              },
              nullValue: null,
              verbose: "x".repeat(257),
            },
          },
          connectionId: "conn_123",
        },
      ],
      userId: "user_123",
    });

    expect(parsed.updates[0]?.connection?.metadata).toEqual({
      accountTier: "pro",
      attempts: 2,
      nullValue: null,
    });
  });

  it("parses apply request and response payloads across seed, local-state, and token-bundle branches", () => {
    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        occurredAt: "2026-04-07T00:00:00+00:00",
        updates: [
          {
            connection: {
              displayName: null,
              metadata: {
                keep: "value",
                nested: {
                  secret: "discarded",
                },
              },
              scopes: ["daily"],
              status: "disconnected",
            },
            connectionId: "conn_123",
            localState: {
              clearError: true,
              lastErrorCode: null,
              lastErrorMessage: "Sync failed",
              lastSyncCompletedAt: null,
              lastSyncErrorAt: "2026-04-07T00:01:00+00:00",
              lastSyncStartedAt: "2026-04-07T00:00:30+00:00",
              lastWebhookAt: null,
              nextReconcileAt: "2026-04-07T01:00:00+00:00",
            },
            observedTokenVersion: null,
            observedUpdatedAt: null,
            seed: {
              connection: {
                accessTokenExpiresAt: null,
                connectedAt: "2026-04-06T23:00:00+00:00",
                createdAt: "2026-04-06T22:00:00+00:00",
                displayName: "Seed User",
                externalAccountId: "oura-user-1",
                id: "conn_123",
                metadata: {
                  trace: "seed",
                },
                provider: "oura",
                scopes: ["daily"],
                status: "reauthorization_required",
                updatedAt: "2026-04-06T23:30:00+00:00",
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
            tokenBundle: {
              accessToken: "access-token",
              accessTokenExpiresAt: null,
              keyVersion: "kv_2",
              refreshToken: "refresh-token",
              tokenVersion: 5,
            },
          },
        ],
        userId: "user_123",
      }),
    ).toEqual({
      occurredAt: "2026-04-07T00:00:00.000Z",
      updates: [
        {
          connection: {
            displayName: null,
            metadata: {
              keep: "value",
            },
            scopes: ["daily"],
            status: "disconnected",
          },
          connectionId: "conn_123",
          localState: {
            clearError: true,
            lastErrorCode: null,
            lastErrorMessage: "Sync failed",
            lastSyncCompletedAt: null,
            lastSyncErrorAt: "2026-04-07T00:01:00.000Z",
            lastSyncStartedAt: "2026-04-07T00:00:30.000Z",
            lastWebhookAt: null,
            nextReconcileAt: "2026-04-07T01:00:00.000Z",
          },
          observedTokenVersion: null,
          observedUpdatedAt: null,
          seed: {
            connection: {
              accessTokenExpiresAt: null,
              connectedAt: "2026-04-06T23:00:00.000Z",
              createdAt: "2026-04-06T22:00:00.000Z",
              displayName: "Seed User",
              externalAccountId: "oura-user-1",
              id: "conn_123",
              metadata: {
                trace: "seed",
              },
              provider: "oura",
              scopes: ["daily"],
              status: "reauthorization_required",
              updatedAt: "2026-04-06T23:30:00.000Z",
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
          tokenBundle: {
            accessToken: "access-token",
            accessTokenExpiresAt: null,
            keyVersion: "kv_2",
            refreshToken: "refresh-token",
            tokenVersion: 5,
          },
        },
      ],
      userId: "user_123",
    });
    expect(
      parseHostedExecutionDeviceSyncRuntimeApplyResponse({
        appliedAt: "2026-04-07T02:00:00.000Z",
        updates: [
          {
            connection: null,
            connectionId: "conn_123",
            status: "missing",
            tokenUpdate: "skipped_version_mismatch",
          },
        ],
        userId: "user_123",
      }),
    ).toEqual({
      appliedAt: "2026-04-07T02:00:00.000Z",
      updates: [
        {
          connection: null,
          connectionId: "conn_123",
          status: "missing",
          tokenUpdate: "skipped_version_mismatch",
        },
      ],
      userId: "user_123",
    });
  });

  it("rejects duplicate connection IDs and mismatched trusted user IDs", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
          },
          {
            connectionId: "conn_123",
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/duplicate connectionId conn_123/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest(
        {
          updates: [
            {
              connectionId: "conn_123",
            },
          ],
          userId: "user_123",
        },
        "trusted_user_456",
      ),
    ).toThrowError(/must match the authenticated hosted execution user/u);
  });

  it("rejects invalid hosted runtime enum and scalar fields", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyResponse({
        appliedAt: "2026-04-07T02:00:00.000Z",
        updates: [
          {
            connection: null,
            connectionId: "conn_123",
            status: "broken",
            tokenUpdate: "missing",
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/status is invalid/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connection: {
              status: "broken",
            },
            connectionId: "conn_123",
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/connection\.status is invalid/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            localState: {
              clearError: "yes",
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/clearError must be a boolean/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            observedTokenVersion: 0,
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/observedTokenVersion must be a positive integer/u);

    expect(() =>
      parseHostedExecutionDeviceSyncRuntimeApplyRequest({
        updates: [
          {
            connectionId: "conn_123",
            localState: {
              lastSyncErrorAt: "not-a-timestamp",
            },
          },
        ],
        userId: "user_123",
      }),
    ).toThrowError(/lastSyncErrorAt must be an ISO timestamp/u);
  });

  it("backfills write results for legacy runtime apply responses", () => {
    expect(parseHostedExecutionDeviceSyncRuntimeApplyResponse({
      appliedAt: "2026-04-07T02:00:00.000Z",
      updates: [
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-07T00:00:00.000Z",
            createdAt: "2026-04-07T00:00:00.000Z",
            displayName: "Applied",
            externalAccountId: "ext_applied",
            id: "conn_applied",
            metadata: {},
            provider: "oura",
            scopes: ["daily"],
            status: "active",
            updatedAt: "2026-04-07T02:00:00.000Z",
          },
          connectionId: "conn_applied",
          status: "updated",
          tokenUpdate: "unchanged",
        },
        {
          connection: {
            accessTokenExpiresAt: null,
            connectedAt: "2026-04-07T00:00:00.000Z",
            createdAt: "2026-04-07T00:00:00.000Z",
            displayName: "Unchanged",
            externalAccountId: "ext_unchanged",
            id: "conn_unchanged",
            metadata: {},
            provider: "oura",
            scopes: ["daily"],
            status: "active",
            updatedAt: "2026-04-07T01:59:00.000Z",
          },
          connectionId: "conn_unchanged",
          status: "updated",
          tokenUpdate: "unchanged",
        },
        {
          connection: null,
          connectionId: "conn_missing",
          status: "missing",
          tokenUpdate: "missing",
        },
      ],
      userId: "user_123",
    }).updates).toEqual([
      expect.objectContaining({
        connectionId: "conn_applied",
        writeUpdate: "applied",
      }),
      expect.objectContaining({
        connectionId: "conn_unchanged",
        writeUpdate: "unchanged",
      }),
      expect.objectContaining({
        connectionId: "conn_missing",
        writeUpdate: "missing",
      }),
    ]);
  });

  it("normalizes hosted wake helpers without mutating the original hint payload", () => {
    const hint = {
      eventType: "sleep.updated",
      jobs: [
        {
          availableAt: "2026-04-07T00:10:00.000Z",
          dedupeKey: null,
          kind: "resource",
          maxAttempts: 3,
          payload: {
            objectId: "sleep_123",
          },
          priority: 90,
        },
        {
          kind: "reconcile",
          payload: {
            windowStart: "2026-04-06T00:00:00.000Z",
          },
        },
      ],
    };

    const context = resolveHostedDeviceSyncWakeContext({
      hint,
    });
    const normalized = normalizeHostedDeviceSyncJobHints(hint);

    expect(context).toEqual({
      connectionId: null,
      hint,
      provider: null,
    });
    expect(normalized).toEqual([
      {
        availableAt: "2026-04-07T00:10:00.000Z",
        dedupeKey: null,
        kind: "resource",
        maxAttempts: 3,
        payload: {
          objectId: "sleep_123",
        },
        priority: 90,
      },
      {
        kind: "reconcile",
        payload: {
          windowStart: "2026-04-06T00:00:00.000Z",
        },
      },
    ]);

    normalized[0]?.payload && ((normalized[0].payload.objectId as string) = "changed");

    expect(hint.jobs[0]?.payload).toEqual({
      objectId: "sleep_123",
    });
    expect(normalizeHostedDeviceSyncJobHints(null)).toEqual([]);
  });

  it("parses the hosted wake hint owner shape once", () => {
    const parsed = parseHostedExecutionDeviceSyncWakeHint({
      eventType: "sleep.updated",
      jobs: [
        {
          availableAt: "2026-04-09T00:00:00Z",
          dedupeKey: null,
          kind: "resource",
          maxAttempts: 3,
          payload: {
            dataType: "sleep",
          },
          priority: 10,
        },
      ],
      nextReconcileAt: null,
      occurredAt: "2026-04-09T00:01:00Z",
      reason: "webhook_hint",
      resourceCategory: "sleep",
      revokeWarning: {
        code: "TOKEN_REVOKED",
        message: "Token was revoked.",
      },
      scopes: ["sleep"],
      traceId: "trace-123",
    });

    expect(parsed).toEqual({
      eventType: "sleep.updated",
      jobs: [
        {
          availableAt: "2026-04-09T00:00:00Z",
          dedupeKey: null,
          kind: "resource",
          maxAttempts: 3,
          payload: {
            dataType: "sleep",
          },
          priority: 10,
        },
      ],
      nextReconcileAt: null,
      occurredAt: "2026-04-09T00:01:00Z",
      reason: "webhook_hint",
      resourceCategory: "sleep",
      revokeWarning: {
        code: "TOKEN_REVOKED",
        message: "Token was revoked.",
      },
      scopes: ["sleep"],
      traceId: "trace-123",
    });
  });

  it("feeds the parsed owner shape into job-hint normalization", () => {
    const hint = parseHostedExecutionDeviceSyncWakeHint({
      jobs: [
        {
          availableAt: "2026-04-09T00:00:00Z",
          kind: "resource",
          payload: {
            resourceId: "abc",
          },
        },
      ],
    });

    expect(normalizeHostedDeviceSyncJobHints(hint)).toEqual([
      {
        availableAt: "2026-04-09T00:00:00Z",
        kind: "resource",
        payload: {
          resourceId: "abc",
        },
      },
    ]);
  });

  it("rejects invalid hosted wake job payloads", () => {
    expect(() =>
      parseHostedExecutionDeviceSyncWakeHint({
        jobs: [
          {
            kind: "resource",
            payload: ["not", "an", "object"],
          },
        ],
      })
    ).toThrow(/payload/i);
  });
});
