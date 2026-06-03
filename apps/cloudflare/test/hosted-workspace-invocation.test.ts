import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearHostedBrowserVaultWarmSourceStateHash: vi.fn(),
  runHostedWorkspaceRuntimeJobInProcess: vi.fn(),
}));

vi.mock("@murphai/assistant-runtime", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-runtime")>(
    "@murphai/assistant-runtime",
  );
  return {
    ...actual,
    clearHostedBrowserVaultWarmSourceStateHash:
      mocks.clearHostedBrowserVaultWarmSourceStateHash,
    runHostedWorkspaceRuntimeJobInProcess:
      mocks.runHostedWorkspaceRuntimeJobInProcess,
  };
});

import type {
  HostedAssistantRuntimeConfig,
} from "@murphai/assistant-runtime";
import {
  HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV,
} from "../src/runner-native-parser-toolchain.ts";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../src/runner-injected-credential.ts";
import {
  buildHostedExecutionJobRuntime,
  clearHostedRunnerWarmLauncherRootsForTests,
  resolveHostedRunnerWarmWorkspaceVaultRoot,
  runHostedWorkspaceInvocation,
} from "../src/hosted-workspace-invocation.ts";
import type {
  HostedExecutionWorkspaceInvocationJobInput,
} from "../src/runner-job-transport.ts";

