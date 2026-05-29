import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  clearHostedBrowserVaultWarmSourceStateHash,
  type HostedAssistantWorkspaceRuntimeJobResult,
} from "@murphai/assistant-runtime";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
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
  createHostedExecutionRunnerChildRuntimeWakeMessage,
  isHostedExecutionRunnerChildRuntimeWakeReadyMessage,
  parseHostedExecutionRunnerChildResultMessage,
  type HostedExecutionRunnerChildResult,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.ts";
import {
  redactHostedRuntimeDiagnosticDetails,
  redactHostedRuntimeDiagnosticText,
} from "./hosted-runtime-redaction.ts";
import {
  collectHostedRunnerChildRuntimePhaseDiagnostics,
  collectHostedRunnerChildStructuredRuntimeDiagnostics,
  collectHostedRunnerChildOutputMarkers,
  countHostedRunnerOutputLines,
  type HostedRunnerChildFirstCompletionKind,
  type HostedRunnerChildOutputMarker,
} from "./runner-child-diagnostics.ts";

export interface HostedExecutionIsolatedRunnerInput {
  job: HostedExecutionWorkspaceInvocationJobInput;
}

const HOSTED_RUNNER_WARM_WORKSPACES_DIRECTORY = "hosted-runner-workspaces";
const HOSTED_RUNNER_WARM_WORKSPACE_ID_HEX_LENGTH = 32;
const HOSTED_RUNNER_CHILD_OUTPUT_TAIL_MAX_CHARS = 4096;
const HOSTED_RUNNER_CHILD_RESULT_CLOSE_GRACE_MS = 250;

const hostedRunnerWarmLauncherRoots = new Map<string, string>();

