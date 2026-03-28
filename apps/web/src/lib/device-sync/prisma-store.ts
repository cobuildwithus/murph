import { createHash, randomBytes } from "node:crypto";

import { Prisma, PrismaClient } from "@prisma/client";
import { deviceSyncError } from "@murph/device-syncd";

import type {
  ClaimDeviceSyncWebhookTraceInput,
  DeviceSyncAccount,
  DeviceSyncAccountStatus,
  DeviceSyncPublicIngressStore,
  DeviceSyncWebhookTraceClaimResult,
  OAuthStateRecord,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncConnectionInput,
} from "@murph/device-syncd";
import type { HostedSecretCodec } from "./crypto";
import type { AuthenticatedHostedUser, HostedBrowserAssertionNonceStore } from "./auth";
import { generateHostedRandomPrefixedId, maybeIsoTimestamp, toIsoTimestamp, toJsonRecord } from "./shared";

export const hostedConnectionWithSecretArgs = {
  include: {
    secret: true,
  },
} satisfies Prisma.DeviceConnectionDefaultArgs;

type HostedPublicAccountPrismaRecord = Prisma.DeviceConnectionGetPayload<Prisma.DeviceConnectionDefaultArgs>;
type HostedSignalPrismaRecord = Prisma.DeviceSyncSignalGetPayload<Prisma.DeviceSyncSignalDefaultArgs>;
type HostedAgentSessionPrismaRecord = Prisma.DeviceAgentSessionGetPayload<Prisma.DeviceAgentSessionDefaultArgs>;
export type HostedConnectionWithSecretRecord = Prisma.DeviceConnectionGetPayload<typeof hostedConnectionWithSecretArgs>;
export type HostedPrismaTransactionClient = Prisma.TransactionClient;

type LocalHeartbeatErrorPatch =
  | { kind: "clear" }
  | {
      kind: "merge";
      lastErrorCode?: string | null;
      lastErrorMessage?: string | null;
    };

export interface HostedAgentSessionRecord {
  id: string;
  userId: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  replacedBySessionId: string | null;
}

export type HostedAgentSessionAuthStatus = "active" | "expired" | "revoked" | "missing";

export interface HostedAgentSessionAuthResult {
  status: HostedAgentSessionAuthStatus;
  session: HostedAgentSessionRecord | null;
}

export interface HostedSignalRecord {
  id: number;
  userId: string;
  connectionId: string | null;
  provider: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface HostedConnectionSecretBundle {
  userId: string;
  account: DeviceSyncAccount;
  tokenVersion: number;
  keyVersion: string;
}

export interface CreateHostedSignalInput {
  userId: string;
  connectionId?: string | null;
  provider: string;
  kind: string;
  payload?: Record<string, unknown> | null;
  createdAt?: string;
  tx?: HostedPrismaTransactionClient;
}

export interface UpdateLocalHeartbeatInput {
  status?: DeviceSyncAccountStatus;
  lastSyncStartedAt?: string | null;
  lastSyncCompletedAt?: string | null;
  lastSyncErrorAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  nextReconcileAt?: string | null;
  clearError?: boolean;
}

class PrismaHostedOAuthSessionStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async deleteExpiredOAuthStates(now: string): Promise<number> {
    const result = await this.prisma.deviceOauthSession.deleteMany({
      where: {
        expiresAt: {
          lte: new Date(now),
        },
      },
    });
    return result.count;
  }

  async createOAuthState(input: OAuthStateRecord): Promise<OAuthStateRecord> {
    await this.prisma.deviceOauthSession.create({
      data: {
        state: input.state,
        userId: typeof input.metadata?.ownerId === "string" ? input.metadata.ownerId : null,
        provider: input.provider,
        returnTo: input.returnTo,
        metadataJson: toPrismaJsonObject(input.metadata ?? {}),
        createdAt: new Date(input.createdAt),
        expiresAt: new Date(input.expiresAt),
      },
    });

    return input;
  }

  async consumeOAuthState(state: string, now: string): Promise<OAuthStateRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.deviceOauthSession.findUnique({
        where: {
          state,
        },
      });

      if (!record) {
        return null;
      }

