import { spawn, spawnSync } from "node:child_process";

const defaultForegroundSignals = process.platform === "win32"
  ? (["SIGINT", "SIGTERM"] as const)
  : (["SIGINT", "SIGTERM", "SIGHUP"] as const);
const processGroupPollIntervalMs = 25;

export interface OwnedChildProcess {
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  pid?: number;
  signalCode?: NodeJS.Signals | null;
}

interface OwnedChildProcessTerminationOptions {
  forceMs?: number;
  graceMs?: number;
  signal?: NodeJS.Signals;
}

export interface ForegroundCommandInput {
  args: readonly string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  forwardProcessSignals?: readonly NodeJS.Signals[];
  label: string;
}

export class ForegroundCommandSignalError extends Error {
  readonly commandSignal: NodeJS.Signals;

  constructor(label: string, signal: NodeJS.Signals) {
    super(`${label} exited with signal ${signal}.`);
    this.name = "ForegroundCommandSignalError";
    this.commandSignal = signal;
  }
}

export async function runForegroundCommand(
  input: ForegroundCommandInput,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let interruptedCleanup: Promise<void> | null = null;
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      detached: process.platform !== "win32",
      env: input.env,
      stdio: "inherit",
    });

    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const cleanupSignalHandlers = (): void => {
      for (const [signal, handler] of signalHandlers) {
        process.off(signal, handler);
      }
      signalHandlers.clear();
    };
    for (const signal of input.forwardProcessSignals ?? defaultForegroundSignals) {
      const handler = (): void => {
        if (settled || interruptedCleanup) {
          return;
        }
        const promise = terminateOwnedChildProcessAndWait(child, { signal });
        interruptedCleanup = promise;
        void promise.then(
          () => {
            if (settled) {
              return;
            }
            settled = true;
            cleanupSignalHandlers();
            reject(new ForegroundCommandSignalError(input.label, signal));
          },
          (error: unknown) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanupSignalHandlers();
            reject(error);
          },
        );
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupSignalHandlers();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) {
        return;
      }
      if (interruptedCleanup) {
        return;
      }
      settled = true;
      cleanupSignalHandlers();
      void terminateOwnedChildProcessAndWait(child).then(() => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(signal
          ? new ForegroundCommandSignalError(input.label, signal)
          : new Error(`${input.label} exited with code ${code ?? "unknown"}.`));
      }, reject);
    });
  });
}

export function signalOwnedChildProcess(
  child: OwnedChildProcess,
  signal: NodeJS.Signals,
): void {
  const processGroupId = resolveOwnedProcessGroupId(child);
  if (processGroupId !== null && signalProcessGroup(processGroupId, signal) === "sent") {
    return;
  }

  if (!hasChildExited(child)) {
    try {
      child.kill(signal);
    } catch {
      // The retained child may have exited between the state check and signal.
    }
  }
}

export async function terminateOwnedChildProcessAndWait(
  child: OwnedChildProcess,
  input: OwnedChildProcessTerminationOptions = {},
): Promise<void> {
  const signal = input.signal ?? "SIGTERM";
  const graceMs = input.graceMs ?? 5_000;
  const forceMs = input.forceMs ?? 5_000;
  const processGroupId = resolveOwnedProcessGroupId(child);

  if (processGroupId !== null) {
    if (!isProcessGroupRunning(processGroupId)) {
      if (!hasChildExited(child)) {
        await terminateDirectChildAndWait(child, { forceMs, graceMs, signal });
      }
      return;
    }

    const gracefulResult = signalProcessGroup(processGroupId, signal);
    if (gracefulResult === "missing") {
      return;
    }
    if (gracefulResult === "failed" && !hasChildExited(child)) {
      await terminateDirectChildAndWait(child, { forceMs, graceMs, signal });
      return;
    }
    if (await waitForProcessGroupExit(processGroupId, graceMs)) {
      return;
    }

    const forceResult = signalProcessGroup(processGroupId, "SIGKILL");
    if (forceResult === "missing") {
      return;
    }
    await waitForProcessGroupExit(processGroupId, forceMs);
    return;
  }

  await terminateDirectChildAndWait(child, { forceMs, graceMs, signal });
}

function resolveOwnedProcessGroupId(child: OwnedChildProcess): number | null {
  return process.platform !== "win32"
    && typeof child.pid === "number"
    && child.pid > 0
    ? child.pid
    : null;
}

function signalProcessGroup(
  processGroupId: number,
  signal: NodeJS.Signals,
): "failed" | "missing" | "sent" {
  try {
    process.kill(-processGroupId, signal);
    return "sent";
  } catch (error) {
    return isMissingProcessError(error) ? "missing" : "failed";
  }
}

function isProcessGroupRunning(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return !isMissingProcessError(error);
  }
}

async function waitForProcessGroupExit(
  processGroupId: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessGroupRunning(processGroupId)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return false;
    }
    await sleep(Math.min(processGroupPollIntervalMs, remainingMs));
  }
  return true;
}

async function terminateDirectChildAndWait(
  child: OwnedChildProcess,
  input: Required<OwnedChildProcessTerminationOptions>,
): Promise<void> {
  if (hasChildExited(child)) {
    return;
  }

  try {
    child.kill(input.signal);
  } catch {
    return;
  }
  if (await waitForChildExit(child, input.graceMs)) {
    return;
  }

  try {
    child.kill("SIGKILL");
  } catch {
    return;
  }
  await waitForChildExit(child, input.forceMs);
}

async function waitForChildExit(
  child: OwnedChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (hasChildExited(child)) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (exited: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(exited);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", () => finish(true));
  });
}

function hasChildExited(child: OwnedChildProcess): boolean {
  return child.exitCode !== null || (child.signalCode ?? null) !== null;
}

function isMissingProcessError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ESRCH",
  );
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export interface DoctorCommandResult {
  command: string;
  ok: boolean;
  stderr: string;
  stdout: string;
}

export function runDoctorCommand(
  command: string,
  args: readonly string[],
): DoctorCommandResult {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    command: [command, ...args].join(" "),
    ok: result.status === 0,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}
