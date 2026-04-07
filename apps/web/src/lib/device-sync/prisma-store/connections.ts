import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import {
  deviceSyncError,
  sanitizeStoredDeviceSyncMetadata,
  toRedactedPublicDeviceSyncAccount,
  type PublicDeviceSyncAccount,
  type UpsertPublicDeviceSyncConnectionInput,
} from "@murphai/device-syncd/public-ingress";

import {
  readHostedExecutionControlClientIfConfigured,
} from "../../hosted-execution/control";
import {
  buildHostedPublicDeviceSyncAccount,
  findHostedDeviceSyncRuntimeConnection,
  type HostedStaticDeviceSyncConnectionRecord,
} from "../internal-runtime";
import { asRecord, generateHostedRandomPrefixedId } from "../shared";

export const hostedConnectionRecordArgs = {
  select: {
    connectedAt: true,
    createdAt: true,
    displayName: true,
    externalAccountId: true,
    id: true,
    provider: true,
    updatedAt: true,
    userId: true,
  },
} satisfies Prisma.DeviceConnectionDefaultArgs;

export type HostedConnectionRecord = Prisma.DeviceConnectionGetPayload<typeof hostedConnectionRecordArgs>;

const hostedConnectionSignalRecordArgs = {
  select: {
    connectionId: true,
    createdAt: true,
    id: true,
    kind: true,
    payloadJson: true,
  },
} satisfies Prisma.DeviceSyncSignalDefaultArgs;

type HostedConnectionSignalRecord = Prisma.DeviceSyncSignalGetPayload<typeof hostedConnectionSignalRecordArgs>;

interface HostedDurableConnectionSummary {
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastSyncErrorAt?: string | null;
  lastWebhookAt?: string | null;
  nextReconcileAt?: string | null;
  scopes?: string[];
  status?: "active" | "disconnected" | "reauthorization_required";
  updatedAt?: string | null;
}

export class PrismaHostedConnectionStore {
  readonly prisma: PrismaClient;

  constructor(input: { prisma: PrismaClient }) {
    this.prisma = input.prisma;
  }

