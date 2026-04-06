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
  payload: Record<string, unknown>;
  createdAt: string;
}



export type HostedTokenAuditAction = "token_exported" | "token_refreshed";

export type HostedTokenAuditChannel = "agent_export" | "agent_refresh" | "internal_runtime_snapshot";

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
  metadata: Record<string, unknown>;
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
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  tx?: HostedPrismaTransactionClient;
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
  lastSyncStartedAt?: string | null;
  lastSyncCompletedAt?: string | null;
  lastSyncErrorAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  nextReconcileAt?: string | null;
  clearError?: boolean;
}
