import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import process from "node:process";

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
  HostedWebDevServerLockMetadata,
  NamedChildProcess,
} from "./types.ts";

interface SetupCommandInput {
  cwd: string;
  env: NodeJS.ProcessEnv;
  name: "setup";
}

export async function assertHostedWebDevServerAvailable(env: NodeJS.ProcessEnv): Promise<void> {
  const lockPaths = resolveHostedWebDevLockPaths(env);
  const rawMetadata = await tryReadTextFile(lockPaths.metadataPath);

  if (rawMetadata === null) {
    return;
  }

  let metadata: unknown;

  try {
    metadata = JSON.parse(rawMetadata) as unknown;
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
  name: "cloudflare" | "web",
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): NamedChildProcess {
  const child = spawn(command, args, {
    cwd: repoRoot,
    detached: process.platform !== "win32",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  pipeWithPrefix(name, child.stdout, process.stdout);
  pipeWithPrefix(name, child.stderr, process.stderr);

  return { child, name };
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

export function terminateChildProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.pid === undefined) {
    return;
  }

  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, signal);
    }
  } catch {
    // Ignore process-group errors and fall through to the direct signal.
  }

  try {
    child.kill(signal);
  } catch {
    // Ignore already-dead children.
  }
}

export function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function resolveHostedWebDevLockPaths(env: NodeJS.ProcessEnv): {
  lockPath: string;
  metadataPath: string;
} {
  const distDirName = env.NEXT_DIST_DIR_MODE === "smoke"
    ? HOSTED_WEB_SMOKE_DIST_DIR
    : HOSTED_WEB_DEV_DIST_DIR;
  const lockPath = path.join(webDir, distDirName, ".dev-server.lock");

  return {
    lockPath,
    metadataPath: path.join(lockPath, "owner.json"),
  };
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
  target: NodeJS.WriteStream,
): void {
  if (!stream) {
    return;
  }

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
      target.write(`[${prefix}] ${line}\n`);
    }
  });

  stream.on("end", () => {
    if (buffer.length > 0) {
      target.write(`[${prefix}] ${buffer}\n`);
      buffer = "";
    }
  });
}
