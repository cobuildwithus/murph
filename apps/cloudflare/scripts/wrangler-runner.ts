import { spawn } from "node:child_process";

export function resolvePnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export async function runWranglerLogged(
  wranglerArgs: string[],
  options: {
    cwd?: string;
    envOverrides?: Record<string, string>;
  } = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolvePnpmCommand(), ["exec", "wrangler", ...wranglerArgs], {
      cwd: options.cwd ?? process.cwd(),
      env: resolveWranglerEnv(options.envOverrides),
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(createWranglerExitError(wranglerArgs, code));
    });
  });
}

export async function runWranglerJson(
  wranglerArgs: string[],
  options: {
    cwd?: string;
  } = {},
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(resolvePnpmCommand(), ["exec", "wrangler", ...wranglerArgs], {
      cwd: options.cwd ?? process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk) => {
      stderr += chunk;
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(createWranglerExitError(wranglerArgs, code, stderr));
    });
  });
}

function resolveWranglerEnv(envOverrides?: Record<string, string>): NodeJS.ProcessEnv {
  if (!envOverrides || Object.keys(envOverrides).length === 0) {
    return process.env;
  }

  return {
    ...process.env,
    ...envOverrides,
  };
}

function createWranglerExitError(
  wranglerArgs: string[],
  code: number | null,
  stderr = "",
): Error {
  const trimmedStderr = stderr.trim();
  return new Error(
    `wrangler ${wranglerArgs.join(" ")} exited with code ${code ?? "unknown"}.${
      trimmedStderr.length > 0 ? ` ${trimmedStderr}` : ""
    }`,
  );
}
