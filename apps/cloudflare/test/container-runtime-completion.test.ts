import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHostedExecutionStructuredLogRecord } from "@murphai/hosted-execution";
import type { HostedRuntimeOwnerResponse, HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";
import { RunnerContainer } from "../src/runner-container.ts";
import { RunnerSlotBindingStore } from "../src/runner-slot-binding.ts";
import { RunnerInvocationReceiptStore, type RunnerInvocationIdentity } from "../src/runner-invocation-receipt.ts";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import { handleRunnerRuntimeCompletionRequest } from "../src/runner-outbound/runtime-completion.ts";
import type { RunnerOutboundEnvironmentSource } from "../src/runner-outbound/shared.ts";
import type { HostedRuntimeCompletionReceiptReason } from "../src/runtime-completion-receipt.ts";
import type { WorkerRunnerContainerStubLike } from "../src/worker-contracts.ts";
import { createTestSqlStorage } from "./sql-storage.ts";

vi.mock("../src/runtime-owner-client.ts", () => ({ commandHostedRuntimeOwner: vi.fn() }));

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog:
      mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  HOSTED_CONTAINER_RUNTIME_COMPLETION_TIMEOUT_MS,
  recordHostedContainerRuntimeCompletionBestEffort,
} from "../src/container-runtime-completion.ts";
import {
  CLOUDFLARE_HOSTED_RUNTIME_COMPLETION_ENDPOINT,
} from "../src/internal-hosts.ts";
import {
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
} from "../src/runner-outbound/headers.ts";

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("recordHostedContainerRuntimeCompletionBestEffort", () => {
  it("posts the terminal result with only the exact container authority", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => Response.json({ completed: true }),
    );
    const input = createCompletionInput();

    await expect(recordHostedContainerRuntimeCompletionBestEffort({
      ...input,
      fetchImpl,
    })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0];
    if (!call) {
      throw new Error("Expected the completion request.");
    }
    const request = new Request(call[0], call[1]);
    expect(request.url).toBe(CLOUDFLARE_HOSTED_RUNTIME_COMPLETION_ENDPOINT);
    expect(request.method).toBe("POST");
    expect(Object.fromEntries(request.headers.entries())).toEqual({
      "content-type": "application/json; charset=utf-8",
      [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: input.job.request.userId,
      [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: input.job.request.attemptId,
      [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]:
        input.job.request.leaseGeneration,
    });
    await expect(request.json()).resolves.toEqual({ result: input.result });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledOnce();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeCompletionReceiptOutcome: "recorded",
        }),
        level: "info",
      }),
    );
  });

  it("keeps an old boolean-only false receipt at warn", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => Response.json({ completed: false }),
    );

    await expect(recordHostedContainerRuntimeCompletionBestEffort({
      ...createCompletionInput(),
      fetchImpl,
    })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledOnce();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeCompletionReceiptOutcome: "not_recorded",
        }),
        level: "warn",
      }),
    );
  });

  it.each([
    { payload: { completed: false, reason: "already_completed" }, level: "info", reason: "already_completed" },
    { payload: { completed: false, reason: "superseded" }, level: "info", reason: "superseded" },
    { payload: { completed: false, reason: "owner_unconfirmed" }, level: "warn", reason: "owner_unconfirmed" },
    { payload: { completed: false, reason: "native_receipt_mismatch" }, level: "warn", reason: "native_receipt_mismatch" },
    { payload: { completed: false, reason: "canonical_completion_rejected" }, level: "warn", reason: "canonical_completion_rejected" },
    { payload: { completed: false, reason: "synthetic-unknown-reason" }, level: "warn", reason: undefined },
    { payload: { completed: false, reason: { text: "synthetic-provider-text" } }, level: "warn", reason: undefined },
    { payload: { completed: true, reason: "already_completed" }, level: "info", reason: undefined },
    { payload: { completed: true, reason: "superseded" }, level: "info", reason: undefined },
    { payload: { completed: true, reason: "canonical_completion_rejected" }, level: "info", reason: undefined },
    { payload: { completed: true, reason: "synthetic-unknown-reason" }, level: "info", reason: undefined },
  ] as const)("keeps the boolean authoritative across response skew: $payload", async ({ payload, level, reason }) => {
    const input = createCompletionInput();
    const before = structuredClone(input);
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(payload));
    await expect(recordHostedContainerRuntimeCompletionBestEffort({ ...input, fetchImpl })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(input).toEqual(before);
    expectCompletionLog(level, payload.completed, reason);
  });

  it.each([
    {
      fetchImpl: vi.fn<typeof fetch>(
        async () => new Response(null, { status: 404 }),
      ),
      name: "an unavailable route",
    },
    {
      fetchImpl: vi.fn<typeof fetch>(
        async () => new Response(null, { status: 503 }),
      ),
      name: "a non-success response",
    },
    {
      fetchImpl: vi.fn<typeof fetch>(async () => {
        throw new Error("completion transport unavailable");
      }),
      name: "a transport failure",
    },
    {
      fetchImpl: vi.fn<typeof fetch>(async () => Response.json({ completed: false, reason: "already_completed" }, { status: 503 })),
      name: "an obsolete reason on a failed HTTP response",
    },
    {
      fetchImpl: vi.fn<typeof fetch>(async () => new Response("{")),
      name: "malformed JSON",
    },
    ...[null, [], {}, { completed: "false", reason: "already_completed" }].map(payload => ({
      fetchImpl: vi.fn<typeof fetch>(async () => Response.json(payload)),
      name: `an invalid receipt ${JSON.stringify(payload)}`,
    })),
  ])("preserves the completed result after $name", async ({ fetchImpl }) => {
    const input = createCompletionInput();
    const before = structuredClone(input);
    await expect(recordHostedContainerRuntimeCompletionBestEffort({ ...input, fetchImpl })).resolves.toBeUndefined();

    expect(input).toEqual(before);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledOnce();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeCompletionReceiptOutcome: "not_recorded",
        }),
        level: "warn",
      }),
    );
  });

  it("hard-bounds a completion request that ignores its abort signal", async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(
      async () => await new Promise<Response>(resolve => { finish = resolve; }),
    );
    const completion = recordHostedContainerRuntimeCompletionBestEffort({
      ...createCompletionInput(),
      fetchImpl,
    });

    await vi.advanceTimersByTimeAsync(HOSTED_CONTAINER_RUNTIME_COMPLETION_TIMEOUT_MS - 1);
    expect(mocks.emitHostedExecutionStructuredLog).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(completion).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledOnce();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runtimeCompletionReceiptOutcome: "not_recorded",
        }),
        level: "warn",
      }),
    );
    finish(Response.json({ completed: false, reason: "already_completed" }));
    await vi.runAllTimersAsync();
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledOnce();
  });
});

