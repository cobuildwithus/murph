import { execFileSync, spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { PassThrough } from "node:stream";

import {
  HEALTH_POLL_INTERVAL_MS,
  HEALTH_REQUEST_TIMEOUT_MS,
  HEALTH_TIMEOUT_MS,
  HOSTED_WEB_DEV_DIST_DIR,
  HOSTED_WEB_SMOKE_DIST_DIR,
  repoRoot,
  webDir,
} from "./constants.ts";
import type {
  BufferedNamedChildProcess,
  HostedLocalChildProcess,
  HostedWebDevServerLockMetadata,
  NamedChildProcess,
} from "./types.ts";

interface SetupCommandInput {
  cwd: string;
  env: NodeJS.ProcessEnv;
  name: "setup";
}

interface BoundedCommandInput {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

interface BoundedCommandResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

const HOSTED_LOCAL_RUNNER_CONTAINER_NAME_PREFIX = "workerd-murph-hosted-RunnerContainer-";

export async function assertHostedWebDevServerAvailable(env: NodeJS.ProcessEnv): Promise<void> {
  const lockPaths = resolveHostedWebDevLockPaths(env);
  const rawMetadata = await tryReadTextFile(lockPaths.metadataPath);

  if (rawMetadata === null) {
    return;
  }

  let metadata: unknown;

  try {
    metadata = JSON.parse(rawMetadata);
  } catch {
    await rm(lockPaths.lockPath, { force: true, recursive: true });
    return;
  }

  if (!isHostedWebDevServerLockMetadata(metadata)) {
    await rm(lockPaths.lockPath, { force: true, recursive: true });
    return;
  }

  if (!isProcessRunning(metadata.pid)) {
    await rm(lockPaths.lockPath, { force: true, recursive: true });
    return;
  }

  throw new Error(
    [
      `apps/web already has an active dev server lock (pid ${metadata.pid}, port ${metadata.port}).`,
      "Stop that dev server before running `pnpm dev`.",
    ].join(" "),
  );
}

export async function assertPortAvailable(host: string, port: number, message: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      if (
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "EADDRINUSE"
      ) {
        reject(new Error(message));
        return;
      }

      reject(error);
    });
    server.once("listening", () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve();
      });
    });
    server.listen(port, host);
  });
}

export function spawnChildProcess(
  name: "cloudflare" | "stripe" | "web",
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  input: {
    pipeOutput?: boolean;
    stderrTarget?: NodeJS.WritableStream;
    stdoutTarget?: NodeJS.WritableStream;
  } = {},
): BufferedNamedChildProcess {
  const child = spawn(command, args, {
    cwd: repoRoot,
    detached: process.platform !== "win32",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = createOutputBuffer();
  const stderr = createOutputBuffer();
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string | Buffer) => {
    stdout.append(chunk);
  });
  child.stderr?.on("data", (chunk: string | Buffer) => {
    stderr.append(chunk);
  });

  if (input.pipeOutput !== false) {
    pipeWithPrefix(name, child.stdout, input.stdoutTarget ?? process.stdout);
    pipeWithPrefix(name, child.stderr, input.stderrTarget ?? process.stderr);
  }

  return {
    child,
    name,
    stderrTail: (maxChars?: number): string => tail(stderr.read(), maxChars),
    stderrText: (): string => stderr.read(),
    stdoutTail: (maxChars?: number): string => tail(stdout.read(), maxChars),
    stdoutText: (): string => stdout.read(),
  };
}

export async function waitForFirstChildExit(
  children: readonly NamedChildProcess[],
): Promise<NamedChildProcess> {
  return await new Promise((resolve) => {
    for (const entry of children) {
      entry.child.once("exit", () => resolve(entry));
    }
  });
}

export class StripeCliMissingError extends Error {
  constructor() {
    super("stripe CLI executable was not found on PATH");
    this.name = "StripeCliMissingError";
  }
}

export interface StripeListenerSpawnResult {
  child: BufferedNamedChildProcess;
  secret: string;
}

