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
  parseHostedBrowserVaultReplicaRef,
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
import {
  parseHostedBrowserVaultReplicaOrphanCandidate,
  type HostedBrowserVaultReplicaOrphanCandidate,
} from "../browser-vault-store.ts";
import type { R2BucketLike } from "../bundle-store.js";
import { hostedBrowserVaultReplicaUserPrefix } from "../storage-paths.ts";
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
const WORKSPACE_SNAPSHOT_R2_PUT_DRAIN_STATE_SCHEMA =
  "murph.hosted-workspace-snapshot-r2-put-drain.v1";

type WorkspaceSnapshotSessionStateStore = Pick<
  RunnerStateStore,
  "bindUser" | "validateWriteFenceToken"
>;

export interface WorkspaceSnapshotSessionService {
  cleanupOrphanCandidates(userId: string): Promise<void>;
  cleanupOrphanCandidatesBestEffort(userId: string): Promise<void>;
  completeCurrentOwner(input: {
    attemptId: string;
    leaseGeneration: string;
    snapshotId: string;
    userId: string;
  }): Promise<boolean>;
  create(
    input: HostedWorkspaceSnapshotUploadSession,
  ): Promise<HostedWorkspaceSnapshotUploadSession | null>;
  delete(input: {
    snapshotId: string;
    userId: string;
  }): Promise<{ deleted: boolean }>;
  read(input: {
    snapshotId: string;
    userId: string;
  }): Promise<HostedWorkspaceSnapshotUploadSession | null>;
  heartbeatCurrentOwner(input: {
    attemptId: string;
    leaseGeneration: string;
    snapshotId: string;
    userId: string;
  }): Promise<boolean>;
  readCurrentOwnerHandoff(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): Promise<{
    completedAt: string | null;
    heartbeatAt: string;
  } | null>;
  rememberReplacedSnapshotRef(input: {
    expectedSession: HostedWorkspaceSnapshotUploadSession;
    replacedSnapshotRef: NonNullable<HostedWorkspaceSnapshotUploadSession["replacedSnapshotRef"]>;
  }): Promise<boolean>;
  rememberPresignedPut(input: {
    drainUntil: string;
    expectedSession: HostedWorkspaceSnapshotUploadSession;
    expiresAt: string;
  }): Promise<HostedWorkspaceSnapshotUploadSession | null>;
  recordOrphanCandidate(
    input: HostedWorkspaceSnapshotOrphanCandidate,
  ): Promise<HostedWorkspaceSnapshotOrphanCandidate>;
  recordBrowserVaultReplicaOrphanCandidate(
    input: HostedBrowserVaultReplicaOrphanCandidate,
  ): Promise<HostedBrowserVaultReplicaOrphanCandidate>;
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
    async rememberPresignedPut(rememberInput) {
      const expectedSession = parseHostedWorkspaceSnapshotUploadSession(
        rememberInput.expectedSession,
        "Expected hosted workspace snapshot upload session",
      );
      await input.stateStore.bindUser(expectedSession.userId);
      const currentValue = await input.state.storage.get<unknown>(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
      );
      if (currentValue === undefined) {
        return null;
      }
      const currentSession = parseHostedWorkspaceSnapshotUploadSession(currentValue);
      if (!workspaceSnapshotUploadSessionsMatchExactly(currentSession, expectedSession)) {
        return null;
      }
      if (!await ownsWorkspaceSnapshotSessionOwner(input.stateStore, expectedSession)) {
        return null;
      }
      const updatedSession = parseHostedWorkspaceSnapshotUploadSession({
        ...currentSession,
        r2PutDrainUntil: rememberInput.drainUntil,
        r2PutExpiresAt: rememberInput.expiresAt,
      });

      const previousDrainState = await input.state.storage.get<unknown>(
        workspaceSnapshotR2PutDrainStorageKey(),
      );
      const previousDrainUntil = previousDrainState === undefined
        ? null
        : parseWorkspaceSnapshotR2PutDrainState(previousDrainState).drainUntil;
      const drainUntil = selectLaterIsoTimestamp(
        previousDrainUntil,
        updatedSession.r2PutDrainUntil ?? null,
      );
      if (!drainUntil) {
        throw new Error("Hosted workspace snapshot PUT drain deadline is unavailable.");
      }
      await input.state.storage.put(workspaceSnapshotR2PutDrainStorageKey(), {
        drainUntil,
        schema: WORKSPACE_SNAPSHOT_R2_PUT_DRAIN_STATE_SCHEMA,
        userId: updatedSession.userId,
      });
      await input.state.storage.put(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
        updatedSession,
      );
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          r2PutDrainRecorded: true,
        },
        message: "Hosted runner recorded a snapshot PUT drain deadline.",
        phase: "wake.running",
        userId: updatedSession.userId,
      });
      return updatedSession;
    },

    async rememberReplacedSnapshotRef(rememberInput) {
      const expectedSession = parseHostedWorkspaceSnapshotUploadSession(
        rememberInput.expectedSession,
        "Expected hosted workspace snapshot upload session",
      );
      await input.stateStore.bindUser(expectedSession.userId);
      const currentValue = await input.state.storage.get<unknown>(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
      );
      if (currentValue === undefined) {
        return false;
      }
      const currentSession = parseHostedWorkspaceSnapshotUploadSession(currentValue);
      if (!workspaceSnapshotUploadSessionsMatchExactly(currentSession, expectedSession)) {
        return false;
      }
      if (!await ownsWorkspaceSnapshotSessionOwner(input.stateStore, expectedSession)) {
        return false;
      }
      const updatedSession = parseHostedWorkspaceSnapshotUploadSession({
        ...currentSession,
        replacedSnapshotRef: rememberInput.replacedSnapshotRef,
      });
      await input.state.storage.put(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
        updatedSession,
      );
      await service.syncOrphanCandidateAlarm(updatedSession.userId);
      input.state.waitUntil(
        service.cleanupOrphanCandidatesBestEffort(updatedSession.userId),
      );
      return true;
    },

    async create(sessionInput) {
      await input.stateStore.bindUser(sessionInput.userId);
      const session = parseHostedWorkspaceSnapshotUploadSession({
        ...sessionInput,
        checkpointHandoffCompletedAt: undefined,
        checkpointHandoffHeartbeatAt: new Date().toISOString(),
      });
      if (session.userId !== sessionInput.userId) {
        throw new Error("Hosted workspace snapshot upload session user mismatch.");
      }
      const previousCurrent = await input.state.storage.get<unknown>(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
      );
      if (!await ownsWorkspaceSnapshotSessionOwner(input.stateStore, session)) {
        return null;
      }
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
      if (
        previousCurrent !== undefined
        && !await ownsWorkspaceSnapshotSessionOwner(input.stateStore, session)
      ) {
        return null;
      }
      await input.state.storage.put(workspaceSnapshotUploadSessionCurrentStorageKey(), session);
      await service.syncOrphanCandidateAlarm(session.userId);
      input.state.waitUntil(
        service.cleanupOrphanCandidatesBestEffort(sessionInput.userId),
      );
      return session;
    },

    async heartbeatCurrentOwner(heartbeatInput) {
      await input.stateStore.bindUser(heartbeatInput.userId);
      const value = await input.state.storage.get<unknown>(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
      );
      if (value === undefined) {
        return false;
      }
      const session = parseHostedWorkspaceSnapshotUploadSession(value);
      if (!workspaceSnapshotSessionMatchesOwner(session, heartbeatInput)) {
        return false;
      }
      if (!await ownsWorkspaceSnapshotSessionOwner(input.stateStore, session)) {
        return false;
      }
      if (session.checkpointHandoffCompletedAt) {
        return true;
      }
      await input.state.storage.put(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
        parseHostedWorkspaceSnapshotUploadSession({
          ...session,
          checkpointHandoffHeartbeatAt: new Date().toISOString(),
        }),
      );
      return true;
    },

    async completeCurrentOwner(completeInput) {
      await input.stateStore.bindUser(completeInput.userId);
      const value = await input.state.storage.get<unknown>(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
      );
      if (value === undefined) {
        return false;
      }
      const session = parseHostedWorkspaceSnapshotUploadSession(value);
      if (!workspaceSnapshotSessionMatchesOwner(session, completeInput)) {
        return false;
      }
      if (!await ownsWorkspaceSnapshotSessionOwner(input.stateStore, session)) {
        return false;
      }
      const completedAt = new Date().toISOString();
      await input.state.storage.put(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
        parseHostedWorkspaceSnapshotUploadSession({
          ...session,
          checkpointHandoffCompletedAt: completedAt,
          checkpointHandoffHeartbeatAt: completedAt,
        }),
      );
      return true;
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

    async recordBrowserVaultReplicaOrphanCandidate(candidateInput) {
      await input.stateStore.bindUser(candidateInput.userId);
      const candidate = parseHostedBrowserVaultReplicaOrphanCandidate(candidateInput);
      if (candidate.userId !== candidateInput.userId) {
        throw new Error("Hosted browser vault replica orphan candidate user mismatch.");
      }
      const expectedPrefix = await hostedBrowserVaultReplicaUserPrefix({
        userId: candidate.userId,
      });
      if (!candidate.objectKey.startsWith(expectedPrefix)) {
        throw new Error(
          "Hosted browser vault replica orphan candidate is outside the bound user namespace.",
        );
      }
      await input.state.storage.put(
        browserVaultReplicaOrphanCandidateStorageKey(candidate.objectKey),
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
          message: "Hosted runner R2 orphan cleanup failed.",
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
      const browserVaultReplicaCandidates = await input.state.storage.list<unknown>({
        prefix: browserVaultReplicaOrphanCandidateStoragePrefix(),
      });
      const expectedBrowserVaultReplicaPrefix = await hostedBrowserVaultReplicaUserPrefix({
        userId,
      });
      const nowMs = Date.now();
      const eligibleCandidates: Array<[string, HostedWorkspaceSnapshotOrphanCandidate]> = [];
      const eligibleBrowserVaultReplicaCandidates: Array<[
        string,
        HostedBrowserVaultReplicaOrphanCandidate,
      ]> = [];

      for (const [key, value] of candidates) {
        const candidate = await readHostedOrphanCandidateForCleanup({
          candidateLabel: "workspace snapshot",
          key,
          parse: parseHostedWorkspaceSnapshotOrphanCandidate,
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
        if (!isHostedR2OrphanCleanupCreatedAtEligible(candidate.createdAt, nowMs)) {
          continue;
        }
        eligibleCandidates.push([key, candidate]);
      }
      for (const [key, value] of browserVaultReplicaCandidates) {
        const candidate = await readHostedOrphanCandidateForCleanup({
          candidateLabel: "browser vault replica",
          key,
          parse: parseHostedBrowserVaultReplicaOrphanCandidate,
          state: input.state,
          userId,
          value,
        });
        if (!candidate) {
          continue;
        }
        if (
          candidate.userId !== userId
          || !candidate.objectKey.startsWith(expectedBrowserVaultReplicaPrefix)
        ) {
          await input.state.storage.delete(key);
          continue;
        }
        if (!isHostedR2OrphanCleanupCreatedAtEligible(candidate.createdAt, nowMs)) {
          continue;
        }
        eligibleBrowserVaultReplicaCandidates.push([key, candidate]);
      }
      const currentSession = await readWorkspaceSnapshotUploadSessionForCleanup({
        state: input.state,
        userId,
      });
      const sessionCleanupEligible = currentSession
        ? isHostedR2OrphanCleanupCreatedAtEligible(currentSession.createdAt, nowMs)
        : false;
      if (
        eligibleCandidates.length === 0
        && eligibleBrowserVaultReplicaCandidates.length === 0
        && !sessionCleanupEligible
      ) {
        await service.syncOrphanCandidateAlarm(userId);
        return;
      }

      const workspaceRead = await input.readHostedWorkspaceFromWeb(userId);
      input.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, userId);
      const currentObjectKey = readHostedWorkspaceV2SnapshotObjectKey(workspaceRead.workspace);
      const currentSnapshotRef = readHostedWorkspaceSnapshotRef(workspaceRead.workspace);
      const currentBrowserVaultReplicaObjectKey = readHostedBrowserVaultReplicaObjectKey(
        workspaceRead.workspace,
      );
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
      for (const [key, candidate] of eligibleBrowserVaultReplicaCandidates) {
        try {
          await cleanupBrowserVaultReplicaOrphanCandidate({
            bucket: input.bucket,
            candidate,
            currentObjectKey: currentBrowserVaultReplicaObjectKey,
            key,
            state: input.state,
          });
        } catch (error) {
          errors.push(error);
        }
      }
      if (currentSession && sessionCleanupEligible) {
        try {
          await cleanupWorkspaceSnapshotUploadSessionObligations({
            bucket: input.bucket,
            currentObjectKey,
            currentSnapshotRef,
            runnerStoreCache: input.runnerStoreCache,
            session: currentSession,
          });
          await service.delete({
            snapshotId: currentSession.snapshotId,
            userId: currentSession.userId,
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

    async readCurrentOwnerHandoff(readInput) {
      await input.stateStore.bindUser(readInput.userId);
      const value = await input.state.storage.get<unknown>(
        workspaceSnapshotUploadSessionCurrentStorageKey(),
      );
      if (value === undefined) {
        return null;
      }
      const session = parseHostedWorkspaceSnapshotUploadSession(value);
      if (session.userId !== readInput.userId) {
        throw new Error(
          "Hosted workspace snapshot upload session is outside the bound user namespace.",
        );
      }
      if (
        session.attemptId !== readInput.attemptId
        || session.leaseGeneration !== readInput.leaseGeneration
      ) {
        return null;
      }
      if (!session.checkpointHandoffHeartbeatAt) {
        return null;
      }
      return {
        completedAt: session.checkpointHandoffCompletedAt ?? null,
        heartbeatAt: session.checkpointHandoffHeartbeatAt,
      };
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
          deleted: await input.state.storage.delete(
            workspaceSnapshotUploadSessionCurrentStorageKey(),
          ),
        };
      }
      return { deleted: false };
    },

    async syncOrphanCandidateAlarm(userId) {
      await syncHostedR2OrphanCandidateAlarm({
        state: input.state,
        userId,
      });
    },
  };

  return service;
}

async function ownsWorkspaceSnapshotSessionOwner(
  stateStore: WorkspaceSnapshotSessionStateStore,
  session: HostedWorkspaceSnapshotUploadSession,
): Promise<boolean> {
  const writeFence = await stateStore.validateWriteFenceToken({
    attemptId: session.attemptId,
    generation: session.leaseGeneration,
    userId: session.userId,
  });
  return writeFence.owns;
}

function workspaceSnapshotUploadSessionsMatchExactly(
  left: HostedWorkspaceSnapshotUploadSession,
  right: HostedWorkspaceSnapshotUploadSession,
): boolean {
  // Heartbeat/completion timestamps are server-owned liveness metadata and may
  // advance between the runner reading a session and its next exact-session
  // update. Every client-owned field must still match canonically.
  const {
    checkpointHandoffCompletedAt: _leftCompletedAt,
    checkpointHandoffHeartbeatAt: _leftHeartbeatAt,
    ...leftClientFields
  } = left;
  const {
    checkpointHandoffCompletedAt: _rightCompletedAt,
    checkpointHandoffHeartbeatAt: _rightHeartbeatAt,
    ...rightClientFields
  } = right;
  return JSON.stringify(leftClientFields) === JSON.stringify(rightClientFields);
}

function workspaceSnapshotSessionMatchesOwner(
  session: HostedWorkspaceSnapshotUploadSession,
  owner: {
    attemptId: string;
    leaseGeneration: string;
    snapshotId: string;
    userId: string;
  },
): boolean {
  return session.attemptId === owner.attemptId
    && session.leaseGeneration === owner.leaseGeneration
    && session.snapshotId === owner.snapshotId
    && session.userId === owner.userId;
}

export async function readHostedWorkspaceSnapshotR2PutDrainUntil(input: {
  state: DurableObjectStateLike;
  userId: string;
}): Promise<string | null> {
  const drainStateValue = await input.state.storage.get<unknown>(
    workspaceSnapshotR2PutDrainStorageKey(),
  );
  const drainState = drainStateValue === undefined
    ? null
    : parseWorkspaceSnapshotR2PutDrainState(drainStateValue);
  if (drainState && drainState.userId !== input.userId) {
    throw new Error("Hosted workspace snapshot PUT drain state belongs to another user.");
  }
  const sessionValue = await input.state.storage.get<unknown>(
    workspaceSnapshotUploadSessionCurrentStorageKey(),
  );
  const session = sessionValue === undefined
    ? null
    : parseHostedWorkspaceSnapshotUploadSession(sessionValue);
  if (session && session.userId !== input.userId) {
    throw new Error("Hosted workspace snapshot upload session belongs to another user.");
  }
  return selectLaterIsoTimestamp(
    drainState?.drainUntil ?? null,
    session?.r2PutDrainUntil ?? null,
  );
}

function parseWorkspaceSnapshotR2PutDrainState(value: unknown): {
  drainUntil: string;
  userId: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted workspace snapshot PUT drain state is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== WORKSPACE_SNAPSHOT_R2_PUT_DRAIN_STATE_SCHEMA) {
    throw new TypeError("Hosted workspace snapshot PUT drain state schema is invalid.");
  }
  return {
    drainUntil: requireCanonicalIsoTimestamp(record.drainUntil, "PUT drain deadline"),
    userId: requireNonEmptyString(record.userId, "PUT drain user id"),
  };
}

export async function readHostedR2OrphanCandidateNextAlarmAt(input: {
  state: DurableObjectStateLike;
  userId: string;
}): Promise<number | null> {
  if (!input.state.storage.list) {
    return null;
  }
  const candidates = await input.state.storage.list<unknown>({
    prefix: workspaceSnapshotOrphanCandidateStoragePrefix(),
  });
  const browserVaultReplicaCandidates = await input.state.storage.list<unknown>({
    prefix: browserVaultReplicaOrphanCandidateStoragePrefix(),
  });
  let nextAtMs: number | null = null;
  const currentSession = await readWorkspaceSnapshotUploadSessionForCleanup({
    state: input.state,
    userId: input.userId,
  });
  const sessionSnapshotCandidate = currentSession
    ? buildWorkspaceSnapshotOrphanCandidateFromUploadSessionObject(currentSession)
    : null;
  if (sessionSnapshotCandidate) {
    nextAtMs = selectEarliestHostedR2OrphanCleanupAlarm(
      nextAtMs,
      sessionSnapshotCandidate.createdAt,
    );
  }
  const sessionReplacedCandidate = currentSession
    ? buildWorkspaceSnapshotOrphanCandidateFromUploadSessionReplacedRef(currentSession)
    : null;
  if (sessionReplacedCandidate) {
    nextAtMs = selectEarliestHostedR2OrphanCleanupAlarm(
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
    nextAtMs = selectEarliestHostedR2OrphanCleanupAlarm(nextAtMs, candidate.createdAt);
  }
  for (const value of browserVaultReplicaCandidates.values()) {
    let candidate: HostedBrowserVaultReplicaOrphanCandidate;
    try {
      candidate = parseHostedBrowserVaultReplicaOrphanCandidate(value);
    } catch {
      continue;
    }
    if (candidate.userId !== input.userId) {
      continue;
    }
    nextAtMs = selectEarliestHostedR2OrphanCleanupAlarm(nextAtMs, candidate.createdAt);
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

function buildWorkspaceSnapshotOrphanCandidateFromUploadSessionObject(
  session: HostedWorkspaceSnapshotUploadSession,
): HostedWorkspaceSnapshotV2OrphanCandidate {
  return {
    createdAt: session.createdAt,
    objectKey: session.objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
    snapshotId: session.snapshotId,
    userId: session.userId,
  };
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

function selectEarliestHostedR2OrphanCleanupAlarm(
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

function isHostedR2OrphanCleanupCreatedAtEligible(createdAt: string, nowMs: number): boolean {
  const createdAtMs = Date.parse(createdAt);
  return Number.isFinite(createdAtMs)
    && nowMs - createdAtMs >= WORKSPACE_SNAPSHOT_ORPHAN_CLEANUP_MIN_AGE_MS;
}

async function syncHostedR2OrphanCandidateAlarm(input: {
  state: DurableObjectStateLike;
  userId: string;
}): Promise<void> {
  const nextAtMs = await readHostedR2OrphanCandidateNextAlarmAt(input);
  if (nextAtMs === null) {
    await input.state.storage.deleteAlarm?.();
    return;
  }
  const currentAlarm = await input.state.storage.getAlarm();
  if (currentAlarm === nextAtMs) {
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
    await cleanupLegacyWorkspaceSnapshotObligation({
      bucket: input.bucket,
      candidate,
      currentSnapshotRef: input.currentSnapshotRef,
      runnerStoreCache: input.runnerStoreCache,
    });
    await input.state.storage.delete(input.key);
    return;
  }
  await cleanupV2WorkspaceSnapshotObligation({
    bucket: input.bucket,
    candidate,
    currentObjectKey: input.currentObjectKey,
  });
  await input.state.storage.delete(input.key);
}

async function cleanupBrowserVaultReplicaOrphanCandidate(input: {
  bucket: R2BucketLike;
  candidate: HostedBrowserVaultReplicaOrphanCandidate;
  currentObjectKey: string | null;
  key: string;
  state: DurableObjectStateLike;
}): Promise<void> {
  if (input.candidate.objectKey !== input.currentObjectKey) {
    await deleteR2ObjectIfSupported(input.bucket, input.candidate.objectKey);
  }
  await deleteBrowserVaultReplicaOrphanCandidateIfUnchanged(input);
}

async function deleteBrowserVaultReplicaOrphanCandidateIfUnchanged(input: {
  candidate: HostedBrowserVaultReplicaOrphanCandidate;
  key: string;
  state: DurableObjectStateLike;
}): Promise<void> {
  const currentValue = await input.state.storage.get<unknown>(input.key);
  if (currentValue === undefined) {
    return;
  }
  const currentCandidate = parseHostedBrowserVaultReplicaOrphanCandidate(currentValue);
  if (
    currentCandidate.createdAt !== input.candidate.createdAt
    || currentCandidate.objectKey !== input.candidate.objectKey
    || currentCandidate.userId !== input.candidate.userId
  ) {
    return;
  }
  await input.state.storage.delete(input.key);
}

async function cleanupWorkspaceSnapshotUploadSessionObligations(input: {
  bucket: R2BucketLike;
  currentObjectKey: string | null;
  currentSnapshotRef: HostedExecutionSnapshotRef | null;
  runnerStoreCache: Pick<RunnerStoreCache, "ensure">;
  session: HostedWorkspaceSnapshotUploadSession;
}): Promise<void> {
  await cleanupV2WorkspaceSnapshotObligation({
    bucket: input.bucket,
    candidate: buildWorkspaceSnapshotOrphanCandidateFromUploadSessionObject(input.session),
    currentObjectKey: input.currentObjectKey,
  });

  const replacedCandidate = buildWorkspaceSnapshotOrphanCandidateFromUploadSessionReplacedRef(
    input.session,
  );
  if (replacedCandidate) {
    if (replacedCandidate.kind === "legacy_workspace_snapshot") {
      await cleanupLegacyWorkspaceSnapshotObligation({
        bucket: input.bucket,
        candidate: replacedCandidate,
        currentSnapshotRef: input.currentSnapshotRef,
        runnerStoreCache: input.runnerStoreCache,
      });
    } else {
      await cleanupV2WorkspaceSnapshotObligation({
        bucket: input.bucket,
        candidate: replacedCandidate,
        currentObjectKey: input.currentObjectKey,
      });
    }
  }
}

async function cleanupV2WorkspaceSnapshotObligation(input: {
  bucket: R2BucketLike;
  candidate: HostedWorkspaceSnapshotV2OrphanCandidate;
  currentObjectKey: string | null;
}): Promise<void> {
  if (input.candidate.objectKey === input.currentObjectKey) {
    return;
  }
  await deleteR2ObjectIfSupported(input.bucket, input.candidate.objectKey);
}

async function cleanupLegacyWorkspaceSnapshotObligation(input: {
  bucket: R2BucketLike;
  candidate: HostedWorkspaceSnapshotLegacyOrphanCandidate;
  currentSnapshotRef: HostedExecutionSnapshotRef | null;
  runnerStoreCache: Pick<RunnerStoreCache, "ensure">;
}): Promise<void> {
  if (legacySnapshotRefsShareBundlePayload(input.candidate.snapshotRef, input.currentSnapshotRef)) {
    return;
  }
  const bundleRefs = collectLegacyWorkspaceSnapshotBundleRefs(input.candidate.snapshotRef);
  if (bundleRefs.length === 0) {
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

async function readHostedOrphanCandidateForCleanup<T>(input: {
  candidateLabel: string;
  key: string;
  parse(value: unknown): T;
  state: DurableObjectStateLike;
  userId: string;
  value: unknown;
}): Promise<T | null> {
  try {
    return input.parse(input.value);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        cleanupErrorCode: safeCleanupErrorCode(error),
        orphanCandidateKeyPresent: input.key.length > 0,
      },
      level: "warn",
      message: `Hosted runner skipped malformed ${input.candidateLabel} orphan candidate.`,
      phase: "wake.running",
      userId: input.userId,
    });
    await deleteMalformedHostedOrphanCandidateBestEffort(input);
    return null;
  }
}

async function deleteMalformedHostedOrphanCandidateBestEffort(input: {
  candidateLabel: string;
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
      message: `Hosted runner failed to discard malformed ${input.candidateLabel} orphan candidate.`,
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

export function browserVaultReplicaOrphanCandidateStoragePrefix(): string {
  return "browser-vault-replica-orphan-candidate:";
}

export function browserVaultReplicaOrphanCandidateStorageKey(objectKey: string): string {
  return `${browserVaultReplicaOrphanCandidateStoragePrefix()}${objectKey}`;
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

export function readHostedBrowserVaultReplicaObjectKey(
  workspace: HostedWorkspaceState | null,
): string | null {
  return parseHostedBrowserVaultReplicaRef(
    workspace?.browserVaultReplicaRef,
    "Hosted browser vault replica orphan cleanup current replicaRef",
  )?.objectKey ?? null;
}

function readObjectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function workspaceSnapshotR2PutDrainStorageKey(): string {
  return "workspace-snapshot:r2-put-drain:v1";
}

function selectLaterIsoTimestamp(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function requireCanonicalIsoTimestamp(value: unknown, label: string): string {
  const text = requireNonEmptyString(value, label);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== text) {
    throw new TypeError(`Hosted workspace snapshot ${label} must be a canonical ISO timestamp.`);
  }
  return text;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Hosted workspace snapshot ${label} must be a non-empty string.`);
  }
  return value;
}
