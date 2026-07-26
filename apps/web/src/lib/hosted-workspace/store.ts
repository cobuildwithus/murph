import { randomUUID } from "node:crypto";

import {
  HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEYS,
  HOSTED_WORKSPACE_CHECKPOINT_HANDLED_CONVERSATION_ITEM_MAX_IDS,
  HOSTED_MAILBOX_LANES,
  HOSTED_RUNTIME_LOG_COMPONENTS,
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_LOG_LEVELS,
  HOSTED_RUNTIME_LOG_PHASES,
  HOSTED_WORKSPACE_CHECKPOINT_REASONS,
  isHostedRuntimeMailboxContinuation,
  isHostedMailboxLane,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedMailboxLane,
  HostedRuntimeLogComponent,
  HostedRuntimeLogEventCode,
  HostedRuntimeLogLevel,
  HostedRuntimeLogPhase,
  HostedRuntimeRedactedJson,
  HostedWorkspaceCheckpointReason,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedExecutionSnapshotRefState,
} from "@murphai/hosted-execution";
import {
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionSnapshotRef,
  parseHostedRuntimeRedactedJson,
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import { Prisma, type PrismaClient } from "@prisma/client";

import { advanceHostedMailboxLaneConsumedSeq } from "../hosted-mailbox/lane-counter-store";
import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";

export {
  HOSTED_RUNTIME_LOG_COMPONENTS,
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_LOG_LEVELS,
  HOSTED_RUNTIME_LOG_PHASES,
  HOSTED_WORKSPACE_CHECKPOINT_REASONS,
};

const HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEY_SET =
  new Set<string>(HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEYS);
const HOSTED_WORKSPACE_CHECKPOINT_MAILBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
  inboxMediaRetentionWakeAt: Date | null;
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
  inboxMediaRetentionWakeAt: string | null;
  redactedStatusJson: Prisma.JsonValue | null;
  checkpointedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HostedWorkspaceCheckpointResult {
  conversationInputAhead?: boolean;
  replacedSnapshotRef: HostedExecutionSnapshotRefState;
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

/** One runtime log entry as the runtime reports it, before the user is attached. */
export interface HostedRuntimeLogEntryInput {
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
  workspaceVersion?: bigint | number | string | null;
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
  handledConversationMailboxItemIds?: readonly string[];
  inboxMediaRetentionWakeAt?: Date | string | null;
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
  handledConversationMailboxItemIds?: readonly string[];
  inboxMediaRetentionWakeAt?: Date | string | null;
  nextWakeAt?: Date | string | null;
  nextWakeReason?: string | null;
  reason: HostedWorkspaceCheckpointReason | string;
  redactedStatusJson?: Record<string, unknown> | null;
  snapshotRef: unknown | null;
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<HostedWorkspaceCheckpointResult> {
  const reason = requireAllowedString(
    input.reason,
    HOSTED_WORKSPACE_CHECKPOINT_REASONS,
    "Hosted workspace checkpoint reason",
  );
  const userId = requireNonEmptyString(input.userId, "Hosted workspace userId");
  const snapshotRef = parseHostedExecutionSnapshotRef(
    input.snapshotRef,
    "Hosted workspace snapshotRef",
  );
  const expectedVersion = normalizeBigInt(
    input.expectedVersion,
    "Hosted workspace expectedVersion",
  );
  const checkpointedAt = input.checkpointedAt === undefined || input.checkpointedAt === null
    ? new Date()
    : requireDate(input.checkpointedAt, "Hosted workspace checkpointedAt");
  const updateData: Prisma.HostedWorkspaceUpdateManyMutationInput = {
    checkpointedAt,
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

  if ("inboxMediaRetentionWakeAt" in input) {
    updateData.inboxMediaRetentionWakeAt =
      input.inboxMediaRetentionWakeAt === undefined || input.inboxMediaRetentionWakeAt === null
        ? null
        : requireDate(
          input.inboxMediaRetentionWakeAt,
          "Hosted workspace inboxMediaRetentionWakeAt",
        );
  }

  if ("redactedStatusJson" in input) {
    updateData.redactedStatusJson = input.redactedStatusJson === undefined
      ? Prisma.DbNull
      : toNullablePrismaJson(sanitizeHostedRuntimeRedactedJson(
        input.redactedStatusJson,
        "Hosted workspace redactedStatusJson",
        HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEY_SET,
      ));
  }

  let conversationInputAhead: boolean | undefined;
  let lockedWorkspace: HostedWorkspaceRow | null = null;
  const conversationImportedSeq = readCheckpointConversationImportedSeq(input.redactedStatusJson);
  const handledConversationMailboxItemIds =
    normalizeCheckpointHandledConversationMailboxItemIds(
      input.handledConversationMailboxItemIds,
    );
  const systemHandledThroughSeq = readCheckpointSystemHandledThroughSeq(input.redactedStatusJson);
  if (reason === "idle_shutdown" && conversationImportedSeq !== null) {
    await lockHostedWorkspaceForCheckpointTx({
      tx: input.tx,
      userId,
    });
    lockedWorkspace = await input.tx.hostedWorkspace.findUnique({
      where: {
        userId,
      },
    });
    if (!lockedWorkspace || lockedWorkspace.version !== expectedVersion) {
      return {
        replacedSnapshotRef: null,
        status: "conflict",
        workspace: lockedWorkspace ? projectHostedWorkspace(lockedWorkspace) : null,
      };
    }
    if (!isHostedRuntimeMailboxContinuation({
      nextWakeAt: input.nextWakeAt,
      nextWakeReason: input.nextWakeReason,
      redactedStatus: input.redactedStatusJson,
    })) {
      const pendingConversationSeq = await readForegroundPendingConversationSeqTx({
        conversationImportedSeq,
        tx: input.tx,
        userId,
      });
      if (pendingConversationSeq !== null) {
        conversationInputAhead = true;
      }
    }
  }

  const currentWorkspace = lockedWorkspace ?? await input.tx.hostedWorkspace.findUnique({
    where: {
      userId,
    },
  });
  const replacedSnapshotRef = currentWorkspace
    ? parseHostedExecutionSnapshotRef(
        currentWorkspace.snapshotRef,
        "Hosted workspace checkpoint replaced snapshotRef",
      )
    : null;

  const updated = await input.tx.hostedWorkspace.updateMany({
    data: updateData,
    where: {
      userId,
      version: expectedVersion,
    },
  });
  if (updated.count === 1 && systemHandledThroughSeq !== null) {
    // Couple the snapshot that removed handled local work to its durable lane
    // acknowledgement. A checkpoint conflict or transaction rollback leaves
    // the watermark untouched so restored pending work remains replayable.
    await advanceHostedMailboxLaneConsumedSeq({
      consumedSeq: systemHandledThroughSeq,
      lane: "system",
      prisma: input.tx,
      userId,
    });
  }
  if (
    updated.count === 1
    && reason === "idle_shutdown"
    && conversationImportedSeq !== null
  ) {
    // Stamp only the exact terminal inputs carried by the accepted snapshot,
    // then derive the largest contiguous prefix from same-user live rows. An
    // old incomplete local index or missing event can never acknowledge an
    // unstamped mailbox row.
    await stampHostedMailboxHandledConversationInputsTx({
      checkpointedAt,
      importedThroughSeq: conversationImportedSeq,
      itemIds: handledConversationMailboxItemIds,
      tx: input.tx,
      userId,
    });
    const handledThroughSeq = await readHostedMailboxContiguousHandledThroughSeqTx({
      importedThroughSeq: conversationImportedSeq,
      now: checkpointedAt,
      tx: input.tx,
      userId,
    });
    await advanceHostedMailboxLaneConsumedSeq({
      consumedSeq: handledThroughSeq,
      lane: "conversation",
      prisma: input.tx,
      userId,
    });
  }
  const row = await input.tx.hostedWorkspace.findUnique({
    where: {
      userId,
    },
  });

  return {
    ...(updated.count === 1 && conversationInputAhead !== undefined
      ? { conversationInputAhead }
      : {}),
    replacedSnapshotRef: updated.count === 1 ? replacedSnapshotRef : null,
    status: updated.count === 1 ? "updated" : "conflict",
    workspace: row ? projectHostedWorkspace(row) : null,
  };
}

function readCheckpointSystemHandledThroughSeq(
  redactedStatusJson: Record<string, unknown> | null | undefined,
): bigint | null {
  if (!redactedStatusJson || typeof redactedStatusJson !== "object" || Array.isArray(redactedStatusJson)) {
    return null;
  }
  const value = redactedStatusJson["hostedMailboxSystemHandledThroughSeq"];
  return typeof value === "string" && /^\d+$/u.test(value)
    ? normalizeBigInt(
        value,
        "Hosted workspace checkpoint redactedStatus hostedMailboxSystemHandledThroughSeq",
      )
    : null;
}

function readCheckpointConversationImportedSeq(
  redactedStatusJson: Record<string, unknown> | null | undefined,
): bigint | null {
  const value = readCheckpointRedactedConversationImportedSeq(redactedStatusJson);
  return value === null
    ? null
    : normalizeBigInt(
        value,
        "Hosted workspace checkpoint redactedStatus hostedMailboxConversationImportedSeq",
      );
}

function normalizeCheckpointHandledConversationMailboxItemIds(
  value: readonly string[] | undefined,
): string[] {
  if (value === undefined) {
    return [];
  }
  if (
    value.length
      > HOSTED_WORKSPACE_CHECKPOINT_HANDLED_CONVERSATION_ITEM_MAX_IDS
  ) {
    throw new TypeError(
      `Hosted workspace checkpoint handled conversation mailbox item ids must contain at most ${HOSTED_WORKSPACE_CHECKPOINT_HANDLED_CONVERSATION_ITEM_MAX_IDS} entries.`,
    );
  }
  const itemIds = value.map((itemId) => {
    const normalized = normalizeNullableString(itemId);
    if (!normalized || !/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,191}$/u.test(normalized)) {
      throw new TypeError(
        "Hosted workspace checkpoint handled conversation mailbox item id must be a bounded opaque token.",
      );
    }
    return normalized;
  });
  if (new Set(itemIds).size !== itemIds.length) {
    throw new TypeError(
      "Hosted workspace checkpoint handled conversation mailbox item ids must not contain duplicates.",
    );
  }
  return itemIds;
}

async function stampHostedMailboxHandledConversationInputsTx(input: {
  checkpointedAt: Date;
  importedThroughSeq: bigint;
  itemIds: readonly string[];
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<void> {
  if (input.itemIds.length === 0) {
    return;
  }
  await input.tx.hostedMailboxItem.updateMany({
    data: {
      consumedAt: input.checkpointedAt,
    },
    where: {
      consumedAt: null,
      id: {
        in: [...input.itemIds],
      },
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: {
        lte: input.importedThroughSeq,
      },
      userId: input.userId,
    },
  });
}

async function readHostedMailboxContiguousHandledThroughSeqTx(input: {
  importedThroughSeq: bigint;
  now: Date;
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<bigint> {
  const counter = await input.tx.hostedMailboxLaneCounter.findUnique({
    where: {
      userId_lane: {
        lane: "conversation",
        userId: input.userId,
      },
    },
  });
  if (!counter) {
    return 0n;
  }
  const appendHighWater = counter.nextSeq - 1n;
  const upperBound = input.importedThroughSeq < appendHighWater
    ? input.importedThroughSeq
    : appendHighWater;
  if (upperBound <= counter.consumedSeq) {
    return counter.consumedSeq;
  }

  const firstUnconsumed = await input.tx.hostedMailboxItem.findFirst({
    orderBy: {
      laneSeq: "asc",
    },
    select: {
      laneSeq: true,
    },
    where: {
      consumedAt: null,
      createdAt: {
        gte: new Date(
          input.now.getTime() - HOSTED_WORKSPACE_CHECKPOINT_MAILBOX_RETENTION_MS,
        ),
      },
      lane: "conversation",
      laneSeq: {
        gt: counter.consumedSeq,
        lte: upperBound,
      },
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: input.now } },
      ],
      userId: input.userId,
    },
  });
  return firstUnconsumed ? firstUnconsumed.laneSeq - 1n : upperBound;
}

async function lockHostedWorkspaceForCheckpointTx(input: {
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<void> {
  await input.tx.$queryRaw`
    SELECT user_id
    FROM hosted_workspace
    WHERE user_id = ${input.userId}
    FOR UPDATE
  `;
}

function readCheckpointRedactedConversationImportedSeq(
  redactedStatusJson: Record<string, unknown> | null | undefined,
): string | null {
  if (!redactedStatusJson || typeof redactedStatusJson !== "object" || Array.isArray(redactedStatusJson)) {
    return null;
  }
  const value = redactedStatusJson["hostedMailboxConversationImportedSeq"];
  return typeof value === "string" && /^\d+$/u.test(value) ? value : null;
}

async function readForegroundPendingConversationSeqTx(input: {
  conversationImportedSeq: bigint;
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<bigint | null> {
  await input.tx.$executeRaw`
    INSERT INTO hosted_mailbox_lane_counter (user_id, lane, next_seq, updated_at)
    VALUES (${input.userId}, ${"conversation"}, 1, NOW())
    ON CONFLICT (user_id, lane) DO NOTHING
  `;
  await input.tx.$queryRaw`
    SELECT next_seq
    FROM hosted_mailbox_lane_counter
    WHERE user_id = ${input.userId}
      AND lane = ${"conversation"}
    FOR UPDATE
  `;

  const now = new Date();
  const latest = await input.tx.hostedMailboxItem.findFirst({
    orderBy: {
      laneSeq: "desc",
    },
    select: {
      laneSeq: true,
    },
    where: {
      createdAt: {
        gte: new Date(now.getTime() - HOSTED_WORKSPACE_CHECKPOINT_MAILBOX_RETENTION_MS),
      },
      lane: "conversation",
      OR: [
        {
          expiresAt: null,
        },
        {
          expiresAt: {
            gt: now,
          },
        },
      ],
      userId: input.userId,
    },
  });
  const maxSeq = latest?.laneSeq ?? 0n;
  return maxSeq > input.conversationImportedSeq ? maxSeq : null;
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
  });
}

async function publishBrowserVaultReplicaRefTx(input: {
  expectedWorkspaceVersion?: bigint | number | string | null;
  replicaRef: unknown;
  tx: HostedWorkspaceMutationTx;
  userId: string;
}): Promise<HostedBrowserVaultReplicaPublishResult> {
  const userId = requireNonEmptyString(input.userId, "Hosted browser-vault replica publish userId");
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

export function readHostedWorkspaceBrowserVaultSourceStateHash(
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
    data: buildHostedRuntimeLogCreateData(input),
  });

  return projectHostedRuntimeLog(row);
}

/**
 * Normalizes one runtime log entry into its row shape. Shared by the single-row
 * and bulk writers so both validate identically.
 */
function buildHostedRuntimeLogCreateData(
  input: HostedRuntimeLogEntryInput & { userId: string },
) {
  return {
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
      redactedJson: toNullablePrismaJson(sanitizeHostedRuntimeRedactedJson(
        input.redacted,
        "Hosted runtime log redactedJson",
      )),
      userId: requireNonEmptyString(input.userId, "Hosted runtime log userId"),
      workspaceVersion: normalizeNullableBigInt(
        input.workspaceVersion,
        "Hosted runtime log workspaceVersion",
      ),
  };
}

/**
 * Writes a batch of runtime log entries as one statement. The runtime log
 * callback accepts up to 50 entries, and one Prisma call per entry would put a
 * single request's fanout above the whole pool's capacity, making the pool
 * itself the request's concurrency limiter. `createMany` keeps one callback to
 * one statement. Every entry is normalized before the insert runs, so a
 * malformed entry rejects the batch instead of persisting part of it.
 */
export async function recordHostedRuntimeLogs(input: {
  entries: readonly HostedRuntimeLogEntryInput[];
  prisma?: HostedWorkspaceStoreClient;
  userId: string;
}): Promise<number> {
  const prisma = input.prisma ?? getPrisma();
  const rows = input.entries.map((entry) => buildHostedRuntimeLogCreateData({
    ...entry,
    userId: input.userId,
  }));

  if (rows.length === 0) {
    return 0;
  }

  const result = await prisma.hostedRuntimeLog.createMany({
    data: rows,
  });

  return result.count;
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

/**
 * Claims the per-member cooldown that decides which accepted-attempt failure
 * triggers a runtime recheck. The claim lives in workspace control state, so
 * recovery never depends on a best-effort diagnostic row being written or read
 * back. Concurrent callbacks serialize on the workspace row, and exactly one
 * of them sees a claimed count.
 */
export async function claimHostedAcceptedAttemptFailureRecheck(input: {
  cooldownMs: number;
  now?: Date | string;
  prisma?: HostedWorkspaceStoreClient;
  userId: string;
}): Promise<boolean> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now === undefined
    ? new Date()
    : requireDate(input.now, "Hosted accepted-attempt recheck claim time");
  const claimedAfter = new Date(now.getTime() - input.cooldownMs);
  const result = await prisma.hostedWorkspace.updateMany({
    data: {
      acceptedAttemptFailureRecheckClaimedAt: now,
    },
    where: {
      OR: [
        { acceptedAttemptFailureRecheckClaimedAt: null },
        { acceptedAttemptFailureRecheckClaimedAt: { lt: claimedAfter } },
      ],
      userId: requireNonEmptyString(input.userId, "Hosted workspace userId"),
    },
  });

  return result.count > 0;
}

export function projectHostedWorkspace(record: HostedWorkspaceRow): HostedWorkspaceRecord {
  return {
    browserVaultReplicaRef: record.browserVaultReplicaRef,
    checkpointedAt: record.checkpointedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    nextWakeAt: record.nextWakeAt?.toISOString() ?? null,
    nextWakeReason: record.nextWakeReason,
    inboxMediaRetentionWakeAt: record.inboxMediaRetentionWakeAt?.toISOString() ?? null,
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

function sanitizeHostedRuntimeRedactedJson(
  value: Record<string, unknown> | null | undefined,
  label: string,
  reservedKeys?: ReadonlySet<string>,
): HostedRuntimeRedactedJson | null {
  const parsed = parseHostedRuntimeRedactedJson(value, label, reservedKeys);
  return parsed && Object.keys(parsed).length > 0 ? parsed : null;
}

function normalizeNullableHostedRuntimeLogString(
  value: string | null | undefined,
  label: string,
): string | null {
  const normalized = normalizeNullableString(value);

  if (!normalized) {
    return null;
  }

  parseHostedRuntimeRedactedJson({ value: normalized }, label);

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
