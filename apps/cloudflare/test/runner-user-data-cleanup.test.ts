import type { HostedWorkspaceState } from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveHostedExecutionRunnerContainerName,
  type HostedExecutionContainerNamespaceLike,
  type HostedExecutionContainerStubLike,
} from "../src/runner-container.js";
import {
  hostedBundleUserPrefix,
  hostedMealPhotoUserPrefix,
  hostedPrivateMediaUserPrefix,
} from "../src/storage-paths.js";
import {
  HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
  type HostedWorkspaceSnapshotUploadSession,
} from "../src/workspace-snapshot-store.js";
import {
  deleteHostedRunnerUserData,
} from "../src/user-runner/user-data-deletion.js";
import {
  deleteR2ObjectsWithPrefix,
} from "../src/user-runner/r2-delete.js";
import {
  createWorkspaceSnapshotSessionService,
  workspaceSnapshotOrphanCandidateStorageKey,
} from "../src/user-runner/workspace-snapshot-sessions.js";
import type {
  DurableObjectStateLike,
  DurableObjectStorageLike,
} from "../src/user-runner/types.js";
import { MemoryEncryptedR2Bucket } from "./test-helpers.js";

const hostedExecutionMocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );

  return {
    ...actual,
    emitHostedExecutionStructuredLog: hostedExecutionMocks.emitHostedExecutionStructuredLog,
  };
});

const USER_ID = "member_cleanup_test";
const NOW = "2026-04-27T00:00:00.000Z";

