import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it.each(["runtime_processing_accepted", "retry_later"] as const)("records %s without waiting for telemetry", async kind => {
    const { context, pending } = harness();
    let release!: () => void;
    vi.mocked(recordRuntimeProcessingSummary).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    vi.mocked(ensurePostgresRuntimeProcessing).mockImplementationOnce(async (_source, _input, diagnostics) => {
      if (!diagnostics) throw new Error("Missing request diagnostics");
      diagnostics.stage = "active_wake";
      diagnostics.details.runtimeProcessingRetryReason = "wake_unconfirmed";
      return kind === "retry_later" ? { kind, retryAt: new Date(Date.now() + 3000).toISOString() }
        : { kind, action: "woken", runtimeAttemptId: "runtime-a", recommendedRecheckAt: new Date(Date.now() + 300_000).toISOString() };
    });
    try {
      const response = await handleRuntimeEnsureProcessingRoute(context, "member-a");
      expect(await response.json()).toMatchObject({ kind });
      expect(pending).toHaveLength(1);
      expect(recordRuntimeProcessingSummary).toHaveBeenCalledWith(expect.objectContaining({
        orchestrationAttemptId: "summary-request", userId: "member-a",
        entry: expect.objectContaining({ eventCode: "runner.processing_finished", redactedJson: expect.objectContaining({
          runtimeProcessingBackend: "postgres", runtimeProcessingOutcome: kind,
          runtimeProcessingStage: "active_wake", runtimeProcessingRetryReason: "wake_unconfirmed",
        }) }),
      }));
    } finally { release(); await Promise.all(pending); }
  });

  it("records a thrown admission failure and owns rejected telemetry", async () => {
    const { context, pending } = harness();
    vi.mocked(ensurePostgresRuntimeProcessing).mockRejectedValueOnce(new Error("Synthetic admission failure"));
    vi.mocked(recordRuntimeProcessingSummary).mockRejectedValueOnce(new Error("Synthetic telemetry failure"));
    const response = await handleRuntimeEnsureProcessingRoute(context, "member-a");
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "runtime_ensure_processing_failed" });
    await expect(Promise.all(pending)).resolves.toEqual([undefined]);
    expect(recordRuntimeProcessingSummary).toHaveBeenCalledWith(expect.objectContaining({
      entry: expect.objectContaining({ redactedJson: expect.objectContaining({ runtimeProcessingOutcome: "threw" }) }),
    }));
  });


});
