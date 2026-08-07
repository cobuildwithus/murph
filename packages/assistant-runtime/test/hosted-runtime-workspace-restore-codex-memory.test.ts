import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildHostedWorkspaceSnapshotV2Aad,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  resolveAssistantStatePaths,
} from "@murphai/runtime-state/node";
import { test } from "vitest";

import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
  writeHostedWorkspaceCleanCheckpointMarkerBestEffort,
} from "../src/hosted-runtime/workspace-restore.ts";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime-contracts.ts";

test("warm-clean v2 reuse keeps only bounded Codex memory read artifacts", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-codex-memory-warm-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "durable", "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "durable", "home");
    const assistantStateRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
    const memoryRoot = path.join(operatorHomeRoot, ".codex-hosted", "memories");
    const snapshotRef = createWorkspaceSnapshotV2Ref();
    const workspace = createWorkspaceState(snapshotRef);
    await mkdir(assistantStateRoot, { recursive: true });
    await mkdir(memoryRoot, { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), "{}\n", "utf8");
    await writeFile(path.join(vaultRoot, "note.md"), "warm workspace\n", "utf8");
    await writeFile(path.join(memoryRoot, "raw_memories.md"), "warm memory\n", "utf8");
    await mkdir(path.join(memoryRoot, "skills", "demo"), { recursive: true });
    await writeFile(
      path.join(memoryRoot, "skills", "demo", "credentials.json"),
      "credential\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "memories_1.sqlite-shm"),
      "live sqlite sidecar\n",
      "utf8",
    );
    assert.equal(
      await writeHostedWorkspaceCleanCheckpointMarkerBestEffort({
        vaultRoot,
        workspace,
      }),
      true,
    );

    let coldRestoreCount = 0;
    const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
      platform: createRestorePlatform({
        async restoreWorkspaceSnapshot() {
          coldRestoreCount += 1;
          throw new Error("warm-clean reuse must not restore the cold snapshot");
        },
      }),
      vaultRoot,
      workspace,
    });

    assert.equal(restored.restoreWasCold, false);
    assert.equal(coldRestoreCount, 0);
    assert.equal(await readFile(path.join(memoryRoot, "raw_memories.md"), "utf8"), "warm memory\n");
    await assert.rejects(
      readFile(
        path.join(operatorHomeRoot, ".codex-hosted", "memories_1.sqlite-shm"),
        "utf8",
      ),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(path.join(memoryRoot, "skills", "demo", "credentials.json"), "utf8"),
      { code: "ENOENT" },
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

test("cold v2 restore keeps bounded memory read artifacts and removes other state", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-codex-memory-cold-"));

  try {
    const vaultRoot = path.join(workspaceRoot, "durable", "vault");
    const operatorHomeRoot = path.join(workspaceRoot, "durable", "home");
    const memoryRoot = path.join(operatorHomeRoot, ".codex-hosted", "memories");
    const snapshotRef = createWorkspaceSnapshotV2Ref();
    const restoredMemoryFiles = [
      ["raw_memories.md", "cold raw memory\n"],
      ["MEMORY.md", "cold memory index\n"],
      ["memory_summary.md", "v1\n\ncold summary\n"],
    ] as const;
    const excludedMemoryFiles = [
      [".git/HEAD", "ref: refs/heads/main\n"],
      ["extensions/ad_hoc/notes/note.md", "extension note\n"],
      ["extensions/ad_hoc/phase2_workspace_diff.md", "nested memory resource\n"],
      ["phase2_workspace_diff.md", "in-flight diff\n"],
      ["cache.sqlite", "private cache\n"],
      [".git/index.lock", "git lock\n"],
      ["tmp/inflight.md", "temporary work\n"],
      ["skills/demo/.env.example", "example environment secret\n"],
      ["extensions/ad_hoc/.envrc", "environment rc secret\n"],
      ["extensions/.env-secrets/value.txt", "nested environment secret\n"],
      ["auth/provider.json", "provider credential\n"],
      ["skills/demo/credentials.json", "credential\n"],
      ["skills/demo/private.key", "private key\n"],
      [".netrc", "network credential\n"],
    ] as const;

    const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
      platform: createRestorePlatform({
        async restoreWorkspaceSnapshot(request) {
          await rm(request.durableRoot, { force: true, recursive: true });
          const restoredVaultRoot = path.join(request.durableRoot, "vault");
          const restoredCodexHome = path.join(request.durableRoot, "home", ".codex-hosted");
          const restoredMemoryRoot = path.join(restoredCodexHome, "memories");
          await mkdir(restoredVaultRoot, { recursive: true });
          await mkdir(path.join(restoredCodexHome, "sessions", "2026", "08", "06"), {
            recursive: true,
          });
          await writeFile(path.join(restoredVaultRoot, "vault.json"), "{}\n", "utf8");
          for (const [relativePath, contents] of [
            ...restoredMemoryFiles,
            ...excludedMemoryFiles,
          ]) {
            const filePath = path.join(restoredMemoryRoot, relativePath);
            await mkdir(path.dirname(filePath), { recursive: true });
            await writeFile(filePath, contents, "utf8");
          }
          await writeFile(path.join(restoredCodexHome, "memories_1.sqlite"), "private db\n", "utf8");
          await writeFile(
            path.join(restoredCodexHome, "memories_1.sqlite-wal"),
            "private wal\n",
            "utf8",
          );
          await writeFile(path.join(restoredCodexHome, "auth.json"), "secret\n", "utf8");
          await writeFile(
            path.join(
              restoredCodexHome,
              "sessions",
              "2026",
              "08",
              "06",
              "rollout-2026-08-06T00-00-00-00000000-0000-4000-8000-000000000099.jsonl",
            ),
            "unreferenced rollout\n",
            "utf8",
          );
        },
      }),
      vaultRoot,
      workspace: createWorkspaceState(snapshotRef),
    });

    assert.equal(restored.restoreWasCold, true);
    for (const [relativePath, contents] of restoredMemoryFiles) {
      assert.equal(await readFile(path.join(memoryRoot, relativePath), "utf8"), contents);
    }
    for (const [relativePath] of excludedMemoryFiles) {
      await assert.rejects(readFile(path.join(memoryRoot, relativePath), "utf8"), {
        code: "ENOENT",
      });
    }
    await assert.rejects(
      readFile(path.join(operatorHomeRoot, ".codex-hosted", "memories_1.sqlite"), "utf8"),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(path.join(operatorHomeRoot, ".codex-hosted", "memories_1.sqlite-wal"), "utf8"),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(path.join(operatorHomeRoot, ".codex-hosted", "auth.json"), "utf8"),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(
        path.join(
          operatorHomeRoot,
          ".codex-hosted",
          "sessions",
          "2026",
          "08",
          "06",
          "rollout-2026-08-06T00-00-00-00000000-0000-4000-8000-000000000099.jsonl",
        ),
        "utf8",
      ),
      { code: "ENOENT" },
    );
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
});

