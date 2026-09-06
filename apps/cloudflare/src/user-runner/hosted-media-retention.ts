import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import type {
  R2BucketLike,
} from "../bundle-store.ts";
import {
  hostedMediaObjectKey,
  hostedMediaUserPrefix,
} from "../storage-paths.ts";
import type {
  RunnerStateStore,
} from "./runner-state-store.ts";
import type {
  DurableObjectSqlValue,
  DurableObjectStateLike,
} from "./types.ts";

const HOSTED_MEDIA_RETENTION_BATCH_SIZE = 50;
const HOSTED_MEDIA_ID_PATTERN = /^[a-f0-9]{64}$/u;
const HOSTED_MEDIA_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

type HostedMediaRetentionStateStore = Pick<
  RunnerStateStore,
  "bindUser" | "validateWriteFenceToken"
>;

interface HostedMediaAssetRow extends Record<string, DurableObjectSqlValue> {
  byte_size: number;
  expires_at: string | null;
  retired_at: string | null;
  purged_at: string | null;
  revision: number;
  media_id: string;
  media_kind: string;
  object_key: string;
  sha256: string;
  updated_at: string;
  user_id: string;
}

export interface HostedMediaAssetDescriptor {
  byteSize: number;
  expiresAt?: string | null;
  mediaId: string;
  mediaKind: "image" | "video";
  sha256: string;
  userId: string;
}

export interface HostedMediaAssetRegistrationInput
  extends HostedMediaAssetDescriptor {
  attemptId: string;
  leaseGeneration: string;
}

export interface HostedMediaAssetDeletionInput {
  attemptId: string;
  leaseGeneration: string;
  mediaId: string;
  userId: string;
}

export interface HostedMediaAssetReadAdmissionResult {
  ok: boolean;
  reason:
    | "active"
    | "descriptor_mismatch"
    | "expired"
    | "unregistered";
}

export interface HostedMediaRetentionCleanupResult {
  deletedMediaCount: number;
  expiredMediaCount: number;
  nextAlarmAt: string | null;
}

export interface HostedMediaRetentionService {
  admitRead(
    input: HostedMediaAssetDescriptor,
  ): Promise<HostedMediaAssetReadAdmissionResult>;
  cleanupExpired(userId: string): Promise<HostedMediaRetentionCleanupResult>;
  delete(input: HostedMediaAssetDeletionInput): Promise<boolean>;
  record(input: HostedMediaAssetRegistrationInput): Promise<boolean>;
}

