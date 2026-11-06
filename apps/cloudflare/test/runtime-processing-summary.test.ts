import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeEnsureProcessingResponse } from "@murphai/hosted-execution/orchestration-control";
import { parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import { ensurePostgresRuntimeProcessing } from "../src/runtime-processing.ts";
import { buildRuntimeProcessingSummaryEntry, recordRuntimeProcessingSummary, type RuntimeProcessingDiagnostics } from "../src/user-runner/diagnostics.ts";
import { handleRuntimeEnsureProcessingRoute } from "../src/worker/route-handlers/runtime-control.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import type { WorkerRouteContext } from "../src/worker-routes/shared.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

vi.mock("../src/runtime-processing.ts", () => ({ ensurePostgresRuntimeProcessing: vi.fn() }));
vi.mock("../src/user-runner/diagnostics.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/user-runner/diagnostics.ts")>(),
  recordRuntimeProcessingSummary: vi.fn(async () => undefined),
}));

function harness() {
  const unused = async (): Promise<never> => { throw new Error("Unexpected runtime operation."); };
  const containers = { getByName: () => ({ destroyInstance: unused, invoke: unused, smokeHealth: unused }) };
  const env = { ...createHostedExecutionTestEnv(), BUNDLES: new MemoryEncryptedR2Bucket(),
    USER_RUNNER: { getByName: () => { throw new Error("Legacy runtime must not be accessed."); } }, RUNNER_CONTAINER: containers, RUNNER_CONTAINER_SMOKE: containers };
  const pending: Promise<unknown>[] = [];
  const request = new Request("https://worker.example.test/internal/runtime", {
    method: "POST", body: JSON.stringify({ orchestrationAttemptId: "summary-request" }),
  });
  const context: WorkerRouteContext = { env, environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
    request, url: new URL(request.url), executionCtx: { waitUntil: work => { pending.push(work); } } };
  return { context, pending };
}

