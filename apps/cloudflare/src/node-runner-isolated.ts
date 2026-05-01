import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  type HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime";
import {
  HostedAssistantConfigurationError,
} from "@murphai/assistant-runtime/hosted-assistant-env";
import { buildHostedRunnerChildRuntimeEnv } from "./runner-env.ts";
import {
  createHostedRunnerChildLauncherDirectories,
  createHostedRunnerChildProcessEnv,
  resolveHostedRunnerTsxImportSpecifier,
} from "./runner-child-launcher.ts";
import {
  assertHostedExecutionRunnerJobResult,
  formatHostedExecutionRunnerChildResult,
  parseHostedExecutionRunnerChildResult,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.ts";
import {
  redactHostedRuntimeDiagnosticDetails,
  redactHostedRuntimeDiagnosticText,
} from "./hosted-runtime-redaction.ts";

export interface HostedExecutionIsolatedRunnerInput {
  internalWorkerProxyToken?: string | null;
  localInternalProxyBaseUrl?: string | null;
  job: HostedExecutionWorkspaceInvocationJobInput;
}

const HOSTED_RUNTIME_CHILD_RESULT_PREFIX = "__HB_ASSISTANT_RUNTIME_RESULT__";

export function runHostedWorkspaceInvocationIsolatedDetailed(
  input: HostedExecutionIsolatedRunnerInput & { job: HostedExecutionWorkspaceInvocationJobInput },
  options?: {
    signal?: AbortSignal;
  },
): Promise<HostedAssistantWorkspaceRuntimeJobResult>;
export function runHostedWorkspaceInvocationIsolatedDetailed(
  input: HostedExecutionIsolatedRunnerInput,
  options?: {
    signal?: AbortSignal;
  },
): Promise<HostedAssistantWorkspaceRuntimeJobResult>;
export async function runHostedWorkspaceInvocationIsolatedDetailed(
  input: HostedExecutionIsolatedRunnerInput,
  options?: {
    signal?: AbortSignal;
  },
): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
  const launcherRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-launch-"));

  try {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new Error("Hosted runner job aborted before child launch.");
    }

    const launcherDirectories = await createHostedRunnerChildLauncherDirectories(launcherRoot);
    const childEntry = resolveNodeRunnerChildEntry();
    const isTypeScriptChild = childEntry.endsWith(".ts");
    const child = spawn(
      process.execPath,
      isTypeScriptChild
        ? ["--import", resolveHostedRunnerTsxImportSpecifier(), childEntry]
        : [childEntry],
      {
        cwd: launcherRoot,
        detached: process.platform !== "win32",
        env: createHostedRunnerChildProcessEnv({
          forwardedEnv: buildHostedRunnerChildRuntimeEnv({
            forwardedEnv: input.job.runtime?.forwardedEnv,
          }),
          isTypeScriptChild,
          launcherDirectories,
          parserToolchain: input.job.runtime?.parserToolchain ?? null,
        }),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const stdoutChunks: string[] = [];
    let stdoutRemainder = "";
    let stderrRemainder = "";
    child.stdout.on("data", (chunk: string) => {
      stdoutChunks.push(chunk);
      stdoutRemainder = forwardHostedRuntimeChildOutputChunk({
        chunk,
        remainder: stdoutRemainder,
        sink: process.stdout,
        suppressResultPayload: true,
      });
    });
    child.stderr.on("data", (chunk: string) => {
      stderrRemainder = forwardHostedRuntimeChildOutputChunk({
        chunk,
        remainder: stderrRemainder,
        sink: process.stderr,
        suppressResultPayload: false,
      });
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
      flushHostedRuntimeChildOutputRemainder({
        remainder: stdoutRemainder,
        sink: process.stdout,
        suppressResultPayload: true,
      });
      flushHostedRuntimeChildOutputRemainder({
        remainder: stderrRemainder,
        sink: process.stderr,
        suppressResultPayload: false,
      });
      const childResult = parseHostedExecutionRunnerChildResult(stdoutChunks.join(""));

      if (!childResult.ok) {
        throw createHostedRuntimeChildFailure(childResult.error, code);
      }

      const result = childResult.result;
      return assertHostedExecutionRunnerJobResult(result, input.job);
    } finally {
      options?.signal?.removeEventListener("abort", abortHandler);
      terminateChildProcess(child.pid);
    }
  } finally {
    await rm(launcherRoot, { force: true, recursive: true });
  }
}

export function formatHostedExecutionChildResult(
  payload: Parameters<typeof formatHostedExecutionRunnerChildResult>[0],
): string {
  return formatHostedExecutionRunnerChildResult(payload);
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
    details?: Record<string, unknown> | null;
    message: string;
    name?: string | null;
    stack?: string | null;
  } | undefined,
  code: number | null,
): Error {
  const message = error?.message
    ? redactHostedRuntimeDiagnosticText(error.message)
    : `Hosted assistant runtime child exited with code ${code ?? "unknown"}.`;
  const stack = error?.stack
    ? redactHostedRuntimeDiagnosticText(error.stack)
    : null;
  const details = redactHostedRuntimeDiagnosticDetails(error?.details);

  if (error?.name === "HostedAssistantConfigurationError") {
    const classified = new HostedAssistantConfigurationError(
      error.code === "HOSTED_ASSISTANT_CONFIG_REQUIRED"
        ? "HOSTED_ASSISTANT_CONFIG_REQUIRED"
        : "HOSTED_ASSISTANT_CONFIG_INVALID",
      message,
    ) as HostedAssistantConfigurationError & { details?: Record<string, unknown> | null };
    classified.stack = stack ?? classified.stack;
    if (details) {
      classified.details = details;
    }
    return classified;
  }

  const untyped = new Error(message) as Error & { details?: Record<string, unknown> | null };
  if (error?.name) {
    untyped.name = error.name;
  }
  if (stack) {
    untyped.stack = stack;
  }
  if (details) {
    untyped.details = details;
  }
  return untyped;
}

function forwardHostedRuntimeChildOutputChunk(input: {
  chunk: string;
  remainder: string;
  sink: Pick<NodeJS.WriteStream, "write">;
  suppressResultPayload: boolean;
}): string {
  const combined = input.remainder + input.chunk;
  const lines = combined.split(/\r?\n/u);
  const nextRemainder = lines.pop() ?? "";

  for (const line of lines) {
    writeHostedRuntimeChildOutputLine({
      line,
      sink: input.sink,
      suppressResultPayload: input.suppressResultPayload,
    });
  }

  return nextRemainder;
}

function flushHostedRuntimeChildOutputRemainder(input: {
  remainder: string;
  sink: Pick<NodeJS.WriteStream, "write">;
  suppressResultPayload: boolean;
}): void {
  if (input.remainder.length === 0) {
    return;
  }

  writeHostedRuntimeChildOutputLine({
    line: input.remainder,
    sink: input.sink,
    suppressResultPayload: input.suppressResultPayload,
  });
}

function writeHostedRuntimeChildOutputLine(input: {
  line: string;
  sink: Pick<NodeJS.WriteStream, "write">;
  suppressResultPayload: boolean;
}): void {
  const trimmed = input.line.trim();
  if (trimmed.length === 0) {
    return;
  }

  if (input.suppressResultPayload && trimmed.startsWith(HOSTED_RUNTIME_CHILD_RESULT_PREFIX)) {
    return;
  }

  input.sink.write(`${redactHostedRuntimeChildOutputLine(input.line)}\n`);
}

function redactHostedRuntimeChildOutputLine(line: string): string {
  return redactHostedRuntimeDiagnosticText(line);
}