export async function spawnStripeListenerWithSecretCapture(input: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  pipeOutput?: boolean;
  stderrTarget?: NodeJS.WritableStream;
  stdoutTarget?: NodeJS.WritableStream;
  timeoutMs: number;
}): Promise<StripeListenerSpawnResult> {
  const child = spawn(input.command, input.args, {
    cwd: repoRoot,
    detached: process.platform !== "win32",
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  const stdoutCapture = createOutputBuffer();
  const stderrCapture = createOutputBuffer();

  let secret: string;
  try {
    secret = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `stripe listen did not print a webhook signing secret within ${input.timeoutMs}ms; stderr: ${tail(stderrCapture.read(), 512)}`,
          ),
        );
      }, input.timeoutMs);

      // Stripe CLI versions differ on which stream carries the startup
      // "Ready!" banner that contains `whsec_...`: older builds print it to
      // stdout, current builds print it to stderr. Scan both so the capture
      // keeps working as the CLI evolves.
      const onStdout = (chunk: string | Buffer): void => {
        stdoutCapture.append(chunk);
        const match = /whsec_[A-Za-z0-9_]+/.exec(stdoutCapture.read());
        if (match) {
          cleanup();
          resolve(match[0]);
        }
      };

      const onStderr = (chunk: string | Buffer): void => {
        stderrCapture.append(chunk);
        const match = /whsec_[A-Za-z0-9_]+/.exec(stderrCapture.read());
        if (match) {
          cleanup();
          resolve(match[0]);
        }
      };

      const onExit = (code: number | null): void => {
        cleanup();
        reject(
          new Error(
            `stripe listen exited with code ${code ?? "unknown"} before printing a secret; stderr: ${tail(stderrCapture.read(), 512)}`,
          ),
        );
      };

      const onError = (error: NodeJS.ErrnoException): void => {
        cleanup();
        if (error.code === "ENOENT") {
          reject(new StripeCliMissingError());
          return;
        }
        reject(error);
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        child.stdout?.off("data", onStdout);
        child.stderr?.off("data", onStderr);
        child.off("exit", onExit);
        child.off("error", onError);
      };

      child.stdout?.on("data", onStdout);
      child.stderr?.on("data", onStderr);
      child.once("exit", onExit);
      child.once("error", onError);
    });
  } catch (error) {
    // Pre-capture rejection must not leak a detached `stripe listen` process.
    // StripeCliMissingError means spawn ENOENT'd, so there is no running child.
    // Otherwise kill the child best-effort — if it has already exited, kill()
    // returns false without throwing, so this stays safe either way.
    if (!(error instanceof StripeCliMissingError)) {
      try {
        child.kill("SIGTERM");
      } catch {
        // best-effort; child may already be gone
      }
    }
    throw error;
  }

  // Line-buffered redactor: holds partial lines until a newline arrives so a
  // `whsec_...` split across chunk boundaries still gets replaced before any
  // downstream consumer (pipe target or text buffer) sees it.
  const stdoutLineRedactor = createLineBufferedSecretRedactor(secret);
  const stderrLineRedactor = createLineBufferedSecretRedactor(secret);

  const stdoutBuffer = createOutputBuffer();
  const stderrBuffer = createOutputBuffer();

  const redactedStdout = new PassThrough();
  const redactedStderr = new PassThrough();
  redactedStdout.setEncoding("utf8");
  redactedStderr.setEncoding("utf8");

  redactedStdout.on("data", (chunk: string | Buffer) => {
    stdoutBuffer.append(chunk.toString());
  });
  redactedStderr.on("data", (chunk: string | Buffer) => {
    stderrBuffer.append(chunk.toString());
  });

  if (input.pipeOutput !== false) {
    pipeWithPrefix("stripe", redactedStdout, input.stdoutTarget ?? process.stdout);
    pipeWithPrefix("stripe", redactedStderr, input.stderrTarget ?? process.stderr);
  }

  const stdoutInitial = stdoutLineRedactor.push(stdoutCapture.read());
  if (stdoutInitial.length > 0) {
    redactedStdout.write(stdoutInitial);
  }
  const stderrInitial = stderrLineRedactor.push(stderrCapture.read());
  if (stderrInitial.length > 0) {
    redactedStderr.write(stderrInitial);
  }

  child.stdout?.on("data", (chunk: string | Buffer) => {
    const redacted = stdoutLineRedactor.push(chunk.toString());
    if (redacted.length > 0) {
      redactedStdout.write(redacted);
    }
  });
  child.stderr?.on("data", (chunk: string | Buffer) => {
    const redacted = stderrLineRedactor.push(chunk.toString());
    if (redacted.length > 0) {
      redactedStderr.write(redacted);
    }
  });
  child.stdout?.on("end", () => {
    const flushed = stdoutLineRedactor.flush();
    if (flushed.length > 0) {
      redactedStdout.write(flushed);
    }
    redactedStdout.end();
  });
  child.stderr?.on("end", () => {
    const flushed = stderrLineRedactor.flush();
    if (flushed.length > 0) {
      redactedStderr.write(flushed);
    }
    redactedStderr.end();
  });

  return {
    child: {
      child,
      name: "stripe",
      stderrTail: (maxChars?: number): string => tail(stderrBuffer.read(), maxChars),
      stderrText: (): string => stderrBuffer.read(),
      stdoutTail: (maxChars?: number): string => tail(stdoutBuffer.read(), maxChars),
      stdoutText: (): string => stdoutBuffer.read(),
    },
    secret,
  };
}