describe("hosted runner user data cleanup", () => {
  afterEach(() => {
    hostedExecutionMocks.emitHostedExecutionStructuredLog.mockReset();
    vi.restoreAllMocks();
  });

  it("deletes staged meal photos before deleting runner state", async () => {
    const durable = createDurableObjectHarness();
    const stateStore = createDeletionStateStore();
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const prefix = await hostedMealPhotoUserPrefix({ userId: USER_ID });
    const stagedPhotoKey = `${prefix}${"a".repeat(48)}.jpg.enc`;
    const unrelatedKey = "hosted-meal-photos/images/other/photo.jpg.enc";
    await bucket.put(stagedPhotoKey, "encrypted-photo");
    await bucket.put(unrelatedKey, "other-user-photo");

    const result = await deleteHostedRunnerUserData({
      bucket,
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      state: durable.state,
      stateStore,
      userId: USER_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected hosted user-data deletion to complete.");
    }
    expect(result.r2).toMatchObject({
      deletedObjectCount: 1,
      skippedUserScopedPrefixes: false,
      supported: true,
    });
    expect(bucket.objects.has(stagedPhotoKey)).toBe(false);
    expect(bucket.objects.has(unrelatedKey)).toBe(true);
    expect(stateStore.deleteStateCallCount).toBe(1);
    expect(durable.deleteAllCount).toBe(1);
  });

  it("deletes private avatar ingress objects before deleting runner state", async () => {
    const durable = createDurableObjectHarness();
    const stateStore = createDeletionStateStore();
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const prefix = await hostedPrivateMediaUserPrefix({ userId: USER_ID });
    const stagedMediaKey = `${prefix}${"a".repeat(48)}.image.enc`;
    const unrelatedKey =
      `hosted-private-media/images/other/${"b".repeat(48)}.image.enc`;
    await bucket.put(stagedMediaKey, "encrypted-private-media");
    await bucket.put(unrelatedKey, "other-user-private-media");

    const result = await deleteHostedRunnerUserData({
      bucket,
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      state: durable.state,
      stateStore,
      userId: USER_ID,
    });

    expect(result).toMatchObject({
      ok: true,
      r2: {
        deletedObjectCount: 1,
        skippedUserScopedPrefixes: false,
        supported: true,
      },
    });
    expect(bucket.objects.has(stagedMediaKey)).toBe(false);
    expect(bucket.objects.has(unrelatedKey)).toBe(true);
    expect(stateStore.deleteStateCallCount).toBe(1);
    expect(durable.deleteAllCount).toBe(1);
  });

  it("retries the retained prior-version runner target before deleting user data", async () => {
    const priorRunnerContainerName = `${USER_ID}--v-current`;
    const rollbackRunnerContainerName = resolveHostedExecutionRunnerContainerName({
      source: { CF_VERSION_METADATA: { id: "rollback" } },
      userId: USER_ID,
    });
    expect(rollbackRunnerContainerName).not.toBe(priorRunnerContainerName);

    const durable = createDurableObjectHarness();
    const stateStore = createDeletionStateStore({
      activeAttemptId: "attempt_active",
      runnerContainerName: priorRunnerContainerName,
    });
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const requestedRunnerContainerNames: string[] = [];
    const rollbackDestroyInstance = vi.fn(async () => {});
    const priorDestroyInstance = vi.fn(async () => {
      if (priorDestroyInstance.mock.calls.length === 1) {
        throw new Error("prior runner destroy failed");
      }
    });
    const runnerContainerNamespace: HostedExecutionContainerNamespaceLike = {
      getByName(name) {
        requestedRunnerContainerNames.push(name);
        return createDestroyOnlyRunnerContainerStub(
          name === priorRunnerContainerName
            ? priorDestroyInstance
            : rollbackDestroyInstance,
        );
      },
    };
    const request = {
      bucket,
      runnerContainerNamespace,
      runnerRuntimeEnvSource: {
        CF_VERSION_METADATA: { id: "current" },
      },
      state: durable.state,
      stateStore,
      userId: USER_ID,
    };

    await expect(deleteHostedRunnerUserData(request)).rejects.toThrow(
      "container cleanup failed before user data deletion",
    );
    expect(requestedRunnerContainerNames).toEqual([priorRunnerContainerName]);
    expect(stateStore.runnerContainerName).toBe(priorRunnerContainerName);
    expect(stateStore.deleteStateCallCount).toBe(0);
    expect(durable.deleteAllCount).toBe(0);

    await expect(deleteHostedRunnerUserData(request)).resolves.toMatchObject({
      durableObject: {
        deleteAllCompleted: true,
        stateDeleted: true,
      },
      ok: true,
    });
    expect(requestedRunnerContainerNames).toEqual([
      priorRunnerContainerName,
      priorRunnerContainerName,
    ]);
    expect(priorDestroyInstance).toHaveBeenCalledTimes(2);
    expect(rollbackDestroyInstance).not.toHaveBeenCalled();
    expect(stateStore.runnerContainerName).toBeNull();
    expect(stateStore.deleteStateCallCount).toBe(1);
    expect(durable.deleteAllCount).toBe(1);
  });

  it("fails closed before logical state deletion when deleteAll is unavailable", async () => {
    const durable = createDurableObjectHarness();
    durable.state.storage.deleteAll = undefined;
    const stateStore = createDeletionStateStore();
    const bucket = new ListableMemoryEncryptedR2Bucket();

    await expect(deleteHostedRunnerUserData({
      bucket,
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      state: durable.state,
      stateStore,
      userId: USER_ID,
    })).rejects.toThrow("deleteAll is required");
    expect(stateStore.deleteStateCallCount).toBe(0);
  });

  it("retries after Durable Object deleteAll fails without reporting completion", async () => {
    const deleteAllError = new Error("Durable Object deleteAll failed");
    const durable = createDurableObjectHarness({ deleteAllError });
    const stateStore = createDeletionStateStore();
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const request = {
      bucket,
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      state: durable.state,
      stateStore,
      userId: USER_ID,
    };

    await expect(deleteHostedRunnerUserData(request)).rejects.toBe(deleteAllError);
    expect(stateStore.deleteStateCallCount).toBe(1);
    expect(durable.deleteAllCount).toBe(1);

    await expect(deleteHostedRunnerUserData(request)).resolves.toMatchObject({
      durableObject: {
        alarmCleared: true,
        deleteAllCompleted: true,
        stateDeleted: true,
      },
    });
    expect(stateStore.deleteStateCallCount).toBe(2);
    expect(durable.deleteAllCount).toBe(2);
  });

  it("does not delete Durable Object state or alarms when R2 cleanup fails", async () => {
    const durable = createDurableObjectHarness();
    const stateStore = createDeletionStateStore();
    const prefix = await hostedBundleUserPrefix({ userId: USER_ID });
    const deletedBeforeFailureKey = `${prefix}a.bundle.json`;
    const failedKey = `${prefix}z.bundle.json`;
    const bucket = new FailingDeleteListableR2Bucket(failedKey);
    await bucket.put(deletedBeforeFailureKey, "first");
    await bucket.put(failedKey, "second");

    await expect(deleteHostedRunnerUserData({
      bucket,
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      state: durable.state,
      stateStore,
      userId: USER_ID,
    })).rejects.toThrow("Hosted runner R2 cleanup failed before user data deletion.");

    expect(stateStore.deleteStateCallCount).toBe(0);
    expect(durable.alarmDeleteCount).toBe(0);
    expect(durable.deleteAllCount).toBe(0);
    expect(bucket.deleted).toEqual([deletedBeforeFailureKey]);
    expect(bucket.objects.has(failedKey)).toBe(true);
    const serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain(failedKey);
    expect(serializedLogs).not.toContain("R2 delete failed for");
  });

  it("does not delete Durable Object state or alarms when R2 listing fails", async () => {
    const durable = createDurableObjectHarness();
    const stateStore = createDeletionStateStore();
    const bucket = new FailingListableR2Bucket();
    const leakedPrefix = await hostedBundleUserPrefix({ userId: USER_ID });

    await expect(deleteHostedRunnerUserData({
      bucket,
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      state: durable.state,
      stateStore,
      userId: USER_ID,
    })).rejects.toThrow("Hosted runner R2 cleanup failed before user data deletion.");

    expect(stateStore.deleteStateCallCount).toBe(0);
    expect(durable.alarmDeleteCount).toBe(0);
    expect(durable.deleteAllCount).toBe(0);
    const serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain(leakedPrefix);
    expect(serializedLogs).not.toContain("R2 list failed for");
  });

  it("rejects a bucket without list support instead of reporting success", async () => {
    const durable = createDurableObjectHarness();
    const stateStore = createDeletionStateStore();
    const unsupported = new MemoryEncryptedR2Bucket();

    await expect(deleteHostedRunnerUserData({
      bucket: unsupported,
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      state: durable.state,
      stateStore,
      userId: USER_ID,
    })).rejects.toThrow("Hosted runner R2 cleanup failed");

    expect(stateStore.deleteStateCallCount).toBe(0);
    expect(durable.deleteAllCount).toBe(0);
  });

  it("returns retryable pending before touching R2 while a direct PUT can still finish", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const durable = createDurableObjectHarness();
    durable.storageValues.set("workspace-snapshot:r2-put-drain:v1", {
      drainUntil: "2026-07-28T12:05:00.000Z",
      schema: "murph.hosted-workspace-snapshot-r2-put-drain.v1",
      userId: USER_ID,
    });
    const stateStore = createDeletionStateStore();
    const bucket = new ListableMemoryEncryptedR2Bucket();

    await expect(deleteHostedRunnerUserData({
      bucket,
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      state: durable.state,
      stateStore,
      userId: USER_ID,
    })).resolves.toEqual({
      ok: false,
      reason: "r2_upload_drain_pending",
      retryAfterSeconds: 300,
      userId: USER_ID,
    });

    expect(bucket.deleteBatches).toEqual([]);
    expect(stateStore.deleteStateCallCount).toBe(0);
  });

  it("carries a real owner-recorded monotonic PUT drain into deletion admission", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const durable = createDurableObjectHarness();
    const ownerStateStore = createOwningSnapshotStateStore();
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const snapshotId = "snapshot_ticket";
    const objectKey =
      `users/hsn_0123456789abcdef01234567/workspace-snapshots/${snapshotId}.snapshot.enc`;
    const session: HostedWorkspaceSnapshotUploadSession = {
      attemptId: "attempt_1",
      createdAt: "2026-07-28T12:00:00.000Z",
      encryption: {
        aad: buildHostedWorkspaceSnapshotV2Aad({
          objectKey,
          snapshotId,
          userId: USER_ID,
        }),
        ivBase64: "AQIDBAUGBwgJCgsM",
        rootKeyId: "root_1",
        scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
        wrappedDataKey: "wrapped",
      },
      expectedWorkspaceVersion: "7",
      expiresAt: "2026-07-28T13:00:00.000Z",
      leaseGeneration: "3",
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_SESSION_SCHEMA,
      snapshotId,
      userId: USER_ID,
      workspaceVersion: "7",
    };
    const service = createWorkspaceSnapshotSessionService({
      bucket,
      runnerStoreCache: createUnusedRunnerStoreCache(),
      state: durable.state,
      stateStore: ownerStateStore,
      readHostedWorkspaceFromWeb: async (userId) => ({
        fetchedAt: NOW,
        workspace: createWorkspaceState(userId),
      }),
      assertWorkspaceBelongsToRunnerUser() {},
    });

    const created = await service.create(session);
    expect(created).toEqual({
      ...session,
      checkpointHandoffHeartbeatAt: expect.any(String),
    });
    const first = await service.rememberPresignedPut({
      drainUntil: "2026-07-28T12:20:00.000Z",
      expectedSession: session,
      expiresAt: "2026-07-28T12:10:00.000Z",
    });
    if (!first) {
      throw new Error("Expected the first owner-recorded PUT drain.");
    }
    await expect(service.rememberPresignedPut({
      drainUntil: "2026-07-28T12:15:00.000Z",
      expectedSession: first,
      expiresAt: "2026-07-28T12:10:00.000Z",
    })).resolves.not.toBeNull();
    expect(durable.storageValues.get("workspace-snapshot:r2-put-drain:v1")).toEqual({
      drainUntil: "2026-07-28T12:20:00.000Z",
      schema: "murph.hosted-workspace-snapshot-r2-put-drain.v1",
      userId: USER_ID,
    });

    await expect(deleteHostedRunnerUserData({
      bucket,
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      state: durable.state,
      stateStore: createDeletionStateStore(),
      userId: USER_ID,
    })).resolves.toEqual({
      ok: false,
      reason: "r2_upload_drain_pending",
      retryAfterSeconds: 1_200,
      userId: USER_ID,
    });

    expect(bucket.listCalls).toEqual([]);
    expect(bucket.deleteBatches).toEqual([]);
  });

  it("withholds completion when a late object appears between empty observations", async () => {
    const durable = createDurableObjectHarness();
    const stateStore = createDeletionStateStore();
    const prefix = await hostedBundleUserPrefix({ userId: USER_ID });
    const lateKey = `${prefix}late.bundle.json`;
    const bucket = new LateWriteListableR2Bucket(prefix, lateKey);

    await expect(deleteHostedRunnerUserData({
      bucket,
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      state: durable.state,
      stateStore,
      userId: USER_ID,
    })).rejects.toThrow("Hosted runner R2 cleanup failed");

    expect(bucket.objects.has(lateKey)).toBe(true);
    expect(stateStore.deleteStateCallCount).toBe(0);
    expect(durable.deleteAllCount).toBe(0);
  });

  it("does not report success when logical state deletion declines", async () => {
    const durable = createDurableObjectHarness();
    const stateStore = createDeletionStateStore({ deleted: false });
    const bucket = new ListableMemoryEncryptedR2Bucket();

    await expect(deleteHostedRunnerUserData({
      bucket,
      runnerContainerNamespace: null,
      runnerRuntimeEnvSource: {},
      state: durable.state,
      stateStore,
      userId: USER_ID,
    })).rejects.toThrow("logical state was not deleted");

    expect(durable.deleteAllCount).toBe(0);
  });

  it("bulk-deletes every listed R2 prefix page without cursor skips", async () => {
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const prefix = await hostedBundleUserPrefix({ userId: USER_ID });
    for (let index = 0; index < 1_001; index += 1) {
      await bucket.put(`${prefix}${String(index).padStart(4, "0")}.bundle.json`, "data");
    }

    await expect(deleteR2ObjectsWithPrefix(bucket, prefix)).resolves.toEqual({
      deletedCount: 1_001,
    });

    expect(bucket.deleteBatches.map((batch) => batch.length)).toEqual([1_000, 1]);
    expect(bucket.objects.size).toBe(0);
  });

  it("skips malformed workspace snapshot orphan candidates and keeps cleaning valid candidates", async () => {
    const durable = createDurableObjectHarness();
    const stateStore = createBindOnlyStateStore();
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const malformedCandidateKey = workspaceSnapshotOrphanCandidateStorageKey("bad");
    const validCandidateKey = workspaceSnapshotOrphanCandidateStorageKey("valid");
    const validObjectKey = "users/snapshots/member_cleanup_test/orphan.snapshot.enc";
    durable.storageValues.set(malformedCandidateKey, {
      schema: "wrong",
    });
    durable.storageValues.set(validCandidateKey, {
      createdAt: "2026-04-26T00:00:00.000Z",
      objectKey: validObjectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId: "valid",
      userId: USER_ID,
    });
    await bucket.put(validObjectKey, "encrypted-snapshot");
    const service = createWorkspaceSnapshotSessionService({
      bucket,
      runnerStoreCache: createUnusedRunnerStoreCache(),
      state: durable.state,
      stateStore,
      readHostedWorkspaceFromWeb: async (userId) => ({
        fetchedAt: NOW,
        workspace: createWorkspaceState(userId),
      }),
      assertWorkspaceBelongsToRunnerUser(workspace, userId) {
        if (workspace?.userId !== userId) {
          throw new Error("Workspace user mismatch.");
        }
      },
    });

    await service.cleanupOrphanCandidates(USER_ID);

    expect(bucket.deleted).toEqual([validObjectKey]);
    expect(bucket.objects.has(validObjectKey)).toBe(false);
    expect(durable.storageValues.has(malformedCandidateKey)).toBe(false);
    expect(durable.storageValues.has(validCandidateKey)).toBe(false);
    expect(stateStore.boundUsers).toEqual([USER_ID]);
  });

  it("does not log malformed orphan candidate keys when invalid-record discard fails", async () => {
    const malformedCandidateKey = workspaceSnapshotOrphanCandidateStorageKey("bad");
    const durable = createDurableObjectHarness({
      deleteFailures: new Map([
        [
          malformedCandidateKey,
          new Error(`Storage delete failed for ${malformedCandidateKey}`),
        ],
      ]),
    });
    const stateStore = createBindOnlyStateStore();
    const bucket = new ListableMemoryEncryptedR2Bucket();
    const validCandidateKey = workspaceSnapshotOrphanCandidateStorageKey("valid");
    const validObjectKey = "users/snapshots/member_cleanup_test/orphan.snapshot.enc";
    durable.storageValues.set(malformedCandidateKey, {
      schema: "wrong",
    });
    durable.storageValues.set(validCandidateKey, {
      createdAt: "2026-04-26T00:00:00.000Z",
      objectKey: validObjectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
      snapshotId: "valid",
      userId: USER_ID,
    });
    await bucket.put(validObjectKey, "encrypted-snapshot");
    const service = createWorkspaceSnapshotSessionService({
      bucket,
      runnerStoreCache: createUnusedRunnerStoreCache(),
      state: durable.state,
      stateStore,
      readHostedWorkspaceFromWeb: async (userId) => ({
        fetchedAt: NOW,
        workspace: createWorkspaceState(userId),
      }),
      assertWorkspaceBelongsToRunnerUser(workspace, userId) {
        if (workspace?.userId !== userId) {
          throw new Error("Workspace user mismatch.");
        }
      },
    });

    await service.cleanupOrphanCandidates(USER_ID);

    expect(bucket.deleted).toEqual([validObjectKey]);
    expect(durable.storageValues.has(malformedCandidateKey)).toBe(true);
    expect(durable.storageValues.has(validCandidateKey)).toBe(false);
    const serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain(malformedCandidateKey);
    expect(serializedLogs).not.toContain("Storage delete failed for");
  });
});

