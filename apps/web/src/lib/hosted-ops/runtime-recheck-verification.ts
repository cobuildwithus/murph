import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { HOSTED_MAILBOX_RETENTION_MS } from "../hosted-mailbox/store";
import { readHostedAppSessionHmacKey } from "../hosted-onboarding/app-session-config";
import { readActiveHostedMemberAccessIds } from "../hosted-onboarding/member-access";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";

const HOSTED_RUNTIME_RECOVERY_MAX_BATCH = 3;
const HOSTED_RUNTIME_RECOVERY_WITNESS_CONTEXT =
  "hosted-runtime-recovery-witness:v1";
const HOSTED_RUNTIME_MEMBER_ID_MAX_LENGTH = 128;
const HOSTED_RUNTIME_MEMBER_ID_PATTERN = /^hbm_[A-Za-z0-9_-]+$/u;
const SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;
const SIGNED_SEQUENCE_PATTERN = /^(0|[1-9][0-9]{0,18})$/u;
const WITNESS_INTEGRITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface HostedRuntimeRecoveryWitness {
  allocatedSystemHighWater: string | null;
  canonicalSystemConsumed: string | null;
  capturedHeadSequence: string | null;
  checkpointedAt: string | null;
  importedSystemSequence: string | null;
  integrity: string;
  observedAt: string;
  userId: string;
  workspaceVersion: string | null;
}

export type HostedRuntimeRecoveryVerificationStatus =
  | "checkpoint_advanced"
  | "progressing"
  | "recovered"
  | "requested"
  | "unknown";

export interface HostedRuntimeRecoveryVerificationUserResult {
  explanation: string;
  status: HostedRuntimeRecoveryVerificationStatus;
  userId: string | null;
}

export interface HostedRuntimeRecoveryVerificationResult {
  generatedAt: string;
  results: HostedRuntimeRecoveryVerificationUserResult[];
}

export interface HostedRuntimeRecoveryCurrentState {
  activeAccess: boolean;
  allocatedSystemHighWater: string | null;
  canonicalSystemConsumed: string | null;
  checkpointedAt: string | null;
  observedAt: string;
  pendingHeadSequence: string | null;
  userId: string;
  workspaceVersion: string | null;
}

export interface HostedRuntimeRecoveryFactRow {
  allocatedSystemHighWater: bigint | null;
  canonicalSystemConsumed: bigint | null;
  checkpointedAt: Date | null;
  pendingHeadSequence: bigint | null;
  redactedStatusJson: Prisma.JsonValue | null;
  userId: string;
  workspaceVersion: bigint | null;
}

interface HostedRuntimeRecoveryFactReadClient {
  $queryRaw(
    query: Prisma.Sql,
  ): PromiseLike<HostedRuntimeRecoveryFactRow[]>;
}

type ReadHostedRuntimeRecoveryFacts = (input: {
  now: Date;
  prisma?: HostedRuntimeRecoveryFactReadClient;
  userIds: readonly string[];
}) => Promise<HostedRuntimeRecoveryFactRow[]>;

type ReadHostedRuntimeRecoveryCurrentStates = (input: {
  now: Date;
  prisma?: PrismaClient;
  witnesses: readonly HostedRuntimeRecoveryWitness[];
}) => Promise<HostedRuntimeRecoveryCurrentState[]>;

