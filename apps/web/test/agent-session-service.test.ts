import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDeviceSyncRegistry,
  deviceSyncError,
  type DeviceSyncProvider,
} from "@murphai/device-syncd/public-ingress";
import { WHOOP_DEVICE_PROVIDER_DESCRIPTOR } from "@murphai/importers/device-providers/provider-descriptors";

import { HostedDeviceSyncAgentSessionService } from "@/src/lib/device-sync/agent-session-service";
import {
  PrismaDeviceSyncControlPlaneStore,
} from "@/src/lib/device-sync/prisma-store";
import type {
  HostedAgentSessionRecord,
  HostedPrismaTransactionClient,
} from "@/src/lib/device-sync/prisma-store";

const SESSION: HostedAgentSessionRecord = {
  id: "session-1",
  userId: "user-1",
  label: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  expiresAt: "2026-04-02T00:00:00.000Z",
  lastSeenAt: null,
  revokedAt: null,
  revokeReason: null,
  replacedBySessionId: null,
};

const mocks = vi.hoisted(() => ({
  getDeviceSyncRuntimeSnapshot: vi.fn(),
  applyDeviceSyncRuntimeUpdates: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/runtime-client", () => ({
  requireHostedDeviceSyncRuntimeClient: vi.fn(() => ({
    applyDeviceSyncRuntimeUpdates: mocks.applyDeviceSyncRuntimeUpdates,
    getDeviceSyncRuntimeSnapshot: mocks.getDeviceSyncRuntimeSnapshot,
  })),
}));

