import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDeviceSyncRegistry,
  deviceSyncError,
  type DeviceConnectionHandler,
  type DeviceSyncAccount,
  type DeviceSyncProvider,
  type ProviderAuthTokens,
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
import { sha256Hex } from "@/src/lib/primitives";

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

describe("HostedDeviceSyncAgentSessionService.refreshTokenBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists provider-directed status changes before surfacing refresh errors", async () => {
    type DeviceSyncSignalCreate = (payload: {
      data: Record<string, unknown>;
    }) => Promise<unknown>;
    type DeviceConnectionUpdate = (input: {
      data: Record<string, unknown>;
      where: { id: string };
    }) => Promise<unknown>;

    const createSignalRecord = vi.fn<DeviceSyncSignalCreate>(async () => ({ id: 1 }));
    const updateConnectionRecord = vi.fn<DeviceConnectionUpdate>(async () => ({
      ...createConnectionRecord(),
      status: "reauthorization_required",
      lastSyncErrorAt: new Date("2026-04-01T00:10:00.000Z"),
      lastErrorCode: "WHOOP_REFRESH_TOKEN_MISSING",
      lastErrorMessage: "WHOOP refresh token is missing.",
    }));
    const tx = {
      deviceConnection: {
        findFirst: vi.fn(async () => createConnectionRecord()),
        update: updateConnectionRecord,
      },
      deviceSyncSignal: {
        create: createSignalRecord,
      },
    };
    const touchAgentSession = vi.fn(async () => {
      throw new Error("session touch should not run when refresh fails");
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
          return (input.tx ?? tx).deviceSyncSignal.create({
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
          await txArg.deviceConnection.update({
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
        async getStoredConnectionAccountForUser() {
          return createConnectionRecord();
        },
        async persistStoredConnectionTokenBundle() {
          return;
        },
        async withConnectionMutationLock<TResult>(
          _connectionId: string,
          callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
        ): Promise<TResult> {
          return callback(transactionClient);
        },
        touchAgentSession,
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
    expect(touchAgentSession).not.toHaveBeenCalled();
  });
});

describe("HostedDeviceSyncAgentSessionService retry-safe bearer reuse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed when an agent asks to export a provider-config connection", async () => {
    const createTokenAudit = vi.fn(async () => ({ id: 1 }));
    const store: PrismaDeviceSyncControlPlaneStore = Object.assign(
      Object.create(PrismaDeviceSyncControlPlaneStore.prototype),
      {
        createTokenAudit,
        async getConnectionForUser() {
          const connection = createConnectionRecord();

          return {
            ...connection,
            accessTokenExpiresAt: connection.accessTokenExpiresAt.toISOString(),
            connectedAt: connection.connectedAt.toISOString(),
            createdAt: connection.createdAt.toISOString(),
            lastSyncCompletedAt: null,
            lastSyncErrorAt: null,
            lastSyncStartedAt: null,
            lastWebhookAt: null,
            nextReconcileAt: null,
            updatedAt: connection.updatedAt.toISOString(),
          };
        },
        async getStoredConnectionAccountForUser() {
          return createProviderConfigStoredConnectionRecord();
        },
        getConnectionRecordForUser: vi.fn(async () => {
          return {
            credentialKind: "provider_config",
          };
        }),
      },
    );
    const registry = createDeviceSyncRegistry([createWhoopProvider()]);
    const service = new HostedDeviceSyncAgentSessionService({
      request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/export-token-bundle", "hbds_agent_token"),
      store,
      registry,
    });

    await expect(service.exportTokenBundle(SESSION, "conn-1")).rejects.toMatchObject({
      code: "OAUTH_TOKENS_REQUIRED",
    });
    expect(store.getConnectionRecordForUser).not.toHaveBeenCalled();
    expect(createTokenAudit).not.toHaveBeenCalled();
  });

  it("fails closed when an agent asks to refresh a provider-config connection", async () => {
    const createTokenAudit = vi.fn(async () => ({ id: 1 }));
    const tx = {
      deviceConnection: {
        findFirst: vi.fn(async () => ({
          credentialKind: "provider_config",
          id: "conn-1",
        })),
      },
    };
    const store: PrismaDeviceSyncControlPlaneStore = Object.assign(
      Object.create(PrismaDeviceSyncControlPlaneStore.prototype),
      {
        createTokenAudit,
        async getStoredConnectionAccountForUser() {
          return createProviderConfigStoredConnectionRecord();
        },
        async withConnectionMutationLock<TResult>(
          _connectionId: string,
          callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
        ): Promise<TResult> {
          return callback(Object.assign(Object.create(null), tx));
        },
      },
    );
    const registry = createDeviceSyncRegistry([createWhoopProvider()]);
    const service = new HostedDeviceSyncAgentSessionService({
      request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", "hbds_agent_token"),
      store,
      registry,
    });

    await expect(service.refreshTokenBundle(SESSION, "conn-1", { force: true })).rejects.toMatchObject({
      code: "OAUTH_TOKENS_REQUIRED",
    });
    expect(createTokenAudit).not.toHaveBeenCalled();
  });

  it("lets export-token-bundle retry with the original bearer after a lost response", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const registry = createDeviceSyncRegistry([createWhoopProvider()]);

      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const firstService = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/export-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const firstSession = await firstService.requireAgentSession();
      const firstExport = await firstService.exportTokenBundle(firstSession, "conn-1");

      expect(firstExport).toMatchObject({
        tokenBundle: {
          tokenVersion: 2,
        },
      });
      expect(firstExport).not.toHaveProperty("agentSession");
      expect(JSON.stringify(firstExport)).not.toContain(bearerToken);

      vi.setSystemTime(new Date("2026-04-01T00:15:00.000Z"));
      const retryService = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/export-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const retrySession = await retryService.requireAgentSession();
      const retryExport = await retryService.exportTokenBundle(retrySession, "conn-1");
      expect(retryExport).toMatchObject({
        tokenBundle: {
          tokenVersion: 2,
        },
      });
      expect(retryExport).not.toHaveProperty("agentSession");
      expect(JSON.stringify(retryExport)).not.toContain(bearerToken);
      expect(harness.sessionState.revokedAt).toBeNull();
      expect(harness.audits).toHaveLength(2);

      vi.setSystemTime(new Date("2026-04-02T00:05:00.000Z"));
      const expiredService = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/export-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      await expect(expiredService.requireAgentSession()).rejects.toMatchObject({
        code: "AGENT_AUTH_EXPIRED",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechecks agent-session validity before returning an exported token bundle", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const registry = createDeviceSyncRegistry([createWhoopProvider()]);

      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/export-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const session = await service.requireAgentSession();
      harness.sessionState.revokedAt = "2026-04-01T00:10:01.000Z";
      harness.sessionState.revokeReason = "agent_request";
      harness.sessionState.updatedAt = "2026-04-01T00:10:01.000Z";

      await expect(service.exportTokenBundle(session, "conn-1")).rejects.toMatchObject({
        code: "AGENT_AUTH_INVALID",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets refresh-token-bundle retry with the original bearer after a lost response", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const registry = createDeviceSyncRegistry([createWhoopProvider()]);

      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const firstService = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const firstSession = await firstService.requireAgentSession();
      const firstRefresh = await firstService.refreshTokenBundle(firstSession, "conn-1", {
        expectedTokenVersion: 2,
      });

      expect(firstRefresh).toMatchObject({
        refreshed: false,
        tokenVersionChanged: false,
      });
      expect(firstRefresh).not.toHaveProperty("agentSession");
      expect(JSON.stringify(firstRefresh)).not.toContain(bearerToken);

      vi.setSystemTime(new Date("2026-04-01T00:15:00.000Z"));
      const retryService = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const retrySession = await retryService.requireAgentSession();
      const retryRefresh = await retryService.refreshTokenBundle(retrySession, "conn-1", {
        expectedTokenVersion: 2,
      });
      expect(retryRefresh).toMatchObject({
        refreshed: false,
        tokenVersionChanged: false,
        tokenBundle: {
          tokenVersion: 2,
        },
      });
      expect(retryRefresh).not.toHaveProperty("agentSession");
      expect(JSON.stringify(retryRefresh)).not.toContain(bearerToken);
      expect(harness.sessionState.revokedAt).toBeNull();
      expect(harness.audits).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets refresh-token-bundle retry with the original bearer after a performed refresh", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const refreshTokens = vi.fn(async () => ({
        accessToken: "access-token-refreshed",
        accessTokenExpiresAt: "2026-04-01T02:00:00.000Z",
        refreshToken: "refresh-token-refreshed",
      }));
      const registry = createDeviceSyncRegistry([createWhoopProvider({
        refreshTokens,
      })]);

      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const firstService = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const firstSession = await firstService.requireAgentSession();
      const firstRefresh = await firstService.refreshTokenBundle(firstSession, "conn-1", {
        expectedTokenVersion: 2,
        force: true,
      });

      expect(firstRefresh).toMatchObject({
        refreshed: true,
        tokenVersionChanged: true,
        tokenBundle: {
          accessToken: "access-token-refreshed",
          refreshToken: "refresh-token-refreshed",
          tokenVersion: 3,
        },
      });
      expect(firstRefresh).not.toHaveProperty("agentSession");
      expect(JSON.stringify(firstRefresh)).not.toContain(bearerToken);
      expect(refreshTokens).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date("2026-04-01T00:15:00.000Z"));
      const retryService = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const retrySession = await retryService.requireAgentSession();
      const retryRefresh = await retryService.refreshTokenBundle(retrySession, "conn-1", {
        expectedTokenVersion: 2,
      });
      expect(retryRefresh).toMatchObject({
        refreshed: false,
        tokenVersionChanged: true,
        tokenBundle: {
          accessToken: "access-token-refreshed",
          refreshToken: "refresh-token-refreshed",
          tokenVersion: 3,
        },
      });
      expect(retryRefresh).not.toHaveProperty("agentSession");
      expect(JSON.stringify(retryRefresh)).not.toContain(bearerToken);
      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(harness.sessionState.revokedAt).toBeNull();
      expect(harness.audits).toHaveLength(3);
      expect(harness.audits[2]).toMatchObject({
        action: "token_exported",
        channel: "agent_refresh",
        expectedTokenVersion: 2,
        refreshOutcome: "skipped_version_mismatch",
        tokenVersion: 3,
        tokenVersionChanged: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists the provider-returned refresh token bundle without stale-token fallback", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const refreshTokens = vi.fn(async () => ({
        accessToken: "access-token-refreshed",
        accessTokenExpiresAt: "2026-04-01T02:00:00.000Z",
        refreshToken: null,
      }));
      const registry = createDeviceSyncRegistry([createWhoopProvider({
        refreshTokens,
      })]);

      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const firstService = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const firstSession = await firstService.requireAgentSession();
      const firstRefresh = await firstService.refreshTokenBundle(firstSession, "conn-1", {
        expectedTokenVersion: 2,
        force: true,
      });

      expect(firstRefresh).toMatchObject({
        refreshed: true,
        tokenVersionChanged: true,
        tokenBundle: {
          accessToken: "access-token-refreshed",
          refreshToken: null,
          tokenVersion: 3,
        },
      });

      vi.setSystemTime(new Date("2026-04-01T00:15:00.000Z"));
      const retryService = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const retrySession = await retryService.requireAgentSession();
      const retryRefresh = await retryService.refreshTokenBundle(retrySession, "conn-1", {
        expectedTokenVersion: 2,
      });

      expect(retryRefresh).toMatchObject({
        refreshed: false,
        tokenVersionChanged: true,
        tokenBundle: {
          accessToken: "access-token-refreshed",
          refreshToken: null,
          tokenVersion: 3,
        },
      });
      expect(refreshTokens).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

function createWhoopProvider(input: {
  refreshTokens?: DeviceConnectionHandler["refreshTokens"];
} = {}): DeviceSyncProvider {
  return {
    provider: WHOOP_DEVICE_PROVIDER_DESCRIPTOR.provider,
    descriptor: {
      ...WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
      oauth: {
        ...WHOOP_DEVICE_PROVIDER_DESCRIPTOR.oauth,
        defaultScopes: ["offline"],
      },
    },
    connectionHandler: {
      async beginConnection() {
        return { authorizationUrl: "https://provider.example/connect" };
      },
      async completeConnection() {
        throw new Error("not used");
      },
      refreshTokens: input.refreshTokens ?? (async () => {
        throw deviceSyncError({
          code: "WHOOP_REFRESH_TOKEN_MISSING",
          message: "WHOOP refresh token is missing.",
          retryable: false,
          accountStatus: "reauthorization_required",
        });
      }),
    },
    jobExecutor: {
      async executeJob() {
        return {};
      },
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
    accessTokenExpiresAt: new Date("2026-04-01T00:30:00.000Z"),
    metadataJson: {},
    connectedAt: new Date("2026-03-20T00:00:00.000Z"),
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    accessToken: "access-token",
    refreshToken: "refresh-token",
    credential: {
      kind: "oauth_tokens" as const,
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
      } satisfies ProviderAuthTokens,
    },
    keyVersion: "v1",
    tokenVersion: 2,
    createdAt: new Date("2026-03-20T00:00:00.000Z"),
    updatedAt: new Date("2026-03-20T00:00:00.000Z"),
  };
}

function createProviderConfigStoredConnectionRecord() {
  const connection = createConnectionRecord();

  return {
    ...connection,
    accessTokenExpiresAt: null,
    credential: {
      kind: "provider_config" as const,
      credentialMetadata: {},
      providerConfigKey: "junction",
    },
    keyVersion: null,
    provider: "junction",
    refreshToken: null,
    tokenVersion: null,
  };
}

function createAgentRequest(url: string, bearerToken: string): Request {
  return new Request(url, {
    headers: {
      authorization: `Bearer ${bearerToken}`,
    },
  });
}

type MutableSessionState = HostedAgentSessionRecord & {
  tokenHash: string;
};

function createRetrySafeStoreHarness(bearerToken: string): {
  audits: Array<Record<string, unknown>>;
  sessionState: MutableSessionState;
  store: PrismaDeviceSyncControlPlaneStore;
} {
  const sessionState: MutableSessionState = {
    ...SESSION,
    tokenHash: sha256Hex(bearerToken),
  };
  const audits: Array<Record<string, unknown>> = [];
  const connection = createConnectionRecord();
  let publicConnection = {
    ...connection,
    accessTokenExpiresAt: connection.accessTokenExpiresAt.toISOString(),
    connectedAt: connection.connectedAt.toISOString(),
    createdAt: connection.createdAt.toISOString(),
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastSyncStartedAt: null,
    lastWebhookAt: null,
    nextReconcileAt: null,
    updatedAt: connection.updatedAt.toISOString(),
  };
  let storedConnection: Omit<
    typeof publicConnection,
    "accessToken" | "credential" | "keyVersion" | "refreshToken" | "tokenVersion"
  > & {
    accessToken: string;
    credential: DeviceSyncAccount["credential"];
    keyVersion: string;
    refreshToken: string | null;
    tokenVersion: number;
  } = {
    ...publicConnection,
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    keyVersion: connection.keyVersion,
    tokenVersion: connection.tokenVersion,
  };

  const store: PrismaDeviceSyncControlPlaneStore = Object.assign(
    Object.create(PrismaDeviceSyncControlPlaneStore.prototype),
    {
      async authenticateAgentSessionByTokenHash(tokenHash: string, now: string) {
        if (tokenHash !== sessionState.tokenHash) {
          return {
            status: "missing" as const,
            session: null,
          };
        }

        if (sessionState.revokedAt) {
          return {
            status: "revoked" as const,
            session: cloneSessionState(sessionState),
          };
        }

        if (Date.parse(sessionState.expiresAt) <= Date.parse(now)) {
          sessionState.revokedAt = now;
          sessionState.revokeReason = "expired";
          sessionState.updatedAt = now;
          return {
            status: "expired" as const,
            session: cloneSessionState(sessionState),
          };
        }

        sessionState.lastSeenAt = now;
        sessionState.updatedAt = now;
        return {
          status: "active" as const,
          session: cloneSessionState(sessionState),
        };
      },
      async touchAgentSession(input: { sessionId: string; now: string; expiresAt: string }) {
        if (input.sessionId !== sessionState.id || sessionState.revokedAt) {
          throw deviceSyncError({
            code: "AGENT_AUTH_INVALID",
            message: "Hosted device-sync agent bearer token is no longer active.",
            retryable: false,
            httpStatus: 401,
          });
        }

        sessionState.lastSeenAt = input.now;
        sessionState.updatedAt = input.now;
        sessionState.expiresAt = input.expiresAt;
        return cloneSessionState(sessionState);
      },
      async createTokenAudit(input: Record<string, unknown>) {
        audits.push(input);
        return {
          id: audits.length,
          ...input,
        };
      },
      async getConnectionForUser(userId: string, connectionId: string) {
        return userId === SESSION.userId && connectionId === connection.id ? { ...publicConnection } : null;
      },
      async getStoredConnectionAccountForUser(userId: string, connectionId: string) {
        return userId === SESSION.userId && connectionId === connection.id ? { ...storedConnection } : null;
      },
      async persistStoredConnectionTokenBundle(input: {
        connectionId: string;
        externalAccountId: string;
        provider: string;
        tokenBundle: {
          accessToken: string;
          accessTokenExpiresAt: string | null;
          keyVersion: string;
          refreshToken: string | null;
          tokenVersion: number;
        };
      }) {
        if (input.connectionId !== connection.id) {
          return;
        }

        storedConnection = {
          ...storedConnection,
          accessToken: input.tokenBundle.accessToken,
          accessTokenExpiresAt:
            input.tokenBundle.accessTokenExpiresAt ?? storedConnection.accessTokenExpiresAt,
          credential: {
            kind: "oauth_tokens",
            tokens: {
              accessToken: input.tokenBundle.accessToken,
              accessTokenExpiresAt:
                input.tokenBundle.accessTokenExpiresAt ?? storedConnection.accessTokenExpiresAt ?? null,
              refreshToken: input.tokenBundle.refreshToken,
            } satisfies ProviderAuthTokens,
          },
          keyVersion: input.tokenBundle.keyVersion,
          refreshToken: input.tokenBundle.refreshToken,
          tokenVersion: input.tokenBundle.tokenVersion,
          updatedAt: sessionState.updatedAt,
        };
      },
      async syncDurableConnectionState(account: typeof publicConnection) {
        publicConnection = {
          ...publicConnection,
          ...account,
        };
        storedConnection = {
          ...storedConnection,
          ...account,
        };
      },
      async withConnectionMutationLock<TResult>(
        _connectionId: string,
        callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
      ): Promise<TResult> {
        const transactionClient: HostedPrismaTransactionClient = Object.assign(
          Object.create(null),
          {
            deviceConnection: {
              findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
                where.id === connection.id && where.userId === SESSION.userId ? { id: connection.id } : null,
            },
          },
        );

        return callback(transactionClient);
      },
    },
  );

  return {
    audits,
    sessionState,
    store,
  };
}

function cloneSessionState(sessionState: MutableSessionState): HostedAgentSessionRecord {
  return {
    id: sessionState.id,
    userId: sessionState.userId,
    label: sessionState.label,
    createdAt: sessionState.createdAt,
    updatedAt: sessionState.updatedAt,
    expiresAt: sessionState.expiresAt,
    lastSeenAt: sessionState.lastSeenAt,
    revokedAt: sessionState.revokedAt,
    revokeReason: sessionState.revokeReason,
    replacedBySessionId: sessionState.replacedBySessionId,
  };
}
