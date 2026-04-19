import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedWakeBehavior,
  HostedWakeLifecycleState,
  HostedWakeRecord,
  HostedWakeTerminalState,
} from "@murphai/hosted-execution/contracts";

export type HostedWakeStoreClient = PrismaClient | Prisma.TransactionClient;
export type HostedWakeMutationTx = Prisma.TransactionClient;

export interface HostedExecutionCursorRow {
  assistantNextWakeAt: Date | null;
  committedSeq: bigint;
  createdAt: Date;
  nextSeq: bigint;
  snapshotRef: Prisma.JsonValue | null;
  updatedAt: Date;
  userId: string;
  version: bigint;
}

export interface HostedWakeRow {
  behavior: HostedWakeBehavior;
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
  seq: bigint;
  updatedAt: Date;
  userId: string;
}

export interface HostedWakeEventRow {
  createdAt: Date;
  eventId: string;
  replacedByEventId: string | null;
  updatedAt: Date;
  userId: string;
  wakeId: string;
}

export interface HostedWakePayloadRow {
  createdAt: Date;
  payloadBytes: number;
  payloadCiphertext: string;
  payloadSchema: string;
  updatedAt: Date;
  userId: string;
  wakeId: string;
}

export interface HostedWakeTerminalRow {
  createdAt: Date;
  fetchedCommittedSeq: bigint;
  fetchedCursorVersion: bigint;
  state: HostedWakeTerminalState;
  updatedAt: Date;
  userId: string;
  wakeId: string;
  wakeSeq: bigint;
}

export interface AppendHostedWakeInput {
  behavior: HostedWakeBehavior;
  coalescingKey?: string | null;
  dedupeKey?: string | null;
  eventId?: string | null;
  kind: string;
  occurredAt: string;
  payload: unknown;
  payloadSchema: string;
  tx: HostedWakeMutationTx;
  userId: string;
}

export interface AppendHostedWakeResult {
  duplicate: boolean;
  inserted: boolean;
  updatedExisting: boolean;
  wake: HostedWakeRecord;
}

export interface HostedWakeLifecycleRecord {
  eventId: string;
  replacedByEventId?: string | null;
  state: HostedWakeLifecycleState;
}

export interface HostedWakeRepairCandidate {
  committedSeq: string;
  nextSeq: string;
  pendingWakeCount: number;
  targetSeqHint: string;
  userId: string;
}

export interface ListHostedExecutableWakesInput {
  limit?: number;
  prisma?: HostedWakeStoreClient;
  userId: string;
}

export function requireOccurredAtDate(value: string): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Hosted wake occurredAt must be a valid ISO-8601 timestamp.");
  }

  return parsed;
}