function createWorkspaceSnapshotV2Ref(): HostedWorkspaceSnapshotV2Ref {
  const userId = "member_synthetic_codex_memory_restore";
  const snapshotId = "snapshot_codex_memory_restore";
  const objectKey =
    "users/hsn_abcdef0123456789abcdef01/workspace-snapshots/snapshot_codex_memory_restore.snapshot.enc";
  return {
    archive: {
      compression: "zstd",
      encryptedByteSize: 128,
      encryptedObjectSha256: "a".repeat(64),
      fileCount: 1,
      format: "tar",
      plaintextArchiveSha256: "b".repeat(64),
      totalPlainBytes: 7,
    },
    createdAt: "2026-08-06T00:00:00.000Z",
    encryption: {
      aad: buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      }),
      ivBase64: "AQIDBAUGBwgJCgsM",
      rootKeyId: "root_key_codex_memory_restore",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped_data_key_codex_memory_restore",
    },
    objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
    snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId,
  };
}

function createRestorePlatform(input: {
  restoreWorkspaceSnapshot: NonNullable<
    HostedRuntimePlatform["workspaceSnapshotPort"]
  >["restoreWorkspaceSnapshot"];
}): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {
        return undefined;
      },
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
    },
    logPort: {
      async write(request) {
        return {
          loggedCount: request.entries.length,
        };
      },
    },
    workspaceSnapshotPort: {
      async abortSnapshotSession() {
        throw new Error("abortSnapshotSession is not used during restore");
      },
      async completeSnapshotSession() {
        throw new Error("completeSnapshotSession is not used during restore");
      },
      async putSnapshotObjectDirect() {
        throw new Error("putSnapshotObjectDirect is not used during restore");
      },
      restoreWorkspaceSnapshot: input.restoreWorkspaceSnapshot,
      async startSnapshotSession() {
        throw new Error("startSnapshotSession is not used during restore");
      },
    },
  };
}

function createWorkspaceState(snapshotRef: HostedWorkspaceSnapshotV2Ref): HostedWorkspaceState {
  return {
    createdAt: "2026-08-06T00:00:00.000Z",
    snapshotRef,
    updatedAt: "2026-08-06T00:00:00.000Z",
    userId: snapshotRef.userId,
    version: "9",
  };
}
