import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  restoreEncryptedWorkspaceSnapshotFromEncryptedStream,
} from "../src/workspace-snapshot-local.js";
import {
  createAuthenticatedTarSnapshotFixture,
  type TestTarEntry,
} from "../test/support/workspace-snapshot-fixtures.js";

const ENTRY_CEILING = 20_000;
const WARMUP_PAIR_COUNT = 2;
const SAMPLE_PAIR_COUNT = 7;

type BenchmarkPayload =
  | {
    fileCount: typeof ENTRY_CEILING;
    kind: "entry-ceiling";
    name: "entry-ceiling-20000-files";
    totalPlainBytes: 0;
  }
  | {
    fileCount: 1;
    kind: "large-plain-bytes";
    name: "large-plain-bytes-warning-threshold";
    totalPlainBytes: typeof HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES;
  };

interface AuthenticatedBenchmarkFixture {
  compressedArchive: Buffer;
  dataKey: Uint8Array;
  encryptedBytes: Buffer;
  payload: BenchmarkPayload;
  ref: HostedWorkspaceSnapshotV2Ref;
}

interface SamplePair {
  controlMs: number;
  order: "control-validated" | "validated-control";
  validatedArchiveMs: number;
  validatedWallMs: number;
}

const payloads: readonly BenchmarkPayload[] = [
  {
    fileCount: ENTRY_CEILING,
    kind: "entry-ceiling",
    name: "entry-ceiling-20000-files",
    totalPlainBytes: 0,
  },
  {
    fileCount: 1,
    kind: "large-plain-bytes",
    name: "large-plain-bytes-warning-threshold",
    totalPlainBytes: HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
  },
];

const report = [];
for (const payload of payloads) {
  report.push(await benchmarkPayload(payload));
}

process.stdout.write(`${JSON.stringify({
  benchmark: "workspace-snapshot-validation-trust-boundary",
  methodology: {
    clock: "performance.now wall-clock milliseconds; validated archive phase uses production timing",
    control: "test-local direct zstd+tar extraction of the authenticated tar.zst fixture",
    pairOrder: "alternating AB/BA to reduce cache, JIT, and system-drift bias",
    samplePairs: SAMPLE_PAIR_COUNT,
    statistic: "median and nearest-rank p95 across paired samples",
    timedRegion: "archive decompression and extraction; validated adds production inventory limits, portable-entry checks, and ref-manifest verification",
    validated: "restoreEncryptedWorkspaceSnapshotFromEncryptedStream archiveExtractMs on the byte-identical fixture",
    warmupPairs: WARMUP_PAIR_COUNT,
  },
  payloadEnvelope: {
    entryCeiling: ENTRY_CEILING,
    largePlainBytes: HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
    maxPlainBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
  },
  report,
  runtime: {
    arch: process.arch,
    node: process.version,
    platform: process.platform,
  },
}, null, 2)}\n`);

async function benchmarkPayload(payload: BenchmarkPayload): Promise<object> {
  const fixture = await createAuthenticatedBenchmarkFixture(payload);
  const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-validation-benchmark-"));
  let runIndex = 0;

  try {
    for (let index = 0; index < WARMUP_PAIR_COUNT; index += 1) {
      await measurePair({
        fixture,
        order: index % 2 === 0 ? "control-validated" : "validated-control",
        runIndex,
        tempRoot,
      });
      runIndex += 1;
    }

    const samples: SamplePair[] = [];
    for (let index = 0; index < SAMPLE_PAIR_COUNT; index += 1) {
      samples.push(await measurePair({
        fixture,
        order: index % 2 === 0 ? "control-validated" : "validated-control",
        runIndex,
        tempRoot,
      }));
      runIndex += 1;
    }

    const controlSamples = samples.map((sample) => sample.controlMs);
    const validatedSamples = samples.map((sample) => sample.validatedArchiveMs);
    const pairedDeltaSamples = samples.map(
      (sample) => sample.validatedArchiveMs - sample.controlMs,
    );
    const pairedRatioSamples = samples.map(
      (sample) => sample.validatedArchiveMs / sample.controlMs,
    );

    return {
      fixture: {
        compressedArchiveBytes: fixture.compressedArchive.byteLength,
        encryptedArchiveBytes: fixture.encryptedBytes.byteLength,
        fileCount: payload.fileCount,
        kind: payload.kind,
        name: payload.name,
        sameAuthenticatedArchiveForBothArms: true,
        totalPlainBytes: payload.totalPlainBytes,
      },
      measurements: {
        controlMs: summarize(controlSamples),
        pairedDeltaMs: summarize(pairedDeltaSamples),
        pairedRatio: summarize(pairedRatioSamples),
        validatedArchiveMs: summarize(validatedSamples),
        validatedWallMs: summarize(samples.map((sample) => sample.validatedWallMs)),
      },
      sampleOrder: samples.map((sample) => sample.order),
    };
  } finally {
    fixture.dataKey.fill(0);
    fixture.encryptedBytes.fill(0);
    fixture.compressedArchive.fill(0);
    await rm(tempRoot, { force: true, recursive: true });
  }
}

