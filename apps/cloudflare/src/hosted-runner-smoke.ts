import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  projectHostedRuntimeToChildEnv,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import {
  parseHostedRunnerSmokeInput,
  parseHostedRunnerSmokeResult,
  type HostedRunnerSmokeResult,
} from "./hosted-runner-smoke-contract.js";
export async function runHostedRunnerSmokeDetailed(input: unknown): Promise<HostedRunnerSmokeResult> {
  const smokeInput = parseHostedRunnerSmokeInput(input);
  const launcherRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-smoke-launch-"));

  try {
    const launcherDirectories = await createHostedRunnerSmokeLauncherDirectories(launcherRoot);
    const childEntry = resolveHostedRunnerSmokeChildEntry();
    const isTypeScriptChild = childEntry.endsWith(".ts");
    const child = spawn(
      process.execPath,
      isTypeScriptChild
        ? ["--import", resolveHostedRunnerTsxImportSpecifier(), childEntry]
        : [childEntry],
      {
        cwd: launcherRoot,
        detached: process.platform !== "win32",
        env: createHostedRunnerSmokeProcessEnv({
          forwardedEnv: {},
          isTypeScriptChild,
          launcherDirectories,
        }),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    child.stdout.on("data", (chunk: string) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderrChunks.push(chunk);
    });

    try {
      child.stdin.end(JSON.stringify(smokeInput));
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");

      if (code !== 0) {
        throw new Error(
          `Hosted runner smoke child exited with code ${code ?? "unknown"}. stdoutBytes=${Buffer.byteLength(stdout, "utf8")} stderrBytes=${Buffer.byteLength(stderr, "utf8")}`,
        );
      }

      return parseHostedRunnerSmokeResult(parseJsonValue(stdout, "Hosted runner smoke child stdout"));
    } finally {
      terminateChildProcess(child.pid);
    }
  } finally {
    await rm(launcherRoot, { force: true, recursive: true });
  }
}

async function main(): Promise<void> {
  const result = await runHostedRunnerSmokeDetailed(
    parseJsonValue(await readStandardInput(), "Hosted runner smoke stdin"),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new SyntaxError(
      `${label} was not valid JSON. bytes=${Buffer.byteLength(value, "utf8")}`,
    );
  }
}

function resolveHostedRunnerSmokeChildEntry(): string {
  const builtPath = fileURLToPath(new URL("./hosted-runner-smoke-child.js", import.meta.url));

  if (existsSync(builtPath)) {
    return builtPath;
  }

  return fileURLToPath(new URL("./hosted-runner-smoke-child.ts", import.meta.url));
}

interface HostedRunnerSmokeLauncherDirectories {
  cacheRoot: string;
  homeRoot: string;
  huggingFaceRoot: string;
  tempRoot: string;
}

async function createHostedRunnerSmokeLauncherDirectories(
  launcherRoot: string,
): Promise<HostedRunnerSmokeLauncherDirectories> {
  const directories = {
    cacheRoot: path.join(launcherRoot, "cache"),
    homeRoot: path.join(launcherRoot, "home"),
    huggingFaceRoot: path.join(launcherRoot, "hf-home"),
    tempRoot: path.join(launcherRoot, "tmp"),
  } satisfies HostedRunnerSmokeLauncherDirectories;

  await Promise.all(
    Object.values(directories).map((directory) => mkdir(directory, { recursive: true })),
  );

  return directories;
}

function createHostedRunnerSmokeProcessEnv(input: {
  ambientEnv?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Record<string, string>;
  isTypeScriptChild: boolean;
  launcherDirectories: HostedRunnerSmokeLauncherDirectories;
}): Record<string, string> {
  const ambientEnv = input.ambientEnv ?? process.env;
  const env = projectHostedRuntimeToChildEnv({
    ambientEnv,
    forwardedEnv: input.forwardedEnv,
    platformTransportEnv: ambientEnv,
  });

  Object.assign(env, {
    HF_HOME: input.launcherDirectories.huggingFaceRoot,
    HOME: input.launcherDirectories.homeRoot,
    TEMP: input.launcherDirectories.tempRoot,
    TMP: input.launcherDirectories.tempRoot,
    TMPDIR: input.launcherDirectories.tempRoot,
    XDG_CACHE_HOME: input.launcherDirectories.cacheRoot,
  });

  if (input.isTypeScriptChild) {
    env.TSX_TSCONFIG_PATH = fileURLToPath(new URL("../../../tsconfig.base.json", import.meta.url));
  }

  return env;
}

function resolveHostedRunnerTsxImportSpecifier(
  moduleRequire: NodeJS.Require = createRequire(import.meta.url),
): string {
  try {
    return pathToFileURL(moduleRequire.resolve("tsx")).href;
  } catch {
    return "tsx";
  }
}

function terminateChildProcess(pid: number | undefined): void {
  if (typeof pid !== "number" || process.platform === "win32") {
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // best-effort cleanup only
  }
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