      await tx.deviceOauthSession.delete({
        where: {
          state,
        },
      });

      if (record.expiresAt.getTime() <= Date.parse(now)) {
        return null;
      }

      return {
        state: record.state,
        provider: record.provider,
        returnTo: record.returnTo,
        metadata: toJsonRecord(record.metadataJson),
        createdAt: record.createdAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      } satisfies OAuthStateRecord;
    });
  }
}

class PrismaHostedConnectionStore {
  readonly prisma: PrismaClient;
  readonly codec: HostedSecretCodec;

  constructor(input: { prisma: PrismaClient; codec: HostedSecretCodec }) {
    this.prisma = input.prisma;
    this.codec = input.codec;
  }

  async upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): Promise<PublicDeviceSyncAccount> {
    const ownerId = typeof input.ownerId === "string" && input.ownerId.trim() ? input.ownerId.trim() : null;
    const accessTokenEncrypted = this.codec.encrypt(input.tokens.accessToken);
    const refreshTokenEncrypted = input.tokens.refreshToken ? this.codec.encrypt(input.tokens.refreshToken) : null;
    const accessTokenExpiresAt = input.tokens.accessTokenExpiresAt ? new Date(input.tokens.accessTokenExpiresAt) : null;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.deviceConnection.findUnique({
        where: {
          provider_externalAccountId: {
            provider: input.provider,
            externalAccountId: input.externalAccountId,
          },
        },
        ...hostedConnectionWithSecretArgs,
      });

      if (existing) {
        if (ownerId && existing.userId !== ownerId) {
          throw deviceSyncError({
            code: "CONNECTION_OWNERSHIP_CONFLICT",
            message: "This provider account is already connected to a different Murph user.",
            retryable: false,
            httpStatus: 409,
          });
        }

        await tx.deviceConnection.update({
          where: {
            id: existing.id,
          },
          data: {
            displayName: input.displayName ?? null,
            status: input.status ?? "active",
            scopes: input.scopes ?? [],
            accessTokenExpiresAt,
            metadataJson: toPrismaJsonObject(input.metadata ?? {}),
            connectedAt: new Date(input.connectedAt),
            nextReconcileAt: input.nextReconcileAt ? new Date(input.nextReconcileAt) : null,
            lastSyncErrorAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });

        await tx.deviceConnectionSecret.upsert({
          where: {
            connectionId: existing.id,
          },
          create: {
            connectionId: existing.id,
            accessTokenEncrypted,
            refreshTokenEncrypted,
            tokenVersion: 1,
            keyVersion: this.codec.keyVersion,
          },
          update: {
            accessTokenEncrypted,
            refreshTokenEncrypted,
            tokenVersion: {
              increment: 1,
            },
            keyVersion: this.codec.keyVersion,
          },
        });

        const updated = await tx.deviceConnection.findUnique({
          where: {
            id: existing.id,
          },
        });

        return requireHostedPublicAccountRecord(updated);
      }

      if (!ownerId) {
        throw deviceSyncError({
          code: "CONNECTION_OWNER_REQUIRED",
          message: "Hosted device-sync connections must be initiated by an authenticated Murph user.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const connectionId = generateHostedRandomPrefixedId("dsc");
      await tx.deviceConnection.create({
        data: {
          id: connectionId,
          userId: ownerId,
          provider: input.provider,
          externalAccountId: input.externalAccountId,
          displayName: input.displayName ?? null,
          status: input.status ?? "active",
          scopes: input.scopes ?? [],
          accessTokenExpiresAt,
          metadataJson: toPrismaJsonObject(input.metadata ?? {}),
          connectedAt: new Date(input.connectedAt),
          nextReconcileAt: input.nextReconcileAt ? new Date(input.nextReconcileAt) : null,
        },
      });
      await tx.deviceConnectionSecret.create({
        data: {
          connectionId,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenVersion: 1,
          keyVersion: this.codec.keyVersion,
        },
      });

      const created = await tx.deviceConnection.findUnique({
        where: {
          id: connectionId,
        },
      });

      return requireHostedPublicAccountRecord(created);
    });
  }

  async getConnectionByExternalAccount(
    provider: string,
    externalAccountId: string,
  ): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.prisma.deviceConnection.findUnique({
      where: {
        provider_externalAccountId: {
          provider,
          externalAccountId,
        },
      },
    });

    return record ? mapHostedPublicAccountRecord(record) : null;
  }

  async markWebhookReceived(accountId: string, now: string): Promise<void> {
    // Use raw SQL so `last_webhook_at` can advance without Prisma bumping `updated_at`.
    await this.prisma.$executeRaw`
      update device_connection
      set last_webhook_at = ${new Date(now)}
      where id = ${accountId}
    `;
  }

  async listConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    const records = await this.prisma.deviceConnection.findMany({
      where: {
        userId,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });

    return records.map((record) => mapHostedPublicAccountRecord(record));
  }

  async getConnectionForUser(userId: string, connectionId: string): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.prisma.deviceConnection.findFirst({
      where: {
        id: connectionId,
        userId,
      },
    });

    return record ? mapHostedPublicAccountRecord(record) : null;
  }

  async getConnectionOwnerId(connectionId: string): Promise<string | null> {
    const record = await this.prisma.deviceConnection.findUnique({
      where: {
        id: connectionId,
      },
      select: {
        userId: true,
      },
    });

    return record?.userId ?? null;
  }

  async getConnectionBundleForUser(userId: string, connectionId: string): Promise<HostedConnectionSecretBundle | null> {
    const record = await this.prisma.deviceConnection.findFirst({
      where: {
        id: connectionId,
        userId,
      },
      ...hostedConnectionWithSecretArgs,
    });

    if (!record) {
      return null;
    }

    return requireHostedConnectionBundleRecord(record, this.codec);
  }

  async markConnectionDisconnected(input: {
    connectionId: string;
    userId: string;
    now: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    tx?: HostedPrismaTransactionClient;
  }): Promise<PublicDeviceSyncAccount> {
    const run = async (tx: HostedPrismaTransactionClient) => {
      const existing = await tx.deviceConnection.findFirst({
        where: {
          id: input.connectionId,
          userId: input.userId,
        },
      });

      if (!existing) {
        throw deviceSyncError({
          code: "CONNECTION_NOT_FOUND",
          message: "Hosted device-sync connection was not found for the current user.",
          retryable: false,
          httpStatus: 404,
        });
      }

      await tx.deviceConnectionSecret.deleteMany({
        where: {
          connectionId: input.connectionId,
        },
      });

      return tx.deviceConnection.update({
        where: {
          id: input.connectionId,
        },
        data: {
          status: "disconnected",
          accessTokenExpiresAt: null,
          nextReconcileAt: null,
          lastSyncErrorAt: null,
          lastErrorCode: input.errorCode ?? null,
          lastErrorMessage: input.errorMessage ?? null,
          updatedAt: new Date(input.now),
        },
      });
    };
    const updated = input.tx
      ? await run(input.tx)
      : await this.prisma.$transaction(run);

    return mapHostedPublicAccountRecord(updated);
  }

  async updateConnectionStatus(input: {
    connectionId: string;
    status: DeviceSyncAccountStatus;
    now: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<PublicDeviceSyncAccount> {
    const updated = await this.prisma.deviceConnection.update({
      where: {
        id: input.connectionId,
      },
      data: {
        status: input.status,
        lastSyncErrorAt: new Date(input.now),
        lastErrorCode: input.errorCode ?? null,
        lastErrorMessage: input.errorMessage ?? null,
      },
    });

    return mapHostedPublicAccountRecord(updated);
  }
}

class PrismaHostedWebhookTraceStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): Promise<DeviceSyncWebhookTraceClaimResult> {
    const claimedAt = new Date(input.receivedAt);
    const processingExpiresAt = new Date(input.processingExpiresAt);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.prisma.deviceWebhookTrace.create({
          data: {
            provider: input.provider,
            traceId: input.traceId,
            externalAccountId: input.externalAccountId,
            eventType: input.eventType,
            processingExpiresAt,
            receivedAt: claimedAt,
            payloadJson: toNullablePrismaJsonValue(input.payload),
            status: "processing",
          },
        });
        return "claimed";
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }

      const existing = await this.prisma.deviceWebhookTrace.findUnique({
        where: {
          provider_traceId: {
            provider: input.provider,
            traceId: input.traceId,
          },
        },
        select: {
          processingExpiresAt: true,
          status: true,
        },
      });

      if (!existing) {
        continue;
      }

      if (existing.status === "processed") {
        return "processed";
      }

      if (existing.processingExpiresAt && existing.processingExpiresAt.getTime() > claimedAt.getTime()) {
        return "processing";
      }

      const takeover = await this.prisma.deviceWebhookTrace.updateMany({
        where: {
          provider: input.provider,
          traceId: input.traceId,
          status: "processing",
          OR: [
            {
              processingExpiresAt: null,
            },
            {
              processingExpiresAt: {
                lte: claimedAt,
              },
            },
          ],
        },
        data: {
          externalAccountId: input.externalAccountId,
          eventType: input.eventType,
          payloadJson: toNullablePrismaJsonValue(input.payload),
          processingExpiresAt,
          receivedAt: claimedAt,
          status: "processing",
        },
      });

      return takeover.count > 0 ? "claimed" : "processing";
    }

    return "processing";
  }

  async completeWebhookTrace(
    provider: string,
    traceId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<void> {
    const prisma = tx ?? this.prisma;
    await prisma.deviceWebhookTrace.updateMany({
      where: {
        provider,
        traceId,
        status: "processing",
      },
      data: {
        processingExpiresAt: null,
        status: "processed",
      },
    });
  }

  async releaseWebhookTrace(provider: string, traceId: string): Promise<void> {
    await this.prisma.deviceWebhookTrace.deleteMany({
      where: {
        provider,
        traceId,
        status: "processing",
      },
    });
  }
}

class PrismaHostedSignalStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createSignal(input: CreateHostedSignalInput): Promise<HostedSignalRecord> {
    const prisma = input.tx ?? this.prisma;
    const record = await prisma.deviceSyncSignal.create({
      data: {
        userId: input.userId,
        connectionId: input.connectionId ?? null,
        provider: input.provider,
        kind: input.kind,
        payloadJson: toNullablePrismaJsonValue(input.payload),
        createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
      },
    });

    return mapHostedSignalRecord(record);
  }

  async listSignalsForUser(userId: string, options: { afterId?: number; limit?: number } = {}): Promise<HostedSignalRecord[]> {
    const limit = Math.min(500, Math.max(1, options.limit ?? 100));
    const records = await this.prisma.deviceSyncSignal.findMany({
      where: {
        userId,
        ...(typeof options.afterId === "number"
          ? {
              id: {
                gt: options.afterId,
              },
            }
          : {}),
      },
      orderBy: {
        id: "asc",
      },
      take: limit,
    });

    return records.map((record) => mapHostedSignalRecord(record));
  }
}

class PrismaHostedBrowserAssertionNonceStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async consumeBrowserAssertionNonce(input: {
    nonceHash: string;
    userId: string;
    method: string;
    path: string;
    now: string;
    expiresAt: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.deviceBrowserAssertionNonce.deleteMany({
        where: {
          expiresAt: {
            lte: new Date(input.now),
          },
        },
      });

      try {
        await tx.deviceBrowserAssertionNonce.create({
          data: {
            nonceHash: input.nonceHash,
            userId: input.userId,
            method: input.method,
            path: input.path,
            createdAt: new Date(input.now),
            expiresAt: new Date(input.expiresAt),
          },
        });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) {
          return false;
        }

        throw error;
      }
    });
  }
}

class PrismaHostedAgentSessionStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createAgentSession(input: {
    user: AuthenticatedHostedUser;
    label?: string | null;
    tokenHash: string;
    now?: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord> {
    const now = input.now ?? toIsoTimestamp(new Date());
    const record = await this.prisma.deviceAgentSession.create({
      data: {
        id: generateHostedRandomPrefixedId("dsa"),
        userId: input.user.id,
        label: input.label ?? null,
        tokenHash: input.tokenHash,
        createdAt: new Date(now),
        updatedAt: new Date(now),
        expiresAt: new Date(input.expiresAt),
        lastSeenAt: new Date(now),
      },
    });

    return mapHostedAgentSessionRecord(record);
  }

  async authenticateAgentSessionByTokenHash(tokenHash: string, now: string): Promise<HostedAgentSessionAuthResult> {
    const record = await this.prisma.deviceAgentSession.findUnique({
      where: {
        tokenHash,
      },
    });

    if (!record) {
      return {
        status: "missing",
        session: null,
      };
    }

    if (record.revokedAt) {
      return {
        status: "revoked",
        session: mapHostedAgentSessionRecord(record),
      };
    }

    if (record.expiresAt.getTime() <= Date.parse(now)) {
      return {
        status: "expired",
        session: await this.revokeAgentSession({
          sessionId: record.id,
          now,
          reason: "expired",
        }),
      };
    }

    const touched = await this.prisma.deviceAgentSession.update({
      where: {
        id: record.id,
      },
      data: {
        lastSeenAt: new Date(now),
      },
    });

    return {
      status: "active",
      session: mapHostedAgentSessionRecord(touched),
    };
  }

  async rotateAgentSession(input: {
    sessionId: string;
    tokenHash: string;
    now: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord> {
    const replacementSessionId = generateHostedRandomPrefixedId("dsa");

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.deviceAgentSession.findFirst({
        where: {
          id: input.sessionId,
          revokedAt: null,
          expiresAt: {
            gt: new Date(input.now),
          },
        },
      });

      if (!existing) {
        throw deviceSyncError({
          code: "AGENT_AUTH_INVALID",
          message: "Hosted device-sync agent bearer token is no longer active.",
          retryable: false,
          httpStatus: 401,
        });
      }

      const revoked = await tx.deviceAgentSession.updateMany({
        where: {
          id: input.sessionId,
          revokedAt: null,
          expiresAt: {
            gt: new Date(input.now),
          },
        },
        data: {
          revokedAt: new Date(input.now),
          revokeReason: "rotated",
          replacedBySessionId: replacementSessionId,
          updatedAt: new Date(input.now),
        },
      });

      if (revoked.count !== 1) {
        throw deviceSyncError({
          code: "AGENT_AUTH_INVALID",
          message: "Hosted device-sync agent bearer token is no longer active.",
          retryable: false,
          httpStatus: 401,
        });
      }

      const record = await tx.deviceAgentSession.create({
        data: {
          id: replacementSessionId,
          userId: existing.userId,
          label: existing.label,
          tokenHash: input.tokenHash,
          createdAt: new Date(input.now),
          updatedAt: new Date(input.now),
          expiresAt: new Date(input.expiresAt),
          lastSeenAt: new Date(input.now),
        },
      });

      return mapHostedAgentSessionRecord(record);
    });
  }

  async revokeAgentSession(input: {
    sessionId: string;
    now: string;
    reason: string;
    replacedBySessionId?: string | null;
  }): Promise<HostedAgentSessionRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.deviceAgentSession.updateMany({
        where: {
          id: input.sessionId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(input.now),
          revokeReason: input.reason,
          ...(input.replacedBySessionId !== undefined
            ? {
                replacedBySessionId: input.replacedBySessionId,
              }
            : {}),
          updatedAt: new Date(input.now),
        },
      });

      const record = await tx.deviceAgentSession.findUnique({
        where: {
          id: input.sessionId,
        },
      });

      return record ? mapHostedAgentSessionRecord(record) : null;
    });
  }
}