export function runHostedWorkspaceInvocationIsolatedDetailed(
  input: HostedExecutionIsolatedRunnerInput & { job: HostedExecutionWorkspaceInvocationJobInput },
  options?: {
    onChildReadyForRuntimeWake?: (sendWake: () => boolean) => void;
    signal?: AbortSignal;
  },
): Promise<HostedAssistantWorkspaceRuntimeJobResult>;
export function runHostedWorkspaceInvocationIsolatedDetailed(
  input: HostedExecutionIsolatedRunnerInput,
  options?: {
    onChildReadyForRuntimeWake?: (sendWake: () => boolean) => void;
    signal?: AbortSignal;
  },
): Promise<HostedAssistantWorkspaceRuntimeJobResult>;
export async function runHostedWorkspaceInvocationIsolatedDetailed(
  input: HostedExecutionIsolatedRunnerInput,
  options?: {
    onChildReadyForRuntimeWake?: (sendWake: () => boolean) => void;
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
  const detached = process.platform !== "win32";
  const child = spawn(
    process.execPath,
    isTypeScriptChild
      ? ["--import", resolveHostedRunnerTsxImportSpecifier(), childEntry]
      : [childEntry],
    {
      cwd: warmRoot,
      detached,
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
  emitHostedRunnerChildProcessDiagnostic({
    childPid: child.pid,
    detached,
    reason: "spawn",
    stage: "spawned",
  });

  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Hosted runner child requires piped stdin, stdout, and stderr.");
  }

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdoutRemainder = "";
  let stderrRemainder = "";
  const stdoutTail = createHostedRunnerOutputTailBuffer();
  const stderrTail = createHostedRunnerOutputTailBuffer();
  const childResultState = createHostedRunnerChildResultState(child, {
    onRuntimeWakeReady: options?.onChildReadyForRuntimeWake ?? null,
  });
  child.stdout.on("data", (chunk: string) => {
    stdoutTail.append(chunk);
    stdoutRemainder = forwardHostedRuntimeChildOutputChunk({
      chunk,
      remainder: stdoutRemainder,
      sink: process.stdout,
    });
  });
  child.stderr.on("data", (chunk: string) => {
    stderrTail.append(chunk);
    stderrRemainder = forwardHostedRuntimeChildOutputChunk({
      chunk,
      remainder: stderrRemainder,
      sink: process.stderr,
    });
  });

  const terminateChild = () => {
    terminateChildProcess(child.pid, "abort-handler");
    emitHostedRunnerChildProcessDiagnostic({
      childPid: child.pid,
      detached,
      reason: "abort-handler",
      stage: "direct-child-kill",
    });
    child.kill("SIGKILL");
  };
  const abortHandler = () => {
    terminateChild();
  };
  options?.signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    child.stdin.end(JSON.stringify(input));
    const closePromise = new Promise<HostedRunnerChildCloseResult>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve({
          code,
          signal: signal ?? null,
        });
      });
    });
    const firstCompletion = await Promise.race([
      closePromise.then((closeResult) => ({
        closeResult,
        kind: "close" as const,
      })),
      childResultState.firstResultOrError.then(() => ({
        closeResult: null,
        kind: "child_result" as const,
      })),
    ]);
    const closeResult = firstCompletion.kind === "close"
      ? firstCompletion.closeResult
      : await waitForHostedRunnerChildCloseAfterResult(closePromise);
    flushHostedRuntimeChildOutputRemainder({
      remainder: stdoutRemainder,
      sink: process.stdout,
    });
    flushHostedRuntimeChildOutputRemainder({
      remainder: stderrRemainder,
      sink: process.stderr,
    });
    const childDiagnostics = createHostedRunnerChildExitDiagnostics({
      abortSignal: options?.signal,
      closeResult: closeResult ?? {
        code: null,
        signal: null,
      },
      firstCompletionKind: firstCompletion.kind,
      runtimeWakeReady: childResultState.runtimeWakeReady,
      stderrTail: stderrTail.read(),
      stdoutTail: stdoutTail.read(),
    });
    const childResult = readHostedRunnerChildResult(childResultState, childDiagnostics);

    if (childResult.ok && closeResult !== null && closeResult.code !== 0) {
      throw new Error(
        `Hosted assistant runtime child exited with code ${closeResult.code ?? "unknown"} after reporting success.`,
      );
    }

    if (!childResult.ok) {
      throw createHostedRuntimeChildFailure(childResult.error, childDiagnostics);
    }

    const result = childResult.result;
    return assertHostedExecutionRunnerJobResult(result, input.job);
  } finally {
    options?.signal?.removeEventListener("abort", abortHandler);
    terminateChildProcess(child.pid, "finally-cleanup");
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
  return path.join(resolveHostedRunnerWarmLauncherRootPath(userId), "durable", "vault");
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

function terminateChildProcess(pid: number | undefined, reason: string): void {
  if (typeof pid !== "number") {
    return;
  }

  if (process.platform === "win32") {
    return;
  }

  try {
    emitHostedRunnerChildProcessDiagnostic({
      childPid: pid,
      detached: true,
      reason,
      stage: "process-group-kill",
    });
    process.kill(-pid, "SIGKILL");
  } catch {
    // best-effort abort only
  }
}

function emitHostedRunnerChildProcessDiagnostic(input: {
  childPid: number | undefined;
  detached: boolean;
  reason: string;
  stage: string;
}): void {
  const childProcess = typeof input.childPid === "number"
    ? readLinuxProcessIdentity(input.childPid)
    : null;
  const supervisorProcess = readLinuxProcessIdentity(process.pid);

  emitHostedExecutionStructuredLog({
    component: "child-supervisor",
    details: {
      childPid: input.childPid ?? null,
      childProcessGroupId: childProcess?.processGroupId ?? null,
      childSessionId: childProcess?.sessionId ?? null,
      detached: input.detached,
      parentPid: process.pid,
      parentProcessGroupId: supervisorProcess?.processGroupId ?? null,
      parentSessionId: supervisorProcess?.sessionId ?? null,
      reason: input.reason,
      signal: input.stage.includes("kill") ? "SIGKILL" : null,
      stage: input.stage,
    },
    message: "Hosted runner child process diagnostic.",
    phase: "wake.running",
  });
}

function readLinuxProcessIdentity(pid: number): {
  parentPid: number | null;
  processGroupId: number | null;
  sessionId: number | null;
} | null {
  if (process.platform === "win32") {
    return null;
  }

  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }

  const commandEnd = stat.lastIndexOf(") ");
  if (commandEnd === -1 || commandEnd + 2 >= stat.length) {
    return null;
  }

  const fields = stat.slice(commandEnd + 2).trim().split(/\s+/u);
  const parentPid = parseIntegerOrNull(fields[1]);
  const processGroupId = parseIntegerOrNull(fields[2]);
  const sessionId = parseIntegerOrNull(fields[3]);
  return {
    parentPid,
    processGroupId,
    sessionId,
  };
}

