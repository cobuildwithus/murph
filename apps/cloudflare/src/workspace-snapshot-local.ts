import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { createReadStream, createWriteStream, type Stats } from "node:fs";
import {
  access,
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  decodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  serializeHostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

const HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES = 16;
const HOSTED_WORKSPACE_SNAPSHOT_ZSTD_ARGS = [
  "--fast=1",
  "--no-progress",
  "-T1",
] as const;
const HOSTED_WORKSPACE_SNAPSHOT_MAX_TAR_ENTRIES = 20_000;
const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_FAILURE_MARKER =
  Symbol("hosted.workspace-snapshot.process-failure");
const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_SCAN_LIMIT_BYTES = 8192;
const HOSTED_WORKSPACE_SNAPSHOT_RESTORE_INTEGRITY_CHECK_ENV =
  "MURPH_HOSTED_WORKSPACE_SNAPSHOT_RESTORE_INTEGRITY_CHECK";
const HOSTED_WORKSPACE_SNAPSHOT_RESTORE_INTEGRITY_SAMPLE_RATE_ENV =
  "MURPH_HOSTED_WORKSPACE_SNAPSHOT_RESTORE_INTEGRITY_SAMPLE_RATE";

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
  stderrTail: string | null;
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
  archiveEntries?: readonly WorkspaceSnapshotArchiveEntryInput[];
  dataKey: string;
  durableRoot: string;
  ivBase64: string;
  maxEncryptedBytes: number;
  outputDir: string;
}): Promise<EncryptedWorkspaceSnapshotFile> {
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
  const preflight = await readHostedWorkspaceSnapshotState({
    archiveEntries: input.archiveEntries,
    durableRoot,
  });
  let dataKey: Uint8Array | null = null;
  let completed = false;

  try {
    const tarListPath = input.archiveEntries
      ? path.join(tempDir, "workspace-snapshot-tar-list.txt")
      : null;
    if (tarListPath) {
      await writeFile(
        tarListPath,
        Buffer.from(preflight.tarEntryPaths.map((entryPath) => `./${entryPath}\0`).join("")),
        { mode: 0o600 },
      );
    }
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
    await assertHostedWorkspaceSnapshotZstdCliAvailable();
    const tarArgs = tarListPath
      ? [
          "-C",
          durableRoot,
          "--no-recursion",
          "--null",
          "-T",
          tarListPath,
          "-cf",
          "-",
        ]
      : [
          "-C",
          durableRoot,
          "-cf",
          "-",
          ".",
        ];
    const tar = spawn("tar", tarArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const zstd = spawn("zstd", [...HOSTED_WORKSPACE_SNAPSHOT_ZSTD_ARGS], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const tarExit = waitForHostedWorkspaceSnapshotProcess(tar, "tar");
    const zstdExit = waitForHostedWorkspaceSnapshotProcess(zstd, "zstd");

    try {
      if (!tar.stdout) {
        throw new Error("Hosted workspace snapshot tar stdout is unavailable.");
      }
      if (!zstd.stdin || !zstd.stdout) {
        throw new Error("Hosted workspace snapshot zstd streams are unavailable.");
      }
      await Promise.all([
        pipeline(tar.stdout, zstd.stdin),
        pipeline(
          zstd.stdout,
          createHashTransform(plaintextArchiveHash),
          cipher,
          encryptedCounter,
          createWriteStream(encryptedFilePath, { mode: 0o600 }),
        ),
        tarExit,
        zstdExit,
      ]);
    } catch (error) {
      tar.kill("SIGTERM");
      zstd.kill("SIGTERM");
      const processFailure = await readHostedWorkspaceSnapshotProcessFailure([
        tarExit,
        zstdExit,
      ]);
      if (
        processFailure
        && shouldPreferHostedWorkspaceSnapshotProcessFailure(error)
      ) {
        throw processFailure;
      }
      throw error;
    }

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
    const postArchivePreflight = await readHostedWorkspaceSnapshotState({
      archiveEntries: input.archiveEntries,
      durableRoot,
    });
    assertHostedWorkspaceSnapshotDurableRootUnchanged(preflight, postArchivePreflight);

    completed = true;
    return {
      compression: HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
      encryptedByteSize,
      encryptedFilePath,
      encryptedObjectSha256: encryptedObjectHash.digest("hex"),
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
  restorePreflightMs: number;
  durableRootReplaceMs: number;
  cleanupMs: number;
  extractMs: number;
}

export async function restoreEncryptedWorkspaceSnapshot(input: {
  dataKey: string;
  durableRoot: string;
  encryptedFilePath: string;
  postExtractIntegrityCheck?: boolean;
  ref: HostedWorkspaceSnapshotV2Ref;
  scratchRoot?: string | null;
}): Promise<RestoreEncryptedWorkspaceSnapshotTimings> {
  if (input.ref.archive.compression !== HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION) {
    throw new Error("Hosted workspace snapshot restore only supports zstd archives.");
  }
  const encryptedFilePath = path.resolve(input.encryptedFilePath);
  const encryptedStat = await stat(encryptedFilePath);
  if (encryptedStat.size !== input.ref.archive.encryptedByteSize) {
    throw new Error("Hosted workspace snapshot encrypted size does not match its ref.");
  }
  if (encryptedStat.size <= HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES) {
    throw new Error("Hosted workspace snapshot encrypted object is too small.");
  }

  const durableRoot = path.resolve(input.durableRoot);
  const durableParent = path.dirname(durableRoot);
  const scratchRoot = input.scratchRoot ? path.resolve(input.scratchRoot) : null;
  if (scratchRoot && isSameOrDescendantPath(scratchRoot, durableRoot)) {
    throw new Error("Hosted workspace snapshot restore scratchRoot must be outside durableRoot.");
  }
  await mkdir(durableParent, { mode: 0o700, recursive: true });
  if (scratchRoot) {
    await mkdir(scratchRoot, { mode: 0o700, recursive: true });
    await assertHostedWorkspaceSnapshotPathOutsideRoot({
      candidate: scratchRoot,
      message: "Hosted workspace snapshot restore scratchRoot must be outside durableRoot.",
      root: durableRoot,
    });
  }
  await assertHostedWorkspaceSnapshotZstdCliAvailable();
  const restoreTempDir = await mkdtemp(path.join(durableParent, ".workspace-snapshot-restore-"));
  const scratchTempDir = scratchRoot
    ? await mkdtemp(path.join(scratchRoot, "workspace-snapshot-restore-"))
    : restoreTempDir;
  const restoreRoot = path.join(restoreTempDir, "durable-root");
  const backupRoot = path.join(restoreTempDir, "previous-durable-root");
  let dataKey: Uint8Array | null = null;
  let decryptMs = 0;
  let archiveExtractMs = 0;
  let restorePreflightMs = 0;
  let durableRootReplaceMs = 0;
  let cleanupMs = 0;
  let extractMs = 0;

  try {
    const decryptStartedAt = Date.now();
    await mkdir(restoreRoot, { mode: 0o700, recursive: true });
    const authTag = await readHostedWorkspaceSnapshotAuthTag(
      encryptedFilePath,
      encryptedStat.size,
    );
    dataKey = decodeHostedWorkspaceSnapshotV2DataKey(input.dataKey);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(dataKey),
      Buffer.from(input.ref.encryption.ivBase64, "base64url"),
    );
    decipher.setAAD(Buffer.from(serializeHostedWorkspaceSnapshotV2Aad(input.ref.encryption.aad)));
    decipher.setAuthTag(authTag);

    const encryptedObjectHash = createHash("sha256");
    const plaintextArchiveHash = createHash("sha256");
    const plaintextArchivePath = path.join(scratchTempDir, "workspace.snapshot.tar.zst");
    await pipeline(
      createReadStream(encryptedFilePath, {
        end: encryptedStat.size - HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES - 1,
        start: 0,
      }),
      createHashTransform(encryptedObjectHash),
      decipher,
      createHashTransform(plaintextArchiveHash),
      createWriteStream(plaintextArchivePath, { mode: 0o600 }),
    );

    encryptedObjectHash.update(authTag);
    const encryptedObjectSha256 = encryptedObjectHash.digest("hex");
    if (encryptedObjectSha256 !== input.ref.archive.encryptedObjectSha256) {
      throw new Error("Hosted workspace snapshot encrypted digest does not match its ref.");
    }

    const plaintextArchiveSha256 = plaintextArchiveHash.digest("hex");
    if (plaintextArchiveSha256 !== input.ref.archive.plaintextArchiveSha256) {
      throw new Error("Hosted workspace snapshot plaintext archive digest does not match its ref.");
    }
    await assertHostedWorkspaceSnapshotTarEntriesSafe(plaintextArchivePath, {
      expectedFileCount: input.ref.archive.fileCount,
      expectedTotalPlainBytes: input.ref.archive.totalPlainBytes,
    });
    decryptMs = Date.now() - decryptStartedAt;

    const extractStartedAt = Date.now();
    const archiveExtractStartedAt = Date.now();
    const zstd = spawn("zstd", [
      "-d",
      "--stdout",
      plaintextArchivePath,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tar = spawn("tar", [
      "-C",
      restoreRoot,
      "--no-same-owner",
      "--no-same-permissions",
      "-xf",
      "-",
    ], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const zstdExit = waitForHostedWorkspaceSnapshotProcess(zstd, "zstd");
    const tarExit = waitForHostedWorkspaceSnapshotProcess(tar, "tar");
    try {
      if (!zstd.stdout || !tar.stdin) {
        throw new Error("Hosted workspace snapshot restore archive streams are unavailable.");
      }
      await Promise.all([
        pipeline(zstd.stdout, tar.stdin),
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
      if (
        processFailure
        && shouldPreferHostedWorkspaceSnapshotProcessFailure(error)
      ) {
        throw processFailure;
      }
      throw error;
    }
    archiveExtractMs = Date.now() - archiveExtractStartedAt;

    if (shouldRunHostedWorkspaceSnapshotPostExtractIntegrityCheck(input.postExtractIntegrityCheck)) {
      const restorePreflightStartedAt = Date.now();
      const restoredState = await preflightHostedWorkspaceSnapshotDurableRoot(restoreRoot);
      if (
        restoredState.fileCount !== input.ref.archive.fileCount
        || restoredState.totalPlainBytes !== input.ref.archive.totalPlainBytes
      ) {
        throw new Error("Hosted workspace snapshot restored state does not match its ref.");
      }
      restorePreflightMs = Date.now() - restorePreflightStartedAt;
    }

    const durableRootReplaceStartedAt = Date.now();
    await replaceHostedWorkspaceSnapshotDurableRoot({
      backupRoot,
      durableRoot,
      restoreRoot,
    });
    durableRootReplaceMs = Date.now() - durableRootReplaceStartedAt;
    extractMs = Date.now() - extractStartedAt;
  } finally {
    dataKey?.fill(0);
    const cleanupStartedAt = Date.now();
    try {
      if (scratchTempDir !== restoreTempDir) {
        await rm(scratchTempDir, { force: true, recursive: true });
      }
      await rm(restoreTempDir, { force: true, recursive: true });
    } finally {
      cleanupMs = Date.now() - cleanupStartedAt;
    }
  }

  return {
    decryptMs,
    archiveExtractMs,
    restorePreflightMs,
    durableRootReplaceMs,
    cleanupMs,
    extractMs,
  };
}

export async function preflightHostedWorkspaceSnapshotDurableRoot(
  durableRoot: string,
): Promise<{ fileCount: number; totalPlainBytes: number }> {
  const state = await readHostedWorkspaceSnapshotDurableRootState(durableRoot);
  return {
    fileCount: state.fileCount,
    totalPlainBytes: state.totalPlainBytes,
  };
}

interface HostedWorkspaceSnapshotDurableRootState {
  directoryCount: number;
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

async function readHostedWorkspaceSnapshotState(input: {
  archiveEntries?: readonly WorkspaceSnapshotArchiveEntryInput[];
  durableRoot: string;
}): Promise<HostedWorkspaceSnapshotDurableRootState> {
  return input.archiveEntries
    ? await readHostedWorkspaceSnapshotSelectedEntryState({
        archiveEntries: input.archiveEntries,
        durableRoot: input.durableRoot,
      })
    : await readHostedWorkspaceSnapshotDurableRootState(input.durableRoot);
}

async function readHostedWorkspaceSnapshotSelectedEntryState(input: {
  archiveEntries: readonly WorkspaceSnapshotArchiveEntryInput[];
  durableRoot: string;
}): Promise<HostedWorkspaceSnapshotDurableRootState> {
  const root = path.resolve(input.durableRoot);
  await access(root);
  let directoryCount = 0;
  let entryCount = 0;
  let fileCount = 0;
  const files = new Map<string, HostedWorkspaceSnapshotDurableRootFileState>();
  const seen = new Set<string>();
  const tarEntryPaths: string[] = [];
  let totalPlainBytes = 0;

  for (const entry of input.archiveEntries) {
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
    });
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
      directoryCount += 1;
    }
    tarEntryPaths.push(archivePath);
  }

  return { directoryCount, entryCount, fileCount, files, tarEntryPaths, totalPlainBytes };
}

async function readHostedWorkspaceSnapshotSelectedEntryStats(input: {
  archivePath: string;
  root: string;
}): Promise<Stats> {
  const segments = input.archivePath.split("/");
  let currentPath = input.root;
  let stats: Awaited<ReturnType<typeof lstat>> | null = null;
  for (const [index, segment] of segments.entries()) {
    currentPath = path.join(currentPath, segment);
    stats = await lstat(currentPath);
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

async function readHostedWorkspaceSnapshotDurableRootState(
  durableRoot: string,
): Promise<HostedWorkspaceSnapshotDurableRootState> {
  const root = path.resolve(durableRoot);
  await access(root);
  let directoryCount = 0;
  let entryCount = 0;
  let fileCount = 0;
  const files = new Map<string, HostedWorkspaceSnapshotDurableRootFileState>();
  const tarEntryPaths: string[] = [];
  let totalPlainBytes = 0;

  async function visit(currentPath: string): Promise<void> {
    const stats = await lstat(currentPath);
    const relativePath = path.relative(root, currentPath).split(path.sep).join(path.posix.sep);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("Hosted workspace snapshot path escaped the durable root.");
    }
    if (relativePath.length > 0) {
      assertHostedWorkspaceSnapshotRelativePathSafe(relativePath);
      tarEntryPaths.push(relativePath);
    }
    entryCount += 1;
    if (entryCount > HOSTED_WORKSPACE_SNAPSHOT_MAX_TAR_ENTRIES) {
      throw new Error("Hosted workspace snapshot durable root contains too many entries.");
    }
    if (isHostedWorkspaceSnapshotEnvPath(relativePath)) {
      throw new Error("Hosted workspace snapshot durable root contains environment files.");
    }
    if (stats.isSymbolicLink()) {
      throw new Error("Hosted workspace snapshot durable root contains symlinks.");
    }
    if (stats.isSocket() || stats.isFIFO() || stats.isBlockDevice() || stats.isCharacterDevice()) {
      throw new Error("Hosted workspace snapshot durable root contains unsupported special files.");
    }
    if (stats.isFile()) {
      if (stats.nlink > 1) {
        throw new Error("Hosted workspace snapshot durable root contains hardlinks.");
      }
      fileCount += 1;
      files.set(relativePath, {
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      });
      totalPlainBytes += stats.size;
      return;
    }
    if (!stats.isDirectory()) {
      throw new Error("Hosted workspace snapshot durable root contains unsupported entries.");
    }
    directoryCount += 1;

    const entries = await readdir(currentPath);
    await Promise.all(entries.map((entry) => visit(path.join(currentPath, entry))));
  }

  await visit(root);
  return { directoryCount, entryCount, fileCount, files, tarEntryPaths, totalPlainBytes };
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

async function assertHostedWorkspaceSnapshotTarEntriesSafe(
  archivePath: string,
  limits: {
    expectedFileCount: number;
    expectedTotalPlainBytes: number;
  },
): Promise<void> {
  if (
    !Number.isSafeInteger(limits.expectedFileCount)
    || limits.expectedFileCount < 0
    || !Number.isSafeInteger(limits.expectedTotalPlainBytes)
    || limits.expectedTotalPlainBytes < 0
  ) {
    throw new Error("Hosted workspace snapshot archive manifest is unsafe.");
  }
  const entries = await listHostedWorkspaceSnapshotVerboseTarEntries(archivePath);
  let fileCount = 0;
  const seen = new Set<string>();
  let totalPlainBytes = 0;
  for (const entry of entries) {
    const type = entry[0];
    if (type !== "-" && type !== "d") {
      throw new Error("Hosted workspace snapshot tar entry type is unsafe.");
    }
    const parsed = parseHostedWorkspaceSnapshotVerboseTarEntry(entry);
    const normalized = parsed.path
      .replace(/\\/gu, "/")
      .replace(/\/+/gu, "/")
      .replace(/^\.\/+/u, "");
    const normalizedForSafety = normalized.replace(/\/+$/u, "");
    if (normalizedForSafety.length === 0 && parsed.type === "d") {
      continue;
    }
    assertHostedWorkspaceSnapshotRelativePathSafe(
      normalizedForSafety,
      "Hosted workspace snapshot tar entry path is unsafe.",
    );
    if (isHostedWorkspaceSnapshotEnvPath(normalizedForSafety)) {
      throw new Error("Hosted workspace snapshot durable root contains environment files.");
    }
    if (seen.has(normalizedForSafety)) {
      throw new Error("Hosted workspace snapshot tar archive contains duplicate entries.");
    }
    seen.add(normalizedForSafety);
    if (parsed.type === "-") {
      fileCount += 1;
      totalPlainBytes += parsed.size;
      if (
        fileCount > limits.expectedFileCount
        || !Number.isSafeInteger(totalPlainBytes)
        || totalPlainBytes > limits.expectedTotalPlainBytes
      ) {
        throw new Error("Hosted workspace snapshot archive manifest does not match its ref.");
      }
    }
  }
  if (
    fileCount !== limits.expectedFileCount
    || totalPlainBytes !== limits.expectedTotalPlainBytes
  ) {
    throw new Error("Hosted workspace snapshot archive manifest does not match its ref.");
  }
}

function shouldRunHostedWorkspaceSnapshotPostExtractIntegrityCheck(
  override: boolean | undefined,
): boolean {
  if (typeof override === "boolean") {
    return override;
  }
  const explicit = parseHostedWorkspaceSnapshotBooleanEnv(
    process.env[HOSTED_WORKSPACE_SNAPSHOT_RESTORE_INTEGRITY_CHECK_ENV],
  );
  if (explicit !== null) {
    return explicit;
  }
  const sampleRateText =
    process.env[HOSTED_WORKSPACE_SNAPSHOT_RESTORE_INTEGRITY_SAMPLE_RATE_ENV];
  if (typeof sampleRateText !== "string" || sampleRateText.trim().length === 0) {
    return false;
  }
  const sampleRate = Number(sampleRateText);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return false;
  }
  if (sampleRate >= 1) {
    return true;
  }
  return Math.random() < sampleRate;
}

function parseHostedWorkspaceSnapshotBooleanEnv(value: string | undefined): boolean | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return null;
}

async function listHostedWorkspaceSnapshotVerboseTarEntries(
  archivePath: string,
): Promise<string[]> {
  const tar = spawn("tar", [
    "-tvf",
    "-",
  ], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const zstd = spawn("zstd", [
    "-d",
    "--stdout",
    archivePath,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!zstd.stdout || !tar.stdin) {
    throw new Error("Hosted workspace snapshot tar list streams are unavailable.");
  }
  if (!tar.stdout) {
    throw new Error("Hosted workspace snapshot tar list stdout is unavailable.");
  }
  tar.stdout.setEncoding("utf8");
  const zstdExit = waitForHostedWorkspaceSnapshotProcess(zstd, "zstd");
  const tarExit = waitForHostedWorkspaceSnapshotProcess(tar, "tar");
  const archivePipe = pipeline(zstd.stdout, tar.stdin);
  const lines = createInterface({
    crlfDelay: Number.POSITIVE_INFINITY,
    input: tar.stdout,
  });
  const entries: string[] = [];
  try {
    for await (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }
      entries.push(line);
      if (entries.length > HOSTED_WORKSPACE_SNAPSHOT_MAX_TAR_ENTRIES) {
        throw new Error("Hosted workspace snapshot tar entry count is unsafe.");
      }
    }
    await archivePipe;
    await Promise.all([zstdExit, tarExit]);
  } catch (error) {
    zstd.kill("SIGTERM");
    tar.kill("SIGTERM");
    const processFailure = await readHostedWorkspaceSnapshotProcessFailure([
      zstdExit,
      tarExit,
    ]);
    await Promise.allSettled([archivePipe]);
    if (
      processFailure
      && shouldPreferHostedWorkspaceSnapshotProcessFailure(error)
    ) {
      throw processFailure;
    }
    throw error;
  }
  return entries;
}

function parseHostedWorkspaceSnapshotVerboseTarEntry(entry: string): {
  path: string;
  size: number;
  type: "-" | "d";
} {
  const type = entry[0];
  if (type !== "-" && type !== "d") {
    throw new Error("Hosted workspace snapshot tar entry type is unsafe.");
  }
  const parsed = parseHostedWorkspaceSnapshotVerboseTarEntryFields(entry);
  if (!parsed) {
    throw new Error("Hosted workspace snapshot tar entry format is unsupported.");
  }
  return {
    path: parsed.path,
    size: parsed.size,
    type,
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

function decodeHostedWorkspaceSnapshotIv(value: string): Buffer {
  const iv = Buffer.from(value, "base64url");
  if (iv.byteLength !== 12) {
    throw new TypeError("Hosted workspace snapshot ivBase64 must decode to 12 bytes.");
  }
  return iv;
}

function createHashTransform(hash: ReturnType<typeof createHash>): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
}

async function readHostedWorkspaceSnapshotAuthTag(
  filePath: string,
  encryptedSize: number,
): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const authTag = Buffer.alloc(HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES);
    const result = await handle.read(
      authTag,
      0,
      HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES,
      encryptedSize - HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES,
    );
    if (result.bytesRead !== HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES) {
      throw new Error("Hosted workspace snapshot auth tag is incomplete.");
    }
    return authTag;
  } finally {
    await handle.close();
  }
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

async function assertHostedWorkspaceSnapshotZstdCliAvailable(): Promise<void> {
  const zstd = spawn("zstd", ["--version"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  await waitForHostedWorkspaceSnapshotProcess(zstd, "zstd");
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

function shouldPreferHostedWorkspaceSnapshotProcessFailure(error: unknown): boolean {
  if (readHostedWorkspaceSnapshotProcessFailureDiagnostics(error)) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
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
      stderrTail: sawNonWhitespace ? scanText.trim() || null : null,
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
    stderrTail: readHostedWorkspaceSnapshotProcessStderrTail(record.stderrTail),
    stderrByteCount,
    stderrLineCount,
    stderrMarkers: readHostedWorkspaceSnapshotProcessStderrMarkers(
      record.stderrMarkers,
    ),
    stderrTruncated: record.stderrTruncated === true,
  };
}

function readHostedWorkspaceSnapshotProcessStderrTail(value: unknown): string | null {
  return typeof value === "string"
    && value.length > 0
    && value.length <= HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_SCAN_LIMIT_BYTES
    ? value
    : null;
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
