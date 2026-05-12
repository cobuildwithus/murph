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

  it("normalizes runtime and forwards workspace jobs into the isolated runner", async () => {
    const request = createWorkspaceRequest("member_isolated_node");
    const result = createWorkspaceResult();
    const controller = new AbortController();
    const buildRuntime = vi.fn((runtime: HostedAssistantRuntimeConfig) => ({
      ...runtime,
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
    }));
    const runIsolated = vi.fn(async () => result);
    const runHostedWorkspaceInvocation = createHostedWorkspaceInvocationRunner({
      buildRuntime,
      runIsolated,
    });

    await expect(runHostedWorkspaceInvocation({
      kind: "workspace-invocation",
      request,
      runtime: {
        forwardedEnv: {
          OPENAI_API_KEY: "job-openai-key",
        },
      },
    }, {
      signal: controller.signal,
    })).resolves.toEqual(result);

    expect(buildRuntime).toHaveBeenCalledWith({
      forwardedEnv: {
        OPENAI_API_KEY: "job-openai-key",
      },
    });
    expect(runIsolated).toHaveBeenCalledWith(
      expect.objectContaining({
        job: {
          kind: "workspace-invocation",
          request,
          runtime: {
            forwardedEnv: {
              HOSTED_ASSISTANT_MODEL: "gpt-test",
            },
          },
        },
      }),
      {
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

  it("rebases stale requested parser toolchain onto runner image defaults", () => {
    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
      parserToolchain: {
        tools: {
          whisper: {
            command: "/stale/whisper-cli",
            modelPath: "/stale/model.bin",
          },
        },
      },
    });

    expect(runtime.parserToolchain).toEqual(createHostedRunnerNativeParserToolchain());
  });

  it("preserves the worker-serialized local e2e parser toolchain", () => {
    const parserToolchain = {
      tools: {
        ffmpeg: {
          command: "/app/test-parser-toolchain/ffmpeg",
        },
        pdfinfo: {
          command: "/usr/bin/pdfinfo",
        },
        pdftotext: {
          command: "/usr/bin/pdftotext",
        },
        whisper: {
          command: "/app/test-parser-toolchain/whisper-cli",
          modelPath: "/app/test-parser-toolchain/ggml-test.bin",
        },
      },
    };

    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
      parserToolchain,
    });

    expect(runtime.parserToolchain).toEqual(parserToolchain);
  });

  it("rebases malformed local e2e parser toolchain paths onto runner image defaults", () => {
    const runtime = buildHostedExecutionJobRuntime({
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-test",
      },
      parserToolchain: {
        tools: {
          ffmpeg: {
            command: "/app/test-parser-toolchain/../other-bin/ffmpeg",
          },
          pdfinfo: {
            command: "/stale/pdfinfo",
          },
          pdftotext: {
            command: "/usr/bin/pdftotext",
          },
          whisper: {
            command: "/app/test-parser-toolchain/whisper-cli",
            modelPath: "/app/test-parser-toolchain/ggml-test.bin",
          },
        },
      },
    });

    expect(runtime.parserToolchain).toEqual(createHostedRunnerNativeParserToolchain());
  });

  it("rejects parserToolchain:null instead of falling back to ambient discovery", () => {
    expect(() =>
      buildHostedExecutionJobRuntime(JSON.parse(
        '{"forwardedEnv":{},"parserToolchain":null}',
      ))
    ).toThrow(
      "Hosted runner parserToolchain:null is not supported; omit parserToolchain to use the runner image toolchain.",
    );
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
