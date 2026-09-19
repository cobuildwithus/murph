import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { RunnerContainer, destroyHostedExecutionContainer } from "../src/runner-container.js";
import { StandbyRunnerContainer } from "../src/standby-runner-container.js";
import { RunnerSlotBindingStore } from "../src/runner-slot-binding.js";
import {
  HOSTED_RUNNER_REGION, HOSTED_STANDBY_REGION,
  createHostedRunnerSlotName, createHostedStandbySlotName, createHostedStandbyClaimId,
  createHostedRunnerContainerNamespaceRouter, hostedRunnerSlotBindingMatchesTarget,
  isHostedRunnerSlotName, isHostedStandbySlotName, readHostedRunnerSlotReleaseId,
  resolveHostedRunnerReleaseId, resolveHostedStandbyCoordinatorName,
} from "../src/standby-runner-contract.js";

import type { DurableObjectStateLike } from "../src/user-runner/types.js";
import { HOSTED_RUNTIME_ARCHITECTURE_VERSION } from "../src/hosted-runtime-architecture.js";

import { createTestSqlStorage } from "./sql-storage.js";

// Isolate logging, egress and job transport; lifecycle, binding, SQL, identity
// validation, startup and retirement below are the actual production owners.
vi.mock("@murphai/hosted-execution", () => ({
  emitHostedExecutionStructuredLog() {},
  deriveHostedExecutionErrorCode(error: unknown) { return error instanceof Error ? error.name : "UnknownError"; },
  buildHostedExecutionSafeErrorDiagnostics() { return {}; },
  sanitizeHostedExecutionStructuredLogDetails(value: unknown) { return value; },
  sanitizeHostedExecutionStructuredLogText(value: unknown) { return value; },
  summarizeHostedExecutionErrorCode(value: unknown) { return value; },
}));
vi.mock("../src/workspace-snapshot-store.ts", () => ({ HOSTED_WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_STALE_MS: 10_000 }));
vi.mock("../src/runner-egress-intercept.ts", () => ({ HOSTED_RUNNER_OUTBOUND_BY_HOST: {} }));
vi.mock("../src/runner-job-transport.ts", () => ({
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND: "workspace-invocation",
  assertHostedExecutionRunnerJobResult() { throw new Error("Unexpected job result parsing"); },
  parseHostedExecutionRunnerJobInput() { throw new Error("Unexpected job parsing"); },
  readHostedExecutionRunnerJobUserId(job: { request: { userId: string } }) { return job.request.userId; },
}));

const RELEASE = "release_1";
const PREVIOUS = { bank: "primary", id: RELEASE, bundleFingerprint: "a".repeat(64), sourceFingerprint: "b".repeat(64) };
const ACTIVE = { bank: "next", id: "next-release_2", bundleFingerprint: "c".repeat(64), sourceFingerprint: "d".repeat(64) };
const PROMOTED = { HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify({ active: ACTIVE, previous: PREVIOUS, candidate: null }) };
const MEMBER = "member-a";
const GLOBAL_SLOT = `runner--v-${RELEASE}--${"1".repeat(32)}`;
const LEGACY_SLOT = `standby--v-${RELEASE}--${"2".repeat(32)}`;
const claimInput = (slotName = GLOBAL_SLOT, userId = MEMBER) => ({
  claimId: createHostedStandbyClaimId(), releaseId: RELEASE,
  region: isHostedStandbySlotName(slotName) ? HOSTED_STANDBY_REGION : HOSTED_RUNNER_REGION,
  slotName, userId,
});

function durableState() {
  const sql = createTestSqlStorage();
  const state: DurableObjectStateLike = {
    storage: {
      sql, transactionSync: callback => sql.transactionSync(callback),
      async delete() { return false; }, async get() { return undefined; },
      async put() {}, async getAlarm() { return null; }, async setAlarm() {},
    },
    waitUntil(promise) { void promise.catch(() => undefined); },
  };
  return { state, sql };
}