class PrismaHostedLocalHeartbeatStore {
  readonly prisma: PrismaClient;
  readonly connections: PrismaHostedConnectionStore;

  constructor(input: { prisma: PrismaClient; connections: PrismaHostedConnectionStore }) {
    this.prisma = input.prisma;
    this.connections = input.connections;
  }

  async updateConnectionFromLocalHeartbeat(
    userId: string,
    connectionId: string,
    patch: UpdateLocalHeartbeatInput,
  ): Promise<PublicDeviceSyncAccount | null> {
    const errorPatch = resolveLocalHeartbeatErrorPatch(patch);
    const updated = await this.prisma.deviceConnection.updateMany({
      where: {
        id: connectionId,
        userId,
      },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.lastSyncStartedAt !== undefined
          ? {
              lastSyncStartedAt: patch.lastSyncStartedAt ? new Date(patch.lastSyncStartedAt) : null,
            }
          : {}),
        ...(patch.lastSyncCompletedAt !== undefined
          ? {
              lastSyncCompletedAt: patch.lastSyncCompletedAt ? new Date(patch.lastSyncCompletedAt) : null,
            }
          : {}),
        ...(patch.lastSyncErrorAt !== undefined
          ? {
              lastSyncErrorAt: patch.lastSyncErrorAt ? new Date(patch.lastSyncErrorAt) : null,
            }
          : {}),
        ...(patch.nextReconcileAt !== undefined
          ? {
              nextReconcileAt: patch.nextReconcileAt ? new Date(patch.nextReconcileAt) : null,
            }
          : {}),
        ...toPrismaHeartbeatErrorPatch(errorPatch),
      },
    });

    if (updated.count === 0) {
      return null;
    }

    return this.connections.getConnectionForUser(userId, connectionId);
  }
}

