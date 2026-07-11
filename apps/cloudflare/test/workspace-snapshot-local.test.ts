import { execFile, execFileSync } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";
import { access, chmod, link, mkdir, mkdtemp, readdir, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  type HostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  collectHostedWorkspaceSnapshotArchivePlan,
} from "@murphai/runtime-state/node";
import {
  createEncryptedWorkspaceSnapshotFile,
  type EncryptedWorkspaceSnapshotFile,
  restoreEncryptedWorkspaceSnapshot,
  restoreEncryptedWorkspaceSnapshotFromEncryptedStream,
  waitForHostedWorkspaceSnapshotProcessPipe,
} from "../src/workspace-snapshot-local.js";
import {
  buildHostedRuntimeSafeErrorMetadata,
} from "../src/runtime-platform/diagnostics.js";

const execFileAsync = promisify(execFile);

describe("workspace snapshot process pipes", () => {
  it("ignores premature stream closes when the child commands exit cleanly", async () => {
    await expect(waitForHostedWorkspaceSnapshotProcessPipe(
      Promise.reject(Object.assign(new Error("Premature close"), {
        code: "ERR_STREAM_PREMATURE_CLOSE",
      })),
      [Promise.resolve(), Promise.resolve()],
    )).resolves.toBeUndefined();
  });

  it("keeps the child command failure when a premature stream close accompanies it", async () => {
    const processError = new Error("Hosted workspace snapshot zstd command failed with exit code 1.");
    const processExit = Promise.reject(processError);
    processExit.catch(() => undefined);

    await expect(waitForHostedWorkspaceSnapshotProcessPipe(
      Promise.reject(Object.assign(new Error("Premature close"), {
        code: "ERR_STREAM_PREMATURE_CLOSE",
      })),
      [Promise.resolve(), processExit],
    )).rejects.toBe(processError);
  });

  it("does not hide ordinary stream errors", async () => {
    await expect(waitForHostedWorkspaceSnapshotProcessPipe(
      Promise.reject(new Error("snapshot stream transform failed")),
      [Promise.resolve(), Promise.resolve()],
    )).rejects.toThrow("snapshot stream transform failed");
  });
});

