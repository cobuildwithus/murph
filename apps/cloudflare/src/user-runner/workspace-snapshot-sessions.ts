import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionBundleRef,
  HostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedWorkspaceReadResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  isHostedWorkspaceSnapshotV2Ref,
  parseHostedExecutionSnapshotRef,
  parseHostedWorkspaceSnapshotV2Ref,
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import { HostedBundleGarbageCollector } from "../bundle-gc.js";
import type { R2BucketLike } from "../bundle-store.js";
import {
  HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
  parseHostedWorkspaceSnapshotOrphanCandidate,
  parseHostedWorkspaceSnapshotUploadSession,
  type HostedWorkspaceSnapshotOrphanCandidate,
  type HostedWorkspaceSnapshotLegacyOrphanCandidate,
  type HostedWorkspaceSnapshotV2OrphanCandidate,
  type HostedWorkspaceSnapshotUploadSession,
} from "../workspace-snapshot-store.ts";
import type { RunnerStoreCache } from "./runner-store-cache.js";
import type { RunnerStateStore } from "./runner-state-store.js";
import type { DurableObjectStateLike } from "./types.js";
import { safeCleanupErrorCode } from "./diagnostics.js";
import { deleteR2ObjectIfSupported } from "./r2-delete.js";

export const WORKSPACE_SNAPSHOT_ORPHAN_CLEANUP_MIN_AGE_MS = 65 * 60_000;

type WorkspaceSnapshotSessionStateStore = Pick<RunnerStateStore, "bindUser">;

export interface WorkspaceSnapshotSessionService {
  cleanupOrphanCandidates(userId: string): Promise<void>;
  cleanupOrphanCandidatesBestEffort(userId: string): Promise<void>;
  create(input: HostedWorkspaceSnapshotUploadSession): Promise<HostedWorkspaceSnapshotUploadSession>;
  delete(input: {
    snapshotId: string;
    userId: string;
  }): Promise<{ deleted: boolean }>;
  read(input: {
    snapshotId: string;
    userId: string;
  }): Promise<HostedWorkspaceSnapshotUploadSession | null>;
  recordOrphanCandidate(
    input: HostedWorkspaceSnapshotOrphanCandidate,
  ): Promise<HostedWorkspaceSnapshotOrphanCandidate>;
  syncOrphanCandidateAlarm(userId: string): Promise<void>;
}