export async function captureHostedRuntimeRecoveryWitnesses(input: {
  environment?: NodeJS.ProcessEnv;
  now: Date;
  prisma?: PrismaClient;
  readFacts?: ReadHostedRuntimeRecoveryFacts;
  userIds: readonly string[];
}): Promise<Map<string, HostedRuntimeRecoveryWitness>> {
  const rows = input.readFacts
    ? await input.readFacts({
        now: input.now,
        prisma: input.prisma,
        userIds: input.userIds,
      })
    : await readHostedRuntimeRecoveryFacts({
        now: input.now,
        prisma: input.prisma ?? getPrisma(),
        userIds: input.userIds,
      });
  const rowsByUserId = groupRecoveryFactRows(rows);
  const witnesses = new Map<string, HostedRuntimeRecoveryWitness>();

  for (const userId of input.userIds) {
    const matchingRows = rowsByUserId.get(userId) ?? [];
    const unsigned = matchingRows.length === 1
      ? projectUnsignedRecoveryWitness(matchingRows[0]!, input.now)
      : emptyUnsignedRecoveryWitness(userId, input.now);
    witnesses.set(userId, signHostedRuntimeRecoveryWitness(
      unsigned,
      input.environment,
    ));
  }

  return witnesses;
}

export async function verifyHostedRuntimeRecoveryWitnesses(input: {
  baselines: readonly unknown[];
  environment?: NodeJS.ProcessEnv;
  now?: Date;
  prisma?: PrismaClient;
  readCurrentStates?: ReadHostedRuntimeRecoveryCurrentStates;
}): Promise<HostedRuntimeRecoveryVerificationResult> {
  if (
    input.baselines.length === 0
    || input.baselines.length > HOSTED_RUNTIME_RECOVERY_MAX_BATCH
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_RUNTIME_RECOVERY_WITNESSES_INVALID",
      httpStatus: 400,
      message: "Runtime recovery verification requires one to three witnesses.",
    });
  }

  const now = input.now ?? new Date();
  const parsed = input.baselines.map((baseline) =>
    parseHostedRuntimeRecoveryWitness(baseline, input.environment)
  );
  const duplicateUserIds = findDuplicateWitnessUserIds(parsed);
  const validWitnesses = parsed.flatMap((entry) => (
    entry.witness !== null && !duplicateUserIds.has(entry.witness.userId)
      ? [entry.witness]
      : []
  ));
  const currentStates = validWitnesses.length === 0
    ? []
    : input.readCurrentStates
      ? await input.readCurrentStates({
          now,
          prisma: input.prisma,
          witnesses: validWitnesses,
        })
      : await readHostedRuntimeRecoveryCurrentStates({
          now,
          prisma: input.prisma ?? getPrisma(),
          witnesses: validWitnesses,
        });
  const currentStatesByUserId = new Map(
    currentStates.map((state) => [state.userId, state]),
  );
  const emittedUserIds = new Set<string>();
  const results: HostedRuntimeRecoveryVerificationUserResult[] = [];

  for (const entry of parsed) {
    const userId = entry.userId;
    if (userId !== null && emittedUserIds.has(userId)) {
      continue;
    }
    if (userId !== null) {
      emittedUserIds.add(userId);
    }

    if (
      entry.witness === null
      || duplicateUserIds.has(entry.witness.userId)
    ) {
      results.push(verificationResult("unknown", userId));
      continue;
    }

    const current = currentStatesByUserId.get(entry.witness.userId);
    results.push(verificationResult(
      classifyHostedRuntimeRecoveryWitness({
        baseline: entry.witness,
        current: current ?? null,
        now,
      }),
      entry.witness.userId,
    ));
  }

  return {
    generatedAt: now.toISOString(),
    results,
  };
}

