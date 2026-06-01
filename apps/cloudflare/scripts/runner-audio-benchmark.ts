import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  encodeHostedBundleBase64,
  snapshotHostedExecutionContextUnsafeForFixture,
} from "@murphai/runtime-state/node";

import {
  parseHostedRunnerAudioBenchmarkResult,
} from "../src/hosted-runner-audio-benchmark-contract.js";
import {
  removeHostedRunnerFinalImageBestEffort,
} from "./local-runner-docker-cleanup.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");

const FIXTURE_VAULT_ROOT = path.join(repoRoot, "fixtures", "demo-web-vault");
const IMAGE_TAG = "murph-cloudflare-runner";
const SMOKE_BUNDLE_DIR = path.join(appDir, ".deploy", "runner-smoke-bundle");
const TARGET_DURATION_SECONDS = readPositiveNumberEnv(
  process.env.MURPH_RUNNER_AUDIO_BENCHMARK_SECONDS,
) ?? 65;
const DOCKER_CPUS = process.env.MURPH_RUNNER_AUDIO_BENCHMARK_CPUS ?? "1";
const DOCKER_MEMORY = process.env.MURPH_RUNNER_AUDIO_BENCHMARK_MEMORY ?? "3072m";
const WAV_RELATIVE_PATH = "raw/smoke/hosted-runner.wav";
const EXPECTED_TRANSCRIPT_SNIPPET = "hello";

async function main(): Promise<void> {
  try {
    const snapshot = await snapshotHostedExecutionContextUnsafeForFixture({
      vaultRoot: FIXTURE_VAULT_ROOT,
    });
    const bundle = encodeHostedBundleBase64(snapshot.bundle);

    if (!bundle) {
      throw new Error("Could not encode the hosted runner audio benchmark fixture bundle.");
    }

    const dockerWallStartedAt = Date.now();
    const output = await runDockerCommand([
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--interactive",
      "--network",
      "none",
      "--cpus",
      DOCKER_CPUS,
      "--memory",
      DOCKER_MEMORY,
      "--entrypoint",
      "node",
      IMAGE_TAG,
      "dist/hosted-runner-audio-benchmark.js",
    ], JSON.stringify({
      bundle,
      expectedTranscriptSnippet: EXPECTED_TRANSCRIPT_SNIPPET,
      targetDurationSeconds: TARGET_DURATION_SECONDS,
      wavRelativePath: WAV_RELATIVE_PATH,
    }));
    const dockerWallMs = Date.now() - dockerWallStartedAt;
    const result = parseHostedRunnerAudioBenchmarkResult(parseJsonValue(
      output,
      "Docker runner audio benchmark stdout",
    ));

    console.log("Hosted runner audio benchmark passed.");
    console.log(`targetDurationSeconds=${result.audioDurationSeconds}`);
    console.log(`dockerRequestedCpus=${DOCKER_CPUS}`);
    console.log(`dockerRequestedMemory=${DOCKER_MEMORY}`);
    console.log(`cgroupCpuMax=${result.cgroupAfter.cpuMax ?? "unknown"}`);
    console.log(`cgroupCpusetCpusEffective=${result.cgroupAfter.cpusetCpusEffective ?? "unknown"}`);
    console.log(`cgroupMemoryLimitBytes=${formatNullableNumber(result.cgroupAfter.memoryLimitBytes)}`);
    console.log(`cgroupMemoryCurrentBeforeBytes=${formatNullableNumber(result.cgroupBefore.memoryCurrentBytes)}`);
    console.log(`cgroupMemoryCurrentAfterBytes=${formatNullableNumber(result.cgroupAfter.memoryCurrentBytes)}`);
    console.log(`cgroupMemoryPeakBytes=${formatNullableNumber(result.cgroupAfter.memoryPeakBytes)}`);
    console.log(`processMaxRssKb=${result.processMaxRssKb}`);
    console.log(`sourceMime=${result.sourceMime}`);
    console.log(`sourceBytes=${result.sourceBytes}`);
    console.log(`fixtureEncodeMs=${Math.round(result.fixtureEncodeMs)}`);
    console.log(`parseAttachmentMs=${Math.round(result.parseAttachmentMs)}`);
    console.log(`parsedMetadataDurationMs=${formatNullableNumber(result.parsedMetadataDurationMs)}`);
    console.log(`containerTotalMs=${Math.round(result.totalMs)}`);
    console.log(`dockerWallMs=${dockerWallMs}`);
    console.log(`transcriptChars=${result.transcriptChars}`);
    console.log(`transcriptSha256=${result.transcriptSha256}`);
    console.log(`transcriptMatchesExpectedSnippet=${result.transcriptMatchesExpectedSnippet}`);
    console.log(`providerId=${result.providerId}`);
  } finally {
    await rm(SMOKE_BUNDLE_DIR, { force: true, recursive: true });
    await removeHostedRunnerFinalImageBestEffort();
  }
}

async function runDockerCommand(args: string[], stdinText: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: appDir,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `docker runner audio benchmark exited with code ${code ?? "unknown"}. stdoutBytes=${Buffer.byteLength(stdout, "utf8")} stderrBytes=${Buffer.byteLength(stderr, "utf8")}`,
          ),
        );
        return;
      }

      resolve(stdout.trim());
    });
    child.stdin.end(stdinText);
  });
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

function readPositiveNumberEnv(value: string | undefined): number | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TypeError("MURPH_RUNNER_AUDIO_BENCHMARK_SECONDS must be a positive number.");
  }

  return parsed;
}

function formatNullableNumber(value: number | null): string {
  return typeof value === "number" ? String(value) : "unknown";
}

await main();
