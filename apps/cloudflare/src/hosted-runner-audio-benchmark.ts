import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  decodeHostedBundleBase64,
  restoreHostedExecutionContext,
} from "@murphai/runtime-state/node";
import {
  createConfiguredParserRegistry,
  parseAttachment,
  type ParserArtifactRef,
} from "@murphai/parsers";

import {
  HOSTED_RUNNER_AUDIO_BENCHMARK_SCHEMA,
  parseHostedRunnerAudioBenchmarkInput,
  type HostedRunnerAudioBenchmarkCgroupSnapshot,
  type HostedRunnerAudioBenchmarkResult,
} from "./hosted-runner-audio-benchmark-contract.js";
import {
  createHostedRunnerNativeParserToolchain,
} from "./runner-native-parser-toolchain.ts";

const execFileAsync = promisify(execFile);
const SOURCE_MIME = "audio/mp4";

async function main(): Promise<void> {
  const input = parseHostedRunnerAudioBenchmarkInput(parseJsonValue(await readStandardInput()));
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "hosted-runner-audio-benchmark-"));
  const totalStartedAt = nowMs();

  try {
    const bundle = decodeHostedBundleBase64(input.bundle);
    if (!bundle) {
      throw new Error("Hosted runner audio benchmark input bundle must decode to bytes.");
    }

    const restored = await restoreHostedExecutionContext({
      bundle,
      workspaceRoot,
    });
    const nativeToolchain = createHostedRunnerNativeParserToolchain();
    const ffmpegCommand = nativeToolchain.tools.ffmpeg?.command;
    const whisperCommand = nativeToolchain.tools.whisper?.command;
    const whisperModelPath = nativeToolchain.tools.whisper?.modelPath;

    if (!ffmpegCommand) {
      throw new Error("Hosted runner audio benchmark requires an ffmpeg command.");
    }
    if (!whisperCommand || !whisperModelPath) {
      throw new Error("Hosted runner audio benchmark requires whisper.cpp command and model paths.");
    }

    const sourceWavPath = path.join(restored.vaultRoot, input.wavRelativePath);
    const benchmarkRoot = path.join(workspaceRoot, "audio-benchmark");
    await mkdir(benchmarkRoot, { recursive: true });
    const mp4Path = path.join(benchmarkRoot, "voice-memo-65s.m4a");

    const fixtureEncodeMs = await timeMs(async () => {
      await runCommand(ffmpegCommand, [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-stream_loop",
        "-1",
        "-i",
        sourceWavPath,
        "-t",
        formatDurationSeconds(input.targetDurationSeconds),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        mp4Path,
      ]);
    });

    const sourceBytes = (await stat(mp4Path)).size;
    const cgroupBefore = await readCgroupSnapshot();
    const artifact: ParserArtifactRef = {
      absolutePath: mp4Path,
      attachmentId: "att_hosted_runner_audio_benchmark",
      byteSize: sourceBytes,
      captureId: "cap_hosted_runner_audio_benchmark",
      fileName: "voice-memo-65s.m4a",
      kind: "audio",
      mime: SOURCE_MIME,
      storedPath: "raw/benchmark/voice-memo-65s.m4a",
    };
    const parserConfig = await createConfiguredParserRegistry({
      allowEnvToolchain: false,
      allowSystemToolchainLookup: false,
      readVaultToolchainConfig: false,
      toolchain: {
        source: "platform",
        tools: nativeToolchain.tools,
      },
      vaultRoot: restored.vaultRoot,
    });
    const parserScratchRoot = path.join(benchmarkRoot, "parser");
    const parsed = await timeValueMs(() =>
      parseAttachment({
        artifact,
        ffmpeg: parserConfig.ffmpeg,
        registry: parserConfig.registry,
        scratchRoot: parserScratchRoot,
      })
    );
    const providerId = parsed.value.providerId;
    const transcript = parsed.value.output.text.trim();

    if (providerId !== "whisper.cpp") {
      throw new Error(`Hosted runner audio benchmark expected whisper.cpp, got ${providerId}.`);
    }
    if (transcript.length === 0) {
      throw new Error("Hosted runner audio benchmark transcript was empty.");
    }

    const transcriptMatchesExpectedSnippet = input.expectedTranscriptSnippet
      ? transcript.toLowerCase().includes(input.expectedTranscriptSnippet.toLowerCase())
      : true;
    if (!transcriptMatchesExpectedSnippet) {
      throw new Error("Hosted runner audio benchmark transcript did not include the expected snippet.");
    }

    const cgroupAfter = await readCgroupSnapshot();
    const result: HostedRunnerAudioBenchmarkResult = {
      audioDurationSeconds: input.targetDurationSeconds,
      cgroupAfter,
      cgroupBefore,
      fixtureEncodeMs,
      parseAttachmentMs: parsed.elapsedMs,
      parsedMetadataDurationMs: parsed.value.output.metadata.durationMs ?? null,
      processMaxRssKb: process.resourceUsage().maxRSS,
      providerId: "whisper.cpp",
      schema: HOSTED_RUNNER_AUDIO_BENCHMARK_SCHEMA,
      sourceBytes,
      sourceMime: SOURCE_MIME,
      totalMs: nowMs() - totalStartedAt,
      transcriptChars: transcript.length,
      transcriptMatchesExpectedSnippet,
      transcriptSha256: sha256Hex(transcript),
    };

    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

async function runCommand(file: string, args: string[]): Promise<void> {
  await execFileAsync(file, args, {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function readCgroupSnapshot(): Promise<HostedRunnerAudioBenchmarkCgroupSnapshot> {
  return {
    cpuMax: await readOptionalText("/sys/fs/cgroup/cpu.max"),
    cpusetCpusEffective: await readOptionalText("/sys/fs/cgroup/cpuset.cpus.effective"),
    memoryCurrentBytes: parseCgroupNumber(await readOptionalText("/sys/fs/cgroup/memory.current")),
    memoryLimitBytes: parseCgroupNumber(await readOptionalText("/sys/fs/cgroup/memory.max")),
    memoryPeakBytes: parseCgroupNumber(await readOptionalText("/sys/fs/cgroup/memory.peak")),
  };
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    const value = (await readFile(filePath, "utf8")).trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function parseCgroupNumber(value: string | null): number | null {
  if (!value || value === "max") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function timeMs(fn: () => Promise<void>): Promise<number> {
  const startedAt = nowMs();
  await fn();
  return nowMs() - startedAt;
}

async function timeValueMs<T>(fn: () => Promise<T>): Promise<{ elapsedMs: number; value: T }> {
  const startedAt = nowMs();
  const value = await fn();
  return {
    elapsedMs: nowMs() - startedAt,
    value,
  };
}

function nowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function formatDurationSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function parseJsonValue(value: string): unknown {
  return JSON.parse(value);
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
