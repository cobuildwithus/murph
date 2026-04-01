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

    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;

    if (!stdoutStream || !stderrStream) {
      reject(new Error("wrangler json runner requires piped stdout and stderr streams."));
      return;
    }

    let stdout = "";
    let stderr = "";

    stdoutStream.setEncoding("utf8");
    stdoutStream.on("data", (chunk) => {
      stdout += chunk;
    });
    stderrStream.setEncoding("utf8");
    stderrStream.on("data", (chunk) => {
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