function createDeletionStateStore(input: {
  activeAttemptId?: string | null;
  deleted?: boolean;
  runnerContainerName?: string | null;
} = {}): {
  assertStateForUser(userId: string): Promise<void>;
  clearWriteFenceForUserControl(userId: string): Promise<{
    attemptId: string | null;
    cleared: boolean;
    runnerContainerName: string | null;
  }>;
  deleteStateCallCount: number;
  deleteStateForUser(userId: string): Promise<{ deleted: boolean }>;
  readonly runnerContainerName: string | null;
} {
  let activeAttemptId = input.activeAttemptId ?? null;
  let deleteStateCallCount = 0;
  let runnerContainerName = input.runnerContainerName ?? null;
  return {
    async assertStateForUser(userId) {
      expect(userId).toBe(USER_ID);
    },
    async clearWriteFenceForUserControl(userId) {
      expect(userId).toBe(USER_ID);
      const attemptId = activeAttemptId;
      const cleared = attemptId !== null;
      if (cleared) {
        activeAttemptId = null;
        runnerContainerName ??= userId;
      }
      return {
        attemptId,
        cleared,
        runnerContainerName,
      };
    },
    get deleteStateCallCount() {
      return deleteStateCallCount;
    },
    async deleteStateForUser(userId) {
      expect(userId).toBe(USER_ID);
      deleteStateCallCount += 1;
      const deleted = input.deleted ?? true;
      if (deleted) {
        runnerContainerName = null;
      }
      return { deleted };
    },
    get runnerContainerName() {
      return runnerContainerName;
    },
  };
}

