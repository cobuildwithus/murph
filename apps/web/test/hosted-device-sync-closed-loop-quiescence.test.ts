import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import type { DeviceSyncService } from "@murphai/device-syncd/service";
import type { DeviceSyncProvider } from "@murphai/device-syncd/types";
import type {
  HostedExecutionDeviceSyncWake,
  HostedExecutionRuntimeTimerWake,
} from "@murphai/hosted-execution";
import {
  closeHostedRuntimeDeviceSyncService,
  createHostedRuntimeDeviceSyncService,
  reconcileHostedDeviceSyncControlPlaneState,
  resolveHostedDeviceSyncSchedulerAccountId,
  resolveHostedDeviceSyncWakeLocalAccountId,
  resolveHostedDeviceSyncWakeRecovery,
  syncHostedDeviceSyncControlPlaneState,
  type HostedRuntimeDeviceSyncPort,
} from "@murphai/assistant-runtime/hosted-device-sync-testkit";

import {
  runHostedDeviceSyncDueReconcileSweeper,
} from "@/src/lib/device-sync/due-reconcile-sweeper";

const SECRET = "closed-loop-device-sync-test-secret";
const USER_ID = "member_closed_loop";
const CONNECTION_ID = "dsc_closed_loop";
const EXTERNAL_ACCOUNT_ID = "external_closed_loop";
const CONNECTED_AT = "2026-05-04T12:00:00.000Z";
const PROVIDER_DUE_AT = "2026-05-05T00:00:00.000Z";
const CHECKPOINT_CYCLES = [
  { at: "2026-05-05T00:00:30.000Z", outcome: "failure" },
  { at: "2026-05-05T00:01:00.000Z", outcome: "failure" },
  { at: "2026-05-05T00:01:30.000Z", outcome: "success" },
] as const;
const GENERIC_TIMER_AT = "2026-05-05T00:01:45.000Z";
const LOCAL_RETRY_AT = "2026-05-05T00:02:00.000Z";
const COMPLETION_FENCE_AT = "2026-05-05T00:02:30.000Z";
const PROVIDER_NEXT_AT = "2026-05-05T01:00:00.000Z";
const LOCAL_JOB_DEDUPE_KEY = "closed-loop:local-retry";

const FINAL_BUCKETS = [
  "2026-05-05T00:05:00.000Z",
  "2026-05-05T00:10:00.000Z",
  "2026-05-05T00:15:00.000Z",
] as const;

type SweeperInput = NonNullable<
  Parameters<typeof runHostedDeviceSyncDueReconcileSweeper>[0]
>;
type SweeperStore = NonNullable<SweeperInput["store"]>;
type ScheduledWakeRequest = NonNullable<SweeperInput["requestWake"]>;
type ScheduledWakeInput = Parameters<ScheduledWakeRequest>[0];
type DueConnection = Awaited<
  ReturnType<SweeperStore["listDueReconcileConnectionsForSweep"]>
>[number];

interface MutableClock {
  now(): Date;
  set(isoTimestamp: string): void;
}

interface SyntheticWebControlPlane {
  readonly acceptedBucketsByCanonicalTuple: ReadonlyMap<string, ReadonlySet<string>>;
  readonly mailbox: ReadonlyMap<string, HostedExecutionDeviceSyncWake>;
  readonly acceptedCanonicalTuples: readonly string[];
  getCanonicalNextReconcileAt(): string | null;
  setCanonicalNextReconcileAt(value: string | null): void;
  sweep(at: string): Promise<{
    acceptedWakes: number;
    dueConnections: number;
  }>;
}

interface CheckpointFaultBoundary {
  readonly attempts: readonly string[];
  readonly dirty: boolean;
  readonly failedAttempts: number;
  readonly persistedWake: HostedExecutionDeviceSyncWake | null;
  markDirty(): void;
  persist(wake: HostedExecutionDeviceSyncWake, attemptedAt: string): void;
}

interface ProviderCounters {
  executions: number;
  schedules: number;
}