export function createWorkspaceSnapshotSessionService(input: {
  bucket: R2BucketLike;
  runnerStoreCache: Pick<RunnerStoreCache, "ensure">;
  state: DurableObjectStateLike;
  stateStore: WorkspaceSnapshotSessionStateStore;
  readHostedWorkspaceFromWeb(userId: string): Promise<HostedWorkspaceReadResponse>;
  assertWorkspaceBelongsToRunnerUser(workspace: HostedWorkspaceState | null, userId: string): void;
}): WorkspaceSnapshotSessionService {
  const service: WorkspaceSnapshotSessionService = {
    async create(sessionInput) {
      await input.stateStore.bindUser(sessionInput.userId);
      const session = parseHostedWorkspaceSnapshotUploadSession(sessionInput);
      if (session.userId !== sessionInput.userId) {
        throw new Error("Hosted workspace snapshot upload session user mismatch.");
      }
      const previousCurrent = await input.state.storage.get<unknown>(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
      );
      if (previousCurrent !== undefined) {
        const previousSession = parseHostedWorkspaceSnapshotUploadSession(previousCurrent);
        if (
          previousSession.userId === sessionInput.userId
          && previousSession.snapshotId !== session.snapshotId
        ) {
          const previousReplacedCandidate =
            buildWorkspaceSnapshotOrphanCandidateFromUploadSessionReplacedRef(previousSession);
          if (previousReplacedCandidate) {
            await service.recordOrphanCandidate(previousReplacedCandidate);
          }
          const orphanCandidate: HostedWorkspaceSnapshotOrphanCandidate = {
            createdAt: new Date().toISOString(),
            objectKey: previousSession.objectKey,
            schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
            snapshotId: previousSession.snapshotId,
            userId: previousSession.userId,
          };
          await service.recordOrphanCandidate(orphanCandidate);
        }
      }
      await input.state.storage.put(workspaceSnapshotUploadSessionCurrentStorageKey(), session);
      if (session.replacedSnapshotRef) {
        await service.syncOrphanCandidateAlarm(session.userId);
      }
      input.state.waitUntil(
        service.cleanupOrphanCandidatesBestEffort(sessionInput.userId),
      );
      return session;
    },

    async recordOrphanCandidate(candidateInput) {
      await input.stateStore.bindUser(candidateInput.userId);
      const candidate = parseHostedWorkspaceSnapshotOrphanCandidate(candidateInput);
      if (candidate.userId !== candidateInput.userId) {
        throw new Error("Hosted workspace snapshot orphan candidate user mismatch.");
      }
      await input.state.storage.put(
        workspaceSnapshotOrphanCandidateStorageKey(candidate.snapshotId),
        candidate,
      );
      await service.syncOrphanCandidateAlarm(candidate.userId);
      return candidate;
    },

    async cleanupOrphanCandidatesBestEffort(userId) {
      try {
        await service.cleanupOrphanCandidates(userId);
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            cleanupErrorCode: safeCleanupErrorCode(error),
            cleanupFailed: true,
          },
          level: "warn",
          message: "Hosted runner workspace snapshot orphan cleanup failed.",
          phase: "wake.running",
          userId,
        });
      }
    },

    async cleanupOrphanCandidates(userId) {
      if (!input.bucket.delete || !input.state.storage.list) {
        return;
      }
      await input.stateStore.bindUser(userId);
      const candidates = await input.state.storage.list<unknown>({
        prefix: workspaceSnapshotOrphanCandidateStoragePrefix(),
      });
      const nowMs = Date.now();
      const eligibleCandidates: Array<[string, HostedWorkspaceSnapshotOrphanCandidate]> = [];

      for (const [key, value] of candidates) {
        const candidate = await readHostedWorkspaceSnapshotOrphanCandidateForCleanup({
          key,
          state: input.state,
          userId,
          value,
        });
        if (!candidate) {
          continue;
        }
        if (candidate.userId !== userId) {
          continue;
        }
        const createdAtMs = Date.parse(candidate.createdAt);
        if (
          !Number.isFinite(createdAtMs)
          || nowMs - createdAtMs < WORKSPACE_SNAPSHOT_ORPHAN_CLEANUP_MIN_AGE_MS
        ) {
          continue;
        }
        eligibleCandidates.push([key, candidate]);
      }
      const currentSession = await readWorkspaceSnapshotUploadSessionForCleanup({
        state: input.state,
        userId,
      });
      const sessionReplacedCandidate = currentSession
        ? buildWorkspaceSnapshotOrphanCandidateFromUploadSessionReplacedRef(currentSession)
        : null;
      if (sessionReplacedCandidate) {
        const createdAtMs = Date.parse(sessionReplacedCandidate.createdAt);
        if (
          Number.isFinite(createdAtMs)
          && nowMs - createdAtMs >= WORKSPACE_SNAPSHOT_ORPHAN_CLEANUP_MIN_AGE_MS
        ) {
          eligibleCandidates.push([
            workspaceSnapshotUploadSessionCurrentStorageKey(),
            sessionReplacedCandidate,
          ]);
        }
      }
      if (eligibleCandidates.length === 0) {
        return;
      }

      const workspaceRead = await input.readHostedWorkspaceFromWeb(userId);
      input.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, userId);
      const currentObjectKey = readHostedWorkspaceV2SnapshotObjectKey(workspaceRead.workspace);
      const currentSnapshotRef = readHostedWorkspaceSnapshotRef(workspaceRead.workspace);
      const errors: unknown[] = [];

      for (const [key, candidate] of eligibleCandidates) {
        try {
          await cleanupWorkspaceSnapshotOrphanCandidate({
            bucket: input.bucket,
            candidate,
            currentObjectKey,
            currentSnapshotRef,
            key,
            runnerStoreCache: input.runnerStoreCache,
            state: input.state,
          });
        } catch (error) {
          errors.push(error);
        }
      }
      await service.syncOrphanCandidateAlarm(userId);
      if (errors.length > 0) {
        throw errors[0];
      }
    },

    async read(readInput) {
      await input.stateStore.bindUser(readInput.userId);
      const value = await input.state.storage.get<unknown>(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
      );
      if (value === undefined) {
        return null;
      }
      const session = parseHostedWorkspaceSnapshotUploadSession(value);
      if (session.userId !== readInput.userId) {
        throw new Error("Hosted workspace snapshot upload session is outside the bound user namespace.");
      }
      if (session.snapshotId !== readInput.snapshotId) {
        return null;
      }
      return session;
    },

    async delete(deleteInput) {
      await input.stateStore.bindUser(deleteInput.userId);
      const current = await input.state.storage.get<unknown>(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
      );
      if (current === undefined) {
        return { deleted: false };
      }
      const currentSession = parseHostedWorkspaceSnapshotUploadSession(current);
      if (
        currentSession.userId === deleteInput.userId
        && currentSession.snapshotId === deleteInput.snapshotId
      ) {
        return {
          deleted: await input.state.storage.delete(workspaceSnapshotUploadSessionCurrentStorageKey()),
        };
      }
      return { deleted: false };
    },

    async syncOrphanCandidateAlarm(userId) {
      await syncWorkspaceSnapshotOrphanCandidateAlarm({
        state: input.state,
        userId,
      });
    },
  };

  return service;
}

