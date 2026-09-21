import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeEnsureProcessingResponse } from "@murphai/hosted-execution/orchestration-control";
import { ensurePostgresRuntimeProcessing } from "../src/runtime-processing.ts";
import { recordRuntimeProcessingSummary } from "../src/user-runner/diagnostics.ts";
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