export function classifyHostedRuntimeRecoveryWitness(input: {
  baseline: HostedRuntimeRecoveryWitness | null;
  current: HostedRuntimeRecoveryCurrentState | null;
  now: Date;
}): HostedRuntimeRecoveryVerificationStatus {
  const { baseline, current, now } = input;
  if (
    baseline === null
    || current === null
    || !isComparableRecoveryEvidence(baseline, current, now)
  ) {
    return "unknown";
  }

  const recovery = recoveryComparison(baseline, current);
  if (hasRecoveryRegression(recovery)) {
    return "unknown";
  }
  if (!preservesUnconsumedCapturedHead(baseline, current, recovery)) {
    return "unknown";
  }

  const versionAdvanced = recovery.currentVersion > recovery.baselineVersion;
  const checkpointAdvanced =
    recovery.currentCheckpoint > recovery.baselineCheckpoint;
  const consumedAdvanced =
    recovery.currentConsumed > recovery.baselineConsumed;
  const newerCheckpointPair = versionAdvanced && checkpointAdvanced;

  if (checkpointAdvanced && !versionAdvanced) {
    return "unknown";
  }
  if (consumedAdvanced && !newerCheckpointPair) {
    return "unknown";
  }
  if (
    newerCheckpointPair
    && recovery.currentConsumed >= recovery.importedTarget
  ) {
    return "recovered";
  }
  if (
    newerCheckpointPair
    && recovery.currentConsumed >= recovery.capturedHeadSequence
  ) {
    return "progressing";
  }
  if (newerCheckpointPair) {
    return "checkpoint_advanced";
  }
  if (!checkpointAdvanced && !consumedAdvanced) {
    return "requested";
  }

  return "unknown";
}

interface HostedRuntimeRecoveryComparison {
  baselineCheckpoint: number;
  baselineConsumed: bigint;
  baselineHighWater: bigint;
  baselineVersion: bigint;
  capturedHeadSequence: bigint;
  currentCheckpoint: number;
  currentConsumed: bigint;
  currentHighWater: bigint;
  currentVersion: bigint;
  importedTarget: bigint;
}

function isComparableRecoveryEvidence(
  baseline: HostedRuntimeRecoveryWitness,
  current: HostedRuntimeRecoveryCurrentState,
  now: Date,
): boolean {
  if (!current.activeAccess || baseline.userId !== current.userId) {
    return false;
  }
  if (
    !isValidBaselineWitness(baseline, now)
    || !isValidCurrentRecoveryState(current, now)
  ) {
    return false;
  }
  return Date.parse(current.observedAt) >= Date.parse(baseline.observedAt);
}

function recoveryComparison(
  baseline: HostedRuntimeRecoveryWitness,
  current: HostedRuntimeRecoveryCurrentState,
): HostedRuntimeRecoveryComparison {
  return {
    baselineCheckpoint: Date.parse(baseline.checkpointedAt!),
    baselineConsumed: BigInt(baseline.canonicalSystemConsumed!),
    baselineHighWater: BigInt(baseline.allocatedSystemHighWater!),
    baselineVersion: BigInt(baseline.workspaceVersion!),
    capturedHeadSequence: BigInt(baseline.capturedHeadSequence!),
    currentCheckpoint: Date.parse(current.checkpointedAt!),
    currentConsumed: BigInt(current.canonicalSystemConsumed!),
    currentHighWater: BigInt(current.allocatedSystemHighWater!),
    currentVersion: BigInt(current.workspaceVersion!),
    importedTarget: BigInt(baseline.importedSystemSequence!),
  };
}

function hasRecoveryRegression(
  comparison: HostedRuntimeRecoveryComparison,
): boolean {
  return comparison.currentVersion < comparison.baselineVersion
    || comparison.currentCheckpoint < comparison.baselineCheckpoint
    || comparison.currentConsumed < comparison.baselineConsumed
    || comparison.currentHighWater < comparison.baselineHighWater;
}

function preservesUnconsumedCapturedHead(
  baseline: HostedRuntimeRecoveryWitness,
  current: HostedRuntimeRecoveryCurrentState,
  comparison: HostedRuntimeRecoveryComparison,
): boolean {
  if (comparison.currentConsumed >= comparison.capturedHeadSequence) {
    return true;
  }
  return current.pendingHeadSequence === baseline.capturedHeadSequence;
}