function parseIntegerOrNull(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function createHostedRuntimeChildFailure(
  error: {
    code?: string | null;
    details?: Record<string, unknown> | null;
    message: string;
    name?: string | null;
    stack?: string | null;
  } | undefined,
  childDiagnostics: HostedRunnerChildExitDiagnostics,
): Error {
  const message = error?.message
    ? redactHostedRuntimeDiagnosticText(error.message)
    : `Hosted assistant runtime child exited with code ${childDiagnostics.exitCode ?? "unknown"}.`;
  const stack = error?.stack
    ? redactHostedRuntimeDiagnosticText(error.stack)
    : null;
  const details = {
    ...(redactHostedRuntimeDiagnosticDetails(error?.details) ?? {}),
    childProcess: childDiagnostics,
  };

  if (error?.name === "HostedAssistantConfigurationError") {
    const classified = new HostedAssistantConfigurationError(
      error.code === "HOSTED_ASSISTANT_CONFIG_REQUIRED"
        ? "HOSTED_ASSISTANT_CONFIG_REQUIRED"
        : "HOSTED_ASSISTANT_CONFIG_INVALID",
      message,
    ) as HostedAssistantConfigurationError & { details?: Record<string, unknown> | null };
    classified.stack = stack ?? classified.stack;
    classified.details = details;
    return classified;
  }

  const untyped = new Error(message) as Error & { details?: Record<string, unknown> | null };
  if (error?.name) {
    untyped.name = error.name;
  }
  if (stack) {
    untyped.stack = stack;
  }
  untyped.details = details;
  return untyped;
}

interface HostedRunnerChildResultState {
  errors: Error[];
  firstResultOrError: Promise<void>;
  results: HostedExecutionRunnerChildResult[];
  runtimeWakeReady: boolean;
}

interface HostedRunnerChildCloseResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface HostedRunnerChildExitDiagnostics {
  abortedByParent: boolean;
  exitCode: number | null;
  firstCompletionKind: HostedRunnerChildFirstCompletionKind;
  runtimeWakeReady: boolean;
  signal: NodeJS.Signals | null;
  abortReasonMessage?: string;
  abortReasonName?: string;
  stderrTail?: string;
  stderrTailLineCount?: number;
  stderrTailMarkers?: HostedRunnerChildOutputMarker[];
  runtimeLastPhase?: string;
  runtimeLastPhaseOrdinal?: number;
  runtimeLastPhaseStatus?: string;
  runtimePhaseTrace?: string[];
  stdoutTail?: string;
  stdoutTailLineCount?: number;
  stdoutTailMarkers?: HostedRunnerChildOutputMarker[];
}

function createHostedRunnerChildResultState(
  child: ChildProcess,
  input: {
    onRuntimeWakeReady?: ((sendWake: () => boolean) => void) | null;
  } = {},
): HostedRunnerChildResultState {
  const state: HostedRunnerChildResultState = {
    errors: [],
    firstResultOrError: Promise.resolve(),
    results: [],
    runtimeWakeReady: false,
  };
  let resolveFirstResultOrError: (() => void) | null = null;
  state.firstResultOrError = new Promise((resolve) => {
    resolveFirstResultOrError = resolve;
  });
  const markResultOrError = () => {
    resolveFirstResultOrError?.();
    resolveFirstResultOrError = null;
  };

  child.on("message", (message: unknown) => {
    try {
      if (isHostedExecutionRunnerChildRuntimeWakeReadyMessage(message)) {
        if (!state.runtimeWakeReady) {
          state.runtimeWakeReady = true;
          input.onRuntimeWakeReady?.(() => {
            if (!child.connected || child.killed) {
              return false;
            }
            try {
              return child.send(createHostedExecutionRunnerChildRuntimeWakeMessage()) !== false;
            } catch {
              // Best-effort wake only; durable runner wake state remains pending.
              return false;
            }
          });
        }
        return;
      }
      state.results.push(parseHostedExecutionRunnerChildResultMessage(message));
      markResultOrError();
    } catch (error) {
      state.errors.push(error instanceof Error ? error : new Error(String(error)));
      markResultOrError();
    }
  });

  return state;
}

async function waitForHostedRunnerChildCloseAfterResult(
  closePromise: Promise<HostedRunnerChildCloseResult>,
): Promise<HostedRunnerChildCloseResult | null> {
  return await Promise.race([
    closePromise,
    new Promise<null>((resolve) => {
      const timeout = setTimeout(resolve, HOSTED_RUNNER_CHILD_RESULT_CLOSE_GRACE_MS, null);
      timeout.unref?.();
    }),
  ]);
}

function readHostedRunnerChildResult(
  state: HostedRunnerChildResultState,
  childDiagnostics: HostedRunnerChildExitDiagnostics,
): HostedExecutionRunnerChildResult {
  if (state.errors.length > 0) {
    throw state.errors[0];
  }

  if (state.results.length === 0) {
    throw createHostedRunnerMissingChildResultError(childDiagnostics);
  }

  if (state.results.length > 1) {
    throw new Error("Hosted assistant runtime child emitted multiple result payloads.");
  }

  return state.results[0]!;
}

function createHostedRunnerMissingChildResultError(
  childDiagnostics: HostedRunnerChildExitDiagnostics,
): Error {
  const exitFragments = [
    `code ${childDiagnostics.exitCode ?? "unknown"}`,
    `signal ${childDiagnostics.signal ?? "unknown"}`,
  ];
  if (childDiagnostics.abortedByParent) {
    exitFragments.push("after parent abort");
  }
  const error = new Error(
    `Hosted assistant runtime child exited with ${exitFragments.join(", ")} without emitting a result payload.`,
  ) as Error & { details?: Record<string, unknown> };
  error.details = {
    childProcess: childDiagnostics,
  };
  return error;
}

function createHostedRunnerChildExitDiagnostics(input: {
  abortSignal?: AbortSignal;
  closeResult: HostedRunnerChildCloseResult;
  firstCompletionKind: HostedRunnerChildFirstCompletionKind;
  runtimeWakeReady: boolean;
  stderrTail: string;
  stdoutTail: string;
}): HostedRunnerChildExitDiagnostics {
  const abortReason = input.abortSignal?.reason;
  const diagnostics: HostedRunnerChildExitDiagnostics = {
    abortedByParent: input.abortSignal?.aborted === true,
    exitCode: input.closeResult.code,
    firstCompletionKind: input.firstCompletionKind,
    runtimeWakeReady: input.runtimeWakeReady,
    signal: input.closeResult.signal,
  };
  const abortReasonName = readHostedRunnerAbortReasonName(abortReason);
  const abortReasonMessage = readHostedRunnerAbortReasonMessage(abortReason);
  const stdoutTail = redactHostedRuntimeDiagnosticText(input.stdoutTail.trim());
  const stderrTail = redactHostedRuntimeDiagnosticText(input.stderrTail.trim());
  const stdoutTailLineCount = countHostedRunnerOutputLines(input.stdoutTail);
  const stderrTailLineCount = countHostedRunnerOutputLines(input.stderrTail);
  const stdoutTailMarkers = collectHostedRunnerChildOutputMarkers(input.stdoutTail);
  const stderrTailMarkers = collectHostedRunnerChildOutputMarkers(input.stderrTail);
  const runtimePhaseDiagnostics = collectHostedRunnerChildRuntimePhaseDiagnostics({
    stderrTail: input.stderrTail,
    stdoutTail: input.stdoutTail,
  });
  const structuredRuntimeDiagnostics = collectHostedRunnerChildStructuredRuntimeDiagnostics({
    stderrTail: input.stderrTail,
    stdoutTail: input.stdoutTail,
  });

  if (abortReasonName) {
    diagnostics.abortReasonName = abortReasonName;
  }
  if (abortReasonMessage) {
    diagnostics.abortReasonMessage = abortReasonMessage;
  }
  if (stdoutTail.length > 0) {
    diagnostics.stdoutTail = stdoutTail;
    diagnostics.stdoutTailLineCount = stdoutTailLineCount;
  }
  if (stdoutTailMarkers.length > 0) {
    diagnostics.stdoutTailMarkers = stdoutTailMarkers;
  }
  if (stderrTail.length > 0) {
    diagnostics.stderrTail = stderrTail;
    diagnostics.stderrTailLineCount = stderrTailLineCount;
  }
  if (stderrTailMarkers.length > 0) {
    diagnostics.stderrTailMarkers = stderrTailMarkers;
  }
  Object.assign(diagnostics, runtimePhaseDiagnostics);
  Object.assign(diagnostics, structuredRuntimeDiagnostics);

  return diagnostics;
}

function readHostedRunnerAbortReasonName(reason: unknown): string | null {
  if (reason instanceof Error && reason.name.trim().length > 0) {
    return redactHostedRuntimeDiagnosticText(reason.name);
  }
  return null;
}

function readHostedRunnerAbortReasonMessage(reason: unknown): string | null {
  if (reason instanceof Error && reason.message.trim().length > 0) {
    return redactHostedRuntimeDiagnosticText(reason.message);
  }
  if (typeof reason === "string" && reason.trim().length > 0) {
    return redactHostedRuntimeDiagnosticText(reason);
  }
  return null;
}

function createHostedRunnerOutputTailBuffer(): {
  append: (chunk: string) => void;
  read: () => string;
} {
  let tail = "";
  return {
    append(chunk) {
      tail += chunk;
      if (tail.length > HOSTED_RUNNER_CHILD_OUTPUT_TAIL_MAX_CHARS) {
        tail = tail.slice(-HOSTED_RUNNER_CHILD_OUTPUT_TAIL_MAX_CHARS);
      }
    },
    read() {
      return tail;
    },
  };
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
