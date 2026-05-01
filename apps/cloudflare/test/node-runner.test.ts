import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedAssistantRuntimeConfig,
  HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime";

import {
  buildHostedExecutionJobRuntime,
  createHostedWorkspaceInvocationRunner,
} from "../src/node-runner.ts";
import {
  createHostedRunnerNativeParserToolchain,
} from "../src/runner-native-parser-toolchain.ts";
import type { HostedExecutionWorkspaceInvocationJobInput } from "../src/runner-job-transport.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

describe("createHostedWorkspaceInvocationRunner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("routes workspace-invocation jobs through the workspace runtime without run authority", async () => {
    const request = createWorkspaceRequest("member_workspace_node");
    const result = createWorkspaceResult();
    const buildRuntime = vi.fn((runtime: HostedAssistantRuntimeConfig) => ({
      ...runtime,
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
    }));
    const runWorkspaceInProcess = vi.fn(async () => result);
    const runHostedWorkspaceInvocation = createHostedWorkspaceInvocationRunner({
      buildRuntime,
      runMode: "in-process",
      runWorkspaceInProcess,
    });

    await expect(runHostedWorkspaceInvocation({
      kind: "workspace-invocation",
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
    const runHostedWorkspaceInvocation = createHostedWorkspaceInvocationRunner({
      buildRuntime: (runtime) => runtime,
      runIsolated,
      runMode: "isolated",
    });

    await expect(runHostedWorkspaceInvocation({
      kind: "workspace-invocation",
      request,
      runtime: {
        forwardedEnv: {
          VERCEL_AI_API_KEY: "job-vercel-key",
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
          kind: "workspace-invocation",
          request,
          runtime: {
            forwardedEnv: {
              VERCEL_AI_API_KEY: "job-vercel-key",
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
        VERCEL_AI_API_KEY: "job-vercel-key",
      },
      userEnv: {
        CUSTOM_API_KEY: "secret-value",
      },
    });

    expect(runtime.forwardedEnv).toMatchObject({
      HOSTED_ASSISTANT_MODEL: "gpt-test",
      VERCEL_AI_API_KEY: "job-vercel-key",
    });
    expect(runtime.userEnv).toEqual({
      CUSTOM_API_KEY: "secret-value",
    });
  });

  it("uses runner image parser defaults instead of stale forwarded parser paths", () => {
    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        FFMPEG_COMMAND: "/stale/ffmpeg",
        HOSTED_ASSISTANT_MODEL: "gpt-test",
        WHISPER_COMMAND: "/stale/whisper-cli",
        WHISPER_MODEL_PATH: "/stale/model.bin",
      },
    });

    expect(runtime.parserToolchain).toEqual(createHostedRunnerNativeParserToolchain());
  });
});

function createWorkspaceRequest(
  userId: string,
): HostedExecutionWorkspaceInvocationJobInput["request"] {
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