interface FinalBucketState {
  acceptedWakes: number;
  dirtyCheckpoints: number;
  providerEffects: number;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("hosted device-sync closed-loop work conservation", () => {
  it("conserves one canonical obligation through local retry, restore, checkpoint faults, and quiescence", async () => {
    vi.useFakeTimers();
    const clock = createMutableClock(PROVIDER_DUE_AT);
    const web = createSyntheticWebControlPlane({
      connectedAt: CONNECTED_AT,
      connectionId: CONNECTION_ID,
      nextReconcileAt: PROVIDER_DUE_AT,
      provider: "demo",
      userId: USER_ID,
    });
    const canonicalSourceObligations = new Set([
      buildCanonicalTuple({
        connectedAt: CONNECTED_AT,
        connectionId: CONNECTION_ID,
        nextReconcileAt: PROVIDER_DUE_AT,
      }),
    ]);
    const counters: ProviderCounters = { executions: 0, schedules: 0 };
    const restoreCount = 1;
    const provider = createSyntheticProvider(counters);
    const checkpoint = createCheckpointFaultBoundary(2);
    const publishedCadences: string[] = [];
    const deviceSyncPort = createSyntheticDeviceSyncPort({
      clock,
      onPublishedCadence(nextReconcileAt) {
        publishedCadences.push(nextReconcileAt);
        web.setCanonicalNextReconcileAt(nextReconcileAt);
      },
      readCanonicalCadence: () => web.getCanonicalNextReconcileAt(),
    });
    const root = await mkdtemp(path.join(tmpdir(), "murph-device-sync-closed-loop-"));
    let warmService: DeviceSyncService | null = null;
    let restoredService: DeviceSyncService | null = null;

    try {
      setClock(clock, PROVIDER_DUE_AT);
      const firstSweep = await web.sweep(PROVIDER_DUE_AT);
      expect(firstSweep).toEqual({ acceptedWakes: 1, dueConnections: 1 });
      const initialWake = requireValue(
        [...web.mailbox.values()][0],
        "The canonical due sweep must append one scheduled wake.",
      );

      warmService = createService({
        clock,
        databasePath: path.join(root, "warm.sqlite"),
        provider,
        vaultRoot: path.join(root, "warm-vault"),
      });
      const warmState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        secret: SECRET,
        service: warmService,
        skipDirtyPendingFetch: true,
        snapshot: buildRuntimeSnapshot(web.getCanonicalNextReconcileAt()),
        wake: initialWake,
      });
      const warmAccountId = requireValue(
        resolveHostedDeviceSyncWakeLocalAccountId({ state: warmState, wake: initialWake }),
        "The scheduled wake must retain exact connection ownership.",
      );
      expect(resolveHostedDeviceSyncSchedulerAccountId({
        state: warmState,
        wake: initialWake,
      })).toBe(warmAccountId);
      expect(await warmService.runSchedulerOnce(warmAccountId)).toHaveLength(1);
      expect(counters).toEqual({ executions: 0, schedules: 1 });
      expect(warmService.getAccount(warmAccountId)?.nextReconcileAt).toBe(PROVIDER_NEXT_AT);
      expect(warmService.getNextJobWakeAt()).toBe(LOCAL_RETRY_AT);

      const retainedRecovery = requireValue(
        resolveHostedDeviceSyncWakeRecovery({
          service: warmService,
          state: warmState,
          wake: initialWake,
        }),
        "The local queued retry must be retained for checkpoint recovery.",
      );
      expect(retainedRecovery.retryAt).toBe(LOCAL_RETRY_AT);
      expect(retainedRecovery.wake.hint).toMatchObject({
        jobs: [{
          availableAt: LOCAL_RETRY_AT,
          dedupeKey: LOCAL_JOB_DEDUPE_KEY,
          kind: "reconcile",
        }],
        nextReconcileAt: PROVIDER_NEXT_AT,
      });

      await reconcileHostedDeviceSyncControlPlaneState({
        deferNextReconcileAtForLocalAccountId: warmAccountId,
        deviceSyncPort,
        secret: SECRET,
        service: warmService,
        state: warmState,
        wake: initialWake,
      });
      expect(web.getCanonicalNextReconcileAt()).toBe(PROVIDER_DUE_AT);
      expect(publishedCadences).toEqual([]);
      checkpoint.markDirty();
      for (const cycle of CHECKPOINT_CYCLES) {
        setClock(clock, cycle.at);
        expect(await web.sweep(cycle.at)).toEqual({
          acceptedWakes: 0,
          dueConnections: 0,
        });
        if (cycle.outcome === "failure") {
          expect(() => checkpoint.persist(
            retainedRecovery.wake,
            cycle.at,
          )).toThrow("synthetic checkpoint write failed");
          continue;
        }
        checkpoint.persist(retainedRecovery.wake, cycle.at);
      }
      expect(checkpoint.dirty).toBe(false);

      setClock(clock, GENERIC_TIMER_AT);
      expect(await web.sweep(GENERIC_TIMER_AT)).toEqual({
        acceptedWakes: 0,
        dueConnections: 0,
      });
      const timerWake = buildRuntimeTimerWake(GENERIC_TIMER_AT);
      const providerEffectsBeforeTimer = totalProviderEffects(counters);
      expect(resolveHostedDeviceSyncWakeLocalAccountId({
        state: warmState,
        wake: timerWake,
      })).toBeNull();
      expect(resolveHostedDeviceSyncSchedulerAccountId({
        state: warmState,
        wake: timerWake,
      })).toBeNull();
      expect(resolveHostedDeviceSyncWakeRecovery({
        service: warmService,
        state: warmState,
        wake: timerWake,
      })).toBeNull();
      expect(warmService.getNextJobWakeAt()).toBe(LOCAL_RETRY_AT);
      expect(totalProviderEffects(counters) - providerEffectsBeforeTimer).toBe(0);

      closeHostedRuntimeDeviceSyncService(warmService);
      warmService = null;

      const restoredWake = requireValue(
        checkpoint.persistedWake,
        "The successful checkpoint must retain the exact queued work.",
      );
      restoredService = createService({
        clock,
        databasePath: path.join(root, "restored.sqlite"),
        provider,
        vaultRoot: path.join(root, "restored-vault"),
      });
      setClock(clock, LOCAL_RETRY_AT);
      expect(await web.sweep(LOCAL_RETRY_AT)).toEqual({
        acceptedWakes: 0,
        dueConnections: 0,
      });
      const restoredState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        secret: SECRET,
        service: restoredService,
        skipDirtyPendingFetch: true,
        snapshot: buildRuntimeSnapshot(web.getCanonicalNextReconcileAt()),
        wake: restoredWake,
      });
      const restoredAccountId = requireValue(
        resolveHostedDeviceSyncWakeLocalAccountId({
          state: restoredState,
          wake: restoredWake,
        }),
        "Cold restore must recover the exact connection-scoped owner.",
      );
      expect(resolveHostedDeviceSyncSchedulerAccountId({
        state: restoredState,
        wake: restoredWake,
      })).toBeNull();
      expect(restoredService.getNextJobWakeAt()).toBe(LOCAL_RETRY_AT);
      expect(await restoredService.drainWorker(25, restoredAccountId)).toBe(1);
      expect(counters).toEqual({ executions: 1, schedules: 1 });

      const completionFence = requireValue(
        resolveHostedDeviceSyncWakeRecovery({
          service: restoredService,
          state: restoredState,
          wake: restoredWake,
        }),
        "Completed local work must retain a completion fence before cadence publication.",
      );
      expect(completionFence.wake.hint).toMatchObject({
        jobs: [],
        nextReconcileAt: PROVIDER_NEXT_AT,
        reason: "retained_completion_fence",
      });
      expect(completionFence.retryAt).toBe(COMPLETION_FENCE_AT);

      checkpoint.markDirty();
      setClock(clock, COMPLETION_FENCE_AT);
      checkpoint.persist(completionFence.wake, COMPLETION_FENCE_AT);
      const finalState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        secret: SECRET,
        service: restoredService,
        skipDirtyPendingFetch: true,
        snapshot: buildRuntimeSnapshot(web.getCanonicalNextReconcileAt()),
        wake: completionFence.wake,
      });
      expect(resolveHostedDeviceSyncSchedulerAccountId({
        state: finalState,
        wake: completionFence.wake,
      })).toBeNull();
      expect(resolveHostedDeviceSyncWakeRecovery({
        service: restoredService,
        state: finalState,
        wake: completionFence.wake,
      })).toBeNull();

      await reconcileHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        secret: SECRET,
        service: restoredService,
        state: finalState,
        wake: completionFence.wake,
      });
      expect(web.getCanonicalNextReconcileAt()).toBe(PROVIDER_NEXT_AT);
      expect(publishedCadences).toEqual([PROVIDER_NEXT_AT]);

      const finalStates: FinalBucketState[] = [];
      for (const bucket of FINAL_BUCKETS) {
        setClock(clock, bucket);
        const providerEffectsBefore = totalProviderEffects(counters);
        const sweep = await web.sweep(bucket);
        finalStates.push({
          acceptedWakes: sweep.acceptedWakes,
          dirtyCheckpoints: checkpoint.dirty ? 1 : 0,
          providerEffects: totalProviderEffects(counters) - providerEffectsBefore,
        });
      }
      expect(finalStates).toEqual(FINAL_BUCKETS.map(() => ({
        acceptedWakes: 0,
        dirtyCheckpoints: 0,
        providerEffects: 0,
      })));

      assertWorkConservation({
        acceptedBucketsByCanonicalTuple: web.acceptedBucketsByCanonicalTuple,
        canonicalSourceObligations,
        localOnlyTimes: [
          ...CHECKPOINT_CYCLES.map((cycle) => cycle.at),
          GENERIC_TIMER_AT,
          LOCAL_RETRY_AT,
          COMPLETION_FENCE_AT,
        ],
        acceptedCanonicalTuples: web.acceptedCanonicalTuples,
      });
      expect(web.mailbox.size).toBe(1);
      expect(counters).toEqual({ executions: 1, schedules: 1 });
      expect(checkpoint.failedAttempts).toBe(2);
      expect(checkpoint.attempts).toHaveLength(
        web.acceptedCanonicalTuples.length + checkpoint.failedAttempts + restoreCount,
      );
    } finally {
      if (warmService) {
        closeHostedRuntimeDeviceSyncService(warmService);
      }
      if (restoredService) {
        closeHostedRuntimeDeviceSyncService(restoredService);
      }
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects projecting a local retry into the canonical provider cadence", async () => {
    vi.useFakeTimers();
    const clock = createMutableClock(PROVIDER_DUE_AT);
    const web = createSyntheticWebControlPlane({
      connectedAt: CONNECTED_AT,
      connectionId: CONNECTION_ID,
      nextReconcileAt: PROVIDER_DUE_AT,
      provider: "demo",
      userId: USER_ID,
    });
    const canonicalSourceObligations = new Set([
      buildCanonicalTuple({
        connectedAt: CONNECTED_AT,
        connectionId: CONNECTION_ID,
        nextReconcileAt: PROVIDER_DUE_AT,
      }),
    ]);

    setClock(clock, PROVIDER_DUE_AT);
    expect(await web.sweep(PROVIDER_DUE_AT)).toEqual({
      acceptedWakes: 1,
      dueConnections: 1,
    });

    web.setCanonicalNextReconcileAt(LOCAL_RETRY_AT);
    setClock(clock, LOCAL_RETRY_AT);
    expect(await web.sweep(LOCAL_RETRY_AT)).toEqual({
      acceptedWakes: 1,
      dueConnections: 1,
    });
    expect(web.mailbox.size).toBe(2);

    expect(() => assertWorkConservation({
      acceptedBucketsByCanonicalTuple: web.acceptedBucketsByCanonicalTuple,
      canonicalSourceObligations,
      localOnlyTimes: [LOCAL_RETRY_AT],
      acceptedCanonicalTuples: web.acceptedCanonicalTuples,
    })).toThrow("accepted scheduled wakes exceeded canonical provider obligations");
  });
});

