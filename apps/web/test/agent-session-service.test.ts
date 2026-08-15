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
    let lockDepth = 0;
    let refreshLeaseOwner: string | null = null;
    let refreshLeaseExpiresAt: Date | null = null;
    let refreshLeaseTokenVersion: number | null = null;
    const updateConnectionRecord = vi.fn<DeviceConnectionUpdate>(async () => ({
      ...createConnectionRecord(),
      status: "reauthorization_required",
      lastSyncErrorAt: new Date("2026-04-01T00:10:00.000Z"),
      lastErrorCode: "WHOOP_REFRESH_TOKEN_MISSING",
      lastErrorMessage: "WHOOP refresh token is missing.",
    }));
    const tx = {
      deviceConnection: {
        findFirst: vi.fn(async () => ({
          ...createConnectionRecord(),
          refreshLeaseExpiresAt,
          refreshLeaseOwner,
          refreshLeaseTokenVersion,
        })),
        update: updateConnectionRecord,
      },
      deviceSyncSignal: {
        create: createSignalRecord,
      },
    };
    const touchAgentSession = vi.fn(async () => {
      throw new Error("session touch should not run when refresh fails");
    });
    const persistStoredConnectionTokenBundle = vi.fn(async () => {
      return;
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
        persistStoredConnectionTokenBundle,
        async claimConnectionRefreshLease(input: {
          leaseExpiresAt: string;
          leaseOwner: string;
          tokenVersion: number;
        }) {
          refreshLeaseExpiresAt = new Date(input.leaseExpiresAt);
          refreshLeaseOwner = input.leaseOwner;
          refreshLeaseTokenVersion = input.tokenVersion;
          return { status: "claimed" as const };
        },
        async clearConnectionRefreshLease(input: { leaseOwner: string }) {
          if (input.leaseOwner !== refreshLeaseOwner) {
            return false;
          }

          refreshLeaseExpiresAt = null;
          refreshLeaseOwner = null;
          refreshLeaseTokenVersion = null;
          return true;
        },
        async withConnectionMutationLock<TResult>(
          _connectionId: string,
          callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
        ): Promise<TResult> {
          lockDepth++;
          try {
            return await callback(transactionClient);
          } finally {
            lockDepth--;
          }
        },
        async withHealthDataAdmissionLock<TResult>(
          _userId: string,
          _connectionId: string,
          callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
        ): Promise<TResult> {
          lockDepth++;
          try {
            return await callback(transactionClient);
          } finally {
            lockDepth--;
          }
        },
        touchAgentSession,
      },
    );
    const registry = createDeviceSyncRegistry([createWhoopProvider({
      refreshTokens: async () => {
        expect(lockDepth).toBe(0);
        throw deviceSyncError({
          code: "WHOOP_REFRESH_TOKEN_MISSING",
          message: "WHOOP refresh token is missing.",
          retryable: false,
          accountStatus: "reauthorization_required",
        });
      },
    })]);
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
    expect(persistStoredConnectionTokenBundle).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "conn-1",
      refreshLeaseOwner: expect.stringMatching(/^agent-refresh:/u),
      tokenBundle: {
        accessToken: "access-token",
        accessTokenExpiresAt: new Date("2026-04-01T00:30:00.000Z"),
        keyVersion: "v1",
        refreshToken: "refresh-token",
        tokenVersion: 2,
      },
    }));
    expect(touchAgentSession).not.toHaveBeenCalled();
  });

  it("resolves the exact connection provider before claiming a refresh lease", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const bearerToken = "hbds_agent_member_provider";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const prisma = { marker: "member-provider-prisma" };
      Object.assign(harness.store, { prisma });
      const order: string[] = [];
      const originalClaim = harness.store.claimConnectionRefreshLease.bind(
        harness.store,
      );
      const claimConnectionRefreshLease = vi
        .spyOn(harness.store, "claimConnectionRefreshLease")
        .mockImplementation(async (input) => {
          order.push("claim");
          return originalClaim(input);
        });
      const refreshTokens = vi.fn(async () => ({
        accessToken: "member-access-refreshed",
        accessTokenExpiresAt: "2026-04-01T02:00:00.000Z",
        refreshToken: "member-refresh-refreshed",
      }));
      const provider = createWhoopProvider({ refreshTokens });
      const resolveRefreshProvider = vi.fn(async () => {
        order.push("resolve");
        expect(harness.getRefreshLease()).toBeNull();
        return provider;
      });
      const sharedProviderLookup = vi.fn(() => null);
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest(
          "https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle",
          bearerToken,
        ),
        store: harness.store,
        registry: {
          get: sharedProviderLookup,
          list: () => [],
        } as never,
        resolveRefreshProvider,
      });

      const response = await service.refreshTokenBundle(
        SESSION,
        "conn-1",
        { force: true },
      );

      expect(resolveRefreshProvider).toHaveBeenCalledWith({
        connectionId: "conn-1",
        prisma,
        providerId: "whoop",
        userId: "user-1",
      });
      expect(order.slice(0, 2)).toEqual(["resolve", "claim"]);
      expect(claimConnectionRefreshLease).toHaveBeenCalledTimes(1);
      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(sharedProviderLookup).not.toHaveBeenCalled();
      expect(response).toMatchObject({
        refreshed: true,
        tokenBundle: {
          accessToken: "member-access-refreshed",
          refreshToken: "member-refresh-refreshed",
          tokenVersion: 3,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not claim a refresh lease when connection provider resolution fails", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const bearerToken = "hbds_agent_missing_member_provider";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const prisma = { marker: "missing-member-provider-prisma" };
      Object.assign(harness.store, { prisma });
      const claimConnectionRefreshLease = vi.spyOn(
        harness.store,
        "claimConnectionRefreshLease",
      );
      const resolveRefreshProvider = vi.fn(async () => null);
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest(
          "https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle",
          bearerToken,
        ),
        store: harness.store,
        registry: createDeviceSyncRegistry([createWhoopProvider()]),
        resolveRefreshProvider,
      });

      await expect(
        service.refreshTokenBundle(SESSION, "conn-1", { force: true }),
      ).rejects.toMatchObject({
        code: "PROVIDER_NOT_CONFIGURED",
      });
      expect(resolveRefreshProvider).toHaveBeenCalledWith({
        connectionId: "conn-1",
        prisma,
        providerId: "whoop",
        userId: "user-1",
      });
      expect(claimConnectionRefreshLease).not.toHaveBeenCalled();
      expect(harness.getRefreshLease()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a suspended owner before claiming a refresh lease or calling the provider", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const bearerToken = "hbds_agent_suspended_owner";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const refreshTokens = vi.fn(async () => ({
        accessToken: "unexpected-access-token",
      }));
      const admissionError = deviceSyncError({
        code: "CONNECTION_OWNER_SUSPENDED",
        httpStatus: 409,
        message: "Device connections cannot refresh while account deletion is active.",
        retryable: false,
      });
      const admission = vi.spyOn(
        harness.store,
        "withHealthDataAdmissionLock",
      ).mockRejectedValue(admissionError);
      const claim = vi.spyOn(
        harness.store,
        "claimConnectionRefreshLease",
      );
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest(
          "https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle",
          bearerToken,
        ),
        store: harness.store,
        registry: createDeviceSyncRegistry([
          createWhoopProvider({ refreshTokens }),
        ]),
      });

      await expect(service.refreshTokenBundle(
        SESSION,
        "conn-1",
        { force: true },
      )).rejects.toBe(admissionError);

      expect(admission).toHaveBeenCalledWith(
        "user-1",
        "conn-1",
        expect.any(Function),
        { requireActiveMember: true },
      );
      expect(claim).not.toHaveBeenCalled();
      expect(refreshTokens).not.toHaveBeenCalled();
      expect(harness.getRefreshLease()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
        async withConnectionMutationLock<TResult>(
          _connectionId: string,
          callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
        ): Promise<TResult> {
          return await callback(Object.assign(Object.create(null), {
            deviceConnection: {
              findFirst: async () => ({
                credentialKind: "provider_config",
                id: "conn-1",
              }),
            },
          }));
        },
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

  it("rejects export and refresh fast paths before returning tokens when app authority is invalid", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const harness = createRetrySafeStoreHarness("hbds_agent_token");
      const refreshTokens = vi.fn(async () => ({
        accessToken: "unexpected-refreshed-token",
        accessTokenExpiresAt: "2026-04-01T02:00:00.000Z",
        refreshToken: "unexpected-refresh-token",
      }));
      const registry = createDeviceSyncRegistry([createWhoopProvider({ refreshTokens })]);
      const authorityError = deviceSyncError({
        code: "DEVICE_PROVIDER_APPLICATION_INVALID",
        httpStatus: 409,
        message: "Private provider application credentials require repair.",
        retryable: false,
      });
      const assertTokenExportAuthority = vi.fn(async () => {
        throw authorityError;
      });
      const service = new HostedDeviceSyncAgentSessionService({
        assertTokenExportAuthority,
        request: createAgentRequest("https://murph.example/api/device-sync/agent", "hbds_agent_token"),
        store: harness.store,
        registry,
      });

      await expect(service.exportTokenBundle(SESSION, "conn-1")).rejects.toBe(authorityError);
      await expect(service.refreshTokenBundle(SESSION, "conn-1", {
        expectedTokenVersion: 1,
        force: true,
      })).rejects.toBe(authorityError);
      await expect(service.refreshTokenBundle(SESSION, "conn-1")).rejects.toBe(authorityError);

      expect(assertTokenExportAuthority).toHaveBeenCalledTimes(3);
      expect(assertTokenExportAuthority).toHaveBeenCalledWith(expect.objectContaining({
        connectionId: "conn-1",
        providerId: "whoop",
        userId: "user-1",
      }));
      expect(refreshTokens).not.toHaveBeenCalled();
      expect(harness.audits).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
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

  it("rejects token export while a matching refresh lease is active", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const registry = createDeviceSyncRegistry([createWhoopProvider()]);

      harness.setRefreshLease({
        leaseExpiresAt: "2026-04-01T00:15:00.000Z",
        leaseOwner: "agent-refresh:active",
        tokenVersion: 2,
      });
      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/export-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const session = await service.requireAgentSession();
      await expect(service.exportTokenBundle(session, "conn-1")).rejects.toMatchObject({
        code: "TOKEN_REFRESH_IN_PROGRESS",
        retryable: true,
      });
      expect(harness.audits).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects token export when stored tokens remain on a reauthorization-required connection", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const registry = createDeviceSyncRegistry([createWhoopProvider()]);

      harness.setConnectionStatus("reauthorization_required");
      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/export-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const session = await service.requireAgentSession();
      await expect(service.exportTokenBundle(session, "conn-1")).rejects.toMatchObject({
        accountStatus: "reauthorization_required",
        code: "ACCOUNT_REAUTHORIZATION_REQUIRED",
      });
      expect(harness.audits).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed instead of exporting when a refresh lease expired on the same token version", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const registry = createDeviceSyncRegistry([createWhoopProvider()]);

      harness.setRefreshLease({
        leaseExpiresAt: "2026-04-01T00:09:00.000Z",
        leaseOwner: "agent-refresh:lost",
        tokenVersion: 2,
      });
      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/export-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const session = await service.requireAgentSession();
      await expect(service.exportTokenBundle(session, "conn-1")).rejects.toMatchObject({
        accountStatus: "reauthorization_required",
        code: "TOKEN_REFRESH_STATE_UNKNOWN",
        retryable: false,
      });

      expect(harness.audits).toHaveLength(0);
      await expect(harness.store.getStoredConnectionAccountForUser("user-1", "conn-1")).resolves.toMatchObject({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenVersion: 2,
      });
      expect(harness.getRefreshLease()).toBeNull();
      expect(harness.signals).toHaveLength(1);
      expect(harness.getPublicConnection()).toMatchObject({
        lastErrorCode: "TOKEN_REFRESH_STATE_UNKNOWN",
        nextReconcileAt: null,
        status: "reauthorization_required",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechecks agent-session validity when stale export resolution observes a newer token", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const registry = createDeviceSyncRegistry([createWhoopProvider()]);
      const originalWithConnectionMutationLock = harness.store.withConnectionMutationLock.bind(harness.store);
      let lockCount = 0;

      harness.setRefreshLease({
        leaseExpiresAt: "2026-04-01T00:09:00.000Z",
        leaseOwner: "agent-refresh:old",
        tokenVersion: 2,
      });
      harness.store.withConnectionMutationLock = async (connectionId, callback) => {
        lockCount += 1;
        if (lockCount === 2) {
          harness.setStoredTokenBundle({
            accessToken: "access-token-newer",
            accessTokenExpiresAt: "2026-04-01T02:00:00.000Z",
            keyVersion: "v1",
            refreshToken: "refresh-token-newer",
            tokenVersion: 3,
          });
          harness.setRefreshLease(null);
          harness.sessionState.revokedAt = "2026-04-01T00:10:01.000Z";
          harness.sessionState.revokeReason = "agent_request";
          harness.sessionState.updatedAt = "2026-04-01T00:10:01.000Z";
        }

        return originalWithConnectionMutationLock(connectionId, callback);
      };

      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/export-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const session = await service.requireAgentSession();
      await expect(service.exportTokenBundle(session, "conn-1")).rejects.toMatchObject({
        code: "AGENT_AUTH_INVALID",
      });
      expect(harness.audits).toHaveLength(1);
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
        connection: {
          metadata: {
            sourceLabel: "WHOOP band",
          },
        },
        refreshed: true,
        tokenVersionChanged: true,
        tokenBundle: {
          accessToken: "access-token-refreshed",
          refreshToken: "refresh-token-refreshed",
          tokenVersion: 3,
        },
      });
      expect(firstRefresh.connection).not.toHaveProperty("credential");
      expect(firstRefresh.connection).not.toHaveProperty("accessToken");
      expect(firstRefresh.connection).not.toHaveProperty("refreshToken");
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
      expect(retryRefresh.connection).not.toHaveProperty("credential");
      expect(retryRefresh.connection).not.toHaveProperty("accessToken");
      expect(retryRefresh.connection).not.toHaveProperty("refreshToken");
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

  it("rejects overlapping provider refreshes without holding a database transaction open", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      let releaseRefresh!: () => void;
      let markRefreshStarted!: () => void;
      const refreshStarted = new Promise<void>((resolve) => {
        markRefreshStarted = resolve;
      });
      const refreshTokens = vi.fn(async () => {
        markRefreshStarted();
        await new Promise<void>((release) => {
          releaseRefresh = release;
        });
        return {
          accessToken: "access-token-refreshed",
          accessTokenExpiresAt: "2026-04-01T02:00:00.000Z",
          refreshToken: "refresh-token-refreshed",
        };
      });
      const registry = createDeviceSyncRegistry([createWhoopProvider({
        refreshTokens,
      })]);
      const firstService = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });
      const secondService = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const firstSession = await firstService.requireAgentSession();
      const firstRefresh = firstService.refreshTokenBundle(firstSession, "conn-1", {
        expectedTokenVersion: 2,
        force: true,
      });

      await refreshStarted;
      const secondSession = await secondService.requireAgentSession();
      const secondRefresh = secondService.refreshTokenBundle(secondSession, "conn-1", {
        expectedTokenVersion: 2,
        force: true,
      });

      await expect(secondRefresh).rejects.toMatchObject({
        code: "TOKEN_REFRESH_IN_PROGRESS",
        retryable: true,
      });
      releaseRefresh();
      const firstResult = await firstRefresh;

      expect(firstResult).toMatchObject({
        refreshed: true,
        tokenBundle: {
          tokenVersion: 3,
        },
      });
      expect(firstResult.connection).not.toHaveProperty("credential");
      expect(refreshTokens).toHaveBeenCalledTimes(1);

      const retrySession = await secondService.requireAgentSession();
      const retryRefresh = await secondService.refreshTokenBundle(retrySession, "conn-1", {
        expectedTokenVersion: 2,
      });
      expect(retryRefresh).toMatchObject({
        refreshed: false,
        tokenVersionChanged: true,
        tokenBundle: {
          tokenVersion: 3,
        },
      });
      expect(retryRefresh.connection).not.toHaveProperty("credential");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not return a newer token version while that version has its own refresh lease", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const refreshTokens = vi.fn(async () => {
        harness.setStoredTokenBundle({
          accessToken: "access-token-newer",
          accessTokenExpiresAt: "2026-04-01T02:00:00.000Z",
          keyVersion: "v1",
          refreshToken: "refresh-token-newer",
          tokenVersion: 3,
        });
        harness.setRefreshLease({
          leaseExpiresAt: "2026-04-01T00:15:00.000Z",
          leaseOwner: "agent-refresh:newer",
          tokenVersion: 3,
        });
        return {
          accessToken: "access-token-refreshed",
          accessTokenExpiresAt: "2026-04-01T02:00:00.000Z",
          refreshToken: "refresh-token-refreshed",
        };
      });
      const registry = createDeviceSyncRegistry([createWhoopProvider({
        refreshTokens,
      })]);

      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const session = await service.requireAgentSession();
      await expect(service.refreshTokenBundle(session, "conn-1", {
        expectedTokenVersion: 2,
        force: true,
      })).rejects.toMatchObject({
        code: "TOKEN_REFRESH_IN_PROGRESS",
        retryable: true,
      });
      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(harness.audits).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries the post-provider token persistence before asking the provider again", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      let persistAttempts = 0;
      const originalPersistStoredConnectionTokenBundle =
        harness.store.persistStoredConnectionTokenBundle.bind(harness.store);
      harness.store.persistStoredConnectionTokenBundle = async (
        input: Parameters<PrismaDeviceSyncControlPlaneStore["persistStoredConnectionTokenBundle"]>[0],
      ) => {
        persistAttempts++;
        if (persistAttempts === 1) {
          throw new Error("transient token persistence failure");
        }

        await originalPersistStoredConnectionTokenBundle(input);
      };
      const refreshTokens = vi.fn(async () => ({
        accessToken: "access-token-refreshed",
        accessTokenExpiresAt: "2026-04-01T02:00:00.000Z",
        refreshToken: "refresh-token-refreshed",
      }));
      const registry = createDeviceSyncRegistry([createWhoopProvider({
        refreshTokens,
      })]);

      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const session = await service.requireAgentSession();
      const refresh = await service.refreshTokenBundle(session, "conn-1", {
        expectedTokenVersion: 2,
        force: true,
      });

      expect(refresh).toMatchObject({
        refreshed: true,
        tokenBundle: {
          accessToken: "access-token-refreshed",
          refreshToken: "refresh-token-refreshed",
          tokenVersion: 3,
        },
      });
      expect(refreshTokens).toHaveBeenCalledTimes(1);
      expect(persistAttempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leave a refresh lease when the provider is not configured", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const registry = createDeviceSyncRegistry([]);

      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const session = await service.requireAgentSession();
      await expect(service.refreshTokenBundle(session, "conn-1", {
        expectedTokenVersion: 2,
        force: true,
      })).rejects.toMatchObject({
        code: "PROVIDER_NOT_CONFIGURED",
        retryable: false,
      });

      expect(harness.getRefreshLease()).toBeNull();
      await expect(harness.store.getStoredConnectionAccountForUser("user-1", "conn-1")).resolves.toMatchObject({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenVersion: 2,
      });
      expect(harness.signals).toHaveLength(0);
      expect(harness.getPublicConnection()).toMatchObject({
        lastErrorCode: null,
        status: "active",
      });

      const exported = await service.exportTokenBundle(session, "conn-1");
      expect(exported).toMatchObject({
        tokenBundle: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          tokenVersion: 2,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when an expired refresh lease makes provider state unknowable", async () => {
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

      harness.setRefreshLease({
        leaseExpiresAt: "2026-04-01T00:09:00.000Z",
        leaseOwner: "agent-refresh:lost",
        tokenVersion: 2,
      });
      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const session = await service.requireAgentSession();
      await expect(service.refreshTokenBundle(session, "conn-1", {
        expectedTokenVersion: 2,
        force: true,
      })).rejects.toMatchObject({
        accountStatus: "reauthorization_required",
        code: "TOKEN_REFRESH_STATE_UNKNOWN",
        retryable: false,
      });

      expect(refreshTokens).not.toHaveBeenCalled();
      await expect(harness.store.getStoredConnectionAccountForUser("user-1", "conn-1")).resolves.toMatchObject({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenVersion: 2,
      });
      expect(harness.getRefreshLease()).toBeNull();
      expect(harness.signals).toHaveLength(1);
      expect(harness.signals[0]).toMatchObject({
        kind: "reauthorization_required",
        provider: "whoop",
        reason: "token_refresh_state_unknown",
        revokeWarning: {
          code: "TOKEN_REFRESH_STATE_UNKNOWN",
        },
      });
      expect(harness.getPublicConnection()).toMatchObject({
        lastErrorCode: "TOKEN_REFRESH_STATE_UNKNOWN",
        nextReconcileAt: null,
        status: "reauthorization_required",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects token refresh when stored tokens remain on a reauthorization-required connection", async () => {
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

      harness.setConnectionStatus("reauthorization_required");
      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const session = await service.requireAgentSession();
      await expect(service.refreshTokenBundle(session, "conn-1", {
        expectedTokenVersion: 2,
        force: true,
      })).rejects.toMatchObject({
        accountStatus: "reauthorization_required",
        code: "ACCOUNT_REAUTHORIZATION_REQUIRED",
      });
      expect(refreshTokens).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when provider refresh returns an incomplete rotated generation", async () => {
    vi.useFakeTimers();
    try {
      const bearerToken = "hbds_agent_original";
      const harness = createRetrySafeStoreHarness(bearerToken);
      const refreshTokens = vi.fn(async () => {
        throw deviceSyncError({
          code: "OURA_REFRESH_TOKEN_ROTATION_MISSING",
          message: "Oura refresh response did not include a replacement refresh token.",
          retryable: false,
        });
      });
      const registry = createDeviceSyncRegistry([createWhoopProvider({
        refreshTokens,
      })]);

      vi.setSystemTime(new Date("2026-04-01T00:10:00.000Z"));
      const service = new HostedDeviceSyncAgentSessionService({
        request: createAgentRequest("https://murph.example/api/device-sync/agent/connections/conn-1/refresh-token-bundle", bearerToken),
        store: harness.store,
        registry,
      });

      const session = await service.requireAgentSession();
      await expect(service.refreshTokenBundle(session, "conn-1", {
        expectedTokenVersion: 2,
        force: true,
      })).rejects.toMatchObject({
        accountStatus: "reauthorization_required",
        code: "TOKEN_REFRESH_STATE_UNKNOWN",
        retryable: false,
      });

      expect(refreshTokens).toHaveBeenCalledTimes(1);
      await expect(harness.store.getStoredConnectionAccountForUser("user-1", "conn-1")).resolves.toBeNull();
      expect(harness.signals).toHaveLength(1);
      expect(harness.signals[0]).toMatchObject({
        kind: "reauthorization_required",
        reason: "token_refresh_state_unknown",
        revokeWarning: {
          code: "TOKEN_REFRESH_STATE_UNKNOWN",
        },
      });
      expect(harness.getPublicConnection()).toMatchObject({
        lastErrorCode: "TOKEN_REFRESH_STATE_UNKNOWN",
        status: "reauthorization_required",
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
  getPublicConnection: () => Record<string, unknown>;
  getRefreshLease: () => { leaseExpiresAt: string; leaseOwner: string; tokenVersion: number } | null;
  sessionState: MutableSessionState;
  setConnectionStatus: (status: DeviceSyncAccount["status"]) => void;
  setRefreshLease: (lease: { leaseExpiresAt: string; leaseOwner: string; tokenVersion: number } | null) => void;
  setStoredTokenBundle: (tokenBundle: {
    accessToken: string;
    accessTokenExpiresAt: string | null;
    keyVersion: string;
    refreshToken: string | null;
    tokenVersion: number;
  }) => void;
  signals: Array<Record<string, unknown>>;
  store: PrismaDeviceSyncControlPlaneStore;
} {
  const sessionState: MutableSessionState = {
    ...SESSION,
    tokenHash: sha256Hex(bearerToken),
  };
  const audits: Array<Record<string, unknown>> = [];
  const signals: Array<Record<string, unknown>> = [];
  const connection = createConnectionRecord();
  let hasStoredTokenBundle = true;
  let refreshLease: { leaseExpiresAt: string; leaseOwner: string; tokenVersion: number } | null = null;
  let publicConnection = {
    ...connection,
    accessTokenExpiresAt: connection.accessTokenExpiresAt.toISOString(),
    connectedAt: connection.connectedAt.toISOString(),
    createdAt: connection.createdAt.toISOString(),
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastSyncStartedAt: null,
    lastWebhookAt: null,
    metadata: {
      sourceLabel: "WHOOP band",
    },
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
      async createSignal(input: Record<string, unknown>) {
        signals.push(input);
        return {
          id: signals.length,
          ...input,
        };
      },
      async getConnectionForUser(userId: string, connectionId: string) {
        return userId === SESSION.userId && connectionId === connection.id ? { ...publicConnection } : null;
      },
      async getStoredConnectionAccountForUser(userId: string, connectionId: string) {
        return userId === SESSION.userId && connectionId === connection.id && hasStoredTokenBundle
          ? { ...storedConnection }
          : null;
      },
      async persistStoredConnectionTokenBundle(input: {
        clearRefreshLease?: boolean;
        connectionId: string;
        externalAccountId: string;
        provider: string;
        tokenBundle: {
          accessToken: string;
          accessTokenExpiresAt: string | null;
          keyVersion: string;
          refreshToken: string | null;
          tokenVersion: number;
        } | null;
      }) {
        if (input.connectionId !== connection.id) {
          return;
        }

        if (input.clearRefreshLease === true) {
          refreshLease = null;
        }

        if (!input.tokenBundle) {
          hasStoredTokenBundle = false;
          return;
        }

        hasStoredTokenBundle = true;
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
      async claimConnectionRefreshLease(input: {
        leaseExpiresAt: string;
        leaseOwner: string;
        now: string;
        tokenVersion: number;
      }) {
        if (!hasStoredTokenBundle || storedConnection.tokenVersion !== input.tokenVersion) {
          return { status: "version_changed" as const };
        }

        if (refreshLease) {
          if (
            refreshLease.tokenVersion === input.tokenVersion
            && Date.parse(refreshLease.leaseExpiresAt) > Date.parse(input.now)
          ) {
            return {
              status: "in_progress" as const,
              leaseExpiresAt: refreshLease.leaseExpiresAt,
            };
          }

          return { status: "stale" as const };
        }

        refreshLease = {
          leaseExpiresAt: input.leaseExpiresAt,
          leaseOwner: input.leaseOwner,
          tokenVersion: input.tokenVersion,
        };
        return { status: "claimed" as const };
      },
      async clearConnectionRefreshLease(input: { leaseOwner: string }) {
        if (!refreshLease || refreshLease.leaseOwner !== input.leaseOwner) {
          return false;
        }

        refreshLease = null;
        return true;
      },
      async clearStaleConnectionRefreshLease() {
        if (!refreshLease) {
          return false;
        }

        refreshLease = null;
        return true;
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
                where.id === connection.id && where.userId === SESSION.userId
                  ? {
                      id: connection.id,
                      refreshLeaseExpiresAt: refreshLease ? new Date(refreshLease.leaseExpiresAt) : null,
                      refreshLeaseOwner: refreshLease?.leaseOwner ?? null,
                      refreshLeaseTokenVersion: refreshLease?.tokenVersion ?? null,
                    }
                  : null,
            },
          },
        );

        return callback(transactionClient);
      },
      async withHealthDataAdmissionLock<TResult>(
        _userId: string,
        _connectionId: string,
        callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
      ): Promise<TResult> {
        const transactionClient: HostedPrismaTransactionClient = Object.assign(
          Object.create(null),
          {
            deviceConnection: {
              findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
                where.id === connection.id && where.userId === SESSION.userId
                  ? {
                      id: connection.id,
                      refreshLeaseExpiresAt: refreshLease ? new Date(refreshLease.leaseExpiresAt) : null,
                      refreshLeaseOwner: refreshLease?.leaseOwner ?? null,
                      refreshLeaseTokenVersion: refreshLease?.tokenVersion ?? null,
                    }
                  : null,
            },
          },
        );

        return callback(transactionClient);
      },
    },
  );

  return {
    audits,
    getPublicConnection: () => ({ ...publicConnection }),
    getRefreshLease: () => refreshLease ? { ...refreshLease } : null,
    sessionState,
    setConnectionStatus: (status: typeof publicConnection.status) => {
      publicConnection = {
        ...publicConnection,
        status,
      };
      storedConnection = {
        ...storedConnection,
        status,
      };
    },
    setRefreshLease: (lease) => {
      refreshLease = lease;
    },
    setStoredTokenBundle: (tokenBundle) => {
      hasStoredTokenBundle = true;
      storedConnection = {
        ...storedConnection,
        accessToken: tokenBundle.accessToken,
        accessTokenExpiresAt: tokenBundle.accessTokenExpiresAt ?? storedConnection.accessTokenExpiresAt,
        credential: {
          kind: "oauth_tokens",
          tokens: {
            accessToken: tokenBundle.accessToken,
            accessTokenExpiresAt: tokenBundle.accessTokenExpiresAt ?? storedConnection.accessTokenExpiresAt ?? null,
            refreshToken: tokenBundle.refreshToken,
          } satisfies ProviderAuthTokens,
        },
        keyVersion: tokenBundle.keyVersion,
        refreshToken: tokenBundle.refreshToken,
        tokenVersion: tokenBundle.tokenVersion,
      };
    },
    signals,
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
