import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedWorkspaceReadResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  parseHostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import type { R2BucketLike } from "../bundle-store.js";
import {
  HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
  parseHostedWorkspaceSnapshotOrphanCandidate,
  parseHostedWorkspaceSnapshotUploadSession,
  type HostedWorkspaceSnapshotOrphanCandidate,
  type HostedWorkspaceSnapshotUploadSession,
} from "../workspace-snapshot-store.ts";
import type { RunnerStateStore } from "./runner-state-store.js";
import type { DurableObjectStateLike } from "./types.js";
import { safeCleanupErrorCode } from "./diagnostics.js";
import { deleteR2ObjectIfSupported } from "./r2-delete.js";

const WORKSPACE_SNAPSHOT_ORPHAN_CLEANUP_MIN_AGE_MS = 65 * 60_000;

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
}

export function createWorkspaceSnapshotSessionService(input: {
  bucket: R2BucketLike;
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
      if (candidates.size === 0) {
        return;
      }
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
      if (eligibleCandidates.length === 0) {
        return;
      }

      const workspaceRead = await input.readHostedWorkspaceFromWeb(userId);
      input.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, userId);
      const currentObjectKey = readHostedWorkspaceV2SnapshotObjectKey(workspaceRead.workspace);

      for (const [key, candidate] of eligibleCandidates) {
        if (candidate.objectKey === currentObjectKey) {
          await input.state.storage.delete(key);
          continue;
        }
        await deleteR2ObjectIfSupported(input.bucket, candidate.objectKey);
        await input.state.storage.delete(key);
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
  };

  return service;
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
