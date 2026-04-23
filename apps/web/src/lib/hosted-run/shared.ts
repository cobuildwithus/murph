import { createHash, randomUUID } from "node:crypto";

import { Prisma, type HostedRun, type PrismaClient } from "@prisma/client";
import type {
  HostedBrowserVaultReplicaCursorRef,
  HostedIngressSnapshotRef,
  HostedRunExecutorKind,
  HostedRunStatus,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionCursorSnapshotRef,
} from "@murphai/hosted-execution/parsers";

import {
  ensureHostedExecutionCursorRow,
  lockHostedExecutionCursorRowTx,
} from "../hosted-ingress/store-data";
import type { HostedExecutionCursorRow } from "../hosted-ingress/store.types";

const DEFAULT_HOSTED_RUN_EVENT_LIMIT = 64;
const HOSTED_RUN_ACTIVE_STALE_AFTER_MS = 15 * 60 * 1000;
const MAX_HOSTED_RUN_EVENT_LIMIT = 256;

export const HOSTED_RUN_FINALIZING_STATUS: HostedRunStatus = "finalizing";
export const HOSTED_RUN_ACTIVE_STATUSES = new Set<HostedRunStatus>([
  "acquired",
  "running",
  HOSTED_RUN_FINALIZING_STATUS,
]);
export const HOSTED_RUN_FINALIZE_RESUMABLE_STATUS: HostedRunStatus = "committed_needs_finalize";
export const DEFAULT_HOSTED_RUN_EXECUTOR_KIND: HostedRunExecutorKind = "cloudflare-container";

export type HostedRunStoreClient = PrismaClient | Prisma.TransactionClient;
export type HostedRunMutationTx = Prisma.TransactionClient;
export type HostedRunRow = HostedRun;

export async function loadLockedCursorTx(input: {
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<void> {
  await ensureHostedExecutionCursorRow({
    tx: input.tx,
    userId: input.userId,
  });
  await lockHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
}

export async function loadLockedCursorRowTx(input: {
  tx: HostedRunMutationTx;
  userId: string;
}): Promise<HostedExecutionCursorRow> {
  await loadLockedCursorTx(input);
  return ensureHostedExecutionCursorRow({
    tx: input.tx,
    userId: input.userId,
  });
}

export function isHostedRunActiveStale(
  run: HostedRunRow,
  now: Date,
): boolean {
  const updatedAtMs = run.updatedAt.getTime();
  return Number.isFinite(updatedAtMs)
    && now.getTime() - updatedAtMs > HOSTED_RUN_ACTIVE_STALE_AFTER_MS;
}

export function normalizeHostedRunAcquireLimit(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return DEFAULT_HOSTED_RUN_EVENT_LIMIT;
  }

  if (!Number.isInteger(value) || value < 1 || value > MAX_HOSTED_RUN_EVENT_LIMIT) {
    throw new RangeError(`Hosted run acquire limit must be between 1 and ${MAX_HOSTED_RUN_EVENT_LIMIT}.`);
  }

  return value;
}

export function normalizeHostedRunTurnInputLimit(value: number | null | undefined): number {
  return normalizeHostedRunAcquireLimit(value);
}

export function normalizeHostedRunStatusLimit(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return 10;
  }

  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new RangeError("Hosted run status limit must be between 1 and 100.");
  }

  return value;
}

export function normalizeHostedRunWakeAt(value: string | null): Date | null {
  if (value === null) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Hosted run nextRuntimeWakeAt must be a valid ISO-8601 timestamp or null.");
  }

  return parsed;
}

export function normalizeHostedRunWakeReason(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeHostedRunFailureClass(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized.slice(0, 128) : null;
}

export function normalizeNullableHostedRunString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function normalizeHostedRunFailureCode(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized.slice(0, 128) : null;
}

export function normalizeHostedRunWakeQuarantineCode(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : "hosted_run_quarantined";
}

export function createHostedRunToken(): string {
  return `${randomUUID()}.${randomUUID()}`;
}

export function hashHostedRunToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function hostedRunTokenMatches(hash: string, token: string): boolean {
  return hashHostedRunToken(token) === hash;
}

export function cursorSnapshotRefToPrismaJson(
  value: HostedExecutionCursorRow["snapshotRef"],
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null) {
    return Prisma.DbNull;
  }

  return toNullablePrismaJson(parseHostedExecutionCursorSnapshotRef(value));
}

export function cursorBrowserVaultReplicaRefToPrismaJson(
  value: HostedExecutionCursorRow["browserVaultReplicaRef"],
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return toNullablePrismaJson(parseHostedBrowserVaultReplicaRef(value));
}

export function toNullablePrismaJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) {
    return Prisma.DbNull;
  }

  return toPrismaJson(value);
}

export function toPrismaJsonArray(values: string[]): Prisma.InputJsonArray {
  return values.map((value) => value) satisfies Prisma.InputJsonArray;
}

export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new TypeError("Hosted run JSON value must be serializable.");
  }

  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function readHostedRunStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`${label} must be an array of strings.`);
  }

  return value;
}

export function readHostedRunBigIntArray(value: unknown, label: string): bigint[] {
  return readHostedRunStringArray(value, label).map((entry) => BigInt(entry));
}

export type HostedRunCursorUpdateInput = {
  browserVaultReplicaRef?: HostedBrowserVaultReplicaCursorRef;
  cursor: HostedExecutionCursorRow;
  nextRuntimeWakeAt?: string | null;
  nextRuntimeWakeReason?: string | null;
  snapshotRef?: HostedIngressSnapshotRef;
};
