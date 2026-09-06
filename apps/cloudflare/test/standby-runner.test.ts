import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { HOSTED_RUNTIME_ARCHITECTURE_VERSION } from "../src/hosted-runtime-architecture.js";
import { destroyHostedExecutionContainer, RunnerContainer } from "../src/runner-container.js";
import {
  HOSTED_RUNNER_REGION,
  HOSTED_STANDBY_LOCATION_HINT,
  HOSTED_STANDBY_ORPHAN_GRACE_MS,
  HOSTED_STANDBY_READY_TIMEOUT_MS,
  HOSTED_STANDBY_REGION,
  HOSTED_STANDBY_RETRY_MS,
  createHostedRunnerContainerNamespaceRouter,
  createHostedRunnerSlotName,
  createHostedStandbyClaimId,
  createHostedStandbySlotName,
  isHostedStandbySlotName,
  readHostedStandbyMode,
  readHostedStandbyTarget,
  resolveHostedStandbyCoordinatorName,
  type HostedStandbyRunnerContainerStubLike,
  type HostedStandbySlotBinding,
} from "../src/standby-runner-contract.js";
import { StandbyRunnerCoordinatorDurableObject } from "../src/worker/standby-runner-coordinator-durable-object.js";
import { handleStandbyRunnerScheduled } from "../src/worker/index.js";
import { handleTestEnsureStandbyReadyRoute } from "../src/worker/route-handlers/test-standby.js";
import {
  HostedLocalTestStandbyRunnerContainer,
} from "../src/hosted-local-test/standby-runner-container.js";
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