  async upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): Promise<PublicDeviceSyncAccount> {
    const ownerId = typeof input.ownerId === "string" && input.ownerId.trim() ? input.ownerId.trim() : null;
    const displayName = normalizeNullableString(input.displayName);
    const connectedAt = new Date(input.connectedAt);

    const record = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.deviceConnection.findUnique({
        where: {
          provider_externalAccountId: {
            provider: input.provider,
            externalAccountId: input.externalAccountId,
          },
        },
        ...hostedConnectionRecordArgs,
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

        return tx.deviceConnection.update({
          where: {
            id: existing.id,
          },
          data: {
            connectedAt,
            displayName,
          },
          ...hostedConnectionRecordArgs,
        });
      }

      if (!ownerId) {
        throw deviceSyncError({
          code: "CONNECTION_OWNER_REQUIRED",
          message: "Hosted device-sync connections must be initiated by an authenticated Murph user.",
          retryable: false,
          httpStatus: 400,
        });
      }

      return tx.deviceConnection.create({
        data: {
          connectedAt,
          displayName,
          externalAccountId: input.externalAccountId,
          id: generateHostedRandomPrefixedId("dsc"),
          provider: input.provider,
          userId: ownerId,
        },
        ...hostedConnectionRecordArgs,
      });
    });

    return toRedactedPublicDeviceSyncAccount(
      buildHostedPublicDeviceSyncAccount({
        record: mapHostedConnectionRecord(record),
        fallback: {
          accessTokenExpiresAt: input.tokens.accessTokenExpiresAt ?? null,
          displayName,
          metadata: sanitizeStoredDeviceSyncMetadata(input.metadata ?? {}),
          nextReconcileAt: input.nextReconcileAt ?? null,
          scopes: input.scopes ?? [],
          status: input.status ?? "active",
        },
      }),
    );
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
      ...hostedConnectionRecordArgs,
    });

    return record ? this.hydrateRuntimeConnectionRecord(record) : null;
  }

  async markWebhookReceived(accountId: string, now: string): Promise<void> {
    const record = await this.getConnectionRecordById(accountId);

    if (!record) {
      return;
    }

    const controlClient = readHostedExecutionControlClientIfConfigured();

    if (!controlClient) {
      return;
    }

    await controlClient.applyDeviceSyncRuntimeUpdates(record.userId, {
      occurredAt: now,
      updates: [
        {
          connectionId: record.id,
          localState: {
            lastWebhookAt: now,
          },
        },
      ],
    });
  }

  async listConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    const records = await this.listConnectionRecordsForUser(userId);

    return this.buildDurableConnectionRecords(records);
  }

  async getConnectionForUser(userId: string, connectionId: string): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.getConnectionRecordForUser(userId, connectionId);

    return record ? this.buildDurableConnectionRecord(record) : null;
  }

  async listRuntimeConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    const records = await this.listConnectionRecordsForUser(userId);

    return this.hydrateRuntimeConnectionRecords(records);
  }

  async getRuntimeConnectionForUser(userId: string, connectionId: string): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.getConnectionRecordForUser(userId, connectionId);

    return record ? this.hydrateRuntimeConnectionRecord(record) : null;
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

  async listConnectionRecordsForUser(userId: string): Promise<HostedConnectionRecord[]> {
    return this.prisma.deviceConnection.findMany({
      where: {
        userId,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      ...hostedConnectionRecordArgs,
    });
  }

  async getConnectionRecordForUser(userId: string, connectionId: string): Promise<HostedConnectionRecord | null> {
    return this.prisma.deviceConnection.findFirst({
      where: {
        id: connectionId,
        userId,
      },
      ...hostedConnectionRecordArgs,
    });
  }

  async getConnectionRecordById(connectionId: string): Promise<HostedConnectionRecord | null> {
    return this.prisma.deviceConnection.findUnique({
      where: {
        id: connectionId,
      },
      ...hostedConnectionRecordArgs,
    });
  }

  private async buildDurableConnectionRecord(record: HostedConnectionRecord): Promise<PublicDeviceSyncAccount> {
    const summaries = await this.listDurableConnectionSummaries(record.userId, [record.id]);
    const summary = summaries.get(record.id);

    return toRedactedPublicDeviceSyncAccount(
      buildHostedPublicDeviceSyncAccount({
        record: mapHostedConnectionRecord(record),
        fallback: buildHostedDurableConnectionFallback(record, summary),
      }),
    );
  }

  private async hydrateRuntimeConnectionRecord(record: HostedConnectionRecord): Promise<PublicDeviceSyncAccount> {
    const controlClient = readHostedExecutionControlClientIfConfigured();
    const runtimeSnapshot = controlClient
      ? await controlClient.getDeviceSyncRuntimeSnapshot(record.userId, {
          connectionId: record.id,
          provider: record.provider,
        })
      : null;
    const runtimeConnection = runtimeSnapshot
      ? findHostedDeviceSyncRuntimeConnection(runtimeSnapshot, record.id)
      : null;

    return toRedactedPublicDeviceSyncAccount(
      buildHostedPublicDeviceSyncAccount({
        record: mapHostedConnectionRecord(record),
        runtimeConnection,
      }),
    );
  }

  private async buildDurableConnectionRecords(records: readonly HostedConnectionRecord[]): Promise<PublicDeviceSyncAccount[]> {
    if (records.length === 0) {
      return [];
    }

    const summaries = await this.listDurableConnectionSummaries(
      records[0].userId,
      records.map((record) => record.id),
    );

    return records.map((record) => toRedactedPublicDeviceSyncAccount(
      buildHostedPublicDeviceSyncAccount({
        record: mapHostedConnectionRecord(record),
        fallback: buildHostedDurableConnectionFallback(record, summaries.get(record.id)),
      }),
    ));
  }

  private async hydrateRuntimeConnectionRecords(records: readonly HostedConnectionRecord[]): Promise<PublicDeviceSyncAccount[]> {
    if (records.length === 0) {
      return [];
    }

    const controlClient = readHostedExecutionControlClientIfConfigured();
    const runtimeSnapshot = controlClient
      ? await controlClient.getDeviceSyncRuntimeSnapshot(records[0].userId, {})
      : null;

    return records.map((record) => toRedactedPublicDeviceSyncAccount(
      buildHostedPublicDeviceSyncAccount({
        record: mapHostedConnectionRecord(record),
        runtimeConnection: runtimeSnapshot ? findHostedDeviceSyncRuntimeConnection(runtimeSnapshot, record.id) : null,
      }),
    ));
  }

  private async listDurableConnectionSummaries(
    userId: string,
    connectionIds: readonly string[],
  ): Promise<Map<string, HostedDurableConnectionSummary>> {
    const normalizedConnectionIds = [...new Set(connectionIds)];

    if (normalizedConnectionIds.length === 0) {
      return new Map();
    }

    const signalRecords = await this.prisma.deviceSyncSignal.findMany({
      where: {
        userId,
        connectionId: {
          in: normalizedConnectionIds,
        },
      },
      orderBy: [{ id: "desc" }],
      ...hostedConnectionSignalRecordArgs,
    });
    const summaries = new Map<string, HostedDurableConnectionSummary>();

    for (const signalRecord of signalRecords) {
      if (!signalRecord.connectionId) {
        continue;
      }

      const summary = summaries.get(signalRecord.connectionId) ?? {};
      applyHostedDurableSignalSummary(summary, signalRecord);
      summaries.set(signalRecord.connectionId, summary);
    }

    return summaries;
  }
}