describe("runHostedWorkspaceInvocation", () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await clearHostedRunnerWarmLauncherRootsForTests();
  });

  it("keeps the direct invocation adapter independent from ambient env and cwd", async () => {
    const source = await readFile(
      new URL("../src/hosted-workspace-invocation.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/\bprocess\.(?:cwd|env)\b/u);
    expect(source).not.toContain("node-runner");
    expect(source).not.toContain("runner-child");
  });

  it("builds runtime config from explicit supervisor env while sentinelizing provider credentials", () => {
    const runtime = buildHostedExecutionJobRuntime({
      requestedRuntime: {},
      supervisorEnv: {
        FFMPEG_COMMAND: "/app/test-parser-toolchain/ffmpeg",
        HOSTED_ASSISTANT_MODEL: "gpt-supervisor",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        [HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN_ENV]: "1",
        NODE_ENV: "production",
        OPENAI_API_KEY: "fixture-openai-key",
        TELEGRAM_API_BASE_URL: "https://telegram.example.test",
        TELEGRAM_BOT_TOKEN: "fixture-telegram-token",
        WHISPER_COMMAND: "/app/test-parser-toolchain/whisper-cli",
        WHISPER_MODEL_PATH: "/app/test-parser-toolchain/ggml-test.bin",
        WHATSAPP_ACCESS_TOKEN: "fixture-whatsapp-token",
        WHATSAPP_PHONE_NUMBER_ID: "fixture-whatsapp-phone-number-id",
      },
    });

    expect(runtime.forwardedEnv).toMatchObject({
      HOSTED_ASSISTANT_MODEL: "gpt-supervisor",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      NODE_ENV: "production",
      OPENAI_API_KEY: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
    });
    expect(JSON.stringify(runtime.forwardedEnv)).not.toContain("fixture-openai-key");
    expect(runtime.platformEnv).toMatchObject({
      TELEGRAM_API_BASE_URL: "https://telegram.example.test",
      TELEGRAM_BOT_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      WHATSAPP_ACCESS_TOKEN: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      WHATSAPP_PHONE_NUMBER_ID: HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
    });
    expect(JSON.stringify(runtime.platformEnv)).not.toContain("fixture-telegram-token");
    expect(JSON.stringify(runtime.platformEnv)).not.toContain("fixture-whatsapp-token");
    expect(JSON.stringify(runtime.platformEnv)).not.toContain("fixture-whatsapp-phone-number-id");
    expect(runtime.parserToolchain?.tools.ffmpeg?.command).toBe(
      "/app/test-parser-toolchain/ffmpeg",
    );
    expect(runtime.parserToolchain?.tools.whisper?.command).toBe(
      "/app/test-parser-toolchain/whisper-cli",
    );
  });

  it("clears browser-vault warm source state and invokes the package runtime in process", async () => {
    const runtimeResult = {
      nextWakeAt: null,
      redactedStatus: {
        importedCount: 0,
      },
      status: "idle" as const,
    };
    const capturedJobs: HostedExecutionWorkspaceInvocationJobInput[] = [];
    const capturedOptionValues: Record<string, unknown>[] = [];
    mocks.runHostedWorkspaceRuntimeJobInProcess.mockImplementation(
      async (job: HostedExecutionWorkspaceInvocationJobInput, options: Record<string, unknown>) => {
        capturedJobs.push(job);
        capturedOptionValues.push(options);
        return runtimeResult;
      },
    );
    const onRuntimeWakeReady = vi.fn();
    const abortController = new AbortController();
    const job = createWorkspaceJob({
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-job",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        NODE_ENV: "production",
      },
      userEnv: {
        OPENAI_API_KEY: "fixture-user-openai-key",
      },
    });

    await expect(runHostedWorkspaceInvocation(job, {
      onRuntimeWakeReady,
      signal: abortController.signal,
      supervisorEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-supervisor",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        NODE_ENV: "production",
      },
    })).resolves.toEqual(runtimeResult);

    const expectedVaultRoot = resolveHostedRunnerWarmWorkspaceVaultRoot(job.request.userId);
    const capturedJob = capturedJobs[0];
    const capturedOptions = capturedOptionValues[0];
    if (!capturedJob || !capturedOptions) {
      throw new Error("Expected direct invocation to call the package runtime.");
    }
    expect(mocks.clearHostedBrowserVaultWarmSourceStateHash).toHaveBeenCalledWith({
      vaultRoot: expectedVaultRoot,
    });
    expect(capturedOptions.vaultRoot).toBe(expectedVaultRoot);
    expect(capturedOptions.runtimeWakeSignal).toBeTruthy();
    expect(capturedOptions.signal).toBe(abortController.signal);
    expect(onRuntimeWakeReady).toHaveBeenCalledTimes(1);
    expect(onRuntimeWakeReady.mock.calls[0]?.[0]()).toBe(true);
    expect(capturedJob.runtime?.forwardedEnv).toMatchObject({
      HOSTED_ASSISTANT_MODEL: "gpt-job",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      NODE_ENV: "production",
    });
    expect(capturedJob.runtime?.parserToolchain?.tools.ffmpeg?.command).toBe(
      "/usr/bin/ffmpeg",
    );
  });

  it("preserves former launcher roots for direct in-process invocations", async () => {
    mocks.runHostedWorkspaceRuntimeJobInProcess.mockResolvedValue({
      nextWakeAt: null,
      redactedStatus: {
        importedCount: 0,
      },
      status: "idle" as const,
    });
    const job = createWorkspaceJob({
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-job",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        NODE_ENV: "production",
      },
      userEnv: {
        OPENAI_API_KEY: "fixture-user-openai-key",
      },
    });

    await runHostedWorkspaceInvocation(job, {
      supervisorEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-supervisor",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        NODE_ENV: "production",
      },
    });

    const vaultRoot = resolveHostedRunnerWarmWorkspaceVaultRoot(job.request.userId);
    const launcherRoot = path.dirname(path.dirname(vaultRoot));
    await Promise.all([
      "home",
      "cache",
      "tmp",
      "hf-home",
    ].map((directoryName) => access(path.join(launcherRoot, directoryName))));
  });
});

function createWorkspaceJob(
  runtime: HostedAssistantRuntimeConfig,
): HostedExecutionWorkspaceInvocationJobInput {
  return {
    kind: "workspace-invocation",
    request: {
      attemptId: "attempt_direct_invocation",
      leaseGeneration: "3",
      reason: "nudge",
      userId: "member_direct_invocation",
      workspaceVersion: "9",
    },
    runtime,
  };
}