export async function readHostedRuntimeRecoveryFacts(input: {
  now: Date;
  prisma?: HostedRuntimeRecoveryFactReadClient;
  userIds: readonly string[];
}): Promise<HostedRuntimeRecoveryFactRow[]> {
  if (input.userIds.length === 0 || input.userIds.length > HOSTED_RUNTIME_RECOVERY_MAX_BATCH) {
    throw new TypeError("Runtime recovery fact reads require one to three member ids.");
  }
  const prisma: HostedRuntimeRecoveryFactReadClient =
    input.prisma ?? getPrisma();
  const retainedAfter = new Date(
    input.now.getTime() - HOSTED_MAILBOX_RETENTION_MS,
  );
  const requestedRows = Prisma.join(input.userIds.map((userId, ordinal) =>
    Prisma.sql`(${userId}::text, ${ordinal}::integer)`
  ));

  return await prisma.$queryRaw(Prisma.sql`
    WITH requested(user_id, ordinal) AS (
      VALUES ${requestedRows}
    )
    SELECT
      requested.user_id AS "userId",
      workspace.version AS "workspaceVersion",
      workspace.checkpointed_at AS "checkpointedAt",
      workspace.redacted_status_json AS "redactedStatusJson",
      lane_counter.consumed_seq AS "canonicalSystemConsumed",
      lane_counter.next_seq - 1::bigint AS "allocatedSystemHighWater",
      pending_head.lane_seq AS "pendingHeadSequence"
    FROM requested
    LEFT JOIN hosted_workspace AS workspace
      ON workspace.user_id = requested.user_id
    LEFT JOIN hosted_mailbox_lane_counter AS lane_counter
      ON lane_counter.user_id = requested.user_id
      AND lane_counter.lane = 'system'
    LEFT JOIN LATERAL (
      SELECT mailbox_item.lane_seq
      FROM hosted_mailbox_item AS mailbox_item
      WHERE mailbox_item.user_id = requested.user_id
        AND mailbox_item.lane = 'system'
        AND mailbox_item.lane_seq > lane_counter.consumed_seq
        AND mailbox_item.created_at > ${retainedAfter}
        AND mailbox_item.created_at <= ${input.now}
        AND (
          mailbox_item.expires_at IS NULL
          OR mailbox_item.expires_at > ${input.now}
        )
      ORDER BY mailbox_item.lane_seq ASC
      LIMIT 1
    ) AS pending_head ON TRUE
    ORDER BY requested.ordinal ASC
  `);
}

async function readHostedRuntimeRecoveryCurrentStates(input: {
  now: Date;
  prisma: PrismaClient;
  witnesses: readonly HostedRuntimeRecoveryWitness[];
}): Promise<HostedRuntimeRecoveryCurrentState[]> {
  return await input.prisma.$transaction(async (tx) => {
    const userIds = input.witnesses.map((witness) => witness.userId);
    const activeUserIds = await readActiveHostedMemberAccessIds({
      memberIds: userIds,
      now: input.now,
      prisma: tx,
    });
    const rows = await readHostedRuntimeRecoveryFacts({
      now: input.now,
      prisma: tx,
      userIds,
    });
    const rowsByUserId = groupRecoveryFactRows(rows);

    return input.witnesses.map((witness) => {
      const matchingRows = rowsByUserId.get(witness.userId) ?? [];
      const snapshot = matchingRows.length === 1
        ? projectCurrentRecoverySnapshot(matchingRows[0]!)
        : emptyCurrentRecoverySnapshot();
      return {
        activeAccess: activeUserIds.has(witness.userId),
        ...snapshot,
        observedAt: input.now.toISOString(),
        userId: witness.userId,
      };
    });
  }, {
    timeout: 5_000,
  });
}

