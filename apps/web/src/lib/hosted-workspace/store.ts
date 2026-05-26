import { randomUUID } from "node:crypto";

import {
  HOSTED_MAILBOX_LANES,
  HOSTED_RUNTIME_LOG_COMPONENTS,
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_LOG_LEVELS,
  HOSTED_RUNTIME_LOG_PHASES,
  HOSTED_WORKSPACE_CHECKPOINT_REASONS,
  isHostedMailboxLane,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedMailboxLane,
  HostedRuntimeLogComponent,
  HostedRuntimeLogEventCode,
  HostedRuntimeLogLevel,
  HostedRuntimeLogPhase,
  HostedRuntimeRedactedJson,
  HostedRuntimeRedactedScalar,
  HostedRuntimeRedactedValue,
  HostedWorkspaceCheckpointReason,
} from "@murphai/hosted-execution/runtime-control";
import {
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionSnapshotRef,
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import { Prisma, type PrismaClient } from "@prisma/client";

import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";

export {
  HOSTED_RUNTIME_LOG_COMPONENTS,
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_LOG_LEVELS,
  HOSTED_RUNTIME_LOG_PHASES,
  HOSTED_WORKSPACE_CHECKPOINT_REASONS,
};

const FORBIDDEN_RAW_HOSTED_RUNTIME_REDACTED_KEY_NAMES = [
  "address",
  "authorization",
  "body",
  "cookie",
  "email",
  "header",
  "message",
  "path",
  "payload",
  "phone",
  "prompt",
  "raw",
  "secret",
  "text",
  "token",
] as const;
const SAFE_DIAGNOSTIC_TEXT_REDACTED_KEY_NAMES = new Set([
  "failureAssistantProviderErrorBodyMessage",
  "failureAssistantProviderErrorMessage",
  "failureAssistantProviderErrorStatusText",
  "providerHttpStatusText",
  "providerRequestBodyFieldNames",
  "routePlanningActiveExperimentContextElapsedMs",
  "routePlanningAnyBootstrapContextPrepared",
  "routePlanningBootstrapContextPrepared",
  "routePlanningSensitiveHealthContextAllowed",
  "safeErrorMessage",
]);
const SAFE_DIAGNOSTIC_TEXT_REDACTED_KEY_PATTERN =
  /^[A-Za-z][A-Za-z0-9_.-]{0,127}(?:ErrorMessage|ErrorDetail|ErrorCause|ErrorStatusText)$/u;
const SAFE_HOSTED_RUNTIME_REDACTED_METADATA_KEY_SUFFIXES = [
  "Bytes",
  "Code",
  "Codes",
  "Count",
  "Counts",
  "Index",
  "Indexes",
  "Kind",
  "Kinds",
  "Length",
  "Lengths",
  "Ordinal",
  "Ordinals",
  "Present",
  "Seq",
  "Seqs",
  "Size",
  "Sizes",
  "Status",
  "Statuses",
  "Type",
  "Types",
] as const;
const HOSTED_RUNTIME_REDACTED_JSON_MAX_KEYS = 96;
const HOSTED_RUNTIME_REDACTED_ARRAY_MAX_LENGTH = 16;
const HOSTED_RUNTIME_REDACTED_STRING_MAX_LENGTH = 2048;

export type HostedWorkspaceStoreClient = PrismaClient | Prisma.TransactionClient;
export type HostedWorkspaceMutationTx = Prisma.TransactionClient;

export interface HostedWorkspaceTransactionRunner {
  $transaction<Result>(
    callback: (tx: HostedWorkspaceMutationTx) => Promise<Result>,
  ): Promise<Result>;
}

export interface HostedWorkspaceRow {
  userId: string;
  version: bigint;
  snapshotRef: Prisma.JsonValue | null;
  browserVaultReplicaRef: Prisma.JsonValue | null;
  nextWakeAt: Date | null;
  nextWakeReason: string | null;
  redactedStatusJson: Prisma.JsonValue | null;
  checkpointedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostedWorkspaceRecord {
  userId: string;
  version: string;
  snapshotRef: Prisma.JsonValue | null;
  browserVaultReplicaRef: Prisma.JsonValue | null;
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  redactedStatusJson: Prisma.JsonValue | null;
  checkpointedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HostedWorkspaceCheckpointResult {
  status: "updated" | "conflict";
  workspace: HostedWorkspaceRecord | null;
}

export interface HostedBrowserVaultReplicaPublishResult {
  status: "published" | "missing" | "conflict";
  workspace: HostedWorkspaceRecord | null;
}

export interface HostedRuntimeLogRow {
  id: string;
  userId: string;
  at: Date;
  level: string;
  component: string;
  phase: string;
  eventCode: string;
  attemptId: string | null;
  leaseGeneration: bigint | null;
  workspaceVersion: bigint | null;
  checkpointVersion: bigint | null;
  mailboxLane: string | null;
  mailboxSeqStart: bigint | null;
  mailboxSeqEnd: bigint | null;
  outboxIntentRef: string | null;
  errorCode: string | null;
  redactedJson: Prisma.JsonValue | null;
  createdAt: Date;
}

export interface HostedRuntimeLogRecord {
  id: string;
  userId: string;
  at: string;
  level: HostedRuntimeLogLevel;
  component: HostedRuntimeLogComponent;
  phase: HostedRuntimeLogPhase;
  eventCode: HostedRuntimeLogEventCode;
  attemptId: string | null;
  leaseGeneration: string | null;
  workspaceVersion: string | null;
  checkpointVersion: string | null;
  mailboxLane: HostedMailboxLane | null;
  mailboxSeqStart: string | null;
  mailboxSeqEnd: string | null;
  outboxIntentRef: string | null;
  errorCode: string | null;
  redactedJson: Prisma.JsonValue | null;
  createdAt: string;
}

export async function ensureHostedWorkspace(input: {
  prisma?: HostedWorkspaceStoreClient;
  userId: string;
}): Promise<HostedWorkspaceRecord> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted workspace userId");
  const row = await prisma.hostedWorkspace.upsert({
    create: {
      userId,
    },
    update: {},
    where: {
      userId,
    },
  });

  return projectHostedWorkspace(row);
}

export async function readHostedWorkspace(input: {
  prisma?: HostedWorkspaceStoreClient;
  userId: string;
}): Promise<HostedWorkspaceRecord | null> {
  const prisma = input.prisma ?? getPrisma();
  const row = await prisma.hostedWorkspace.findUnique({
    where: {
      userId: requireNonEmptyString(input.userId, "Hosted workspace userId"),
    },
  });

  return row ? projectHostedWorkspace(row) : null;
}

export async function checkpointHostedWorkspace(input: {
  checkpointedAt?: Date | string | null;
  expectedVersion: bigint | number | string;
  nextWakeAt?: Date | string | null;
  nextWakeReason?: string | null;
  prisma?: PrismaClient;
  reason: HostedWorkspaceCheckpointReason | string;
  redactedStatusJson?: Record<string, unknown> | null;
  snapshotRef: unknown | null;
  userId: string;
}): Promise<HostedWorkspaceCheckpointResult> {
  const prisma = input.prisma ?? getPrisma();

  return prisma.$transaction((tx) => checkpointHostedWorkspaceTx({
    ...input,
    tx,
  }));
}

export async function checkpointHostedWorkspaceTx(input: {
  checkpointedAt?: Date | string | null;
  expectedVersion: bigint | number | string;
  nextWakeAt?: Date | string | null;
  nextWakeReason?: string | null;
  reason: HostedWorkspaceCheckpointReason | string;
  redactedStatusJson?: Record<string, unknown> | null;
  snapshotRef: unknown | null;
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<HostedWorkspaceCheckpointResult> {
  requireAllowedString(
    input.reason,
    HOSTED_WORKSPACE_CHECKPOINT_REASONS,
    "Hosted workspace checkpoint reason",
  );
  const userId = requireNonEmptyString(input.userId, "Hosted workspace userId");
  const snapshotRef = parseHostedExecutionSnapshotRef(
    input.snapshotRef,
    "Hosted workspace snapshotRef",
  );
  const updateData: Prisma.HostedWorkspaceUpdateManyMutationInput = {
    checkpointedAt: input.checkpointedAt === undefined || input.checkpointedAt === null
      ? new Date()
      : requireDate(input.checkpointedAt, "Hosted workspace checkpointedAt"),
    snapshotRef: toNullablePrismaJson(snapshotRef),
    version: {
      increment: 1,
    },
  };

  if ("nextWakeAt" in input) {
    updateData.nextWakeAt = input.nextWakeAt === undefined || input.nextWakeAt === null
      ? null
      : requireDate(input.nextWakeAt, "Hosted workspace nextWakeAt");
  }

  if ("nextWakeReason" in input) {
    updateData.nextWakeReason = normalizeNullableString(input.nextWakeReason);
  }

  if ("redactedStatusJson" in input) {
    updateData.redactedStatusJson = input.redactedStatusJson === undefined
      ? Prisma.DbNull
      : toNullablePrismaJson(sanitizeHostedRuntimeRedactedJson(
        input.redactedStatusJson,
        "Hosted workspace redactedStatusJson",
      ));
  }

  const updated = await input.tx.hostedWorkspace.updateMany({
    data: updateData,
    where: {
      userId,
      version: normalizeBigInt(input.expectedVersion, "Hosted workspace expectedVersion"),
    },
  });
  const row = await input.tx.hostedWorkspace.findUnique({
    where: {
      userId,
    },
  });

  return {
    status: updated.count === 1 ? "updated" : "conflict",
    workspace: row ? projectHostedWorkspace(row) : null,
  };
}

export async function publishLatestBrowserVaultReplicaRef(input: {
  expectedWorkspaceVersion?: bigint | number | string | null;
  prisma?: HostedWorkspaceTransactionRunner;
  replicaRef: unknown;
  userId: string;
}): Promise<HostedBrowserVaultReplicaPublishResult> {
  const prisma: HostedWorkspaceTransactionRunner = input.prisma ?? getPrisma();

  return prisma.$transaction((tx: HostedWorkspaceMutationTx) => publishBrowserVaultReplicaRefTx({
    ...input,
    legacyExpectedSourceStateHash: null,
    tx,
  }));
}

export async function publishLatestBrowserVaultReplicaRefTx(input: {
  expectedWorkspaceVersion?: bigint | number | string | null;
  replicaRef: unknown;
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<HostedBrowserVaultReplicaPublishResult> {
  return publishBrowserVaultReplicaRefTx({
    ...input,
    legacyExpectedSourceStateHash: null,
  });
}

export async function publishHostedBrowserVaultReplicaRef(input: {
  expectedSourceStateHash?: string | null;
  expectedWorkspaceVersion?: bigint | number | string | null;
  prisma?: HostedWorkspaceTransactionRunner;
  replicaRef: unknown;
  userId: string;
}): Promise<HostedBrowserVaultReplicaPublishResult> {
  // Compatibility-only wrapper for older hosted browser-vault publish callers.
  // Deletion target: 2026-05-23. Active callers should use
  // `publishLatestBrowserVaultReplicaRef`.
  if (input.expectedSourceStateHash === undefined || input.expectedSourceStateHash === null) {
    return await publishLatestBrowserVaultReplicaRef(input);
  }

  return await publishLegacySourceHashBrowserVaultReplicaRef({
    expectedSourceStateHash: input.expectedSourceStateHash,
    expectedWorkspaceVersion: input.expectedWorkspaceVersion,
    prisma: input.prisma,
    replicaRef: input.replicaRef,
    userId: input.userId,
  });
}

export async function publishHostedBrowserVaultReplicaRefTx(input: {
  expectedSourceStateHash?: string | null;
  expectedWorkspaceVersion?: bigint | number | string | null;
  replicaRef: unknown;
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<HostedBrowserVaultReplicaPublishResult> {
  // Compatibility-only wrapper for older hosted browser-vault publish callers.
  // Deletion target: 2026-05-23. Active callers should use
  // `publishLatestBrowserVaultReplicaRefTx`.
  if (input.expectedSourceStateHash === undefined || input.expectedSourceStateHash === null) {
    return publishLatestBrowserVaultReplicaRefTx(input);
  }

  return publishLegacySourceHashBrowserVaultReplicaRefTx({
    expectedSourceStateHash: input.expectedSourceStateHash,
    expectedWorkspaceVersion: input.expectedWorkspaceVersion,
    replicaRef: input.replicaRef,
    tx: input.tx,
    userId: input.userId,
  });
}

async function publishLegacySourceHashBrowserVaultReplicaRef(input: {
  expectedSourceStateHash: string;
  expectedWorkspaceVersion?: bigint | number | string | null;
  prisma?: HostedWorkspaceTransactionRunner;
  replicaRef: unknown;
  userId: string;
}): Promise<HostedBrowserVaultReplicaPublishResult> {
  const prisma: HostedWorkspaceTransactionRunner = input.prisma ?? getPrisma();

  return prisma.$transaction((tx: HostedWorkspaceMutationTx) =>
    publishLegacySourceHashBrowserVaultReplicaRefTx({
      ...input,
      tx,
    })
  );
}

async function publishLegacySourceHashBrowserVaultReplicaRefTx(input: {
  expectedSourceStateHash: string;
  expectedWorkspaceVersion?: bigint | number | string | null;
  replicaRef: unknown;
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<HostedBrowserVaultReplicaPublishResult> {
  return publishBrowserVaultReplicaRefTx({
    ...input,
    legacyExpectedSourceStateHash: input.expectedSourceStateHash,
  });
}

async function publishBrowserVaultReplicaRefTx(input: {
  expectedWorkspaceVersion?: bigint | number | string | null;
  legacyExpectedSourceStateHash: string | null;
  replicaRef: unknown;
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<HostedBrowserVaultReplicaPublishResult> {
  const userId = requireNonEmptyString(input.userId, "Hosted browser-vault replica publish userId");
  const legacyExpectedSourceStateHash = input.legacyExpectedSourceStateHash === null
    ? null
    : requireNonEmptyString(
        input.legacyExpectedSourceStateHash,
        "Legacy hosted browser-vault replica publish expectedSourceStateHash",
      );
  const expectedWorkspaceVersion = input.expectedWorkspaceVersion === undefined
    || input.expectedWorkspaceVersion === null
    ? null
    : normalizeBigInt(
        input.expectedWorkspaceVersion,
        "Hosted browser-vault replica publish expectedWorkspaceVersion",
      );
  const replicaRef = parseHostedBrowserVaultReplicaRef(
    input.replicaRef,
    "Hosted browser-vault replica publish replicaRef",
  );

  if (!replicaRef) {
    throw new TypeError("Hosted browser-vault replica publish replicaRef must not be null.");
  }

  if (legacyExpectedSourceStateHash && replicaRef.sourceBundleHash !== legacyExpectedSourceStateHash) {
    throw new TypeError(
      "Legacy hosted browser-vault replica publish sourceBundleHash must match expectedSourceStateHash.",
    );
  }

  let current = await input.tx.hostedWorkspace.findUnique({
    where: {
      userId,
    },
  });

  if (!current) {
    return {
      status: "missing",
      workspace: null,
    };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const publish = await publishBrowserVaultReplicaRefAgainstCurrentWorkspace({
      current,
      expectedWorkspaceVersion,
      legacyExpectedSourceStateHash,
      replicaRef,
      tx: input.tx,
      userId,
    });

    const row = await input.tx.hostedWorkspace.findUnique({
      where: {
        userId,
      },
    });

    if (!row) {
      return {
        status: "missing",
        workspace: null,
      };
    }

    if (publish.status === "published") {
      return {
        status: "published",
        workspace: projectHostedWorkspace(row),
      };
    }

    if (attempt === 0) {
      current = row;
      continue;
    }

    return {
      status: "conflict",
      workspace: projectHostedWorkspace(row),
    };
  }

  throw new Error("Unreachable browser-vault replica publish retry state.");
}

async function publishBrowserVaultReplicaRefAgainstCurrentWorkspace(input: {
  current: HostedWorkspaceRow;
  expectedWorkspaceVersion: bigint | null;
  legacyExpectedSourceStateHash: string | null;
  replicaRef: HostedBrowserVaultReplicaRef;
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<
  { status: "conflict" | "published" }
> {
  if (
    input.expectedWorkspaceVersion !== null
    && input.current.version !== input.expectedWorkspaceVersion
  ) {
    return {
      status: "conflict",
    };
  }

  if (
    input.legacyExpectedSourceStateHash
    && readHostedWorkspaceBrowserVaultSourceStateHash(input.current.snapshotRef) !== input.legacyExpectedSourceStateHash
  ) {
    return {
      status: "conflict",
    };
  }

  if (
    isOlderBrowserVaultReplicaRef({
      current: input.current.browserVaultReplicaRef,
      next: input.replicaRef,
    })
  ) {
    return {
      status: "conflict",
    };
  }

  const updated = await input.tx.hostedWorkspace.updateMany({
    data: {
      browserVaultReplicaRef: toNullablePrismaJson(input.replicaRef),
    },
    where: {
      browserVaultReplicaRef: buildBrowserVaultReplicaRefUpdateFilter(
        input.current.browserVaultReplicaRef,
      ),
      userId: input.userId,
      version: input.current.version,
    },
  });

  return {
    status: updated.count === 1 ? "published" : "conflict",
  };
}

function isOlderBrowserVaultReplicaRef(input: {
  current: Prisma.JsonValue | null;
  next: HostedBrowserVaultReplicaRef;
}): boolean {
  const current = parseHostedBrowserVaultReplicaRef(
    input.current,
    "Hosted browser-vault replica publish current browserVaultReplicaRef",
  );
  if (!current) {
    return false;
  }

  const nextGeneratedAt = parseBrowserVaultReplicaGeneratedAt(
    input.next.generatedAt,
    "Hosted browser-vault replica publish next generatedAt",
  );
  const currentGeneratedAt = parseBrowserVaultReplicaGeneratedAt(
    current.generatedAt,
    "Hosted browser-vault replica publish current generatedAt",
  );

  if (nextGeneratedAt < currentGeneratedAt) {
    return true;
  }

  if (nextGeneratedAt > currentGeneratedAt) {
    return false;
  }

  return !browserVaultReplicaRefsMatch(current, input.next);
}

function browserVaultReplicaRefsMatch(
  current: HostedBrowserVaultReplicaRef,
  next: HostedBrowserVaultReplicaRef,
): boolean {
  return JSON.stringify(current) === JSON.stringify(next);
}

function parseBrowserVaultReplicaGeneratedAt(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new TypeError(`${label} must be a valid ISO-8601 timestamp.`);
  }

  return timestamp;
}

function buildBrowserVaultReplicaRefUpdateFilter(
  current: Prisma.JsonValue | null,
): Prisma.HostedWorkspaceWhereInput["browserVaultReplicaRef"] {
  return current === null
    ? { equals: Prisma.DbNull }
    : { equals: toNullablePrismaJson(current) };
}

function readHostedWorkspaceBrowserVaultSourceStateHash(
  snapshotRefValue: Prisma.JsonValue | null,
): string | null {
  const snapshotRef = parseHostedExecutionSnapshotRef(
    snapshotRefValue,
    "Hosted browser-vault replica publish snapshotRef",
  );
  if (!snapshotRef) {
    return null;
  }

  return readHostedExecutionSnapshotDeltaRef(snapshotRef)?.hash
    ?? readHostedExecutionSnapshotBaseRef(snapshotRef)?.hash
    ?? null;
}

export async function recordHostedRuntimeLog(input: {
  at?: Date | string | null;
  attemptId?: string | null;
  checkpointVersion?: bigint | number | string | null;
  component: HostedRuntimeLogComponent | string;
  errorCode?: string | null;
  eventCode: HostedRuntimeLogEventCode | string;
  id?: string | null;
  leaseGeneration?: bigint | number | string | null;
  level: HostedRuntimeLogLevel | string;
  mailboxLane?: HostedMailboxLane | string | null;
  mailboxSeqEnd?: bigint | number | string | null;
  mailboxSeqStart?: bigint | number | string | null;
  outboxIntentRef?: string | null;
  phase: HostedRuntimeLogPhase | string;
  prisma?: HostedWorkspaceStoreClient;
  redacted?: HostedRuntimeRedactedJson | null;
  userId: string;
  workspaceVersion?: bigint | number | string | null;
}): Promise<HostedRuntimeLogRecord> {
  const prisma = input.prisma ?? getPrisma();

  return recordHostedRuntimeLogTx({
    ...input,
    tx: prisma,
  });
}

export async function recordHostedRuntimeLogTx(input: {
  at?: Date | string | null;
  attemptId?: string | null;
  checkpointVersion?: bigint | number | string | null;
  component: HostedRuntimeLogComponent | string;
  errorCode?: string | null;
  eventCode: HostedRuntimeLogEventCode | string;
  id?: string | null;
  leaseGeneration?: bigint | number | string | null;
  level: HostedRuntimeLogLevel | string;
  mailboxLane?: HostedMailboxLane | string | null;
  mailboxSeqEnd?: bigint | number | string | null;
  mailboxSeqStart?: bigint | number | string | null;
  outboxIntentRef?: string | null;
  phase: HostedRuntimeLogPhase | string;
  redacted?: HostedRuntimeRedactedJson | null;
  tx: HostedWorkspaceStoreClient;
  userId: string;
  workspaceVersion?: bigint | number | string | null;
}): Promise<HostedRuntimeLogRecord> {
  const row = await input.tx.hostedRuntimeLog.create({
    data: {
      at: input.at === undefined || input.at === null
        ? new Date()
        : requireDate(input.at, "Hosted runtime log at"),
      attemptId: normalizeNullableHostedRuntimeLogString(
        input.attemptId,
        "Hosted runtime log attemptId",
      ),
      checkpointVersion: normalizeNullableBigInt(
        input.checkpointVersion,
        "Hosted runtime log checkpointVersion",
      ),
      component: requireAllowedString(
        input.component,
        HOSTED_RUNTIME_LOG_COMPONENTS,
        "Hosted runtime log component",
      ),
      errorCode: normalizeNullableHostedRuntimeLogString(
        input.errorCode,
        "Hosted runtime log errorCode",
      ),
      eventCode: requireAllowedString(
        input.eventCode,
        HOSTED_RUNTIME_LOG_EVENT_CODES,
        "Hosted runtime log eventCode",
      ),
      id: normalizeNullableString(input.id) ?? randomUUID(),
      leaseGeneration: normalizeNullableBigInt(
        input.leaseGeneration,
        "Hosted runtime log leaseGeneration",
      ),
      level: requireAllowedString(
        input.level,
        HOSTED_RUNTIME_LOG_LEVELS,
        "Hosted runtime log level",
      ),
      mailboxLane: normalizeNullableHostedMailboxLane(input.mailboxLane),
      mailboxSeqEnd: normalizeNullableBigInt(
        input.mailboxSeqEnd,
        "Hosted runtime log mailboxSeqEnd",
      ),
      mailboxSeqStart: normalizeNullableBigInt(
        input.mailboxSeqStart,
        "Hosted runtime log mailboxSeqStart",
      ),
      outboxIntentRef: normalizeNullableHostedRuntimeLogString(
        input.outboxIntentRef,
        "Hosted runtime log outboxIntentRef",
      ),
      phase: requireAllowedString(
        input.phase,
        HOSTED_RUNTIME_LOG_PHASES,
        "Hosted runtime log phase",
      ),
      redactedJson: toNullablePrismaJson(sanitizeHostedRuntimeLogRedactedJson(input.redacted)),
      userId: requireNonEmptyString(input.userId, "Hosted runtime log userId"),
      workspaceVersion: normalizeNullableBigInt(
        input.workspaceVersion,
        "Hosted runtime log workspaceVersion",
      ),
    },
  });

  return projectHostedRuntimeLog(row);
}

export async function listHostedRuntimeLogs(input: {
  limit?: number;
  prisma?: HostedWorkspaceStoreClient;
  userId: string;
}): Promise<HostedRuntimeLogRecord[]> {
  const prisma = input.prisma ?? getPrisma();
  const userId = requireNonEmptyString(input.userId, "Hosted runtime log userId");
  const rows = await prisma.hostedRuntimeLog.findMany({
    orderBy: {
      at: "desc",
    },
    take: normalizeHostedRuntimeLogLimit(input.limit ?? 20),
    where: {
      userId,
    },
  });

  return rows.map((row) => projectHostedRuntimeLog(row));
}

export function projectHostedWorkspace(record: HostedWorkspaceRow): HostedWorkspaceRecord {
  return {
    browserVaultReplicaRef: record.browserVaultReplicaRef,
    checkpointedAt: record.checkpointedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    nextWakeAt: record.nextWakeAt?.toISOString() ?? null,
    nextWakeReason: record.nextWakeReason,
    redactedStatusJson: record.redactedStatusJson,
    snapshotRef: record.snapshotRef,
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
    version: record.version.toString(),
  };
}

export function projectHostedRuntimeLog(record: HostedRuntimeLogRow): HostedRuntimeLogRecord {
  return {
    at: record.at.toISOString(),
    attemptId: normalizeNullableHostedRuntimeLogString(
      record.attemptId,
      "Hosted runtime log attemptId",
    ),
    checkpointVersion: record.checkpointVersion?.toString() ?? null,
    component: requireAllowedString(
      record.component,
      HOSTED_RUNTIME_LOG_COMPONENTS,
      "Hosted runtime log component",
    ),
    createdAt: record.createdAt.toISOString(),
    errorCode: normalizeNullableHostedRuntimeLogString(
      record.errorCode,
      "Hosted runtime log errorCode",
    ),
    eventCode: requireAllowedString(
      record.eventCode,
      HOSTED_RUNTIME_LOG_EVENT_CODES,
      "Hosted runtime log eventCode",
    ),
    id: record.id,
    leaseGeneration: record.leaseGeneration?.toString() ?? null,
    level: requireAllowedString(
      record.level,
      HOSTED_RUNTIME_LOG_LEVELS,
      "Hosted runtime log level",
    ),
    mailboxLane: normalizeNullableHostedMailboxLane(record.mailboxLane),
    mailboxSeqEnd: record.mailboxSeqEnd?.toString() ?? null,
    mailboxSeqStart: record.mailboxSeqStart?.toString() ?? null,
    outboxIntentRef: normalizeNullableHostedRuntimeLogString(
      record.outboxIntentRef,
      "Hosted runtime log outboxIntentRef",
    ),
    phase: requireAllowedString(
      record.phase,
      HOSTED_RUNTIME_LOG_PHASES,
      "Hosted runtime log phase",
    ),
    redactedJson: record.redactedJson,
    userId: record.userId,
    workspaceVersion: record.workspaceVersion?.toString() ?? null,
  };
}

function normalizeHostedRuntimeLogLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Hosted runtime log limit must be a positive integer.");
  }

  return Math.min(value, 50);
}

function sanitizeHostedRuntimeLogRedactedJson(
  value: HostedRuntimeRedactedJson | null | undefined,
): HostedRuntimeRedactedJson | null {
  return sanitizeHostedRuntimeRedactedJson(value, "Hosted runtime log redactedJson");
}

function sanitizeHostedRuntimeRedactedJson(
  value: Record<string, unknown> | null | undefined,
  label: string,
): HostedRuntimeRedactedJson | null {
  if (!value) {
    return null;
  }

  const output: HostedRuntimeRedactedJson = {};
  const entries = Object.entries(value);

  if (entries.length > HOSTED_RUNTIME_REDACTED_JSON_MAX_KEYS) {
    throw new TypeError(
      `${label} must contain at most ${HOSTED_RUNTIME_REDACTED_JSON_MAX_KEYS} fields.`,
    );
  }

  for (const [key, entry] of entries) {
    assertAllowedHostedRuntimeRedactedKey(key, `${label}.${key}`);
    output[key] = parseHostedRuntimeRedactedValue(entry, `${label}.${key}`);
  }

  return Object.keys(output).length === 0 ? null : output;
}

function parseHostedRuntimeRedactedValue(
  value: unknown,
  label: string,
): HostedRuntimeRedactedValue {
  if (Array.isArray(value)) {
    if (value.length > HOSTED_RUNTIME_REDACTED_ARRAY_MAX_LENGTH) {
      throw new TypeError(
        `${label} must contain at most ${HOSTED_RUNTIME_REDACTED_ARRAY_MAX_LENGTH} redacted values.`,
      );
    }

    return value.map((entry, index) =>
      parseHostedRuntimeRedactedScalar(entry, `${label}[${index}]`));
  }

  return parseHostedRuntimeRedactedScalar(value, label);
}

function parseHostedRuntimeRedactedScalar(
  value: unknown,
  label: string,
): HostedRuntimeRedactedScalar {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`${label} must be a finite redacted value.`);
    }

    return value;
  }

  if (typeof value === "string") {
    assertSafeHostedRuntimeRedactedString(value, label);

    return value;
  }

  throw new TypeError(`${label} must be a shallow redacted scalar or scalar array.`);
}

function assertAllowedHostedRuntimeRedactedKey(key: string, label: string): void {
  if (isSafeHostedRuntimeDiagnosticTextRedactedKey(key)) {
    return;
  }

  const normalized = key.toLowerCase();

  for (const forbidden of FORBIDDEN_RAW_HOSTED_RUNTIME_REDACTED_KEY_NAMES) {
    if (
      normalized.includes(forbidden)
      && !isSafeHostedRuntimeRedactedMetadataKey(key)
    ) {
      throw new TypeError(`${label} is not allowed in hosted runtime redacted JSON.`);
    }
  }
}

function isSafeHostedRuntimeDiagnosticTextRedactedKey(key: string): boolean {
  return SAFE_DIAGNOSTIC_TEXT_REDACTED_KEY_NAMES.has(key)
    || SAFE_DIAGNOSTIC_TEXT_REDACTED_KEY_PATTERN.test(key);
}

function isSafeHostedRuntimeRedactedMetadataKey(key: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(key)
    && SAFE_HOSTED_RUNTIME_REDACTED_METADATA_KEY_SUFFIXES.some((suffix) =>
      key.endsWith(suffix)
    );
}

function assertSafeHostedRuntimeRedactedString(value: string, label: string): void {
  if (value.length > HOSTED_RUNTIME_REDACTED_STRING_MAX_LENGTH) {
    throw new TypeError(
      `${label} must be at most ${HOSTED_RUNTIME_REDACTED_STRING_MAX_LENGTH} characters.`,
    );
  }

  if (/\/Users\/|file:\/\/|[A-Za-z]:\\|<HOME_DIR>|(^|[\s(])\/[^\s)]+/u.test(value)) {
    throw new TypeError(`${label} must not contain a local filesystem path.`);
  }

  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)) {
    throw new TypeError(`${label} must not contain an email address.`);
  }

  if (/\+\d[\d().\s-]{7,}\d/u.test(value)) {
    throw new TypeError(`${label} must not contain a phone number.`);
  }

  if (
    /(["']?(?:authorization|secret|token|password|cookie|set-cookie|api[-_]?key)["']?\s*[:=]\s*["']?)([^"',\s}]+)/iu
      .test(value)
    || /\b(Basic|Bearer)\s+[A-Z0-9._~+/=-]+\b/iu.test(value)
    || /\b(?:sk|pk|rk)_(?:live|test)_[A-Z0-9]+\b/iu.test(value)
    || /\bwhsec_[A-Z0-9]+\b/iu.test(value)
  ) {
    throw new TypeError(`${label} must not contain secret-shaped content.`);
  }
}

function normalizeNullableHostedRuntimeLogString(
  value: string | null | undefined,
  label: string,
): string | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  assertSafeHostedRuntimeRedactedString(normalized, label);

  if (normalized.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized)) {
    throw new TypeError(`${label} must be a bounded opaque identifier or code.`);
  }

  return normalized;
}

function toNullablePrismaJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) {
    return Prisma.DbNull;
  }

  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new TypeError("Hosted workspace JSON value must be serializable.");
  }

  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

function normalizeNullableBigInt(
  value: bigint | number | string | null | undefined,
  label: string,
): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeBigInt(value, label);
}

function normalizeNullableHostedMailboxLane(
  value: string | null | undefined,
): HostedMailboxLane | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  if (isHostedMailboxLane(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `Hosted runtime log mailboxLane must be one of ${HOSTED_MAILBOX_LANES.join(", ")}.`,
  );
}

function normalizeBigInt(
  value: bigint | number | string,
  label: string,
): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^\d+$/u.test(value)) {
    return BigInt(value);
  }

  throw new TypeError(`${label} must be a non-negative integer.`);
}

function requireAllowedString<const Value extends string>(
  value: string,
  allowedValues: readonly Value[],
  label: string,
): Value {
  const normalized = requireNonEmptyString(value, label);

  if (allowedValues.includes(normalized as Value)) {
    return normalized as Value;
  }

  throw new TypeError(`${label} is invalid: ${normalized}`);
}

function requireNonEmptyString(value: string, label: string): string {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    throw new TypeError(`${label} must not be blank.`);
  }

  return normalized;
}

function requireDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${label} must be a valid ISO-8601 timestamp.`);
  }

  return date;
}