function runnerHarness(input: {
  legacy?: boolean; slotName?: string; running?: boolean; status?: string;
  health?: Record<string, unknown>; environment?: Record<string, unknown>;
  destroy?: () => Promise<void>; fetchHealth?: () => Promise<void>;
} = {}) {
  const slotName = input.slotName ?? (input.legacy ? LEGACY_SLOT : GLOBAL_SLOT);
  const { state, sql } = durableState();
  let running = input.running ?? false;
  let status = input.status ?? (running ? "running" : "stopped");
  const calls = { start: 0, destroy: 0, fetch: 0, preflight: 0, renew: 0 };
  const ContainerClass = input.legacy ? StandbyRunnerContainer : RunnerContainer;
  const container = new ContainerClass({
    ...state, id: { name: slotName }, container: { get running() { return running; } },
  }, {
    CF_VERSION_METADATA: { id: RELEASE },
    HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: "bundle-test",
    HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: "source-test",
    ...input.environment,
  });
  Object.assign(container, {
    async getState() { return { lastChange: Date.now(), status }; },
    async startAndWaitForPorts() { calls.start++; running = true; status = "running"; },
    async destroy() { calls.destroy++; await input.destroy?.(); running = false; status = "stopped"; },
    renewActivityTimeout() { calls.renew++; },
    async containerFetch(url: string) {
      calls.fetch++;
      if (url.endsWith("/internal/deploy-codex-shell-smoke")) {
        calls.preflight++;
        return Response.json({ ok: true });
      }
      assert.ok(url.endsWith("/health"), `Unexpected container fetch: ${url}`);
      await input.fetchHealth?.();
      return Response.json({
        ok: true, activeJobCount: 0, codexShellPreflightStatus: "ready",
        codexShellPreflightCompletedAtEpochMs: Date.now(),
        cloudflareRegion: input.legacy ? "ENAM" : "WNAM",
        heavyRuntimeHydrationStatus: "ready", heavyRuntimeHydrationCompletedAtEpochMs: Date.now(),
        hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
        hostedWorkerReleaseId: RELEASE, poisoned: false,
        processStartedAtEpochMs: Date.now() - 20, serverListeningAtEpochMs: Date.now() - 10,
        workspaceInvocationAcceptedCount: 0,
        runnerBundle: { bundleFingerprint: "bundle-test", sourceFingerprint: "source-test" },
        ...input.health,
      });
    },
  });
  return {
    container, calls, slotName, state, sql,
    setNative(runningValue: boolean, statusValue = runningValue ? "running" : "stopped") {
      running = runningValue; status = statusValue;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const retainedInput = (slotName = GLOBAL_SLOT) => ({
  currentReleaseId: RELEASE,
  region: isHostedStandbySlotName(slotName) ? HOSTED_STANDBY_REGION : HOSTED_RUNNER_REGION,
  slotName, userId: MEMBER,
});

describe("unified runner identity and binding", () => {
  it("retires an addressed slot whose preparation never arrived", async () => {
    const { container, calls } = runnerHarness();
    assert.deepEqual(await container.readStandbySlotCoordinatorState(), {
      coordinatorOwned: true,
      releaseId: RELEASE,
      slotName: GLOBAL_SLOT,
      state: "unbound",
    });
    assert.equal(calls.start, 0);
    await container.retireStandbySlot({});
    assert.equal((await container.readStandbySlotBinding()).state, "retired");
    await assert.rejects(container.bindStandbySlot(claimInput()), /cannot be rebound/u);
    await assert.rejects(container.prepareStandbySlot({
      releaseId: RELEASE,
      region: HOSTED_RUNNER_REGION,
      slotName: GLOBAL_SLOT,
      timeoutMs: 1_000,
    }), /not eligible/u);
    assert.equal(calls.start, 0);
  });

  it("uses disjoint global names and explicit local identities", () => {
    const name = createHostedRunnerSlotName(RELEASE);
    assert.match(name, /^runner--v-release_1--[0-9a-f]{32}$/u);
    assert.notEqual(name, createHostedRunnerSlotName(RELEASE));
    assert.equal(isHostedRunnerSlotName(name), true);
    assert.equal(isHostedStandbySlotName(name), false);
    assert.equal(isHostedRunnerSlotName(createHostedStandbySlotName(RELEASE)), false);
    assert.equal(readHostedRunnerSlotReleaseId(name), RELEASE);
    assert.equal(resolveHostedRunnerReleaseId({}), "local");
    assert.throws(() => resolveHostedRunnerReleaseId({ CF_VERSION_METADATA: {} }), /invalid/u);
    assert.equal(resolveHostedStandbyCoordinatorName({ releaseId: RELEASE, region: HOSTED_RUNNER_REGION }),
      "standby-coordinator--v-release_1--r-global");
  });

  it("rejects malformed, foreign and owner-bearing terminal receipts", () => {
    const terminal = { ...retainedInput(), releaseId: RELEASE, state: "retired", userId: null, claimId: null };
    assert.equal(hostedRunnerSlotBindingMatchesTarget(terminal, GLOBAL_SLOT), true);
    for (const invalid of [null, {}, { ...terminal, userId: MEMBER },
      { ...terminal, claimId: createHostedStandbyClaimId() },
      { ...terminal, region: HOSTED_STANDBY_REGION },
      { ...terminal, slotName: LEGACY_SLOT }]) {
      assert.equal(hostedRunnerSlotBindingMatchesTarget(invalid, GLOBAL_SLOT), false);
    }
  });

  it("cold-binds without starting or running pristine preflight; replay is exact", async () => {
    const { container, calls, sql } = runnerHarness();
    const input = claimInput();
    await container.bindStandbySlot(input);
    assert.deepEqual(calls, { start: 0, destroy: 0, fetch: 0, preflight: 0, renew: 0 });
    assert.deepEqual(await container.bindStandbySlot(input), { bound: true, ...input });
    for (const conflict of [
      { userId: "member-b" }, { claimId: createHostedStandbyClaimId() },
      { releaseId: "release_2" }, { region: HOSTED_STANDBY_REGION },
      { slotName: createHostedRunnerSlotName(RELEASE) },
    ]) await assert.rejects(container.bindStandbySlot({ ...input, ...conflict }));
    assert.deepEqual(new RunnerSlotBindingStore(sql).read(), { state: "bound", ...input });
  });

  it("denies member RPCs before binding, wrong members after binding, and all members after retirement", async () => {
    const { container, calls } = runnerHarness();
    await assert.rejects(container.ensureReadyForProcessing({ userId: MEMBER, timeoutMs: 1_000 }), /not bound/u);
    const input = claimInput();
    await container.bindStandbySlot(input);
    await assert.rejects(container.ensureReadyForProcessing({ userId: "member-b", timeoutMs: 1_000 }), /not bound/u);
    await container.retireStandbySlot({ claimId: input.claimId });
    await assert.rejects(container.ensureReadyForProcessing({ userId: MEMBER, timeoutMs: 1_000 }), /not bound/u);
    await assert.rejects(container.bindStandbySlot(input), /rebound/u);
    assert.equal(calls.start, 0);
  });

  it("allows the allocating request to start its just-bound cold target", async () => {
    const { container, calls } = runnerHarness();
    await container.bindStandbySlot(claimInput());
    await container.ensureReadyForProcessing({ userId: MEMBER, timeoutMs: 1_000 });
    assert.equal(calls.start, 1);
    assert.equal(calls.preflight, 0);
  });

  it("prepares global pristine inventory without geographic gating or member ownership", async () => {
    const { container, calls } = runnerHarness();
    await container.prepareStandbySlot({ releaseId: RELEASE, region: HOSTED_RUNNER_REGION, slotName: GLOBAL_SLOT, timeoutMs: 1_000 });
    assert.equal(calls.start, 1);
    assert.deepEqual(await container.readStandbySlotBinding(), {
      claimId: null, releaseId: RELEASE, region: HOSTED_RUNNER_REGION,
      slotName: GLOBAL_SLOT, state: "unbound", userId: null,
    });
    await assert.rejects(container.ensureReadyForProcessing({ userId: MEMBER, timeoutMs: 1_000 }), /not bound/u);
  });

  for (const [label, health] of Object.entries({
    architecture: { hostedRuntimeArchitectureVersion: "old" },
    release: { hostedWorkerReleaseId: "old" },
    bundle: { runnerBundle: { bundleFingerprint: "bad", sourceFingerprint: "source-test" } },
    source: { runnerBundle: { bundleFingerprint: "bundle-test", sourceFingerprint: "bad" } },
    pristine: { workspaceInvocationAcceptedCount: 1 },
    active: { activeJobCount: 1 },
    poisoned: { poisoned: true },
    hydration: { heavyRuntimeHydrationStatus: "pending" },
  })) it(`still rejects invalid global inventory ${label} proof`, async () => {
    const { container } = runnerHarness({ health });
    await assert.rejects(container.prepareStandbySlot({ releaseId: RELEASE, region: HOSTED_RUNNER_REGION, slotName: GLOBAL_SLOT, timeoutMs: 50 }));
  });

  it("serializes preparation and binding on the same lifecycle lock", async () => {
    const gate = deferred<void>();
    const entered = deferred<void>();
    const { container } = runnerHarness({ fetchHealth: async () => { entered.resolve(); await gate.promise; } });
    const prepare = container.prepareStandbySlot({ releaseId: RELEASE, region: HOSTED_RUNNER_REGION, slotName: GLOBAL_SLOT, timeoutMs: 1_000 });
    await entered.promise;
    const bind = container.bindStandbySlot(claimInput());
    await Promise.resolve();
    assert.equal((await container.readStandbySlotBinding()).state, "unbound");
    gate.resolve();
    await prepare;
    await bind;
    assert.equal((await container.readStandbySlotBinding()).state, "bound");
  });
});

describe("native warm retention and terminal retirement", () => {
  it("retains a natively warm current bound target without start or health fetch", async () => {
    const { container, calls } = runnerHarness({ running: true });
    const input = claimInput();
    await container.bindStandbySlot(input);
    assert.deepEqual(await container.resolveRetainedStandbySlot(retainedInput()), { state: "bound", ...input });
    assert.equal(calls.start, 0);
    assert.equal(calls.fetch, 0);
    assert.equal(calls.destroy, 0);
    assert.equal(calls.renew, 1);
  });

  it("does not treat a provider binding or stale SDK running status as warmth", async () => {
    const { container, calls } = runnerHarness({ running: false, status: "running" });
    await container.bindStandbySlot(claimInput());
    assert.equal((await container.resolveRetainedStandbySlot(retainedInput())).state, "retired");
    assert.equal(calls.start, 0);
    assert.equal(calls.fetch, 0);
  });

  it("reconciles a never-delivered bind by initializing only identity and retiring it", async () => {
    const { container, calls } = runnerHarness();
    assert.equal((await container.resolveRetainedStandbySlot(retainedInput())).state, "retired");
    await assert.rejects(container.bindStandbySlot(claimInput()), /rebound/u);
    assert.equal(calls.start, 0);
  });

  it("stop/reset retires an uninitialized pending target through its binding owner", async () => {
    const { container, calls } = runnerHarness();
    const result = await destroyHostedExecutionContainer({ runnerContainerNamespace: { getByName: () => container }, runnerContainerName: GLOBAL_SLOT, userId: MEMBER });
    assert.equal(result.ok, true);
    assert.equal((await container.readStandbySlotBinding()).state, "retired");
    assert.equal(calls.start, 0);
    await assert.rejects(container.bindStandbySlot(claimInput()), /rebound/u);
  });

  it("rejects foreign member recovery and stop without destroying their target", async () => {
    const { container, calls } = runnerHarness({ running: true });
    await container.bindStandbySlot(claimInput(GLOBAL_SLOT, "member-b"));
    await assert.rejects(container.resolveRetainedStandbySlot(retainedInput()), /another member/u);
    const result = await destroyHostedExecutionContainer({ runnerContainerNamespace: { getByName: () => container }, runnerContainerName: GLOBAL_SLOT, userId: MEMBER });
    assert.equal(result.ok, false);
    assert.equal(calls.destroy, 0);
    assert.equal((await container.readStandbySlotBinding()).state, "bound");
  });

  it("pins failed retirement, blocks rebind, and completes exactly after stop succeeds", async () => {
    let failStop = true;
    const { container, calls } = runnerHarness({ running: true, destroy: async () => { if (failStop) throw new Error("provider unavailable"); } });
    const input = claimInput();
    await container.bindStandbySlot(input);
    await assert.rejects(container.retireStandbySlot({ claimId: input.claimId }));
    assert.equal((await container.readStandbySlotBinding()).state, "retiring");
    await assert.rejects(container.bindStandbySlot(input), /rebound/u);
    failStop = false;
    await container.retireStandbySlot({ claimId: input.claimId });
    assert.equal((await container.readStandbySlotBinding()).state, "retired");
    assert.equal(calls.start, 0);
  });

  it("awaits native stop and durable retirement without a binding readback", async () => {
    const stopped = deferred<void>();
    const { container, sql } = runnerHarness({ running: true, destroy: () => stopped.promise });
    await container.bindStandbySlot(claimInput());
    const readBinding = vi.spyOn(container, "readStandbySlotBinding");
    const store = new RunnerSlotBindingStore(sql);
    let settled = false;
    const cleanup = destroyHostedExecutionContainer({ runnerContainerNamespace: { getByName: () => container }, runnerContainerName: GLOBAL_SLOT, userId: MEMBER });
    void cleanup.then(() => { settled = true; });
    await vi.waitFor(() => assert.equal(store.read().state, "retiring"));
    assert.equal(settled, false);
    stopped.resolve();
    assert.equal((await cleanup).ok, true);
    assert.equal(store.read().state, "retired");
    assert.equal(store.read().userId, null);
    assert.equal(readBinding.mock.calls.length, 0);
  });

  it("rejects new inventory preparation and new binding in the legacy class", async () => {
    const { container } = runnerHarness({ legacy: true });
    await assert.rejects(container.prepareStandbySlot({ releaseId: RELEASE, region: HOSTED_STANDBY_REGION, slotName: LEGACY_SLOT, timeoutMs: 1_000 }), /drain-only/u);
    await assert.rejects(container.bindStandbySlot(claimInput(LEGACY_SLOT)), /drain-only/u);
  });

  it("retires unsupported prior-release bindings even when their native container is warm", async () => {
    const { container, sql, calls } = runnerHarness({ running: true, environment: { CF_VERSION_METADATA: { id: "release_2" } } });
    const oldBinding = new RunnerSlotBindingStore(sql);
    oldBinding.initialize(claimInput());
    oldBinding.bind(claimInput());
    const result = await container.resolveRetainedStandbySlot({ ...retainedInput(), currentReleaseId: "release_2" });
    assert.equal(result.state, "retired");
    assert.equal(result.releaseId, RELEASE);
    assert.equal(calls.start, 0);
    assert.equal(calls.destroy, 1);
  });

  for (const currentReleaseId of [RELEASE, ACTIVE.id]) {
    it(`retains the exactly bound warm previous process for controller ${currentReleaseId}`, async () => {
      const h = runnerHarness({ running: true, environment: PROMOTED });
      const store = new RunnerSlotBindingStore(h.sql);
      const claim = claimInput();
      store.initialize(claim);
      store.bind(claim);
      assert.deepEqual(await h.container.resolveRetainedStandbySlot({ ...retainedInput(), currentReleaseId }), store.read());
      await h.container.bindStandbySlot(claim); // exact delayed replay preserves the immutable owner
      await assert.rejects(h.container.bindStandbySlot({ ...claim, userId: "member-b" }));
      assert.equal(h.calls.destroy, 0);
      assert.equal(h.calls.start, 0);
    });
  }

  it("never revives a cold previous process or admits new work to its draining bank", async () => {
    const h = runnerHarness({ environment: PROMOTED });
    await assert.rejects(h.container.bindStandbySlot(claimInput()), /active runner release/u);
    await assert.rejects(h.container.prepareStandbySlot({ ...claimInput(), timeoutMs: 1_000 }), /drain-only/u);
    const store = new RunnerSlotBindingStore(h.sql);
    const claim = claimInput();
    store.initialize(claim);
    store.bind(claim);
    await assert.rejects(h.container.ensureReadyForProcessing({ timeoutMs: 1_000, userId: MEMBER }), /cannot start/u);
    assert.equal((await h.container.resolveRetainedStandbySlot({ ...retainedInput(), currentReleaseId: ACTIVE.id })).state, "retired");
    assert.equal(h.calls.start, 0);
  });

  it("fences delayed old bindings when a drained namespace is reused for the third release", async () => {
    const third = { ...PREVIOUS, id: "primary-third", bundleFingerprint: "e".repeat(64), sourceFingerprint: "f".repeat(64) };
    const h = runnerHarness({ environment: { HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify({ active: third, previous: ACTIVE, candidate: null }) } });
    const store = new RunnerSlotBindingStore(h.sql);
    const claim = claimInput();
    store.initialize(claim);
    store.bind(claim);
    await assert.rejects(h.container.bindStandbySlot(claim), /release is stale/u);
    await assert.rejects(h.container.resolveRetainedStandbySlot(retainedInput()), /authority is stale/u);
    assert.equal((await h.container.resolveRetainedStandbySlot({ ...retainedInput(), currentReleaseId: third.id })).state, "retired");
    assert.equal(h.calls.start, 0);
  });

  it("drains legacy ENAM targets only through the legacy namespace with no main fallback", async () => {
    const main = runnerHarness();
    const legacy = runnerHarness({ legacy: true, running: true });
    const names: unknown[][] = [];
    const router = createHostedRunnerContainerNamespaceRouter({
      exactUser: { getByName(name) { names.push(["main", name]); return main.container; } },
      standby: { getByName(name, options) { names.push(["legacy", name, options]); return legacy.container; } },
    });
    assert.ok(router);
    router.getByName(GLOBAL_SLOT);
    router.getByName("member-a--v-release_1");
    const legacyBinding = new RunnerSlotBindingStore(legacy.sql);
    const historicalClaim = claimInput(LEGACY_SLOT);
    legacyBinding.initialize(historicalClaim);
    legacyBinding.bind(historicalClaim);
    await legacy.container.bindStandbySlot(historicalClaim); // exact drain replay only
    assert.equal((await router.getByName(LEGACY_SLOT).resolveRetainedStandbySlot!(retainedInput(LEGACY_SLOT))).state, "bound");
    assert.deepEqual(names, [["main", GLOBAL_SLOT], ["main", "member-a--v-release_1"], ["legacy", LEGACY_SLOT, { locationHint: "enam" }]]);
    assert.equal((await destroyHostedExecutionContainer({ runnerContainerNamespace: router, runnerContainerName: LEGACY_SLOT, userId: MEMBER })).ok, true);
    await assert.rejects(main.container.bindStandbySlot(claimInput(LEGACY_SLOT)), /namespace/u);
    await assert.rejects(legacy.container.bindStandbySlot(claimInput(GLOBAL_SLOT)), /namespace/u);
    const noLegacy = createHostedRunnerContainerNamespaceRouter({ exactUser: { getByName: () => main.container }, standby: null });
    assert.throws(() => noLegacy?.getByName(LEGACY_SLOT), /unavailable/u);
  });
});
