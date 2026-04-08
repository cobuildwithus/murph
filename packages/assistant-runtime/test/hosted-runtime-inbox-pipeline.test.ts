import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createInboxPipeline: vi.fn(),
  openInboxRuntime: vi.fn(),
  rebuildRuntimeFromVault: vi.fn(),
}));

vi.mock("@murphai/inboxd/runtime", () => ({
  createInboxPipeline: mocks.createInboxPipeline,
  openInboxRuntime: mocks.openInboxRuntime,
  rebuildRuntimeFromVault: mocks.rebuildRuntimeFromVault,
}));

import { withHostedInboxPipeline } from "../src/hosted-runtime/events/inbox-pipeline.ts";

afterEach(() => {
  vi.clearAllMocks();
});

describe("withHostedInboxPipeline", () => {
  it("rebuilds the runtime, invokes the callback, and closes the pipeline", async () => {
    const runtimeClose = vi.fn();
    const pipelineClose = vi.fn();
    const pipeline = {
      close: pipelineClose,
      processCapture: vi.fn(),
    };

    mocks.openInboxRuntime.mockResolvedValue({
      close: runtimeClose,
    });
    mocks.createInboxPipeline.mockResolvedValue(pipeline);

    const result = await withHostedInboxPipeline(
      "/tmp/assistant-runtime-inbox-pipeline",
      async (receivedPipeline) => {
        assert.equal(receivedPipeline, pipeline);
        return "ok";
      },
    );

    assert.equal(result, "ok");
    expect(mocks.rebuildRuntimeFromVault).toHaveBeenCalledWith({
      runtime: {
        close: runtimeClose,
      },
      vaultRoot: "/tmp/assistant-runtime-inbox-pipeline",
    });
    expect(mocks.createInboxPipeline).toHaveBeenCalledWith({
      runtime: {
        close: runtimeClose,
      },
      vaultRoot: "/tmp/assistant-runtime-inbox-pipeline",
    });
    expect(pipelineClose).toHaveBeenCalledTimes(1);
    expect(runtimeClose).not.toHaveBeenCalled();
  });

  it("closes the runtime when pipeline creation fails before a pipeline exists", async () => {
    const runtimeClose = vi.fn();

    mocks.openInboxRuntime.mockResolvedValue({
      close: runtimeClose,
    });
    mocks.createInboxPipeline.mockRejectedValue(new Error("pipeline failed"));

    await expect(
      withHostedInboxPipeline(
        "/tmp/assistant-runtime-inbox-pipeline",
        async () => "unreachable",
      ),
    ).rejects.toThrow("pipeline failed");

    expect(runtimeClose).toHaveBeenCalledTimes(1);
  });
});
