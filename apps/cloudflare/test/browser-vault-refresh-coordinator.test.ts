import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BrowserVaultRefreshCoordinator,
  type BrowserVaultRefreshCoordinatorStateStore,
} from "../src/browser-vault-refresh/coordinator.ts";
import type {
  DurableObjectStateLike,
  RunnerStateRecord,
} from "../src/user-runner/types.ts";

describe("BrowserVaultRefreshCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules a continuation when foreground work blocks immediate refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));

    const alarmWrites: string[] = [];
    const pendingRefresh = {
      slotId: "refresh-slot",
      updatedAt: "2026-04-27T00:00:00.000Z",
    };
    const record = createRunnerStateRecord({
      inFlight: false,
      pendingNudge: false,
      userId: "member_123",
    });
    const state = {
      storage: {
        delete: vi.fn(async () => true),
        get: vi.fn(async () => undefined),
        getAlarm: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
        setAlarm: vi.fn(async (scheduledTime: number | Date) => {
          alarmWrites.push(new Date(scheduledTime).toISOString());
        }),
      },
    } satisfies DurableObjectStateLike;
    const stateStore = {
      readPendingBrowserVaultRefresh: vi.fn(async () => pendingRefresh),
      readState: vi.fn(async () => record),
      scheduleBrowserVaultRefresh: vi.fn(async () => ({ deduped: false })),
    } satisfies BrowserVaultRefreshCoordinatorStateStore;
    const runPendingRefresh = vi.fn(async () => undefined);
    const syncStoredRunnerAlarm = vi.fn(async () => undefined);

    const coordinator = new BrowserVaultRefreshCoordinator({
      continuationDelayMs: 50,
      destroyActiveRefreshContainer: vi.fn(() => null),
      hasForegroundWork: () => true,
      readStateForRetryScheduling: vi.fn(async () => record),
      retryDelayMs: 30_000,
      runPendingRefresh,
      state,
      stateStore,
      syncStoredRunnerAlarm,
    });

    await expect(coordinator.schedulePending({ userId: "member_123" }))
      .resolves.toBe(false);

    expect(runPendingRefresh).not.toHaveBeenCalled();
    expect(state.storage.setAlarm).toHaveBeenCalledOnce();
    expect(alarmWrites).toEqual(["2026-04-27T00:00:00.050Z"]);
    expect(syncStoredRunnerAlarm).not.toHaveBeenCalled();
  });

  it("ignores stale existing alarms when scheduling a blocked refresh continuation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));

    const pendingRefresh = {
      slotId: "refresh-slot",
      updatedAt: "2026-04-27T00:00:00.000Z",
    };
    const record = createRunnerStateRecord({
      inFlight: false,
      pendingNudge: false,
      userId: "member_123",
    });
    const state = {
      storage: {
        delete: vi.fn(async () => true),
        get: vi.fn(async () => undefined),
        getAlarm: vi.fn(async () => Date.parse("2026-04-26T23:59:59.999Z")),
        put: vi.fn(async () => undefined),
        setAlarm: vi.fn(async () => undefined),
      },
    } satisfies DurableObjectStateLike;
    const stateStore = {
      readPendingBrowserVaultRefresh: vi.fn(async () => pendingRefresh),
      readState: vi.fn(async () => record),
      scheduleBrowserVaultRefresh: vi.fn(async () => ({ deduped: false })),
    } satisfies BrowserVaultRefreshCoordinatorStateStore;

    const coordinator = new BrowserVaultRefreshCoordinator({
      continuationDelayMs: 50,
      destroyActiveRefreshContainer: vi.fn(() => null),
      hasForegroundWork: () => true,
      readStateForRetryScheduling: vi.fn(async () => record),
      retryDelayMs: 30_000,
      runPendingRefresh: vi.fn(async () => undefined),
      state,
      stateStore,
      syncStoredRunnerAlarm: vi.fn(async () => undefined),
    });

    await expect(coordinator.schedulePending({ userId: "member_123" }))
      .resolves.toBe(false);

    expect(state.storage.setAlarm).toHaveBeenCalledOnce();
    expect(state.storage.setAlarm).toHaveBeenCalledWith(
      new Date("2026-04-27T00:00:00.050Z"),
    );
  });

  it("restores the stored runner alarm when post-foreground drain starts refresh early", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));

    let hasForegroundWork = true;
    const pendingRefreshRecord = {
      slotId: "refresh-slot",
      updatedAt: "2026-04-27T00:00:00.000Z",
    };
    let pendingRefresh: typeof pendingRefreshRecord | null = pendingRefreshRecord;
    const record = createRunnerStateRecord({
      inFlight: false,
      pendingNudge: false,
      userId: "member_123",
    });
    const waitUntilPromises: Promise<unknown>[] = [];
    const state = {
      storage: {
        delete: vi.fn(async () => true),
        get: vi.fn(async () => undefined),
        getAlarm: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
        setAlarm: vi.fn(async () => undefined),
      },
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
        void promise.catch(() => undefined);
      },
    } satisfies DurableObjectStateLike;
    const stateStore = {
      readPendingBrowserVaultRefresh: vi.fn(async () => pendingRefresh),
      readState: vi.fn(async () => record),
      scheduleBrowserVaultRefresh: vi.fn(async () => ({ deduped: false })),
    } satisfies BrowserVaultRefreshCoordinatorStateStore;
    const activeRefresh = createDeferred<void>();
    let refreshSignal: AbortSignal | undefined;
    const runPendingRefresh = vi.fn(async (input: {
      signal: AbortSignal;
      userId: string;
    }) => {
      refreshSignal = input.signal;
      await activeRefresh.promise;
      pendingRefresh = null;
    });
    const syncStoredRunnerAlarm = vi.fn(async () => undefined);

    const coordinator = new BrowserVaultRefreshCoordinator({
      continuationDelayMs: 50,
      destroyActiveRefreshContainer: vi.fn(() => null),
      hasForegroundWork: () => hasForegroundWork,
      readStateForRetryScheduling: vi.fn(async () => record),
      retryDelayMs: 30_000,
      runPendingRefresh,
      state,
      stateStore,
      syncStoredRunnerAlarm,
    });

    await expect(coordinator.schedulePending({ userId: "member_123" }))
      .resolves.toBe(false);
    expect(state.storage.setAlarm).toHaveBeenCalledOnce();

    hasForegroundWork = false;
    await coordinator.drainAfterForegroundWork();

    expect(runPendingRefresh).toHaveBeenCalledOnce();
    expect(syncStoredRunnerAlarm).toHaveBeenCalledOnce();

    activeRefresh.resolve();
    await Promise.all(waitUntilPromises);
  });

  it("aborts and destroys the active refresh container when foreground work preempts a refresh", async () => {
    const pendingRefresh = {
      slotId: "refresh-slot",
      updatedAt: "2026-04-27T00:00:00.000Z",
    };
    const record = createRunnerStateRecord({
      inFlight: false,
      pendingNudge: false,
      userId: "member_123",
    });
    const waitUntilPromises: Promise<unknown>[] = [];
    const state = {
      storage: {
        delete: vi.fn(async () => true),
        get: vi.fn(async () => undefined),
        getAlarm: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
        setAlarm: vi.fn(async () => undefined),
      },
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
        void promise.catch(() => undefined);
      }),
    } satisfies DurableObjectStateLike;
    const stateStore = {
      readPendingBrowserVaultRefresh: vi.fn(async () => pendingRefresh),
      readState: vi.fn(async () => record),
      scheduleBrowserVaultRefresh: vi.fn(async () => ({ deduped: false })),
    } satisfies BrowserVaultRefreshCoordinatorStateStore;
    const activeRefresh = createDeferred<void>();
    let refreshSignal: AbortSignal | undefined;
    const runPendingRefresh = vi.fn(async (input: {
      signal: AbortSignal;
      userId: string;
    }) => {
      refreshSignal = input.signal;
      await activeRefresh.promise;
    });
    const destroyActiveRefreshContainer = vi.fn(async () => undefined);
    const syncStoredRunnerAlarm = vi.fn(async () => undefined);

    const coordinator = new BrowserVaultRefreshCoordinator({
      continuationDelayMs: 50,
      destroyActiveRefreshContainer,
      hasForegroundWork: () => false,
      readStateForRetryScheduling: vi.fn(async () => record),
      retryDelayMs: 30_000,
      runPendingRefresh,
      state,
      stateStore,
      syncStoredRunnerAlarm,
    });

    await expect(coordinator.schedulePending({ userId: "member_123" }))
      .resolves.toBe(true);

    coordinator.abortForForegroundWork({
      reason: "pending_nudge",
      userId: "member_123",
    });

    expect(refreshSignal?.aborted).toBe(true);
    expect(destroyActiveRefreshContainer).toHaveBeenCalledWith({
      userId: "member_123",
    });
    expect(state.waitUntil).toHaveBeenCalledTimes(2);

    activeRefresh.resolve();
    await Promise.all(waitUntilPromises);
  });
});

function createRunnerStateRecord(
  overrides: Partial<RunnerStateRecord> = {},
): RunnerStateRecord {
  return {
    bundleRef: null,
    idleShutdownCheckpointDueAt: null,
    idleShutdownCheckpointWorkspaceVersion: null,
    inFlight: false,
    lastError: null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastInvocationAt: null,
    leaseGeneration: 0,
    nextWakeAt: null,
    pendingNudge: false,
    retryFailureCount: 0,
    userId: "member_123",
    workspaceInvocation: null,
    ...overrides,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
