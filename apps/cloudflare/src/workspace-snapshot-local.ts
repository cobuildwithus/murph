import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, type DecipherGCM, type Hash } from "node:crypto";
import { createReadStream, createWriteStream, type Stats } from "node:fs";
import {
  access,
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  decodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
  serializeHostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

const HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES = 16;
const HOSTED_WORKSPACE_SNAPSHOT_ZSTD_ARGS = [
  "-3",
  "--no-progress",
  "-T2",
] as const;
const HOSTED_WORKSPACE_SNAPSHOT_MAX_TAR_ENTRIES = 20_000;
const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_FAILURE_MARKER =
  Symbol("hosted.workspace-snapshot.process-failure");
const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_SCAN_LIMIT_BYTES = 8192;
// Direct Web reads supersede these cross-member copies. Drop legacy bytes while
// extracting instead of scanning or deleting the foreground workspace later.
const HOSTED_WORKSPACE_SNAPSHOT_LEGACY_SHARED_PROJECTION_ARCHIVE_PATHS = [
  "./vault/derived/vault-share",
  "./vault/vault-share",
] as const;

export const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_LABELS = [
  "tar",
  "zstd",
] as const;

export type HostedWorkspaceSnapshotProcessLabel =
  typeof HOSTED_WORKSPACE_SNAPSHOT_PROCESS_LABELS[number];

export const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKERS = [
  "broken_pipe",
  "corrupt_archive",
  "io_error",
  "no_space_left",
  "not_found",
  "permission_denied",
  "unexpected_eof",
  "unsupported_format",
] as const;

export type HostedWorkspaceSnapshotProcessStderrMarker =
  typeof HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKERS[number];

export interface HostedWorkspaceSnapshotProcessFailureDiagnostics {
  exitCode: number | null;
  label: HostedWorkspaceSnapshotProcessLabel;
  signal: string | null;
  stderrByteCount: number;
  stderrLineCount: number;
  stderrMarkers: readonly HostedWorkspaceSnapshotProcessStderrMarker[];
  stderrTruncated: boolean;
}

type HostedWorkspaceSnapshotProcessStderrCapture = {
  read(): Omit<
    HostedWorkspaceSnapshotProcessFailureDiagnostics,
    "exitCode" | "label" | "signal"
  >;
};

const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKER_PATTERNS:
  ReadonlyArray<{
    marker: HostedWorkspaceSnapshotProcessStderrMarker;
    pattern: RegExp;
  }> = [
    {
      marker: "broken_pipe",
      pattern: /(?:broken pipe|\bEPIPE\b)/iu,
    },
    {
      marker: "corrupt_archive",
      pattern: /(?:corrupt|checksum|decompression error|invalid compressed data|data corruption)/iu,
    },
    {
      marker: "io_error",
      pattern: /(?:I\/O error|input\/output error|read error|write error)/iu,
    },
    {
      marker: "no_space_left",
      pattern: /no space left/iu,
    },
    {
      marker: "not_found",
      pattern: /(?:no such file|cannot stat|not found)/iu,
    },
    {
      marker: "permission_denied",
      pattern: /(?:permission denied|operation not permitted)/iu,
    },
    {
      marker: "unexpected_eof",
      pattern: /(?:unexpected eof|unexpected end|premature end)/iu,
    },
    {
      marker: "unsupported_format",
      pattern: /(?:unsupported format|unknown frame descriptor|format not recognized|not a zstd file)/iu,
    },
  ];

export interface EncryptedWorkspaceSnapshotFile {
  compression: typeof HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION;
  encryptedByteSize: number;
  encryptedFilePath: string;
  encryptedObjectSha256: string;
  fileCount: number;
  ivBase64: string;
  plaintextArchiveSha256: string;
  temporaryDirectoryPath: string;
  totalPlainBytes: number;
}

export interface WorkspaceSnapshotArchiveEntryInput {
  absolutePath: string;
  archivePath: string;
  kind: "directory" | "file";
}

export async function createEncryptedWorkspaceSnapshotFile(input: {
  aad: HostedWorkspaceSnapshotV2Aad;
  archiveEntries: readonly WorkspaceSnapshotArchiveEntryInput[];
  dataKey: string;
  durableRoot: string;
  ivBase64: string;
  maxEncryptedBytes: number;
  outputDir: string;
  signal?: AbortSignal | null;
}): Promise<EncryptedWorkspaceSnapshotFile> {
  assertHostedWorkspaceSnapshotConstructionLive(input.signal);
  const durableRoot = path.resolve(input.durableRoot);
  const outputDir = path.resolve(input.outputDir);
  if (isSameOrDescendantPath(outputDir, durableRoot)) {
    throw new Error("Hosted workspace snapshot outputDir must be outside durableRoot.");
  }
  await mkdir(outputDir, { mode: 0o700, recursive: true });
  await assertHostedWorkspaceSnapshotPathOutsideRoot({
    candidate: outputDir,
    message: "Hosted workspace snapshot outputDir must be outside durableRoot.",
    root: durableRoot,
  });
  const tempDir = await mkdtemp(path.join(outputDir, "workspace-snapshot-"));
  const encryptedFilePath = path.join(tempDir, "workspace.snapshot.enc");
  let dataKey: Uint8Array | null = null;
  let completed = false;

  try {
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    const preflight = await readHostedWorkspaceSnapshotSelectedEntryState({
      archiveEntries: input.archiveEntries,
      durableRoot,
      signal: input.signal,
    });
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    if (preflight.totalPlainBytes >= HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES) {
      throw new RangeError("Hosted workspace snapshot exceeds the total plain size limit.");
    }
    const tarListPath = path.join(tempDir, "workspace-snapshot-tar-list.txt");
    await writeFile(
      tarListPath,
      Buffer.from(preflight.tarEntryPaths.map((entryPath) => `./${entryPath}\0`).join("")),
      { mode: 0o600 },
    );
    const iv = decodeHostedWorkspaceSnapshotIv(input.ivBase64);
    dataKey = decodeHostedWorkspaceSnapshotV2DataKey(input.dataKey);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(dataKey), iv);
    cipher.setAAD(Buffer.from(serializeHostedWorkspaceSnapshotV2Aad(input.aad)));
    const plaintextArchiveHash = createHash("sha256");
    const encryptedObjectHash = createHash("sha256");
    const encryptedCounter = createBoundedHashTransform({
      authTagBytes: HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES,
      hash: encryptedObjectHash,
      maxBytes: input.maxEncryptedBytes,
    });
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    const tar = spawn("tar", [
      "-C",
      durableRoot,
      "--format=pax",
      "--no-recursion",
      "--null",
      "-T",
      tarListPath,
      "-cvvf",
      "-",
    ], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const zstd = spawn("zstd", [...HOSTED_WORKSPACE_SNAPSHOT_ZSTD_ARGS], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const emittedTarEntries = collectHostedWorkspaceSnapshotVerboseTarEntries(
      tar.stderr,
      input.signal,
    );
    const tarExit = waitForHostedWorkspaceSnapshotProcess(tar, "tar");
    const zstdExit = waitForHostedWorkspaceSnapshotProcess(zstd, "zstd");
    const pipelineOptions = input.signal ? { signal: input.signal } : {};

    try {
      if (!tar.stdout) {
        throw new Error("Hosted workspace snapshot tar stdout is unavailable.");
      }
      if (!zstd.stdin || !zstd.stdout) {
        throw new Error("Hosted workspace snapshot zstd streams are unavailable.");
      }
      const archiveInputPipe = waitForHostedWorkspaceSnapshotProcessPipe(
        pipeline(tar.stdout, zstd.stdin, pipelineOptions),
        [tarExit, zstdExit],
      );
      const [, , , , tarEntries] = await Promise.all([
        archiveInputPipe,
        pipeline(
          zstd.stdout,
          createHashTransform(plaintextArchiveHash),
          cipher,
          encryptedCounter,
          createWriteStream(encryptedFilePath, { mode: 0o600 }),
          pipelineOptions,
        ),
        tarExit,
        zstdExit,
        emittedTarEntries,
      ]);
      assertHostedWorkspaceSnapshotArchiveMatchesState({
        entries: tarEntries,
        expected: preflight,
        signal: input.signal,
      });
    } catch (error) {
      const constructionInterruption =
        readHostedWorkspaceSnapshotConstructionInterruption(error, input.signal);
      tar.kill("SIGTERM");
      zstd.kill("SIGTERM");
      const processFailure = await readHostedWorkspaceSnapshotProcessFailure([
        tarExit,
        zstdExit,
      ]);
      if (constructionInterruption) {
        throw constructionInterruption;
      }
      if (
        processFailure
        && shouldPreferHostedWorkspaceSnapshotProcessFailure(error)
      ) {
        throw processFailure;
      }
      throw error;
    }

    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    const authTag = cipher.getAuthTag();
    await appendFile(encryptedFilePath, authTag);
    encryptedObjectHash.update(authTag);

    const encryptedByteSize = encryptedCounter.byteCount + authTag.byteLength;
    if (encryptedByteSize >= input.maxEncryptedBytes) {
      throw new RangeError("Hosted workspace snapshot exceeds the configured size limit.");
    }
    const encryptedStat = await stat(encryptedFilePath);
    if (encryptedStat.size !== encryptedByteSize) {
      throw new Error("Hosted workspace snapshot encrypted size accounting failed.");
    }
    const encryptedObjectSha256 = encryptedObjectHash.digest("hex");
    const postArchivePreflight = await readHostedWorkspaceSnapshotSelectedEntryState({
      archiveEntries: input.archiveEntries,
      durableRoot,
      signal: input.signal,
    });
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    assertHostedWorkspaceSnapshotDurableRootUnchanged(preflight, postArchivePreflight);

    completed = true;
    return {
      compression: HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
      encryptedByteSize,
      encryptedFilePath,
      encryptedObjectSha256,
      fileCount: preflight.fileCount,
      ivBase64: input.ivBase64,
      plaintextArchiveSha256: plaintextArchiveHash.digest("hex"),
      temporaryDirectoryPath: tempDir,
      totalPlainBytes: preflight.totalPlainBytes,
    };
  } finally {
    dataKey?.fill(0);
    if (!completed) {
      await rm(tempDir, { force: true, recursive: true });
    }
  }
}

function assertHostedWorkspaceSnapshotConstructionLive(
  signal: AbortSignal | null | undefined,
): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted workspace snapshot construction was interrupted.");
}

function readHostedWorkspaceSnapshotConstructionInterruption(
  error: unknown,
  signal: AbortSignal | null | undefined,
): Error | null {
  if (!signal?.aborted || !isHostedWorkspaceSnapshotAbortFailure(error, signal.reason)) {
    return null;
  }
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted workspace snapshot construction was interrupted.");
}

export function isHostedWorkspaceSnapshotAbortFailure(
  error: unknown,
  abortReason: unknown,
): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    if (Object.is(current, abortReason)) {
      return true;
    }
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (
      isHostedWorkspaceSnapshotHttpStatus(record.status)
      || isHostedWorkspaceSnapshotHttpStatus(record.statusCode)
    ) {
      return false;
    }
    if (current instanceof Error && current.name === "AbortError") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function isHostedWorkspaceSnapshotHttpStatus(value: unknown): boolean {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 100
    && value <= 599;
}

function isSameOrDescendantPath(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertHostedWorkspaceSnapshotPathOutsideRoot(input: {
  candidate: string;
  message: string;
  root: string;
}): Promise<void> {
  const [candidateRealPath, rootRealPath] = await Promise.all([
    realpathIfExists(input.candidate),
    realpathIfExists(input.root),
  ]);
  if (isSameOrDescendantPath(candidateRealPath, rootRealPath)) {
    throw new Error(input.message);
  }
}

async function realpathIfExists(inputPath: string): Promise<string> {
  try {
    return await realpath(inputPath);
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "ENOENT"
    ) {
      return path.resolve(inputPath);
    }
    throw error;
  }
}

export interface RestoreEncryptedWorkspaceSnapshotTimings {
  decryptMs: number;
  archiveExtractMs: number;
  durableRootReplaceMs: number;
  cleanupMs: number;
  extractMs: number;
}

export async function restoreEncryptedWorkspaceSnapshot(input: {
  dataKey: string;
  durableRoot: string;
  encryptedFilePath: string;
  ref: HostedWorkspaceSnapshotV2Ref;
}): Promise<RestoreEncryptedWorkspaceSnapshotTimings> {
  const encryptedFilePath = path.resolve(input.encryptedFilePath);
  const encryptedStat = await stat(encryptedFilePath);
  if (encryptedStat.size !== input.ref.archive.encryptedByteSize) {
    throw new Error("Hosted workspace snapshot encrypted size does not match its ref.");
  }

  return await restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
    dataKey: input.dataKey,
    durableRoot: input.durableRoot,
    encryptedStream: createReadStream(encryptedFilePath),
    ref: input.ref,
  });
}

