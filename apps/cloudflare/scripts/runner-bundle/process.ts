import { spawn } from "node:child_process";

import { resolvePnpmCommand } from "../wrangler-runner.js";

function resolveNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export async function runPnpmCommand(
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await runProcess(resolvePnpmCommand(), args, options);
}

export async function runNpmCommand(
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await runProcess(resolveNpmCommand(), args, options);
}

async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}