export async function readWorkspaceSnapshotOrphanCandidateNextAlarmAt(input: {
  state: DurableObjectStateLike;
  userId: string;
}): Promise<number | null> {
  if (!input.state.storage.list) {
    return null;
  }
  const candidates = await input.state.storage.list<unknown>({
    prefix: workspaceSnapshotOrphanCandidateStoragePrefix(),
  });
  let nextAtMs: number | null = null;
  const currentSession = await readWorkspaceSnapshotUploadSessionForCleanup({
    state: input.state,
    userId: input.userId,
  });
  const sessionReplacedCandidate = currentSession
    ? buildWorkspaceSnapshotOrphanCandidateFromUploadSessionReplacedRef(currentSession)
    : null;
  if (sessionReplacedCandidate) {
    nextAtMs = selectEarliestWorkspaceSnapshotCleanupAlarm(
      nextAtMs,
      sessionReplacedCandidate.createdAt,
    );
  }
  for (const value of candidates.values()) {
    let candidate: HostedWorkspaceSnapshotOrphanCandidate;
    try {
      candidate = parseHostedWorkspaceSnapshotOrphanCandidate(value);
    } catch {
      continue;
    }
    if (candidate.userId !== input.userId) {
      continue;
    }
    nextAtMs = selectEarliestWorkspaceSnapshotCleanupAlarm(nextAtMs, candidate.createdAt);
  }
  return nextAtMs;
}

async function readWorkspaceSnapshotUploadSessionForCleanup(input: {
  state: DurableObjectStateLike;
  userId: string;
}): Promise<HostedWorkspaceSnapshotUploadSession | null> {
  const value = await input.state.storage.get<unknown>(
    workspaceSnapshotUploadSessionCurrentStorageKey(),
  );
  if (value === undefined) {
    return null;
  }
  const session = parseHostedWorkspaceSnapshotUploadSession(value);
  return session.userId === input.userId ? session : null;
}

function buildWorkspaceSnapshotOrphanCandidateFromUploadSessionReplacedRef(
  session: HostedWorkspaceSnapshotUploadSession,
): HostedWorkspaceSnapshotOrphanCandidate | null {
  const replacedSnapshotRef = session.replacedSnapshotRef ?? null;
  if (!replacedSnapshotRef) {
    return null;
  }
  if (isHostedWorkspaceSnapshotV2Ref(replacedSnapshotRef)) {
    const aad = replacedSnapshotRef.encryption.aad;
    if (
      replacedSnapshotRef.userId !== session.userId ||
      aad.userId !== session.userId ||
      aad.snapshotId !== replacedSnapshotRef.snapshotId ||
      aad.objectKey !== replacedSnapshotRef.objectKey
    ) {
      return null;
    }
    return {
      createdAt: session.createdAt,
      objectKey: replacedSnapshotRef.objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId: replacedSnapshotRef.snapshotId,
      userId: session.userId,
    };
  }
  return {
    createdAt: session.createdAt,
    kind: "legacy_workspace_snapshot",
    schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
    snapshotId: `legacy-${session.snapshotId}`,
    snapshotRef: replacedSnapshotRef,
    userId: session.userId,
  };
}

