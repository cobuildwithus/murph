import type { HostedWorkspaceState } from "@murphai/hosted-execution/runtime-control";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hostedBundleUserPrefix } from "../src/storage-paths.js";
import {
  HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
} from "../src/workspace-snapshot-store.js";
import {
  deleteHostedRunnerUserData,
} from "../src/user-runner/user-data-deletion.js";
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
    const serializedLogs = JSON.stringify(
      hostedExecutionMocks.emitHostedExecutionStructuredLog.mock.calls,
    );
    expect(serializedLogs).not.toContain(leakedPrefix);
    expect(serializedLogs).not.toContain("R2 list failed for");
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

function createDeletionStateStore(): {
  assertStateForUser(userId: string): Promise<void>;
  clearWriteFenceForUserDeletion(userId: string): Promise<{
    attemptId: string | null;
    cleared: boolean;
  }>;
  deleteStateCallCount: number;
  deleteStateForUser(userId: string): Promise<{ deleted: boolean }>;
} {
  let deleteStateCallCount = 0;
  return {
    async assertStateForUser(userId) {
      expect(userId).toBe(USER_ID);
    },
    async clearWriteFenceForUserDeletion(userId) {
      expect(userId).toBe(USER_ID);
      return {
        attemptId: null,
        cleared: false,
      };
    },
    get deleteStateCallCount() {
      return deleteStateCallCount;
    },
    async deleteStateForUser(userId) {
      expect(userId).toBe(USER_ID);
      deleteStateCallCount += 1;
      return { deleted: true };
    },
  };
}

function createBindOnlyStateStore(): {
  bindUser(userId: string): Promise<string>;
  boundUsers: string[];
} {
  const boundUsers: string[] = [];
  return {
    async bindUser(userId) {
      boundUsers.push(userId);
      return userId;
    },
    boundUsers,
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
  async list(input: {
    cursor?: string;
    limit?: number;
    prefix?: string;
  }): Promise<{
    cursor?: string;
    objects: Array<{ key: string }>;
    truncated: boolean;
  }> {
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

  override async delete(key: string): Promise<void> {
    if (key === this.failedKey) {
      throw new Error(`R2 delete failed for ${key}`);
    }
    await super.delete(key);
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
  deleteFailures?: ReadonlyMap<string, Error>;
} = {}): {
  alarmDeleteCount: number;
  state: DurableObjectStateLike;
  storageValues: Map<string, unknown>;
} {
  let alarmDeleteCount = 0;
  const storageValues = new Map<string, unknown>();
  const storage: DurableObjectStorageLike = {
    delete: async (key) => {
      const failure = input.deleteFailures?.get(key);
      if (failure) {
        throw failure;
      }
      return storageValues.delete(key);
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
    state: {
      storage,
      waitUntil() {},
    },
    storageValues,
  };
}
