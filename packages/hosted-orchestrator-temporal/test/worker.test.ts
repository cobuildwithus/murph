import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connection = { kind: "connection" };
const connect = vi.fn(async (options: unknown) => connection);
const run = vi.fn(async () => undefined);
const createdWorker = { kind: "worker", run };
const create = vi.fn(async (options: unknown) => createdWorker);

vi.mock("@temporalio/worker", () => ({
  NativeConnection: {
    connect,
  },
  Worker: {
    create,
  },
}));

describe("hosted runtime Temporal worker", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalShutdownGraceMs =
    process.env.HOSTED_TEMPORAL_WORKER_SHUTDOWN_GRACE_MS;
  const originalShutdownForceMs =
    process.env.HOSTED_TEMPORAL_WORKER_SHUTDOWN_FORCE_MS;
  const performanceEnvKeys = [
    "HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTIONS",
    "HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_POLLS",
    "HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_EXECUTIONS",
    "HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_POLLS",
    "TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_POLLS",
    "TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_POLLS",
  ] as const;
  const originalPerformanceEnv = new Map(
    performanceEnvKeys.map((key) => [key, process.env[key]]),
  );

  beforeEach(() => {
    connect.mockClear();
    create.mockClear();
    run.mockClear();
    process.env.NODE_ENV = "test";
    delete process.env.HOSTED_TEMPORAL_WORKER_SHUTDOWN_GRACE_MS;
    delete process.env.HOSTED_TEMPORAL_WORKER_SHUTDOWN_FORCE_MS;
    for (const key of performanceEnvKeys) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv(
      "HOSTED_TEMPORAL_WORKER_SHUTDOWN_GRACE_MS",
      originalShutdownGraceMs,
    );
    restoreEnv(
      "HOSTED_TEMPORAL_WORKER_SHUTDOWN_FORCE_MS",
      originalShutdownForceMs,
    );
    for (const key of performanceEnvKeys) {
      restoreEnv(key, originalPerformanceEnv.get(key));
    }
  });

  it("creates a worker with explicit local Temporal options", async () => {
    const {
      createHostedUserRuntimeWorker,
    } = await import("../src/worker.js");

    const worker = await createHostedUserRuntimeWorker({
      address: "temporal.example.test:7233",
      apiKey: "temporal_test_api_key",
      namespace: "hosted-local",
      taskQueue: "hosted-runtime-local",
      tls: true,
    });

    expect(worker).toBe(createdWorker);
    expect(connect).toHaveBeenCalledWith({
      address: "temporal.example.test:7233",
      apiKey: "temporal_test_api_key",
      tls: true,
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      connection,
      namespace: "hosted-local",
      taskQueue: "hosted-runtime-local",
    }));
    const workerOptions = readCreatedWorkerOptions();
    expect(String(workerOptions.workflowsPath)).toMatch(
      /workflows\/index\.(?:js|ts)$/u,
    );
    expect(workerOptions.workflowBundle).toBeUndefined();
    expect(workerOptions.shutdownGraceTime).toBeUndefined();
    expect(workerOptions.shutdownForceTime).toBeUndefined();
    expect(workerOptions.activityTaskPollerBehavior).toEqual({
      type: "autoscaling",
    });
    expect(workerOptions.workflowTaskPollerBehavior).toEqual({
      type: "autoscaling",
    });
    expect(workerOptions.maxConcurrentActivityTaskExecutions).toBeUndefined();
    expect(workerOptions.maxConcurrentActivityTaskPolls).toBeUndefined();
    expect(workerOptions.maxConcurrentWorkflowTaskExecutions).toBeUndefined();
    expect(workerOptions.maxConcurrentWorkflowTaskPolls).toBeUndefined();
    expect(workerOptions.maxCachedWorkflows).toBeUndefined();
    expect(workerOptions.reuseV8Context).toBeUndefined();
  });

  it("uses the prebuilt workflow bundle and shutdown policy when NODE_ENV is production", async () => {
    const {
      createHostedUserRuntimeWorker,
    } = await import("../src/worker.js");
    const bundleDir = await mkdtemp(join(tmpdir(), "murph-temporal-worker-"));
    const bundlePath = join(bundleDir, "workflow-bundle.js");

    try {
      await writeFile(bundlePath, "module.exports = {};");
      process.env.NODE_ENV = "production";

      await createHostedUserRuntimeWorker({
        connection: { kind: "injected" } as never,
        workflowBundlePath: bundlePath,
      });

      const workerOptions = readCreatedWorkerOptions();
      expect(workerOptions.workflowBundle).toEqual({
        codePath: bundlePath,
      });
      expect(workerOptions.workflowsPath).toBeUndefined();
      expect(workerOptions.shutdownGraceTime).toBe(270_000);
      expect(workerOptions.shutdownForceTime).toBe(295_000);
      expect(workerOptions.activityTaskPollerBehavior).toEqual({
        type: "autoscaling",
      });
      expect(workerOptions.workflowTaskPollerBehavior).toEqual({
        type: "autoscaling",
      });
      expect(workerOptions.maxConcurrentActivityTaskExecutions).toBe(100);
      expect(workerOptions.maxConcurrentActivityTaskPolls).toBeUndefined();
      expect(workerOptions.maxConcurrentWorkflowTaskExecutions).toBe(20);
      expect(workerOptions.maxConcurrentWorkflowTaskPolls).toBeUndefined();
      expect(workerOptions.maxCachedWorkflows).toBe(100);
      expect(workerOptions.reuseV8Context).toBe(true);
    } finally {
      await rm(bundleDir, { force: true, recursive: true });
    }
  });

  it("uses shutdown env overrides when configured", async () => {
    process.env.HOSTED_TEMPORAL_WORKER_SHUTDOWN_GRACE_MS = "120000";
    process.env.HOSTED_TEMPORAL_WORKER_SHUTDOWN_FORCE_MS = "150000";
    const {
      createHostedUserRuntimeWorker,
      readHostedUserRuntimeWorkerShutdownOptions,
    } = await import("../src/worker.js");

    await createHostedUserRuntimeWorker({
      connection: { kind: "injected" } as never,
      namespace: "hosted-local",
    });

    const workerOptions = readCreatedWorkerOptions();
    expect(workerOptions.shutdownGraceTime).toBe(120_000);
    expect(workerOptions.shutdownForceTime).toBe(150_000);
    expect(readHostedUserRuntimeWorkerShutdownOptions({
      HOSTED_TEMPORAL_WORKER_SHUTDOWN_FORCE_MS: "45000",
      HOSTED_TEMPORAL_WORKER_SHUTDOWN_GRACE_MS: "30000",
    })).toEqual({
      shutdownForceTimeMs: 45_000,
      shutdownGraceTimeMs: 30_000,
    });
    expect(() => readHostedUserRuntimeWorkerShutdownOptions({
      HOSTED_TEMPORAL_WORKER_SHUTDOWN_FORCE_MS: "10000",
      HOSTED_TEMPORAL_WORKER_SHUTDOWN_GRACE_MS: "30000",
    })).toThrow(/greater than or equal/u);
  });

  it("uses worker execution env overrides when configured", async () => {
    process.env.HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTIONS = "3";
    process.env.HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_EXECUTIONS = "12";
    const {
      createHostedUserRuntimeWorker,
      readHostedUserRuntimeWorkerPerformanceOptions,
    } = await import("../src/worker.js");

    await createHostedUserRuntimeWorker({
      connection: { kind: "injected" } as never,
      namespace: "hosted-local",
    });

    const workerOptions = readCreatedWorkerOptions();
    expect(workerOptions.activityTaskPollerBehavior).toEqual({
      type: "autoscaling",
    });
    expect(workerOptions.workflowTaskPollerBehavior).toEqual({
      type: "autoscaling",
    });
    expect(workerOptions.maxConcurrentActivityTaskExecutions).toBe(3);
    expect(workerOptions.maxConcurrentActivityTaskPolls).toBeUndefined();
    expect(workerOptions.maxCachedWorkflows).toBe(100);
    expect(workerOptions.maxConcurrentWorkflowTaskExecutions).toBe(12);
    expect(workerOptions.maxConcurrentWorkflowTaskPolls).toBeUndefined();
    expect(workerOptions.reuseV8Context).toBe(true);
    expect(readHostedUserRuntimeWorkerPerformanceOptions({
      HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_EXECUTIONS: "1",
      HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_EXECUTIONS: "2",
    })).toEqual({
      activityTaskPollerBehavior: {
        type: "autoscaling",
      },
      maxConcurrentActivityTaskExecutions: 1,
      maxCachedWorkflows: 100,
      maxConcurrentWorkflowTaskExecutions: 2,
      reuseV8Context: true,
      workflowTaskPollerBehavior: {
        type: "autoscaling",
      },
    });
    expect(() => readHostedUserRuntimeWorkerPerformanceOptions({
      HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_EXECUTIONS: "101",
    })).toThrow(/fixed 100-Workflow cache limit/u);
  });

  it("ignores retired fixed poller env aliases", async () => {
    process.env.HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_POLLS = "1";
    process.env.HOSTED_TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_POLLS = "2";
    process.env.TEMPORAL_WORKER_MAX_CONCURRENT_ACTIVITY_TASK_POLLS = "3";
    process.env.TEMPORAL_WORKER_MAX_CONCURRENT_WORKFLOW_TASK_POLLS = "4";
    const {
      createHostedUserRuntimeWorker,
      readHostedUserRuntimeWorkerPerformanceOptions,
    } = await import("../src/worker.js");

    expect(readHostedUserRuntimeWorkerPerformanceOptions(process.env)).toEqual({
      activityTaskPollerBehavior: {
        type: "autoscaling",
      },
      maxConcurrentActivityTaskExecutions: 100,
      maxCachedWorkflows: 100,
      maxConcurrentWorkflowTaskExecutions: 20,
      reuseV8Context: true,
      workflowTaskPollerBehavior: {
        type: "autoscaling",
      },
    });

    await createHostedUserRuntimeWorker({
      connection: { kind: "injected" } as never,
      namespace: "hosted-local",
    });

    const workerOptions = readCreatedWorkerOptions();
    expect(workerOptions.activityTaskPollerBehavior).toEqual({
      type: "autoscaling",
    });
    expect(workerOptions.workflowTaskPollerBehavior).toEqual({
      type: "autoscaling",
    });
    expect(workerOptions.maxConcurrentActivityTaskExecutions).toBeUndefined();
    expect(workerOptions.maxConcurrentActivityTaskPolls).toBeUndefined();
    expect(workerOptions.maxConcurrentWorkflowTaskExecutions).toBeUndefined();
    expect(workerOptions.maxConcurrentWorkflowTaskPolls).toBeUndefined();
    expect(workerOptions.maxCachedWorkflows).toBeUndefined();
    expect(workerOptions.reuseV8Context).toBeUndefined();
  });

  it("runs two Render worker instances", async () => {
    const renderBlueprint = await readFile(
      new URL("../../../render.yaml", import.meta.url),
      "utf8",
    );
    const workerService = renderBlueprint
      .split(/\n(?=\s{2}- type:)/u)
      .find((service) => service.includes("name: murph-temporal-worker"));

    expect(workerService).toBeDefined();
    expect(workerService).toMatch(/\n {4}numInstances: 2\n/u);
  });

  it("fails production startup when the workflow bundle is missing", async () => {
    const {
      createHostedUserRuntimeWorker,
    } = await import("../src/worker.js");

    await expect(createHostedUserRuntimeWorker({
      connection: { kind: "injected" } as never,
      production: true,
      workflowBundlePath: join(tmpdir(), "missing-murph-workflow-bundle.js"),
    })).rejects.toThrow(/workflow bundle is missing/u);
    expect(create).not.toHaveBeenCalled();
  });

  it("uses an injected connection and the default task queue", async () => {
    const {
      createHostedUserRuntimeWorker,
    } = await import("../src/worker.js");
    const injectedConnection = { kind: "injected" };

    await createHostedUserRuntimeWorker({
      connection: injectedConnection as never,
      namespace: "hosted-local",
    });

    expect(connect).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      connection: injectedConnection,
      namespace: "hosted-local",
      taskQueue: "murph-hosted-runtime",
    }));
  });

  it("runs the primary worker", async () => {
    const {
      runHostedUserRuntimeWorker,
    } = await import("../src/worker.js");

    await runHostedUserRuntimeWorker({
      address: "temporal.example.test:7233",
      namespace: "hosted-local",
      taskQueue: "hosted-runtime-local",
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0]?.[0] as CreatedWorkerOptions).taskQueue).toBe(
      "hosted-runtime-local",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});

interface CreatedWorkerOptions {
  activities?: unknown;
  activityTaskPollerBehavior?: unknown;
  maxCachedWorkflows?: unknown;
  maxConcurrentActivityTaskExecutions?: unknown;
  maxConcurrentActivityTaskPolls?: unknown;
  maxConcurrentWorkflowTaskExecutions?: unknown;
  maxConcurrentWorkflowTaskPolls?: unknown;
  reuseV8Context?: unknown;
  shutdownForceTime?: unknown;
  shutdownGraceTime?: unknown;
  taskQueue?: unknown;
  workflowTaskPollerBehavior?: unknown;
  workflowBundle?: unknown;
  workflowsPath?: unknown;
}

function readCreatedWorkerOptions(): CreatedWorkerOptions {
  const call = create.mock.calls[0];
  if (call === undefined) {
    throw new Error("Worker.create was not called.");
  }
  return call[0] as CreatedWorkerOptions;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
