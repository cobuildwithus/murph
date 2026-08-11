import {
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
} from "@murphai/device-syncd/hosted-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mapHostedInternalAccountRecord: vi.fn((record: Record<string, unknown>) => ({
    accessTokenExpiresAt: typeof record.accessTokenExpiresAt === "string" ? record.accessTokenExpiresAt : null,
    connectedAt: typeof record.connectedAt === "string" ? record.connectedAt : "2026-03-26T12:00:00.000Z",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "2026-03-26T12:00:00.000Z",
    displayName: typeof record.displayName === "string" ? record.displayName : null,
    externalAccountId: typeof record.externalAccountId === "string" ? record.externalAccountId : "acct_123",
    id: String(record.id),
    lastErrorCode: typeof record.lastErrorCode === "string" ? record.lastErrorCode : null,
    lastErrorMessage: typeof record.lastErrorMessage === "string" ? record.lastErrorMessage : null,
    lastSyncCompletedAt: typeof record.lastSyncCompletedAt === "string" ? record.lastSyncCompletedAt : null,
    lastSyncErrorAt: typeof record.lastSyncErrorAt === "string" ? record.lastSyncErrorAt : null,
    lastSyncStartedAt: typeof record.lastSyncStartedAt === "string" ? record.lastSyncStartedAt : null,
    lastWebhookAt: typeof record.lastWebhookAt === "string" ? record.lastWebhookAt : null,
    metadata: (record.metadataJson as Record<string, unknown> | undefined) ?? {},
    nextReconcileAt: typeof record.nextReconcileAt === "string" ? record.nextReconcileAt : null,
    provider: String(record.provider),
    scopes: Array.isArray(record.scopes) ? record.scopes.filter((entry): entry is string => typeof entry === "string") : [],
    status: record.status === "reauthorization_required" || record.status === "disconnected" ? record.status : "active",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "2026-03-26T12:00:00.000Z",
  })),
}));

vi.mock("@/src/lib/device-sync/prisma-store", () => ({
  mapHostedInternalAccountRecord: mocks.mapHostedInternalAccountRecord,
  PrismaDeviceSyncControlPlaneStore: class PrismaDeviceSyncControlPlaneStore {},
}));