function createMutableClock(initialTimestamp: string): MutableClock {
  let current = new Date(initialTimestamp);

  return {
    now: () => new Date(current),
    set(isoTimestamp) {
      current = new Date(isoTimestamp);
    },
  };
}

function setClock(clock: MutableClock, isoTimestamp: string): void {
  clock.set(isoTimestamp);
  vi.setSystemTime(new Date(isoTimestamp));
}

// This is the one-connection projection of the production SQL selector and
// mailbox dedupe semantics; the sweeper and scheduled event identity are real.
function createSyntheticWebControlPlane(
  connection: DueConnection,
): SyntheticWebControlPlane {
  let canonicalNextReconcileAt: string | null = connection.nextReconcileAt;
  let activeRecoveryBucket: string | null = null;
  const signals: Array<{ createdAt: string; nextReconcileAt: string }> = [];
  const mailbox = new Map<string, HostedExecutionDeviceSyncWake>();
  const acceptedCanonicalTuples: string[] = [];
  const acceptedBucketsByCanonicalTuple = new Map<string, Set<string>>();

  const store: SweeperStore = {
    async listDueReconcileConnectionsForSweep(input) {
      activeRecoveryBucket = input.recoveryBucketStartedAt.toISOString();
      if (
        canonicalNextReconcileAt === null
        || Date.parse(canonicalNextReconcileAt) > input.dueAt.getTime()
        || signals.some((signal) =>
          signal.nextReconcileAt === canonicalNextReconcileAt
          && Date.parse(signal.createdAt) >= input.recoveryBucketStartedAt.getTime()
        )
      ) {
        return [];
      }

      return [{
        ...connection,
        nextReconcileAt: canonicalNextReconcileAt,
      }];
    },
  };
  const requestWake: ScheduledWakeRequest = async (input) => {
    const duplicate = mailbox.has(input.eventId);
    const canonicalTuple = buildCanonicalTuple({
      connectedAt: input.expectedConnectedAt,
      connectionId: input.connectionId,
      nextReconcileAt: input.nextReconcileAt,
    });
    acceptedCanonicalTuples.push(canonicalTuple);
    signals.push({
      createdAt: input.createdAt,
      nextReconcileAt: input.nextReconcileAt,
    });

    const acceptedBuckets = acceptedBucketsByCanonicalTuple.get(canonicalTuple)
      ?? new Set<string>();
    acceptedBuckets.add(requireValue(
      activeRecoveryBucket,
      "The due selector must establish a recovery bucket before wake append.",
    ));
    acceptedBucketsByCanonicalTuple.set(canonicalTuple, acceptedBuckets);

    if (!duplicate) {
      mailbox.set(input.eventId, buildScheduledWake(input));
    }

    return {
      wakeAccepted: true,
      wakeAppended: !duplicate,
      wakeDuplicate: duplicate,
      wakeInserted: !duplicate,
    };
  };

  return {
    acceptedBucketsByCanonicalTuple,
    mailbox,
    acceptedCanonicalTuples,
    getCanonicalNextReconcileAt: () => canonicalNextReconcileAt,
    setCanonicalNextReconcileAt(value) {
      canonicalNextReconcileAt = value;
    },
    async sweep(at) {
      const result = await runHostedDeviceSyncDueReconcileSweeper({
        logger: {
          info() {},
          warn() {},
        },
        now: new Date(at),
        requestWake,
        store,
        wakeLimit: 1,
      });
      return {
        acceptedWakes: result.wakeAccepted,
        dueConnections: result.dueConnections,
      };
    },
  };
}