describe("workspace snapshot local restore", () => {
  it("round-trips selected portable workspace state and Codex continuity", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
    const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
    const restoredDurableRoot = path.join(tempRoot, "restored", "durable");
    const providerSessionId = "00000000-0000-4000-8000-000000000071";
    const rolloutRelativePath =
      `sessions/2026/05/20/rollout-2026-05-20T01-02-03-${providerSessionId}.jsonl`;
    const snapshotId = "snapshot_round_trip";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_round_trip.snapshot.enc";
    const userId = "member_123";
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await mkdir(path.join(sourceVaultRoot, ".runtime", "operations", "assistant", "sessions"), {
        recursive: true,
      });
      await mkdir(path.join(sourceVaultRoot, ".runtime", "projections"), { recursive: true });
      await mkdir(path.join(sourceVaultRoot, ".runtime", "cache"), { recursive: true });
      await mkdir(path.join(sourceVaultRoot, ".git"), { recursive: true });
      await mkdir(path.join(sourceOperatorHomeRoot, ".codex-hosted", path.dirname(rolloutRelativePath)), {
        recursive: true,
      });
      await mkdir(path.join(sourceOperatorHomeRoot, ".codex-hosted", "cache"), { recursive: true });
      await writeFile(path.join(sourceVaultRoot, "note.md"), "selected workspace\n", "utf8");
      await writeFile(
        path.join(sourceVaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
        JSON.stringify({
          resumeState: {
            codexRolloutRelativePath: rolloutRelativePath,
            providerSessionId,
            resumeRouteId: "route-ready",
          },
        }) + "\n",
        "utf8",
      );
      await writeFile(path.join(sourceVaultRoot, ".runtime", "projections", "query.sqlite"), "projection\n", "utf8");
      await writeFile(path.join(sourceVaultRoot, ".runtime", "cache", "cache.txt"), "cache\n", "utf8");
      await writeFile(path.join(sourceVaultRoot, ".git", "config"), "git config\n", "utf8");
      await writeFile(
        path.join(sourceOperatorHomeRoot, ".codex-hosted", rolloutRelativePath),
        "{\"type\":\"rollout\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceOperatorHomeRoot, ".codex-hosted", "cache", "runtime-cache.txt"),
        "runtime cache\n",
        "utf8",
      );

      const aad = buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      });
      const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot: sourceDurableRoot,
        operatorHomeRoot: sourceOperatorHomeRoot,
        vaultRoot: sourceVaultRoot,
      });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: archivePlan.entries,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: sourceDurableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      });
      const ref = createHostedWorkspaceSnapshotTestRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      });

      const restoreTimings = await restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: restoredDurableRoot,
        encryptedFilePath: encrypted.encryptedFilePath,
        ref,
      });

      for (const key of [
        "decryptMs",
        "archiveExtractMs",
        "durableRootReplaceMs",
        "cleanupMs",
        "extractMs",
      ] as const) {
        expect(typeof restoreTimings[key]).toBe("number");
        expect(Number.isFinite(restoreTimings[key])).toBe(true);
        expect(restoreTimings[key]).toBeGreaterThanOrEqual(0);
      }
      expect(restoreTimings.extractMs).toBeGreaterThanOrEqual(
        restoreTimings.archiveExtractMs,
      );

      const restoredVaultRoot = path.join(restoredDurableRoot, "vault");
      const restoredOperatorHomeRoot = path.join(restoredDurableRoot, "home");
      await expect(readFile(path.join(restoredVaultRoot, "note.md"), "utf8"))
        .resolves.toBe("selected workspace\n");
      await expect(readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", rolloutRelativePath), "utf8"))
        .resolves.toBe("{\"type\":\"rollout\"}\n");
      await expect(access(path.join(restoredVaultRoot, ".runtime", "projections", "query.sqlite")))
        .rejects.toThrow();
      await expect(access(path.join(restoredVaultRoot, ".runtime", "cache", "cache.txt")))
        .rejects.toThrow();
      await expect(access(path.join(restoredVaultRoot, ".git", "config"))).rejects.toThrow();
      await expect(access(path.join(restoredOperatorHomeRoot, ".codex-hosted", "cache", "runtime-cache.txt")))
        .rejects.toThrow();
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("round-trips portable Unicode and long paths under a scrubbed tar environment", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
    const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
    const restoredDurableRoot = path.join(tempRoot, "restored", "durable");
    const longFileName =
      `2026-06-21 café path with spaces ${"and-long-name-".repeat(12)}handling.md`;
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 21);
    const snapshotId = "snapshot_ordinary_paths";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_ordinary_paths.snapshot.enc";
    const userId = "member_123";
    const originalTarEnvironment = {
      LC_ALL: process.env.LC_ALL,
      TAR_OPTIONS: process.env.TAR_OPTIONS,
      TAR_READER_OPTIONS: process.env.TAR_READER_OPTIONS,
      TAR_WRITER_OPTIONS: process.env.TAR_WRITER_OPTIONS,
    };

    try {
      process.env.LC_ALL = "C";
      process.env.TAR_OPTIONS = "--help";
      process.env.TAR_READER_OPTIONS = "invalid-snapshot-reader-option";
      process.env.TAR_WRITER_OPTIONS = "invalid-snapshot-writer-option";
      expect(Buffer.byteLength(longFileName)).toBeGreaterThan(100);
      await mkdir(path.join(sourceVaultRoot, "journal", "2026"), { recursive: true });
      await mkdir(sourceOperatorHomeRoot, { recursive: true });
      await writeFile(
        path.join(sourceVaultRoot, "journal", "2026", longFileName),
        "ordinary planned path\n",
        "utf8",
      );
      const aad = buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      });
      const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot: sourceDurableRoot,
        operatorHomeRoot: sourceOperatorHomeRoot,
        vaultRoot: sourceVaultRoot,
      });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: archivePlan.entries,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: sourceDurableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 30))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      });
      const ref = createHostedWorkspaceSnapshotTestRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      });

      await restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: restoredDurableRoot,
        encryptedFilePath: encrypted.encryptedFilePath,
        ref,
      });

      await expect(readFile(
        path.join(restoredDurableRoot, "vault", "journal", "2026", longFileName),
        "utf8",
      )).resolves.toBe("ordinary planned path\n");
    } finally {
      for (const [key, value] of Object.entries(originalTarEnvironment)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("rejects snapshots at the encrypted size limit before preparing restore roots", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-limit-test-"));
    const durableRoot = path.join(tempRoot, "restored", "durable");
    const encryptedFilePath = path.join(tempRoot, "snapshot.enc");
    const snapshotId = "snapshot_size_limit";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_size_limit.snapshot.enc";
    const userId = "member_123";
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId,
      userId,
    });
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await writeFile(encryptedFilePath, "");
      await truncate(encryptedFilePath, HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES);

      const ref: HostedWorkspaceSnapshotV2Ref = {
        archive: {
          compression: "zstd",
          encryptedByteSize: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
          encryptedObjectSha256: "0".repeat(64),
          fileCount: 0,
          format: "tar",
          plaintextArchiveSha256: "0".repeat(64),
          totalPlainBytes: 0,
        },
        createdAt: "2026-05-20T00:00:00.000Z",
        encryption: {
          aad,
          ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
            .toString("base64url"),
          rootKeyId: "root_key_test",
          scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
          wrappedDataKey: "wrapped_data_key_test",
        },
        objectKey,
        schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
        snapshotId,
        upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
        userId,
      };

      await expect(restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        encryptedFilePath,
        ref,
      })).rejects.toThrow("Hosted workspace snapshot exceeds the single-part size limit.");
      await expect(access(durableRoot)).rejects.toThrow();
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("rejects snapshots at the total plain size limit before preparing restore roots", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-plain-limit-test-"));
    const durableRoot = path.join(tempRoot, "restored", "durable");
    const encryptedFilePath = path.join(tempRoot, "snapshot.enc");
    const snapshotId = "snapshot_plain_size_limit";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_plain_size_limit.snapshot.enc";
    const userId = "member_123";
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId,
      userId,
    });
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await writeFile(encryptedFilePath, Buffer.alloc(17));

      const ref: HostedWorkspaceSnapshotV2Ref = {
        archive: {
          compression: "zstd",
          encryptedByteSize: 17,
          encryptedObjectSha256: "0".repeat(64),
          fileCount: 1,
          format: "tar",
          plaintextArchiveSha256: "0".repeat(64),
          totalPlainBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
        },
        createdAt: "2026-05-20T00:00:00.000Z",
        encryption: {
          aad,
          ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
            .toString("base64url"),
          rootKeyId: "root_key_test",
          scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
          wrappedDataKey: "wrapped_data_key_test",
        },
        objectKey,
        schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
        snapshotId,
        upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
        userId,
      };

      await expect(restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        encryptedFilePath,
        ref,
      })).rejects.toThrow("Hosted workspace snapshot exceeds the total plain size limit.");
      await expect(access(durableRoot)).rejects.toThrow();
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("rejects snapshot creation at the total plain size limit before archiving", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-create-plain-limit-test-"));
    const durableRoot = path.join(tempRoot, "source", "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const largeFilePath = path.join(vaultRoot, "large.bin");
    const outputDir = path.join(tempRoot, "scratch");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const snapshotId = "snapshot_create_plain_size_limit";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_create_plain_size_limit.snapshot.enc";
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId,
      userId: "member_123",
    });

    try {
      await mkdir(vaultRoot, { mode: 0o700, recursive: true });
      await writeFile(largeFilePath, "");
      await truncate(largeFilePath, HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES);

      await expect(createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: [{
          absolutePath: largeFilePath,
          archivePath: "vault/large.bin",
          kind: "file",
        }],
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
        outputDir,
      })).rejects.toThrow("Hosted workspace snapshot exceeds the total plain size limit.");
      await expect(readdir(outputDir)).resolves.toEqual([]);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("restores encrypted snapshots from an encrypted byte stream", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-stream-test-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
    const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
    const restoredDurableRoot = path.join(tempRoot, "restored", "durable");
    const snapshotId = "snapshot_stream_restore";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_stream_restore.snapshot.enc";
    const userId = "member_123";
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await mkdir(sourceVaultRoot, { recursive: true });
      await mkdir(sourceOperatorHomeRoot, { recursive: true });
      await writeFile(path.join(sourceVaultRoot, "note.md"), "stream restored\n", "utf8");

      const aad = buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      });
      const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot: sourceDurableRoot,
        operatorHomeRoot: sourceOperatorHomeRoot,
        vaultRoot: sourceVaultRoot,
      });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: archivePlan.entries,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: sourceDurableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      });
      const encryptedBytes = await readFile(encrypted.encryptedFilePath);
      const ref = createHostedWorkspaceSnapshotTestRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      });

      const restoreTimings = await restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: restoredDurableRoot,
        encryptedStream: streamEncryptedChunks(splitEncryptedSnapshotAcrossAuthTagBoundary(encryptedBytes)),
        ref,
      });

      expect(typeof restoreTimings.decryptMs).toBe("number");
      expect(Number.isFinite(restoreTimings.decryptMs)).toBe(true);
      await expect(readFile(path.join(restoredDurableRoot, "vault", "note.md"), "utf8"))
        .resolves.toBe("stream restored\n");
      await expect(readdir(path.dirname(restoredDurableRoot))).resolves.toEqual(["durable"]);
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("rejects encrypted stream auth failures without replacing durable state", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-stream-auth-test-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
    const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
    const durableRoot = path.join(tempRoot, "durable");
    const existingDurableFile = path.join(durableRoot, "existing.txt");
    const snapshotId = "snapshot_stream_auth_fail";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_stream_auth_fail.snapshot.enc";
    const userId = "member_123";
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await mkdir(sourceVaultRoot, { recursive: true });
      await mkdir(sourceOperatorHomeRoot, { recursive: true });
      await writeFile(path.join(sourceVaultRoot, "note.md"), "should not restore\n", "utf8");
      await mkdir(durableRoot, { mode: 0o700, recursive: true });
      await writeFile(existingDurableFile, "existing durable root\n", { mode: 0o600 });

      const aad = buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      });
      const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot: sourceDurableRoot,
        operatorHomeRoot: sourceOperatorHomeRoot,
        vaultRoot: sourceVaultRoot,
      });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: archivePlan.entries,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: sourceDurableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      });
      const encryptedBytes = await readFile(encrypted.encryptedFilePath);
      const tamperedEncryptedBytes = Buffer.from(encryptedBytes);
      tamperedEncryptedBytes[tamperedEncryptedBytes.byteLength - 1] ^= 0xff;
      const ref = createHostedWorkspaceSnapshotTestRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      });

      await expect(restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        encryptedStream: streamEncryptedChunks([
          tamperedEncryptedBytes.subarray(0, tamperedEncryptedBytes.byteLength - 2),
          tamperedEncryptedBytes.subarray(tamperedEncryptedBytes.byteLength - 2),
        ]),
        ref,
      })).rejects.toThrow();

      await expect(readFile(existingDurableFile, "utf8")).resolves.toBe("existing durable root\n");
      await expect(access(path.join(durableRoot, "vault", "note.md"))).rejects.toThrow();
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("uses numeric tar ownership fields before rejecting environment files", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-owner-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const existingDurableFile = path.join(durableRoot, "existing.txt");
    const extractionMarker = path.join(tempRoot, "extraction-started");
    const wrapperDir = path.join(tempRoot, "bin");
    const tarWrapperPath = path.join(wrapperDir, "tar");
    const originalPath = process.env.PATH;
    const realTarPath = (await execFileAsync("which", ["tar"])).stdout.trim();
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 71);

    try {
      await mkdir(durableRoot, { mode: 0o700, recursive: true });
      await mkdir(wrapperDir, { mode: 0o700, recursive: true });
      await writeFile(existingDurableFile, "existing durable root\n", { mode: 0o600 });
      await writeFile(
        tarWrapperPath,
        `#!/bin/sh
listing=0
numeric_owner=0
extracting=0
for argument in "$@"; do
  if [ "$argument" = "-tvf" ]; then listing=1; fi
  if [ "$argument" = "--numeric-owner" ]; then numeric_owner=1; fi
  if [ "$argument" = "-xf" ]; then extracting=1; fi
done
if [ "$listing" = "1" ] && [ "$numeric_owner" != "1" ]; then
  exit 97
fi
if [ "$extracting" = "1" ]; then
  : > "\${MURPH_TEST_EXTRACTION_MARKER:?}" || exit 1
fi
exec "\${MURPH_TEST_REAL_TAR:?}" "$@"
`,
        { mode: 0o700 },
      );
      await chmod(tarWrapperPath, 0o700);
      process.env.MURPH_TEST_EXTRACTION_MARKER = extractionMarker;
      process.env.MURPH_TEST_REAL_TAR = realTarPath;
      process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath ?? ""}`;
      const fixture = await createAuthenticatedTarSnapshotFixture({
        dataKey,
        entries: [{
          content: "SECRET=placeholder\n",
          groupName: "group name",
          ownerName: "owner name",
          path: "vault/.env",
          type: "0",
        }],
        snapshotId: "snapshot_owner_metadata",
      });

      await expect(restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        encryptedStream: streamEncryptedChunks([fixture.encryptedBytes]),
        ref: fixture.ref,
      })).rejects.toThrow("Hosted workspace snapshot tar archive contains environment files.");

      await expect(readFile(existingDurableFile, "utf8")).resolves.toBe("existing durable root\n");
      await expect(access(extractionMarker)).rejects.toThrow();
      await expect(readdir(durableRoot)).resolves.toEqual(["existing.txt"]);
    } finally {
      process.env.PATH = originalPath;
      delete process.env.MURPH_TEST_EXTRACTION_MARKER;
      delete process.env.MURPH_TEST_REAL_TAR;
      dataKey.fill(0);
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it.each([
    {
      entries: [{ content: "absolute\n", path: "/absolute-escape.txt", type: "0" }],
      name: "absolute paths",
    },
    {
      entries: [{ content: "traversal\n", path: "../traversal-escape.txt", type: "0" }],
      name: "parent traversal",
    },
    {
      entries: [
        {
          content: createTestPaxRecord("path", "../pax-traversal-escape.txt"),
          path: "PaxHeaders.0/safe.txt",
          type: "x",
        },
        { content: "pax traversal\n", path: "vault/safe.txt", type: "0" },
      ],
      name: "PAX path traversal overrides",
    },
    {
      entries: [
        { content: "first\n", path: "vault/duplicate.txt", type: "0" },
        { content: "second\n", path: "./vault//duplicate.txt", type: "0" },
      ],
      name: "duplicate normalized paths",
    },
    {
      entries: [
        { content: "first\n", path: "vault/café.txt", type: "0" },
        { content: "second\n", path: "vault/cafe\u0301.txt", type: "0" },
      ],
      name: "Unicode-normalization aliases",
    },
    {
      entries: [{ content: "SECRET=placeholder\n", path: "vault/.envrc", type: "0" }],
      name: ".env-prefixed paths",
    },
    {
      entries: [{
        content: "{\"pid\":1}\n",
        path: "vault/.runtime/operations/assistant/.runtime-write.lock/owner.json",
        type: "0",
      }],
      name: "runtime write locks",
    },
    {
      entries: [{
        content: "secret\n",
        path: "vault/.runtime/operations/assistant/secrets/token.json",
        type: "0",
      }],
      name: "assistant secrets",
    },
    {
      entries: [{
        content: "quarantined\n",
        path: "vault/.runtime/operations/assistant/quarantine/item.json",
        type: "0",
      }],
      name: "assistant quarantine",
    },
    {
      entries: [{ content: "cache\n", path: "vault/.runtime/cache/parser.json", type: "0" }],
      name: "runtime cache",
    },
    {
      entries: [{ content: "temporary\n", path: "vault/.runtime/tmp/work.txt", type: "0" }],
      name: "runtime temporary state",
    },
    {
      entries: [{
        content: "projection\n",
        path: "vault/.runtime/projections/query.sqlite",
        type: "0",
      }],
      name: "runtime projections",
    },
    {
      entries: [{
        content: "sandbox_mode = \"danger-full-access\"\n",
        path: "home/.codex-hosted/config.toml",
        type: "0",
      }],
      name: "non-continuity operator-home files",
    },
    {
      entries: [{ content: "outside\n", path: "other/file.txt", type: "0" }],
      name: "unsupported durable roots",
    },
    {
      entries: [{ linkPath: "target.txt", path: "vault/link.txt", type: "2" }],
      name: "symbolic links",
    },
    {
      entries: [{ linkPath: "vault/target.txt", path: "vault/hardlink.txt", type: "1" }],
      name: "hard links",
    },
    {
      entries: [{ path: "vault/special.fifo", type: "6" }],
      name: "special files",
    },
    {
      entries: [{ path: "vault/unknown.entry", type: "7" }],
      name: "unknown entry types",
    },
    {
      entries: [{ content: "newline\n", path: "vault/safe\nforged-line.txt", type: "0" }],
      name: "control-character paths",
    },
  ] satisfies Array<{
    entries: TestTarEntry[];
    name: string;
  }>)("rejects authenticated archives containing $name before durable replacement", async ({
    entries,
  }) => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-unsafe-tar-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const existingDurableFile = path.join(durableRoot, "existing.txt");
    const extractionMarker = path.join(tempRoot, "extraction-started");
    const wrapperDir = path.join(tempRoot, "bin");
    const tarWrapperPath = path.join(wrapperDir, "tar");
    const originalPath = process.env.PATH;
    const realTarPath = (await execFileAsync("which", ["tar"])).stdout.trim();
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 81);

    try {
      await mkdir(durableRoot, { mode: 0o700, recursive: true });
      await mkdir(wrapperDir, { mode: 0o700, recursive: true });
      await writeFile(existingDurableFile, "existing durable root\n", { mode: 0o600 });
      await writeFile(
        tarWrapperPath,
        `#!/bin/sh