export function createHostedMediaRetentionService(input: {
  bucket: R2BucketLike;
  state: DurableObjectStateLike;
  stateStore: HostedMediaRetentionStateStore;
}): HostedMediaRetentionService {
  return {
    async admitRead(readInput) {
      await input.stateStore.bindUser(readInput.userId);
      const descriptor = normalizeHostedMediaAssetDescriptor(readInput);
      const row = readHostedMediaAssetRow(input.state, descriptor.mediaId);
      if (!row) {
        return { ok: true, reason: "unregistered" };
      }
      if (
        row.user_id !== descriptor.userId
        || row.byte_size !== descriptor.byteSize
        || row.media_kind !== descriptor.mediaKind
        || row.sha256 !== descriptor.sha256
      ) {
        return { ok: false, reason: "descriptor_mismatch" };
      }
      if (row.retired_at !== null || hostedMediaAssetIsExpired(row, Date.now())) {
        await retireHostedMediaAsset({ ...input, mediaId: row.media_id, userId: descriptor.userId });
        return { ok: false, reason: "expired" };
      }
      return { ok: true, reason: "active" };
    },

    async cleanupExpired(userId) {
      const boundUserId = await input.stateStore.bindUser(userId);
      const nowMs = Date.now();
      const rows = input.state.storage.sql!.exec<HostedMediaAssetRow>(
        `SELECT
          media_id,
          user_id,
          media_kind,
          byte_size,
          sha256,
          expires_at,
          retired_at,
          purged_at,
          revision,
          object_key,
          updated_at
        FROM runner_hosted_media_asset
        WHERE user_id = ?
          AND expires_at IS NOT NULL
          AND purged_at IS NULL
          AND expires_at <= ?
        ORDER BY expires_at ASC, media_id ASC
        LIMIT ${HOSTED_MEDIA_RETENTION_BATCH_SIZE}`,
        boundUserId,
        new Date(nowMs).toISOString(),
      ).toArray();
      let deletedMediaCount = 0;
      for (const row of rows) {
        if (row.user_id !== boundUserId) {
          continue;
        }
        const deleted = await retireHostedMediaAsset({
          ...input, mediaId: row.media_id, userId: boundUserId,
        });
        if (deleted) deletedMediaCount += 1;
      }
      const nextAlarmAt = await scheduleNextHostedMediaRetentionAlarm({
        state: input.state,
        userId: boundUserId,
      });
      if (rows.length > 0 || nextAlarmAt) {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            deletedMediaCount,
            expiredMediaCount: rows.length,
            nextAlarmAt,
          },
          message: "Hosted media retention cleanup completed.",
          phase: "wake.running",
          userId: boundUserId,
        });
      }
      return {
        deletedMediaCount,
        expiredMediaCount: rows.length,
        nextAlarmAt,
      };
    },

    async delete(deleteInput) {
      const boundUserId = await input.stateStore.bindUser(deleteInput.userId);
      const validation = await input.stateStore.validateWriteFenceToken({
        attemptId: deleteInput.attemptId,
        generation: deleteInput.leaseGeneration,
        userId: boundUserId,
      });
      if (!validation.owns) {
        return false;
      }
      if (!HOSTED_MEDIA_ID_PATTERN.test(deleteInput.mediaId)) {
        return false;
      }
      await retireHostedMediaAsset({
        ...input, mediaId: deleteInput.mediaId, userId: boundUserId, explicit: true,
      });
      return true;
    },

    async record(recordInput) {
      const boundUserId = await input.stateStore.bindUser(recordInput.userId);
      const validation = await input.stateStore.validateWriteFenceToken({
        attemptId: recordInput.attemptId,
        generation: recordInput.leaseGeneration,
        userId: boundUserId,
      });
      if (!validation.owns) {
        return false;
      }

      const descriptor = normalizeHostedMediaAssetDescriptor({
        ...recordInput,
        userId: boundUserId,
      });
      const objectKey = await hostedMediaObjectKey({
        mediaId: descriptor.mediaId,
        userId: boundUserId,
      });
      const existing = readHostedMediaAssetRow(input.state, descriptor.mediaId);
      if (existing && existing.user_id !== boundUserId) {
        throw new Error("Hosted media asset row belongs to another user.");
      }
      if (existing?.retired_at) {
        // A late PUT may have recreated ciphertext. Keep the identity retired and
        // re-arm physical cleanup; metadata-only preservation must never succeed.
        input.state.storage.sql!.exec(
          "UPDATE runner_hosted_media_asset SET purged_at = NULL, revision = revision + 1 WHERE media_id = ?",
          descriptor.mediaId,
        );
        await setHostedMediaRetentionAlarmIfEarlier(input.state, Date.now());
        return false;
      }
      const expiresAt = resolveHostedMediaAssetExpiresAt({
        candidate: descriptor.expiresAt ?? null,
        existing: existing?.expires_at ?? null,
      });
      input.state.storage.sql!.exec(
        `INSERT INTO runner_hosted_media_asset (
          media_id,
          user_id,
          media_kind,
          byte_size,
          sha256,
          expires_at,
          object_key,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(media_id) DO UPDATE SET
          user_id = excluded.user_id,
          media_kind = excluded.media_kind,
          byte_size = excluded.byte_size,
          sha256 = excluded.sha256,
          expires_at = excluded.expires_at,
          object_key = excluded.object_key,
          updated_at = excluded.updated_at,
          revision = runner_hosted_media_asset.revision + 1`,
        descriptor.mediaId,
        boundUserId,
        descriptor.mediaKind,
        descriptor.byteSize,
        descriptor.sha256,
        expiresAt,
        objectKey,
        new Date().toISOString(),
      );
      if (expiresAt) {
        await scheduleHostedMediaRetentionAlarmIfEarlier({
          expiresAt,
          state: input.state,
        });
      }
      return true;
    },
  };
}

export async function readHostedMediaRetentionNextAlarmAt(input: {
  state: DurableObjectStateLike;
  userId: string;
}): Promise<number | null> {
  const row = input.state.storage.sql!.exec<{ expires_at: string }>(
    `SELECT expires_at
     FROM runner_hosted_media_asset
     WHERE user_id = ?
       AND expires_at IS NOT NULL
       AND purged_at IS NULL
     ORDER BY expires_at ASC
     LIMIT 1`,
    input.userId,
  ).toArray()[0] ?? null;
  if (!row) {
    return null;
  }
  const expiresAtMs = Date.parse(row.expires_at);
  return Number.isFinite(expiresAtMs) ? expiresAtMs : null;
}

async function scheduleNextHostedMediaRetentionAlarm(input: {
  state: DurableObjectStateLike;
  userId: string;
}): Promise<string | null> {
  const nextAtMs = await readHostedMediaRetentionNextAlarmAt(input);
  if (nextAtMs === null) {
    return null;
  }
  await setHostedMediaRetentionAlarmIfEarlier(input.state, nextAtMs);
  return new Date(nextAtMs).toISOString();
}

async function scheduleHostedMediaRetentionAlarmIfEarlier(input: {
  expiresAt: string;
  state: DurableObjectStateLike;
}): Promise<void> {
  const expiresAtMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return;
  }
  await setHostedMediaRetentionAlarmIfEarlier(input.state, expiresAtMs);
}

async function setHostedMediaRetentionAlarmIfEarlier(
  state: DurableObjectStateLike,
  nextAtMs: number,
): Promise<void> {
  const currentAlarm = await state.storage.getAlarm();
  if (currentAlarm !== null && currentAlarm <= nextAtMs) {
    return;
  }
  await state.storage.setAlarm(nextAtMs);
}

