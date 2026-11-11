import { Container } from "@cloudflare/containers";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { RunnerContainer, destroyHostedExecutionContainer } from "../src/runner-container.js";
import { StandbyRunnerContainer } from "../src/standby-runner-container.js";
import { RunnerInvocationReceiptStore } from "../src/runner-invocation-receipt.ts";
import { RunnerSlotBindingStore } from "../src/runner-slot-binding.js";
import {
  HOSTED_RUNNER_REGION, HOSTED_STANDBY_REGION,
  createHostedRunnerSlotName, createHostedStandbySlotName, createHostedStandbyClaimId,
  createHostedRunnerContainerNamespaceRouter, hostedRunnerSlotBindingMatchesTarget,
  isHostedRunnerSlotName, isHostedStandbySlotName, readHostedRunnerSlotReleaseId,
  resolveHostedRunnerReleaseId, resolveHostedStandbyCoordinatorName,
} from "../src/standby-runner-contract.js";

import { HOSTED_RUNTIME_ARCHITECTURE_VERSION } from "../src/hosted-runtime-architecture.js";

import { createTestSqlStorage } from "./sql-storage.js";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import type { HostedRuntimeOwnerCommand, HostedRuntimeOwnerResponse, HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";

// Use the installed SDK, including its SQLite schedules and JSON alarm dispatch.
vi.mock("@cloudflare/containers", async () => {
  const { createRequire } = await import("node:module");
  return vi.importActual(createRequire(import.meta.url).resolve("@cloudflare/containers"));
});
vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(public ctx: unknown, public env: unknown) {}
  },
  WorkerEntrypoint: class {},
}));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

vi.mock("../src/runtime-owner-client.ts", () => ({ commandHostedRuntimeOwner: vi.fn() }));
beforeEach(() => {
  vi.mocked(commandHostedRuntimeOwner).mockReset();
  vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "observed", owner: null });
});

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
  parseHostedExecutionRunnerJobInput(job: unknown) { return job; },
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
  const pending: Promise<unknown>[] = [];
  const state = {
    storage: {
      sql, transactionSync: <T>(callback: () => T) => sql.transactionSync(callback),
      kv: { get() { return undefined; } },
      async sync() {}, async deleteAlarm() {},
      async delete() { return false; }, async get() { return undefined; },
      async put() {}, async getAlarm() { return null; }, async setAlarm() {},
    },
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
    waitUntil(promise: Promise<unknown>) { pending.push(promise); void promise.catch(() => undefined); },
  };
  return { state, sql, pending };
}