function buildScheduledWake(input: ScheduledWakeInput): HostedExecutionDeviceSyncWake {
  return {
    connectionId: input.connectionId,
    eventId: input.eventId,
    expectedConnectedAt: input.expectedConnectedAt,
    hint: {
      nextReconcileAt: input.nextReconcileAt,
      occurredAt: input.nextReconcileAt,
      traceId: input.traceId ?? null,
    },
    kind: "device-sync.wake",
    occurredAt: input.nextReconcileAt,
    provider: input.provider,
    reason: "reconcile_due",
    userId: input.userId,
  };
}

function buildRuntimeTimerWake(occurredAt: string): HostedExecutionRuntimeTimerWake {
  return {
    eventId: "runtime-timer:closed-loop",
    kind: "runtime.timer",
    occurredAt,
    triggerKind: "runtime_timer",
    userId: USER_ID,
  };
}

function buildRuntimeSnapshot(
  nextReconcileAt: string | null,
): HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  return {
    connections: [{
      connection: {
        accessTokenExpiresAt: null,
        connectedAt: CONNECTED_AT,
        createdAt: CONNECTED_AT,
        displayName: "Synthetic closed-loop device",
        externalAccountId: EXTERNAL_ACCOUNT_ID,
        id: CONNECTION_ID,
        metadata: {},
        provider: "demo",
        scopes: [],
        status: "active",
        updatedAt: CONNECTED_AT,
      },
      credential: {
        credentialMetadata: {},
        kind: "none",
      },
      localState: {
        lastErrorCode: null,
        lastErrorMessage: null,
        lastSyncCompletedAt: null,
        lastSyncErrorAt: null,
        lastSyncStartedAt: null,
        lastWebhookAt: null,
        nextReconcileAt,
      },
    }],
    generatedAt: PROVIDER_DUE_AT,
    userId: USER_ID,
  };
}