export async function restoreEncryptedWorkspaceSnapshotFromEncryptedStream(input: {
  dataKey: string;
  durableRoot: string;
  encryptedStream: AsyncIterable<Uint8Array>;
  ref: HostedWorkspaceSnapshotV2Ref;
  signal?: AbortSignal | null;
}): Promise<RestoreEncryptedWorkspaceSnapshotTimings> {
  assertHostedWorkspaceSnapshotRestoreLive(input.signal);
  if (input.ref.archive.compression !== HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION) {
    throw new Error("Hosted workspace snapshot restore only supports zstd archives.");
  }
  const expectedEncryptedByteSize = input.ref.archive.encryptedByteSize;
  if (expectedEncryptedByteSize <= HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES) {
    throw new Error("Hosted workspace snapshot encrypted object is too small.");
  }
  if (expectedEncryptedByteSize >= HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES) {
    throw new RangeError("Hosted workspace snapshot exceeds the single-part size limit.");
  }
  if (input.ref.archive.totalPlainBytes >= HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES) {
    throw new RangeError("Hosted workspace snapshot exceeds the total plain size limit.");
  }

  const durableRoot = path.resolve(input.durableRoot);
  const durableParent = path.dirname(durableRoot);
  await mkdir(durableParent, { mode: 0o700, recursive: true });
  const restoreTempDir = await mkdtemp(path.join(durableParent, ".workspace-snapshot-restore-"));
  const restoreRoot = path.join(restoreTempDir, "durable-root");
  const backupRoot = path.join(restoreTempDir, "previous-durable-root");
  let dataKey: Uint8Array | null = null;
  let plaintextArchiveBuffer: Buffer | null = null;
  let decryptMs = 0;
  let archiveExtractMs = 0;
  let durableRootReplaceMs = 0;
  let cleanupMs = 0;
  let extractMs = 0;

  try {
    assertHostedWorkspaceSnapshotRestoreLive(input.signal);
    const decryptStartedAt = Date.now();
    await mkdir(restoreRoot, { mode: 0o700, recursive: true });
    dataKey = decodeHostedWorkspaceSnapshotV2DataKey(input.dataKey);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(dataKey),
      Buffer.from(input.ref.encryption.ivBase64, "base64url"),
    );
    decipher.setAAD(Buffer.from(serializeHostedWorkspaceSnapshotV2Aad(input.ref.encryption.aad)));

    const encryptedObjectHash = createHash("sha256");
    const plaintextArchiveHash = createHash("sha256");
    const plaintextArchiveCollector = createFixedSizeArchiveBufferCollector({
      byteLength: expectedEncryptedByteSize - HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES,
      hash: plaintextArchiveHash,
    });
    let plaintextArchive: Buffer;
    try {
      await decryptHostedWorkspaceSnapshotEncryptedStream({
        decipher,
        encryptedObjectHash,
        encryptedStream: input.encryptedStream,
        expectedEncryptedByteSize,
        plaintextArchiveCollector,
      });
      plaintextArchive = plaintextArchiveCollector.readBuffer();
      plaintextArchiveBuffer = plaintextArchive;
    } catch (error) {
      plaintextArchiveCollector.clear();
      throw error;
    }

    const encryptedObjectSha256 = encryptedObjectHash.digest("hex");
    if (encryptedObjectSha256 !== input.ref.archive.encryptedObjectSha256) {
      throw new Error("Hosted workspace snapshot encrypted digest does not match its ref.");
    }
    const plaintextArchiveSha256 = plaintextArchiveHash.digest("hex");
    if (plaintextArchiveSha256 !== input.ref.archive.plaintextArchiveSha256) {
      throw new Error("Hosted workspace snapshot plaintext archive digest does not match its ref.");
    }
    assertHostedWorkspaceSnapshotRestoreLive(input.signal);
    decryptMs = Date.now() - decryptStartedAt;

    const extractStartedAt = Date.now();
    const archiveExtractStartedAt = Date.now();
    const zstd = spawn("zstd", [
      "-d",
      "--stdout",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const tar = spawn("tar", [
      "-C",
      restoreRoot,
      "--no-same-owner",
      "--no-same-permissions",
      ...HOSTED_WORKSPACE_SNAPSHOT_LEGACY_SHARED_PROJECTION_ARCHIVE_PATHS.map(
        (archivePath) => `--exclude=${archivePath}`,
      ),
      "-xf",
      "-",
    ], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const zstdExit = waitForHostedWorkspaceSnapshotProcess(zstd, "zstd");
    const tarExit = waitForHostedWorkspaceSnapshotProcess(tar, "tar");
    let zstdInputPipe: Promise<void> | null = null;
    let archivePipe: Promise<void> | null = null;
    try {
      if (!zstd.stdout || !tar.stdin) {
        throw new Error("Hosted workspace snapshot restore archive streams are unavailable.");
      }
      if (!zstd.stdin) {
        throw new Error("Hosted workspace snapshot restore archive streams are unavailable.");
      }
      zstdInputPipe = waitForHostedWorkspaceSnapshotProcessPipe(
        pipeline(Readable.from([plaintextArchive]), zstd.stdin),
        [zstdExit, tarExit],
      );
      archivePipe = waitForHostedWorkspaceSnapshotProcessPipe(
        pipeline(zstd.stdout, tar.stdin),
        [zstdExit, tarExit],
      );
      await Promise.all([
        zstdInputPipe,
        archivePipe,
        zstdExit,
        tarExit,
      ]);
    } catch (error) {
      zstd.kill("SIGTERM");
      tar.kill("SIGTERM");
      const processFailure = await readHostedWorkspaceSnapshotProcessFailure([
        zstdExit,
        tarExit,
      ]);
      await Promise.allSettled([zstdInputPipe, archivePipe].filter((promise) => promise !== null));
      if (
        processFailure
        && shouldPreferHostedWorkspaceSnapshotProcessFailure(error)
      ) {
        throw processFailure;
      }
      throw error;
    }
    archiveExtractMs = Date.now() - archiveExtractStartedAt;
    assertHostedWorkspaceSnapshotRestoreLive(input.signal);

    const durableRootReplaceStartedAt = Date.now();
    await replaceHostedWorkspaceSnapshotDurableRoot({
      backupRoot,
      durableRoot,
      restoreRoot,
    });
    durableRootReplaceMs = Date.now() - durableRootReplaceStartedAt;
    extractMs = Date.now() - extractStartedAt;
  } finally {
    plaintextArchiveBuffer?.fill(0);
    dataKey?.fill(0);
    const cleanupStartedAt = Date.now();
    try {
      await rm(restoreTempDir, { force: true, recursive: true });
    } finally {
      cleanupMs = Date.now() - cleanupStartedAt;
    }
  }

  return {
    decryptMs,
    archiveExtractMs,
    durableRootReplaceMs,
    cleanupMs,
    extractMs,
  };
}

async function decryptHostedWorkspaceSnapshotEncryptedStream(input: {
  decipher: DecipherGCM;
  encryptedObjectHash: Hash;
  encryptedStream: AsyncIterable<Uint8Array>;
  expectedEncryptedByteSize: number;
  plaintextArchiveCollector: {
    clear(): void;
    readBuffer(): Buffer;
    append(chunk: Buffer): void;
  };
}): Promise<void> {
  let encryptedByteCount = 0;
  let encryptedTail = Buffer.alloc(0);
  try {
    for await (const rawChunk of input.encryptedStream) {
      const chunk = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk);
      if (chunk.byteLength === 0) {
        continue;
      }
      encryptedByteCount += chunk.byteLength;
      if (encryptedByteCount > input.expectedEncryptedByteSize) {
        throw new Error("Hosted workspace snapshot encrypted stream exceeded its ref byte count.");
      }
      input.encryptedObjectHash.update(chunk);

      const encrypted = encryptedTail.byteLength > 0
        ? Buffer.concat([encryptedTail, chunk])
        : chunk;
      if (encrypted.byteLength <= HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES) {
        encryptedTail = Buffer.from(encrypted);
        continue;
      }

      const ciphertextEnd =
        encrypted.byteLength - HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES;
      encryptedTail = Buffer.from(encrypted.subarray(ciphertextEnd));
      input.plaintextArchiveCollector.append(
        input.decipher.update(encrypted.subarray(0, ciphertextEnd)),
      );
    }

    if (encryptedByteCount !== input.expectedEncryptedByteSize) {
      throw new Error("Hosted workspace snapshot encrypted stream byte count does not match its ref.");
    }
    if (encryptedTail.byteLength !== HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES) {
      throw new Error("Hosted workspace snapshot auth tag is incomplete.");
    }

    input.decipher.setAuthTag(encryptedTail);
    input.plaintextArchiveCollector.append(input.decipher.final());
  } finally {
    encryptedTail.fill(0);
  }
}

function assertHostedWorkspaceSnapshotRestoreLive(
  signal: AbortSignal | null | undefined,
): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted workspace snapshot restore was aborted.");
}

