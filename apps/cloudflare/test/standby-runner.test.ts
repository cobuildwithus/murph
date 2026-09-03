import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { HOSTED_RUNTIME_ARCHITECTURE_VERSION } from "../src/hosted-runtime-architecture.js";
import { destroyHostedExecutionContainer } from "../src/runner-container.js";
import { StandbyRunnerContainer } from "../src/standby-runner-container.js";
import {
  HOSTED_STANDBY_LOCATION_HINT,
  HOSTED_STANDBY_ORPHAN_GRACE_MS,
  HOSTED_STANDBY_REGION,
  HOSTED_STANDBY_RETRY_MS,
  createHostedRunnerContainerNamespaceRouter,
  createHostedStandbyClaimId,
  createHostedStandbySlotName,
  isHostedStandbySlotName,
  readHostedStandbyMode,
  resolveHostedStandbyCoordinatorName,
  type HostedStandbyRunnerContainerStubLike,
  type HostedStandbySlotBinding,
} from "../src/standby-runner-contract.js";
import { StandbyRunnerCoordinatorDurableObject } from "../src/worker/standby-runner-coordinator-durable-object.js";
import { handleStandbyRunnerScheduled } from "../src/worker/index.js";
import type {
  DurableObjectSqlCursorLike,
  DurableObjectSqlStorageLike,
  DurableObjectSqlValue,
  DurableObjectStateLike,
} from "../src/user-runner/types.js";

const RELEASE_ID = "release_1";
const BUNDLE_FINGERPRINT = "bundle-fingerprint";
const SOURCE_FINGERPRINT = "source-fingerprint";
const CLAIMED_AT_MS = Date.UTC(2026, 7, 31, 12);

afterEach(() => {
  vi.useRealTimers();
});

describe("hosted standby contract", () => {
  it("parses rollout modes strictly and creates opaque release-scoped identities", () => {
    expect(readHostedStandbyMode({})).toBe("off");
    expect(readHostedStandbyMode({ HOSTED_EXECUTION_STANDBY_MODE: "shadow" }))
      .toBe("shadow");
    expect(readHostedStandbyMode({ HOSTED_EXECUTION_STANDBY_MODE: "allocate" }))
      .toBe("allocate");
    expect(() => readHostedStandbyMode({ HOSTED_EXECUTION_STANDBY_MODE: "on" }))
      .toThrow("must be off, shadow, or allocate");

    const slotName = createHostedStandbySlotName(RELEASE_ID);
    expect(isHostedStandbySlotName(slotName)).toBe(true);
    expect(slotName).not.toContain("member");
    expect(resolveHostedStandbyCoordinatorName({
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
    })).toBe("standby-coordinator--v-release_1--r-enam");
  });

  it("routes only opaque standby names through the standby namespace", () => {
    const exactStub = createSlotStub("exact");
    const standbyStub = createSlotStub("standby");
    const exactGet = vi.fn(() => exactStub);
    const standbyGet = vi.fn(() => standbyStub);
    const router = createHostedRunnerContainerNamespaceRouter({
      exactUser: { getByName: exactGet },
      standby: { getByName: standbyGet },
    });
    if (!router) {
      throw new Error("Expected a routed container namespace.");
    }
    const standbyName = createHostedStandbySlotName(RELEASE_ID);

    expect(router.getByName("member_123")).toBe(exactStub);
    expect(router.getByName(standbyName)).toBe(standbyStub);
    expect(exactGet).toHaveBeenCalledWith("member_123");
    expect(standbyGet).toHaveBeenCalledWith(standbyName, {
      locationHint: HOSTED_STANDBY_LOCATION_HINT,
    });
  });
});

