import { describe, expect, it, vi } from "vitest";

import {
  createDeviceSyncRegistry,
  deviceSyncError,
  type DeviceSyncProvider,
} from "@murphai/device-syncd/public-ingress";
import { WHOOP_DEVICE_PROVIDER_DESCRIPTOR } from "@murphai/importers/device-providers/provider-descriptors";

import { HostedDeviceSyncAgentSessionService } from "@/src/lib/device-sync/agent-session-service";
import type { HostedSecretCodec } from "@/src/lib/device-sync/crypto";
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

describe("HostedDeviceSyncAgentSessionService.refreshTokenBundle", () => {
  it("persists provider-directed status changes before surfacing refresh errors", async () => {
    const codec: HostedSecretCodec = {
      keyVersion: "v1",
      encrypt: (value) => `enc:${value}`,
      decrypt: (payload) => payload.replace(/^enc:/u, ""),
    };
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
      deviceConnectionSecret: {
        update: vi.fn(async () => {
          throw new Error("secret update should not run when refresh fails");
        }),
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
      codec,
    });

    await expect(service.refreshTokenBundle(SESSION, "conn-1", { force: true })).rejects.toMatchObject({
      code: "WHOOP_REFRESH_TOKEN_MISSING",
      accountStatus: "reauthorization_required",
    });

    expect(tx.deviceConnection.update).toHaveBeenCalledTimes(1);
    expect(tx.deviceConnection.update).toHaveBeenCalledWith({
      where: {
        id: "conn-1",
      },
      data: {
        status: "reauthorization_required",
        lastSyncErrorAt: expect.any(Date),
        lastErrorCode: "WHOOP_REFRESH_TOKEN_MISSING",
        lastErrorMessage: "WHOOP refresh token is missing.",
      },
    });
    expect(tx.deviceSyncSignal.create).toHaveBeenCalledTimes(1);
    expect(tx.deviceConnectionSecret.update).not.toHaveBeenCalled();
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
    secret: {
      connectionId: "conn-1",
      accessTokenEncrypted: "enc:access-token",
      refreshTokenEncrypted: "enc:refresh-token",
      tokenVersion: 7,
      keyVersion: "v1",
      createdAt: new Date("2026-03-20T00:00:00.000Z"),
      updatedAt: new Date("2026-03-20T00:00:00.000Z"),
    },
  };
}
