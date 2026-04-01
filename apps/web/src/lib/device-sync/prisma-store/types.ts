import type { Prisma } from "@prisma/client";

import type { DeviceSyncAccount, DeviceSyncAccountStatus } from "@murphai/device-syncd";

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