export async function runCommand(
  command: string,
  args: string[],
  input: SetupCommandInput,
): Promise<void> {
  const child = spawn(command, args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  pipeWithPrefix(input.name, child.stdout, process.stdout);
  pipeWithPrefix(input.name, child.stderr, process.stderr);

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`));
    });
  });
}

export async function captureCommandOutput(
  command: string,
  args: string[],
  input: SetupCommandInput,
): Promise<string> {
  const child = spawn(command, args, {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  pipeWithPrefix(input.name, child.stderr, process.stderr);

  let stdout = "";
  child.stdout?.on("data", (chunk: string | Buffer) => {
    stdout += chunk.toString();
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`));
    });
  });

  return stdout;
}

export async function collectDockerDevDiagnostics(input: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = input.timeoutMs ?? 10_000;
  const commands: ReadonlyArray<{
    args: readonly string[];
    label: string;
  }> = [
    {
      args: ["version", "--format", "{{json .Server}}"],
      label: "docker version",
    },
    {
      args: ["ps", "-a", "--format", "{{.ID}} {{.Image}} {{.Status}} {{.Names}}"],
      label: "docker ps -a",
    },
    {
      args: ["buildx", "ls"],
      label: "docker buildx ls",
    },
  ];

  const sections = ["Docker diagnostics:"];

  for (const command of commands) {
    const result = await runBoundedCommand({
      args: command.args,
      command: "docker",
      cwd: input.cwd,
      env: input.env,
      timeoutMs,
    });
    sections.push(formatBoundedCommandResult(command.label, result));
  }

  return sections.join("\n");
}

export async function cleanupHostedRunnerContainers(input: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  ignoreErrors?: boolean;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? 15_000;
  const listed = await listHostedRunnerContainerIds({
    cwd: input.cwd,
    env: input.env,
    timeoutMs,
  });

  if (listed.result.timedOut || listed.result.exitCode !== 0) {
    if (input.ignoreErrors) {
      return;
    }
    throw new Error(
      [
        "Failed to inspect local Cloudflare runner containers before startup.",
        formatBoundedCommandResult("docker ps -aq", listed.result),
      ].join("\n"),
    );
  }

  const containerIds = listed.containerIds;
  if (containerIds.length === 0) {
    return;
  }

  const removed = await runBoundedCommand({
    args: ["rm", "-f", ...containerIds],
    command: "docker",
    cwd: input.cwd,
    env: input.env,
    timeoutMs,
  });

  if (
    removed.timedOut
    || removed.exitCode !== 0
  ) {
    const disappeared = await waitForHostedRunnerContainersToDisappear({
      cwd: input.cwd,
      env: input.env,
      timeoutMs: Math.min(timeoutMs, 3_000),
    });
    if (disappeared || input.ignoreErrors) {
      return;
    }

    throw new Error(
      [
        "Failed to remove stale local Cloudflare runner containers.",
        formatBoundedCommandResult(`docker rm -f (${containerIds.length})`, removed),
      ].join("\n"),
    );
  }
}

async function listHostedRunnerContainerIds(input: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<{
  containerIds: string[];
  result: BoundedCommandResult;
}> {
  const result = await runBoundedCommand({
    args: [
      "ps",
      "-aq",
      "--filter",
      `name=${HOSTED_LOCAL_RUNNER_CONTAINER_NAME_PREFIX}`,
    ],
    command: "docker",
    cwd: input.cwd,
    env: input.env,
    timeoutMs: input.timeoutMs,
  });

  return {
    containerIds: result.stdout
      .split(/\s+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    result,
  };
}

async function waitForHostedRunnerContainersToDisappear(input: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < input.timeoutMs) {
    const listed = await listHostedRunnerContainerIds({
      cwd: input.cwd,
      env: input.env,
      timeoutMs: Math.min(input.timeoutMs, 1_000),
    });
    if (!listed.result.timedOut && listed.result.exitCode === 0 && listed.containerIds.length === 0) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

export async function waitForHealthyHttpEndpoint(input: {
  host: string;
  label: string;
  path: string;
  port: number;
  protocol: "http" | "https";
}): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    try {
      const statusCode = await requestStatus(input);
      if (statusCode === 200) {
        return;
      }
    } catch {
      // Wait for the service to come up.
    }

    await sleep(HEALTH_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for ${input.label} to respond on ${input.protocol}://${input.host}:${input.port}${input.path}.`,
  );
}

export function terminateChildProcess(
  child: HostedLocalChildProcess,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) {
    return;
  }

  const descendantPids = child.exitCode === null && process.platform !== "win32"
    ? listDescendantProcessIds(child.pid)
    : [];

  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, signal);
    }
  } catch {
    // Ignore process-group errors and fall through to the direct signal.
  }

  for (const pid of descendantPids.reverse()) {
    try {
      process.kill(pid, signal);
    } catch {
      // Ignore already-dead descendants.
    }
  }

  if (child.exitCode === null) {
    try {
      child.kill(signal);
    } catch {
      // Ignore already-dead children.
    }
  }
}

function terminateProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
): void {
  if (process.platform === "win32") {
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch {
    // Ignore missing/already-dead process groups.
  }
}

export async function terminateChildProcessAndWait(
  child: HostedLocalChildProcess,
  input: {
    graceMs?: number;
    signal?: NodeJS.Signals;
  } = {},
): Promise<void> {
  const signal = input.signal ?? "SIGTERM";
  const graceMs = input.graceMs ?? 15_000;
  const processGroupId = process.platform === "win32" ? null : (child.pid ?? null);

  if (child.pid === undefined) {
    return;
  }

  if (child.exitCode === null) {
    await waitForChildExit(child, graceMs, () => {
      terminateChildProcess(child, signal);
    });
  }

  if (child.exitCode !== null) {
    if (processGroupId === null) {
      return;
    }

    const processGroupExited = await waitForProcessGroupExit(processGroupId, graceMs, signal);
    if (processGroupExited) {
      return;
    }
  }

  if (processGroupId !== null) {
    const processGroupExited = await waitForProcessGroupExit(processGroupId, 5_000, "SIGKILL");
    if (processGroupExited) {
      return;
    }
  }

  await waitForChildExit(child, 5_000, () => {
    terminateChildProcess(child, "SIGKILL");
  });
}

async function waitForChildExit(
  child: HostedLocalChildProcess,
  timeoutMs: number,
  terminate: () => void,
): Promise<boolean> {
  if (child.exitCode !== null) {
    return true;
  }

  const exited = new Promise<boolean>((resolve) => {
    child.once("exit", () => resolve(true));
  });
  const timedOut = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
  });

  terminate();
  return await Promise.race([exited, timedOut]);
}

async function waitForProcessGroupExit(
  processGroupId: number,
  timeoutMs: number,
  signal: NodeJS.Signals,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (!isProcessGroupRunning(processGroupId)) {
      return true;
    }

    terminateProcessGroup(processGroupId, signal);
    await sleep(250);
  }

  return !isProcessGroupRunning(processGroupId);
}

export function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function tail(value: string, maxChars: number = 2_000): string {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(value.length - maxChars);
}

async function runBoundedCommand(input: BoundedCommandInput): Promise<BoundedCommandResult> {
  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: string | Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: string | Buffer) => {
    stderr += chunk.toString();
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      if (process.platform !== "win32" && child.pid !== undefined) {
        process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      // Fall through to the direct child kill.
    }

    try {
      child.kill("SIGKILL");
    } catch {
      // Ignore already-dead children.
    }
  }, input.timeoutMs);
  timeout.unref?.();

  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });

    return {
      exitCode,
      stderr,
      stdout,
      timedOut,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function formatBoundedCommandResult(label: string, result: BoundedCommandResult): string {
  if (result.timedOut) {
    return `- ${label}: timed out`;
  }

  const status = result.exitCode === 0
    ? "ok"
    : `exit ${result.exitCode ?? "unknown"}`;
  const stdout = truncateCommandOutput(result.stdout);
  const stderr = truncateCommandOutput(result.stderr);
  const details = [stdout ? `stdout=${stdout}` : null, stderr ? `stderr=${stderr}` : null]
    .filter((value): value is string => value !== null)
    .join(" ");

  return details.length > 0
    ? `- ${label}: ${status} ${details}`
    : `- ${label}: ${status}`;
}

function truncateCommandOutput(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  return normalized.length > 240
    ? `${normalized.slice(0, 237)}...`
    : normalized;
}

function resolveHostedWebDevLockPaths(env: NodeJS.ProcessEnv): {
  lockPath: string;
  metadataPath: string;
} {
  const distDirName = resolveHostedWebDevDistDir(env);
  const lockPath = path.join(webDir, distDirName, ".dev-server.lock");

  return {
    lockPath,
    metadataPath: path.join(lockPath, "owner.json"),
  };
}

function resolveHostedWebDevDistDir(env: NodeJS.ProcessEnv): string {
  const baseDistDir = env.NEXT_DIST_DIR_MODE === "smoke"
    ? HOSTED_WEB_SMOKE_DIST_DIR
    : HOSTED_WEB_DEV_DIST_DIR;
  const configuredSuffix = env.NEXT_DIST_DIR_SUFFIX?.trim();

  if (!configuredSuffix) {
    return baseDistDir;
  }

  const normalizedSuffix = configuredSuffix.toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalizedSuffix)) {
    throw new Error("NEXT_DIST_DIR_SUFFIX must use lowercase letters, digits, and hyphens only.");
  }

  return `${baseDistDir}-${normalizedSuffix}`;
}