function createSyntheticProvider(counters: ProviderCounters): DeviceSyncProvider {
  return {
    descriptor: {
      displayName: "Synthetic closed-loop provider",
      normalization: {
        metricFamilies: ["activity"],
        snapshotParser: "schema",
      },
      oauth: {
        callbackPath: "/oauth/demo/callback",
        defaultScopes: [],
      },
      provider: "demo",
      sourcePriorityHints: {
        defaultPriority: 50,
        metricFamilies: { activity: 50 },
      },
      transportModes: ["scheduled_poll"],
      webhook: {
        deliveryMode: "notification",
        path: "/webhooks/demo",
        supportsAdmin: false,
      },
    },
    connectionHandler: {
      async beginConnection() {
        throw new Error("Connection setup is outside this closed-loop proof.");
      },
      async completeConnection() {
        throw new Error("Connection completion is outside this closed-loop proof.");
      },
      async refreshTokens() {
        throw new Error("Token refresh is outside this closed-loop proof.");
      },
    },
    jobExecutor: {
      createScheduledJobs(account, now) {
        counters.schedules += 1;
        expect(account.nextReconcileAt).toBe(PROVIDER_DUE_AT);
        expect(now).toBe(PROVIDER_DUE_AT);
        return {
          jobs: [{
            availableAt: LOCAL_RETRY_AT,
            dedupeKey: LOCAL_JOB_DEDUPE_KEY,
            kind: "reconcile",
            maxAttempts: 3,
            priority: 25,
          }],
          nextReconcileAt: PROVIDER_NEXT_AT,
        };
      },
      async executeJob(context, job) {
        counters.executions += 1;
        expect(context.now).toBe(LOCAL_RETRY_AT);
        expect(job.dedupeKey).toBe(LOCAL_JOB_DEDUPE_KEY);
        return {};
      },
    },
    provider: "demo",
  };
}

