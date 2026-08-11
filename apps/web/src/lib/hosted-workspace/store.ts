import {
  HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEYS,
  HOSTED_WORKSPACE_CHECKPOINT_HANDLED_CONVERSATION_ITEM_MAX_IDS,
  HOSTED_WORKSPACE_CHECKPOINT_REASONS,
  isHostedRuntimeMailboxContinuation,
} from "@murphai/hosted-execution/runtime-control";
import type {
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

import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";

export {
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

interface CheckpointHostedWorkspaceMutationRow extends HostedWorkspaceRow {
  replacedSnapshotRef: Prisma.JsonValue | null;
}

interface CheckpointHostedWorkspaceMailboxMutationRow {
  conversationInputAhead: boolean;
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
  const workspaceAssignments: Prisma.Sql[] = [
    Prisma.sql`checkpointed_at = ${checkpointedAt}`,
    Prisma.sql`snapshot_ref = ${snapshotRef === null ? null : JSON.stringify(snapshotRef)}::jsonb`,
    Prisma.sql`version = workspace.version + 1`,
    Prisma.sql`updated_at = NOW()`,
  ];

  if ("nextWakeAt" in input) {
    workspaceAssignments.push(Prisma.sql`next_wake_at = ${
      input.nextWakeAt === undefined || input.nextWakeAt === null
        ? null
        : requireDate(input.nextWakeAt, "Hosted workspace nextWakeAt")
    }`);
  }

  if ("nextWakeReason" in input) {
    workspaceAssignments.push(
      Prisma.sql`next_wake_reason = ${normalizeNullableString(input.nextWakeReason)}`,
    );
  }

  if ("inboxMediaRetentionWakeAt" in input) {
    workspaceAssignments.push(Prisma.sql`inbox_media_retention_wake_at = ${
      input.inboxMediaRetentionWakeAt === undefined
        || input.inboxMediaRetentionWakeAt === null
        ? null
        : requireDate(
          input.inboxMediaRetentionWakeAt,
          "Hosted workspace inboxMediaRetentionWakeAt",
        )
    }`);
  }

  if ("redactedStatusJson" in input) {
    const redactedStatusJson = input.redactedStatusJson === undefined
      ? null
      : sanitizeHostedRuntimeRedactedJson(
        input.redactedStatusJson,
        "Hosted workspace redactedStatusJson",
        HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEY_SET,
      );
    workspaceAssignments.push(
      Prisma.sql`redacted_status_json = ${
        redactedStatusJson === null ? null : JSON.stringify(redactedStatusJson)
      }::jsonb`,
    );
  }

  const conversationImportedSeq = readCheckpointConversationImportedSeq(input.redactedStatusJson);
  const handledConversationMailboxItemIds =
    normalizeCheckpointHandledConversationMailboxItemIds(
      input.handledConversationMailboxItemIds,
    );
  const systemHandledThroughSeq = readCheckpointSystemHandledThroughSeq(input.redactedStatusJson);
  const shouldHandleConversation = reason === "idle_shutdown" && conversationImportedSeq !== null;
  const shouldObserveConversationAhead = shouldHandleConversation
    && !isHostedRuntimeMailboxContinuation({
      nextWakeAt: input.nextWakeAt,
      nextWakeReason: input.nextWakeReason,
      redactedStatus: input.redactedStatusJson,
    });

  const updatedRows = await input.tx.$queryRaw<CheckpointHostedWorkspaceMutationRow[]>(Prisma.sql`
    WITH current_workspace AS MATERIALIZED (
      SELECT snapshot_ref AS replaced_snapshot_ref
      FROM hosted_workspace
      WHERE user_id = ${userId}
        AND version = ${expectedVersion}
    )
    UPDATE hosted_workspace AS workspace
    SET ${Prisma.join(workspaceAssignments, ", ")}
    FROM current_workspace
    WHERE workspace.user_id = ${userId}
      AND workspace.version = ${expectedVersion}
    RETURNING
      workspace.user_id AS "userId",
      workspace.version,
      workspace.snapshot_ref AS "snapshotRef",
      workspace.browser_vault_replica_ref AS "browserVaultReplicaRef",
      workspace.next_wake_at AS "nextWakeAt",
      workspace.next_wake_reason AS "nextWakeReason",
      workspace.inbox_media_retention_wake_at AS "inboxMediaRetentionWakeAt",
      workspace.redacted_status_json AS "redactedStatusJson",
      workspace.checkpointed_at AS "checkpointedAt",
      workspace.created_at AS "createdAt",
      workspace.updated_at AS "updatedAt",
      current_workspace.replaced_snapshot_ref AS "replacedSnapshotRef"
  `);

  if (updatedRows.length === 0) {
    const currentWorkspace = await input.tx.hostedWorkspace.findUnique({
      where: {
        userId,
      },
    });
    return {
      replacedSnapshotRef: null,
      status: "conflict",
      workspace: currentWorkspace ? projectHostedWorkspace(currentWorkspace) : null,
    };
  }
  if (updatedRows.length !== 1 || !updatedRows[0]) {
    throw new Error("Hosted workspace checkpoint CAS returned an invalid row count.");
  }

  let conversationInputAhead: true | undefined;
  if (systemHandledThroughSeq !== null || shouldHandleConversation) {
    const observedAt = new Date();
    const handledConversationItemIdsSql = handledConversationMailboxItemIds.length > 0
      ? Prisma.sql`ARRAY[${Prisma.join(handledConversationMailboxItemIds)}]::text[]`
      : Prisma.sql`ARRAY[]::text[]`;
    const conversationImportedBound = conversationImportedSeq ?? 0n;
    const systemHandledBound = systemHandledThroughSeq ?? 0n;
    const checkpointRetentionCutoff = new Date(
      checkpointedAt.getTime() - HOSTED_WORKSPACE_CHECKPOINT_MAILBOX_RETENTION_MS,
    );
    const observationRetentionCutoff = new Date(
      observedAt.getTime() - HOSTED_WORKSPACE_CHECKPOINT_MAILBOX_RETENTION_MS,
    );
    // PostgreSQL data-modifying CTEs share one snapshot. The prefix query
    // therefore treats only rows returned by this statement's stamp as handled.
    const mailboxRows = await input.tx.$queryRaw<
      CheckpointHostedWorkspaceMailboxMutationRow[]
    >(Prisma.sql`
      WITH stamped_conversation AS (
        UPDATE hosted_mailbox_item AS item
        SET consumed_at = ${checkpointedAt},
            updated_at = NOW()
        WHERE ${shouldHandleConversation}
          AND item.user_id = ${userId}
          AND item.id = ANY(${handledConversationItemIdsSql})
          AND item.lane = 'conversation'
          AND item.kind = 'conversation.message'
          AND item.lane_seq <= ${conversationImportedBound}
          AND item.consumed_at IS NULL
        RETURNING item.id
      ),
      conversation_progress AS MATERIALIZED (
        SELECT
          counter.user_id,
          counter.lane,
          GREATEST(
            counter.consumed_seq,
            COALESCE(
              (
                SELECT item.lane_seq - 1
                FROM hosted_mailbox_item AS item
                WHERE item.user_id = ${userId}
                  AND item.lane = 'conversation'
                  AND item.lane_seq > counter.consumed_seq
                  AND item.lane_seq <= LEAST(
                    ${conversationImportedBound},
                    counter.next_seq - 1
                  )
                  AND item.created_at >= ${checkpointRetentionCutoff}
                  AND (item.expires_at IS NULL OR item.expires_at > ${checkpointedAt})
                  AND item.consumed_at IS NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM stamped_conversation AS stamped
                    WHERE stamped.id = item.id
                  )
                ORDER BY item.lane_seq ASC
                LIMIT 1
              ),
              LEAST(${conversationImportedBound}, counter.next_seq - 1)
            )
          ) AS target_consumed_seq
        FROM hosted_mailbox_lane_counter AS counter
        WHERE ${shouldHandleConversation}
          AND counter.user_id = ${userId}
          AND counter.lane = 'conversation'
      ),
      advanced_conversation AS (
        UPDATE hosted_mailbox_lane_counter AS counter
        SET consumed_seq = progress.target_consumed_seq,
            updated_at = NOW()
        FROM conversation_progress AS progress
        WHERE counter.user_id = progress.user_id
          AND counter.lane = progress.lane
          AND counter.consumed_seq < progress.target_consumed_seq
        RETURNING counter.consumed_seq
      ),
      advanced_system AS (
        UPDATE hosted_mailbox_lane_counter AS counter
        SET consumed_seq = LEAST(${systemHandledBound}, counter.next_seq - 1),
            updated_at = NOW()
        WHERE ${systemHandledThroughSeq !== null}
          AND counter.user_id = ${userId}
          AND counter.lane = 'system'
          AND counter.consumed_seq < LEAST(${systemHandledBound}, counter.next_seq - 1)
        RETURNING counter.consumed_seq
      ),
      conversation_ahead AS (
        SELECT ${shouldObserveConversationAhead}
          AND EXISTS (
            SELECT 1
            FROM hosted_mailbox_item AS item
            WHERE item.user_id = ${userId}
              AND item.lane = 'conversation'
              AND item.lane_seq > ${conversationImportedBound}
              AND item.created_at >= ${observationRetentionCutoff}
              AND (item.expires_at IS NULL OR item.expires_at > ${observedAt})
          ) AS value
      )
      SELECT
        conversation_ahead.value AS "conversationInputAhead"
      FROM conversation_ahead
      CROSS JOIN (
        SELECT COUNT(*) FROM stamped_conversation
      ) AS stamped_count
      CROSS JOIN (
        SELECT COUNT(*) FROM advanced_conversation
      ) AS conversation_count
      CROSS JOIN (
        SELECT COUNT(*) FROM advanced_system
      ) AS system_count
    `);
    if (mailboxRows.length !== 1 || !mailboxRows[0]) {
      throw new Error(
        "Hosted workspace checkpoint mailbox mutation returned an invalid row count.",
      );
    }
    if (mailboxRows[0].conversationInputAhead) {
      conversationInputAhead = true;
    }
  }

  const { replacedSnapshotRef: replacedSnapshotRefValue, ...updatedWorkspace } = updatedRows[0];
  const replacedSnapshotRef = parseHostedExecutionSnapshotRef(
    replacedSnapshotRefValue,
    "Hosted workspace checkpoint replaced snapshotRef",
  );

  return {
    ...(conversationInputAhead === true ? { conversationInputAhead } : {}),
    replacedSnapshotRef,
    status: "updated",
    workspace: projectHostedWorkspace(updatedWorkspace),
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

function readCheckpointRedactedConversationImportedSeq(
  redactedStatusJson: Record<string, unknown> | null | undefined,
): string | null {
  if (!redactedStatusJson || typeof redactedStatusJson !== "object" || Array.isArray(redactedStatusJson)) {
    return null;
  }
  const value = redactedStatusJson["hostedMailboxConversationImportedSeq"];
  return typeof value === "string" && /^\d+$/u.test(value) ? value : null;
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

function sanitizeHostedRuntimeRedactedJson(
  value: Record<string, unknown> | null | undefined,
  label: string,
  reservedKeys?: ReadonlySet<string>,
): HostedRuntimeRedactedJson | null {
  const parsed = parseHostedRuntimeRedactedJson(value, label, reservedKeys);
  return parsed && Object.keys(parsed).length > 0 ? parsed : null;
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
