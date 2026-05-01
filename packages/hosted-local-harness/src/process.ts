import { spawn, spawnSync } from "node:child_process";

export interface ForegroundCommandInput {
  args: readonly string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  label: string;
}

export async function runForegroundCommand(
  input: ForegroundCommandInput,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `${input.label} exited with signal ${signal}.`
            : `${input.label} exited with code ${code ?? "unknown"}.`,
        ),
      );
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