interface HostedWorkspaceSnapshotDurableRootState {
  directoryCount: number;
  entries: Map<string, "directory" | "file">;
  entryCount: number;
  fileCount: number;
  files: Map<string, HostedWorkspaceSnapshotDurableRootFileState>;
  tarEntryPaths: string[];
  totalPlainBytes: number;
}

interface HostedWorkspaceSnapshotDurableRootFileState {
  mtimeMs: number;
  size: number;
}

async function readHostedWorkspaceSnapshotSelectedEntryState(input: {
  archiveEntries: readonly WorkspaceSnapshotArchiveEntryInput[];
  durableRoot: string;
  signal?: AbortSignal | null;
}): Promise<HostedWorkspaceSnapshotDurableRootState> {
  assertHostedWorkspaceSnapshotConstructionLive(input.signal);
  const root = path.resolve(input.durableRoot);
  try {
    await access(root);
  } catch (error) {
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    throw error;
  }
  assertHostedWorkspaceSnapshotConstructionLive(input.signal);
  let directoryCount = 0;
  let entryCount = 0;
  let fileCount = 0;
  const entries = new Map<string, "directory" | "file">();
  const files = new Map<string, HostedWorkspaceSnapshotDurableRootFileState>();
  const seen = new Set<string>();
  const statsByPath = new Map<string, Stats>();
  const tarEntryPaths: string[] = [];
  let totalPlainBytes = 0;

  for (const entry of input.archiveEntries) {
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    const archivePath = normalizeHostedWorkspaceSnapshotArchivePath(entry.archivePath);
    if (seen.has(archivePath)) {
      throw new Error("Hosted workspace snapshot archive contains duplicate entries.");
    }
    seen.add(archivePath);
    entryCount += 1;
    if (entryCount > HOSTED_WORKSPACE_SNAPSHOT_MAX_TAR_ENTRIES) {
      throw new Error("Hosted workspace snapshot durable root contains too many entries.");
    }

    const absolutePath = path.resolve(entry.absolutePath);
    const expectedPath = path.resolve(root, archivePath);
    if (absolutePath !== expectedPath) {
      throw new Error("Hosted workspace snapshot archive entry path escaped durableRoot.");
    }
    assertHostedWorkspaceSnapshotRelativePathSafe(archivePath);
    const stats = await readHostedWorkspaceSnapshotSelectedEntryStats({
      archivePath,
      root,
      signal: input.signal,
      statsByPath,
    });
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    if (isHostedWorkspaceSnapshotEnvPath(archivePath)) {
      throw new Error("Hosted workspace snapshot durable root contains environment files.");
    }
    if (stats.isSymbolicLink()) {
      throw new Error("Hosted workspace snapshot durable root contains symlinks.");
    }
    if (stats.isSocket() || stats.isFIFO() || stats.isBlockDevice() || stats.isCharacterDevice()) {
      throw new Error("Hosted workspace snapshot durable root contains unsupported special files.");
    }
    if (entry.kind === "file") {
      if (!stats.isFile()) {
        throw new Error("Hosted workspace snapshot archive entry is not a regular file.");
      }
      if (stats.nlink > 1) {
        throw new Error("Hosted workspace snapshot durable root contains hardlinks.");
      }
      entries.set(archivePath, "file");
      fileCount += 1;
      files.set(archivePath, {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      });
      totalPlainBytes += stats.size;
    } else {
      if (!stats.isDirectory()) {
        throw new Error("Hosted workspace snapshot archive entry is not a directory.");
      }
      entries.set(archivePath, "directory");
      directoryCount += 1;
    }
    tarEntryPaths.push(archivePath);
  }

  return { directoryCount, entries, entryCount, fileCount, files, tarEntryPaths, totalPlainBytes };
}