describe("Postgres processing summaries", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("keeps one detached operation summary stable while telemetry is pending", async () => {
    const { context, pending } = harness();
    let diagnostics!: RuntimeProcessingDiagnostics;
    let release!: () => void;
    vi.mocked(recordRuntimeProcessingSummary).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    vi.mocked(ensurePostgresRuntimeProcessing).mockImplementationOnce(async (_source, _input, observed) => {
      if (!observed) throw new Error("Missing request diagnostics");
      diagnostics = observed;
      diagnostics.stage = "fresh_start";
      diagnostics.details.runtimeProcessingLastObservedFailedOperation = "container_readiness";
      throw new Error("Synthetic processing failure");
    });
    try {
      const response = await handleRuntimeEnsureProcessingRoute(context, "member-a");
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: "runtime_ensure_processing_failed" });
      expect(pending).toHaveLength(1);
      expect(recordRuntimeProcessingSummary).toHaveBeenCalledOnce();
      const entry = vi.mocked(recordRuntimeProcessingSummary).mock.calls[0]![0].entry;
      expect(entry.redactedJson).toMatchObject({
        runtimeProcessingStage: "fresh_start",
        runtimeProcessingOutcome: "threw",
        runtimeProcessingLastObservedFailedOperation: "container_readiness",
      });
      const snapshot = JSON.stringify(entry);
      diagnostics.details.runtimeProcessingLastObservedFailedOperation = "prepare_invocation";
      expect(JSON.stringify(entry)).toBe(snapshot);
      expect(parseHostedRuntimeLogRequest({ entries: [entry] }).entries[0]).toEqual(entry);
    } finally { release?.(); await Promise.all(pending); }
    expect(recordRuntimeProcessingSummary).toHaveBeenCalledOnce();
  });

  it.each([
    ["runtimeProcessingLastObservedFailedOperation", "https://synthetic.invalid/private"],
    ["runtimeProcessingLastObservedFailedOperation", "synthetic@example.invalid"],
    ["runtimeProcessingLastObservedFailedOperation", "/tmp/synthetic-runtime-failure"],
    ["runtimeProcessingLastObservedFailedOperation", "member_synthetic_123"],
    ["runtimeProcessingLastObservedFailedOperation", "Bearer synthetic-credential"],
    ["rawError", "Synthetic failure"],
  ] as const)("keeps the existing redaction gate for %s = %s", (key, value) => {
    const entry = buildRuntimeProcessingSummaryEntry({
      stage: "fresh_start", details: { [key]: value },
    }, undefined, Date.now());
    expect(() => parseHostedRuntimeLogRequest({ entries: [entry] })).toThrow(TypeError);
  });

  it("does not schedule a summary callback for a successful warm wake", async () => {
    const { context, pending } = harness();
    const result: HostedRuntimeEnsureProcessingResponse = {
      kind: "runtime_processing_accepted", action: "woken", runtimeAttemptId: "runtime-a",
      recommendedRecheckAt: new Date(Date.now() + 300_000).toISOString(),
    };
    vi.mocked(ensurePostgresRuntimeProcessing).mockResolvedValueOnce(result);

    const response = await handleRuntimeEnsureProcessingRoute(context, "member-a");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(ensurePostgresRuntimeProcessing).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(0);
    expect(recordRuntimeProcessingSummary).not.toHaveBeenCalled();
  });

  it.each([1_000, 1_001, 9_000])("retains native timing for a successful %i ms wake only above the slow threshold", async elapsedMs => {
    const { context, pending } = harness();
    const now = Date.now();
    context.runtimeControlAuthTiming = {
      runtimeControlAuthStartedAtEpochMs: now - elapsedMs,
      runtimeControlAuthFinishedAtEpochMs: now - elapsedMs,
    };
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const result: HostedRuntimeEnsureProcessingResponse = {
      kind: "runtime_processing_accepted", action: "woken", runtimeAttemptId: "runtime-a",
      recommendedRecheckAt: new Date(now + 300_000).toISOString(),
    };
    vi.mocked(ensurePostgresRuntimeProcessing).mockImplementationOnce(async (_source, _input, diagnostics) => {
      if (!diagnostics) throw new Error("Missing request diagnostics");
      diagnostics.wakeDetails = { wakeEnteredAtEpochMs: now - 70, wakeHandlerAcceptedAtEpochMs: now - 50 };
      return result;
    });
    try {
      const response = await handleRuntimeEnsureProcessingRoute(context, "member-a");
      expect(await response.json()).toEqual(result);
      expect(pending).toHaveLength(elapsedMs > 1_000 ? 1 : 0);
      await Promise.all(pending);
      if (elapsedMs > 1_000) expect(recordRuntimeProcessingSummary).toHaveBeenCalledWith(expect.objectContaining({
        entry: expect.objectContaining({ redactedJson: expect.objectContaining({
          wakeEnteredAtEpochMs: now - 70, wakeHandlerAcceptedAtEpochMs: now - 50,
          runtimeProcessingAction: "woken",
        }) }),
      }));
    } finally { clock.mockRestore(); }
  });

  it.each(["started", "replaced", "already_running", "retry_later"] as const)("records %s without waiting for telemetry", async outcome => {
    const { context, pending } = harness();
    const result: HostedRuntimeEnsureProcessingResponse = outcome === "retry_later"
      ? { kind: "retry_later", retryAt: new Date(Date.now() + 3000).toISOString() }
      : { kind: "runtime_processing_accepted", action: outcome, runtimeAttemptId: "runtime-a",
        recommendedRecheckAt: new Date(Date.now() + 300_000).toISOString() };
    const stage = outcome === "started" || outcome === "replaced" ? "fresh_start" : "active_wake";
    let release!: () => void;
    vi.mocked(recordRuntimeProcessingSummary).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    vi.mocked(ensurePostgresRuntimeProcessing).mockImplementationOnce(async (_source, _input, diagnostics) => {
      if (!diagnostics) throw new Error("Missing request diagnostics");
      diagnostics.stage = stage;
      if (outcome === "retry_later") {
        diagnostics.details.runtimeProcessingRetryReason = "wake_unconfirmed";
        // Accepted headers do not prove a successful wake if the final drain fails.
        diagnostics.wakeDetails = { wakeAccepted: true };
      }
      return result;
    });
    try {
      const response = await handleRuntimeEnsureProcessingRoute(context, "member-a");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(result);
      expect(pending).toHaveLength(1);
      expect(recordRuntimeProcessingSummary).toHaveBeenCalledTimes(1);
      expect(recordRuntimeProcessingSummary).toHaveBeenCalledWith(expect.objectContaining({
        orchestrationAttemptId: "summary-request", userId: "member-a",
        entry: expect.objectContaining({ eventCode: "runner.processing_finished", redactedJson: expect.objectContaining({
          runtimeProcessingBackend: "postgres", runtimeProcessingOutcome: result.kind,
          runtimeProcessingStage: stage,
          ...(result.kind === "retry_later" ? {
            runtimeProcessingRetryReason: "wake_unconfirmed", wakeAccepted: true,
            runtimeProcessingRetryAtEpochMs: Date.parse(result.retryAt),
          } : { runtimeProcessingAction: result.action }),
        }) }),
      }));
    } finally { release?.(); await Promise.all(pending); }
  });

  it.each(["admission", "active_wake", "fresh_start"] as const)("records a thrown %s failure and owns rejected telemetry", async stage => {
    const { context, pending } = harness();
    vi.mocked(ensurePostgresRuntimeProcessing).mockImplementationOnce(async (_source, _input, diagnostics) => {
      if (!diagnostics) throw new Error("Missing request diagnostics");
      diagnostics.stage = stage;
      throw new Error("Synthetic processing failure");
    });
    vi.mocked(recordRuntimeProcessingSummary).mockRejectedValueOnce(new Error("Synthetic telemetry failure"));
    const response = await handleRuntimeEnsureProcessingRoute(context, "member-a");
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "runtime_ensure_processing_failed" });
    expect(pending).toHaveLength(1);
    await expect(Promise.all(pending)).resolves.toEqual([undefined]);
    expect(recordRuntimeProcessingSummary).toHaveBeenCalledTimes(1);
    expect(recordRuntimeProcessingSummary).toHaveBeenCalledWith(expect.objectContaining({
      entry: expect.objectContaining({ level: "warn", redactedJson: expect.objectContaining({
        runtimeProcessingOutcome: "threw", runtimeProcessingStage: stage,
      }) }),
    }));
  });
});