function projectUnsignedRecoveryWitness(
  row: HostedRuntimeRecoveryFactRow,
  observedAt: Date,
): Omit<HostedRuntimeRecoveryWitness, "integrity"> {
  return {
    allocatedSystemHighWater:
      row.allocatedSystemHighWater?.toString() ?? null,
    canonicalSystemConsumed: row.canonicalSystemConsumed?.toString() ?? null,
    capturedHeadSequence: row.pendingHeadSequence?.toString() ?? null,
    checkpointedAt: row.checkpointedAt?.toISOString() ?? null,
    importedSystemSequence: readImportedSystemSequence(
      row.redactedStatusJson,
    ),
    observedAt: observedAt.toISOString(),
    userId: row.userId,
    workspaceVersion: row.workspaceVersion?.toString() ?? null,
  };
}

function emptyUnsignedRecoveryWitness(
  userId: string,
  observedAt: Date,
): Omit<HostedRuntimeRecoveryWitness, "integrity"> {
  return {
    allocatedSystemHighWater: null,
    canonicalSystemConsumed: null,
    capturedHeadSequence: null,
    checkpointedAt: null,
    importedSystemSequence: null,
    observedAt: observedAt.toISOString(),
    userId,
    workspaceVersion: null,
  };
}

function projectCurrentRecoverySnapshot(row: HostedRuntimeRecoveryFactRow): Omit<
  HostedRuntimeRecoveryCurrentState,
  "activeAccess" | "observedAt" | "userId"
> {
  return {
    allocatedSystemHighWater:
      row.allocatedSystemHighWater?.toString() ?? null,
    canonicalSystemConsumed: row.canonicalSystemConsumed?.toString() ?? null,
    checkpointedAt: row.checkpointedAt?.toISOString() ?? null,
    pendingHeadSequence: row.pendingHeadSequence?.toString() ?? null,
    workspaceVersion: row.workspaceVersion?.toString() ?? null,
  };
}

function emptyCurrentRecoverySnapshot(): Omit<
  HostedRuntimeRecoveryCurrentState,
  "activeAccess" | "observedAt" | "userId"
> {
  return {
    allocatedSystemHighWater: null,
    canonicalSystemConsumed: null,
    checkpointedAt: null,
    pendingHeadSequence: null,
    workspaceVersion: null,
  };
}

function readImportedSystemSequence(
  redactedStatusJson: Prisma.JsonValue | null,
): string | null {
  if (!isRecord(redactedStatusJson)) {
    return null;
  }
  const value = redactedStatusJson.hostedMailboxSystemImportedSeq;
  return isCanonicalSequence(value) ? value : null;
}

function signHostedRuntimeRecoveryWitness(
  witness: Omit<HostedRuntimeRecoveryWitness, "integrity">,
  environment?: NodeJS.ProcessEnv,
): HostedRuntimeRecoveryWitness {
  const integrity = createHmac(
    "sha256",
    readHostedAppSessionHmacKey(environment),
  )
    .update(JSON.stringify([
      HOSTED_RUNTIME_RECOVERY_WITNESS_CONTEXT,
      witness,
    ]), "utf8")
    .digest("base64url");
  return { ...witness, integrity };
}