async function readHostedWorkspaceSnapshotSelectedEntryStats(input: {
  archivePath: string;
  root: string;
  signal?: AbortSignal | null;
  statsByPath: Map<string, Stats>;
}): Promise<Stats> {
  assertHostedWorkspaceSnapshotConstructionLive(input.signal);
  const segments = input.archivePath.split("/");
  let currentPath = input.root;
  let stats: Awaited<ReturnType<typeof lstat>> | null = null;
  for (const [index, segment] of segments.entries()) {
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    currentPath = path.join(currentPath, segment);
    stats = input.statsByPath.get(currentPath) ?? null;
    if (!stats) {
      try {
        stats = await lstat(currentPath);
      } catch (error) {
        assertHostedWorkspaceSnapshotConstructionLive(input.signal);
        throw error;
      }
      input.statsByPath.set(currentPath, stats);
    }
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    if (stats.isSymbolicLink()) {
      throw new Error("Hosted workspace snapshot durable root contains symlinks.");
    }
    if (stats.isSocket() || stats.isFIFO() || stats.isBlockDevice() || stats.isCharacterDevice()) {
      throw new Error("Hosted workspace snapshot durable root contains unsupported special files.");
    }
    if (index < segments.length - 1 && !stats.isDirectory()) {
      throw new Error("Hosted workspace snapshot durable root contains unsupported entries.");
    }
  }
  if (!stats) {
    throw new Error("Hosted workspace snapshot path is unsafe.");
  }
  return stats;
}