const COMPLETED_AT = "2026-01-01T00:00:00.000Z";

describe("completion client, router, and native receipt composition", () => {
  it("records an early callback and its duplicate without claiming outer settlement", async () => {
    const f = createRoutedCompletion();
    const before = structuredClone(f.input);
    for (const immediateRecheckRequested of [true, false]) {
      await expect(recordHostedContainerRuntimeCompletionBestEffort({
        ...f.input, fetchImpl: f.fetchImpl,
        result: { ...f.input.result, ...(immediateRecheckRequested ? { immediateRecheckRequested: true as const } : {}) },
      })).resolves.toBeUndefined();
      // The canonical owner can be retiring while the outer invocation lives.
      f.owner.phase = "retiring";
      f.owner.completedAt = COMPLETED_AT;
    }
    expect(f.responses).toEqual([{ completed: true }, { completed: true }]);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    expect(f.getByName).toHaveBeenCalledTimes(2);
    expect(f.nativeCompletion).toHaveBeenCalledTimes(2);
    expect(f.nativeCompletion).toHaveBeenNthCalledWith(1, {
      userId: f.input.job.request.userId, ...f.identity,
      result: { ...f.input.result, immediateRecheckRequested: true },
    });
    expect(f.nativeCompletion).toHaveBeenNthCalledWith(2, {
      userId: f.input.job.request.userId, ...f.identity, result: f.input.result,
    });
    expect(f.recorded).toHaveBeenCalledTimes(2);
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([call]) => call.command)).toEqual([
      { operation: "reconcile" },
      { operation: "complete", ...f.identity, settledRunnerContainerName: null, immediateRecheckRequested: true },
      { operation: "reconcile" },
      { operation: "complete", ...f.identity, settledRunnerContainerName: null, immediateRecheckRequested: false },
    ]);
    expect(f.receipts.read()).toEqual({ ...f.identity, state: "completed", immediateRecheckRequested: true });
    expect(f.input).toEqual(before);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledTimes(4);
    const receiptLogs = mocks.emitHostedExecutionStructuredLog.mock.calls.filter(
      ([entry]) => entry.details?.runtimeCompletionReceiptOutcome !== undefined,
    );
    expect(receiptLogs).toHaveLength(2);
    for (const [log] of receiptLogs) {
      expect(log).toMatchObject({ level: "info", details: { runtimeCompletionReceiptOutcome: "recorded" } });
    }
  });

  const guardedCases: Array<{
    name: string;
    owner?: Partial<HostedRuntimeOwnerSnapshot> | null;
    cutover?: HostedRuntimeOwnerResponse["cutover"];
    generation?: string;
    reason: HostedRuntimeCompletionReceiptReason;
  }> = [
    { name: "completed and released warm owner", owner: { attemptId: null, phase: "idle", completedAt: COMPLETED_AT }, reason: "already_completed" },
    { name: "completed and released owner without target", owner: { attemptId: null, phase: "idle", completedAt: COMPLETED_AT, runnerContainerName: null, allocationId: null }, reason: "already_completed" },
    { name: "newer successor, not delivery proof", owner: { attemptId: "attempt_successor", generation: "10" }, reason: "superseded" },
    { name: "successor beyond Number precision", generation: "9007199254740992", owner: { attemptId: "attempt_successor", generation: "9007199254740993" }, reason: "superseded" },
    { name: "idle but incomplete generation", owner: { attemptId: null, phase: "idle" }, reason: "owner_unconfirmed" },
    { name: "empty completion marker", owner: { attemptId: null, phase: "idle", completedAt: "" }, reason: "owner_unconfirmed" },
    { name: "same-generation attempt mismatch", owner: { attemptId: "attempt_other" }, reason: "owner_unconfirmed" },
    { name: "completed but not released mismatch", owner: { attemptId: "attempt_other", phase: "retiring", completedAt: COMPLETED_AT }, reason: "owner_unconfirmed" },
    { name: "idle completion without released attempt", owner: { attemptId: "attempt_other", phase: "idle", completedAt: COMPLETED_AT }, reason: "owner_unconfirmed" },
    { name: "callback newer than owner", generation: "8", reason: "owner_unconfirmed" },
    { name: "malformed generation", generation: "not-a-generation", reason: "owner_unconfirmed" },
    { name: "negative generation", generation: "-1", reason: "owner_unconfirmed" },
    { name: "oversized generation", generation: "9".repeat(20), reason: "owner_unconfirmed" },
    { name: "missing owner", owner: null, reason: "owner_unconfirmed" },
    { name: "legacy cutover with newer owner", cutover: "legacy", owner: { generation: "10" }, reason: "owner_unconfirmed" },
    { name: "draining cutover with completed owner", cutover: "draining", owner: { attemptId: null, phase: "idle", completedAt: COMPLETED_AT }, reason: "owner_unconfirmed" },
    { name: "missing target", owner: { runnerContainerName: null }, reason: "owner_unconfirmed" },
  ];
  it.each(guardedCases)("classifies $name without crossing a fence", async ({ owner, cutover = "postgres", generation, reason }) => {
    const f = createRoutedCompletion();
    f.state.cutover = cutover;
    f.state.owner = owner === null ? null : { ...f.owner, ...owner };
    if (generation) f.input.job.request.leaseGeneration = generation;
    if (reason === "already_completed" || reason === "superseded") f.receipts.complete(f.identity, false);
    if (reason === "superseded" && f.state.owner?.attemptId) {
      f.receipts.register({ attemptId: f.state.owner.attemptId, generation: f.state.owner.generation });
    }
    const before = structuredClone({ input: f.input, state: f.state, receipt: f.receipts.read() });
    await expect(recordHostedContainerRuntimeCompletionBestEffort({ ...f.input, fetchImpl: f.fetchImpl })).resolves.toBeUndefined();
    expectCompletionLog(reason === "already_completed" || reason === "superseded" ? "info" : "warn", false, reason);
    expect(f.responses).toEqual([{ completed: false, reason }]);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    expect(commandHostedRuntimeOwner).toHaveBeenCalledExactlyOnceWith({ source: f.env, userId: f.input.job.request.userId, command: { operation: "reconcile" } });
    expect(f.getByName).not.toHaveBeenCalled();
    expect(f.nativeCompletion).not.toHaveBeenCalled();
    expect(f.recorded).not.toHaveBeenCalled();
    expect({ input: f.input, state: f.state, receipt: f.receipts.read() }).toEqual(before);
  });

  it.each([
    { name: "missing native receipt", identity: null, status: "updated", reason: "native_receipt_mismatch" },
    { name: "native attempt mismatch", identity: { attemptId: "attempt_other", generation: "7" }, status: "updated", reason: "native_receipt_mismatch" },
    { name: "native generation mismatch", identity: { attemptId: "attempt_runtime_completion", generation: "6" }, status: "updated", reason: "native_receipt_mismatch" },
    { name: "canonical CAS rejection", identity: undefined, status: "stale", reason: "canonical_completion_rejected" },
  ] as const)("keeps $name visible at its actual owner", async ({ identity, status, reason }) => {
    const f = createRoutedCompletion(identity);
    f.canonicalStatus = status;
    const before = f.receipts.read();
    await expect(recordHostedContainerRuntimeCompletionBestEffort({ ...f.input, fetchImpl: f.fetchImpl })).resolves.toBeUndefined();
    expect(f.responses).toEqual([{ completed: false, reason }]);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    expect(f.getByName).toHaveBeenCalledExactlyOnceWith(f.owner.runnerContainerName);
    expect(f.nativeCompletion).toHaveBeenCalledExactlyOnceWith({ userId: f.input.job.request.userId, ...f.identity, result: f.input.result });
    expect(f.recorded).not.toHaveBeenCalled();
    const canonicalRejected = reason === "canonical_completion_rejected";
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([call]) => call.command)).toEqual([
      { operation: "reconcile" },
      ...(canonicalRejected ? [{ operation: "complete", ...f.identity, settledRunnerContainerName: null, immediateRecheckRequested: false }] : []),
    ]);
    expect(f.receipts.read()).toEqual(canonicalRejected ? { ...f.identity, state: "completed", immediateRecheckRequested: false } : before);
    expectCompletionLog("warn", false, reason, canonicalRejected);
  });

  it.each(["binding", "RPC"])("warns when the native %s is unavailable", async (missing) => {
    const f = createRoutedCompletion();
    if (missing === "binding") f.env.RUNNER_CONTAINER = undefined;
    else f.getByName.mockReturnValue({});
    const before = f.receipts.read();
    await expect(recordHostedContainerRuntimeCompletionBestEffort({ ...f.input, fetchImpl: f.fetchImpl })).resolves.toBeUndefined();
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    expect(commandHostedRuntimeOwner).toHaveBeenCalledOnce();
    expect(f.nativeCompletion).not.toHaveBeenCalled();
    expect(f.recorded).not.toHaveBeenCalled();
    expect(f.receipts.read()).toEqual(before);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      level: "warn", details: expect.objectContaining({ runtimeCompletionReceiptOutcome: "not_recorded" }),
    }));
  });
});