describe("StandbyRunnerContainer", () => {
  it("proves heavy hydration and a content-free Codex initialize/stop preflight before binding once", async () => {
    const harness = createStandbyContainerHarness();
    const slotName = createHostedStandbySlotName(RELEASE_ID);
    const prepared = await harness.container.prepareStandbySlot({
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      timeoutMs: 75_000,
    });

    expect(prepared).toEqual({
      prepared: true,
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
    });
    expect(harness.codexPreflight).toHaveBeenCalledTimes(1);
    expect(harness.startAndWaitForPorts).not.toHaveBeenCalled();

    const claimId = createHostedStandbyClaimId();
    await expect(harness.container.bindStandbySlot({
      claimId,
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      userId: "member_123",
    })).resolves.toMatchObject({ bound: true, claimId, userId: "member_123" });
    await expect(harness.container.bindStandbySlot({
      claimId,
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      userId: "member_123",
    })).resolves.toMatchObject({ bound: true, claimId });
    await expect(harness.container.bindStandbySlot({
      claimId: createHostedStandbyClaimId(),
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      userId: "member_456",
    })).rejects.toThrow("already bound to another claim");

    await expect(harness.container.ensureReadyForProcessing({
      timeoutMs: 1_000,
      userId: "member_456",
    })).rejects.toThrow("not bound to the runtime user");
    await expect(harness.container.ensureProcessing({
      userId: "member_456",
    })).rejects.toThrow("not bound to the runtime user");
    await expect(harness.container.ensureReadyForProcessing({
      timeoutMs: 1_000,
      userId: "member_123",
    })).resolves.toMatchObject({ kind: "ready" });

    await expect(harness.container.retireStandbySlot({
      claimId: createHostedStandbyClaimId(),
    })).rejects.toThrow("claim did not match");
    await expect(harness.container.retireStandbySlot({ claimId }))
      .resolves.toEqual({ retired: true });
    await expect(harness.container.readStandbySlotBinding()).resolves.toEqual({
      claimId: null,
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      state: "retired",
      userId: null,
    });
  });

  it("reuses a claimed slot while warm and retires it after native stop", async () => {
    const harness = createStandbyContainerHarness();
    const slotName = createHostedStandbySlotName(RELEASE_ID);
    await harness.container.prepareStandbySlot({
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      timeoutMs: 75_000,
    });
    const claimId = createHostedStandbyClaimId();
    await harness.container.bindStandbySlot({
      claimId,
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      userId: "member_123",
    });
    harness.renewActivityTimeout.mockClear();

    const resolution = {
      currentReleaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      userId: "member_123",
    } as const;
    await expect(harness.container.resolveRetainedStandbySlot(resolution))
      .resolves.toMatchObject({ claimId, state: "bound", userId: "member_123" });
    await expect(harness.container.resolveRetainedStandbySlot(resolution))
      .resolves.toMatchObject({ claimId, state: "bound", userId: "member_123" });
    expect(harness.renewActivityTimeout).toHaveBeenCalledTimes(2);

    harness.setNativeStatus("stopped");
    await expect(harness.container.resolveRetainedStandbySlot(resolution))
      .resolves.toMatchObject({ claimId: null, state: "retired", userId: null });
    await expect(harness.container.readStandbySlotBinding()).resolves
      .toMatchObject({ claimId: null, state: "retired", userId: null });
  });

  it("keeps a claimed slot assigned for foreign users or ambiguous liveness", async () => {
    const harness = createStandbyContainerHarness();
    const slotName = createHostedStandbySlotName(RELEASE_ID);
    await harness.container.prepareStandbySlot({
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      timeoutMs: 75_000,
    });
    const claimId = createHostedStandbyClaimId();
    await harness.container.bindStandbySlot({
      claimId,
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      userId: "member_123",
    });

    await expect(harness.container.resolveRetainedStandbySlot({
      currentReleaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      userId: "member_456",
    })).rejects.toThrow("belongs to another member");
    harness.setNativeStatus("stopping");

    await expect(harness.container.resolveRetainedStandbySlot({
      currentReleaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      userId: "member_123",
    })).rejects.toThrow("native liveness is unsettled");
    await expect(harness.container.readStandbySlotBinding()).resolves
      .toMatchObject({ claimId, state: "bound", userId: "member_123" });
    expect(harness.destroy).not.toHaveBeenCalled();
  });

  it("keeps an unbound ready slot alive at ordinary activity expiry", async () => {
    const harness = createStandbyContainerHarness({ preflightReady: true });
    const slotName = createHostedStandbySlotName(RELEASE_ID);
    await harness.container.prepareStandbySlot({
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      timeoutMs: 75_000,
    });
    const prepareDuringExpiry = vi.spyOn(
      harness.container,
      "prepareStandbySlot",
    );

    await harness.container.onActivityExpired();

    expect(prepareDuringExpiry).not.toHaveBeenCalled();
    expect(harness.renewActivityTimeout).toHaveBeenCalled();
    expect(harness.destroy).not.toHaveBeenCalled();
  });

  it("keeps retryable unbound retirement member-free", async () => {
    const destroy = vi.fn()
      .mockRejectedValueOnce(new Error("platform unavailable"))
      .mockResolvedValue(undefined);
    const harness = createStandbyContainerHarness({ destroy });
    const slotName = createHostedStandbySlotName(RELEASE_ID);
    await harness.container.prepareStandbySlot({
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      timeoutMs: 75_000,
    });

    await expect(harness.container.retireStandbySlot({})).rejects.toThrow(
      "failed to destroy cleanly",
    );
    await expect(harness.container.readStandbySlotBinding()).resolves.toMatchObject({
      claimId: null,
      state: "retiring",
      userId: null,
    });
    await expect(harness.container.retireStandbySlot({})).resolves.toEqual({
      retired: true,
    });
  });

  it("refuses to retire another member's bound slot", async () => {
    const harness = createStandbyContainerHarness();
    const slotName = createHostedStandbySlotName(RELEASE_ID);
    await harness.container.prepareStandbySlot({
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      timeoutMs: 20_000,
    });
    await harness.container.bindStandbySlot({
      claimId: createHostedStandbyClaimId(),
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName,
      userId: "member_a",
    });

    await expect(destroyHostedExecutionContainer({
      runnerContainerName: slotName,
      runnerContainerNamespace: {
        getByName: () => harness.container,
      },
      userId: "member_b",
    })).resolves.toMatchObject({ attempted: true, ok: false });
    await expect(harness.container.readStandbySlotBinding()).resolves.toMatchObject({
      state: "bound",
      userId: "member_a",
    });
    expect(harness.destroy).not.toHaveBeenCalled();
  });
});

