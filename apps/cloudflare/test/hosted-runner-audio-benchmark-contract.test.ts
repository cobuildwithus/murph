import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  HOSTED_RUNNER_AUDIO_BENCHMARK_SCHEMA,
  parseHostedRunnerAudioBenchmarkInput,
  parseHostedRunnerAudioBenchmarkResult,
} from "../src/hosted-runner-audio-benchmark-contract.js";

const validCgroupSnapshot = {
  cpuMax: "100000 100000",
  cpusetCpusEffective: "0-3",
  memoryCurrentBytes: 200_000_000,
  memoryLimitBytes: 3_221_225_472,
  memoryPeakBytes: 450_000_000,
} as const;

const validAudioBenchmarkResult = {
  audioDurationSeconds: 65,
  cgroupAfter: validCgroupSnapshot,
  cgroupBefore: validCgroupSnapshot,
  fixtureEncodeMs: 480,
  parseAttachmentMs: 64_000,
  parsedMetadataDurationMs: 65_000,
  processMaxRssKb: 210_000,
  providerId: "whisper.cpp",
  schema: HOSTED_RUNNER_AUDIO_BENCHMARK_SCHEMA,
  sourceBytes: 520_000,
  sourceMime: "audio/mp4",
  totalMs: 65_000,
  transcriptChars: 128,
  transcriptMatchesExpectedSnippet: true,
  transcriptSha256: "a".repeat(64),
} as const;

describe("parseHostedRunnerAudioBenchmarkInput", () => {
  it("accepts the benchmark input and defaults to 65 seconds", () => {
    expect(parseHostedRunnerAudioBenchmarkInput({
      bundle: "bundle-base64",
      expectedTranscriptSnippet: "hello",
      wavRelativePath: "raw/smoke/hosted-runner.wav",
    })).toEqual({
      bundle: "bundle-base64",
      expectedTranscriptSnippet: "hello",
      targetDurationSeconds: 65,
      wavRelativePath: "raw/smoke/hosted-runner.wav",
    });
  });

  it("rejects empty required strings", () => {
    expect(() => parseHostedRunnerAudioBenchmarkInput({
      bundle: "",
      expectedTranscriptSnippet: null,
      wavRelativePath: "raw/smoke/hosted-runner.wav",
    })).toThrow("Hosted runner audio benchmark input.bundle must be a non-empty string.");
  });
});

describe("parseHostedRunnerAudioBenchmarkResult", () => {
  it("accepts the metadata-only benchmark result shape", () => {
    expect(parseHostedRunnerAudioBenchmarkResult(validAudioBenchmarkResult)).toMatchObject({
      audioDurationSeconds: 65,
      parseAttachmentMs: 64_000,
      parsedMetadataDurationMs: 65_000,
      providerId: "whisper.cpp",
      schema: HOSTED_RUNNER_AUDIO_BENCHMARK_SCHEMA,
      sourceMime: "audio/mp4",
      transcriptChars: 128,
      transcriptSha256: "a".repeat(64),
    });
  });

  it("rejects raw transcript-shaped output and provider drift", () => {
    expect(() => parseHostedRunnerAudioBenchmarkResult({
      ...validAudioBenchmarkResult,
      transcriptSha256: "hello from the transcript",
    })).toThrow(
      "Hosted runner audio benchmark result.transcriptSha256 must be a SHA-256 hex string.",
    );

    expect(() => parseHostedRunnerAudioBenchmarkResult({
      ...validAudioBenchmarkResult,
      providerId: "other",
    })).toThrow("Hosted runner audio benchmark result.providerId must be whisper.cpp.");
  });

  it("rejects unexpected fields", () => {
    expect(() => parseHostedRunnerAudioBenchmarkResult({
      ...validAudioBenchmarkResult,
      transcriptText: "hello",
    })).toThrow("Hosted runner audio benchmark result contains unexpected key: transcriptText.");
  });
});

describe("runner audio benchmark package wiring", () => {
  it("exposes an explicit opt-in final-image benchmark command", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["runner:docker:audio-benchmark"]).toContain(
      "runner:docker:smoke:image",
    );
    expect(packageJson.scripts["runner:docker:audio-benchmark"]).toContain(
      "runner:docker:audio-benchmark:built",
    );
    expect(packageJson.scripts["runner:docker:audio-benchmark:built"]).toContain(
      "apps/cloudflare/scripts/runner-audio-benchmark.ts",
    );
  });
});
