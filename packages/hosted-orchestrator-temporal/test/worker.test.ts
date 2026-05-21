import { beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    connect.mockClear();
    create.mockClear();
    run.mockClear();
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
    const workerOptions = create.mock.calls[0]?.[0] as {
      workflowsPath?: unknown;
    };
    expect(String(workerOptions.workflowsPath)).toMatch(
      /workflows\/hosted-user-runtime\.(?:js|ts)$/u,
    );
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

  it("runs the created worker", async () => {
    const {
      runHostedUserRuntimeWorker,
    } = await import("../src/worker.js");

    await runHostedUserRuntimeWorker({
      address: "temporal.example.test:7233",
      namespace: "hosted-local",
    });

    expect(run).toHaveBeenCalledTimes(1);
  });
});