function assertHostedWorkspaceSnapshotArchiveMatchesState(input: {
  entries: readonly string[];
  expected: HostedWorkspaceSnapshotDurableRootState;
  signal?: AbortSignal | null;
}): void {
  assertHostedWorkspaceSnapshotConstructionLive(input.signal);
  const expected = input.expected;
  const remaining = new Map(expected.entries);
  const seenPaths = new Set<string>();
  let fileCount = 0;
  let totalPlainBytes = 0;

  for (const entry of input.entries) {
    assertHostedWorkspaceSnapshotConstructionLive(input.signal);
    const parsed = parseHostedWorkspaceSnapshotVerboseTarEntry(entry);
    const parsedArchivePath = normalizeHostedWorkspaceSnapshotTarEntryPath(parsed.path);
    assertHostedWorkspaceSnapshotRelativePathSafe(
      parsedArchivePath,
      "Hosted workspace snapshot tar entry path is unsafe.",
    );
    if (isHostedWorkspaceSnapshotEnvPath(parsedArchivePath)) {
      throw new Error("Hosted workspace snapshot durable root contains environment files.");
    }
    if (seenPaths.has(parsedArchivePath)) {
      throw new Error("Hosted workspace snapshot tar archive contains duplicate entries.");
    }
    seenPaths.add(parsedArchivePath);

    const expectedType = expected.entries.get(parsedArchivePath);
    if (!expectedType || expectedType !== parsed.type) {
      throw new Error("Hosted workspace snapshot archive does not match its plan.");
    }
    remaining.delete(parsedArchivePath);

    if (parsed.type === "file") {
      const expectedFile = expected.files.get(parsedArchivePath);
      if (!expectedFile || expectedFile.size !== parsed.size) {
        throw new Error("Hosted workspace snapshot archive manifest does not match its plan.");
      }
      fileCount += 1;
      totalPlainBytes += parsed.size;
      if (
        fileCount > expected.fileCount
        || !Number.isSafeInteger(totalPlainBytes)
        || totalPlainBytes > expected.totalPlainBytes
      ) {
        throw new Error("Hosted workspace snapshot archive manifest does not match its plan.");
      }
    }
  }

  if (
    remaining.size > 0
    || seenPaths.size !== expected.entries.size
    || fileCount !== expected.fileCount
    || totalPlainBytes !== expected.totalPlainBytes
  ) {
    throw new Error("Hosted workspace snapshot archive manifest does not match its plan.");
  }
}

