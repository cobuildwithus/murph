import type { Prisma } from "@prisma/client";


export type HostedPrismaTransactionClient = Prisma.TransactionClient;

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
  occurredAt: string | null;
  traceId: string | null;
  eventType: string | null;
  resourceCategory: string | null;
  sourceProviderSlug: string | null;
  reason: string | null;
  nextReconcileAt: string | null;
  revokeWarning: {
    code?: string | null;
    message?: string | null;
  } | null;
  createdAt: string;
}

export interface HostedDeviceSyncDirtyResource {
  count: number;
  dirtyPayloadId?: string;
  eventType?: string | null;
  firstEventOccurredAt?: string | null;
  firstProviderSentAt?: string | null;
  firstWebhookReceivedAt?: string | null;
  jobKind: string;
  payload?: Record<string, boolean | number | string>;
  resource: string | null;
  resourceCategory: string | null;
  sourceProviderSlug: string | null;
  windowEnd: string | null;
  windowStart: string | null;
}

export interface HostedDeviceSyncDirtyConnectionRecord {
  connectionId: string;
  userId: string;
  provider: string;
  dirtyRevision: bigint;
  processedRevision: bigint;
  firstDirtyAt: string;
  latestDirtyAt: string;
  windowStart: string | null;
  windowEnd: string | null;
  eventCount: bigint;
  latestTraceId: string | null;
  latestEventType: string | null;
  latestResourceCategory: string | null;
  sourceProviderCounts: Record<string, number>;
  resourceCategoryCounts: Record<string, number>;
  dirtyResources: Record<string, HostedDeviceSyncDirtyResource>;
  createdAt: string;
  updatedAt: string;
}

export interface HostedDeviceSyncDirtyConnectionAckRecord {
  connectionId: string;
  userId: string;
  dirtyRevision: bigint;
  processedRevision: bigint;
  stillDirty: boolean;
}

export interface HostedDeviceSyncDueReconcileConnectionRecord {
  connectionId: string;
  connectedAt: string;
  userId: string;
  provider: string;
  nextReconcileAt: string;
}

export type HostedConnectionRefreshLeaseClaimResult =
  | { status: "claimed" }
  | { status: "in_progress"; leaseExpiresAt: string }
  | { status: "stale" }
  | { status: "version_changed" };

export interface UpsertHostedDeviceSyncDirtyConnectionInput {
  connectionId: string;
  userId: string;
  provider: string;
  dirtyAt: string;
  traceId?: string | null;
  eventType?: string | null;
  resourceCategory?: string | null;
  resources?: readonly HostedDeviceSyncDirtyResource[];
  tx?: HostedPrismaTransactionClient;
}

export interface UpsertHostedDeviceSyncDirtyConnectionResult {
  dirty: HostedDeviceSyncDirtyConnectionRecord;
  shouldRequestWake: boolean;
}

export type HostedTokenAuditAction = "token_exported" | "token_refreshed";

export type HostedTokenAuditChannel = "agent_export" | "agent_refresh";
export type HostedTokenAuditRefreshOutcome =
  | "performed"
  | "skipped_fresh"
  | "skipped_version_mismatch";

export interface HostedTokenAuditRecord {
  id: number;
  userId: string;
  connectionId: string;
  provider: string;
  action: HostedTokenAuditAction;
  channel: HostedTokenAuditChannel;
  sessionId: string | null;
  tokenVersion: number;
  keyVersion: string;
  expectedTokenVersion: number | null;
  forceRefresh: boolean | null;
  refreshOutcome: HostedTokenAuditRefreshOutcome | null;
  tokenVersionChanged: boolean | null;
  createdAt: string;
}

export interface CreateHostedTokenAuditInput {
  userId: string;
  connectionId: string;
  provider: string;
  action: HostedTokenAuditAction;
  channel: HostedTokenAuditChannel;
  sessionId?: string | null;
  tokenVersion: number;
  keyVersion: string;
  expectedTokenVersion?: number | null;
  forceRefresh?: boolean | null;
  refreshOutcome?: HostedTokenAuditRefreshOutcome | null;
  tokenVersionChanged?: boolean | null;
  createdAt?: string;
  tx?: HostedPrismaTransactionClient;
}

export interface CreateHostedSignalInput {
  userId: string;
  connectionId?: string | null;
  provider: string;
  kind: string;
  occurredAt?: string | null;
  traceId?: string | null;
  eventType?: string | null;
  resourceCategory?: string | null;
  sourceProviderSlug?: string | null;
  reason?: string | null;
  nextReconcileAt?: string | null;
  revokeWarning?: {
    code?: string | null;
    message?: string | null;
  } | null;
  createdAt?: string;
  tx?: HostedPrismaTransactionClient;
}
