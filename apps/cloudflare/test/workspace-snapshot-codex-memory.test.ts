import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  collectHostedWorkspaceSnapshotArchivePlan,
  pruneHostedCodexHomeToSessionReferencedRollouts,
  resolveAssistantStatePaths,
} from "@murphai/runtime-state/node";
import {
  createEncryptedWorkspaceSnapshotFile,
  restoreEncryptedWorkspaceSnapshot,
  type EncryptedWorkspaceSnapshotFile,
} from "../src/workspace-snapshot-local.js";

test("encrypted idle snapshots round-trip Codex's durable memory workspace", async () => {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "workspace-snapshot-codex-memory-"),
  );
  const sourceDurableRoot = path.join(tempRoot, "source", "durable");
  const sourceVaultRoot = path.join(sourceDurableRoot, "vault");
  const sourceOperatorHomeRoot = path.join(sourceDurableRoot, "home");
  const sourceCodexHome = path.join(
    sourceOperatorHomeRoot,
    ".codex-hosted",
  );
  const sourceMemoriesRoot = path.join(sourceCodexHome, "memories");
  const restoredDurableRoot = path.join(tempRoot, "restored", "durable");
  const snapshotId = "snapshot_codex_memory_workspace";
  const objectKey =
    "users/hsn_test/workspace-snapshots/snapshot_codex_memory_workspace.snapshot.enc";
  const userId = "member_123";
  const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

  const durableMemoryFiles = [
    ["MEMORY.md", "memory\n"],
    ["memory_summary.md", "v1\n\nsummary\n"],
    ["raw_memories.md", "raw memory\n"],
  ] as const;
  const excludedMemoryFiles = [
    ["rollout_summaries/thread.md", "rollout summary\n"],
    ["skills/demo/SKILL.md", "generated skill\n"],
    ["extensions/ad_hoc/instructions.md", "extension instructions\n"],
    ["extensions/ad_hoc/notes/note.md", "extension note\n"],
    ["extensions/ad_hoc/phase2_workspace_diff.md", "nested memory resource\n"],
    [".git/HEAD", "ref: refs/heads/main\n"],
    [".git/index", "git index\n"],
    [".git/objects/ab/cdef", "git object\n"],
    ["phase2_workspace_diff.md", "in-flight diff\n"],
    ["tmp/inflight.md", "temporary work\n"],
    [".git/index.lock", "git lock\n"],
    ["cache.sqlite", "private cache\n"],
    [".env", "environment secret\n"],
    [".env.local", "local environment secret\n"],
    ["skills/demo/.env.example", "example environment secret\n"],
    ["extensions/ad_hoc/.envrc", "environment rc secret\n"],
    ["extensions/ad_hoc/.env-prod", "production environment secret\n"],
    ["extensions/ad_hoc/.env_backup", "environment backup secret\n"],
    ["extensions/.env-secrets/value.txt", "nested environment secret\n"],
    ["auth/provider.json", "provider credential\n"],
    ["credentials.json", "credential\n"],
    ["secrets/token.json", "secret token\n"],
    ["skills/demo/private.key", "private key\n"],
    ["extensions/demo/provider_cert.json", "provider certificate\n"],
    [".netrc", "network credential\n"],
  ] as const;
  const excludedCodexFiles = [
    ["memories_1.sqlite", "memory db\n"],
    ["memories_1.sqlite-wal", "memory wal\n"],
    ["state_5.sqlite", "state db\n"],
    ["state_5.sqlite-wal", "state wal\n"],
    ["auth.json", "secret\n"],
  ] as const;

  try {
    await mkdir(sourceVaultRoot, { recursive: true });
    await writeFile(path.join(sourceVaultRoot, "note.md"), "vault state\n", "utf8");
    for (const [relativePath, contents] of [
      ...durableMemoryFiles,
      ...excludedMemoryFiles,
    ]) {
      const filePath = path.join(sourceMemoriesRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, "utf8");
    }
    for (const [relativePath, contents] of excludedCodexFiles) {
      const filePath = path.join(sourceCodexHome, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, "utf8");
    }

    const archivePlan = await collectHostedWorkspaceSnapshotArchivePlan({
      durableRoot: sourceDurableRoot,
      operatorHomeRoot: sourceOperatorHomeRoot,
      vaultRoot: sourceVaultRoot,
    });
    const archivePaths = new Set(
      archivePlan.entries
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.archivePath),
    );
    for (const [relativePath] of durableMemoryFiles) {
      expect(archivePaths.has(`home/.codex-hosted/memories/${relativePath}`))
        .toBe(true);
    }
    for (const [relativePath] of excludedMemoryFiles) {
      expect(archivePaths.has(`home/.codex-hosted/memories/${relativePath}`))
        .toBe(false);
    }
    for (const [relativePath] of excludedCodexFiles) {
      expect(archivePaths.has(`home/.codex-hosted/${relativePath}`)).toBe(false);
    }

    const aad = buildHostedWorkspaceSnapshotV2Aad({
      objectKey,
      snapshotId,
      userId,
    });
    const encrypted = await createEncryptedWorkspaceSnapshotFile({
      aad,
      archiveEntries: archivePlan.entries,
      dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
      durableRoot: sourceDurableRoot,
      ivBase64: Buffer.from(
        Uint8Array.from({ length: 12 }, (_, index) => index + 10),
      ).toString("base64url"),
      maxEncryptedBytes: 16 * 1024 * 1024,
      outputDir: path.join(tempRoot, "scratch"),
    });
    await restoreEncryptedWorkspaceSnapshot({
      dataKey: encodeHostedWorkspaceSnapshotV2DataKey(dataKey),
      durableRoot: restoredDurableRoot,
      encryptedFilePath: encrypted.encryptedFilePath,
      ref: createSnapshotRef({
        aad,
        encrypted,
        objectKey,
        snapshotId,
        userId,
      }),
    });

    const restoredVaultRoot = path.join(restoredDurableRoot, "vault");
    const restoredOperatorHomeRoot = path.join(restoredDurableRoot, "home");
    await pruneHostedCodexHomeToSessionReferencedRollouts({
      assistantStateRoot: resolveAssistantStatePaths(restoredVaultRoot).assistantStateRoot,
      nativeMemoryRetention: "read-artifacts",
      operatorHomeRoot: restoredOperatorHomeRoot,
    });

    const restoredMemoriesRoot = path.join(
      restoredOperatorHomeRoot,
      ".codex-hosted",
      "memories",
    );
    for (const [relativePath, contents] of durableMemoryFiles) {
      await expect(readFile(path.join(restoredMemoriesRoot, relativePath), "utf8"))
        .resolves.toBe(contents);
    }
    for (const [relativePath] of excludedMemoryFiles) {
      await expect(access(path.join(restoredMemoriesRoot, relativePath)))
        .rejects.toThrow();
    }
    for (const [relativePath] of excludedCodexFiles) {
      await expect(access(path.join(
        restoredOperatorHomeRoot,
        ".codex-hosted",
        relativePath,
      ))).rejects.toThrow();
    }
  } finally {
    dataKey.fill(0);
    await rm(tempRoot, { force: true, recursive: true });
  }
});

function createSnapshotRef(input: {
  aad: ReturnType<typeof buildHostedWorkspaceSnapshotV2Aad>;
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
    createdAt: "2026-08-06T00:00:00.000Z",
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