async function collectHostedWorkspaceSnapshotVerboseTarEntries(
  stream: Readable | null,
  signal: AbortSignal | null | undefined,
): Promise<string[]> {
  if (!stream) {
    throw new Error("Hosted workspace snapshot tar stderr is unavailable.");
  }
  const lines = createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: stream,
  });
  const entries: string[] = [];
  for await (const line of lines) {
    assertHostedWorkspaceSnapshotConstructionLive(signal);
    if (line.trim().length === 0) {
      continue;
    }
    entries.push(line);
    if (entries.length > HOSTED_WORKSPACE_SNAPSHOT_MAX_TAR_ENTRIES) {
      throw new Error("Hosted workspace snapshot tar entry count is unsafe.");
    }
  }
  assertHostedWorkspaceSnapshotConstructionLive(signal);
  return entries;
}

function parseHostedWorkspaceSnapshotVerboseTarEntry(entry: string): {
  path: string;
  size: number;
  type: "directory" | "file";
} {
  const normalizedEntry = entry.startsWith("a ") ? entry.slice(2) : entry;
  const type = normalizedEntry[0];
  if (type !== "-" && type !== "d") {
    throw new Error("Hosted workspace snapshot tar entry type is unsafe.");
  }
  const parsed = parseHostedWorkspaceSnapshotVerboseTarEntryFields(normalizedEntry);
  if (!parsed) {
    throw new Error("Hosted workspace snapshot tar entry format is unsupported.");
  }
  return {
    path: parsed.path,
    size: parsed.size,
    type: type === "d" ? "directory" : "file",
  };
}

function parseHostedWorkspaceSnapshotVerboseTarEntryFields(
  entry: string,
): { path: string; size: number } | null {
  const gnu = /^[^\s]+\s+\S+\s+(?<size>[0-9]+)\s+[0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2}(?::[0-9]{2})?\s+(?<path>.*)$/u.exec(entry);
  const bsd = /^[^\s]+\s+[0-9]+\s+\S+\s+\S+\s+(?<size>[0-9]+)\s+\S+\s+[0-9]{1,2}\s+(?:[0-9]{2}:[0-9]{2}|[0-9]{4})\s+(?<path>.*)$/u.exec(entry);
  const groups = gnu?.groups ?? bsd?.groups;
  if (!groups) {
    return null;
  }
  const sizeText = groups.size ?? "";
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size) || size < 0 || String(size) !== sizeText) {
    throw new Error("Hosted workspace snapshot tar entry size is unsafe.");
  }
  return {
    path: groups.path ?? "",
    size,
  };
}

function normalizeHostedWorkspaceSnapshotTarEntryPath(archivePath: string): string {
  return archivePath
    .replace(/\/+/gu, "/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+$/u, "");
}

function assertHostedWorkspaceSnapshotDurableRootUnchanged(
  before: HostedWorkspaceSnapshotDurableRootState,
  after: HostedWorkspaceSnapshotDurableRootState,
): void {
  if (
    before.directoryCount !== after.directoryCount
    || before.entryCount !== after.entryCount
    || before.fileCount !== after.fileCount
    || before.totalPlainBytes !== after.totalPlainBytes
  ) {
    throw new Error("Hosted workspace snapshot durable root changed while archiving.");
  }
  for (const [relativePath, beforeFile] of before.files) {
    const afterFile = after.files.get(relativePath);
    if (!afterFile || afterFile.size !== beforeFile.size || afterFile.mtimeMs !== beforeFile.mtimeMs) {
      throw new Error("Hosted workspace snapshot durable root changed while archiving.");
    }
  }
}

function isHostedWorkspaceSnapshotEnvPath(relativePath: string): boolean {
  return relativePath
    .split("/")
    .some((segment) => segment === ".env" || segment.startsWith(".env."));
}

function normalizeHostedWorkspaceSnapshotArchivePath(archivePath: string): string {
  const normalized = archivePath
    .replace(/\\/gu, "/")
    .replace(/\/+/gu, "/")
    .replace(/^\.\/+/u, "")
    .replace(/^\/+|\/+$/gu, "");
  assertHostedWorkspaceSnapshotRelativePathSafe(normalized);
  return normalized;
}

function assertHostedWorkspaceSnapshotRelativePathSafe(
  relativePath: string,
  message = "Hosted workspace snapshot path is unsafe.",
): void {
  if (
    relativePath.length === 0
    || relativePath.includes("\u0000")
    || /[\u0001-\u001f\u007f]/u.test(relativePath)
    || path.posix.isAbsolute(relativePath)
    || relativePath === "."
    || relativePath === ".."
    || relativePath.split("/").some((segment) => segment === ".")
    || relativePath.startsWith("../")
    || relativePath.includes("/../")
    || relativePath.endsWith("/..")
  ) {
    throw new Error(message);
  }
}

function decodeHostedWorkspaceSnapshotIv(value: string): Buffer {
  const iv = Buffer.from(value, "base64url");
  if (iv.byteLength !== 12) {
    throw new TypeError("Hosted workspace snapshot ivBase64 must decode to 12 bytes.");
  }
  return iv;
}

function createHashTransform(hash: Hash): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

function createFixedSizeArchiveBufferCollector(input: {
  byteLength: number;
  hash: Hash;
}): {
  append(chunk: Buffer): void;
  clear(): void;
  readBuffer(): Buffer;
} {
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0) {
    throw new Error("Hosted workspace snapshot decrypted archive size is unsafe.");
  }
  const buffer = Buffer.allocUnsafe(input.byteLength);
  let offset = 0;
  return {
    append: (chunk) => {
      if (chunk.byteLength === 0) {
        return;
      }
      const nextOffset = offset + chunk.byteLength;
      if (nextOffset > buffer.byteLength) {
        throw new Error("Hosted workspace snapshot decrypted archive size accounting failed.");
      }
      input.hash.update(chunk);
      chunk.copy(buffer, offset);
      offset = nextOffset;
    },
    clear: () => {
      buffer.fill(0);
    },
    readBuffer: () => {
      if (offset !== buffer.byteLength) {
        throw new Error("Hosted workspace snapshot decrypted archive size accounting failed.");
      }
      return buffer;
    },
  };
}