describe("device-sync hosted runtime helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a token bundle when composing an OAuth Cloudflare-backed runtime account", async () => {
    const {
      composeHostedRuntimeOAuthDeviceSyncAccount,
      requireHostedDeviceSyncStoredTokenBundle,
    } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );

    expect(() => requireHostedDeviceSyncStoredTokenBundle({
      connectionId: "dsc_123",
      storedTokenBundle: null,
      userId: "user-123",
    })).toThrow("Hosted device-sync connection no longer has a stored token bundle.");

    const tokenBundle = requireHostedDeviceSyncStoredTokenBundle({
      connectionId: "dsc_123",
      storedTokenBundle: {
        accessToken: "access-token",
        accessTokenExpiresAt: "2026-03-30T00:00:00.000Z",
        keyVersion: "v1",
        refreshToken: "refresh-token",
        tokenVersion: 3,
      },
      userId: "user-123",
    });

    expect(composeHostedRuntimeOAuthDeviceSyncAccount({
      connection: {
        externalAccountId: "oura_alice",
        id: "dsc_123",
        provider: "oura",
        displayName: "Oura",
        status: "active",
        scopes: ["heartrate"],
        accessTokenExpiresAt: null,
        metadata: {
          nested: {
            drop: true,
          },
          source: "oauth",
        },
        connectedAt: "2026-03-26T12:00:00.000Z",
        lastWebhookAt: null,
        lastSyncStartedAt: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextReconcileAt: null,
        createdAt: "2026-03-26T12:00:00.000Z",
        updatedAt: "2026-03-26T12:00:00.000Z",
      },
      tokenBundle,
    })).toEqual(expect.objectContaining({
      credential: {
        kind: "oauth_tokens",
        tokens: {
          accessToken: "access-token",
          accessTokenExpiresAt: "2026-03-30T00:00:00.000Z",
          refreshToken: "refresh-token",
        },
      },
      disconnectGeneration: 0,
      externalAccountId: "oura_alice",
      metadata: {
        source: "oauth",
      },
    }));
  });

  it("binds device-sync runtime requests to the trusted hosted execution user and normalizes timestamps", async () => {
    expect(parseHostedExecutionDeviceSyncRuntimeSnapshotRequest({
      provider: "oura",
      userId: "user-123",
    }, "user-123")).toEqual({
      includeCredentialMaterial: false,
      provider: "oura",
      userId: "user-123",
    });

    expect(parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      occurredAt: "2026-03-26T12:00:00Z",
      updates: [
        {
          connectionId: "dsc_123",
          localState: {
            lastSyncStartedAt: "2026-03-26T07:00:00-05:00",
          },
          observedUpdatedAt: "2026-03-26T12:00:00+00:00",
          observedTokenVersion: null,
          credential: {
            kind: "oauth_tokens",
            tokenBundle: {
              accessToken: "new-access-token",
              accessTokenExpiresAt: "2026-03-30T01:30:00+01:30",
              keyVersion: "cloudflare-runtime",
              refreshToken: "new-refresh-token",
              tokenVersion: 1,
            },
          },
        },
      ],
      userId: "user-123",
    }, "user-123")).toEqual({
      occurredAt: "2026-03-26T12:00:00.000Z",
      updates: [
        {
          connectionId: "dsc_123",
          localState: {
            lastSyncStartedAt: "2026-03-26T12:00:00.000Z",
          },
          observedUpdatedAt: "2026-03-26T12:00:00.000Z",
          observedTokenVersion: null,
          credential: {
            kind: "oauth_tokens",
            tokenBundle: {
              accessToken: "new-access-token",
              accessTokenExpiresAt: "2026-03-30T00:00:00.000Z",
              keyVersion: "cloudflare-runtime",
              refreshToken: "new-refresh-token",
              tokenVersion: 1,
            },
          },
        },
      ],
      userId: "user-123",
    });
  });

  it("rejects removed flat runtime update fields and only reads canonical nested updates", () => {
    expect(parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connection: {
            displayName: "Oura",
            status: "active",
          },
          connectionId: "dsc_123",
          localState: {
            lastErrorCode: "oauth_expired",
          },
          observedUpdatedAt: null,
        },
      ],
      userId: "user-123",
    }, "user-123")).toEqual({
      updates: [
        {
          connection: {
            displayName: "Oura",
            status: "active",
          },
          connectionId: "dsc_123",
          localState: {
            lastErrorCode: "oauth_expired",
          },
          observedUpdatedAt: null,
        },
      ],
      userId: "user-123",
    });

    expect(() => parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connection: {
            displayName: "Oura",
            status: "active",
          },
          connectionId: "dsc_123",
          displayName: "legacy-top-level-name",
          localState: {
            lastErrorCode: "oauth_expired",
          },
          observedUpdatedAt: null,
        },
      ],
      userId: "user-123",
    }, "user-123")).toThrow(/displayName is not supported/u);
  });

  it("redacts secret-bearing hosted runtime error text across heartbeat, apply, and durable account helpers", async () => {
    const {
      buildHostedPublicDeviceSyncAccount,
    } = await import(
      "@/src/lib/device-sync/internal-runtime"
    );
    const {
      parseHostedLocalHeartbeatPatch,
    } = await import(
      "@/src/lib/device-sync/local-heartbeat"
    );

    const errorText =
      "authorization=Bearer secret-token refresh_token=refresh-secret eyJhbGciOiJIUzI1NiJ9.payload.signature";

    expect(parseHostedLocalHeartbeatPatch({
      lastErrorCode: "access_token=top-secret",
      lastErrorMessage: errorText,
      lastSyncErrorAt: "2026-03-26T12:00:00.000Z",
    })).toMatchObject({
      lastErrorCode: "access_token=[redacted]",
      lastErrorMessage: "authorization=[redacted] refresh_token=[redacted] [redacted.jwt]",
    });

    expect(parseHostedExecutionDeviceSyncRuntimeApplyRequest({
      updates: [
        {
          connectionId: "dsc_123",
          localState: {
            lastErrorCode: "access_token=apply-secret",
            lastErrorMessage: errorText,
          },
          observedUpdatedAt: null,
        },
      ],
      userId: "user-123",
    }, "user-123")).toMatchObject({
      updates: [
        {
          connectionId: "dsc_123",
          localState: {
            lastErrorCode: "access_token=[redacted]",
            lastErrorMessage: "authorization=[redacted] refresh_token=[redacted] [redacted.jwt]",
          },
          observedUpdatedAt: null,
        },
      ],
      userId: "user-123",
    });

    expect(buildHostedPublicDeviceSyncAccount({
      record: {
        accessTokenExpiresAt: null,
        credentialKind: "oauth_tokens",
        credentialMetadata: {},
        providerConfigKey: null,
        providerApplicationId: null,
        providerApplicationRevision: null,
        setupExpiresAt: null,
        setupPhase: null,
        displayName: null,
        externalAccountId: "oura_alice",
        id: "dsc_123",
        connectedAt: "2026-03-26T12:00:00.000Z",
        createdAt: "2026-03-26T12:00:00.000Z",
        lastWebhookAt: null,
        lastSyncStartedAt: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: "2026-03-26T12:00:00.000Z",
        lastErrorCode: "refresh_token=db-secret",
        lastErrorMessage: errorText,
        metadata: {},
        nextReconcileAt: null,
        provider: "oura",
        scopes: [],
        status: "active",
        updatedAt: "2026-03-26T12:00:00.000Z",
        userId: "user-123",
      },
    })).toMatchObject({
      lastErrorCode: "refresh_token=[redacted]",
      lastErrorMessage: "authorization=[redacted] refresh_token=[redacted] [redacted.jwt]",
    });
  });
});