function parseHostedRuntimeRecoveryWitness(
  value: unknown,
  environment?: NodeJS.ProcessEnv,
): {
  userId: string | null;
  witness: HostedRuntimeRecoveryWitness | null;
} {
  if (!isRecord(value)) {
    return { userId: null, witness: null };
  }
  const userId = isHostedRuntimeRecoveryMemberId(value.userId)
    ? value.userId
    : null;
  if (
    userId === null
    || !hasExactKeys(value, [
      "allocatedSystemHighWater",
      "canonicalSystemConsumed",
      "capturedHeadSequence",
      "checkpointedAt",
      "importedSystemSequence",
      "integrity",
      "observedAt",
      "userId",
      "workspaceVersion",
    ])
  ) {
    return { userId, witness: null };
  }

  const allocatedSystemHighWater = parseNullableSequence(
    value.allocatedSystemHighWater,
  );
  const canonicalSystemConsumed = parseNullableSequence(
    value.canonicalSystemConsumed,
  );
  const capturedHeadSequence = parseNullableSequence(
    value.capturedHeadSequence,
  );
  const checkpointedAt = parseNullableTimestamp(value.checkpointedAt);
  const importedSystemSequence = parseNullableSequence(
    value.importedSystemSequence,
  );
  const observedAt = parseTimestamp(value.observedAt);
  const workspaceVersion = parseNullableSequence(value.workspaceVersion);
  const integrity = value.integrity;
  if (
    allocatedSystemHighWater === undefined
    || canonicalSystemConsumed === undefined
    || capturedHeadSequence === undefined
    || checkpointedAt === undefined
    || importedSystemSequence === undefined
    || observedAt === null
    || workspaceVersion === undefined
    || typeof integrity !== "string"
    || !WITNESS_INTEGRITY_PATTERN.test(integrity)
  ) {
    return { userId, witness: null };
  }

  const witness: HostedRuntimeRecoveryWitness = {
    allocatedSystemHighWater,
    canonicalSystemConsumed,
    capturedHeadSequence,
    checkpointedAt,
    importedSystemSequence,
    integrity,
    observedAt,
    userId,
    workspaceVersion,
  };
  const expected = signHostedRuntimeRecoveryWitness(
    omitWitnessIntegrity(witness),
    environment,
  ).integrity;
  const actualBytes = Buffer.from(integrity);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.length !== expectedBytes.length
    || !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    return { userId, witness: null };
  }

  return { userId, witness };
}

function omitWitnessIntegrity(
  witness: HostedRuntimeRecoveryWitness,
): Omit<HostedRuntimeRecoveryWitness, "integrity"> {
  return {
    allocatedSystemHighWater: witness.allocatedSystemHighWater,
    canonicalSystemConsumed: witness.canonicalSystemConsumed,
    capturedHeadSequence: witness.capturedHeadSequence,
    checkpointedAt: witness.checkpointedAt,
    importedSystemSequence: witness.importedSystemSequence,
    observedAt: witness.observedAt,
    userId: witness.userId,
    workspaceVersion: witness.workspaceVersion,
  };
}

function isValidBaselineWitness(
  witness: HostedRuntimeRecoveryWitness,
  now: Date,
): boolean {
  if (
    !hasCanonicalBaselineSequences(witness)
    || !hasValidRecoveryTimestamps(witness, now)
  ) {
    return false;
  }
  return hasValidBaselineSequenceRange(witness);
}

function hasCanonicalBaselineSequences(
  witness: HostedRuntimeRecoveryWitness,
): boolean {
  return [
    witness.workspaceVersion,
    witness.importedSystemSequence,
    witness.canonicalSystemConsumed,
    witness.allocatedSystemHighWater,
    witness.capturedHeadSequence,
  ].every(isCanonicalSequence)
    && WITNESS_INTEGRITY_PATTERN.test(witness.integrity);
}

function hasValidRecoveryTimestamps(
  value: { checkpointedAt: string | null; observedAt: string },
  now: Date,
): boolean {
  const observedAt = parseTimestamp(value.observedAt);
  const checkpointedAt = parseNullableTimestamp(value.checkpointedAt);
  if (observedAt === null || checkpointedAt === null || checkpointedAt === undefined) {
    return false;
  }
  return Date.parse(observedAt) <= now.getTime()
    && Date.parse(checkpointedAt) <= Date.parse(observedAt);
}

function hasValidBaselineSequenceRange(
  witness: HostedRuntimeRecoveryWitness,
): boolean {
  const consumed = BigInt(witness.canonicalSystemConsumed!);
  const head = BigInt(witness.capturedHeadSequence!);
  const imported = BigInt(witness.importedSystemSequence!);
  const highWater = BigInt(witness.allocatedSystemHighWater!);
  return consumed < head && head <= imported && imported <= highWater;
}

