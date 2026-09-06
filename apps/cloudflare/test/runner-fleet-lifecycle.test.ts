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
  type HostedRunnerSlotLifecycle, type HostedStandbySlotBinding,
} from "../src/standby-runner-contract.js";
import { RunnerStateStore, RunnerContainerReservationLostError } from "../src/user-runner/runner-state-store.js";
import type { DurableObjectStateLike } from "../src/user-runner/types.js";
import { HOSTED_RUNTIME_ARCHITECTURE_VERSION } from "../src/hosted-runtime-architecture.js";
import { RuntimeProcessingController, type RuntimeProcessingInput } from "../src/user-runner/runtime-processing-controller.js";
import type { HostedExecutionEnvironment } from "../src/env.js";
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

  it("never accepts a boolean retirement response in place of an exact terminal receipt", async () => {
    const { container } = runnerHarness();
    await container.bindStandbySlot(claimInput());
    Object.assign(container, { async retireStandbySlot() { return { retired: true }; } });
    assert.equal((await destroyHostedExecutionContainer({ runnerContainerNamespace: { getByName: () => container }, runnerContainerName: GLOBAL_SLOT, userId: MEMBER })).ok, false);
  });

  it("rejects new inventory preparation and new binding in the legacy class", async () => {
    const { container } = runnerHarness({ legacy: true });
    await assert.rejects(container.prepareStandbySlot({ releaseId: RELEASE, region: HOSTED_STANDBY_REGION, slotName: LEGACY_SLOT, timeoutMs: 1_000 }), /drain-only/u);
    await assert.rejects(container.bindStandbySlot(claimInput(LEGACY_SLOT)), /drain-only/u);
  });

  it("retires prior-release bindings even when their native container is warm", async () => {
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

describe("opaque pending targets and write-fence admission", () => {
  for (const slotName of [GLOBAL_SLOT, LEGACY_SLOT]) {
    for (const clear of ["completion", "transport", "replacement", "user-control"] as const) {
      it(`preserves ${slotName.split("--")[0]} target across ${clear} fence clearing`, async () => {
        const { state } = durableState();
        const store = new RunnerStateStore(state);
        assert.equal(await store.reserveRunnerContainerStopTarget({ runnerContainerName: slotName, userId: MEMBER }), true);
        const token = await store.beginWriteFence({ runnerContainerName: slotName, userId: MEMBER });
        const finishedAt = new Date().toISOString();
        if (clear === "completion") await store.clearWriteFenceAfterCompletion({ token, finishedAt });
        if (clear === "transport") await store.clearWriteFenceAfterTransportFailure({ token, finishedAt, error: new Error("transport") });
        if (clear === "replacement") await store.clearWriteFenceForReplacement({ attemptId: token.attemptId, generation: token.generation, userId: MEMBER, finishedAt, error: new Error("stopped") });
        if (clear === "user-control") await store.clearWriteFenceForUserControl(MEMBER);
        const recovered = await new RunnerStateStore(state).readState();
        assert.equal(recovered.writeFence, null);
        assert.equal(recovered.pendingRunnerContainerName, slotName);
        assert.equal(await store.reserveRunnerContainerStopTarget({ runnerContainerName: createHostedRunnerSlotName(RELEASE), userId: MEMBER }), false);
      });
    }
  }
  it("rejects stale admission after an exact reservation was cleared or replaced", async () => {
    const { state } = durableState();
    const store = new RunnerStateStore(state);
    await store.reserveRunnerContainerStopTarget({ runnerContainerName: GLOBAL_SLOT, userId: MEMBER });
    await store.clearStoppedRunnerContainerForUserControl({ runnerContainerName: GLOBAL_SLOT, userId: MEMBER });
    await assert.rejects(store.beginWriteFence({ runnerContainerName: GLOBAL_SLOT, userId: MEMBER }), RunnerContainerReservationLostError);
    const next = createHostedRunnerSlotName(RELEASE);
    await store.reserveRunnerContainerStopTarget({ runnerContainerName: next, userId: MEMBER });
    await assert.rejects(store.beginWriteFence({ runnerContainerName: GLOBAL_SLOT, userId: MEMBER }), RunnerContainerReservationLostError);
    assert.equal((await store.beginWriteFence({ runnerContainerName: next, userId: MEMBER })).runnerContainerName, next);
  });
});

function controllerEnvironment(): HostedExecutionEnvironment {
  return {
    allowedRunnerSecretKeys: null, hostedCryptoAuthoritySignKeyVersion: "test",
    hostedCryptoAuthoritySignPublicKeyPem: "test", hostedCryptoAuthorityVerifyKeyringJson: null,
    hostedCryptoCloudflareAutomationKeyId: "test", hostedCryptoCloudflareAutomationPrivateJwk: "{}",
    hostedCryptoCloudflareAutomationPrivateKeyringJson: null, hostedCryptoEnv: "test",
    hostedWebBaseUrl: "https://example.test", idleCheckpointDelayMs: 180_000,
    maxEventAttempts: 3, retryDelayMs: 30_000, runnerCommitTimeoutMs: 45_000,
    runnerReadyTimeoutMs: 20_000, runnerIdleTtlMs: 300_000,
    runnerLifecycleReevaluationMs: 300_000, webControlTimeoutMs: 30_000,
    hostedCrypto: {
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: "test", HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "test",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "{}", HOSTED_CRYPTO_ENV: "test",
    },
    vercelOidcValidation: {
      audience: "test", environment: "development", issuer: "https://example.test",
      jwksUrl: "https://example.test/keys", projectName: "test", subject: "test", teamSlug: "test",
    },
    webCallbackSigning: { keyId: "test", privateKeyJwkJson: "{}" },
  };
}

type BindInput = Parameters<HostedRunnerSlotLifecycle["bindStandbySlot"]>[0];
type BindResult = Awaited<ReturnType<HostedRunnerSlotLifecycle["bindStandbySlot"]>>;
function allocationHarness(options: {
  mode?: "allocate" | "off" | "shadow"; local?: boolean; pooled?: boolean; failPreparation?: boolean;
  bind?: (input: BindInput, original: () => Promise<BindResult>) => Promise<BindResult>;
  read?: (input: BindInput | null, original: () => Promise<HostedStandbySlotBinding>) => Promise<HostedStandbySlotBinding>;
} = {}) {
  const { state } = durableState();
  const store = new RunnerStateStore(state);
  const slots = new Map<string, ReturnType<typeof runnerHarness>>();
  const calls = { claim: 0, bind: 0, legacy: 0, prepare: 0, invoke: 0 };
  const names: unknown[][] = [];
  const claims: unknown[] = [];
  const coordinatorCalls: unknown[][] = [];
  const invocations: { attemptId: string; runnerContainerName: string }[] = [];
  const version = options.local ? {} : { CF_VERSION_METADATA: { id: RELEASE } };
  const namespace = createHostedRunnerContainerNamespaceRouter({
    exactUser: {
      getByName(name) {
        names.push([name]);
        let harness = slots.get(name);
        if (!harness) {
          harness = runnerHarness({ slotName: name, environment: options.local ? { CF_VERSION_METADATA: undefined } : {} });
          slots.set(name, harness);
          const originalBind = harness.container.bindStandbySlot.bind(harness.container);
          const originalRead = harness.container.readStandbySlotBinding.bind(harness.container);
          let lastBind: BindInput | null = null;
          Object.assign(harness.container, {
            async bindStandbySlot(input: BindInput) {
              calls.bind++;
              lastBind = input;
              const record = await store.readState();
              assert.equal(record.pendingRunnerContainerName, name, "bind must follow the exact durable reservation");
              assert.equal(record.writeFence, null, "no execution authority exists before binding");
              return options.bind ? options.bind(input, () => originalBind(input)) : originalBind(input);
            },
            async readStandbySlotBinding() {
              return options.read ? options.read(lastBind, originalRead) : originalRead();
            },
          });
        }
        return harness.container;
      },
    },
    standby: { getByName() { calls.legacy++; throw new Error("Fresh allocation reached legacy namespace"); } },
  });
  const controller = new RuntimeProcessingController({
    env: controllerEnvironment(), stateStore: store, runnerContainerNamespace: namespace,
    runnerRuntimeEnvSource: { ...version, HOSTED_EXECUTION_STANDBY_MODE: options.mode ?? "allocate" },
    invocationService: {
      prepareForFreshStart({ input }) {
        return async (token) => {
          calls.prepare++;
          if (options.failPreparation) throw new Error("simulated workspace preparation failure");
          assert.ok(token.runnerContainerName);
          const binding = await slots.get(token.runnerContainerName)!.container.readStandbySlotBinding();
          assert.equal(binding.state, "bound");
          assert.equal(binding.userId, input.userId);
          return {
            input, token, runnerContainerName: token.runnerContainerName,
            workspaceCheckpointedAt: null, workspaceVersion: "0",
            job: {
              kind: "workspace-invocation",
              request: {
                attemptId: token.attemptId, idleCheckpointDelayMs: 54_000,
                leaseGeneration: token.generation, userId: input.userId,
                workspace: null, workspaceVersion: token.workspaceVersion ?? "0",
              },
            },
          };
        };
      },
      async invokePreparedWithFence({ prepared }) {
        calls.invoke++;
        invocations.push({ attemptId: prepared.token.attemptId, runnerContainerName: prepared.runnerContainerName });
        return { nextWakeAt: null, status: "idle" };
      },
    },
    standbyCoordinatorNamespace: {
      getByName(...args) {
        coordinatorCalls.push(args);
        return {
          async claimReadyStandby(input) {
            calls.claim++; claims.push(input);
            return options.pooled
              ? { outcome: "claimed" as const, slotName: GLOBAL_SLOT }
              : { outcome: "no_ready_slot" as const };
          },
          async ensureReadyStandby() { return { accepted: true }; },
        };
      },
    },
  });
  return {
    controller, store, slots, calls, names, claims, coordinatorCalls, invocations,
    async resolve(input: Partial<RuntimeProcessingInput> = {}, timeoutMs = 1_000) {
      await store.bindUser(MEMBER);
      return controller["resolveFreshRunnerContainer"]({
        commandBudget: { deadlineAtMs: Date.now() + timeoutMs },
        initialRecord: await store.readState(),
        input: { orchestrationAttemptId: "background", userId: MEMBER, ...input },
      });
    },
  };
}

const trustedForeground = {
  orchestration: { triggeredByWebDirect: true },
  orchestrationAttemptId: "web-ingress-11111111-1111-4111-8111-111111111111",
};

describe("fleet allocation policy and ambiguous-outcome recovery", () => {
  for (const mode of ["off", "shadow", "allocate"] as const) {
    it(`cold-allocates background work in the main namespace in ${mode} mode`, async () => {
      const h = allocationHarness({ mode, pooled: true });
      const result = await h.resolve({ processingMode: "system_mailbox", conversationWorkPending: true });
      assert.equal(result.kind, "ready");
      if (result.kind !== "ready") throw new Error("expected fresh allocation");
      assert.ok(isHostedRunnerSlotName(result.runnerContainerName));
      assert.equal(h.calls.claim, 0);
      assert.equal(h.calls.legacy, 0);
      assert.equal(h.calls.bind, 1);
      const binding = await h.slots.get(result.runnerContainerName)!.container.readStandbySlotBinding();
      assert.equal(binding.state, "bound");
      assert.equal(binding.userId, MEMBER);
      assert.equal(binding.region, HOSTED_RUNNER_REGION);
    });
    it(`never creates a member-named shell from a ${mode} prewarm hint`, async () => {
      const h = allocationHarness({ mode });
      await h.controller.beginShellPrewarmForUser(MEMBER);
      assert.deepEqual(h.names, []);
      assert.equal(h.calls.bind, 0);
    });
  }

  it("uses opaque local release identities when metadata is absent", async () => {
    const h = allocationHarness({ local: true });
    const result = await h.resolve(trustedForeground);
    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") throw new Error("expected local allocation");
    assert.equal(readHostedRunnerSlotReleaseId(result.runnerContainerName), "local");
    assert.equal(h.calls.claim, 0);
  });

  for (const [label, input, claims] of [
    ["trusted Web-direct", trustedForeground, 1],
    ["authenticated conversation", { conversationWorkPending: true }, 1],
    ["background default", {}, 0],
    ["untrusted direct flag", { orchestration: { triggeredByWebDirect: true } }, 0],
    ["direct-shaped id alone", { orchestrationAttemptId: trustedForeground.orchestrationAttemptId }, 0],
    ["non-default foreground", { ...trustedForeground, processingMode: "inbox_media_retention" }, 0],
  ] as const) it(`claims pristine inventory only for eligible ${label} work`, async () => {
    const h = allocationHarness({ pooled: true });
    const result = await h.resolve(input);
    assert.equal(result.kind, "ready");
    assert.equal(h.calls.claim, claims);
    assert.equal(h.calls.legacy, 0);
    if (claims) {
      assert.deepEqual(h.coordinatorCalls, [["standby-coordinator--v-release_1--r-global"]]);
      assert.equal(Object.hasOwn(h.claims[0]!, "userId"), false);
    }
  });

  it("runs the public start path through reservation, binding and readiness before workspace failure", async () => {
    const h = allocationHarness({ mode: "off", failPreparation: true });
    const result = await h.controller.ensureForUser({ orchestrationAttemptId: "background", userId: MEMBER });
    assert.equal(result.kind, "retry_later");
    assert.equal(h.calls.bind, 1);
    assert.equal(h.calls.prepare, 1);
    assert.equal(h.calls.invoke, 0);
    const record = await h.store.readState();
    assert.equal(record.writeFence, null);
    assert.ok(isHostedRunnerSlotName(record.pendingRunnerContainerName));
  });

  for (const [label, options, request, expectedClaims] of [
    ["off foreground", { mode: "off" }, trustedForeground, 0],
    ["shadow foreground", { mode: "shadow" }, trustedForeground, 0],
    ["background", { mode: "allocate", pooled: true }, { processingMode: "system_mailbox" }, 0],
    ["pooled foreground", { mode: "allocate", pooled: true }, trustedForeground, 1],
  ] as const) it(`starts ${label} work and reuses its bound warm target through the same public path`, async () => {
    const h = allocationHarness(options);
    const first = await h.controller.ensureForUser({
      ...request, userId: MEMBER,
      orchestrationAttemptId: "orchestrationAttemptId" in request ? request.orchestrationAttemptId : "first",
    });
    assert.equal(first.kind, "runtime_processing_accepted");
    const token = await h.store.readWriteFenceToken();
    assert.ok(token?.runnerContainerName);
    assert.ok(isHostedRunnerSlotName(token.runnerContainerName));
    assert.equal(h.calls.claim, expectedClaims);
    assert.equal(h.calls.bind, 1);
    assert.equal(h.calls.prepare, 1);
    assert.equal(h.calls.invoke, 1);
    assert.deepEqual(h.invocations, [{ attemptId: token.attemptId, runnerContainerName: token.runnerContainerName }]);
    const target = h.slots.get(token.runnerContainerName)!;
    assert.equal(target.calls.start, 1);
    await h.store.clearWriteFenceAfterCompletion({ token, finishedAt: new Date().toISOString() });
    const second = await h.controller.ensureForUser({
      orchestrationAttemptId: "second", userId: MEMBER, processingMode: "system_mailbox",
    });
    assert.equal(second.kind, "runtime_processing_accepted");
    const retainedToken = await h.store.readWriteFenceToken();
    assert.equal(retainedToken?.runnerContainerName, token.runnerContainerName);
    assert.notEqual(retainedToken?.attemptId, token.attemptId);
    assert.equal(h.calls.claim, expectedClaims);
    assert.equal(h.calls.bind, 1);
    assert.equal(h.calls.prepare, 2);
    assert.equal(h.calls.invoke, 2);
    assert.deepEqual(h.invocations[1], { attemptId: retainedToken?.attemptId, runnerContainerName: token.runnerContainerName });
    assert.equal(h.calls.legacy, 0);
    assert.equal(h.slots.size, 1);
    assert.equal(target.calls.start, 1);
    assert.equal(target.calls.destroy, 0);
  });

  it("pins a pending retirement until the exact native destroy finishes", async () => {
    const h = allocationHarness({ mode: "off" });
    const selected = await h.resolve();
    assert.equal(selected.kind, "ready");
    if (selected.kind !== "ready") throw new Error("expected allocation");
    const pending = selected.runnerContainerName;
    const slot = h.slots.get(pending)!;
    slot.setNative(true);
    const gate = deferred<void>();
    Object.assign(slot.container, { async destroy() { await gate.promise; slot.setNative(false); } });
    const retirement = slot.container.retireStandbySlot({ target: { slotName: pending, userId: MEMBER } });
    assert.equal((await slot.container.readStandbySlotBinding()).state, "retiring");
    assert.equal((await h.resolve({}, 20)).kind, "retry");
    assert.equal((await h.store.readState()).pendingRunnerContainerName, pending);
    assert.equal(h.calls.bind, 1);
    gate.resolve();
    await retirement;
    const replacement = await h.resolve();
    assert.equal(replacement.kind, "ready");
    if (replacement.kind !== "ready") throw new Error("expected replacement");
    assert.notEqual(replacement.runnerContainerName, pending);
    assert.equal((await slot.container.readStandbySlotBinding()).state, "retired");
  });

  it("pins unavailable native-warm evidence without starting or reallocating", async () => {
    const h = allocationHarness({ mode: "off" });
    const first = await h.resolve();
    assert.equal(first.kind, "ready");
    if (first.kind !== "ready") throw new Error("expected allocation");
    const slot = h.slots.get(first.runnerContainerName)!;
    Object.assign(slot.container, { async getState() { throw new Error("native provider unavailable"); } });
    assert.equal((await h.resolve()).kind, "retry");
    assert.equal((await h.store.readState()).pendingRunnerContainerName, first.runnerContainerName);
    assert.equal(h.calls.bind, 1);
    assert.equal(slot.calls.start, 0);
    assert.equal(slot.calls.destroy, 0);
  });

  for (const [label, altered] of [
    ["foreign member", { userId: "member-b" }],
    ["foreign claim", { claimId: "standby-claim-22222222-2222-4222-8222-222222222222" }],
    ["wrong release", { releaseId: "release_2" }],
    ["wrong region", { region: HOSTED_STANDBY_REGION }],
    ["wrong slot", { slotName: `runner--v-${RELEASE}--${"3".repeat(32)}` }],
    ["retiring", { state: "retiring" }],
  ] as const) it(`pins the target after rejected bind with ${label} recovery evidence`, async () => {
    const h = allocationHarness({
      mode: "off",
      async bind() { throw new Error("lost bind result"); },
      async read(input) {
        assert.ok(input);
        return { ...input, state: "bound", ...altered };
      },
    });
    assert.equal((await h.resolve()).kind, "retry");
    const pending = (await h.store.readState()).pendingRunnerContainerName;
    assert.ok(isHostedRunnerSlotName(pending));
    assert.equal(h.slots.size, 1);
    assert.equal(h.calls.bind, 1);
    assert.equal(h.slots.get(pending!)!.calls.start, 0);
    assert.equal(h.slots.get(pending!)!.calls.destroy, 0);
  });

  it("recovers an exact bound response for the allocating request without demanding prior warmth", async () => {
    const h = allocationHarness({ mode: "off", async bind(_input, original) { await original(); throw new Error("lost response"); } });
    const result = await h.resolve();
    assert.equal(result.kind, "ready");
    assert.equal(h.calls.bind, 1);
    assert.equal(h.slots.size, 1);
  });

  it("pins unavailable binding evidence and reconciles the same target before replacement", async () => {
    let fail = true;
    const h = allocationHarness({
      mode: "off", async bind(_input, original) { if (fail) throw new Error("unavailable"); return original(); },
      async read(_input, original) { if (fail) throw new Error("unavailable"); return original(); },
    });
    assert.equal((await h.resolve()).kind, "retry");
    const pending = (await h.store.readState()).pendingRunnerContainerName;
    assert.ok(pending);
    fail = false;
    const replacement = await h.resolve();
    assert.equal(replacement.kind, "ready");
    if (replacement.kind !== "ready") throw new Error("expected replacement");
    assert.notEqual(replacement.runnerContainerName, pending);
    assert.equal((await h.slots.get(pending)!.container.readStandbySlotBinding()).state, "retired");
  });

  it("requires exact terminal identity before clearing rejected-bind recovery", async () => {
    let wrongTarget = true;
    const h = allocationHarness({
      mode: "off", async bind() { throw new Error("lost response"); },
      async read(input) {
        assert.ok(input);
        return { ...input, state: "retired", claimId: null, userId: null,
          slotName: wrongTarget ? GLOBAL_SLOT : input.slotName };
      },
    });
    assert.equal((await h.resolve()).kind, "retry");
    const pending = (await h.store.readState()).pendingRunnerContainerName;
    assert.ok(pending);
    assert.notEqual(pending, GLOBAL_SLOT);
    wrongTarget = false;
    // Retry through the actual pending owner, not another bind. The owner
    // initializes the missing identity, retires it, and only then cold-allocates.
    assert.equal((await h.resolve()).kind, "retry");
    assert.equal((await h.store.readState()).pendingRunnerContainerName, null);
  });

  it("never treats a timed-out cold bind as warm on the next request", async () => {
    const gate = deferred<void>();
    let first = true;
    const h = allocationHarness({ mode: "off", async bind(_input, original) {
      if (first) { first = false; await original(); await gate.promise; }
      return original();
    } });
    assert.equal((await h.resolve({}, 20)).kind, "retry");
    const pending = (await h.store.readState()).pendingRunnerContainerName;
    assert.ok(pending);
    gate.resolve();
    const result = await h.resolve();
    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") throw new Error("expected replacement");
    assert.notEqual(result.runnerContainerName, pending);
    assert.equal((await h.slots.get(pending)!.container.readStandbySlotBinding()).state, "retired");
    assert.equal(h.slots.get(pending)!.calls.start, 0);
  });

  it("background work retains an already-owned warm target without fresh inventory", async () => {
    const h = allocationHarness({ pooled: true });
    const first = await h.resolve(trustedForeground);
    assert.equal(first.kind, "ready");
    h.slots.get(GLOBAL_SLOT)!.setNative(true);
    const result = await h.resolve({ processingMode: "system_mailbox" });
    assert.equal(result.kind, "ready");
    if (result.kind !== "ready") throw new Error("expected retention");
    assert.equal(result.runnerContainerName, GLOBAL_SLOT);
    assert.equal(result.standbyAllocationOutcome, "retained");
    assert.equal(h.calls.claim, 1);
    assert.equal(h.calls.bind, 1);
  });
});