describe("StandbyRunnerCoordinatorDurableObject", () => {
  it("warms in shadow, atomically claims one slot in allocate, and replenishes off-path", async () => {
    const pending: Promise<unknown>[] = [];
    const state = createDurableObjectState(new DatabaseSync(":memory:"), pending);
    const slots = new Map<string, ReturnType<typeof createSlotStub>>();
    const getByName = vi.fn((
      name: string,
      _options?: { locationHint?: string },
    ) => {
      let slot = slots.get(name);
      if (!slot) {
        slot = createSlotStub(name);
        slots.set(name, slot);
      }
      return slot;
    });
    const environment: Record<string, unknown> & {
      STANDBY_RUNNER_CONTAINER: { getByName: typeof getByName };
    } = {
      CF_VERSION_METADATA: { id: RELEASE_ID },
      HOSTED_EXECUTION_STANDBY_MODE: "shadow",
      STANDBY_RUNNER_CONTAINER: { getByName },
    };
    const coordinator = new StandbyRunnerCoordinatorDurableObject(
      state,
      environment,
    );

    expect(coordinator.ensureReadyStandby({
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
    })).toEqual({ accepted: true });
    await flushBackgroundWork(pending);
    const shadowState = coordinator.readStandbyCoordinatorState();
    expect(shadowState.readySlotName).toMatch(/^standby--v-release_1--/u);
    expect(slots.size).toBe(1);
    const disabled = coordinator.claimReadyStandby({
      claimId: createHostedStandbyClaimId(),
      deadlineAtEpochMs: Date.now() + 250,
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
    });
    expect(disabled.outcome).toBe("disabled");
    await flushBackgroundWork(pending);

    environment.HOSTED_EXECUTION_STANDBY_MODE = "allocate";
    const firstClaimId = createHostedStandbyClaimId();
    const first = coordinator.claimReadyStandby({
      claimId: firstClaimId,
      deadlineAtEpochMs: Date.now() + 250,
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
    });
    const concurrent = coordinator.claimReadyStandby({
      claimId: createHostedStandbyClaimId(),
      deadlineAtEpochMs: Date.now() + 250,
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
    });
    expect(first).toMatchObject({ outcome: "claimed" });
    expect(concurrent.outcome).toBe("no_ready_slot");
    await flushBackgroundWork(pending);

    const replenished = coordinator.readStandbyCoordinatorState();
    expect(replenished.readySlotName).not.toBeNull();
    expect(replenished.readySlotName).not.toBe(
      first.outcome === "claimed" ? first.slotName : null,
    );
    expect(slots.size).toBe(2);
    expect(getByName.mock.calls.every(([, options]) =>
      options?.locationHint === HOSTED_STANDBY_LOCATION_HINT
    )).toBe(true);

    environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    coordinator.alarm();
    await flushBackgroundWork(pending);
    const readyBeforeOff = replenished.readySlotName;
    if (!readyBeforeOff) {
      throw new Error("Expected a ready replacement before mode-off convergence.");
    }
    expect((await slots.get(readyBeforeOff)?.readStandbySlotBinding())?.state)
      .toBe("retired");
    expect(coordinator.readStandbyCoordinatorState().readySlotName).toBeNull();
  });

  it("withdraws a ready slot from claims while re-proving it", async () => {
    const pending: Promise<unknown>[] = [];
    const state = createDurableObjectState(new DatabaseSync(":memory:"), pending);
    const reproofStarted = createDeferred<void>();
    const releaseReproof = createDeferred<void>();
    const prepareStandbySlot = vi.fn<
      HostedStandbyRunnerContainerStubLike["prepareStandbySlot"]
    >(async (input) => {
      if (prepareStandbySlot.mock.calls.length === 2) {
        reproofStarted.resolve(undefined);
        await releaseReproof.promise;
      }
      return { prepared: true, ...input };
    });
    let slot: HostedStandbyRunnerContainerStubLike | null = null;
    const getByName = vi.fn((name: string) => {
      slot ??= {
        ...createSlotStub(name),
        prepareStandbySlot,
      };
      return slot;
    });
    const coordinator = new StandbyRunnerCoordinatorDurableObject(state, {
      CF_VERSION_METADATA: { id: RELEASE_ID },
      HOSTED_EXECUTION_STANDBY_MODE: "allocate",
      STANDBY_RUNNER_CONTAINER: { getByName },
    });

    coordinator.ensureReadyStandby({
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
    });
    await flushBackgroundWork(pending);
    const readySlotName = coordinator.readStandbyCoordinatorState().readySlotName;
    if (!readySlotName) {
      throw new Error("Expected an initially ready standby slot.");
    }

    coordinator.alarm();
    await reproofStarted.promise;

    expect(coordinator.readStandbyCoordinatorState()).toMatchObject({
      provisioningSlotName: readySlotName,
      readySlotName: null,
    });
    expect(coordinator.claimReadyStandby({
      claimId: createHostedStandbyClaimId(),
      deadlineAtEpochMs: Date.now() + 250,
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
    })).toEqual({ outcome: "no_ready_slot" });

    releaseReproof.resolve(undefined);
    await flushBackgroundWork(pending);
    expect(coordinator.readStandbyCoordinatorState()).toMatchObject({
      provisioningSlotName: null,
      readySlotName,
    });
    expect(prepareStandbySlot).toHaveBeenCalledTimes(2);
  });

  it("retries the exact persisted provisioning target after preparation and cleanup fail", async () => {
    const pending: Promise<unknown>[] = [];
    const state = createDurableObjectState(new DatabaseSync(":memory:"), pending);
    const requestedSlotNames: string[] = [];
    let slot: HostedStandbyRunnerContainerStubLike | null = null;
    const prepareStandbySlot = vi.fn<
      HostedStandbyRunnerContainerStubLike["prepareStandbySlot"]
    >();
    prepareStandbySlot
      .mockRejectedValueOnce(new Error("preparation unavailable"))
      .mockImplementation(async (input) => ({ prepared: true, ...input }));
    const readStandbySlotCoordinatorState = vi.fn<
      HostedStandbyRunnerContainerStubLike["readStandbySlotCoordinatorState"]
    >();
    readStandbySlotCoordinatorState
      .mockRejectedValueOnce(new Error("cleanup unavailable"));
    const getByName = vi.fn((name: string) => {
      requestedSlotNames.push(name);
      slot ??= {
        ...createSlotStub(name),
        prepareStandbySlot,
        readStandbySlotCoordinatorState,
      };
      return slot;
    });
    const coordinator = new StandbyRunnerCoordinatorDurableObject(state, {
      CF_VERSION_METADATA: { id: RELEASE_ID },
      HOSTED_EXECUTION_STANDBY_MODE: "shadow",
      STANDBY_RUNNER_CONTAINER: { getByName },
    });

    coordinator.ensureReadyStandby({
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
    });
    await flushBackgroundWork(pending);
    const provisioning = coordinator.readStandbyCoordinatorState();
    expect(provisioning).toMatchObject({
      provisioningSlotName: expect.stringMatching(/^standby--v-release_1--/u),
      readySlotName: null,
    });

    coordinator.alarm();
    await flushBackgroundWork(pending);

    expect(new Set(requestedSlotNames)).toEqual(
      new Set([provisioning.provisioningSlotName]),
    );
    expect(prepareStandbySlot).toHaveBeenCalledTimes(2);
    expect(coordinator.readStandbyCoordinatorState()).toMatchObject({
      provisioningSlotName: null,
      readySlotName: provisioning.provisioningSlotName,
    });
  });

  it("keeps mode-off cleanup alive without retiring a claim bound during its grace period", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS);
    const harness = await createClaimedCoordinatorHarness(CLAIMED_AT_MS);

    harness.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    harness.setAlarm.mockClear();
    await harness.runAlarm();

    expect(countClaimTombstones(harness.db)).toBe(1);
    expect(harness.setAlarm).toHaveBeenCalledWith(
      CLAIMED_AT_MS + HOSTED_STANDBY_RETRY_MS,
    );
    await expect(harness.claimedSlot.readStandbySlotBinding()).resolves.toMatchObject({
      state: "unbound",
      userId: null,
    });

    await harness.claimedSlot.bindStandbySlot({
      claimId: harness.claimId,
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
      slotName: harness.slotName,
      userId: "member_late_bind",
    });
    vi.setSystemTime(CLAIMED_AT_MS + HOSTED_STANDBY_ORPHAN_GRACE_MS + 1);
    harness.setAlarm.mockClear();
    await harness.runAlarm();

    expect(countClaimTombstones(harness.db)).toBe(0);
    expect(harness.setAlarm).not.toHaveBeenCalled();
    await expect(harness.claimedSlot.readStandbySlotBinding()).resolves.toMatchObject({
      state: "bound",
      userId: "member_late_bind",
    });
  });

  it("keeps stale-release cleanup alive through exact-target failures until retirement converges", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS);
    const harness = await createClaimedCoordinatorHarness(CLAIMED_AT_MS);

    harness.environment.CF_VERSION_METADATA = { id: "release_2" };
    harness.setAlarm.mockClear();
    await harness.runAlarm();

    expect(countClaimTombstones(harness.db)).toBe(1);
    expect(harness.setAlarm).toHaveBeenCalledWith(
      CLAIMED_AT_MS + HOSTED_STANDBY_RETRY_MS,
    );
    expect(harness.slots.size).toBe(2);

    vi.setSystemTime(CLAIMED_AT_MS + HOSTED_STANDBY_ORPHAN_GRACE_MS + 1);
    const readBinding = vi.spyOn(
      harness.claimedSlot,
      "readStandbySlotCoordinatorState",
    ).mockRejectedValueOnce(new Error("binding unavailable"));
    harness.setAlarm.mockClear();
    await harness.runAlarm();

    expect(readBinding).toHaveBeenCalledTimes(1);
    expect(countClaimTombstones(harness.db)).toBe(1);
    expect(harness.setAlarm).toHaveBeenCalledWith(
      CLAIMED_AT_MS + HOSTED_STANDBY_ORPHAN_GRACE_MS + 1
        + HOSTED_STANDBY_RETRY_MS,
    );

    const retire = vi.spyOn(harness.claimedSlot, "retireStandbySlot")
      .mockRejectedValueOnce(new Error("retirement unavailable"));
    harness.setAlarm.mockClear();
    await harness.runAlarm();

    expect(retire).toHaveBeenCalledTimes(1);
    expect(countClaimTombstones(harness.db)).toBe(1);
    expect(harness.setAlarm).toHaveBeenCalledWith(
      CLAIMED_AT_MS + HOSTED_STANDBY_ORPHAN_GRACE_MS + 1
        + HOSTED_STANDBY_RETRY_MS,
    );

    harness.setAlarm.mockClear();
    await harness.runAlarm();

    expect(countClaimTombstones(harness.db)).toBe(0);
    expect(harness.setAlarm).not.toHaveBeenCalled();
    expect(harness.slots.size).toBe(2);
    await expect(harness.claimedSlot.readStandbySlotBinding()).resolves.toMatchObject({
      state: "retired",
      userId: null,
    });
  });

  it("surfaces failed stale-release alarm persistence for platform retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS);
    const harness = await createClaimedCoordinatorHarness(CLAIMED_AT_MS);

    harness.environment.CF_VERSION_METADATA = { id: "release_2" };
    harness.setAlarm.mockClear();
    harness.setAlarm.mockRejectedValue(new Error("alarm persistence unavailable"));

    await expect(harness.runAlarm()).rejects.toThrow(
      "alarm persistence unavailable",
    );
    expect(harness.setAlarm).toHaveBeenCalledTimes(2);
    expect(countClaimTombstones(harness.db)).toBe(1);
    await expect(harness.claimedSlot.readStandbySlotBinding()).resolves.toMatchObject({
      state: "unbound",
      userId: null,
    });
  });
});