describe("RunnerContainer slot lifecycle", () => {
  it("uses SIGTERM for the hosted-local shutdown checkpoint control", async () => {
    const stop = vi.fn(async () => undefined);
    const container: HostedLocalTestStandbyRunnerContainer = Object.create(
      HostedLocalTestStandbyRunnerContainer.prototype,
    );
    Object.defineProperty(container, "stop", { value: stop });

    await expect(container.beginShutdownCheckpointGracefulStopForTest({
      userId: "member_shutdown_checkpoint_signal",
    })).resolves.toEqual({ ok: true });
    expect(stop).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledWith("SIGTERM");
  });

  it.each(["ENAM", "WEUR", "APAC", "REGN"])(
    "prepares global inventory when native placement is %s",
    async (healthRegion) => {
      const harness = createStandbyContainerHarness({ healthRegion, preflightReady: true });
      await expect(harness.container.prepareStandbySlot({
        releaseId: RELEASE_ID,
        region: HOSTED_RUNNER_REGION,
        slotName: harness.slotName,
        timeoutMs: 75_000,
      })).resolves.toMatchObject({ prepared: true, region: HOSTED_RUNNER_REGION });
    },
  );

  it("proves heavy hydration and a content-free Codex initialize/stop preflight before binding once", async () => {
    const harness = createStandbyContainerHarness();
    const slotName = harness.slotName;
    const prepared = await harness.container.prepareStandbySlot({
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
      slotName,
      timeoutMs: 75_000,
    });

    expect(prepared).toEqual({
      prepared: true,
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
      slotName,
    });
    expect(harness.codexPreflight).toHaveBeenCalledTimes(1);
    expect(harness.startAndWaitForPorts).not.toHaveBeenCalled();

    const claimId = createHostedStandbyClaimId();
    await expect(harness.container.bindStandbySlot({
      claimId,
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
      slotName,
      userId: "member_123",
    })).resolves.toMatchObject({ bound: true, claimId, userId: "member_123" });
    await expect(harness.container.bindStandbySlot({
      claimId,
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
      slotName,
      userId: "member_123",
    })).resolves.toMatchObject({ bound: true, claimId });
    await expect(harness.container.bindStandbySlot({
      claimId: createHostedStandbyClaimId(),
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
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
    await expect(harness.container.onRuntimeCompletionRecorded({
      attemptId: "attempt_wrong_member",
      leaseGeneration: "1",
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
      region: HOSTED_RUNNER_REGION,
      slotName,
      state: "retired",
      userId: null,
    });
  });

  it("reuses a claimed slot while warm and retires it after native stop", async () => {
    const harness = createStandbyContainerHarness();
    const slotName = harness.slotName;
    await harness.container.prepareStandbySlot({
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
      slotName,
      timeoutMs: 75_000,
    });
    const claimId = createHostedStandbyClaimId();
    await harness.container.bindStandbySlot({
      claimId,
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
      slotName,
      userId: "member_123",
    });
    harness.renewActivityTimeout.mockClear();

    const resolution = {
      currentReleaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
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
    const slotName = harness.slotName;
    await harness.container.prepareStandbySlot({
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
      slotName,
      timeoutMs: 75_000,
    });
    const claimId = createHostedStandbyClaimId();
    await harness.container.bindStandbySlot({
      claimId,
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
      slotName,
      userId: "member_123",
    });

    await expect(harness.container.resolveRetainedStandbySlot({
      currentReleaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
      slotName,
      userId: "member_456",
    })).rejects.toThrow("belongs to another member");
    harness.setNativeStatus("stopping");

    await expect(harness.container.resolveRetainedStandbySlot({
      currentReleaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
      slotName,
      userId: "member_123",
    })).rejects.toThrow("native liveness is unsettled");
    await expect(harness.container.readStandbySlotBinding()).resolves
      .toMatchObject({ claimId, state: "bound", userId: "member_123" });
    expect(harness.destroy).not.toHaveBeenCalled();
  });

  it("keeps an unbound ready slot alive at ordinary activity expiry", async () => {
    const harness = createStandbyContainerHarness({ preflightReady: true });
    const slotName = harness.slotName;
    await harness.container.prepareStandbySlot({
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
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
    const slotName = harness.slotName;
    await harness.container.prepareStandbySlot({
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
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
    const slotName = harness.slotName;
    await harness.container.prepareStandbySlot({
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
      slotName,
      timeoutMs: 20_000,
    });
    await harness.container.bindStandbySlot({
      claimId: createHostedStandbyClaimId(),
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
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
  it("strictly bounds the configured target and defaults absent or blank values", () => {
    assert.equal(readHostedStandbyTarget({}), 2);
    for (const value of ["", " "]) {
      assert.equal(readHostedStandbyTarget({ HOSTED_EXECUTION_STANDBY_TARGET: value }), 2);
    }
    for (const value of [0, 1, 2, 32, "0", "1", "2", "32", "02", " 2", "2 "]) {
      assert.equal(readHostedStandbyTarget({ HOSTED_EXECUTION_STANDBY_TARGET: value }), Number(value));
    }
    for (const value of [null, "2.0", "2e0", "+2", -1, 33, 1.5, NaN, Infinity, true]) {
      assert.throws(() => readHostedStandbyTarget({ HOSTED_EXECUTION_STANDBY_TARGET: value }), /integer from 0 to 32/u);
    }
  });

  it("fills two GLOBAL slots in shadow without allocating or using the legacy namespace", async () => {
    const h = createCoordinatorHarness({ mode: "shadow" });
    h.ensure();
    await h.flush();
    assert.equal(h.coordinator.readStandbyCoordinatorState().readySlotNames.length, 2);
    assert.equal(h.claim().outcome, "disabled");
    await h.flush();
    assert.equal(h.legacyGet.mock.calls.length, 0);
    assert.equal(h.slots.size, 2);
    for (const [name, options] of h.runnerGet.mock.calls) {
      assert.match(name, /^runner--v-release_1--[a-f0-9]{32}$/u);
      assert.equal(options, undefined);
    }
    for (const slot of h.slots.values()) {
      assert.equal(slot.prepareStandbySlot.mock.calls[0]?.[0].region, HOSTED_RUNNER_REGION);
    }
  });

  it("atomically gives two concurrent claims distinct slots, misses the third, and replays the exact handoff", async () => {
    const h = createCoordinatorHarness();
    h.ensure();
    await h.flush();
    const claimId = createHostedStandbyClaimId();
    const [first, second, third] = await Promise.all([
      Promise.resolve().then(() => h.claim(claimId)),
      Promise.resolve().then(() => h.claim()),
      Promise.resolve().then(() => h.claim()),
    ]);
    assert.equal(first?.outcome, "claimed");
    assert.equal(second?.outcome, "claimed");
    assert.equal(third?.outcome, "no_ready_slot");
    assert(first?.outcome === "claimed" && second?.outcome === "claimed");
    assert.notEqual(first.slotName, second.slotName);
    assert.deepEqual(h.claim(claimId), first);
    await h.flush();
    assert.equal(h.slots.size, 4);
    assert.equal(countClaimTombstones(h.db), 2);
    assert.deepEqual(h.claim(claimId), first);
    h.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    h.environment.CF_VERSION_METADATA = { id: "release_2" };
    assert.deepEqual(h.coordinator.claimReadyStandby({
      claimId, deadlineAtEpochMs: 1, releaseId: RELEASE_ID, region: HOSTED_RUNNER_REGION,
    }), first);
    await h.flush();
    assert.equal(h.slots.size, 4);
    const facts = JSON.stringify(h.db.prepare("SELECT * FROM standby_claim_tombstone").all());
    assert(!facts.includes("member"));
  });

  it("recovers a synchronous claim from SQLite under its already-persisted inventory alarm", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS);
    const original = createCoordinatorHarness();
    original.ensure();
    await original.flush();
    const alarmAt = original.setAlarm.mock.lastCall?.[0];
    assert.equal(typeof alarmAt, "number");
    assert(typeof alarmAt === "number" && alarmAt > Date.now());
    const claimId = createHostedStandbyClaimId();
    const claim = original.claim(claimId);
    assert(claim.outcome === "claimed");
    // Snapshot before any post-claim maintenance microtask runs.
    const recovered = createCoordinatorHarness({ db: copyCoordinatorDatabase(original.db) });
    assert.deepEqual(recovered.claim(claimId), claim);
    assert.equal(countClaimTombstones(recovered.db), 1);
    original.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    await original.flush();
    await recovered.coordinator.alarm();
    await recovered.flush();
    assert.equal(recovered.coordinator.readStandbyCoordinatorState().readySlotNames.length, 2);
    recovered.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    vi.setSystemTime(CLAIMED_AT_MS + HOSTED_STANDBY_ORPHAN_GRACE_MS + 1);
    await recovered.coordinator.alarm();
    await recovered.flush();
    assert.equal(countClaimTombstones(recovered.db), 0);
    assert.equal((await recovered.slots.get(claim.slotName)?.readStandbySlotBinding())?.state, "retired");
  });

  it("keeps target zero idle and ENAM coordinators cleanup-only", async () => {
    for (const region of [HOSTED_RUNNER_REGION, HOSTED_STANDBY_REGION]) {
      const h = createCoordinatorHarness({ target: region === HOSTED_RUNNER_REGION ? "0" : "2" });
      h.coordinator.ensureReadyStandby({ releaseId: RELEASE_ID, region });
      await h.flush();
      assert.deepEqual(h.coordinator.readStandbyCoordinatorState().readySlotNames, []);
      assert.equal(h.runnerGet.mock.calls.length, 0);
      assert.equal(h.legacyGet.mock.calls.length, 0);
      const result = h.coordinator.claimReadyStandby({
        claimId: createHostedStandbyClaimId(), deadlineAtEpochMs: Date.now() + 250,
        releaseId: RELEASE_ID, region,
      });
      assert.equal(result.outcome, region === HOSTED_RUNNER_REGION ? "no_ready_slot" : "stale_release");
      await h.flush();
    }
  });

  it("overlaps cold preparations with a maximum of two workers, including targets above two", async () => {
    const gates: ReturnType<typeof createDeferred<void>>[] = [];
    let active = 0;
    let peak = 0;
    const h = createCoordinatorHarness({ target: "5", async prepare() {
      active += 1;
      peak = Math.max(peak, active);
      const gate = createDeferred<void>();
      gates.push(gate);
      await gate.promise;
      active -= 1;
    } });
    h.ensure();
    await until(() => gates.length === 2);
    assert.equal(active, 2);
    gates[0]?.resolve(undefined);
    await until(() => gates.length === 3);
    assert.equal(active, 2);
    assert.equal(h.coordinator.readStandbyCoordinatorState().readySlotNames.length, 1);
    gates[1]?.resolve(undefined);
    await until(() => gates.length === 4);
    gates[2]?.resolve(undefined);
    await until(() => gates.length === 5);
    gates[3]?.resolve(undefined);
    gates[4]?.resolve(undefined);
    await h.flush();
    assert.equal(peak, 2);
    assert.equal(h.slots.size, 5);
    assert.equal(h.coordinator.readStandbyCoordinatorState().readySlotNames.length, 5);
  });

  it("retains the fill owner when one worker fails before its peer finishes", async () => {
    const gate = createDeferred<void>();
    let active = 0;
    let peak = 0;
    const h = createCoordinatorHarness({ target: "5", async prepare() {
      active += 1;
      peak = Math.max(peak, active);
      await gate.promise;
      active -= 1;
    } });
    h.setAlarm.mockRejectedValueOnce(new Error("alarm unavailable"));
    h.ensure();
    await until(() => active === 1);
    // Let the rejected worker settle while its peer remains in external I/O.
    for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
    h.ensure();
    for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
    try {
      assert.equal(active, 1);
    } finally {
      gate.resolve(undefined);
      await h.flush();
    }
    assert(peak <= 2);
    assert.equal(h.coordinator.readStandbyCoordinatorState().readySlotNames.length, 5);
  });

  it("coalesces repeated ensure, claim misses and alarms without another preparation pass", async () => {
    const gate = createDeferred<void>();
    const h = createCoordinatorHarness({ prepare: () => gate.promise });
    h.ensure();
    await until(() => h.slots.size === 2);
    const alarms: Promise<void>[] = [];
    for (let index = 0; index < 100; index += 1) {
      h.ensure();
      assert.equal(h.claim().outcome, "no_ready_slot");
      alarms.push(h.coordinator.alarm());
    }
    gate.resolve(undefined);
    await Promise.all(alarms);
    await h.flush();
    assert.equal(h.slots.size, 2);
    for (const slot of h.slots.values()) assert.equal(slot.prepareStandbySlot.mock.calls.length, 1);
  });

  it("persists two intents and awaits durable recovery alarms before obtaining any external stub", async () => {
    const alarm = createDeferred<void>();
    const h = createCoordinatorHarness();
    h.setAlarm.mockImplementation(() => alarm.promise);
    h.ensure();
    await until(() => h.setAlarm.mock.calls.length >= 2);
    const names = h.coordinator.readStandbyCoordinatorState().provisioningSlotNames;
    assert.equal(names.length, 2);
    assert.equal(h.runnerGet.mock.calls.length, 0);
    alarm.resolve(undefined);
    await h.flush();
    assert.deepEqual(new Set(h.coordinator.readStandbyCoordinatorState().readySlotNames), new Set(names));
  });

  it("recovers the exact persisted intents after alarm persistence interrupted dispatch", async () => {
    const h = createCoordinatorHarness();
    h.setAlarm.mockRejectedValueOnce(new Error("alarm unavailable"))
      .mockRejectedValueOnce(new Error("alarm unavailable"));
    h.ensure();
    await h.flush();
    const names = h.coordinator.readStandbyCoordinatorState().provisioningSlotNames;
    assert.equal(names.length, 2);
    assert.equal(h.runnerGet.mock.calls.length, 0);
    const recovered = new StandbyRunnerCoordinatorDurableObject(h.state, h.environment);
    await recovered.alarm();
    await h.flush();
    assert.deepEqual(new Set(recovered.readStandbyCoordinatorState().readySlotNames), new Set(names));
    assert.equal(h.slots.size, 2);
  });

  it("restarts a SQLite snapshot taken during external preparation without substituting names", async () => {
    const gate = createDeferred<void>();
    const original = createCoordinatorHarness({ prepare: () => gate.promise });
    original.ensure();
    await until(() => original.slots.size === 2);
    const names = original.coordinator.readStandbyCoordinatorState().provisioningSlotNames;
    // A separate SQLite snapshot models loss of the original invocation: its
    // eventual continuations cannot mutate the recovered owner's database.
    const recovered = createCoordinatorHarness({ db: copyCoordinatorDatabase(original.db) });
    await recovered.coordinator.alarm();
    await recovered.flush();
    assert.deepEqual(new Set(recovered.coordinator.readStandbyCoordinatorState().readySlotNames), new Set(names));
    assert.deepEqual(new Set(recovered.slots.keys()), new Set(names));
    original.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    gate.resolve(undefined);
    await original.flush();
  });

  for (const change of ["off", "release", "zero", "one"] as const) {
    it(`drains surplus and late preparation completion after a ${change} change`, async () => {
      const gate = createDeferred<void>();
      const h = createCoordinatorHarness({ prepare: () => gate.promise });
      h.ensure();
      await until(() => h.slots.size === 2);
      if (change === "off") h.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
      if (change === "release") h.environment.CF_VERSION_METADATA = { id: "release_2" };
      if (change === "zero") h.environment.HOSTED_EXECUTION_STANDBY_TARGET = "0";
      if (change === "one") h.environment.HOSTED_EXECUTION_STANDBY_TARGET = "1";
      h.ensure();
      gate.resolve(undefined);
      await h.flush();
      const expected = change === "one" ? 1 : 0;
      assert.equal(h.coordinator.readStandbyCoordinatorState().readySlotNames.length, expected);
      assert.equal(h.coordinator.readStandbyCoordinatorState().provisioningSlotNames.length, 0);
      assert.equal(h.slots.size, 2);
      const bindings = await Promise.all([...h.slots.values()].map((slot) => slot.readStandbySlotBinding()));
      assert.equal(bindings.filter((binding) => binding.state === "retired").length, 2 - expected);
    });
  }

  it("drops a fresh undispatched intent when mode changes while its alarm is pending", async () => {
    const gate = createDeferred<void>();
    const h = createCoordinatorHarness();
    h.setAlarm.mockImplementation(() => gate.promise);
    h.ensure();
    await until(() => h.coordinator.readStandbyCoordinatorState().provisioningSlotNames.length === 2);
    h.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    h.ensure();
    gate.resolve(undefined);
    await h.flush();
    assert.equal(h.runnerGet.mock.calls.length, 0);
    assert.equal(h.db.prepare("SELECT * FROM standby_coordinator_slot").all().length, 0);
  });

  it("reproof withdraws only one slot and keeps its healthy peer claimable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS);
    const gate = createDeferred<void>();
    let preparing = 0;
    const h = createCoordinatorHarness({ async prepare() {
      preparing += 1;
      if (preparing === 3) await gate.promise;
    } });
    h.ensure();
    await h.flush();
    vi.setSystemTime(CLAIMED_AT_MS + 60_000);
    const alarm = h.coordinator.alarm();
    await until(() => preparing === 3);
    assert.equal(h.coordinator.readStandbyCoordinatorState().readySlotNames.length, 1);
    assert.equal(h.coordinator.readStandbyCoordinatorState().provisioningSlotNames.length, 1);
    const reprobing = h.coordinator.readStandbyCoordinatorState().provisioningSlotNames[0];
    const claim = h.claim();
    assert.equal(claim.outcome, "claimed");
    assert(claim.outcome === "claimed");
    assert.notEqual(claim.slotName, reprobing);
    gate.resolve(undefined);
    await alarm;
    await h.flush();
    assert.equal(h.coordinator.readStandbyCoordinatorState().readySlotNames.length, 2);
  });

  it("staggers overdue reproofs even after downtime and repeated ensure calls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS);
    const h = createCoordinatorHarness();
    h.ensure();
    await h.flush();
    vi.setSystemTime(CLAIMED_AT_MS + 10 * 60_000);
    await h.coordinator.alarm();
    for (let index = 0; index < 10; index += 1) h.ensure();
    await h.flush();
    assert.equal(prepareCount(h), 3);
    assert.equal(h.coordinator.readStandbyCoordinatorState().readySlotNames.length, 2);
    vi.setSystemTime(Date.now() + 30_000);
    await h.coordinator.alarm();
    await h.flush();
    assert.equal(prepareCount(h), 4);
  });

  it("migrates production singleton rows and tombstones into legacy-only drain without reviving them on reset", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS + HOSTED_STANDBY_ORPHAN_GRACE_MS + 1);
    const db = new DatabaseSync(":memory:");
    const ready = createHostedStandbySlotName(RELEASE_ID);
    const pending = createHostedStandbySlotName(RELEASE_ID);
    const claimed = createHostedStandbySlotName(RELEASE_ID);
    seedLegacyCoordinator(db, ready, pending, claimed);
    const h = createCoordinatorHarness({ db });
    assert.equal(h.coordinator.readStandbyCoordinatorState().region, HOSTED_STANDBY_REGION);
    assert.deepEqual(h.coordinator.readStandbyCoordinatorState().readySlotNames, []);
    const bound = h.legacyGet(claimed);
    await bound.bindStandbySlot({
      claimId: createHostedStandbyClaimId(), releaseId: RELEASE_ID,
      region: HOSTED_STANDBY_REGION, slotName: claimed, userId: "member_legacy",
    });
    await h.coordinator.alarm();
    await h.flush();
    assert.equal(h.runnerGet.mock.calls.length, 0);
    assert.equal(h.legacySlots.get(ready)?.retireStandbySlot.mock.calls.length, 1);
    assert.equal(h.legacySlots.get(pending)?.retireStandbySlot.mock.calls.length, 1);
    assert.equal(bound.retireStandbySlot.mock.calls.length, 0);
    assert.equal(countClaimTombstones(db), 0);
    assert.equal(db.prepare("SELECT * FROM standby_coordinator_slot").all().length, 0);
    const recovered = new StandbyRunnerCoordinatorDurableObject(h.state, h.environment);
    await recovered.alarm();
    await h.flush();
    assert.equal(h.legacySlots.get(ready)?.retireStandbySlot.mock.calls.length, 1);
    for (const [, options] of h.legacyGet.mock.calls.slice(1)) {
      assert.equal(options?.locationHint, HOSTED_STANDBY_LOCATION_HINT);
    }
  });

  it("never retires a member that binds during its handoff grace period", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS);
    const h = createCoordinatorHarness();
    h.ensure();
    await h.flush();
    const claimId = createHostedStandbyClaimId();
    const claim = h.claim(claimId);
    assert(claim.outcome === "claimed");
    const slot = h.slots.get(claim.slotName);
    assert(slot);
    h.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    await h.coordinator.alarm();
    await slot.bindStandbySlot({
      claimId, releaseId: RELEASE_ID, region: HOSTED_RUNNER_REGION,
      slotName: claim.slotName, userId: "member_late_bind",
    });
    vi.setSystemTime(Date.now() + HOSTED_STANDBY_ORPHAN_GRACE_MS + 1);
    await h.coordinator.alarm();
    await h.flush();
    assert.equal(slot.retireStandbySlot.mock.calls.length, 0);
    assert.equal(countClaimTombstones(h.db), 0);
    assert.equal((await slot.readStandbySlotBinding()).state, "bound");
  });

  it("lets the slot's existing fence reject a bind racing the coordinator's retirement read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS);
    const h = createCoordinatorHarness();
    h.ensure();
    await h.flush();
    const claimId = createHostedStandbyClaimId();
    const claim = h.claim(claimId);
    assert(claim.outcome === "claimed");
    const slot = h.slots.get(claim.slotName);
    assert(slot);
    slot.readStandbySlotCoordinatorState.mockImplementationOnce(async () => {
      await slot.bindStandbySlot({ claimId, releaseId: RELEASE_ID, region: HOSTED_RUNNER_REGION,
        slotName: claim.slotName, userId: "member_racing_bind" });
      return { coordinatorOwned: true, state: "unbound", releaseId: RELEASE_ID, slotName: claim.slotName };
    });
    h.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    vi.setSystemTime(Date.now() + HOSTED_STANDBY_ORPHAN_GRACE_MS + 1);
    await h.coordinator.alarm();
    await h.flush();
    assert.equal(countClaimTombstones(h.db), 1);
    assert.equal((await slot.readStandbySlotBinding()).state, "bound");
    vi.setSystemTime(Date.now() + HOSTED_STANDBY_RETRY_MS);
    await h.coordinator.alarm();
    await h.flush();
    assert.equal(countClaimTombstones(h.db), 0);
    assert.equal(slot.retireStandbySlot.mock.calls.length, 1);
  });

  it("releases retiring non-coordinator ownership, but keeps unknown exact targets", async () => {
    const h = createCoordinatorHarness();
    h.ensure();
    await h.flush();
    const [first, second] = [...h.slots.entries()];
    assert(first && second);
    first[1].readStandbySlotCoordinatorState.mockResolvedValue({
      coordinatorOwned: false, state: "retiring", releaseId: RELEASE_ID, slotName: first[0],
    });
    second[1].readStandbySlotCoordinatorState.mockRejectedValue(new Error("binding unavailable"));
    h.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    h.ensure();
    await h.flush();
    assert.equal(first[1].retireStandbySlot.mock.calls.length, 0);
    assert.equal(second[1].retireStandbySlot.mock.calls.length, 0);
    const rows = h.db.prepare("SELECT slot_name FROM standby_coordinator_slot").all();
    assert.deepEqual(rows.map((row) => row.slot_name), [second[0]]);
  });

  it("refills while a bounded indexed tombstone cleanup batch has a hanging RPC", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS);
    const h = createCoordinatorHarness();
    h.ensure();
    await h.flush();
    const oldNames: string[] = [];
    for (let index = 0; index < 80; index += 1) {
      const name = createHostedRunnerSlotName(RELEASE_ID);
      oldNames.push(name);
      h.db.prepare(`INSERT INTO standby_claim_tombstone
        (claim_id, slot_name, claimed_at_ms, check_at_ms) VALUES (?, ?, ?, ?)`)
        .run(createHostedStandbyClaimId(), name, CLAIMED_AT_MS - HOSTED_STANDBY_ORPHAN_GRACE_MS, index);
    }
    const first = oldNames[0];
    assert(first);
    h.runnerGet(first).readStandbySlotCoordinatorState.mockImplementation(() => new Promise(() => {}));
    const alarm = h.coordinator.alarm();
    await until(() => h.slots.get(first)?.readStandbySlotCoordinatorState.mock.calls.length === 1);
    assert.equal(h.claim().outcome, "claimed");
    assert.equal(h.claim().outcome, "claimed");
    await until(() => h.coordinator.readStandbyCoordinatorState().readySlotNames.length === 2);
    // No timer has advanced: fill completed before the hanging cleanup read.
    assert.equal(Date.now(), CLAIMED_AT_MS);
    await vi.advanceTimersByTimeAsync(1_000);
    await alarm;
    await h.flush();
    assert(h.db.prepare("SELECT slot_name FROM standby_claim_tombstone WHERE slot_name = ?").get(first));
    assert(countClaimTombstones(h.db) > 60);
    const plan = h.db.prepare(`EXPLAIN QUERY PLAN SELECT claim_id, slot_name
      FROM standby_claim_tombstone WHERE check_at_ms <= ?
      ORDER BY check_at_ms, claim_id LIMIT 4`).all(Date.now());
    assert(JSON.stringify(plan).includes("standby_claim_check"));
    const reads = h.slots.get(first)?.readStandbySlotCoordinatorState.mock.calls.length;
    const remaining = countClaimTombstones(h.db);
    await h.coordinator.alarm();
    await h.flush();
    assert.equal(h.slots.get(first)?.readStandbySlotCoordinatorState.mock.calls.length, reads);
    assert(countClaimTombstones(h.db) < remaining);
  });

  it("retains failed retirement facts across alarms and never prepares the used slot again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS);
    const h = createCoordinatorHarness();
    h.ensure();
    await h.flush();
    const claim = h.claim();
    assert(claim.outcome === "claimed");
    const slot = h.slots.get(claim.slotName);
    assert(slot);
    slot.retireStandbySlot.mockRejectedValueOnce(new Error("retirement unavailable"));
    h.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    vi.setSystemTime(Date.now() + HOSTED_STANDBY_ORPHAN_GRACE_MS + 1);
    await h.coordinator.alarm();
    await h.flush();
    assert.equal(countClaimTombstones(h.db), 1);
    assert.equal(h.db.prepare("SELECT slot_name FROM standby_claim_tombstone").get()?.slot_name, claim.slotName);
    vi.setSystemTime(Date.now() + HOSTED_STANDBY_RETRY_MS);
    await h.coordinator.alarm();
    await h.flush();
    assert.equal(countClaimTombstones(h.db), 0);
    assert.equal(slot.prepareStandbySlot.mock.calls.length, 1);
    assert.equal((await slot.readStandbySlotBinding()).state, "retired");
  });

  it("keeps a timed-out retirement until late completion is proven by a later binding read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS);
    const h = createCoordinatorHarness({ target: "1" });
    h.ensure();
    await h.flush();
    const [name, slot] = [...h.slots.entries()][0] ?? [];
    assert(name && slot);
    const gate = createDeferred<void>();
    const retire = slot.retireStandbySlot.getMockImplementation();
    assert(retire);
    slot.retireStandbySlot.mockImplementationOnce(async (input) => { await gate.promise; return retire(input); });
    h.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    const alarm = h.coordinator.alarm();
    await until(() => slot.retireStandbySlot.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(1_000);
    await alarm;
    await h.flush();
    assert.equal(h.db.prepare("SELECT slot_name FROM standby_coordinator_slot").get()?.slot_name, name);
    gate.resolve(undefined);
    await until(async () => (await slot.readStandbySlotBinding()).state === "retired");
    vi.setSystemTime(Date.now() + HOSTED_STANDBY_RETRY_MS);
    await h.coordinator.alarm();
    await h.flush();
    assert.equal(h.db.prepare("SELECT * FROM standby_coordinator_slot").all().length, 0);
    assert.equal(slot.retireStandbySlot.mock.calls.length, 1);
  });

  it("replaces a failed preparation without ever re-preparing its unresolved drain target", async () => {
    const h = createCoordinatorHarness({ target: "1", async prepare(input) {
      if (h.slots.size === 1) {
        h.slots.get(input.slotName)?.readStandbySlotCoordinatorState
          .mockRejectedValue(new Error("binding unavailable"));
        throw new Error("preparation failed");
      }
    } });
    h.ensure();
    await h.flush();
    const old = [...h.slots.entries()][0];
    assert(old);
    assert.equal(h.db.prepare("SELECT slot_name FROM standby_coordinator_slot WHERE phase = 'draining'").get()?.slot_name, old[0]);
    h.ensure();
    await h.flush();
    assert.equal(h.coordinator.readStandbyCoordinatorState().readySlotNames.length, 1);
    assert.notEqual(h.coordinator.readStandbyCoordinatorState().readySlotNames[0], old[0]);
    assert.equal(old[1].prepareStandbySlot.mock.calls.length, 1);
    assert.equal(h.slots.size, 2);
  });

  it("preserves inventory on a mismatched binding proof rather than retiring another target", async () => {
    const h = createCoordinatorHarness({ target: "1" });
    h.ensure();
    await h.flush();
    const entry = [...h.slots.entries()][0];
    assert(entry);
    entry[1].readStandbySlotCoordinatorState.mockResolvedValue({
      coordinatorOwned: true, releaseId: RELEASE_ID,
      slotName: createHostedRunnerSlotName(RELEASE_ID), state: "unbound",
    });
    h.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    await h.coordinator.alarm();
    await h.flush();
    assert.equal(entry[1].retireStandbySlot.mock.calls.length, 0);
    assert.equal(h.db.prepare("SELECT slot_name FROM standby_coordinator_slot").get()?.slot_name, entry[0]);
  });

  it("surfaces failed recovery-alarm persistence for platform retry without external retirement", async () => {
    const h = createCoordinatorHarness();
    h.ensure();
    await h.flush();
    h.environment.HOSTED_EXECUTION_STANDBY_MODE = "off";
    h.setAlarm.mockRejectedValue(new Error("alarm persistence unavailable"));
    await assert.rejects(h.coordinator.alarm(), /alarm persistence unavailable/u);
    await assert.rejects(h.flush(), /alarm persistence unavailable/u);
    assert.equal(h.db.prepare("SELECT * FROM standby_coordinator_slot").all().length, 2);
    for (const slot of h.slots.values()) assert.equal(slot.retireStandbySlot.mock.calls.length, 0);
  });

  it("remembers a late preparation after its deadline even after an earlier cleanup settled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(CLAIMED_AT_MS);
    const gate = createDeferred<void>();
    const h = createCoordinatorHarness({ target: "1", prepare: () => gate.promise });
    h.ensure();
    await until(() => h.slots.size === 1);
    const [name, slot] = [...h.slots.entries()][0] ?? [];
    assert(name && slot);
    await vi.advanceTimersByTimeAsync(HOSTED_STANDBY_READY_TIMEOUT_MS);
    await h.flush();
    assert.equal((await slot.readStandbySlotBinding()).state, "retired");
    assert.equal(h.db.prepare("SELECT * FROM standby_coordinator_slot").all().length, 0);
    const reads = slot.readStandbySlotCoordinatorState.mock.calls.length;
    gate.resolve(undefined);
    await until(() => slot.readStandbySlotCoordinatorState.mock.calls.length > reads);
    await h.flush();
    assert.equal(h.coordinator.readStandbyCoordinatorState().readySlotNames.length, 0);
    assert.equal(h.slots.size, 1);
    assert.equal(slot.prepareStandbySlot.mock.calls.length, 1);
    assert.equal(h.db.prepare("SELECT * FROM standby_coordinator_slot").all().length, 0);
  });
});

