import { createHash, randomBytes } from "node:crypto";

import { Prisma, PrismaClient } from "@prisma/client";
import { deviceSyncError } from "@healthybob/device-syncd";

import type {
  DeviceSyncAccount,
  DeviceSyncAccountStatus,
  DeviceSyncPublicIngressStore,
  DeviceSyncWebhookTraceRecord,
  OAuthStateRecord,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncConnectionInput,
} from "@healthybob/device-syncd";
import type { HostedSecretCodec } from "./crypto";
import type { AuthenticatedHostedUser } from "./auth";
import { generatePrefixedId, maybeIsoTimestamp, toIsoTimestamp, toJsonRecord } from "./shared";

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

export class PrismaDeviceSyncControlPlaneStore implements DeviceSyncPublicIngressStore {
  readonly prisma: PrismaClient;
  readonly codec: HostedSecretCodec;

  constructor(input: { prisma: PrismaClient; codec: HostedSecretCodec }) {
    this.prisma = input.prisma;
    this.codec = input.codec;
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
        include: {
          secret: true,
        },
      });

      if (existing) {
        if (ownerId && existing.userId !== ownerId) {
          throw deviceSyncError({
            code: "CONNECTION_OWNERSHIP_CONFLICT",
            message: "This provider account is already connected to a different Healthy Bob user.",
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
          message: "Hosted device-sync connections must be initiated by an authenticated Healthy Bob user.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const connectionId = generatePrefixedId("dsc");
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

  async recordWebhookTraceIfNew(input: DeviceSyncWebhookTraceRecord): Promise<boolean> {
    try {
      await this.prisma.deviceWebhookTrace.create({
        data: {
          provider: input.provider,
          traceId: input.traceId,
          externalAccountId: input.externalAccountId,
          eventType: input.eventType,
          receivedAt: new Date(input.receivedAt),
          payloadJson: toNullablePrismaJsonValue(input.payload),
        },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }

      throw error;
    }
  }

  async markWebhookReceived(accountId: string, now: string): Promise<void> {
    await this.prisma.deviceConnection.update({
      where: {
        id: accountId,
      },
      data: {
        lastWebhookAt: new Date(now),
      },
    });
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
      include: {
        secret: true,
      },
    });

    if (!record) {
      return null;
    }

    return requireHostedConnectionBundleRecord(record, this.codec);
  }

  async createSignal(input: CreateHostedSignalInput): Promise<HostedSignalRecord> {
    const record = await this.prisma.deviceSyncSignal.create({
      data: {
        userId: input.userId,
        connectionId: input.connectionId ?? null,
        provider: input.provider,
        kind: input.kind,
        payloadJson: toNullablePrismaJsonValue(input.payload),
        createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
      },
    });

    return this.mapSignalRecord(record);
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

    return records.map((record) => this.mapSignalRecord(record));
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
        id: generatePrefixedId("dsa"),
        userId: input.user.id,
        label: input.label ?? null,
        tokenHash: input.tokenHash,
        createdAt: new Date(now),
        updatedAt: new Date(now),
        expiresAt: new Date(input.expiresAt),
        lastSeenAt: new Date(now),
      },
    });

    return this.mapAgentSessionRecord(record);
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
        session: this.mapAgentSessionRecord(record),
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
      session: this.mapAgentSessionRecord(touched),
    };
  }

  async rotateAgentSession(input: {
    sessionId: string;
    tokenHash: string;
    now: string;
    expiresAt: string;
  }): Promise<HostedAgentSessionRecord> {
    const replacementSessionId = generatePrefixedId("dsa");

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

      return this.mapAgentSessionRecord(record);
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

      return record ? this.mapAgentSessionRecord(record) : null;
    });
  }

  async markConnectionDisconnected(input: {
    connectionId: string;
    userId: string;
    now: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<PublicDeviceSyncAccount> {
    const updated = await this.prisma.$transaction(async (tx) => {
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
    });

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

  async updateConnectionFromLocalHeartbeat(
    userId: string,
    connectionId: string,
    patch: UpdateLocalHeartbeatInput,
  ): Promise<PublicDeviceSyncAccount | null> {
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
        ...(patch.clearError
          ? {
              lastErrorCode: null,
              lastErrorMessage: null,
            }
          : {
              ...(patch.lastErrorCode !== undefined ? { lastErrorCode: patch.lastErrorCode } : {}),
              ...(patch.lastErrorMessage !== undefined ? { lastErrorMessage: patch.lastErrorMessage } : {}),
            }),
      },
    });

    if (updated.count === 0) {
      return null;
    }

    return this.getConnectionForUser(userId, connectionId);
  }

  async withConnectionRefreshLock<TResult>(
    connectionId: string,
    callback: (tx: any) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`select pg_advisory_xact_lock(hashtext(${connectionId}))`;
      return callback(tx as unknown as PrismaClient);
    });
  }

  private mapSignalRecord(record: any): HostedSignalRecord {
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

  private mapAgentSessionRecord(record: any): HostedAgentSessionRecord {
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
}

function toPrismaJsonObject(value: unknown): Prisma.InputJsonObject {
  return toJsonRecord(value) as Prisma.InputJsonObject;
}

function toNullablePrismaJsonValue(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value ? toPrismaJsonObject(value) : Prisma.DbNull;
}

export function mapHostedPublicAccountRecord(record: any): PublicDeviceSyncAccount {
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

export function requireHostedPublicAccountRecord(record: any): PublicDeviceSyncAccount {
  if (!record) {
    throw new TypeError("Expected device connection record.");
  }

  return mapHostedPublicAccountRecord(record);
}

export function requireHostedConnectionBundleRecord(
  record: any,
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
      accessToken: codec.decrypt(record.secret.accessTokenEncrypted),
      refreshToken: record.secret.refreshTokenEncrypted ? codec.decrypt(record.secret.refreshTokenEncrypted) : null,
    },
    tokenVersion: record.secret.tokenVersion,
    keyVersion: record.secret.keyVersion,
  } satisfies HostedConnectionSecretBundle;
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