function selectEarliestWorkspaceSnapshotCleanupAlarm(
  previous: number | null,
  createdAt: string,
): number | null {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return previous;
  }
  const eligibleAtMs = createdAtMs + WORKSPACE_SNAPSHOT_ORPHAN_CLEANUP_MIN_AGE_MS;
  return previous === null ? eligibleAtMs : Math.min(previous, eligibleAtMs);
}

async function syncWorkspaceSnapshotOrphanCandidateAlarm(input: {
  state: DurableObjectStateLike;
  userId: string;
}): Promise<void> {
  const nextAtMs = await readWorkspaceSnapshotOrphanCandidateNextAlarmAt(input);
  if (nextAtMs === null) {
    await input.state.storage.deleteAlarm?.();
    return;
  }
  const currentAlarm = await input.state.storage.getAlarm();
  if (currentAlarm !== null && currentAlarm <= nextAtMs) {
    return;
  }
  await input.state.storage.setAlarm(nextAtMs);
}

async function cleanupWorkspaceSnapshotOrphanCandidate(input: {
  bucket: R2BucketLike;
  candidate: HostedWorkspaceSnapshotOrphanCandidate;
  currentObjectKey: string | null;
  currentSnapshotRef: HostedExecutionSnapshotRef | null;
  key: string;
  runnerStoreCache: Pick<RunnerStoreCache, "ensure">;
  state: DurableObjectStateLike;
}): Promise<void> {
  const candidate = input.candidate;
  if (candidate.kind === "legacy_workspace_snapshot") {
    await cleanupLegacyWorkspaceSnapshotOrphanCandidate({
      bucket: input.bucket,
      candidate,
      currentSnapshotRef: input.currentSnapshotRef,
      key: input.key,
      runnerStoreCache: input.runnerStoreCache,
      state: input.state,
    });
    return;
  }
  await cleanupV2WorkspaceSnapshotOrphanCandidate({
    bucket: input.bucket,
    candidate,
    currentObjectKey: input.currentObjectKey,
    key: input.key,
    state: input.state,
  });
}

async function cleanupV2WorkspaceSnapshotOrphanCandidate(input: {
  bucket: R2BucketLike;
  candidate: HostedWorkspaceSnapshotV2OrphanCandidate;
  currentObjectKey: string | null;
  key: string;
  state: DurableObjectStateLike;
}): Promise<void> {
  if (input.candidate.objectKey === input.currentObjectKey) {
    await input.state.storage.delete(input.key);
    return;
  }
  await deleteR2ObjectIfSupported(input.bucket, input.candidate.objectKey);
  await input.state.storage.delete(input.key);
}

async function cleanupLegacyWorkspaceSnapshotOrphanCandidate(input: {
  bucket: R2BucketLike;
  candidate: HostedWorkspaceSnapshotLegacyOrphanCandidate;
  currentSnapshotRef: HostedExecutionSnapshotRef | null;
  key: string;
  runnerStoreCache: Pick<RunnerStoreCache, "ensure">;
  state: DurableObjectStateLike;
}): Promise<void> {
  if (legacySnapshotRefsShareBundlePayload(input.candidate.snapshotRef, input.currentSnapshotRef)) {
    await input.state.storage.delete(input.key);
    return;
  }
  const bundleRefs = collectLegacyWorkspaceSnapshotBundleRefs(input.candidate.snapshotRef);
  if (bundleRefs.length === 0) {
    await input.state.storage.delete(input.key);
    return;
  }
  const stores = await input.runnerStoreCache.ensure(input.candidate.userId);
  const garbageCollector = new HostedBundleGarbageCollector(
    input.bucket,
    stores.crypto.rootKey,
    stores.crypto.rootKeyId,
    stores.crypto.keysById,
  );
  await Promise.all(bundleRefs.map(async (previousBundleRef) => {
    await garbageCollector.cleanupBundleTransition({
      nextBundleRef: null,
      previousBundleRef,
      userId: input.candidate.userId,
    });
  }));
  await input.state.storage.delete(input.key);
}

