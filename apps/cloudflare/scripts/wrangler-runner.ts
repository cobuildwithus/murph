import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

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
  const child = spawnWranglerProcess(wranglerArgs, {
    cwd: options.cwd,
    env: resolveWranglerEnv(options.envOverrides),
    stdio: "inherit",
  });

  await waitForWranglerExit(child, wranglerArgs);
}

export async function runWranglerLoggedCaptured(
  wranglerArgs: string[],
  options: {
    cwd?: string;
    envOverrides?: Record<string, string>;
  } = {},
): Promise<{ stderr: string; stdout: string }> {
  const child = spawnWranglerProcess(wranglerArgs, {
    cwd: options.cwd,
    env: resolveWranglerEnv(options.envOverrides),
    stdio: ["inherit", "pipe", "pipe"],
  });
  const stdoutStream = child.stdout;
  const stderrStream = child.stderr;

  if (!stdoutStream || !stderrStream) {
    throw new Error("wrangler captured runner requires piped stdout and stderr streams.");
  }

  let stdout = "";
  let stderr = "";
  stdoutStream.setEncoding("utf8");
  stdoutStream.on("data", (chunk: string) => {
    stdout += chunk;
    process.stdout.write(chunk);
  });
  stderrStream.setEncoding("utf8");
  stderrStream.on("data", (chunk: string) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });

  await waitForWranglerExit(child, wranglerArgs);
  return { stderr, stdout };
}

export async function runWranglerJson(
  wranglerArgs: string[],
  options: {
    cwd?: string;
  } = {},
): Promise<string> {
  const child = spawnWranglerProcess(wranglerArgs, {
    cwd: options.cwd,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  const stdoutStream = child.stdout;
  const stderrStream = child.stderr;

  if (!stdoutStream || !stderrStream) {
    throw new Error("wrangler json runner requires piped stdout and stderr streams.");
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

  await waitForWranglerExit(child, wranglerArgs, () => stderr);
  return stdout.trim();
}

function spawnWranglerProcess(
  wranglerArgs: string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    stdio: SpawnOptions["stdio"];
  },
) {
  return spawn(resolvePnpmCommand(), ["exec", "wrangler", ...wranglerArgs], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env,
    stdio: options.stdio,
  });
}

async function waitForWranglerExit(
  child: ChildProcess,
  wranglerArgs: string[],
  readStderr: () => string = () => "",
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(createWranglerExitError(wranglerArgs, code, readStderr()));
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