export class PrismaDeviceSyncControlPlaneStore
  implements DeviceSyncPublicIngressStore, HostedBrowserAssertionNonceStore
{
  readonly prisma: PrismaClient;
  readonly codec: HostedSecretCodec;
  private readonly oauthSessions: PrismaHostedOAuthSessionStore;
  private readonly connections: PrismaHostedConnectionStore;
  private readonly webhookTraces: PrismaHostedWebhookTraceStore;
  private readonly signals: PrismaHostedSignalStore;
  private readonly browserAssertionNonces: PrismaHostedBrowserAssertionNonceStore;
  private readonly agentSessions: PrismaHostedAgentSessionStore;
  private readonly localHeartbeats: PrismaHostedLocalHeartbeatStore;

  constructor(input: { prisma: PrismaClient; codec: HostedSecretCodec }) {
    this.prisma = input.prisma;
    this.codec = input.codec;
    this.oauthSessions = new PrismaHostedOAuthSessionStore(this.prisma);
    this.connections = new PrismaHostedConnectionStore({
      prisma: this.prisma,
      codec: this.codec,
    });
    this.webhookTraces = new PrismaHostedWebhookTraceStore(this.prisma);
    this.signals = new PrismaHostedSignalStore(this.prisma);
    this.browserAssertionNonces = new PrismaHostedBrowserAssertionNonceStore(this.prisma);
    this.agentSessions = new PrismaHostedAgentSessionStore(this.prisma);
    this.localHeartbeats = new PrismaHostedLocalHeartbeatStore({
      prisma: this.prisma,
      connections: this.connections,
    });
  }

  async deleteExpiredOAuthStates(now: string): Promise<number> {
    return this.oauthSessions.deleteExpiredOAuthStates(now);
  }

  async createOAuthState(input: OAuthStateRecord): Promise<OAuthStateRecord> {
    return this.oauthSessions.createOAuthState(input);
  }

  async consumeOAuthState(state: string, now: string): Promise<OAuthStateRecord | null> {
    return this.oauthSessions.consumeOAuthState(state, now);
  }

  async upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): Promise<PublicDeviceSyncAccount> {
    return this.connections.upsertConnection(input);
  }

  async getConnectionByExternalAccount(
    provider: string,
    externalAccountId: string,
  ): Promise<PublicDeviceSyncAccount | null> {
    return this.connections.getConnectionByExternalAccount(provider, externalAccountId);
  }

  async claimWebhookTrace(input: ClaimDeviceSyncWebhookTraceInput): Promise<DeviceSyncWebhookTraceClaimResult> {
    return this.webhookTraces.claimWebhookTrace(input);
  }

  async completeWebhookTrace(
    provider: string,
    traceId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<void> {
    return this.webhookTraces.completeWebhookTrace(provider, traceId, tx);
  }

  async releaseWebhookTrace(provider: string, traceId: string): Promise<void> {
    return this.webhookTraces.releaseWebhookTrace(provider, traceId);
  }

  async markWebhookReceived(accountId: string, now: string): Promise<void> {
    return this.connections.markWebhookReceived(accountId, now);
  }

  async listConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    return this.connections.listConnectionsForUser(userId);
  }

  async getConnectionForUser(userId: string, connectionId: string): Promise<PublicDeviceSyncAccount | null> {
    return this.connections.getConnectionForUser(userId, connectionId);
  }

  async getConnectionOwnerId(connectionId: string): Promise<string | null> {
    return this.connections.getConnectionOwnerId(connectionId);
  }

  async getConnectionBundleForUser(userId: string, connectionId: string): Promise<HostedConnectionSecretBundle | null> {
    return this.connections.getConnectionBundleForUser(userId, connectionId);
  }

  async createSignal(input: CreateHostedSignalInput): Promise<HostedSignalRecord> {
    return this.signals.createSignal(input);
  }

  async listSignalsForUser(userId: string, options: { afterId?: number; limit?: number } = {}): Promise<HostedSignalRecord[]> {
    return this.signals.listSignalsForUser(userId, options);
  }

  async consumeBrowserAssertionNonce(input: {
    nonceHash: string;
    userId: string;
    method: string;
    path: string;
    now: string;
    expiresAt: string;
  }): Promise<boolean> {
    return this.browserAssertionNonces.consumeBrowserAssertionNonce(input);
  }

  async createAgentSession(input: {
    user: AuthenticatedHostedUser;
    label?: string | null;
    tokenHash: string;
    now?: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord> {
    return this.agentSessions.createAgentSession(input);
  }

  async authenticateAgentSessionByTokenHash(tokenHash: string, now: string): Promise<HostedAgentSessionAuthResult> {
    return this.agentSessions.authenticateAgentSessionByTokenHash(tokenHash, now);
  }

  async rotateAgentSession(input: {
    sessionId: string;
    tokenHash: string;
    now: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord> {
    return this.agentSessions.rotateAgentSession(input);
  }

  async revokeAgentSession(input: {
    sessionId: string;
    now: string;
    reason: string;
    replacedBySessionId?: string | null;
  }): Promise<HostedAgentSessionRecord | null> {
    return this.agentSessions.revokeAgentSession(input);
  }

  async markConnectionDisconnected(input: {
    connectionId: string;
    userId: string;
    now: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    tx?: HostedPrismaTransactionClient;
  }): Promise<PublicDeviceSyncAccount> {
    return this.connections.markConnectionDisconnected(input);
  }

  async updateConnectionStatus(input: {
    connectionId: string;
    status: DeviceSyncAccountStatus;
    now: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<PublicDeviceSyncAccount> {
    return this.connections.updateConnectionStatus(input);
  }

  async updateConnectionFromLocalHeartbeat(
    userId: string,
    connectionId: string,
    patch: UpdateLocalHeartbeatInput,
  ): Promise<PublicDeviceSyncAccount | null> {
    return this.localHeartbeats.updateConnectionFromLocalHeartbeat(userId, connectionId, patch);
  }

  async withConnectionRefreshLock<TResult>(
    connectionId: string,
    callback: (tx: HostedPrismaTransactionClient) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`select pg_advisory_xact_lock(hashtext(${connectionId}))`;
      return callback(tx);
    });
  }
}

function toPrismaJsonObject(value: unknown): Prisma.InputJsonObject {
  return toJsonRecord(value) as Prisma.InputJsonObject;
}

function toNullablePrismaJsonValue(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value ? toPrismaJsonObject(value) : Prisma.DbNull;
}

function mapHostedSignalRecord(record: HostedSignalPrismaRecord): HostedSignalRecord {
  return {
    id: record.id,
    userId: record.userId,
    connectionId: record.connectionId,
    provider: record.provider,
    kind: record.kind,
    payload: toJsonRecord(record.payloadJson),
    createdAt: record.createdAt.toISOString(),
  } satisfies HostedSignalRecord;
}

function mapHostedAgentSessionRecord(record: HostedAgentSessionPrismaRecord): HostedAgentSessionRecord {
  return {
    id: record.id,
    userId: record.userId,
    label: record.label,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    lastSeenAt: maybeIsoTimestamp(record.lastSeenAt),
    revokedAt: maybeIsoTimestamp(record.revokedAt),
    revokeReason: record.revokeReason ?? null,
    replacedBySessionId: record.replacedBySessionId ?? null,
  } satisfies HostedAgentSessionRecord;
}

export function mapHostedPublicAccountRecord(record: HostedPublicAccountPrismaRecord): PublicDeviceSyncAccount {
  return {
    id: record.id,
    provider: record.provider,
    externalAccountId: record.externalAccountId,
    displayName: record.displayName,
    status: record.status,
    scopes: Array.isArray(record.scopes) ? record.scopes.filter((scope: unknown) => typeof scope === "string") : [],
    accessTokenExpiresAt: maybeIsoTimestamp(record.accessTokenExpiresAt),
    metadata: toJsonRecord(record.metadataJson),
    connectedAt: record.connectedAt.toISOString(),
    lastWebhookAt: maybeIsoTimestamp(record.lastWebhookAt),
    lastSyncStartedAt: maybeIsoTimestamp(record.lastSyncStartedAt),
    lastSyncCompletedAt: maybeIsoTimestamp(record.lastSyncCompletedAt),
    lastSyncErrorAt: maybeIsoTimestamp(record.lastSyncErrorAt),
    lastErrorCode: record.lastErrorCode,
    lastErrorMessage: record.lastErrorMessage,
    nextReconcileAt: maybeIsoTimestamp(record.nextReconcileAt),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  } satisfies PublicDeviceSyncAccount;
}

export function requireHostedPublicAccountRecord(
  record: HostedPublicAccountPrismaRecord | null | undefined,
): PublicDeviceSyncAccount {
  if (!record) {
    throw new TypeError("Expected device connection record.");
  }

  return mapHostedPublicAccountRecord(record);
}

export function requireHostedConnectionBundleRecord(
  record: HostedConnectionWithSecretRecord | null | undefined,
  codec: HostedSecretCodec,
): HostedConnectionSecretBundle {
  if (!record?.secret) {
    throw deviceSyncError({
      code: "CONNECTION_SECRET_MISSING",
      message: "Hosted device-sync connection no longer has an escrowed token bundle.",
      retryable: false,
      httpStatus: 409,
    });
  }

  return {
    userId: record.userId,
    account: {
      ...mapHostedPublicAccountRecord(record),
      disconnectGeneration: 0,
      accessToken: codec.decrypt(record.secret.accessTokenEncrypted),
      refreshToken: record.secret.refreshTokenEncrypted ? codec.decrypt(record.secret.refreshTokenEncrypted) : null,
    },
    tokenVersion: record.secret.tokenVersion,
    keyVersion: record.secret.keyVersion,
  } satisfies HostedConnectionSecretBundle;
}

function resolveLocalHeartbeatErrorPatch(input: UpdateLocalHeartbeatInput): LocalHeartbeatErrorPatch {
  if (input.clearError) {
    return { kind: "clear" };
  }

  return {
    kind: "merge",
    ...(input.lastErrorCode !== undefined ? { lastErrorCode: input.lastErrorCode } : {}),
    ...(input.lastErrorMessage !== undefined ? { lastErrorMessage: input.lastErrorMessage } : {}),
  };
}

function toPrismaHeartbeatErrorPatch(
  errorPatch: LocalHeartbeatErrorPatch,
): Pick<Prisma.DeviceConnectionUpdateManyMutationInput, "lastErrorCode" | "lastErrorMessage" | "lastSyncErrorAt"> {
  if (errorPatch.kind === "clear") {
    return {
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
  }

  return {
    ...(errorPatch.lastErrorCode !== undefined ? { lastErrorCode: errorPatch.lastErrorCode } : {}),
    ...(errorPatch.lastErrorMessage !== undefined ? { lastErrorMessage: errorPatch.lastErrorMessage } : {}),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown };
  return candidate.code === "P2002";
}

export function generateHostedAgentBearerToken(): { token: string; tokenHash: string } {
  const token = `hbds_agent_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}
