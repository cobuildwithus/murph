import { spawn, spawnSync } from "node:child_process";

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
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
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
    for (const signal of input.forwardProcessSignals ?? []) {
      const handler = (): void => {
        child.kill(signal);
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
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
      settled = true;
      cleanupSignalHandlers();
      if (code === 0) {
        resolve();
        return;
      }
      reject(signal
        ? new ForegroundCommandSignalError(input.label, signal)
        : new Error(`${input.label} exited with code ${code ?? "unknown"}.`));
    });
  });
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