async function replaceHostedWorkspaceSnapshotDurableRoot(input: {
  backupRoot: string;
  durableRoot: string;
  restoreRoot: string;
}): Promise<void> {
  let backedUp = false;
  try {
    await rename(input.durableRoot, input.backupRoot);
    backedUp = true;
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) {
      throw error;
    }
  }

  try {
    await rename(input.restoreRoot, input.durableRoot);
  } catch (error) {
    if (backedUp) {
      await rename(input.backupRoot, input.durableRoot).catch(() => {});
    }
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && "code" in error
    && (error as { code?: unknown }).code === code;
}

function createBoundedHashTransform(input: {
  authTagBytes: number;
  hash: ReturnType<typeof createHash>;
  maxBytes: number;
}): Transform & { byteCount: number } {
  let byteCount = 0;
  const transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteCount += chunk.byteLength;
      if (byteCount + input.authTagBytes >= input.maxBytes) {
        callback(new RangeError("Hosted workspace snapshot exceeds the configured size limit."));
        return;
      }
      input.hash.update(chunk);
      callback(null, chunk);
    },
  }) as Transform & { byteCount: number };
  Object.defineProperty(transform, "byteCount", {
    get: () => byteCount,
  });
  return transform;
}

function waitForHostedWorkspaceSnapshotProcess(
  process: ReturnType<typeof spawn>,
  label: HostedWorkspaceSnapshotProcessLabel,
): Promise<void> {
  const stderr = captureHostedWorkspaceSnapshotProcessStderr(process.stderr);
  const exit = new Promise<void>((resolve, reject) => {
    process.once("error", (cause) => {
      const error = new Error(
        `Hosted workspace snapshot ${label} command failed with start error.`,
        { cause },
      );
      annotateHostedWorkspaceSnapshotProcessFailure(error, {
        ...stderr.read(),
        exitCode: null,
        label,
        signal: null,
      });
      reject(error);
    });
    process.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const status = signal ?? `exit code ${code ?? "unknown"}`;
      const error = new Error(`Hosted workspace snapshot ${label} command failed with ${status}.`);
      annotateHostedWorkspaceSnapshotProcessFailure(error, {
        ...stderr.read(),
        exitCode: Number.isInteger(code) ? code : null,
        label,
        signal: typeof signal === "string" && signal.length > 0 ? signal : null,
      });
      reject(error);
    });
  });
  exit.catch(() => undefined);
  return exit;
}