function readHostedWorkspaceSnapshotRef(
  workspace: HostedWorkspaceState | null,
): HostedExecutionSnapshotRef | null {
  const snapshotRef = parseHostedExecutionSnapshotRef(
    workspace?.snapshotRef,
    "Hosted workspace snapshot orphan cleanup current snapshotRef",
  );
  if (!snapshotRef || isHostedWorkspaceSnapshotV2Ref(snapshotRef)) {
    return null;
  }
  return snapshotRef;
}

function legacySnapshotRefsShareBundlePayload(
  left: HostedExecutionSnapshotRef,
  right: HostedExecutionSnapshotRef | null,
): boolean {
  if (!right) {
    return false;
  }
  const leftRefs = collectLegacyWorkspaceSnapshotBundleRefs(left);
  const rightRefs = collectLegacyWorkspaceSnapshotBundleRefs(right);
  return leftRefs.some((leftRef) =>
    rightRefs.some((rightRef) =>
      leftRef.hash === rightRef.hash && leftRef.size === rightRef.size
    )
  );
}

function collectLegacyWorkspaceSnapshotBundleRefs(
  snapshotRef: HostedExecutionSnapshotRef,
): HostedExecutionBundleRef[] {
  const refs: HostedExecutionBundleRef[] = [];
  const candidates = [
    readHostedExecutionSnapshotBaseRef(snapshotRef),
    readHostedExecutionSnapshotHotRef(snapshotRef),
    readHostedExecutionSnapshotDeltaRef(snapshotRef),
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (refs.some((existing) => existing.key === candidate.key)) {
      continue;
    }
    refs.push(candidate);
  }
  return refs;
}

async function readHostedWorkspaceSnapshotOrphanCandidateForCleanup(input: {
  key: string;
  state: DurableObjectStateLike;
  userId: string;
  value: unknown;
}): Promise<HostedWorkspaceSnapshotOrphanCandidate | null> {
  try {
    return parseHostedWorkspaceSnapshotOrphanCandidate(input.value);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        cleanupErrorCode: safeCleanupErrorCode(error),
        orphanCandidateKeyPresent: input.key.length > 0,
      },
      level: "warn",
      message: "Hosted runner skipped malformed workspace snapshot orphan candidate.",
      phase: "wake.running",
      userId: input.userId,
    });
    await deleteMalformedWorkspaceSnapshotOrphanCandidateBestEffort(input);
    return null;
  }
}

async function deleteMalformedWorkspaceSnapshotOrphanCandidateBestEffort(input: {
  key: string;
  state: DurableObjectStateLike;
  userId: string;
}): Promise<void> {
  try {
    await input.state.storage.delete(input.key);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        cleanupErrorCode: safeCleanupErrorCode(error),
        orphanCandidateKeyPresent: input.key.length > 0,
      },
      level: "warn",
      message: "Hosted runner failed to discard malformed workspace snapshot orphan candidate.",
      phase: "wake.running",
      userId: input.userId,
    });
  }
}

export function workspaceSnapshotUploadSessionCurrentStorageKey(): string {
  return "workspace-snapshot-upload-session:current";
}

export function workspaceSnapshotOrphanCandidateStoragePrefix(): string {
  return "workspace-snapshot-orphan-candidate:";
}

export function workspaceSnapshotOrphanCandidateStorageKey(snapshotId: string): string {
  return `${workspaceSnapshotOrphanCandidateStoragePrefix()}${snapshotId}`;
}

export function readHostedWorkspaceV2SnapshotObjectKey(
  workspace: HostedWorkspaceState | null,
): string | null {
  const snapshotRef = workspace?.snapshotRef;
  const record = readObjectRecord(snapshotRef);
  if (!record || record.schema !== HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA) {
    return null;
  }
  return parseHostedWorkspaceSnapshotV2Ref(
    record,
    "Hosted workspace snapshot orphan cleanup current snapshotRef",
  ).objectKey;
}

function readObjectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