describe("standby scheduled bootstrap", () => {
  it("targets the current release in GLOBAL and leaves convergence to the coordinator", async () => {
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
      "standby-coordinator--v-release_1--r-global",
    );
    expect(ensureReadyStandby).toHaveBeenCalledWith({
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
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

describe("hosted-local standby readiness route", () => {
  it("polls an in-progress slot without enqueueing duplicate maintenance", async () => {
    const state = {
      provisioningSlotNames: [createHostedRunnerSlotName(RELEASE_ID), createHostedRunnerSlotName(RELEASE_ID)],
      readySlotNames: [],
      releaseId: RELEASE_ID,
      region: HOSTED_RUNNER_REGION,
    };
    const ensureReadyStandby = vi.fn(async () => ({ accepted: true as const }));
    const readStandbyCoordinatorState = vi.fn(async () => state);

    const response = await handleTestEnsureStandbyReadyRoute({
      env: {
        CF_VERSION_METADATA: { id: RELEASE_ID },
        HOSTED_EXECUTION_STANDBY_MODE: "allocate",
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        NODE_ENV: "test",
        STANDBY_COORDINATOR: {
          getByName: vi.fn(() => ({
            claimReadyStandby: vi.fn(),
            ensureReadyStandby,
            readStandbyCoordinatorState,
          })),
        },
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(state);
    expect(ensureReadyStandby).not.toHaveBeenCalled();
    expect(readStandbyCoordinatorState).toHaveBeenCalledOnce();
  });
  for (const [count, target, expectedEnsures] of [[1, "2", 1], [2, "1", 1], [0, "0", 0]] as const) {
    it(`reconciles readiness count ${count} against target ${target}`, async () => {
      const state = {
        provisioningSlotNames: Array.from({ length: count }, () => createHostedRunnerSlotName(RELEASE_ID)),
        readySlotNames: [], releaseId: RELEASE_ID, region: HOSTED_RUNNER_REGION,
      };
      const ensureReadyStandby = vi.fn(async () => ({ accepted: true as const }));
      const getByName = vi.fn(() => ({
        claimReadyStandby: vi.fn(), ensureReadyStandby,
        readStandbyCoordinatorState: vi.fn(async () => state),
      }));
      const response = await handleTestEnsureStandbyReadyRoute({ env: {
        CF_VERSION_METADATA: { id: RELEASE_ID }, HOSTED_EXECUTION_STANDBY_MODE: "allocate",
        HOSTED_EXECUTION_STANDBY_TARGET: target, MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        NODE_ENV: "test", STANDBY_COORDINATOR: { getByName },
      } } as never);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), state);
      assert.equal(ensureReadyStandby.mock.calls.length, expectedEnsures);
      assert.deepEqual(getByName.mock.calls, [["standby-coordinator--v-release_1--r-global"]]);
    });
  }

  it("returns the complete claimable inventory for the foreground E2E poller", async () => {
    const h = createCoordinatorHarness();
    h.ensure();
    await h.flush();
    const response = await handleTestEnsureStandbyReadyRoute({ env: {
      ...h.environment, MURPH_HOSTED_LOCAL_TEST_ROUTES: "1", NODE_ENV: "test",
      STANDBY_COORDINATOR: { getByName: () => ({
        async claimReadyStandby(input: Parameters<typeof h.coordinator.claimReadyStandby>[0]) {
          return h.coordinator.claimReadyStandby(input);
        },
        async ensureReadyStandby(input: Parameters<typeof h.coordinator.ensureReadyStandby>[0]) {
          return h.coordinator.ensureReadyStandby(input);
        },
        async readStandbyCoordinatorState() { return h.coordinator.readStandbyCoordinatorState(); },
      }) },
    } } as never);
    const body: { readySlotNames: string[] } = await response.json();
    assert.equal(body.readySlotNames.length, 2);
    const claim = h.claim();
    assert(claim.outcome === "claimed");
    assert.equal(body.readySlotNames[0], claim.slotName);
    assert(!("readySlotName" in body));
    await h.flush();
  });

});

function createCoordinatorHarness(input: {
  db?: DatabaseSync;
  mode?: "off" | "shadow" | "allocate";
  target?: string;
  prepare?: (input: Parameters<HostedStandbyRunnerContainerStubLike["prepareStandbySlot"]>[0]) => Promise<void>;
} = {}) {
  const pending: Promise<unknown>[] = [];
  const db = input.db ?? new DatabaseSync(":memory:");
  const setAlarm = vi.fn(async (_time: number | Date) => {});
  const state = createDurableObjectState(db, pending, { setAlarm });
  const slots = new Map<string, ReturnType<typeof createCoordinatorSlot>>();
  const legacySlots = new Map<string, ReturnType<typeof createCoordinatorSlot>>();
  const runnerGet = vi.fn((name: string, _options?: { locationHint?: string }) => {
    let slot = slots.get(name);
    if (!slot) {
      slot = createCoordinatorSlot(name, input.prepare);
      slots.set(name, slot);
    }
    return slot;
  });
  const legacyGet = vi.fn((name: string, _options?: { locationHint?: string }) => {
    let slot = legacySlots.get(name);
    if (!slot) {
      slot = createCoordinatorSlot(name);
      legacySlots.set(name, slot);
    }
    return slot;
  });
  const environment: Record<string, unknown> & {
    RUNNER_CONTAINER: { getByName: typeof runnerGet };
    STANDBY_RUNNER_CONTAINER: { getByName: typeof legacyGet };
  } = {
    CF_VERSION_METADATA: { id: RELEASE_ID },
    HOSTED_EXECUTION_STANDBY_MODE: input.mode ?? "allocate",
    HOSTED_EXECUTION_STANDBY_TARGET: input.target,
    RUNNER_CONTAINER: { getByName: runnerGet },
    STANDBY_RUNNER_CONTAINER: { getByName: legacyGet },
  };
  const coordinator = new StandbyRunnerCoordinatorDurableObject(state, environment);
  return {
    coordinator, db, environment, legacyGet, legacySlots, pending, runnerGet, setAlarm, slots, state,
    claim(claimId = createHostedStandbyClaimId()) {
      return coordinator.claimReadyStandby({
        claimId, deadlineAtEpochMs: Date.now() + 250, releaseId: RELEASE_ID, region: HOSTED_RUNNER_REGION,
      });
    },
    ensure() { return coordinator.ensureReadyStandby({ releaseId: RELEASE_ID, region: HOSTED_RUNNER_REGION }); },
    flush() { return flushBackgroundWork(pending); },
  };
}

function createCoordinatorSlot(
  slotName: string,
  prepare?: (input: Parameters<HostedStandbyRunnerContainerStubLike["prepareStandbySlot"]>[0]) => Promise<void>,
) {
  const base = createSlotStub(slotName);
  return {
    ...base,
    prepareStandbySlot: vi.fn<HostedStandbyRunnerContainerStubLike["prepareStandbySlot"]>(async (input) => {
      if ((await base.readStandbySlotBinding()).state !== "unbound") throw new Error("Slot is terminal or bound.");
      await prepare?.(input);
      if ((await base.readStandbySlotBinding()).state !== "unbound") throw new Error("Slot became terminal or bound.");
      return base.prepareStandbySlot(input);
    }),
    readStandbySlotCoordinatorState: vi.fn(base.readStandbySlotCoordinatorState),
    retireStandbySlot: vi.fn<HostedStandbyRunnerContainerStubLike["retireStandbySlot"]>(async (input) => {
      const binding = await base.readStandbySlotBinding();
      if (binding.state === "bound" || (binding.state === "retiring" && binding.userId !== null)) {
        throw new Error("Coordinator has no bound-slot retirement authority.");
      }
      return base.retireStandbySlot(input);
    }),
  };
}

function prepareCount(h: ReturnType<typeof createCoordinatorHarness>): number {
  return [...h.slots.values()].reduce((count, slot) => count + slot.prepareStandbySlot.mock.calls.length, 0);
}

async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (await predicate()) return;
    await Promise.resolve();
  }
  assert.fail("Expected the asynchronous coordinator boundary to be reached.");
}

function copyCoordinatorDatabase(source: DatabaseSync): DatabaseSync {
  const copy = new DatabaseSync(":memory:");
  for (const table of ["standby_coordinator_meta", "standby_claim_tombstone", "standby_coordinator_slot"]) {
    const schema = source.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.sql;
    assert.equal(typeof schema, "string");
    assert(typeof schema === "string");
    copy.exec(schema);
    for (const row of source.prepare(`SELECT * FROM ${table}`).all()) {
      const values = Object.values(row);
      copy.prepare(`INSERT INTO ${table} VALUES (${values.map(() => "?").join(", ")})`).run(...values);
    }
  }
  return copy;
}

function seedLegacyCoordinator(db: DatabaseSync, ready: string, pending: string, claimed: string): void {
  db.exec(`CREATE TABLE standby_coordinator_meta (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1), release_id TEXT NOT NULL,
    region TEXT NOT NULL, ready_slot_name TEXT, provisioning_slot_name TEXT
  ); CREATE TABLE standby_claim_tombstone (
    claim_id TEXT PRIMARY KEY, slot_name TEXT NOT NULL, claimed_at_ms INTEGER NOT NULL
  )`);
  db.prepare("INSERT INTO standby_coordinator_meta VALUES (1, ?, ?, ?, ?)")
    .run(RELEASE_ID, HOSTED_STANDBY_REGION, ready, pending);
  db.prepare("INSERT INTO standby_claim_tombstone VALUES (?, ?, ?)")
    .run(createHostedStandbyClaimId(), claimed, CLAIMED_AT_MS);
}

function createStandbyContainerHarness(input: {
  destroy?: () => Promise<void>;
  nativeStatus?: string;
  environment?: Record<string, unknown>;
  healthRegion?: string;
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
  const slotName = createHostedRunnerSlotName(RELEASE_ID);
  const container = new RunnerContainer({ ...state, id: { name: slotName } }, {
    CF_VERSION_METADATA: { id: RELEASE_ID },
    HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: BUNDLE_FINGERPRINT,
    HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: SOURCE_FINGERPRINT,
    ...input.environment,
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
        return new Response(JSON.stringify(createStandbyHealth(
          preflightReady,
          input.healthRegion,
        )), {
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
    slotName,
    startAndWaitForPorts,
  };
}

function createStandbyHealth(
  preflightReady: boolean,
  cloudflareRegion: string = HOSTED_STANDBY_REGION,
): Record<string, unknown> {
  return {
    activeJobCount: 0,
    codexShellPreflightCompletedAtEpochMs: preflightReady ? Date.now() : null,
    codexShellPreflightStatus: preflightReady ? "ready" : "pending",
    cloudflareRegion,
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
