import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearHostedBrowserVaultWarmSourceStateHash: vi.fn(),
  runPackageHostedWorkspaceInvocation: vi.fn(),
}));

vi.mock("@murphai/assistant-runtime", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-runtime")>(
    "@murphai/assistant-runtime",
  );
  return {
    ...actual,
    clearHostedBrowserVaultWarmSourceStateHash:
      mocks.clearHostedBrowserVaultWarmSourceStateHash,
  };
});

vi.mock("@murphai/assistant-runtime/hosted-invocation", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-runtime/hosted-invocation")>(
    "@murphai/assistant-runtime/hosted-invocation",
  );
  return {
    ...actual,
    runHostedWorkspaceInvocation:
      mocks.runPackageHostedWorkspaceInvocation,
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
    const capturedInvocationInputs: Record<string, unknown>[] = [];
    mocks.runPackageHostedWorkspaceInvocation.mockImplementation(
      async (input: Record<string, unknown>) => {
        capturedInvocationInputs.push(input);
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
    const capturedInput = capturedInvocationInputs[0];
    if (!capturedInput) {
      throw new Error("Expected direct invocation to call the package invocation.");
    }
    expect(mocks.clearHostedBrowserVaultWarmSourceStateHash).toHaveBeenCalledWith({
      vaultRoot: expectedVaultRoot,
    });
    expect(capturedInput.vaultRoot).toBe(expectedVaultRoot);
    expect(capturedInput.mailboxPayloadDecoder).toBeTruthy();
    expect(capturedInput.platform).toBeTruthy();
    expect(typeof capturedInput.readCurrentLease).toBe("function");
    expect(capturedInput.snapshotArchiveBuilder).toBeTruthy();
    expect(capturedInput.runtimeWakeSignal).toBeTruthy();
    expect(capturedInput.signal).toBe(abortController.signal);
    expect(onRuntimeWakeReady).toHaveBeenCalledTimes(1);
    expect(onRuntimeWakeReady.mock.calls[0]?.[0]()).toBe(true);
    const capturedJob = capturedInput.job;
    if (!isWorkspaceInvocationJob(capturedJob)) {
      throw new Error("Expected package invocation input to include the job.");
    }
    expect(capturedJob.runtime?.forwardedEnv).toMatchObject({
      HOSTED_ASSISTANT_MODEL: "gpt-job",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      NODE_ENV: "production",
    });
    expect(capturedJob.runtime?.parserToolchain?.tools.ffmpeg?.command).toBe(
      "/usr/bin/ffmpeg",
    );
  });

  it("preserves former launcher compatibility roots for direct in-process invocations", async () => {
    const capturedInvocationInputs: Record<string, unknown>[] = [];
    mocks.runPackageHostedWorkspaceInvocation.mockImplementation(async (input: Record<string, unknown>) => {
      capturedInvocationInputs.push(input);
      return {
        nextWakeAt: null,
        redactedStatus: {
          importedCount: 0,
        },
        status: "idle" as const,
      };
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
    await assertRealPrivateDirectory(path.dirname(launcherRoot));
    expect(capturedInvocationInputs[0]?.vaultRoot).toBe(path.join(launcherRoot, "durable", "vault"));
    await assertRealPrivateDirectory(launcherRoot);
    await Promise.all([
      "home",
      "cache",
      "tmp",
      "hf-home",
    ].map(async (directoryName) => {
      const directoryPath = path.join(launcherRoot, directoryName);
      await assertRealPrivateDirectory(directoryPath);
    }));
  });

  it("repairs symlinked warm launcher paths before direct invocations", async () => {
    mocks.runPackageHostedWorkspaceInvocation.mockResolvedValue({
      nextWakeAt: null,
      redactedStatus: {
        importedCount: 0,
      },
      status: "idle" as const,
    });
    const symlinkTargets: string[] = [];

    try {
      for (const symlinkedPathName of [
        "__launcher_root__",
        "home",
        "cache",
        "tmp",
        "hf-home",
      ] as const) {
        const job = createWorkspaceJob({
          forwardedEnv: {
            HOSTED_ASSISTANT_MODEL: "gpt-job",
            HOSTED_ASSISTANT_PROVIDER: "openai",
            NODE_ENV: "production",
          },
          userEnv: {
            OPENAI_API_KEY: "fixture-user-openai-key",
          },
        }, {
          attemptId: `attempt_direct_invocation_${symlinkedPathName}`,
          userId: `member_direct_invocation_${symlinkedPathName}`,
        });
        const vaultRoot = resolveHostedRunnerWarmWorkspaceVaultRoot(job.request.userId);
        const launcherRoot = path.dirname(path.dirname(vaultRoot));
        const symlinkTarget = await mkdtemp(path.join(tmpdir(), "hosted-runner-symlink-target-"));
        symlinkTargets.push(symlinkTarget);

        await mkdir(path.dirname(launcherRoot), { mode: 0o700, recursive: true });
        await rm(launcherRoot, { force: true, recursive: true });
        const symlinkedPath = symlinkedPathName === "__launcher_root__"
          ? launcherRoot
          : path.join(launcherRoot, symlinkedPathName);
        if (symlinkedPathName !== "__launcher_root__") {
          await mkdir(launcherRoot, { mode: 0o700 });
        }
        await symlink(symlinkTarget, symlinkedPath, "dir");

        await runHostedWorkspaceInvocation(job, {
          supervisorEnv: {
            HOSTED_ASSISTANT_MODEL: "gpt-supervisor",
            HOSTED_ASSISTANT_PROVIDER: "openai",
            NODE_ENV: "production",
          },
        });

        await assertRealPrivateDirectory(symlinkedPath);
        expect(await realpath(symlinkedPath)).not.toBe(await realpath(symlinkTarget));
      }
    } finally {
      await Promise.all(symlinkTargets.map((target) => rm(target, { force: true, recursive: true })));
    }
  });

  it("repairs non-directory warm launcher residue before direct invocations", async () => {
    mocks.runPackageHostedWorkspaceInvocation.mockResolvedValue({
      nextWakeAt: null,
      redactedStatus: {
        importedCount: 0,
      },
      status: "idle" as const,
    });

    for (const residuePathName of [
      "__launcher_root__",
      "home",
      "cache",
      "tmp",
      "hf-home",
    ] as const) {
      const job = createWorkspaceJob({
        forwardedEnv: {
          HOSTED_ASSISTANT_MODEL: "gpt-job",
          HOSTED_ASSISTANT_PROVIDER: "openai",
          NODE_ENV: "production",
        },
        userEnv: {
          OPENAI_API_KEY: "fixture-user-openai-key",
        },
      }, {
        attemptId: `attempt_direct_invocation_file_residue_${residuePathName}`,
        userId: `member_direct_invocation_file_residue_${residuePathName}`,
      });
      const vaultRoot = resolveHostedRunnerWarmWorkspaceVaultRoot(job.request.userId);
      const launcherRoot = path.dirname(path.dirname(vaultRoot));
      const residuePath = residuePathName === "__launcher_root__"
        ? launcherRoot
        : path.join(launcherRoot, residuePathName);

      await mkdir(path.dirname(launcherRoot), { mode: 0o700, recursive: true });
      await rm(launcherRoot, { force: true, recursive: true });
      if (residuePathName !== "__launcher_root__") {
        await mkdir(launcherRoot, { mode: 0o700 });
      }
      await writeFile(residuePath, "not a directory");

      await runHostedWorkspaceInvocation(job, {
        supervisorEnv: {
          HOSTED_ASSISTANT_MODEL: "gpt-supervisor",
          HOSTED_ASSISTANT_PROVIDER: "openai",
          NODE_ENV: "production",
        },
      });

      await assertRealPrivateDirectory(residuePath);
    }
  });
});

function createWorkspaceJob(
  runtime: HostedAssistantRuntimeConfig,
  request: Partial<HostedExecutionWorkspaceInvocationJobInput["request"]> = {},
): HostedExecutionWorkspaceInvocationJobInput {
  return {
    kind: "workspace-invocation",
    request: {
      attemptId: request.attemptId ?? "attempt_direct_invocation",
      leaseGeneration: request.leaseGeneration ?? "3",
      reason: request.reason ?? "nudge",
      userId: request.userId ?? "member_direct_invocation",
      workspaceVersion: request.workspaceVersion ?? "9",
    },
    runtime,
  };
}

function isWorkspaceInvocationJob(value: unknown): value is HostedExecutionWorkspaceInvocationJobInput {
  return value !== null
    && typeof value === "object"
    && Reflect.get(value, "kind") === "workspace-invocation";
}

async function assertRealPrivateDirectory(directoryPath: string): Promise<void> {
  const entry = await lstat(directoryPath);
  expect(entry.isDirectory()).toBe(true);
  expect(entry.isSymbolicLink()).toBe(false);
  expect(entry.mode & 0o777).toBe(0o700);
}