describe("standby scheduled bootstrap", () => {
  it("targets the current release in ENAM and leaves convergence to the coordinator", async () => {
    const ensureReadyStandby = vi.fn(async () => ({ accepted: true as const }));
    const getByName = vi.fn(() => ({
      claimReadyStandby: vi.fn(),
      ensureReadyStandby,
    }));
    const pending: Promise<unknown>[] = [];

    handleStandbyRunnerScheduled({
      CF_VERSION_METADATA: { id: RELEASE_ID },
      HOSTED_EXECUTION_STANDBY_MODE: "off",
      STANDBY_COORDINATOR: { getByName },
    }, {
      waitUntil(promise) {
        pending.push(promise);
      },
    });
    await Promise.all(pending);

    expect(getByName).toHaveBeenCalledWith(
      "standby-coordinator--v-release_1--r-enam",
      { locationHint: HOSTED_STANDBY_LOCATION_HINT },
    );
    expect(ensureReadyStandby).toHaveBeenCalledWith({
      releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION,
    });
  });

  it("does nothing for an older deployment that has no standby variable", () => {
    const getByName = vi.fn();
    const waitUntil = vi.fn();

    handleStandbyRunnerScheduled({
      CF_VERSION_METADATA: { id: RELEASE_ID },
      STANDBY_COORDINATOR: { getByName },
    }, { waitUntil });

    expect(getByName).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });
});

