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
import { Transform } from "node:stream";
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
    tar.stderr?.resume();
    zstd.stderr?.resume();
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
      await Promise.allSettled([tarExit, zstdExit]);
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

export async function restoreEncryptedWorkspaceSnapshot(input: {
  dataKey: string;
  durableRoot: string;
  encryptedFilePath: string;
  ref: HostedWorkspaceSnapshotV2Ref;
  scratchRoot?: string | null;
}): Promise<void> {
  if (input.ref.archive.compression !== HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION) {
    throw new Error("Hosted workspace snapshot restore only supports zstd archives.");
  }
  const encryptedFilePath = path.resolve(input.encryptedFilePath);
  const encryptedStat = await stat(encryptedFilePath);
  if (encryptedStat.size !== input.ref.archive.encryptedByteSize) {
    throw new Error("Hosted workspace snapshot encrypted size does not match its ref.");
  }
  const encryptedObjectSha256 = await sha256FileHex(encryptedFilePath);
  if (encryptedObjectSha256 !== input.ref.archive.encryptedObjectSha256) {
    throw new Error("Hosted workspace snapshot encrypted digest does not match its ref.");
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

  try {
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

    const plaintextArchiveHash = createHash("sha256");
    const plaintextArchivePath = path.join(scratchTempDir, "workspace.snapshot.tar.zst");
    await pipeline(
      createReadStream(encryptedFilePath, {
        end: encryptedStat.size - HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES - 1,
        start: 0,
      }),
      decipher,
      createHashTransform(plaintextArchiveHash),
      createWriteStream(plaintextArchivePath, { mode: 0o600 }),
    );

    const plaintextArchiveSha256 = plaintextArchiveHash.digest("hex");
    if (plaintextArchiveSha256 !== input.ref.archive.plaintextArchiveSha256) {
      throw new Error("Hosted workspace snapshot plaintext archive digest does not match its ref.");
    }
    await assertHostedWorkspaceSnapshotTarEntriesSafe(plaintextArchivePath, {
      maxFileCount: input.ref.archive.fileCount,
      maxTotalPlainBytes: input.ref.archive.totalPlainBytes,
    });

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
    zstd.stderr?.resume();
    tar.stderr?.resume();
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
      await Promise.allSettled([zstdExit, tarExit]);
      throw error;
    }

    const restoredState = await preflightHostedWorkspaceSnapshotDurableRoot(restoreRoot);
    if (
      restoredState.fileCount !== input.ref.archive.fileCount
      || restoredState.totalPlainBytes !== input.ref.archive.totalPlainBytes
    ) {
      throw new Error("Hosted workspace snapshot restored state does not match its ref.");
    }

    await replaceHostedWorkspaceSnapshotDurableRoot({
      backupRoot,
      durableRoot,
      restoreRoot,
    });
  } finally {
    dataKey?.fill(0);
    if (scratchTempDir !== restoreTempDir) {
      await rm(scratchTempDir, { force: true, recursive: true });
    }
    await rm(restoreTempDir, { force: true, recursive: true });
  }
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
    maxFileCount: number;
    maxTotalPlainBytes: number;
  },
): Promise<void> {
  if (
    !Number.isSafeInteger(limits.maxFileCount)
    || limits.maxFileCount < 0
    || !Number.isSafeInteger(limits.maxTotalPlainBytes)
    || limits.maxTotalPlainBytes < 0
  ) {
    throw new Error("Hosted workspace snapshot archive manifest is unsafe.");
  }
  const entries = await listHostedWorkspaceSnapshotVerboseTarEntries(archivePath);
  let fileCount = 0;
  let totalPlainBytes = 0;
  for (const entry of entries) {
    const type = entry[0];
    if (type !== "-" && type !== "d") {
      throw new Error("Hosted workspace snapshot tar entry type is unsafe.");
    }
    const parsed = parseHostedWorkspaceSnapshotVerboseTarEntry(entry);
    const normalized = parsed.path.replace(/\\/gu, "/").replace(/^\.\/+/u, "");
    const normalizedForSafety = normalized.replace(/\/+$/u, "");
    if (normalizedForSafety.length === 0 && parsed.type === "d") {
      continue;
    }
    assertHostedWorkspaceSnapshotRelativePathSafe(
      normalizedForSafety,
      "Hosted workspace snapshot tar entry path is unsafe.",
    );
    if (parsed.type === "-") {
      fileCount += 1;
      totalPlainBytes += parsed.size;
      if (
        fileCount > limits.maxFileCount
        || !Number.isSafeInteger(totalPlainBytes)
        || totalPlainBytes > limits.maxTotalPlainBytes
      ) {
        throw new Error("Hosted workspace snapshot archive manifest does not match its ref.");
      }
    }
  }
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
  zstd.stderr?.resume();
  tar.stderr?.resume();
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
  } catch (error) {
    zstd.kill("SIGTERM");
    tar.kill("SIGTERM");
    await Promise.allSettled([archivePipe, zstdExit, tarExit]);
    throw error;
  }
  await Promise.all([zstdExit, tarExit]);
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

async function sha256FileHex(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
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
  zstd.stderr?.resume();
  await waitForHostedWorkspaceSnapshotProcess(zstd, "zstd");
}

function waitForHostedWorkspaceSnapshotProcess(
  process: ReturnType<typeof spawn>,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    process.once("error", reject);
    process.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const status = signal ?? `exit code ${code ?? "unknown"}`;
      reject(new Error(`Hosted workspace snapshot ${label} command failed with ${status}.`));
    });
  });
}
