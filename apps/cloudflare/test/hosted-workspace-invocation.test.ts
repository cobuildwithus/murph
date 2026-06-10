import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearHostedBrowserVaultWarmSourceStateHash: vi.fn(),
  runPackageHostedWorkspaceInvocation: vi.fn(),
}));

vi.mock("@murphai/assistant-runtime", async () => {
  return {
    clearHostedBrowserVaultWarmSourceStateHash:
      mocks.clearHostedBrowserVaultWarmSourceStateHash,
    createCoalescingRuntimeWakeSignal: () => {
      let pending = false;
      return {
        consumePending: () => {
          if (!pending) {
            return false;
          }
          pending = false;
          return true;
        },
        notify: () => {
          pending = true;
        },
        wait: async () => {},
      };
    },
  };
});

vi.mock("@murphai/assistant-runtime/hosted-invocation", async () => {
  return {
    createHostedWorkspaceInvocationLease: (input: HostedExecutionWorkspaceInvocationJobInput) => ({
      attemptId: input.request.attemptId,
      leaseGeneration: input.request.leaseGeneration,
      userId: input.request.userId,
      workspaceVersion: input.request.workspaceVersion,
    }),
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
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "../src/runner-outbound/headers.ts";
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
    vi.unstubAllGlobals();
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
    expect(runtime.parserToolchain?.tools.transcription?.endpoint).toBe(
      "http://murph-transcribe.worker/v1/transcribe",
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
    const wakeResultsDuringInvocation: boolean[] = [];
    const onRuntimeWakeReady = vi.fn();
    mocks.runPackageHostedWorkspaceInvocation.mockImplementation(
      async (input: Record<string, unknown>) => {
        capturedInvocationInputs.push(input);
        const sendWake = onRuntimeWakeReady.mock.calls[0]?.[0];
        if (sendWake) {
          wakeResultsDuringInvocation.push(sendWake());
        }
        return runtimeResult;
      },
    );
    const abortController = new AbortController();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url === "http://web-control.worker/api/internal/hosted-workspace/checkpoint") {
        return new Response(JSON.stringify({
          checkpointed: true,
          workspace: {
            checkpointedAt: "2026-04-26T00:00:04.000Z",
            createdAt: "2026-04-26T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: {},
            snapshotRef: null,
            updatedAt: "2026-04-26T00:00:04.000Z",
            userId: "member_direct_invocation",
            version: "10",
          },
        }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        });
      }
      if (request.url === "https://telegram.example.test/bot-test") {
        return new Response("ok", { status: 200 });
      }
      throw new Error(`Unexpected direct invocation platform request: ${request.url}`);
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
    vi.stubGlobal("fetch", fetchMock);

    await expect(runHostedWorkspaceInvocation(job, {
      onRuntimeWakeReady,
      runnerJobAcceptedAt: "2026-04-26T00:00:01.000Z",
      signal: abortController.signal,
      supervisorEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-supervisor",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        NODE_ENV: "production",
        TELEGRAM_API_BASE_URL: "https://telegram.example.test",
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
    expect(capturedInput.latencyMilestones).toEqual({
      runnerJobAcceptedAt: "2026-04-26T00:00:01.000Z",
    });
    expect(capturedInput.platform).toBeTruthy();
    expect(typeof capturedInput.readCurrentLease).toBe("function");
    expect(capturedInput.snapshotArchiveBuilder).toBeTruthy();
    expect(capturedInput.runtimeWakeSignal).toBeTruthy();
    expect(capturedInput.signal).toBe(abortController.signal);
    expect(onRuntimeWakeReady).toHaveBeenCalledTimes(1);
    expect(wakeResultsDuringInvocation).toEqual([true]);
    expect(onRuntimeWakeReady.mock.calls[0]?.[0]()).toBe(false);
    const capturedJob = capturedInput.job;
    if (!isWorkspaceInvocationJob(capturedJob)) {
      throw new Error("Expected package invocation input to include the job.");
    }
    expect(capturedJob.request).not.toHaveProperty("source");
    expect(capturedJob.runtime?.forwardedEnv).toMatchObject({
      HOSTED_ASSISTANT_MODEL: "gpt-job",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      NODE_ENV: "production",
    });
    expect(capturedJob.runtime?.parserToolchain?.tools.ffmpeg?.command).toBe(
      "/usr/bin/ffmpeg",
    );
    const readCurrentLease = requireCallable(
      capturedInput.readCurrentLease,
      "captured readCurrentLease",
    );
    expect(readCurrentLease()).toMatchObject({
      attemptId: job.request.attemptId,
      leaseGeneration: job.request.leaseGeneration,
      userId: job.request.userId,
      workspaceVersion: job.request.workspaceVersion,
    });

    const platform = requireObjectRecord(capturedInput.platform, "captured platform");
    const workspacePort = requireObjectRecord(
      platform.workspacePort,
      "captured workspacePort",
    );
    const checkpoint = requireCallable(
      workspacePort.checkpoint,
      "captured workspacePort.checkpoint",
    );
    await expect(checkpoint({
      attemptId: job.request.attemptId,
      expectedWorkspaceVersion: job.request.workspaceVersion,
      leaseGeneration: job.request.leaseGeneration,
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "import",
      redactedStatus: {},
      snapshotRef: null,
    })).resolves.toMatchObject({
      workspace: {
        version: "10",
      },
    });
    expect(readCurrentLease()).toMatchObject({
      attemptId: job.request.attemptId,
      leaseGeneration: job.request.leaseGeneration,
      userId: job.request.userId,
      workspaceVersion: "10",
    });

    const providerFetch = requireCallable(platform.providerFetch, "captured providerFetch");
    const providerResponse = await providerFetch("https://telegram.example.test/bot-test");
    expect(providerResponse).toBeInstanceOf(Response);
    if (providerResponse instanceof Response) {
      expect(providerResponse.status).toBe(200);
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const checkpointRequest = requireFetchRequest(
      fetchMock.mock.calls[0],
      "direct invocation workspace checkpoint",
    );
    expect(checkpointRequest.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)).toBe(
      job.request.attemptId,
    );
    expect(checkpointRequest.headers.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)).toBe(
      job.request.leaseGeneration,
    );
    expect(checkpointRequest.headers.get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER)).toBe(
      job.request.workspaceVersion,
    );
    expect(checkpointRequest.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(
      job.request.userId,
    );

    const providerRequest = requireFetchRequest(
      fetchMock.mock.calls[1],
      "direct invocation provider fetch",
    );
    expect(providerRequest.headers.has(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)).toBe(false);
    expect(providerRequest.headers.has(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)).toBe(false);
    expect(providerRequest.headers.has(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER)).toBe(false);
    expect(providerRequest.headers.get(HOSTED_RUNNER_BOUND_USER_ID_HEADER)).toBe(
      job.request.userId,
    );
  });

  it("does not mutate warm state when the direct invocation signal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort(new Error("direct invocation cancelled"));
    const job = createWorkspaceJob({
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-job",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        NODE_ENV: "production",
      },
    });

    await expect(runHostedWorkspaceInvocation(job, {
      signal: abortController.signal,
      supervisorEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-supervisor",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        NODE_ENV: "production",
      },
    })).rejects.toThrow("direct invocation cancelled");

    expect(mocks.clearHostedBrowserVaultWarmSourceStateHash).not.toHaveBeenCalled();
    expect(mocks.runPackageHostedWorkspaceInvocation).not.toHaveBeenCalled();
  });

  it("threads dispatch stamps into latencyMilestones.phaseBreakdown alongside or without boot", async () => {
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
    const supervisorEnv = {
      HOSTED_ASSISTANT_MODEL: "gpt-supervisor",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      NODE_ENV: "production",
    };
    const createJob = (attemptId: string) => createWorkspaceJob({
      forwardedEnv: {
        HOSTED_ASSISTANT_MODEL: "gpt-job",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        NODE_ENV: "production",
      },
    }, { attemptId });

    // Dispatch + cold node startup: both land in the same schemaVersion 1 breakdown.
    await runHostedWorkspaceInvocation(createJob("attempt_dispatch_with_boot"), {
      dispatch: {
        containerStartRequestedAtEpochMs: 1_777_000_000_050,
        invokeReceivedAtEpochMs: 1_777_000_000_000,
      },
      nodeStartupMs: 4200,
      runnerJobAcceptedAt: "2026-04-26T00:00:01.000Z",
      supervisorEnv,
    });
    expect(capturedInvocationInputs[0]?.latencyMilestones).toEqual({
      phaseBreakdown: {
        schemaVersion: 1,
        dispatch: {
          containerStartRequestedAtEpochMs: 1_777_000_000_050,
          invokeReceivedAtEpochMs: 1_777_000_000_000,
        },
        boot: { nodeStartupMs: 4200 },
      },
      runnerJobAcceptedAt: "2026-04-26T00:00:01.000Z",
    });

    // Dispatch without nodeStartupMs (warm container): the breakdown is still
    // attached, carrying dispatch only, with no boot sub-object.
    await runHostedWorkspaceInvocation(createJob("attempt_dispatch_without_boot"), {
      dispatch: {
        invokeReceivedAtEpochMs: 1_777_000_000_000,
      },
      nodeStartupMs: null,
      supervisorEnv,
    });
    expect(capturedInvocationInputs[1]?.latencyMilestones).toEqual({
      phaseBreakdown: {
        schemaVersion: 1,
        dispatch: { invokeReceivedAtEpochMs: 1_777_000_000_000 },
      },
    });

    // Neither dispatch nor nodeStartupMs (and an empty dispatch object counts as
    // absent): no phaseBreakdown — the empty milestones object is omitted entirely.
    await runHostedWorkspaceInvocation(createJob("attempt_no_breakdown"), {
      dispatch: {},
      nodeStartupMs: null,
      supervisorEnv,
    });
    const bareInput = capturedInvocationInputs[2];
    if (!bareInput) {
      throw new Error("Expected the third direct invocation to call the package invocation.");
    }
    expect("latencyMilestones" in bareInput).toBe(false);
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value);
}

function requireObjectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isObjectRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireCallable(
  value: unknown,
  label: string,
): (...args: unknown[]) => Promise<unknown> | unknown {
  if (typeof value !== "function") {
    throw new Error(`${label} must be a function.`);
  }
  return (...args: unknown[]) => value(...args);
}

function requireFetchRequest(call: readonly unknown[] | undefined, label: string): Request {
  if (!call) {
    throw new Error(`${label} was not called.`);
  }
  const [input, init] = call;
  if (input instanceof Request) {
    return input;
  }
  if (input instanceof URL || typeof input === "string") {
    if (init !== undefined && !isObjectRecord(init)) {
      throw new Error(`${label} init must be an object.`);
    }
    return new Request(input, init as RequestInit | undefined);
  }
  throw new Error(`${label} must receive a Request, URL, or string input.`);
}

async function assertRealPrivateDirectory(directoryPath: string): Promise<void> {
  const entry = await lstat(directoryPath);
  expect(entry.isDirectory()).toBe(true);
  expect(entry.isSymbolicLink()).toBe(false);
  expect(entry.mode & 0o777).toBe(0o700);
}