async function createClaimedCoordinatorHarness(claimedAtMs: number) {
  const pending: Promise<unknown>[] = [];
  const db = new DatabaseSync(":memory:");
  const setAlarm = vi.fn(async (_scheduledTime: number | Date) => {});
  const state = createDurableObjectState(db, pending, { setAlarm });
  const slots = new Map<string, ReturnType<typeof createSlotStub>>();
  const getByName = vi.fn((name: string) => {
    let slot = slots.get(name);
    if (!slot) {
      slot = createSlotStub(name);
      slots.set(name, slot);
    }
    return slot;
  });
  const environment: Record<string, unknown> & {
    STANDBY_RUNNER_CONTAINER: { getByName: typeof getByName };
  } = {
    CF_VERSION_METADATA: { id: RELEASE_ID },
    HOSTED_EXECUTION_STANDBY_MODE: "allocate",
    STANDBY_RUNNER_CONTAINER: { getByName },
  };
  const coordinator = new StandbyRunnerCoordinatorDurableObject(
    state,
    environment,
  );

  coordinator.ensureReadyStandby({
    releaseId: RELEASE_ID,
    region: HOSTED_STANDBY_REGION,
  });
  await flushBackgroundWork(pending);
  const claimId = createHostedStandbyClaimId();
  const claim = coordinator.claimReadyStandby({
    claimId,
    deadlineAtEpochMs: claimedAtMs + 250,
    releaseId: RELEASE_ID,
    region: HOSTED_STANDBY_REGION,
  });
  if (claim.outcome !== "claimed") {
    throw new Error("Expected a claimed standby slot.");
  }
  await flushBackgroundWork(pending);
  const claimedSlot = slots.get(claim.slotName);
  if (!claimedSlot) {
    throw new Error("Expected the claimed standby slot.");
  }

  return {
    claimedSlot,
    claimId,
    db,
    environment,
    async runAlarm() {
      const alarm = coordinator.alarm();
      try {
        await alarm;
      } finally {
        pending.splice(0);
      }
    },
    setAlarm,
    slotName: claim.slotName,
    slots,
  };
}

