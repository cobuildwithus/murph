import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime";

import {
  buildHostedExecutionJobRuntime,
  createHostedExecutionJobRunner,
} from "../src/node-runner.ts";
import type { HostedExecutionWorkspaceRunJobInput } from "../src/runner-job-transport.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

describe("createHostedExecutionJobRunner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("routes workspace-run jobs through the workspace runtime without run authority", async () => {
    const request = createWorkspaceRequest("member_workspace_node");
    const result = createWorkspaceResult();
    const readEnvironment = vi.fn(() => {
      throw new Error("Expected worker-proxy workspace jobs to avoid direct hosted env reads.");
    });
    const buildRuntime = vi.fn((runtime: HostedAssistantRuntimeConfig) => ({
      ...runtime,
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
    }));
    const runWorkspaceInProcess = vi.fn(async () => result);
    const runHostedExecutionJob = createHostedExecutionJobRunner({
      buildRuntime,
      readEnvironment,
      runMode: "in-process",
      runWorkspaceInProcess,
    });

    await expect(runHostedExecutionJob({
      kind: "workspace-run",
      request,
      runtime: {
        forwardedEnv: {
          HOSTED_ASSISTANT_MODEL: "gpt-test",
        },
      },
    }, {
      internalWorkerProxyToken: "proxy-token",
      localInternalProxyBaseUrl: "http://127.0.0.1:8787",
    })).resolves.toEqual(result);

    expect(readEnvironment).not.toHaveBeenCalled();
    expect(buildRuntime).toHaveBeenCalledWith({
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
    });
    expect(runWorkspaceInProcess).toHaveBeenCalledWith(
      {
        request,
        runtime: expect.objectContaining({
          forwardedEnv: {
            HOSTED_ASSISTANT_MODEL: "gpt-test",
          },
        }),
      },
      expect.objectContaining({
        createCheckpointSnapshot: expect.any(Function),
        importItem: expect.any(Function),
        platform: expect.objectContaining({
          artifactStore: expect.any(Object),
          effectsPort: expect.any(Object),
        }),
      }),
    );
  });

  it("forwards workspace jobs and abort options into isolated runner mode", async () => {
    const request = createWorkspaceRequest("member_isolated_node");
    const result = createWorkspaceResult();
    const controller = new AbortController();
    const runIsolated = vi.fn(async () => result);
    const runHostedExecutionJob = createHostedExecutionJobRunner({
      buildRuntime: (runtime) => runtime,
      readEnvironment: vi.fn(() => {
        throw new Error("Expected worker-proxy isolated jobs to avoid direct hosted env reads.");
      }),
      runIsolated,
      runMode: "isolated",
    });

    await expect(runHostedExecutionJob({
      kind: "workspace-run",
      request,
      runtime: {
        forwardedEnv: {
          OPENAI_API_KEY: "job-openai-key",
        },
      },
    }, {
      internalWorkerProxyToken: "proxy-token",
      signal: controller.signal,
    })).resolves.toEqual(result);

    expect(runIsolated).toHaveBeenCalledWith(
      expect.objectContaining({
        internalWorkerProxyToken: "proxy-token",
        job: {
          kind: "workspace-run",
          request,
          runtime: {
            forwardedEnv: {
              OPENAI_API_KEY: "job-openai-key",
            },
          },
        },
        localInternalProxyBaseUrl: null,
      }),
      {
        internalWorkerProxyToken: "proxy-token",
        signal: controller.signal,
      },
    );
  });
});

describe("buildHostedExecutionJobRuntime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses caller-provided runtime env instead of ambient process env", () => {
    for (const [key, value] of Object.entries(createHostedExecutionTestEnv())) {
      if (typeof value === "string") {
        vi.stubEnv(key, value);
      }
    }
    vi.stubEnv("HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS", "CUSTOM_API_KEY");

    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: "CUSTOM_API_KEY",
        HOSTED_ASSISTANT_MODEL: "gpt-test",
        OPENAI_API_KEY: "job-openai-key",
      },
      userEnv: {
        CUSTOM_API_KEY: "secret-value",
      },
    });

    expect(runtime.forwardedEnv).toMatchObject({
      HOSTED_ASSISTANT_MODEL: "gpt-test",
      OPENAI_API_KEY: "job-openai-key",
    });
    expect(runtime.userEnv).toEqual({
      CUSTOM_API_KEY: "secret-value",
    });
  });
});

function createWorkspaceRequest(
  userId: string,
): HostedExecutionWorkspaceRunJobInput["request"] {
  return {
    attemptId: `attempt_${userId}`,
    budget: {
      maxMailboxItems: 10,
    },
    leaseGeneration: "3",
    reason: "nudge",
    userId,
    workspaceVersion: "2",
  };
}

function createWorkspaceResult(): HostedAssistantWorkspaceRuntimeJobResult {
  return {
    nextWakeAt: null,
    redactedStatus: {
      importedCount: 0,
    },
    status: "idle",
  };
}