for argument in "$@"; do
  if [ "$argument" = "-xf" ]; then
    : > "\${MURPH_TEST_EXTRACTION_MARKER:?}" || exit 1
  fi
done
exec "\${MURPH_TEST_REAL_TAR:?}" "$@"
`,
        { mode: 0o700 },
      );
      await chmod(tarWrapperPath, 0o700);
      process.env.MURPH_TEST_EXTRACTION_MARKER = extractionMarker;
      process.env.MURPH_TEST_REAL_TAR = realTarPath;
      process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath ?? ""}`;
      const fixture = await createAuthenticatedTarSnapshotFixture({
        dataKey,
        entries,
        snapshotId: "snapshot_unsafe_tar_fixture",
      });

      await expect(restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        encryptedStream: streamEncryptedChunks([fixture.encryptedBytes]),
        ref: fixture.ref,
      })).rejects.toThrow();

      await expect(readFile(existingDurableFile, "utf8")).resolves.toBe("existing durable root\n");
      await expect(access(extractionMarker)).rejects.toThrow();
      await expect(readdir(durableRoot)).resolves.toEqual(["existing.txt"]);
    } finally {
      process.env.PATH = originalPath;
      delete process.env.MURPH_TEST_EXTRACTION_MARKER;
      delete process.env.MURPH_TEST_REAL_TAR;
      dataKey.fill(0);
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it.each([
    {
      fileCount: 2,
      name: "file count",
      totalPlainBytes: 5,
    },
    {
      fileCount: 1,
      name: "plain byte count",
      totalPlainBytes: 6,
    },
  ])("rejects authenticated archives whose $name differs from the ref", async ({
    fileCount,
    totalPlainBytes,
  }) => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-manifest-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 91);

    try {
      await mkdir(durableRoot, { mode: 0o700, recursive: true });
      await writeFile(path.join(durableRoot, "existing.txt"), "existing\n", "utf8");
      const fixture = await createAuthenticatedTarSnapshotFixture({
        dataKey,
        entries: [{ content: "12345", path: "vault/note.txt", type: "0" }],
        fileCount,
        snapshotId: "snapshot_manifest_mismatch",
        totalPlainBytes,
      });

      await expect(restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        encryptedStream: streamEncryptedChunks([fixture.encryptedBytes]),
        ref: fixture.ref,
      })).rejects.toThrow(
        "Hosted workspace snapshot tar archive manifest does not match its ref.",
      );
      await expect(readdir(durableRoot)).resolves.toEqual(["existing.txt"]);
    } finally {
      dataKey.fill(0);
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("rejects authenticated archives with excessive entry counts before extraction", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-entry-limit-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const extractionMarker = path.join(tempRoot, "extraction-started");
    const wrapperDir = path.join(tempRoot, "bin");
    const tarWrapperPath = path.join(wrapperDir, "tar");
    const originalPath = process.env.PATH;
    const realTarPath = (await execFileAsync("which", ["tar"])).stdout.trim();
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 101);

    try {
      await mkdir(durableRoot, { mode: 0o700, recursive: true });
      await mkdir(wrapperDir, { mode: 0o700, recursive: true });
      await writeFile(path.join(durableRoot, "existing.txt"), "existing\n", "utf8");
      await writeFile(
        tarWrapperPath,
        `#!/bin/sh
for argument in "$@"; do
  if [ "$argument" = "-xf" ]; then
    : > "\${MURPH_TEST_EXTRACTION_MARKER:?}" || exit 1
  fi
done
exec "\${MURPH_TEST_REAL_TAR:?}" "$@"
`,
        { mode: 0o700 },
      );
      await chmod(tarWrapperPath, 0o700);
      process.env.MURPH_TEST_EXTRACTION_MARKER = extractionMarker;
      process.env.MURPH_TEST_REAL_TAR = realTarPath;
      process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath ?? ""}`;

      const fixture = await createAuthenticatedTarSnapshotFixture({
        dataKey,
        entries: Array.from({ length: 20_001 }, (_, index) => ({
          path: `vault/entry-${String(index).padStart(5, "0")}/`,
          type: "5" as const,
        })),
        snapshotId: "snapshot_excessive_entries",
      });

      await expect(restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        encryptedStream: streamEncryptedChunks([fixture.encryptedBytes]),
        ref: fixture.ref,
      })).rejects.toThrow("Hosted workspace snapshot tar entry count is unsafe.");
      await expect(access(extractionMarker)).rejects.toThrow();
      await expect(readdir(durableRoot)).resolves.toEqual(["existing.txt"]);
    } finally {
      process.env.PATH = originalPath;
      delete process.env.MURPH_TEST_EXTRACTION_MARKER;
      delete process.env.MURPH_TEST_REAL_TAR;
      dataKey.fill(0);
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("keeps tar and zstd stderr bodies out of restore diagnostics", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-stderr-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const wrapperDir = path.join(tempRoot, "bin");
    const zstdWrapperPath = path.join(wrapperDir, "zstd");
    const stderrPathMarker = "/private/snapshot-path-marker";
    const originalPath = process.env.PATH;
    const realZstdPath = (await execFileAsync("which", ["zstd"])).stdout.trim();
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 111);

    try {
      await mkdir(wrapperDir, { mode: 0o700, recursive: true });
      await writeFile(
        zstdWrapperPath,
        `#!/bin/sh
printf '%s\\n' "\${MURPH_TEST_STDERR_PATH_MARKER:?}" >&2
exec "\${MURPH_TEST_REAL_ZSTD:?}" "$@"
`,
        { mode: 0o700 },
      );
      await chmod(zstdWrapperPath, 0o700);
      process.env.MURPH_TEST_REAL_ZSTD = realZstdPath;
      process.env.MURPH_TEST_STDERR_PATH_MARKER = stderrPathMarker;
      process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath ?? ""}`;
      const fixture = createAuthenticatedSnapshotFixture({
        compressedArchive: Buffer.from("not a zstd archive", "utf8"),
        dataKey,
        fileCount: 1,
        snapshotId: "snapshot_stderr_body",
        totalPlainBytes: 1,
      });

      let restoreError: unknown = null;
      try {
        await restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
          dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
          durableRoot,
          encryptedStream: streamEncryptedChunks([fixture.encryptedBytes]),
          ref: fixture.ref,
        });
      } catch (error) {
        restoreError = error;
      }
      expect(restoreError).toBeInstanceOf(Error);
      const details = buildHostedRuntimeSafeErrorMetadata(restoreError);
      expect(details).not.toHaveProperty("workspaceSnapshotProcessStderrErrorDetail");
      expect(JSON.stringify(details)).not.toContain(stderrPathMarker);
      expect(details).toEqual(expect.objectContaining({
        workspaceSnapshotProcessLabel: "zstd",
        workspaceSnapshotProcessStderrBytes: expect.any(Number),
        workspaceSnapshotProcessStderrLineCount: expect.any(Number),
      }));
    } finally {
      process.env.PATH = originalPath;
      delete process.env.MURPH_TEST_REAL_ZSTD;
      delete process.env.MURPH_TEST_STDERR_PATH_MARKER;
      dataKey.fill(0);
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("aborts archive extraction children and cleans staging without replacing durable state", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-abort-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const existingDurableFile = path.join(durableRoot, "existing.txt");
    const wrapperDir = path.join(tempRoot, "bin");
    const tarWrapperPath = path.join(wrapperDir, "tar");
    const extractionStartedMarker = path.join(tempRoot, "extraction-started");
    const extractionTerminatedMarker = path.join(tempRoot, "extraction-terminated");
    const extractionReleaseMarker = path.join(tempRoot, "extraction-release");
    const originalPath = process.env.PATH;
    const realTarPath = (await execFileAsync("which", ["tar"])).stdout.trim();
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 116);
    const abortError = new Error("snapshot extraction abort test");
    const abortController = new AbortController();
    let restorePromise: Promise<unknown> | null = null;

    try {
      await mkdir(durableRoot, { mode: 0o700, recursive: true });
      await mkdir(wrapperDir, { mode: 0o700, recursive: true });
      await writeFile(existingDurableFile, "existing durable root\n", { mode: 0o600 });
      await writeFile(
        tarWrapperPath,
        `#!/bin/sh
for argument in "$@"; do
  if [ "$argument" = "-xf" ]; then
    : > "\${MURPH_TEST_EXTRACTION_STARTED_MARKER:?}" || exit 1
    trap ': > "\${MURPH_TEST_EXTRACTION_TERMINATED_MARKER:?}"; exit 143' TERM
    while [ ! -e "\${MURPH_TEST_EXTRACTION_RELEASE_MARKER:?}" ]; do :; done
  fi
done
exec "\${MURPH_TEST_REAL_TAR:?}" "$@"
`,
        { mode: 0o700 },
      );
      await chmod(tarWrapperPath, 0o700);
      process.env.MURPH_TEST_EXTRACTION_RELEASE_MARKER = extractionReleaseMarker;
      process.env.MURPH_TEST_EXTRACTION_STARTED_MARKER = extractionStartedMarker;
      process.env.MURPH_TEST_EXTRACTION_TERMINATED_MARKER = extractionTerminatedMarker;
      process.env.MURPH_TEST_REAL_TAR = realTarPath;
      process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath ?? ""}`;

      const fixture = await createAuthenticatedTarSnapshotFixture({
        dataKey,
        entries: [{ content: "replacement\n", path: "vault/note.txt", type: "0" }],
        snapshotId: "snapshot_abort_extraction",
      });
      restorePromise = restoreEncryptedWorkspaceSnapshotFromEncryptedStream({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        encryptedStream: streamEncryptedChunks([fixture.encryptedBytes]),
        ref: fixture.ref,
        signal: abortController.signal,
      });
      await waitForTestPath(extractionStartedMarker);
      abortController.abort(abortError);

      const outcome = await Promise.race([
        restorePromise.then(
          () => ({ status: "resolved" as const }),
          (error: unknown) => ({ error, status: "rejected" as const }),
        ),
        new Promise<{ status: "timeout" }>((resolve) => {
          setTimeout(() => resolve({ status: "timeout" }), 1_000);
        }),
      ]);
      if (outcome.status === "timeout") {
        await writeFile(extractionReleaseMarker, "release\n", "utf8");
        await restorePromise.catch(() => undefined);
      }

      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(outcome.error).toBe(abortError);
      }
      await waitForTestPath(extractionTerminatedMarker);
      await expect(readFile(existingDurableFile, "utf8")).resolves.toBe("existing durable root\n");
      await expect(readdir(durableRoot)).resolves.toEqual(["existing.txt"]);
      expect((await readdir(tempRoot)).filter((entry) =>
        entry.startsWith(".workspace-snapshot-restore-")
      )).toEqual([]);
    } finally {
      await writeFile(extractionReleaseMarker, "release\n", "utf8").catch(() => undefined);
      await restorePromise?.catch(() => undefined);
      process.env.PATH = originalPath;
      delete process.env.MURPH_TEST_EXTRACTION_RELEASE_MARKER;
      delete process.env.MURPH_TEST_EXTRACTION_STARTED_MARKER;
      delete process.env.MURPH_TEST_EXTRACTION_TERMINATED_MARKER;
      delete process.env.MURPH_TEST_REAL_TAR;
      dataKey.fill(0);
      await rm(tempRoot, { force: true, recursive: true });
    }
  });

  it("rejects selected archive entries that traverse symlink parents or path aliases", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const outputDir = path.join(tempRoot, "scratch");
    const externalRoot = path.join(tempRoot, "external");
    const snapshotId = "snapshot_selected_entry_reject";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_selected_entry_reject.snapshot.enc";
    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId,
      userId: "member_123",
    });
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await mkdir(path.join(durableRoot, "vault"), { recursive: true });
      await mkdir(externalRoot, { recursive: true });
      await writeFile(path.join(durableRoot, "vault", "note.md"), "note\n", "utf8");
      await writeFile(path.join(durableRoot, "vault", ".env"), "placeholder=true\n", "utf8");
      await writeFile(path.join(externalRoot, "file.txt"), "external\n", "utf8");
      await symlink(externalRoot, path.join(durableRoot, "vault", "link"));

      const baseInput = {
        aad,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir,
      };
      await expect(createEncryptedWorkspaceSnapshotFile({
        ...baseInput,
        archiveEntries: [{
          absolutePath: path.join(durableRoot, "vault", "link", "file.txt"),
          archivePath: "vault/link/file.txt",
          kind: "file",
        }],
      })).rejects.toThrow("Hosted workspace snapshot durable root contains symlinks.");
      await expect(createEncryptedWorkspaceSnapshotFile({
        ...baseInput,
        archiveEntries: [{
          absolutePath: path.join(durableRoot, "vault", "note.md"),
          archivePath: "vault/./note.md",
          kind: "file",
        }],
      })).rejects.toThrow("Hosted workspace snapshot path is unsafe.");

      await expect(createEncryptedWorkspaceSnapshotFile({
        ...baseInput,
        archiveEntries: [
          {
            absolutePath: path.join(durableRoot, "vault", "note.md"),
            archivePath: "vault/note.md",
            kind: "file",
          },
          {
            absolutePath: path.join(durableRoot, "vault", "note.md"),
            archivePath: "./vault//note.md",
            kind: "file",
          },
        ],
      })).rejects.toThrow("Hosted workspace snapshot archive contains duplicate entries.");
      await expect(createEncryptedWorkspaceSnapshotFile({
        ...baseInput,
        archiveEntries: [{
          absolutePath: path.join(durableRoot, "vault", ".env"),
          archivePath: "vault/.env",
          kind: "file",
        }],
      })).rejects.toThrow("Hosted workspace snapshot durable root contains environment files.");

      const hardlinkPath = path.join(durableRoot, "vault", "note-hardlink.md");
      await link(path.join(durableRoot, "vault", "note.md"), hardlinkPath);
      await expect(createEncryptedWorkspaceSnapshotFile({
        ...baseInput,
        archiveEntries: [{
          absolutePath: hardlinkPath,
          archivePath: "vault/note-hardlink.md",
          kind: "file",
        }],
      })).rejects.toThrow("Hosted workspace snapshot durable root contains hardlinks.");

      const fifoPath = path.join(durableRoot, "vault", "snapshot.fifo");
      await execFileAsync("mkfifo", [fifoPath]);
      await expect(createEncryptedWorkspaceSnapshotFile({
        ...baseInput,
        archiveEntries: [{
          absolutePath: fifoPath,
          archivePath: "vault/snapshot.fifo",
          kind: "file",
        }],
      })).rejects.toThrow("Hosted workspace snapshot durable root contains unsupported special files.");
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it("rejects emitted tar members that differ from the planned entry state", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const durableRoot = path.join(tempRoot, "durable");
    const notePath = path.join(durableRoot, "vault", "note.md");
    const wrapperDir = path.join(tempRoot, "bin");
    const tarWrapperPath = path.join(wrapperDir, "tar");
    const tarMarkerPath = path.join(tempRoot, "tar-wrapper-used");
    const originalPath = process.env.PATH;
    const realTarPath = (await execFileAsync("which", ["tar"])).stdout.trim();
    const snapshotId = "snapshot_tar_race";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_tar_race.snapshot.enc";
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

    try {
      await mkdir(path.dirname(notePath), { recursive: true });
      await mkdir(wrapperDir, { recursive: true });
      await writeFile(notePath, "note\n", "utf8");
      await writeFile(
        tarWrapperPath,
        `#!/bin/sh
REAL_TAR="\${MURPH_TEST_REAL_TAR:?}"
ROOT="\${MURPH_TEST_DURABLE_ROOT:?}"
MARKER="\${MURPH_TEST_TAR_MARKER:?}"
NOTE="$ROOT/vault/note.md"
BACKUP="$ROOT/vault/note.md.before-tar"
if [ ! -e "$MARKER" ]; then
  : > "$MARKER" || exit 1
  mv "$NOTE" "$BACKUP" || exit 1
  ln -s /tmp "$NOTE" || { mv "$BACKUP" "$NOTE"; exit 1; }
  "$REAL_TAR" "$@"
  status=$?
  rm -f "$NOTE"
  mv "$BACKUP" "$NOTE"
  exit "$status"
fi
exec "$REAL_TAR" "$@"
`,
        { mode: 0o700 },
      );
      await chmod(tarWrapperPath, 0o700);

      process.env.MURPH_TEST_DURABLE_ROOT = durableRoot;
      process.env.MURPH_TEST_REAL_TAR = realTarPath;
      process.env.MURPH_TEST_TAR_MARKER = tarMarkerPath;
      process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath ?? ""}`;

      await expect(createEncryptedWorkspaceSnapshotFile({
        aad: buildHostedWorkspaceSnapshotV2Aad({
          objectKey,
          snapshotId,
          userId: "member_123",
        }),
        archiveEntries: [{
          absolutePath: notePath,
          archivePath: "vault/note.md",
          kind: "file",
        }],
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 10))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      })).rejects.toThrow("Hosted workspace snapshot tar entry type is unsafe.");
      await expect(readFile(notePath, "utf8")).resolves.toBe("note\n");
    } finally {
      process.env.PATH = originalPath;
      delete process.env.MURPH_TEST_DURABLE_ROOT;
      delete process.env.MURPH_TEST_REAL_TAR;
      delete process.env.MURPH_TEST_TAR_MARKER;
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });

  it.each([
    {
      archivePatch: { encryptedObjectSha256: "0".repeat(64) },
      expectedError: "Hosted workspace snapshot encrypted digest does not match its ref.",
      name: "encrypted object digest",
    },
    {
      archivePatch: { plaintextArchiveSha256: "0".repeat(64) },
      expectedError: "Hosted workspace snapshot plaintext archive digest does not match its ref.",
      name: "plaintext archive digest",
    },
  ])("rejects $name mismatches without replacing the durable root", async ({
    archivePatch,
    expectedError,
  }) => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
    const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
    const restoredDurableRoot = path.join(tempRoot, "restored", "durable");
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 41);
    const snapshotId = "snapshot_digest_mismatch";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_digest_mismatch.snapshot.enc";
    const userId = "member_123";
    const tarInvocationMarker = path.join(tempRoot, "restore-tar-invoked");
    const wrapperDir = path.join(tempRoot, "bin");
    const tarWrapperPath = path.join(wrapperDir, "tar");
    const originalPath = process.env.PATH;
    const realTarPath = (await execFileAsync("which", ["tar"])).stdout.trim();

    try {
      await mkdir(sourceVaultRoot, { recursive: true });
      await mkdir(sourceOperatorHomeRoot, { recursive: true });
      await mkdir(restoredDurableRoot, { recursive: true });
      await writeFile(path.join(sourceVaultRoot, "note.md"), "new workspace\n", "utf8");
      await writeFile(path.join(restoredDurableRoot, "existing.txt"), "existing durable root\n", "utf8");
      const aad = buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      });
      const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
        durableRoot: sourceDurableRoot,
        operatorHomeRoot: sourceOperatorHomeRoot,
        vaultRoot: sourceVaultRoot,
      });
      const encrypted = await createEncryptedWorkspaceSnapshotFile({
        aad,
        archiveEntries: archivePlan.entries,
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: sourceDurableRoot,
        ivBase64: Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 50))
          .toString("base64url"),
        maxEncryptedBytes: 16 * 1024 * 1024,
        outputDir: path.join(tempRoot, "scratch"),
      });
      const ref = createHostedWorkspaceSnapshotTestRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      });
      await mkdir(wrapperDir, { mode: 0o700, recursive: true });
      await writeFile(
        tarWrapperPath,
        `#!/bin/sh
: > "\${MURPH_TEST_TAR_INVOCATION_MARKER:?}" || exit 1
exec "\${MURPH_TEST_REAL_TAR:?}" "$@"
`,
        { mode: 0o700 },
      );
      await chmod(tarWrapperPath, 0o700);
      process.env.MURPH_TEST_REAL_TAR = realTarPath;
      process.env.MURPH_TEST_TAR_INVOCATION_MARKER = tarInvocationMarker;
      process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath ?? ""}`;

      await expect(restoreEncryptedWorkspaceSnapshot({
        dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
        durableRoot: restoredDurableRoot,
        encryptedFilePath: encrypted.encryptedFilePath,
        ref: {
          ...ref,
          archive: {
            ...ref.archive,
            ...archivePatch,
          },
        },
      })).rejects.toThrow(expectedError);

      await expect(readFile(path.join(restoredDurableRoot, "existing.txt"), "utf8"))
        .resolves.toBe("existing durable root\n");
      await expect(access(path.join(restoredDurableRoot, "vault", "note.md")))
        .rejects.toThrow();
      await expect(access(tarInvocationMarker)).rejects.toThrow();
    } finally {
      process.env.PATH = originalPath;
      delete process.env.MURPH_TEST_REAL_TAR;
      delete process.env.MURPH_TEST_TAR_INVOCATION_MARKER;
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
    }
  });
});

function createHostedWorkspaceSnapshotTestRef(input: {
  aad: HostedWorkspaceSnapshotV2Aad;
  encrypted: EncryptedWorkspaceSnapshotFile;
  objectKey: string;
  snapshotId: string;
  userId: string;
}): HostedWorkspaceSnapshotV2Ref {
  return {
    archive: {
      compression: input.encrypted.compression,
      encryptedByteSize: input.encrypted.encryptedByteSize,
      encryptedObjectSha256: input.encrypted.encryptedObjectSha256,
      fileCount: input.encrypted.fileCount,
      format: "tar",
      plaintextArchiveSha256: input.encrypted.plaintextArchiveSha256,
      totalPlainBytes: input.encrypted.totalPlainBytes,
    },
    createdAt: "2026-05-20T00:00:00.000Z",
    encryption: {
      aad: input.aad,
      ivBase64: input.encrypted.ivBase64,
      rootKeyId: "root_key_test",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped_data_key_test",
    },
    objectKey: input.objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
    snapshotId: input.snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId: input.userId,
  };
}

async function* streamEncryptedChunks(chunks: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

const TEST_HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES = 16;

interface TestTarEntry {
  content?: string;
  groupName?: string;
  linkPath?: string;
  ownerName?: string;
  path: string;
  type: "0" | "1" | "2" | "5" | "6" | "7" | "x";
}

async function createAuthenticatedTarSnapshotFixture(input: {
  dataKey: Uint8Array;
  entries: readonly TestTarEntry[];
  fileCount?: number;
  snapshotId: string;
  totalPlainBytes?: number;
}): Promise<{
  encryptedBytes: Buffer;
  ref: HostedWorkspaceSnapshotV2Ref;
}> {
  const tarArchive = createTestTarArchive(input.entries);
  const compressedArchive = execFileSync("zstd", ["-1", "--stdout"], {
    input: tarArchive,
    maxBuffer: 64 * 1024 * 1024,
  });
  const regularFiles = input.entries.filter((entry) => entry.type === "0");
  return createAuthenticatedSnapshotFixture({
    compressedArchive,
    dataKey: input.dataKey,
    fileCount: input.fileCount ?? regularFiles.length,
    snapshotId: input.snapshotId,
    totalPlainBytes: input.totalPlainBytes
      ?? regularFiles.reduce((total, entry) => total + Buffer.byteLength(entry.content ?? ""), 0),
  });
}

function createAuthenticatedSnapshotFixture(input: {
  compressedArchive: Buffer;
  dataKey: Uint8Array;
  fileCount: number;
  snapshotId: string;
  totalPlainBytes: number;
}): {
  encryptedBytes: Buffer;
  ref: HostedWorkspaceSnapshotV2Ref;
} {
  const objectKey = `users/hsn_test/workspace-snapshots/${input.snapshotId}.snapshot.enc`;
  const userId = "member_123";
  const aad = buildHostedWorkspaceSnapshotV2Aad({
    objectKey,
    snapshotId: input.snapshotId,
    userId,
  });
  const ivBase64 = Buffer.from(Uint8Array.from({ length: 12 }, (_, index) => index + 121))
    .toString("base64url");
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(input.dataKey),
    Buffer.from(ivBase64, "base64url"),
  );
  cipher.setAAD(Buffer.from(JSON.stringify(aad)));
  const encryptedBytes = Buffer.concat([
    cipher.update(input.compressedArchive),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    encryptedBytes,
    ref: {
      archive: {
        compression: "zstd",
        encryptedByteSize: encryptedBytes.byteLength,
        encryptedObjectSha256: createHash("sha256").update(encryptedBytes).digest("hex"),
        fileCount: input.fileCount,
        format: "tar",
        plaintextArchiveSha256: createHash("sha256")
          .update(input.compressedArchive)
          .digest("hex"),
        totalPlainBytes: input.totalPlainBytes,
      },
      createdAt: "2026-05-20T00:00:00.000Z",
      encryption: {
        aad,
        ivBase64,
        rootKeyId: "root_key_test",
        scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
        wrappedDataKey: "wrapped_data_key_test",
      },
      objectKey,
      schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
      snapshotId: input.snapshotId,
      upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
      userId,
    },
  };
}

function createTestTarArchive(entries: readonly TestTarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content ?? "", "utf8");
    const header = Buffer.alloc(512);
    writeTestTarString(header, 0, 100, entry.path);
    writeTestTarOctal(header, 100, 8, entry.type === "5" ? 0o755 : 0o600);
    writeTestTarOctal(header, 108, 8, 0);
    writeTestTarOctal(header, 116, 8, 0);
    const hasBody = entry.type === "0" || entry.type === "x";
    writeTestTarOctal(header, 124, 12, hasBody ? content.byteLength : 0);
    writeTestTarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header.write(entry.type, 156, 1, "ascii");
    writeTestTarString(header, 157, 100, entry.linkPath ?? "");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    writeTestTarString(header, 265, 32, entry.ownerName ?? "runner");
    writeTestTarString(header, 297, 32, entry.groupName ?? "runner");
    const checksum = header.reduce((total, byte) => total + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(header);
    if (hasBody) {
      blocks.push(content);
      const padding = (512 - (content.byteLength % 512)) % 512;
      if (padding > 0) {
        blocks.push(Buffer.alloc(padding));
      }
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function createTestPaxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let byteLength = Buffer.byteLength(body) + 1;
  while (true) {
    const record = `${byteLength}${body}`;
    const actualByteLength = Buffer.byteLength(record);
    if (actualByteLength === byteLength) {
      return record;
    }
    byteLength = actualByteLength;
  }
}

function writeTestTarString(
  target: Buffer,
  offset: number,
  length: number,
  value: string,
): void {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength > length) {
    throw new Error("Test tar string exceeded its fixed field.");
  }
  encoded.copy(target, offset);
}

function writeTestTarOctal(
  target: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  target.write(value.toString(8).padStart(length - 1, "0"), offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}

async function waitForTestPath(targetPath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await access(targetPath);
      return;
    } catch {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    }
  }
  throw new Error("Timed out waiting for snapshot test marker.");
}

function splitEncryptedSnapshotAcrossAuthTagBoundary(encryptedBytes: Buffer): Uint8Array[] {
  const ciphertextEnd =
    encryptedBytes.byteLength - TEST_HOSTED_WORKSPACE_SNAPSHOT_AUTH_TAG_BYTES;
  const nearAuthTag = Math.max(1, ciphertextEnd - 3);
  return [
    encryptedBytes.subarray(0, 1),
    encryptedBytes.subarray(1, nearAuthTag),
    encryptedBytes.subarray(nearAuthTag, ciphertextEnd + 1),
    encryptedBytes.subarray(ciphertextEnd + 1, ciphertextEnd + 8),
    encryptedBytes.subarray(ciphertextEnd + 8),
  ].filter((chunk) => chunk.byteLength > 0);
}