function createDestroyOnlyRunnerContainerStub(
  destroyInstance: () => Promise<void>,
): HostedExecutionContainerStubLike {
  return {
    destroyInstance,
    async invoke() {
      return {
        nextWakeAt: null,
        status: "idle",
      };
    },
    async smokeHealth() {
      return {
        ok: true,
        runnerBundle: null,
        service: "runner",
        status: 200,
      };
    },
  };
}

function createBindOnlyStateStore(): {
  bindUser(userId: string): Promise<string>;
  boundUsers: string[];
  validateWriteFenceToken(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<{ owns: false; record: null }>;
} {
  const boundUsers: string[] = [];
  return {
    async bindUser(userId) {
      boundUsers.push(userId);
      return userId;
    },
    boundUsers,
    async validateWriteFenceToken() {
      return {
        owns: false,
        record: null,
      };
    },
  };
}

function createOwningSnapshotStateStore(): {
  bindUser(userId: string): Promise<string>;
  validateWriteFenceToken(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<{ owns: true; record: null }>;
} {
  return {
    async bindUser(userId) {
      return userId;
    },
    async validateWriteFenceToken() {
      return {
        owns: true,
        record: null,
      };
    },
  };
}

function createUnusedRunnerStoreCache() {
  return {
    async ensure(): Promise<never> {
      throw new Error("V2 orphan cleanup must not load runtime stores.");
    },
  };
}

function createWorkspaceState(userId: string): HostedWorkspaceState {
  return {
    createdAt: NOW,
    snapshotRef: null,
    updatedAt: NOW,
    userId,
    version: "1",
  };
}

class ListableMemoryEncryptedR2Bucket extends MemoryEncryptedR2Bucket {
  readonly deleteBatches: string[][] = [];
  readonly listCalls: string[] = [];

  override async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    this.deleteBatches.push(keys);
    await super.delete(keys);
  }

  async list(input: {
    cursor?: string;
    limit?: number;
    prefix?: string;
  }): Promise<{
    cursor?: string;
    objects: Array<{ key: string }>;
    truncated: boolean;
  }> {
    this.listCalls.push(input.prefix ?? "");
    const matchingKeys = [...this.objects.keys()]
      .filter((key) => input.prefix ? key.startsWith(input.prefix) : true)
      .sort();
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const limit = input.limit ?? 1_000;
    const pageKeys = matchingKeys.slice(offset, offset + limit);
    const nextOffset = offset + pageKeys.length;
    const truncated = nextOffset < matchingKeys.length;

    return {
      ...(truncated ? { cursor: String(nextOffset) } : {}),
      objects: pageKeys.map((key) => ({ key })),
      truncated,
    };
  }
}

class FailingDeleteListableR2Bucket extends ListableMemoryEncryptedR2Bucket {
  constructor(private readonly failedKey: string) {
    super();
  }

  override async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const item of keys) {
      if (item === this.failedKey) {
        throw new Error(`R2 delete failed for ${item}`);
      }
      await super.delete(item);
    }
  }
}