async function tryReadTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

function isHostedWebDevServerLockMetadata(value: unknown): value is HostedWebDevServerLockMetadata {
  return Boolean(
    value
    && typeof value === "object"
    && "command" in value
    && "pid" in value
    && "port" in value
    && "startedAt" in value
    && typeof value.command === "string"
    && typeof value.pid === "number"
    && Number.isInteger(value.pid)
    && typeof value.port === "number"
    && Number.isInteger(value.port)
    && typeof value.startedAt === "string",
  );
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ESRCH"
    ) {
      return false;
    }

    return true;
  }
}

function isProcessGroupRunning(processGroupId: number): boolean {
  if (process.platform === "win32") {
    return false;
  }

  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ESRCH"
    ) {
      return false;
    }

    return true;
  }
}

function listDescendantProcessIds(rootPid: number): number[] {
  try {
    const output = execFileSync("ps", ["-axo", "pid=,ppid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const childrenByParent = new Map<number, number[]>();

    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const [pidText, parentPidText] = trimmed.split(/\s+/, 2);
      const pid = Number.parseInt(pidText ?? "", 10);
      const parentPid = Number.parseInt(parentPidText ?? "", 10);

      if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) {
        continue;
      }

      const siblings = childrenByParent.get(parentPid) ?? [];
      siblings.push(pid);
      childrenByParent.set(parentPid, siblings);
    }

    const descendants: number[] = [];
    const queue = [...(childrenByParent.get(rootPid) ?? [])];

    while (queue.length > 0) {
      const pid = queue.shift();
      if (pid === undefined) {
        continue;
      }

      descendants.push(pid);
      queue.push(...(childrenByParent.get(pid) ?? []));
    }

    return descendants;
  } catch {
    return [];
  }
}

async function requestStatus(input: {
  host: string;
  path: string;
  port: number;
  protocol: "http" | "https";
}): Promise<number | undefined> {
  const requestImpl = input.protocol === "https" ? https.request : http.request;

  return await new Promise((resolve, reject) => {
    const req = requestImpl(
      {
        host: input.host,
        method: "GET",
        path: input.path,
        port: input.port,
        rejectUnauthorized: false,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );

    req.setTimeout(HEALTH_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("request timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

function pipeWithPrefix(
  prefix: string,
  stream: NodeJS.ReadableStream | null | undefined,
  target: NodeJS.WritableStream,
  options: { redactor?: (line: string) => string } = {},
): void {
  if (!stream) {
    return;
  }

  const redact = options.redactor ?? ((line: string): string => line);
  let buffer = "";

  stream.on("data", (chunk: string | Buffer) => {
    buffer += chunk.toString();

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }

      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      target.write(`[${prefix}] ${redact(line)}\n`);
    }
  });

  stream.on("end", () => {
    if (buffer.length > 0) {
      target.write(`[${prefix}] ${redact(buffer)}\n`);
      buffer = "";
    }
  });
}

function createOutputBuffer(): {
  append(chunk: string | Buffer): void;
  read(): string;
} {
  let value = "";

  return {
    append(chunk: string | Buffer): void {
      value += chunk.toString();
    },
    read(): string {
      return value;
    },
  };
}

function createLineBufferedSecretRedactor(secret: string): {
  push(chunk: string): string;
  flush(): string;
} {
  let pending = "";
  const redactLine = (text: string): string =>
    text.includes(secret) ? text.split(secret).join("[redacted whsec]") : text;

  return {
    push(chunk: string): string {
      pending += chunk;
      const lastNewline = pending.lastIndexOf("\n");
      if (lastNewline < 0) {
        return "";
      }
      const complete = pending.slice(0, lastNewline + 1);
      pending = pending.slice(lastNewline + 1);
      return redactLine(complete);
    },
    flush(): string {
      const last = pending;
      pending = "";
      return redactLine(last);
    },
  };
}