function mapHostedConnectionRecord(record: HostedConnectionRecord): HostedStaticDeviceSyncConnectionRecord {
  return {
    connectedAt: record.connectedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    displayName: normalizeNullableString(record.displayName),
    externalAccountId: record.externalAccountId,
    id: record.id,
    provider: record.provider,
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
  } satisfies HostedStaticDeviceSyncConnectionRecord;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildHostedDurableConnectionFallback(
  record: HostedConnectionRecord,
  summary: HostedDurableConnectionSummary | undefined,
): {
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastSyncErrorAt?: string | null;
  lastWebhookAt?: string | null;
  nextReconcileAt?: string | null;
  scopes?: readonly string[] | null;
  status?: "active" | "disconnected" | "reauthorization_required";
  updatedAt?: string | null;
} {
  const updatedAt = newestIsoTimestamp(summary?.updatedAt ?? null, record.updatedAt.toISOString());

  return {
    lastErrorCode: summary?.lastErrorCode ?? null,
    lastErrorMessage: summary?.lastErrorMessage ?? null,
    lastSyncErrorAt: summary?.lastSyncErrorAt ?? null,
    lastWebhookAt: summary?.lastWebhookAt ?? null,
    nextReconcileAt: summary?.nextReconcileAt ?? null,
    scopes: summary?.scopes ?? [],
    status: summary?.status ?? "active",
    updatedAt,
  };
}

function applyHostedDurableSignalSummary(
  summary: HostedDurableConnectionSummary,
  signalRecord: HostedConnectionSignalRecord,
): void {
  const signalCreatedAt = signalRecord.createdAt.toISOString();
  const payload = asRecord(signalRecord.payloadJson);

  summary.updatedAt = newestIsoTimestamp(summary.updatedAt ?? null, signalCreatedAt);

  if (summary.scopes === undefined) {
    const scopes = readStringList(payload.scopes);

    if (scopes) {
      summary.scopes = scopes;
    }
  }

  if (summary.nextReconcileAt === undefined && payload.nextReconcileAt !== undefined) {
    summary.nextReconcileAt = readNullableString(payload.nextReconcileAt);
  }

  if (signalRecord.kind === "webhook_hint" && summary.lastWebhookAt === undefined) {
    summary.lastWebhookAt = readNullableString(payload.occurredAt) ?? signalCreatedAt;
  }

  if (summary.status === undefined) {
    switch (signalRecord.kind) {
      case "connected":
        summary.status = "active";
        break;
      case "disconnected":
        summary.status = "disconnected";
        summary.nextReconcileAt = null;
        applyHostedSignalErrorFields(summary, payload, signalCreatedAt);
        break;
      case "reauthorization_required":
        summary.status = "reauthorization_required";
        applyHostedSignalErrorFields(summary, payload, signalCreatedAt);
        break;
      default:
        break;
    }
  }
}

function applyHostedSignalErrorFields(
  summary: HostedDurableConnectionSummary,
  payload: Record<string, unknown>,
  signalCreatedAt: string,
): void {
  if (summary.lastSyncErrorAt === undefined) {
    summary.lastSyncErrorAt = readNullableString(payload.occurredAt) ?? signalCreatedAt;
  }

  const warning = asRecord(payload.revokeWarning);
  const code = readNullableString(payload.code) ?? readNullableString(warning.code);
  const message = readNullableString(payload.message) ?? readNullableString(warning.message);

  if (summary.lastErrorCode === undefined) {
    summary.lastErrorCode = code ?? null;
  }

  if (summary.lastErrorMessage === undefined) {
    summary.lastErrorMessage = message ?? null;
  }
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries.length > 0 ? [...new Set(entries)] : [];
}

function newestIsoTimestamp(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left >= right ? left : right;
}
