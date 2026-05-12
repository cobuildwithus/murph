import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  clearHostedBrowserVaultWarmSourceStateHash,
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
  parseHostedExecutionRunnerChildResultMessage,
  type HostedExecutionRunnerChildResult,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.ts";
import {
  redactHostedRuntimeDiagnosticDetails,
  redactHostedRuntimeDiagnosticText,
} from "./hosted-runtime-redaction.ts";

export interface HostedExecutionIsolatedRunnerInput {
  runtimeCallbackBaseUrl?: string | null;
  job: HostedExecutionWorkspaceInvocationJobInput;
}

const HOSTED_RUNNER_WARM_WORKSPACES_DIRECTORY = "hosted-runner-workspaces";
const HOSTED_RUNNER_WARM_WORKSPACE_ID_HEX_LENGTH = 32;

const hostedRunnerWarmLauncherRoots = new Map<string, string>();

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
  const warmRoot = await resolveHostedRunnerWarmLauncherRoot(input.job);
  await clearHostedBrowserVaultWarmSourceStateHash({
    vaultRoot: resolveHostedRunnerWarmWorkspaceVaultRoot(input.job.request.userId),
  });

  if (options?.signal?.aborted) {
    throw options.signal.reason ?? new Error("Hosted runner job aborted before child launch.");
  }

  const launcherDirectories = await createHostedRunnerChildLauncherDirectories(warmRoot);
  const childEntry = resolveNodeRunnerChildEntry();
  const isTypeScriptChild = childEntry.endsWith(".ts");
  const child = spawn(
    process.execPath,
    isTypeScriptChild
      ? ["--import", resolveHostedRunnerTsxImportSpecifier(), childEntry]
      : [childEntry],
    {
      cwd: warmRoot,
      detached: process.platform !== "win32",
      env: createHostedRunnerChildProcessEnv({
        forwardedEnv: buildHostedRunnerChildRuntimeEnv({
          forwardedEnv: input.job.runtime?.forwardedEnv,
        }),
        isTypeScriptChild,
        launcherDirectories,
      }),
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    },
  );

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Hosted runner child requires piped stdin, stdout, and stderr.");
  }

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdoutRemainder = "";
  let stderrRemainder = "";
  const childResultState = createHostedRunnerChildResultState(child);
  child.stdout.on("data", (chunk: string) => {
    stdoutRemainder = forwardHostedRuntimeChildOutputChunk({
      chunk,
      remainder: stdoutRemainder,
      sink: process.stdout,
    });
  });
  child.stderr.on("data", (chunk: string) => {
    stderrRemainder = forwardHostedRuntimeChildOutputChunk({
      chunk,
      remainder: stderrRemainder,
      sink: process.stderr,
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
    });
    flushHostedRuntimeChildOutputRemainder({
      remainder: stderrRemainder,
      sink: process.stderr,
    });
    const childResult = readHostedRunnerChildResult(childResultState, code);

    if (childResult.ok && code !== 0) {
      throw new Error(
        `Hosted assistant runtime child exited with code ${code ?? "unknown"} after reporting success.`,
      );
    }

    if (!childResult.ok) {
      throw createHostedRuntimeChildFailure(childResult.error, code);
    }

    const result = childResult.result;
    return assertHostedExecutionRunnerJobResult(result, input.job);
  } finally {
    options?.signal?.removeEventListener("abort", abortHandler);
    terminateChildProcess(child.pid);
  }
}

export async function clearHostedRunnerWarmLauncherRootsForTests(): Promise<void> {
  const roots = [...new Set(hostedRunnerWarmLauncherRoots.values())];
  hostedRunnerWarmLauncherRoots.clear();
  await Promise.all(
    roots.map((root) => rm(root, { force: true, recursive: true })),
  );
}

function resolveNodeRunnerChildEntry(): string {
  const builtPath = fileURLToPath(new URL("./node-runner-child.js", import.meta.url));

  if (existsSync(builtPath)) {
    return builtPath;
  }

  return fileURLToPath(new URL("./node-runner-child.ts", import.meta.url));
}

async function resolveHostedRunnerWarmLauncherRoot(
  job: HostedExecutionWorkspaceInvocationJobInput,
): Promise<string> {
  const root = resolveHostedRunnerWarmLauncherRootPath(job.request.userId);
  const workspaceId = path.basename(root);
  const cached = hostedRunnerWarmLauncherRoots.get(workspaceId);
  if (cached) {
    await mkdir(cached, { mode: 0o700, recursive: true });
    return cached;
  }

  await mkdir(root, { mode: 0o700, recursive: true });
  hostedRunnerWarmLauncherRoots.set(workspaceId, root);
  return root;
}

export function resolveHostedRunnerWarmWorkspaceVaultRoot(userId: string): string {
  return path.join(resolveHostedRunnerWarmLauncherRootPath(userId), "vault");
}

function resolveHostedRunnerWarmLauncherRootPath(userId: string): string {
  return path.join(
    tmpdir(),
    HOSTED_RUNNER_WARM_WORKSPACES_DIRECTORY,
    createHostedRunnerWarmWorkspaceId(userId),
  );
}

function createHostedRunnerWarmWorkspaceId(userId: string): string {
  return createHash("sha256")
    .update(userId)
    .digest("hex")
    .slice(0, HOSTED_RUNNER_WARM_WORKSPACE_ID_HEX_LENGTH);
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

interface HostedRunnerChildResultState {
  errors: Error[];
  results: HostedExecutionRunnerChildResult[];
}

function createHostedRunnerChildResultState(child: ChildProcess): HostedRunnerChildResultState {
  const state: HostedRunnerChildResultState = {
    errors: [],
    results: [],
  };

  child.on("message", (message: unknown) => {
    try {
      state.results.push(parseHostedExecutionRunnerChildResultMessage(message));
    } catch (error) {
      state.errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  });

  return state;
}

function readHostedRunnerChildResult(
  state: HostedRunnerChildResultState,
  code: number | null,
): HostedExecutionRunnerChildResult {
  if (state.errors.length > 0) {
    throw state.errors[0];
  }

  if (state.results.length === 0) {
    throw new Error(
      `Hosted assistant runtime child exited with code ${code ?? "unknown"} without emitting a result payload.`,
    );
  }

  if (state.results.length > 1) {
    throw new Error("Hosted assistant runtime child emitted multiple result payloads.");
  }

  return state.results[0]!;
}

function forwardHostedRuntimeChildOutputChunk(input: {
  chunk: string;
  remainder: string;
  sink: Pick<NodeJS.WriteStream, "write">;
}): string {
  const combined = input.remainder + input.chunk;
  const lines = combined.split(/\r?\n/u);
  const nextRemainder = lines.pop() ?? "";

  for (const line of lines) {
    writeHostedRuntimeChildOutputLine({
      line,
      sink: input.sink,
    });
  }

  return nextRemainder;
}

function flushHostedRuntimeChildOutputRemainder(input: {
  remainder: string;
  sink: Pick<NodeJS.WriteStream, "write">;
}): void {
  if (input.remainder.length === 0) {
    return;
  }

  writeHostedRuntimeChildOutputLine({
    line: input.remainder,
    sink: input.sink,
  });
}

function writeHostedRuntimeChildOutputLine(input: {
  line: string;
  sink: Pick<NodeJS.WriteStream, "write">;
}): void {
  const trimmed = input.line.trim();
  if (trimmed.length === 0) {
    return;
  }

  input.sink.write(`${redactHostedRuntimeChildOutputLine(input.line)}\n`);
}

function redactHostedRuntimeChildOutputLine(line: string): string {
  return redactHostedRuntimeDiagnosticText(line);
}