function createStandbyContainerHarness(input: {
  destroy?: () => Promise<void>;
  nativeStatus?: string;
  preflightReady?: boolean;
} = {}) {
  const db = new DatabaseSync(":memory:");
  const state = createDurableObjectState(db, []);
  let preflightReady = input.preflightReady ?? false;
  let nativeStatus = input.nativeStatus ?? "running";
  const codexPreflight = vi.fn(async () => {
    preflightReady = true;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const container = new StandbyRunnerContainer(state, {
    CF_VERSION_METADATA: { id: RELEASE_ID },
    HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: BUNDLE_FINGERPRINT,
    HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: SOURCE_FINGERPRINT,
  });
  const platformDestroy = input.destroy;
  const destroy = vi.fn(async () => {
    await platformDestroy?.();
    nativeStatus = "stopped";
  });
  const startAndWaitForPorts = vi.fn(async () => {
    nativeStatus = "running";
  });
  const renewActivityTimeout = vi.fn();
  Object.assign(container, {
    containerFetch: vi.fn(async (url: string) => {
      if (url.endsWith("/internal/deploy-codex-shell-smoke")) {
        return await codexPreflight();
      }
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify(createStandbyHealth(preflightReady)), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }
      throw new Error(`Unexpected container URL: ${url}`);
    }),
    destroy,
    getState: vi.fn(async () => ({
      lastChange: Date.now(),
      status: nativeStatus,
    })),
    renewActivityTimeout,
    startAndWaitForPorts,
  });
  return {
    codexPreflight,
    container,
    destroy,
    renewActivityTimeout,
    setNativeStatus(status: string) {
      nativeStatus = status;
    },
    startAndWaitForPorts,
  };
}

function createStandbyHealth(preflightReady: boolean): Record<string, unknown> {
  return {
    activeJobCount: 0,
    codexShellPreflightCompletedAtEpochMs: preflightReady ? Date.now() : null,
    codexShellPreflightStatus: preflightReady ? "ready" : "pending",
    cloudflareRegion: HOSTED_STANDBY_REGION,
    conversationWarmActivityCompletedAtEpochMs: null,
    heavyRuntimeHydrationCompletedAtEpochMs: Date.now(),
    heavyRuntimeHydrationStatus: "ready",
    hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
    hostedWorkerReleaseId: RELEASE_ID,
    ok: true,
    poisoned: false,
    processStartedAtEpochMs: Date.now() - 20,
    runnerBundle: {
      bundleFingerprint: BUNDLE_FINGERPRINT,
      sourceFingerprint: SOURCE_FINGERPRINT,
    },
    serverListeningAtEpochMs: Date.now() - 10,
    workspaceInvocationAcceptedCount: 0,
  };
}

function createSlotStub(slotName: string): HostedStandbyRunnerContainerStubLike {
  let binding: HostedStandbySlotBinding = {
    claimId: null,
    releaseId: RELEASE_ID,
    region: HOSTED_STANDBY_REGION,
    slotName,
    state: "unbound",
    userId: null,
  };
  return {
    async bindStandbySlot(input) {
      binding = {
        claimId: input.claimId,
        releaseId: input.releaseId,
        region: input.region,
        slotName: input.slotName,
        state: "bound",
        userId: input.userId,
      };
      return { bound: true, ...input };
    },
    async destroyInstance() {},
    async invoke() {
      throw new Error("Invocation was not expected in this test.");
    },
    async prepareStandbySlot(input) {
      binding = {
        claimId: null,
        releaseId: input.releaseId,
        region: input.region,
        slotName: input.slotName,
        state: "unbound",
        userId: null,
      };
      return { prepared: true, ...input };
    },
    async readStandbySlotBinding() {
      return binding;
    },
    async readStandbySlotCoordinatorState() {
      return {
        coordinatorOwned: binding.userId === null,
        releaseId: binding.releaseId,
        slotName: binding.slotName,
        state: binding.state,
      };
    },
    async resolveRetainedStandbySlot() {
      return binding;
    },
    async retireStandbySlot() {
      binding = {
        claimId: null,
        releaseId: binding.releaseId,
        region: HOSTED_STANDBY_REGION,
        slotName: binding.slotName,
        state: "retired",
        userId: null,
      };
      return { retired: true };
    },
    async smokeHealth() {
      return {
        ok: true,
        runnerBundle: null,
        service: "test",
        status: 200,
      };
    },
  };
}

async function flushBackgroundWork(pending: Promise<unknown>[]): Promise<void> {
  while (pending.length > 0) {
    await Promise.all(pending.splice(0));
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve = (_value: T): void => {
    throw new Error("Deferred promise was resolved before initialization.");
  };
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function createDurableObjectState(
  db: DatabaseSync,
  pending: Promise<unknown>[],
  input: {
    setAlarm?: (scheduledTime: number | Date) => Promise<void>;
  } = {},
): DurableObjectStateLike {
  const sql = new SqliteDurableObjectSqlStorage(db);
  const values = new Map<string, unknown>();
  return {
    storage: {
      async delete(key) {
        return values.delete(key);
      },
      async deleteAlarm() {},
      async get<T>(key: string) {
        return values.get(key) as T | undefined;
      },
      async getAlarm() {
        return null;
      },
      async put<T>(key: string, value: T) {
        values.set(key, value);
      },
      setAlarm: input.setAlarm ?? (async () => {}),
      sql,
      transactionSync<T>(callback: () => T): T {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = callback();
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
    waitUntil(promise) {
      pending.push(promise);
    },
  };
}

function countClaimTombstones(db: DatabaseSync): number {
  return db.prepare(
    "SELECT claim_id FROM standby_claim_tombstone",
  ).all().length;
}

class SqliteDurableObjectSqlStorage implements DurableObjectSqlStorageLike {
  constructor(private readonly db: DatabaseSync) {}

  exec<T extends Record<string, DurableObjectSqlValue>>(
    query: string,
    ...bindings: unknown[]
  ): DurableObjectSqlCursorLike<T> {
    const statement = this.db.prepare(query);
    const normalized = query.trimStart().toUpperCase();
    if (
      normalized.startsWith("SELECT")
      || normalized.startsWith("PRAGMA")
      || normalized.startsWith("WITH")
    ) {
      const rows = statement.all(...bindings as SQLInputValue[]) as T[];
      return new SqliteCursor(
        rows,
        statement.columns().map((column) => column.name),
        rows.length,
        0,
      );
    }
    const result = statement.run(...bindings as SQLInputValue[]);
    return new SqliteCursor([], [], 0, Number(result.changes));
  }
}

class SqliteCursor<T extends Record<string, DurableObjectSqlValue>>
  implements DurableObjectSqlCursorLike<T> {
  private index = 0;

  constructor(
    private readonly rows: T[],
    readonly columnNames: string[],
    readonly rowsRead: number,
    readonly rowsWritten: number,
  ) {}

  [Symbol.iterator](): Iterator<T> {
    return this.rows[Symbol.iterator]();
  }

  next(): IteratorResult<T> {
    const value = this.rows[this.index];
    if (!value) {
      return { done: true, value: undefined };
    }
    this.index += 1;
    return { done: false, value };
  }

  one(): T {
    const row = this.rows[0];
    if (!row) {
      throw new Error("Expected one SQLite row.");
    }
    return row;
  }

  toArray(): T[] {
    return [...this.rows];
  }

  *raw<U extends DurableObjectSqlValue[]>(): IterableIterator<U> {
    for (const row of this.rows) {
      yield Object.values(row) as U;
    }
  }
}