class LateWriteListableR2Bucket extends ListableMemoryEncryptedR2Bucket {
  private targetPrefixListCount = 0;

  constructor(
    private readonly targetPrefix: string,
    private readonly lateKey: string,
  ) {
    super();
  }

  override async list(input: {
    cursor?: string;
    limit?: number;
    prefix?: string;
  }): Promise<{
    cursor?: string;
    objects: Array<{ key: string }>;
    truncated: boolean;
  }> {
    const result = await super.list(input);
    if (input.prefix === this.targetPrefix) {
      this.targetPrefixListCount += 1;
      if (this.targetPrefixListCount === 2) {
        await this.put(this.lateKey, "late");
      }
    }
    return result;
  }
}

class FailingListableR2Bucket extends ListableMemoryEncryptedR2Bucket {
  override async list(input: {
    cursor?: string;
    limit?: number;
    prefix?: string;
  }): Promise<{
    cursor?: string;
    objects: Array<{ key: string }>;
    truncated: boolean;
  }> {
    throw new Error(`R2 list failed for ${input.prefix ?? "<none>"}`);
  }
}

function createDurableObjectHarness(input: {
  deleteAllError?: Error;
  deleteFailures?: ReadonlyMap<string, Error>;
} = {}): {
  alarmDeleteCount: number;
  deleteAllCount: number;
  state: DurableObjectStateLike;
  storageValues: Map<string, unknown>;
} {
  let alarmDeleteCount = 0;
  let deleteAllCount = 0;
  const storageValues = new Map<string, unknown>();
  const storage: DurableObjectStorageLike = {
    delete: async (key) => {
      const failure = input.deleteFailures?.get(key);
      if (failure) {
        throw failure;
      }
      return storageValues.delete(key);
    },
    deleteAll: async () => {
      deleteAllCount += 1;
      if (input.deleteAllError && deleteAllCount === 1) {
        throw input.deleteAllError;
      }
      storageValues.clear();
    },
    deleteAlarm: async () => {
      alarmDeleteCount += 1;
    },
    get: async <T>(key: string): Promise<T | undefined> => {
      const value = storageValues.get(key);
      return value === undefined ? undefined : value as T;
    },
    getAlarm: async () => null,
    list: async <T>(options: { prefix?: string } = {}): Promise<Map<string, T>> => {
      const result = new Map<string, T>();
      for (const [key, value] of storageValues) {
        if (!options.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T);
        }
      }
      return result;
    },
    put: async <T>(key: string, value: T): Promise<void> => {
      storageValues.set(key, value);
    },
    setAlarm: async () => {},
  };

  return {
    get alarmDeleteCount() {
      return alarmDeleteCount;
    },
    get deleteAllCount() {
      return deleteAllCount;
    },
    state: {
      storage,
      waitUntil() {},
    },
    storageValues,
  };
}