async function measurePair(input: {
  fixture: AuthenticatedBenchmarkFixture;
  order: SamplePair["order"];
  runIndex: number;
  tempRoot: string;
}): Promise<SamplePair> {
  let controlMs = 0;
  let validatedArchiveMs = 0;
  let validatedWallMs = 0;

  const measureControl = async (): Promise<void> => {
    const targetRoot = path.join(input.tempRoot, `control-${input.runIndex}`);
    await mkdir(targetRoot, { mode: 0o700, recursive: true });
    const startedAt = performance.now();
    await extractCompressedArchiveDirectly({
      compressedArchive: input.fixture.compressedArchive,
      targetRoot,
    });
    controlMs = performance.now() - startedAt;
    await assertPayloadExtracted(targetRoot, input.fixture.payload);
    await rm(targetRoot, { force: true, recursive: true });
  };

  const measureValidated = async (): Promise<void> => {
    const durableRoot = path.join(input.tempRoot, `validated-${input.runIndex}`);
    const startedAt = performance.now();
    const timings = await restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
      dataKey: encodeHostedWorkspaceSnapshotV2DataKey(input.fixture.dataKey),
      durableRoot,
      encryptedStream: streamBuffer(input.fixture.encryptedBytes),
      ref: input.fixture.ref,
    });
    validatedWallMs = performance.now() - startedAt;
    validatedArchiveMs = timings.archiveExtractMs;
    await assertPayloadExtracted(durableRoot, input.fixture.payload);
    await rm(durableRoot, { force: true, recursive: true });
  };

  if (input.order === "control-validated") {
    await measureControl();
    await measureValidated();
  } else {
    await measureValidated();
    await measureControl();
  }

  assertFiniteNonnegative("control", controlMs);
  assertFiniteNonnegative("validated archive", validatedArchiveMs);
  assertFiniteNonnegative("validated wall", validatedWallMs);
  if (controlMs === 0) {
    throw new Error("Workspace snapshot validation benchmark control duration was zero.");
  }

  return {
    controlMs,
    order: input.order,
    validatedArchiveMs,
    validatedWallMs,
  };
}

async function extractCompressedArchiveDirectly(input: {
  compressedArchive: Buffer;
  targetRoot: string;
}): Promise<void> {
  const zstd = spawn("zstd", ["-d", "--stdout"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const tar = spawn("tar", [
    "-C",
    input.targetRoot,
    "--no-same-owner",
    "--no-same-permissions",
    "-xf",
    "-",
  ], {
    stdio: ["pipe", "ignore", "ignore"],
  });
  if (!zstd.stdin || !zstd.stdout || !tar.stdin) {
    stopOwnedProcess(zstd);
    stopOwnedProcess(tar);
    throw new Error("Workspace snapshot validation benchmark child streams are unavailable.");
  }

  const inputPipe = pipeline(Readable.from([input.compressedArchive]), zstd.stdin);
  const archivePipe = pipeline(zstd.stdout, tar.stdin);
  const zstdExit = waitForSuccessfulExit(zstd, "zstd");
  const tarExit = waitForSuccessfulExit(tar, "tar");
  try {
    await Promise.all([inputPipe, archivePipe, zstdExit, tarExit]);
  } catch (error) {
    stopOwnedProcess(zstd);
    stopOwnedProcess(tar);
    await Promise.allSettled([inputPipe, archivePipe, zstdExit, tarExit]);
    throw error;
  }
}

function waitForSuccessfulExit(child: ChildProcess, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `Workspace snapshot validation benchmark ${label} failed (${signal ?? code ?? "unknown"}).`,
      ));
    });
  });
}

function stopOwnedProcess(child: ChildProcess): void {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }
}

async function assertPayloadExtracted(
  targetRoot: string,
  payload: BenchmarkPayload,
): Promise<void> {
  if (payload.kind === "entry-ceiling") {
    await Promise.all([
      access(path.join(targetRoot, "vault", "entry-00000.txt")),
      access(path.join(targetRoot, "vault", "entry-19999.txt")),
    ]);
    return;
  }
  const extracted = await stat(path.join(targetRoot, "vault", "large-payload.bin"));
  if (extracted.size !== payload.totalPlainBytes) {
    throw new Error("Workspace snapshot validation benchmark extracted size did not match.");
  }
}

async function createAuthenticatedBenchmarkFixture(
  payload: BenchmarkPayload,
): Promise<AuthenticatedBenchmarkFixture> {
  const snapshotId = `snapshot_validation_benchmark_${payload.kind.replaceAll("-", "_")}`;
  const dataKeyOffset = payload.kind === "entry-ceiling" ? 1 : 101;
  const dataKey = Uint8Array.from(
    { length: 32 },
    (_, index) => dataKeyOffset + index,
  );
  let largeContent: Buffer | null = null;
  const entries: TestTarEntry[] = payload.kind === "entry-ceiling"
    ? Array.from({ length: payload.fileCount }, (_, index) => ({
      path: `vault/entry-${String(index).padStart(5, "0")}.txt`,
      type: "0" as const,
    }))
    : [{
      content: largeContent = Buffer.alloc(payload.totalPlainBytes),
      path: "vault/large-payload.bin",
      type: "0",
    }];
  const fixture = await createAuthenticatedTarSnapshotFixture({
    dataKey,
    entries,
    fileCount: payload.fileCount,
    snapshotId,
    totalPlainBytes: payload.totalPlainBytes,
  });
  largeContent?.fill(0);

  return {
    dataKey,
    ...fixture,
    payload,
  };
}

async function* streamBuffer(buffer: Buffer): AsyncIterable<Uint8Array> {
  yield buffer;
}

function summarize(samples: readonly number[]): { median: number; p95: number } {
  const sorted = [...samples].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  if (median === undefined || p95 === undefined) {
    throw new Error("Workspace snapshot validation benchmark has no samples.");
  }
  return {
    median: roundMetric(median),
    p95: roundMetric(p95),
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function assertFiniteNonnegative(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Workspace snapshot validation benchmark ${label} duration is invalid.`);
  }
}
