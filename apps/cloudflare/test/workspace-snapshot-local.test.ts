import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
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
} from "../src/workspace-snapshot-local.js";

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
        scratchRoot: path.join(tempRoot, "restore-scratch"),
      });

      for (const key of [
        "decryptMs",
        "archiveExtractMs",
        "restorePreflightMs",
        "durableRootReplaceMs",
        "cleanupMs",
        "extractMs",
      ] as const) {
        expect(typeof restoreTimings[key]).toBe("number");
        expect(Number.isFinite(restoreTimings[key])).toBe(true);
        expect(restoreTimings[key]).toBeGreaterThanOrEqual(0);
      }
      expect(restoreTimings.restorePreflightMs).toBe(0);

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

  it("round-trips ordinary planned paths with spaces and long names", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workspace-snapshot-local-test-"));
    const sourceDurableRoot = path.join(tempRoot, "source", "durable");
    const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
    const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
    const restoredDurableRoot = path.join(tempRoot, "restored", "durable");
    const longFileName =
      "2026-06-21 path with spaces and enough length to exercise tar list handling.md";
    const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 21);
    const snapshotId = "snapshot_ordinary_paths";
    const objectKey = "users/hsn_test/workspace-snapshots/snapshot_ordinary_paths.snapshot.enc";
    const userId = "member_123";

    try {
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
        scratchRoot: path.join(tempRoot, "restore-scratch"),
      });

      await expect(readFile(
        path.join(restoredDurableRoot, "vault", "journal", "2026", longFileName),
        "utf8",
      )).resolves.toBe("ordinary planned path\n");
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
      dataKey.fill(0);
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
    } finally {
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
        scratchRoot: path.join(tempRoot, "restore-scratch"),
      })).rejects.toThrow(expectedError);

      await expect(readFile(path.join(restoredDurableRoot, "existing.txt"), "utf8"))
        .resolves.toBe("existing durable root\n");
      await expect(access(path.join(restoredDurableRoot, "vault", "note.md")))
        .rejects.toThrow();
    } finally {
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