export function readHostedWorkspaceSnapshotProcessFailureDiagnostics(
  error: unknown,
): HostedWorkspaceSnapshotProcessFailureDiagnostics | null {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<PropertyKey, unknown>;
    const diagnostics = readHostedWorkspaceSnapshotProcessFailureDiagnosticsValue(
      record[HOSTED_WORKSPACE_SNAPSHOT_PROCESS_FAILURE_MARKER],
    );
    if (diagnostics) {
      return diagnostics;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

async function readHostedWorkspaceSnapshotProcessFailure(
  promises: readonly Promise<void>[],
): Promise<unknown | null> {
  const results = await Promise.allSettled(promises);
  const processFailure = results.find((result) =>
    result.status === "rejected"
    && readHostedWorkspaceSnapshotProcessFailureDiagnostics(result.reason)
  );
  if (processFailure?.status === "rejected") {
    return processFailure.reason;
  }
  const firstFailure = results.find((result) => result.status === "rejected");
  return firstFailure?.status === "rejected" ? firstFailure.reason : null;
}

export async function waitForHostedWorkspaceSnapshotProcessPipe(
  pipe: Promise<void>,
  processExits: readonly Promise<void>[],
): Promise<void> {
  try {
    await pipe;
  } catch (error) {
    if (!isHostedWorkspaceSnapshotPipeCloseError(error)) {
      throw error;
    }
    const processFailure = await readHostedWorkspaceSnapshotProcessFailure(processExits);
    if (processFailure) {
      throw processFailure;
    }
  }
}

function shouldPreferHostedWorkspaceSnapshotProcessFailure(error: unknown): boolean {
  if (readHostedWorkspaceSnapshotProcessFailureDiagnostics(error)) {
    return true;
  }
  return isHostedWorkspaceSnapshotPipeCloseError(error);
}

function isHostedWorkspaceSnapshotPipeCloseError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (
    isNodeErrorCode(error, "ERR_STREAM_PREMATURE_CLOSE")
    || isNodeErrorCode(error, "EPIPE")
  ) {
    return true;
  }
  return /(?:premature close|\bEPIPE\b|write after end|stream closed|aborted)/iu
    .test(error.message);
}

function annotateHostedWorkspaceSnapshotProcessFailure(
  error: Error,
  diagnostics: HostedWorkspaceSnapshotProcessFailureDiagnostics,
): void {
  try {
    Object.defineProperty(error, HOSTED_WORKSPACE_SNAPSHOT_PROCESS_FAILURE_MARKER, {
      configurable: true,
      enumerable: false,
      value: diagnostics,
    });
  } catch {
    // Best-effort diagnostics only; never mask the original process failure.
  }
}

function captureHostedWorkspaceSnapshotProcessStderr(
  stream: Readable | null,
): HostedWorkspaceSnapshotProcessStderrCapture {
  let byteCount = 0;
  let lineBreakCount = 0;
  let scanText = "";
  let sawNonWhitespace = false;
  let endedWithLineBreak = false;
  const markers = new Set<HostedWorkspaceSnapshotProcessStderrMarker>();

  stream?.on("data", (chunk: Buffer | string) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    byteCount += Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(text);
    lineBreakCount += countHostedWorkspaceSnapshotLineBreaks(text);
    sawNonWhitespace = sawNonWhitespace || text.trim().length > 0;
    endedWithLineBreak = /(?:\r\n|\r|\n)$/u.test(text);
    scanText = `${scanText}${text}`.slice(
      -HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_SCAN_LIMIT_BYTES,
    );
    for (const marker of collectHostedWorkspaceSnapshotProcessStderrMarkers(scanText)) {
      markers.add(marker);
    }
  });
  stream?.resume();

  return {
    read: () => ({
      stderrByteCount: byteCount,
      stderrLineCount: sawNonWhitespace
        ? lineBreakCount + (endedWithLineBreak ? 0 : 1)
        : 0,
      stderrMarkers: [...markers].sort(),
      stderrTruncated:
        byteCount > HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_SCAN_LIMIT_BYTES,
    }),
  };
}

function collectHostedWorkspaceSnapshotProcessStderrMarkers(
  value: string,
): HostedWorkspaceSnapshotProcessStderrMarker[] {
  const markers = new Set<HostedWorkspaceSnapshotProcessStderrMarker>();
  for (const { marker, pattern } of HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKER_PATTERNS) {
    if (pattern.test(value)) {
      markers.add(marker);
    }
  }
  return [...markers];
}

function countHostedWorkspaceSnapshotLineBreaks(value: string): number {
  return value.match(/\r\n|\r|\n/gu)?.length ?? 0;
}

function readHostedWorkspaceSnapshotProcessFailureDiagnosticsValue(
  value: unknown,
): HostedWorkspaceSnapshotProcessFailureDiagnostics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const label = readHostedWorkspaceSnapshotProcessLabel(record.label);
  if (!label) {
    return null;
  }
  const exitCode = readNullableHostedWorkspaceSnapshotProcessInteger(record.exitCode);
  const signal = readNullableHostedWorkspaceSnapshotProcessSignal(record.signal);
  const stderrByteCount = readHostedWorkspaceSnapshotProcessCount(
    record.stderrByteCount,
  );
  const stderrLineCount = readHostedWorkspaceSnapshotProcessCount(
    record.stderrLineCount,
  );
  if (stderrByteCount === null || stderrLineCount === null) {
    return null;
  }
  return {
    exitCode,
    label,
    signal,
    stderrByteCount,
    stderrLineCount,
    stderrMarkers: readHostedWorkspaceSnapshotProcessStderrMarkers(
      record.stderrMarkers,
    ),
    stderrTruncated: record.stderrTruncated === true,
  };
}

function readHostedWorkspaceSnapshotProcessLabel(
  value: unknown,
): HostedWorkspaceSnapshotProcessLabel | null {
  return typeof value === "string"
    && HOSTED_WORKSPACE_SNAPSHOT_PROCESS_LABELS.includes(
      value as HostedWorkspaceSnapshotProcessLabel,
    )
    ? value as HostedWorkspaceSnapshotProcessLabel
    : null;
}

function readNullableHostedWorkspaceSnapshotProcessInteger(
  value: unknown,
): number | null {
  if (value === null) {
    return null;
  }
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readNullableHostedWorkspaceSnapshotProcessSignal(
  value: unknown,
): string | null {
  if (value === null) {
    return null;
  }
  return typeof value === "string" && /^[A-Z0-9]+$/u.test(value)
    ? value
    : null;
}

function readHostedWorkspaceSnapshotProcessCount(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 1024 * 1024
    ? value
    : null;
}

function readHostedWorkspaceSnapshotProcessStderrMarkers(
  value: unknown,
): HostedWorkspaceSnapshotProcessStderrMarker[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowed = new Set<HostedWorkspaceSnapshotProcessStderrMarker>();
  for (const entry of value) {
    if (
      typeof entry === "string"
      && HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKERS.includes(
        entry as HostedWorkspaceSnapshotProcessStderrMarker,
      )
    ) {
      allowed.add(entry as HostedWorkspaceSnapshotProcessStderrMarker);
    }
  }
  return [...allowed].sort();
}