function createService(input: {
  clock: MutableClock;
  databasePath: string;
  provider: DeviceSyncProvider;
  vaultRoot: string;
}): DeviceSyncService {
  return createHostedRuntimeDeviceSyncService({
    clock: input.clock,
    config: {
      publicBaseUrl: "https://sync.example.test/device-sync",
      stateDatabasePath: input.databasePath,
      vaultRoot: input.vaultRoot,
    },
    providers: [input.provider],
    secret: SECRET,
  });
}

function createSyntheticDeviceSyncPort(input: {
  clock: MutableClock;
  onPublishedCadence(nextReconcileAt: string): void;
  readCanonicalCadence(): string | null;
}): HostedRuntimeDeviceSyncPort {
  return {
    async ackDirtyStateProcessed() {
      throw new Error("Dirty-state acknowledgement is outside this closed-loop proof.");
    },
    async applyUpdates(request) {
      for (const update of request.updates) {
        if (
          update.localState
          && "nextReconcileAt" in update.localState
          && typeof update.localState.nextReconcileAt === "string"
        ) {
          input.onPublishedCadence(update.localState.nextReconcileAt);
        }
      }
      return {
        appliedAt: input.clock.now().toISOString(),
        updates: [],
        userId: USER_ID,
      };
    },
    async createConnectLink() {
      throw new Error("Connection creation is outside this closed-loop proof.");
    },
    async fetchDirtyStates() {
      return {
        hasMore: false,
        items: [],
        nextWakeAt: null,
        userId: USER_ID,
      };
    },
    async fetchSnapshot() {
      return buildRuntimeSnapshot(input.readCanonicalCadence());
    },
  };
}