describe("HostedDeviceSyncAgentSessionService.refreshTokenBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists provider-directed status changes before surfacing refresh errors", async () => {
    mocks.getDeviceSyncRuntimeSnapshot.mockResolvedValue({
      connections: [
        {
          connection: {
            accessTokenExpiresAt: "2026-04-01T00:20:00.000Z",
            connectedAt: "2026-03-20T00:00:00.000Z",
            createdAt: "2026-03-20T00:00:00.000Z",
            displayName: "WHOOP User",
            externalAccountId: "whoop-user-1",
            id: "conn-1",
            metadata: {},
            provider: "whoop",
            scopes: ["offline"],
            status: "active",
            updatedAt: "2026-03-20T00:00:00.000Z",
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
          tokenBundle: {
            accessToken: "access-token",
            accessTokenExpiresAt: "2026-04-01T00:20:00.000Z",
            keyVersion: "v1",
            refreshToken: "refresh-token",
            tokenVersion: 7,
          },
        },
      ],
      generatedAt: "2026-04-01T00:00:00.000Z",
      userId: "user-1",
    });
    mocks.applyDeviceSyncRuntimeUpdates.mockResolvedValue({
      appliedAt: "2026-04-01T00:10:00.000Z",
      updates: [
        {
          connection: {
            accessTokenExpiresAt: "2026-04-01T00:20:00.000Z",
            connectedAt: "2026-03-20T00:00:00.000Z",
            createdAt: "2026-03-20T00:00:00.000Z",
            displayName: "WHOOP User",
            externalAccountId: "whoop-user-1",
            id: "conn-1",
            metadata: {},
            provider: "whoop",
            scopes: ["offline"],
            status: "reauthorization_required",
            updatedAt: "2026-04-01T00:10:00.000Z",
          },
          connectionId: "conn-1",
          status: "updated",
          tokenUpdate: "unchanged",
        },
      ],
      userId: "user-1",
    });
    const tx = {
      deviceConnection: {
        findFirst: vi.fn(async () => createConnectionRecord()),
        update: vi.fn(async () => ({
          ...createConnectionRecord(),
          status: "reauthorization_required",
          lastSyncErrorAt: new Date("2026-04-01T00:10:00.000Z"),
          lastErrorCode: "WHOOP_REFRESH_TOKEN_MISSING",
          lastErrorMessage: "WHOOP refresh token is missing.",
        })),
      },
      deviceSyncSignal: {
        create: vi.fn(async () => ({ id: 1 })),
      },
    };
    const rotateAgentSession = vi.fn(async () => {
      throw new Error("session rotation should not run when refresh fails");
    });
    const transactionClient: HostedPrismaTransactionClient = Object.assign(Object.create(null), tx);
    const store: PrismaDeviceSyncControlPlaneStore = Object.assign(
      Object.create(PrismaDeviceSyncControlPlaneStore.prototype),
      {
        async createSignal(input: {
          connectionId?: string | null;
          createdAt?: string;
          eventType?: string | null;
          kind: string;
          occurredAt?: string | null;
          provider: string;
          reason?: string | null;
          resourceCategory?: string | null;
          revokeWarning?: { code?: string | null; message?: string | null } | null;
          traceId?: string | null;
          tx?: typeof tx;
          userId: string;
        }) {
          return ((input.tx ?? tx).deviceSyncSignal.create as unknown as (payload: {
            data: Record<string, unknown>;
          }) => Promise<unknown>)({
            data: {
              connectionId: input.connectionId ?? null,
              createdAt: new Date(input.createdAt ?? "2026-04-01T00:10:00.000Z"),
              eventType: input.eventType ?? null,
              kind: input.kind,
              occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
              provider: input.provider,
              reason: input.reason ?? null,
              resourceCategory: input.resourceCategory ?? null,
              revokeWarningCode: input.revokeWarning?.code ?? null,
              revokeWarningMessage: null,
              traceId: input.traceId ?? null,
              userId: input.userId,
            },
          });
        },
        async syncDurableConnectionState(account: {
          connectedAt: string;
          id: string;
          lastErrorCode: string | null;
          lastErrorMessage: string | null;
          lastSyncCompletedAt: string | null;
          lastSyncErrorAt: string | null;
          lastSyncStartedAt: string | null;
          lastWebhookAt: string | null;
          nextReconcileAt: string | null;
          status: string;
        }, txArg: typeof tx) {
          await (txArg.deviceConnection.update as unknown as (input: {
            data: Record<string, unknown>;
            where: { id: string };
          }) => Promise<unknown>)({
            where: {
              id: account.id,
            },
            data: {
              status: account.status,
              connectedAt: new Date(account.connectedAt),
              lastWebhookAt: account.lastWebhookAt ? new Date(account.lastWebhookAt) : null,
              lastSyncStartedAt: account.lastSyncStartedAt ? new Date(account.lastSyncStartedAt) : null,
              lastSyncCompletedAt: account.lastSyncCompletedAt ? new Date(account.lastSyncCompletedAt) : null,
              lastSyncErrorAt: account.lastSyncErrorAt ? new Date(account.lastSyncErrorAt) : null,
              lastErrorCode: account.lastErrorCode,
              lastErrorMessage: null,
              nextReconcileAt: account.nextReconcileAt ? new Date(account.nextReconcileAt) : null,
            },
          });
        },
        async withConnectionRefreshLock<TResult>(
          _connectionId: string,
          callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
        ): Promise<TResult> {
          return callback(transactionClient);
        },
        rotateAgentSession,
      },
    );
    const registry = createDeviceSyncRegistry([createWhoopProvider()]);
    const service = new HostedDeviceSyncAgentSessionService({
      request: new Request("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle"),
      store,
      registry,
    });

    await expect(service.refreshTokenBundle(SESSION, "conn-1", { force: true })).rejects.toMatchObject({
      code: "WHOOP_REFRESH_TOKEN_MISSING",
      accountStatus: "reauthorization_required",
    });

    expect(tx.deviceConnection.update).toHaveBeenCalledWith({
      where: {
        id: "conn-1",
      },
      data: {
        connectedAt: new Date("2026-03-20T00:00:00.000Z"),
        lastErrorCode: "WHOOP_REFRESH_TOKEN_MISSING",
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: expect.any(Date),
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        nextReconcileAt: null,
        status: "reauthorization_required",
      },
    });
    expect(tx.deviceSyncSignal.create).toHaveBeenCalledTimes(1);
    expect(tx.deviceSyncSignal.create).toHaveBeenCalledWith({
      data: {
        connectionId: "conn-1",
        createdAt: expect.any(Date),
        eventType: null,
        kind: "reauthorization_required",
        occurredAt: expect.any(Date),
        provider: "whoop",
        reason: "token_refresh_failed",
        resourceCategory: null,
        revokeWarningCode: "WHOOP_REFRESH_TOKEN_MISSING",
        revokeWarningMessage: null,
        traceId: null,
        userId: "user-1",
      },
    });
    expect(mocks.applyDeviceSyncRuntimeUpdates).toHaveBeenCalledTimes(1);
    expect(mocks.applyDeviceSyncRuntimeUpdates).toHaveBeenCalledWith("user-1", {
      occurredAt: expect.any(String),
      updates: [
        expect.objectContaining({
          connection: {
            status: "reauthorization_required",
          },
          connectionId: "conn-1",
          localState: expect.objectContaining({
            lastErrorCode: "WHOOP_REFRESH_TOKEN_MISSING",
            lastErrorMessage: "WHOOP refresh token is missing.",
          }),
          observedTokenVersion: 7,
          observedUpdatedAt: "2026-03-20T00:00:00.000Z",
        }),
      ],
    });
    expect(rotateAgentSession).not.toHaveBeenCalled();
  });

  it("rejects refreshes when the Cloudflare runtime does not persist the expected token bundle", async () => {
    mocks.getDeviceSyncRuntimeSnapshot
      .mockResolvedValueOnce({
        connections: [
          {
            connection: {
              accessTokenExpiresAt: "2026-04-01T00:20:00.000Z",
              connectedAt: "2026-03-20T00:00:00.000Z",
              createdAt: "2026-03-20T00:00:00.000Z",
              displayName: "WHOOP User",
              externalAccountId: "whoop-user-1",
              id: "conn-1",
              metadata: {},
              provider: "whoop",
              scopes: ["offline"],
              status: "active",
              updatedAt: "2026-03-20T00:00:00.000Z",
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
            tokenBundle: {
              accessToken: "access-token",
              accessTokenExpiresAt: "2026-04-01T00:20:00.000Z",
              keyVersion: "v1",
              refreshToken: "refresh-token",
              tokenVersion: 7,
            },
          },
        ],
        generatedAt: "2026-04-01T00:00:00.000Z",
        userId: "user-1",
      })
      .mockResolvedValueOnce({
        connections: [
          {
            connection: {
              accessTokenExpiresAt: "2026-04-01T00:20:00.000Z",
              connectedAt: "2026-03-20T00:00:00.000Z",
              createdAt: "2026-03-20T00:00:00.000Z",
              displayName: "WHOOP User",
              externalAccountId: "whoop-user-1",
              id: "conn-1",
              metadata: {},
              provider: "whoop",
              scopes: ["offline"],
              status: "active",
              updatedAt: "2026-03-20T00:00:00.000Z",
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
            tokenBundle: {
              accessToken: "access-token",
              accessTokenExpiresAt: "2026-04-01T00:20:00.000Z",
              keyVersion: "v1",
              refreshToken: "refresh-token",
              tokenVersion: 7,
            },
          },
        ],
        generatedAt: "2026-04-01T00:10:00.000Z",
        userId: "user-1",
      });
    mocks.applyDeviceSyncRuntimeUpdates.mockResolvedValue({
      appliedAt: "2026-04-01T00:10:00.000Z",
      updates: [
        {
          connection: {
            accessTokenExpiresAt: "2026-04-02T00:20:00.000Z",
            connectedAt: "2026-03-20T00:00:00.000Z",
            createdAt: "2026-03-20T00:00:00.000Z",
            displayName: "WHOOP User",
            externalAccountId: "whoop-user-1",
            id: "conn-1",
            metadata: {},
            provider: "whoop",
            scopes: ["offline"],
            status: "active",
            updatedAt: "2026-04-01T00:10:00.000Z",
          },
          connectionId: "conn-1",
          status: "updated",
          tokenUpdate: "skipped_version_mismatch",
        },
      ],
      userId: "user-1",
    });
    const tx = {
      deviceConnection: {
        findFirst: vi.fn(async () => createConnectionRecord()),
        update: vi.fn(async () => ({
          ...createConnectionRecord(),
          accessTokenExpiresAt: new Date("2026-04-02T00:20:00.000Z"),
          status: "active",
        })),
      },
    };
    const createTokenAudit = vi.fn(async () => {
      throw new Error("token audit should not run after a runtime conflict");
    });
    const rotateAgentSession = vi.fn(async () => {
      throw new Error("session rotation should not run after a runtime conflict");
    });
    const transactionClient: HostedPrismaTransactionClient = Object.assign(Object.create(null), tx);
    const store: PrismaDeviceSyncControlPlaneStore = Object.assign(
      Object.create(PrismaDeviceSyncControlPlaneStore.prototype),
      {
        createTokenAudit,
        async withConnectionRefreshLock<TResult>(
          _connectionId: string,
          callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
        ): Promise<TResult> {
          return callback(transactionClient);
        },
        rotateAgentSession,
      },
    );
    const registry = createDeviceSyncRegistry([createWhoopRefreshingProvider()]);
    const service = new HostedDeviceSyncAgentSessionService({
      request: new Request("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle"),
      store,
      registry,
    });

    await expect(service.refreshTokenBundle(SESSION, "conn-1", { force: true })).rejects.toMatchObject({
      code: "RUNTIME_STATE_CONFLICT",
      httpStatus: 409,
      retryable: true,
    });

    expect(tx.deviceConnection.update).not.toHaveBeenCalled();
    expect(mocks.applyDeviceSyncRuntimeUpdates).toHaveBeenCalledTimes(1);
    expect(createTokenAudit).not.toHaveBeenCalled();
    expect(rotateAgentSession).not.toHaveBeenCalled();
  });
});

function createWhoopProvider(): DeviceSyncProvider {
  return {
    provider: WHOOP_DEVICE_PROVIDER_DESCRIPTOR.provider,
    descriptor: {
      ...WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
      oauth: {
        ...WHOOP_DEVICE_PROVIDER_DESCRIPTOR.oauth,
        defaultScopes: ["offline"],
      },
    },
    buildConnectUrl: () => "https://provider.example/connect",
    async exchangeAuthorizationCode() {
      throw new Error("not used");
    },
    async refreshTokens() {
      throw deviceSyncError({
        code: "WHOOP_REFRESH_TOKEN_MISSING",
        message: "WHOOP refresh token is missing.",
        retryable: false,
        accountStatus: "reauthorization_required",
      });
    },
    async executeJob() {
      return {};
    },
  };
}

function createWhoopRefreshingProvider(): DeviceSyncProvider {
  return {
    provider: WHOOP_DEVICE_PROVIDER_DESCRIPTOR.provider,
    descriptor: {
      ...WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
      oauth: {
        ...WHOOP_DEVICE_PROVIDER_DESCRIPTOR.oauth,
        defaultScopes: ["offline"],
      },
    },
    buildConnectUrl: () => "https://provider.example/connect",
    async exchangeAuthorizationCode() {
      throw new Error("not used");
    },
    async refreshTokens() {
      return {
        accessToken: "access-token-new",
        accessTokenExpiresAt: "2026-04-02T00:20:00.000Z",
        refreshToken: "refresh-token-new",
      };
    },
    async executeJob() {
      return {};
    },
  };
}

function createConnectionRecord() {
  return {
    id: "conn-1",
    userId: "user-1",
    provider: "whoop",
    externalAccountId: "whoop-user-1",
    displayName: "WHOOP User",
    status: "active",
    scopes: ["offline"],
    accessTokenExpiresAt: new Date("2026-04-01T00:20:00.000Z"),
    metadataJson: {},
    connectedAt: new Date("2026-03-20T00:00:00.000Z"),
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    createdAt: new Date("2026-03-20T00:00:00.000Z"),
    updatedAt: new Date("2026-03-20T00:00:00.000Z"),
  };
}