function expectCompletionLog(level: "info" | "warn", completed: boolean, reason?: HostedRuntimeCompletionReceiptReason, canonicalCalled = false) {
  expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledTimes(canonicalCalled ? 2 : 1);
  const [entry] = mocks.emitHostedExecutionStructuredLog.mock.calls.at(-1)!;
  const log = buildHostedExecutionStructuredLogRecord(entry);
  expect(log.level).toBe(level);
  expect(log.userId).toBeNull();
  expect(log.userIdPresent).toBe(true);
  expect(log.details).toEqual({
    runtimeCompletionReceiptOutcome: completed ? "recorded" : "not_recorded",
    ...(reason ? { runtimeCompletionReceiptReason: reason } : {}),
    workspaceAttemptId: "attempt_runtime_completion",
  });
  if (!completed && level === "info") expect(log.message).toContain("callback is obsolete");
  if (completed) expect(log.message).toContain("recorded runtime completion");
}

function createRoutedCompletion(nativeIdentity?: RunnerInvocationIdentity | null) {
  const input = createCompletionInput();
  const userId = input.job.request.userId;
  const identity = { attemptId: input.job.request.attemptId, generation: input.job.request.leaseGeneration };
  const target = `runner--v-release_1--${"1".repeat(32)}`;
  const owner: HostedRuntimeOwnerSnapshot = {
    userId, ...identity, phase: "active", processingMode: "default", workspaceVersion: "12",
    allocationId: "standby-claim-11111111-1111-4111-8111-111111111111", runnerContainerName: target,
    customInferenceEnvelope: null, platformAiUsageAllowed: true,
    startedAt: null, acceptedAt: null, completedAt: null, failureCount: 0, lastErrorCode: null,
  };
  const state: HostedRuntimeOwnerResponse = { cutover: "postgres", status: "observed", owner };
  const sql = createTestSqlStorage();
  const binding = new RunnerSlotBindingStore(sql);
  const slot = { slotName: target, releaseId: "release_1", region: "GLOBAL" as const };
  binding.initialize(slot);
  binding.bind({ ...slot, userId, claimId: owner.allocationId! });
  const receipts = new RunnerInvocationReceiptStore(sql);
  if (nativeIdentity !== null) receipts.register(nativeIdentity ?? identity);
  const container = new RunnerContainer({ id: { name: target }, storage: { sql }, waitUntil: vi.fn() }, { CF_VERSION_METADATA: { id: "release_1" } });
  const nativeCompletion = vi.spyOn(container, "recordSupervisedRuntimeCompletion");
  const recorded = vi.spyOn(container, "onRuntimeCompletionRecorded").mockResolvedValue(undefined);
  const getByName = vi.fn<(name: string) => WorkerRunnerContainerStubLike>(() => container);
  const env: RunnerOutboundEnvironmentSource = {
    BUNDLES: { get: vi.fn(async () => null), put: vi.fn(async () => undefined) },
    RUNNER_CONTAINER: { getByName },
  };
  const responses: unknown[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    const request = new Request(url, init);
    expect(request.url).toBe(CLOUDFLARE_HOSTED_RUNTIME_COMPLETION_ENDPOINT);
    expect(request.method).toBe("POST");
    expect(request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)).toBe(input.job.request.attemptId);
    expect(request.headers.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)).toBe(input.job.request.leaseGeneration);
    const response = await handleRunnerRuntimeCompletionRequest({ env, request, userId });
    responses.push(await response.clone().json());
    return response;
  });
  const fixture = { input, identity, owner, state, env, receipts, nativeCompletion, recorded, getByName, fetchImpl, responses,
    canonicalStatus: "updated" as "updated" | "stale" };
  vi.mocked(commandHostedRuntimeOwner).mockImplementation(async ({ command }) => {
    if (command.operation === "reconcile") return state;
    if (command.operation === "complete") return { cutover: "postgres", status: fixture.canonicalStatus, owner: null };
    throw new Error("Unexpected synthetic completion command.");
  });
  return fixture;
}

function createCompletionInput() {
  return {
    job: {
      kind: "workspace-invocation" as const,
      request: {
        attemptId: "attempt_runtime_completion",
        leaseGeneration: "7",
        userId: "member_runtime_completion",
        workspaceVersion: "12",
      },
    },
    result: {
      nextWakeAt: null,
      redactedStatus: {
        importedCount: 1,
      },
      status: "idle" as const,
    },
  };
}