// Workspace archive persistence stays a fault seam so this proof does not
// introduce a second hosted-workspace harness around the runtime decisions.
function createCheckpointFaultBoundary(
  injectedFailures: number,
): CheckpointFaultBoundary {
  let dirty = false;
  let failuresRemaining = injectedFailures;
  let persistedWake: HostedExecutionDeviceSyncWake | null = null;
  const attempts: string[] = [];

  return {
    get attempts() {
      return attempts;
    },
    get dirty() {
      return dirty;
    },
    get failedAttempts() {
      return injectedFailures - failuresRemaining;
    },
    get persistedWake() {
      return persistedWake;
    },
    markDirty() {
      dirty = true;
    },
    persist(wake, attemptedAt) {
      if (!dirty) {
        throw new Error("Synthetic checkpoint must be dirty before persistence.");
      }
      attempts.push(attemptedAt);
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error("synthetic checkpoint write failed");
      }
      persistedWake = structuredClone(wake);
      dirty = false;
    },
  };
}

function assertWorkConservation(input: {
  acceptedBucketsByCanonicalTuple: ReadonlyMap<string, ReadonlySet<string>>;
  canonicalSourceObligations: ReadonlySet<string>;
  localOnlyTimes: readonly string[];
  acceptedCanonicalTuples: readonly string[];
}): void {
  if (input.acceptedCanonicalTuples.length > input.canonicalSourceObligations.size) {
    throw new Error("accepted scheduled wakes exceeded canonical provider obligations");
  }

  for (const tuple of input.acceptedCanonicalTuples) {
    if (!input.canonicalSourceObligations.has(tuple)) {
      throw new Error("accepted scheduled wake was not a canonical provider obligation");
    }
  }

  for (const buckets of input.acceptedBucketsByCanonicalTuple.values()) {
    if (buckets.size > 1) {
      throw new Error("an unchanged canonical provider tuple was accepted in multiple buckets");
    }
  }

  for (const localOnlyTime of input.localOnlyTimes) {
    if (input.acceptedCanonicalTuples.some((tuple) => tuple.endsWith(`|${localOnlyTime}`))) {
      throw new Error("a local execution clock became a canonical source obligation");
    }
  }
}

function buildCanonicalTuple(input: {
  connectedAt: string;
  connectionId: string;
  nextReconcileAt: string;
}): string {
  return `${input.connectionId}|${input.connectedAt}|${input.nextReconcileAt}`;
}

function totalProviderEffects(counters: ProviderCounters): number {
  return counters.schedules + counters.executions;
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}
