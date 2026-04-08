import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createHostedRuntimeChildLauncherDirectories,
  createHostedRuntimeChildProcessEnv,
  formatHostedRuntimeChildResult,
  parseHostedRuntimeChildResult,
  resolveHostedRuntimeTsxImportSpecifier,
  type HostedAssistantRuntimeJobInput,
  type HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";
import {
  HostedAssistantConfigurationError,
} from "@murphai/assistant-runtime/hosted-assistant-env";

export interface HostedExecutionIsolatedRunnerInput {
  internalWorkerProxyToken?: string | null;
  job: HostedAssistantRuntimeJobInput;
}

export async function runHostedExecutionJobIsolatedDetailed(
  input: HostedExecutionIsolatedRunnerInput,
  options?: {
    signal?: AbortSignal;
  },
): Promise<HostedAssistantRuntimeJobResult> {
  const launcherRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-launch-"));

  try {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new Error("Hosted runner job aborted before child launch.");
    }

    const launcherDirectories = await createHostedRuntimeChildLauncherDirectories(launcherRoot);
    const childEntry = resolveNodeRunnerChildEntry();
    const isTypeScriptChild = childEntry.endsWith(".ts");
    const child = spawn(
      process.execPath,
      isTypeScriptChild
        ? ["--import", resolveHostedRuntimeTsxImportSpecifier(), childEntry]
        : [childEntry],
      {
        cwd: launcherRoot,
        detached: process.platform !== "win32",
        env: createHostedRuntimeChildProcessEnv({
          forwardedEnv: { ...(input.job.runtime?.forwardedEnv ?? {}) },
          isTypeScriptChild,
          launcherDirectories,
        }),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    child.stdout.on("data", (chunk: string) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderrChunks.push(chunk);
    });

    const terminateChild = () => {
      terminateChildProcess(child.pid);
      child.kill("SIGKILL");
    };
    const abortHandler = () => {
      terminateChild();
    };
    options?.signal?.addEventListener("abort", abortHandler, { once: true });

    try {
      child.stdin.end(JSON.stringify(input));
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      const childResult = parseHostedRuntimeChildResult(stdoutChunks.join(""));

      if (!childResult.ok || !isHostedAssistantRuntimeJobResult(childResult.result)) {
        throw createHostedRuntimeChildFailure(childResult.error, code);
      }

      return childResult.result;
    } finally {
      options?.signal?.removeEventListener("abort", abortHandler);
      terminateChildProcess(child.pid);
    }
  } finally {
    await rm(launcherRoot, { force: true, recursive: true });
  }
}

export function formatHostedExecutionChildResult(
  payload: Parameters<typeof formatHostedRuntimeChildResult>[0],
): string {
  return formatHostedRuntimeChildResult(payload);
}

function resolveNodeRunnerChildEntry(): string {
  const builtPath = fileURLToPath(new URL("./node-runner-child.js", import.meta.url));

  if (existsSync(builtPath)) {
    return builtPath;
  }

  return fileURLToPath(new URL("./node-runner-child.ts", import.meta.url));
}

function terminateChildProcess(pid: number | undefined): void {
  if (typeof pid !== "number") {
    return;
  }

  if (process.platform === "win32") {
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // best-effort abort only
  }
}

function createHostedRuntimeChildFailure(
  error: {
    code?: string | null;
    message: string;
    name?: string | null;
    stack?: string | null;
  } | undefined,
  code: number | null,
): Error {
  const message = error?.message
    ?? `Hosted assistant runtime child exited with code ${code ?? "unknown"}.`;

  if (error?.name === "HostedAssistantConfigurationError") {
    const classified = new HostedAssistantConfigurationError(
      error.code === "HOSTED_ASSISTANT_CONFIG_REQUIRED"
        ? "HOSTED_ASSISTANT_CONFIG_REQUIRED"
        : "HOSTED_ASSISTANT_CONFIG_INVALID",
      message,
    );
    classified.stack = error.stack ?? classified.stack;
    return classified;
  }

  const untyped = new Error(message);
  if (error?.name) {
    untyped.name = error.name;
  }
  if (error?.stack) {
    untyped.stack = error.stack;
  }
  return untyped;
}

function isHostedAssistantRuntimeJobResult(
  value: unknown,
): value is HostedAssistantRuntimeJobResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (!("finalGatewayProjectionSnapshot" in candidate)) {
    return false;
  }

  if (typeof candidate.result !== "object" || candidate.result === null) {
    return false;
  }

  const runnerResult = candidate.result as Record<string, unknown>;
  return "bundle" in runnerResult && "result" in runnerResult;
}