function runnerHarness(input: {
  legacy?: boolean; slotName?: string; running?: boolean; status?: string;
  health?: Record<string, unknown>; environment?: Record<string, unknown>;
  destroy?: () => Promise<void>; fetchHealth?: () => Promise<void>;
  invoke?: () => Promise<Response>; abort?: () => void;
  durable?: ReturnType<typeof durableState>;
} = {}) {
  const slotName = input.slotName ?? (input.legacy ? LEGACY_SLOT : GLOBAL_SLOT);
  const { state, sql, pending } = input.durable ?? durableState();
  let running = input.running ?? false;
  let status = input.status ?? (running ? "running" : "stopped");
  const calls = { start: 0, destroy: 0, fetch: 0, renew: 0 };
  const ContainerClass = input.legacy ? StandbyRunnerContainer : RunnerContainer;
  const container = new ContainerClass({
    ...state, id: { name: slotName }, container: {
      get running() { return running; },
      monitor() { return new Promise<void>(() => {}); },
      getTcpPort() { return { fetch: (url: string) => container.containerFetch(url) }; },
    },
  }, {
    CF_VERSION_METADATA: { id: RELEASE },
    HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: "bundle-test",
    HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: "source-test",
    ...input.environment,
  });
  Object.assign(container, {
    async applyOutboundInterception() {},
    async getState() { return { lastChange: Date.now(), status }; },
    async startAndWaitForPorts() { calls.start++; running = true; status = "running"; },
    async destroy() { calls.destroy++; await input.destroy?.(); running = false; status = "stopped"; },
    renewActivityTimeout() { calls.renew++; Container.prototype.renewActivityTimeout.call(container); },
    async containerFetch(url: string) {
      calls.fetch++;
      if (url.endsWith("/internal/workspace-invocation") && input.invoke) return input.invoke();
      if (url.endsWith("/internal/workspace-invocation/abort")) {
        input.abort?.();
        return new Response(null, { status: 204, headers: { "x-workspace-invocation-abort-status": "accepted" } });
      }
      assert.ok(url.endsWith("/health"), `Unexpected container fetch: ${url}`);
      await input.fetchHealth?.();
      return Response.json({
        ok: true, activeJobCount: 0,
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
    container, calls, slotName, state, sql, pending,
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
    assert.deepEqual(calls, { start: 0, destroy: 0, fetch: 0, renew: 1 });
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
  });

  it("prepares global pristine inventory through ordinary health without waiting for hydration", async () => {
    const { container, calls } = runnerHarness({ health: { heavyRuntimeHydrationStatus: "pending" } });
    await container.prepareStandbySlot({ releaseId: RELEASE, region: HOSTED_RUNNER_REGION, slotName: GLOBAL_SLOT, timeoutMs: 1_000 });
    assert.equal(calls.start, 1);
    assert.equal(calls.fetch, 2);
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
    settling: { activeJobCount: 1, settlingCompletionCallbackCount: 1 },
    poisoned: { poisoned: true },
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

function owner(phase: HostedRuntimeOwnerSnapshot["phase"], runnerContainerName = GLOBAL_SLOT): HostedRuntimeOwnerSnapshot {
  return {
    userId: MEMBER, attemptId: "attempt-starting", generation: "1", phase,
    processingMode: "default", allocationId: "synthetic-allocation", runnerContainerName,
    workspaceVersion: null, platformAiUsageAllowed: false,
    startedAt: new Date().toISOString(), acceptedAt: null, completedAt: null,
    failureCount: 0, lastErrorCode: null,
  };
}

function webOwner(current: HostedRuntimeOwnerSnapshot) {
  const commands: HostedRuntimeOwnerCommand[] = [];
  const control = { current, commands, lostNotices: 0, lostCompletions: 0,
    beforeRead: () => {}, beforeNotice: () => {} };
  vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command, userId }) => {
    assert.equal(userId, MEMBER);
    commands.push(command);
    const reply = (status: HostedRuntimeOwnerResponse["status"]): HostedRuntimeOwnerResponse =>
      ({ cutover: "postgres", status, owner: { ...current } });
    const idle = (clearTarget: boolean) => Object.assign(current, {
      phase: "idle", attemptId: null, processingMode: null, workspaceVersion: null, platformAiUsageAllowed: false,
      ...(clearTarget ? { runnerContainerName: null, allocationId: null } : {}),
    });
    if (command.operation === "reconcile") {
      const snapshot = reply("observed");
      control.beforeRead();
      return snapshot;
    }
    if (command.operation === "target_retired") {
      control.beforeNotice();
      const exact = current.runnerContainerName === command.runnerContainerName;
      if (exact) idle(true);
      if (control.lostNotices-- > 0) throw new Error("synthetic lost retirement acknowledgement");
      return reply(exact ? "updated" : "stale");
    }
    if (!("attemptId" in command) || command.attemptId !== current.attemptId
      || command.generation !== current.generation) return reply("stale");
    if (command.operation === "prepare_launch") return reply("updated");
    if (command.operation === "record_failure") return reply("updated");
    if (command.operation === "complete") {
      if (control.lostCompletions-- > 0) throw new Error("synthetic lost completion");
      if (command.settledRunnerContainerName !== null && command.settledRunnerContainerName !== current.runnerContainerName
        || current.phase === "idle" || current.phase === "retiring" && current.completedAt === null) return reply("stale");
      current.phase = "retiring";
      current.completedAt ??= new Date().toISOString();
      if (command.settledRunnerContainerName !== null) idle(false);
      return reply("updated");
    }
    if (command.operation === "retire" && current.phase !== "idle") {
      current.phase = "retiring";
      current.completedAt = command.completed ? new Date().toISOString() : null;
      return reply("updated");
    }
    if (command.operation === "release" && current.phase === "retiring" && current.runnerContainerName === command.runnerContainerName) {
      idle(true);
      return reply("updated");
    }
    throw new Error(`Unexpected command: ${command.operation}`);
  });
  return control;
}

async function alarm(h: ReturnType<typeof runnerHarness>) {
  const [schedule] = await h.container.listSchedules("onActivityExpired");
  assert.ok(schedule, "Lifecycle retry must be durably armed");
  // The installed SDK reads and consumes the SQL row, including JSON payload dispatch.
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(schedule.time * 1_000);
  const pass = h.container.alarm();
  await vi.runAllTimersAsync();
  await pass;
  await Promise.all(h.pending);
  vi.useFakeTimers({ toFake: ["Date"] });
}

describe("bound runner idle cleanup respects canonical runtime ownership", () => {
  it.each([false, true])("skips owner polls until the receipt deadline (reactivated=%s)", async (reactivated) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const receipt = Date.parse("2026-10-01T12:00:00Z");
      vi.setSystemTime(receipt);
      const health = { conversationActivityReceivedAtEpochMs: receipt };
      const initial = runnerHarness({ running: true, health });
      await initial.container.bindStandbySlot(claimInput());
      vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({
        cutover: "postgres", status: "observed", owner: owner("active"),
      });
      await initial.container.onActivityExpired();
      const { container, calls } = reactivated
        ? runnerHarness({ running: true, health, durable: initial }) : initial;
      for (let elapsed = 60_000; elapsed < 600_000; elapsed += 60_000) {
        vi.setSystemTime(receipt + elapsed);
        await container.onActivityExpired();
        assert.equal(vi.mocked(commandHostedRuntimeOwner).mock.calls.length, 0);
        assert.equal(calls.destroy, 0);
        assert.deepEqual((await container.listSchedules("onActivityExpired")).map(s => s.time),
          [(receipt + 600_000) / 1_000]);
      }
      // Once the local deadline expires, denial has no safe longer deadline.
      for (const elapsed of [600_000, 660_000]) {
        vi.setSystemTime(receipt + elapsed);
        await container.onActivityExpired();
        assert.equal(vi.mocked(commandHostedRuntimeOwner).mock.calls.length, elapsed / 60_000 - 9);
        assert.equal(calls.destroy, 0);
        assert.deepEqual((await container.listSchedules("onActivityExpired")).map(s => s.time),
          [(receipt + elapsed + 60_000) / 1_000]);
      }
      vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({
        cutover: "postgres", status: "observed", owner: owner("idle"),
      });
      vi.setSystemTime(receipt + 720_000);
      await container.onActivityExpired();
      assert.equal(calls.destroy, 1);
      assert.deepEqual(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([call]) => call.command.operation),
        ["reconcile", "reconcile", "reconcile", "target_retired"]);
      assert.deepEqual(await container.listSchedules("onActivityExpired"), []);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { name: "stopped", running: false, status: "stopped", health: {} },
    { name: "starting", running: true, status: "starting", health: {} },
    { name: "active jobs", running: true, status: "running", health: { activeJobCount: 1 } },
  ])("skips the owner read when local state prevents cleanup: $name", async ({ running, status, health }) => {
    const { container, calls } = runnerHarness({ running, status, health });
    await container.bindStandbySlot(claimInput());
    await container.onActivityExpired();
    assert.equal(vi.mocked(commandHostedRuntimeOwner).mock.calls.length, 0);
    assert.equal(calls.destroy, 0);
  });

  it.each(["jobs", "receipt"] as const)("rechecks local %s under the lock after Web allows cleanup", async (change) => {
    const health: Record<string, unknown> = {};
    const { container, calls } = runnerHarness({ running: true, health });
    await container.bindStandbySlot(claimInput());
    vi.mocked(commandHostedRuntimeOwner).mockImplementationOnce(async () => {
      Object.assign(health, change === "jobs"
        ? { activeJobCount: 1 } : { conversationActivityReceivedAtEpochMs: Date.now() });
      return { cutover: "postgres", status: "observed", owner: owner("idle") };
    });
    await container.onActivityExpired();
    assert.equal(vi.mocked(commandHostedRuntimeOwner).mock.calls.length, 1);
    assert.equal(calls.fetch, 2);
    assert.equal(calls.destroy, 0);
    assert.equal((await container.listSchedules("onActivityExpired")).length, 1);
  });

  it.each([false, true])("preserves admitted startup between readiness and launch (reactivated=%s)", async (reactivated) => {
    const initial = runnerHarness({ running: true });
    await initial.container.prepareStandbySlot({ releaseId: RELEASE, region: HOSTED_RUNNER_REGION, slotName: GLOBAL_SLOT, timeoutMs: 1_000 });
    await initial.container.bindStandbySlot(claimInput());
    await initial.container.ensureReadyForProcessing({ userId: MEMBER, timeoutMs: 1_000 });
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "observed", owner: owner("starting") });
    const { container, calls } = reactivated ? runnerHarness({ running: true, durable: initial }) : initial;
    await container.onActivityExpired();
    assert.equal(calls.destroy, 0);
    assert.equal((await container.readStandbySlotBinding()).state, "bound");
    assert.equal((await container.listSchedules("onActivityExpired")).length, 1);
    await container.ensureReadyForProcessing({ userId: MEMBER, timeoutMs: 1_000 });
    assert.equal(calls.start, 0);
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "observed", owner: owner("idle") });
    await container.onActivityExpired();
    assert.equal(calls.destroy, 1);
    assert.equal((await container.readStandbySlotBinding()).state, "retired");
  });

  it.each(["active", "retiring"] as const)("preserves an exact %s owner without local work", async (phase) => {
    const { container, calls } = runnerHarness({ running: true });
    await container.bindStandbySlot(claimInput());
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "observed", owner: owner(phase) });
    await container.onActivityExpired();
    assert.equal(calls.destroy, 0);
  });

  it.each((["starting", "active", "retiring"] as const).flatMap(phase =>
    [false, true].flatMap(reactivated => [false, true].map(warm => ({ phase, reactivated, warm }))))) (
    "releases both lost completion acknowledgements without demand: $phase eviction=$reactivated warm=$warm", async ({ phase, reactivated, warm }) => {
      const health = warm ? { conversationActivityReceivedAtEpochMs: Date.now() } : {};
      const initial = runnerHarness({ running: true, health });
      await initial.container.bindStandbySlot(claimInput());
      await initial.container.ensureReadyForProcessing({ userId: MEMBER, timeoutMs: 1_000 });
      const current = { ...owner(phase), completedAt: phase === "retiring" ? new Date().toISOString() : null };
      const web = webOwner(current);
      const receipt = new RunnerInvocationReceiptStore(initial.sql);
      const identity = { attemptId: current.attemptId!, generation: current.generation };
      receipt.register(identity);
      receipt.complete(identity);
      const h = reactivated ? runnerHarness({ running: true, durable: initial, health }) : initial;
      await alarm(h);
      assert.equal(current.phase, "idle");
      assert.deepEqual(web.commands.filter(c => c.operation === "complete"), [
        { operation: "complete", ...identity, settledRunnerContainerName: GLOBAL_SLOT, immediateRecheckRequested: false },
      ]);
      if (warm) {
        assert.equal(h.calls.destroy, 0);
        await h.container.onActivityExpired();
      } else if ((await h.container.listSchedules("onActivityExpired")).length) await alarm(h);
      assert.equal(h.calls.destroy, warm ? 0 : 1);
    },
  );

  it.each([false, true])("retries lost-result recovery before warmth expires (reactivated=%s)", async (reactivated) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const now = Date.parse("2026-10-20T12:00:00Z");
      vi.setSystemTime(now);
      const health = { conversationActivityReceivedAtEpochMs: now };
      const initial = runnerHarness({ running: true, health });
      await initial.container.bindStandbySlot(claimInput());
      const current = { ...owner("retiring"), completedAt: new Date().toISOString() };
      const receipt = new RunnerInvocationReceiptStore(initial.sql);
      const identity = { attemptId: current.attemptId!, generation: current.generation };
      receipt.register(identity);
      receipt.complete(identity);
      let completionCalls = 0;
      vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) => {
        if (command.operation === "complete") {
          completionCalls++;
          throw new Error("synthetic unavailable completion");
        }
        return { cutover: "postgres", status: "observed", owner: current };
      });
      const { container, calls } = reactivated
        ? runnerHarness({ running: true, durable: initial, health }) : initial;
      for (const elapsed of [0, 60_000]) {
        vi.setSystemTime(now + elapsed);
        await container.onActivityExpired();
        assert.equal(completionCalls, elapsed / 60_000 + 1);
        assert.equal(calls.destroy, 0);
        assert.deepEqual((await container.listSchedules("onActivityExpired")).map(s => s.time),
          [(now + elapsed + 60_000) / 1_000]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it.each((["starting", "active", "retiring"] as const).flatMap(phase =>
    (["registered", "wrong-attempt", "wrong-generation", "wrong-target", "active", "unknown", "failed-completion", "successor"] as const)
      .map(condition => ({ phase, condition }))))(
    "preserves native authority during lost-result recovery: $phase $condition", async ({ phase, condition }) => {
      const h = runnerHarness({ running: true,
        health: condition === "active" ? { activeJobCount: 1 } : {},
        fetchHealth: condition === "unknown" ? async () => { throw new Error("synthetic unavailable health"); } : undefined,
      });
      await h.container.bindStandbySlot(claimInput());
      const current = { ...owner(phase), completedAt: phase === "retiring" ? new Date().toISOString() : null };
      const web = webOwner(current);
      if (condition === "failed-completion") web.lostCompletions = 1;
      if (condition === "successor" || condition === "wrong-target") web.beforeRead = () => {
        if (condition === "wrong-target") current.runnerContainerName = createHostedRunnerSlotName(RELEASE);
        else Object.assign(current, { attemptId: "successor-attempt", generation: "2", phase: "starting", completedAt: null });
      };
      const receipt = new RunnerInvocationReceiptStore(h.sql);
      const identity = { attemptId: condition === "wrong-attempt" ? "other-attempt" : current.attemptId!,
        generation: condition === "wrong-generation" ? "2" : current.generation };
      receipt.register(identity);
      if (condition !== "registered") receipt.complete(identity);
      await h.container.onActivityExpired();
      assert.equal(web.commands.filter(c => c.operation === "complete").length,
        ["failed-completion", "successor", "wrong-target"].includes(condition) ? 1 : 0);
      assert.notEqual(current.phase, "idle");
      if (condition === "successor") await alarm(h);
      assert.equal(h.calls.destroy, 0);
      assert.equal((await h.container.listSchedules("onActivityExpired")).length, 1);
    },
  );

  it("leaves a cold retirement to its stop owner despite a completed receipt", async () => {
    const h = runnerHarness({ running: true });
    await h.container.bindStandbySlot(claimInput());
    const web = webOwner(owner("retiring"));
    const receipts = new RunnerInvocationReceiptStore(h.sql);
    receipts.register({ attemptId: web.current.attemptId!, generation: "1" });
    receipts.complete({ attemptId: web.current.attemptId!, generation: "1" });
    await h.container.onActivityExpired();
    assert.deepEqual(web.commands.map(c => c.operation), ["reconcile"]);
    assert.equal(h.calls.destroy, 0);
  });

  it("does not block arriving readiness on an idle owner read or apply its stale cleanup", async () => {
    const { container, calls } = runnerHarness({ running: true });
    await container.bindStandbySlot(claimInput());
    const entered = deferred<void>();
    const response = deferred<Awaited<ReturnType<typeof commandHostedRuntimeOwner>>>();
    vi.mocked(commandHostedRuntimeOwner).mockImplementationOnce(() => { entered.resolve(); return response.promise; });
    const expiry = container.onActivityExpired();
    await entered.promise;
    // Must finish while the control read is still unresolved.
    await container.ensureReadyForProcessing({ userId: MEMBER, timeoutMs: 1_000 });
    response.resolve({ cutover: "postgres", status: "observed", owner: owner("idle") });
    await expiry;
    assert.equal(calls.destroy, 0);
    assert.equal(calls.start, 0);
  });

  it("does not let a different target retain an obsolete shell", async () => {
    const { container, calls } = runnerHarness({ running: true });
    await container.bindStandbySlot(claimInput());
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "observed", owner: owner("starting", createHostedRunnerSlotName(RELEASE)) });
    await container.onActivityExpired();
    assert.equal(calls.destroy, 1);
  });

  it.each(["unavailable"] as const)("keeps the scheduled retry when ownership is %s", async (outcome) => {
    const { container, calls } = runnerHarness({ running: true });
    await container.bindStandbySlot(claimInput());
    vi.mocked(commandHostedRuntimeOwner).mockRejectedValue(new Error("synthetic control timeout"));
    await container.onActivityExpired();
    assert.equal(calls.destroy, 0);
    assert.equal((await container.listSchedules("onActivityExpired")).length, 1);
  });
});