function isValidCurrentRecoveryState(
  state: HostedRuntimeRecoveryCurrentState,
  now: Date,
): boolean {
  if (
    !hasCanonicalCurrentSequences(state)
    || !hasValidRecoveryTimestamps(state, now)
  ) {
    return false;
  }
  return hasValidCurrentSequenceRange(state);
}

function hasCanonicalCurrentSequences(
  state: HostedRuntimeRecoveryCurrentState,
): boolean {
  return [
    state.workspaceVersion,
    state.canonicalSystemConsumed,
    state.allocatedSystemHighWater,
  ].every(isCanonicalSequence);
}

function hasValidCurrentSequenceRange(
  state: HostedRuntimeRecoveryCurrentState,
): boolean {
  const consumed = BigInt(state.canonicalSystemConsumed!);
  const highWater = BigInt(state.allocatedSystemHighWater!);
  if (consumed > highWater) {
    return false;
  }
  return state.pendingHeadSequence === null
    || (
      isCanonicalSequence(state.pendingHeadSequence)
      && BigInt(state.pendingHeadSequence) > consumed
      && BigInt(state.pendingHeadSequence) <= highWater
    );
}

function parseNullableSequence(value: unknown): string | null | undefined {
  return value === null ? null : parseSequence(value) ?? undefined;
}

function parseSequence(value: unknown): string | null {
  return isCanonicalSequence(value) ? value : null;
}

function isCanonicalSequence(value: unknown): value is string {
  if (typeof value !== "string" || !SIGNED_SEQUENCE_PATTERN.test(value)) {
    return false;
  }
  return BigInt(value) <= SIGNED_BIGINT_MAX;
}

function parseNullableTimestamp(value: unknown): string | null | undefined {
  return value === null ? null : parseTimestamp(value) ?? undefined;
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
    ? value
    : null;
}

function findDuplicateWitnessUserIds(
  entries: readonly {
    userId: string | null;
    witness: HostedRuntimeRecoveryWitness | null;
  }[],
): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    if (entry.userId === null) {
      continue;
    }
    if (seen.has(entry.userId)) {
      duplicates.add(entry.userId);
    } else {
      seen.add(entry.userId);
    }
  }
  return duplicates;
}

function groupRecoveryFactRows(
  rows: readonly HostedRuntimeRecoveryFactRow[],
): Map<string, HostedRuntimeRecoveryFactRow[]> {
  const rowsByUserId = new Map<string, HostedRuntimeRecoveryFactRow[]>();
  for (const row of rows) {
    const existing = rowsByUserId.get(row.userId);
    if (existing) {
      existing.push(row);
    } else {
      rowsByUserId.set(row.userId, [row]);
    }
  }
  return rowsByUserId;
}

function verificationResult(
  status: HostedRuntimeRecoveryVerificationStatus,
  userId: string | null,
): HostedRuntimeRecoveryVerificationUserResult {
  return {
    explanation: recoveryVerificationExplanation(status),
    status,
    userId,
  };
}

function recoveryVerificationExplanation(
  status: HostedRuntimeRecoveryVerificationStatus,
): string {
  switch (status) {
    case "requested":
      return "The request was accepted, but canonical consumption and the checkpoint timestamp have not advanced.";
    case "checkpoint_advanced":
      return "A newer workspace version and checkpoint exist, but the captured head remains live and unconsumed.";
    case "progressing":
      return "Canonical consumption reached the captured head but remains below the fixed request-time imported target.";
    case "recovered":
      return "Canonical consumption reached the fixed captured prefix with a newer checkpoint. This does not prove global health or idleness.";
    case "unknown":
      return "The current canonical facts cannot safely verify this request-time witness.";
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

export function isHostedRuntimeRecoveryMemberId(
  value: unknown,
): value is string {
  return typeof value === "string"
    && value.length <= HOSTED_RUNTIME_MEMBER_ID_MAX_LENGTH
    && HOSTED_RUNTIME_MEMBER_ID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
