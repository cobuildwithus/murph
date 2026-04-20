import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedIngressBehavior,
  HostedIngressLifecycleState,
  HostedIngressEvent,
} from "@murphai/hosted-execution/contracts";

export type HostedIngressStoreClient = PrismaClient | Prisma.TransactionClient;
export type HostedIngressMutationTx = Prisma.TransactionClient;

export interface HostedExecutionCursorRow {
  committedSeq: bigint;
  createdAt: Date;
  nextSeq: bigint;
  nextRuntimeWakeAt: Date | null;
  nextRuntimeWakeReason: string | null;
  snapshotRef: Prisma.JsonValue | null;
  updatedAt: Date;
  userId: string;
  version: bigint;
}

export interface HostedIngressEventRow {
  behavior: HostedIngressBehavior;
  completedAt: Date | null;
  coalescingKey: string | null;
  createdAt: Date;
  dedupeKey: string | null;
  id: string;
  kind: string;
  occurredAt: Date;
  payloadBytes: number | null;
  payloadInlineCiphertext: string | null;
  payloadRef: string | null;
  payloadSchema: string;
  quarantineCode: string | null;
  quarantinedAt: Date | null;
  runId: string | null;
  seq: bigint;
  state: string;
  updatedAt: Date;
  userId: string;
}

export interface HostedIngressEventAliasRow {
  createdAt: Date;
  eventId: string;
  ingressEventId: string;
  replacedByEventId: string | null;
  updatedAt: Date;
  userId: string;
}

export interface HostedIngressPayloadRow {
  createdAt: Date;
  ingressEventId: string;
  payloadBytes: number;
  payloadCiphertext: string;
  payloadSchema: string;
  updatedAt: Date;
  userId: string;
}

export interface AppendHostedIngressInput {
  behavior: HostedIngressBehavior;
  coalescingKey?: string | null;
  dedupeKey?: string | null;
  eventId?: string | null;
  kind: string;
  occurredAt: string;
  payload: unknown;
  payloadSchema: string;
  tx: HostedIngressMutationTx;
  userId: string;
}

export interface AppendHostedIngressResult {
  duplicate: boolean;
  inserted: boolean;
  updatedExisting: boolean;
  wake: HostedIngressEvent;
}

export interface HostedIngressLifecycleRecord {
  eventId: string;
  replacedByEventId?: string | null;
  state: HostedIngressLifecycleState;
}

export interface HostedIngressRepairCandidate {
  committedSeq: string;
  nextSeq: string;
  pendingIngressEventCount: number;
  targetCommittedSeqHint: string;
  userId: string;
}

export interface ListHostedExecutableWakesInput {
  limit?: number;
  prisma?: HostedIngressStoreClient;
  userId: string;
}

export function requireOccurredAtDate(value: string): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Hosted ingress occurredAt must be a valid ISO-8601 timestamp.");
  }

  return parsed;
}