function invocation() {
  return { userId: MEMBER, job: { kind: "workspace-invocation" as const, request: {
    userId: MEMBER, attemptId: "attempt-starting", leaseGeneration: "1", workspaceVersion: "0",
    workspace: null, runnerIdleTtlMs: 600_000,
  } } };
}

async function failedInvocation(input: Parameters<typeof runnerHarness>[0] = {}) {
  const h = runnerHarness({ running: true, invoke: async () => Response.json({ error: "synthetic job failure" }, { status: 500 }), ...input });
  await h.container.bindStandbySlot(claimInput());
  const web = webOwner({ ...owner("active"), workspaceVersion: "0" });
  await h.container.startSupervisedInvocation({ ...invocation(),
    launch: { providerEgressTokenHash: null, platformAiUsageAllowed: false } });
  await Promise.all(h.pending);
  assert.equal(new RunnerInvocationReceiptStore(h.sql).read()?.state, "registered");
  return { h, web };
}

describe("alarm recovery of native outcomes", () => {
  it.each(["completed", "registered", "wrong-attempt", "wrong-generation", "stopped", "stale-stopped-status"] as const)(
    "settles retained transport uncertainty only with completion or stoppedness: %s", async condition => {
      let aborts = 0;
      const { h, web } = await failedInvocation({
        invoke: async () => { throw new Error("Network connection lost"); }, abort: () => { aborts++; },
      });
      assert.equal(h.calls.destroy, 0);
      assert.equal((await h.container.readActiveRuntimeUserFence()).active, true);
      const receipts = new RunnerInvocationReceiptStore(h.sql);
      if (condition === "completed") receipts.complete({ attemptId: "attempt-starting", generation: "1" });
      if (condition === "wrong-attempt" || condition === "wrong-generation") {
        receipts.complete({ attemptId: "attempt-starting", generation: "1" });
        receipts.register({ attemptId: condition === "wrong-attempt" ? "another-attempt" : "attempt-starting", generation: "2" });
        receipts.complete({ attemptId: condition === "wrong-attempt" ? "another-attempt" : "attempt-starting", generation: "2" });
      }
      if (condition === "stopped") h.setNative(false);
      if (condition === "stale-stopped-status") h.setNative(true, "stopped");
      await alarm(h);
      await alarm(h);
      if (condition === "completed" || condition === "stopped") {
        assert.equal(web.current.phase, "idle");
        assert.equal(h.calls.destroy, condition === "completed" ? 1 : 0);
        assert.equal(aborts, condition === "completed" ? 1 : 0);
        assert.equal(web.commands.filter(c => c.operation === "complete").length, condition === "completed" ? 1 : 0);
      } else {
        assert.equal((await h.container.readActiveRuntimeUserFence()).active, true);
        assert.equal(h.calls.destroy, 0);
        assert.equal(aborts, 0);
        assert.equal((await h.container.readStandbySlotBinding()).state, "bound");
      }
    },
  );

  it("retries a failed alarm stop until the exact completed attempt settles without demand", async () => {
    let stopFails = true;
    const { h, web } = await failedInvocation({
      invoke: async () => { throw new Error("Network connection lost"); },
      destroy: async () => { if (stopFails) throw new Error("synthetic stop failure"); },
    });
    new RunnerInvocationReceiptStore(h.sql).complete({ attemptId: "attempt-starting", generation: "1" });
    await alarm(h);
    const failedStops = h.calls.destroy;
    assert.ok(failedStops > 0);
    assert.equal((await h.container.readActiveRuntimeUserFence()).active, true);
    assert.equal(web.current.phase, "active");
    stopFails = false;
    await alarm(h);
    assert.equal(h.calls.destroy, failedStops + 1);
    await alarm(h);
    assert.equal(web.current.phase, "idle");
    assert.deepEqual(web.commands.filter(c => c.operation === "complete"), [{ operation: "complete",
      attemptId: "attempt-starting", generation: "1", settledRunnerContainerName: GLOBAL_SLOT, immediateRecheckRequested: false }]);
  });

  it.each(["acknowledged", "lost-ack", "evict-after-retirement", "evict-before-notify"] as const)(
    "retires a stopped voice-only failure and durably routes notification: %s", async condition => {
      const { h: initial, web } = await failedInvocation();
      assert.equal(initial.calls.destroy, 1);
      if (condition === "lost-ack" || condition === "evict-after-retirement") web.lostNotices = 1;
      const finish = RunnerSlotBindingStore.prototype.finishRetirement;
      const interruption = condition === "evict-before-notify"
        ? vi.spyOn(RunnerSlotBindingStore.prototype, "finishRetirement").mockImplementation(function (this: RunnerSlotBindingStore) {
          const row = initial.sql.exec("SELECT payload FROM container_schedules WHERE callback = ?", "onActivityExpired").one();
          assert.deepEqual(JSON.parse(String(row.payload)), { userId: MEMBER, runnerContainerName: GLOBAL_SLOT });
          finish.call(this);
          throw new Error("synthetic eviction before notification");
        }) : null;
      await alarm(initial);
      interruption?.mockRestore();
      assert.equal((await initial.container.readStandbySlotBinding()).state, "retired");
      const h = condition.startsWith("evict-") ? runnerHarness({ durable: initial }) : initial;
      if (condition !== "acknowledged") {
        assert.deepEqual((await h.container.listSchedules("onActivityExpired")).map(s => s.payload),
          [{ userId: MEMBER, runnerContainerName: GLOBAL_SLOT }]);
        await alarm(h);
      }
      assert.equal(web.current.phase, "idle");
      assert.equal(web.current.runnerContainerName, null);
      assert.equal(web.current.allocationId, null);
      assert.equal((await h.container.resolveRetainedStandbySlot(retainedInput())).state, "retired");
      assert.equal(new RunnerInvocationReceiptStore(h.sql).read()?.state, "registered");
      assert.equal(web.commands.some(c => ["complete", "retire", "release"].includes(c.operation)), false);
      assert.equal((await h.container.listSchedules("onActivityExpired")).length, 0);
      const count = web.commands.length;
      await h.container.alarm();
      assert.equal(web.commands.length, count);
    },
  );

  it.each(["missing", "running", "retained", "unreadable", "stale-stopped-status", "replacement"] as const)(
    "refuses failed-invocation retirement without exact stopped proof: %s", async condition => {
      const h = runnerHarness({ running: condition === "running" || condition === "stale-stopped-status",
        status: condition === "stale-stopped-status" ? "stopped" : undefined });
      await h.container.bindStandbySlot(claimInput());
      const web = webOwner(owner(condition === "missing" ? "starting" : "active"));
      if (condition !== "missing") new RunnerInvocationReceiptStore(h.sql).register({ attemptId: "attempt-starting", generation: "1" });
      if (condition === "replacement") web.current.generation = "2";
      if (condition === "unreadable") vi.spyOn(h.container, "getState").mockRejectedValue(new Error("synthetic unavailable status"));
      if (condition === "retained") Object.assign(h.container, {
        workspaceInvocationOperations: [{ ...invocation().job.request, abortController: new AbortController(),
          abortResult: null, abortEndpointReady: false, result: new Promise(() => {}), requiresFailClosedStopReason: null }],
      });
      await h.container.schedule(new Date(Date.now() + 1_000), "onActivityExpired", null);
      await alarm(h);
      assert.equal((await h.container.readStandbySlotBinding()).state, "bound");
      assert.equal(web.commands.some(c => c.operation === "target_retired"), false);
      assert.equal(h.calls.destroy, 0);
      if (condition === "missing") assert.equal((await h.container.listSchedules("onActivityExpired")).length, 0);
    },
  );

  it("refuses retirement while an invocation is queued behind readiness", async () => {
    const h = runnerHarness({ invoke: async () => Response.json({ error: "synthetic failure" }, { status: 500 }) });
    await h.container.bindStandbySlot(claimInput());
    const web = webOwner(owner("active"));
    new RunnerInvocationReceiptStore(h.sql).register({ attemptId: "attempt-starting", generation: "1" });
    const entered = deferred<void>();
    const state = deferred<Awaited<ReturnType<RunnerContainer["getState"]>>>();
    vi.spyOn(h.container, "getState").mockImplementationOnce(() => { entered.resolve(); return state.promise; });
    const readiness = h.container.ensureReadyForProcessing({ userId: MEMBER, timeoutMs: 1_000 });
    await entered.promise;
    const queued = h.container.invoke(invocation());
    const drained = Promise.allSettled([readiness, queued]);
    try {
      await alarm(h);
      assert.equal(h.calls.start, 0);
      assert.equal(h.calls.destroy, 0);
      assert.equal((await h.container.readStandbySlotBinding()).state, "bound");
      assert.equal(web.commands.some(c => c.operation === "target_retired"), false);
    } finally {
      state.resolve({ status: "stopped", lastChange: Date.now() });
      await drained;
    }
  });

  it("retries the identical routed payload through repeated request loss, then stops on success", async () => {
    const { h, web } = await failedInvocation();
    let failures = 2;
    web.beforeNotice = () => { if (failures-- > 0) throw new Error("synthetic notification unavailable"); };
    await alarm(h);
    assert.equal(web.current.phase, "active");
    await alarm(h);
    assert.equal(web.current.phase, "active");
    await alarm(h);
    assert.equal(web.current.phase, "idle");
    assert.deepEqual(web.commands.filter(c => c.operation === "target_retired"), Array.from({ length: 3 }, () =>
      ({ operation: "target_retired", runnerContainerName: GLOBAL_SLOT })));
    assert.equal((await h.container.listSchedules("onActivityExpired")).length, 0);
    const count = web.commands.length;
    await h.container.alarm();
    assert.equal(web.commands.length, count);
  });

  it("ends a stale routed retry without touching the replacement assignment", async () => {
    const { h, web } = await failedInvocation();
    web.beforeNotice = () => { web.current.runnerContainerName = `runner--v-${RELEASE}--${"3".repeat(32)}`; };
    await alarm(h);
    assert.equal(web.current.phase, "active");
    assert.equal((await h.container.listSchedules("onActivityExpired")).length, 0);
  });

  it.each([null, undefined, { userId: MEMBER, runnerContainerName: GLOBAL_SLOT }])(
    "a payload grants no authority over a still-bound slot: %j", async payload => {
      const h = runnerHarness();
      await h.container.bindStandbySlot(claimInput());
      const web = webOwner(owner("starting"));
      await h.container.schedule(new Date(Date.now() + 1_000), "onActivityExpired", payload ?? null);
      if (payload === undefined) await h.container.onActivityExpired();
      else await alarm(h);
      assert.equal((await h.container.readStandbySlotBinding()).state, "bound");
      assert.deepEqual(web.commands, []);
      assert.equal((await h.container.listSchedules("onActivityExpired")).length, 0);
    },
  );

  it.each([null, undefined, { userId: MEMBER, runnerContainerName: "another-slot" }])(
    "ignores empty legacy or wrong-target payloads on a retired slot: %j", async payload => {
      const h = runnerHarness();
      await h.container.bindStandbySlot(claimInput());
      await h.container.retireStandbySlot({ target: { slotName: GLOBAL_SLOT, userId: MEMBER } });
      const web = webOwner(owner("active"));
      // A preexisting null schedule row must keep its old meaning.
      await h.container.schedule(new Date(Date.now() + 1_000), "onActivityExpired", payload ?? null);
      if (payload === undefined) await h.container.onActivityExpired();
      else await alarm(h);
      assert.deepEqual(web.commands, []);
      assert.equal((await h.container.listSchedules("onActivityExpired")).length, 0);
    },
  );
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
    assert.equal(calls.renew, 2);
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
      RUNNER_CONTAINER: { getByName(name) { names.push(["main", name]); return main.container; } },
      STANDBY_RUNNER_CONTAINER: { getByName(name, options) { names.push(["legacy", name, options]); return legacy.container; } },
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
    const noLegacy = createHostedRunnerContainerNamespaceRouter({ RUNNER_CONTAINER: { getByName: () => main.container }, STANDBY_RUNNER_CONTAINER: null });
    assert.throws(() => noLegacy?.getByName(LEGACY_SLOT), /unavailable/u);
  });
});