function readHostedMediaAssetRow(
  state: DurableObjectStateLike,
  mediaId: string,
): HostedMediaAssetRow | null {
  if (!HOSTED_MEDIA_ID_PATTERN.test(mediaId)) {
    return null;
  }
  return state.storage.sql!.exec<HostedMediaAssetRow>(
    `SELECT
      media_id,
      user_id,
      media_kind,
      byte_size,
      sha256,
      expires_at,
      retired_at,
      purged_at,
      revision,
      object_key,
      updated_at
    FROM runner_hosted_media_asset
    WHERE media_id = ?`,
    mediaId,
  ).toArray()[0] ?? null;
}

async function deleteHostedMediaAssetObjectIfOwned(input: {
  bucket: R2BucketLike;
  row: HostedMediaAssetRow;
  userId: string;
}): Promise<boolean> {
  if (!input.bucket.delete) {
    return false;
  }
  const expectedPrefix = await hostedMediaUserPrefix({
    userId: input.userId,
  });
  if (!input.row.object_key.startsWith(expectedPrefix)) {
    return false;
  }
  await input.bucket.delete(input.row.object_key);
  return true;
}

// SQL executes synchronously in the existing Durable Object. This is the
// irreversible retirement boundary; no network call may precede the claim.
async function retireHostedMediaAsset(input: {
  bucket: R2BucketLike;
  state: DurableObjectStateLike;
  mediaId: string;
  userId: string;
  explicit?: boolean;
}): Promise<boolean> {
  const now = new Date().toISOString();
  input.state.storage.sql!.exec(
    `UPDATE runner_hosted_media_asset
     SET retired_at = ?, expires_at = CASE WHEN expires_at IS NULL OR expires_at > ? THEN ? ELSE expires_at END
     WHERE media_id = ? AND user_id = ? AND retired_at IS NULL
       AND (? = 1 OR expires_at <= ?)`,
    now, now, now, input.mediaId, input.userId, input.explicit ? 1 : 0, now,
  );
  const row = readHostedMediaAssetRow(input.state, input.mediaId);
  if (!row || row.retired_at === null || row.purged_at !== null) return false;
  try {
    const deleted = await deleteHostedMediaAssetObjectIfOwned({ ...input, row });
    if (!deleted) throw new Error("Hosted media object deletion is unavailable.");
    input.state.storage.sql!.exec(
      "UPDATE runner_hosted_media_asset SET purged_at = ? WHERE media_id = ? AND retired_at = ? AND revision = ?",
      now, row.media_id, row.retired_at, row.revision,
    );
    return true;
  } catch (error) {
    // Preserve the durable deletion obligation even after platform alarm retries.
    await setHostedMediaRetentionAlarmIfEarlier(input.state, Date.now() + 60_000);
    throw error;
  }
}

function hostedMediaAssetIsExpired(
  row: HostedMediaAssetRow,
  nowMs: number,
): boolean {
  return row.expires_at !== null
    && Number.isFinite(Date.parse(row.expires_at))
    && Date.parse(row.expires_at) <= nowMs;
}

function normalizeHostedMediaAssetDescriptor(
  input: HostedMediaAssetDescriptor,
): Required<HostedMediaAssetDescriptor> {
  if (!HOSTED_MEDIA_ID_PATTERN.test(input.mediaId)) {
    throw new TypeError("Hosted media id is invalid.");
  }
  if (!HOSTED_MEDIA_SHA256_PATTERN.test(input.sha256)) {
    throw new TypeError("Hosted media sha256 is invalid.");
  }
  if (input.mediaKind !== "image" && input.mediaKind !== "video") {
    throw new TypeError("Hosted media kind is invalid.");
  }
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 0) {
    throw new TypeError("Hosted media byte size is invalid.");
  }
  if (typeof input.userId !== "string" || input.userId.trim().length === 0) {
    throw new TypeError("Hosted media user id is required.");
  }
  return {
    byteSize: input.byteSize,
    expiresAt: normalizeHostedMediaAssetExpiresAt(input.expiresAt ?? null),
    mediaId: input.mediaId,
    mediaKind: input.mediaKind,
    sha256: input.sha256,
    userId: input.userId,
  };
}

function normalizeHostedMediaAssetExpiresAt(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const expiresAtMs = Date.parse(value);
  if (!Number.isFinite(expiresAtMs)) {
    throw new TypeError("Hosted media expiresAt is invalid.");
  }
  return new Date(expiresAtMs).toISOString();
}

function resolveHostedMediaAssetExpiresAt(input: {
  candidate: string | null;
  existing: string | null;
}): string | null {
  if (input.candidate === null) {
    return null;
  }
  if (input.existing === null) {
    return input.candidate;
  }
  return Date.parse(input.existing) <= Date.parse(input.candidate)
    ? input.existing
    : input.candidate;
}
