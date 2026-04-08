import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createHostedRuntimeChildLauncherDirectories,
  createHostedRuntimeChildProcessEnv,
  resolveHostedRuntimeTsxImportSpecifier,
} from "@murphai/assistant-runtime";

import {
  parseHostedRunnerSmokeInput,
  parseHostedRunnerSmokeResult,
  type HostedRunnerSmokeResult,
} from "./hosted-runner-smoke-contract.js";

export async function runHostedRunnerSmokeDetailed(input: unknown): Promise<HostedRunnerSmokeResult> {
  const smokeInput = parseHostedRunnerSmokeInput(input);
  const launcherRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-smoke-launch-"));

  try {
    const launcherDirectories = await createHostedRuntimeChildLauncherDirectories(launcherRoot);
    const childEntry = resolveHostedRunnerSmokeChildEntry();
    const isTypeScriptChild = childEntry.endsWith(".ts");
    const child = spawn(
      process.execPath,
      isTypeScriptChild
        ? ["--import", resolveHostedRuntimeTsxImportSpecifier(), childEntry]
        : [childEntry],
      {
        cwd: launcherRoot,
        detached: process.platform !== "win32",
        env: createHostedRuntimeChildProcessEnv({
          forwardedEnv: readHostedNativeToolEnv(),
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

      if (code !== 0) {
        throw new Error(
          stderrChunks.join("").trim()
          || `Hosted runner smoke child exited with code ${code ?? "unknown"}.`,
        );
      }

      return parseHostedRunnerSmokeResult(JSON.parse(stdoutChunks.join("")));
    } finally {
      terminateChildProcess(child.pid);
    }
  } finally {
    await rm(launcherRoot, { force: true, recursive: true });
  }
}

function readHostedNativeToolEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of [
    "FFMPEG_COMMAND",
    "PDFTOTEXT_COMMAND",
    "WHISPER_COMMAND",
    "WHISPER_MODEL_PATH",
  ] as const) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }

  return env;
}

async function main(): Promise<void> {
  const result = await runHostedRunnerSmokeDetailed(JSON.parse(await readStandardInput()) as unknown);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function resolveHostedRunnerSmokeChildEntry(): string {
  const builtPath = fileURLToPath(new URL("./hosted-runner-smoke-child.js", import.meta.url));

  if (existsSync(builtPath)) {
    return builtPath;
  }

  return fileURLToPath(new URL("./hosted-runner-smoke-child.ts", import.meta.url));
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
