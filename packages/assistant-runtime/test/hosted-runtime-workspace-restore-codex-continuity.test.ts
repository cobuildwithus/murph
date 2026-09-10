import type {
  AssistantSessionBinding,
  AssistantModelTarget,
} from "@murphai/operator-config/assistant-cli-contracts";

import type { HostedExecutionBundleRef } from "@murphai/runtime-state/node";
import type {
  HostedRuntimeLogRequest,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";

import type { HostedRuntimePlatform } from "../src/hosted-runtime-contracts.ts";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import {
  buildIntegrationEvidencePart,
  buildIntegrationIngestRecord,
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  initializeVault,
  readEventLedgerShardRecords,
  readIntegrationIngestEntries,
} from "@murphai/core";

import {
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
} from "@murphai/runtime-state/node";
import {
  buildHostedExecutionLayeredSnapshotRef,
  buildHostedExecutionWorkingSnapshotRef,
} from "@murphai/hosted-execution/parsers";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import { describe, test } from "vitest";

import {
  markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort,
  restoreHostedWorkspaceRuntimeJobWorkspace,
  writeHostedWorkspaceCleanCheckpointMarkerBestEffort,
} from "../src/hosted-runtime/workspace-restore.ts";

describe("hosted workspace restore Codex continuity", () => {
  test("rejects pre-v2 refs before touching local roots or reading artifacts", async () => {
    const base = createBundleRef({ hash: "a".repeat(64), key: "legacy/base", size: 1 });
    const other = createBundleRef({ hash: "b".repeat(64), key: "legacy/other", size: 1 });
    const refs = [base,
      buildHostedExecutionWorkingSnapshotRef({ base, delta: other }),
      buildHostedExecutionLayeredSnapshotRef({ base, hot: other }),
    ];
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-unsupported-snapshot-"));
    try {
      const vaultRoot = path.join(workspaceRoot, "durable", "vault");
      await mkdir(vaultRoot, { recursive: true });
      const sentinel = path.join(vaultRoot, "existing.txt");
      await writeFile(sentinel, "existing local state", "utf8");
      const artifactGetCalls: string[] = [];
      for (const snapshotRef of refs) {
        await assert.rejects(restoreHostedWorkspaceRuntimeJobWorkspace({
          platform: createRestorePlatform({ artifactBytesByHash: new Map(), artifactGetCalls }),
          vaultRoot,
          workspace: createWorkspaceState({ snapshotRef }),
        }), /requires a v2 snapshot reference/);
        assert.equal(await readFile(sentinel, "utf8"), "existing local state");
      }
      assert.deepEqual(artifactGetCalls, []);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("cold-clears local roots for null-bootstrap restores", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-null-bootstrap-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "durable", "vault");
      const assistantStateRoot = resolveAssistantStatePaths(restoredVaultRoot).assistantStateRoot;
      const operatorHomeRoot = path.join(workspaceRoot, "durable", "home");
      await mkdir(path.join(restoredVaultRoot, ".runtime", "operations", "assistant"), {
        recursive: true,
      });
      await mkdir(path.join(operatorHomeRoot, ".codex-hosted"), {
        recursive: true,
      });
      await writeFile(path.join(restoredVaultRoot, "dirty-local-mailbox-state.txt"), "seq=467\n", "utf8");
      await writeFile(path.join(assistantStateRoot, "dirty-assistant-state.json"), "{}\n", "utf8");
      await writeFile(path.join(operatorHomeRoot, ".codex-hosted", "dirty-rollout.jsonl"), "{}\n", "utf8");

      const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map(),
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: null,
        }),
      });

      assert.equal(restored.mode, "null-bootstrap");
      assert.equal(restored.restoreWasCold, true);
      assert.equal(restored.materializedArtifactPaths.size, 0);
      await assert.rejects(readFile(path.join(restoredVaultRoot, "dirty-local-mailbox-state.txt"), "utf8"), {
        code: "ENOENT",
      });
      await assert.rejects(readFile(path.join(assistantStateRoot, "dirty-assistant-state.json"), "utf8"), {
        code: "ENOENT",
      });
      await assert.rejects(readFile(path.join(operatorHomeRoot, ".codex-hosted", "dirty-rollout.jsonl"), "utf8"), {
        code: "ENOENT",
      });
    } finally {
      await rm(workspaceRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("restores v2 workspace snapshots through the snapshot port without artifact sidecars", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-restore-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const artifactGetCalls: string[] = [];
      const snapshotRef = createWorkspaceSnapshotV2Ref();
      const restoreSignal = new AbortController().signal;
      const restoreCalls: Array<{
        durableRoot: string;
        ref: HostedWorkspaceSnapshotV2Ref;
        signal?: AbortSignal | null;
      }> = [];

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map(),
          artifactGetCalls,
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              restoreCalls.push(request);
              await rm(request.durableRoot, { force: true, recursive: true });
              await mkdir(request.durableRoot, { recursive: true });
              await writeFile(path.join(request.durableRoot, "note.md"), "restored from v2\n", "utf8");
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        signal: restoreSignal,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef,
        }),
      });

      assert.deepEqual(artifactGetCalls, []);
      assert.equal(restoreCalls.length, 1);
      assert.equal(restoreCalls[0]?.ref, snapshotRef);
      assert.equal(restoreCalls[0]?.signal, restoreSignal);
      assert.equal(
        await readFile(path.join(restoredVaultRoot, "note.md"), "utf8"),
        "restored from v2\n",
      );

      await writeFile(path.join(restoredVaultRoot, "dirty-local-mailbox-state.txt"), "seq=467\n", "utf8");
      await markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort({
        snapshotRef,
        vaultRoot: restoredVaultRoot,
      });

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map(),
          artifactGetCalls,
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              restoreCalls.push(request);
              await rm(request.durableRoot, { force: true, recursive: true });
              await mkdir(request.durableRoot, { recursive: true });
              await writeFile(path.join(request.durableRoot, "note.md"), "restored from v2\n", "utf8");
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef,
        }),
      });

      assert.equal(restoreCalls.length, 2);
      await assert.rejects(readFile(path.join(restoredVaultRoot, "dirty-local-mailbox-state.txt"), "utf8"), {
        code: "ENOENT",
      });
    } finally {
      await rm(workspaceRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("keeps existing v2 durable roots when staged restore fails", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-failed-restore-"));
    const durableRoot = path.join(workspaceRoot, "durable");
    const restoredVaultRoot = path.join(durableRoot, "vault");
    const operatorHomeRoot = path.join(durableRoot, "home");

    try {
      await mkdir(restoredVaultRoot, { recursive: true });
      await mkdir(operatorHomeRoot, { recursive: true });
      await writeFile(path.join(restoredVaultRoot, "existing.md"), "existing vault\n", "utf8");
      await writeFile(path.join(operatorHomeRoot, "existing.jsonl"), "existing home\n", "utf8");

      await assert.rejects(
        restoreHostedWorkspaceRuntimeJobWorkspace({
          platform: createRestorePlatform({
            artifactBytesByHash: new Map(),
            workspaceSnapshotPort: {
              async abortSnapshotSession() {
                throw new Error("abortSnapshotSession is not used during v2 restore.");
              },
              async completeSnapshotSession() {
                throw new Error("completeSnapshotSession is not used during v2 restore.");
              },
              async putSnapshotObjectDirect() {
                throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
              },
              async restoreWorkspaceSnapshot() {
                throw new Error("authenticated snapshot rejected");
              },
              async startSnapshotSession() {
                throw new Error("startSnapshotSession is not used during v2 restore.");
              },
            },
          }),
          vaultRoot: restoredVaultRoot,
          workspace: createWorkspaceState({
            snapshotRef: createWorkspaceSnapshotV2Ref(),
          }),
        }),
        /authenticated snapshot rejected/u,
      );

      assert.equal(
        await readFile(path.join(restoredVaultRoot, "existing.md"), "utf8"),
        "existing vault\n",
      );
      assert.equal(
        await readFile(path.join(operatorHomeRoot, "existing.jsonl"), "utf8"),
        "existing home\n",
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("cold v2 restore returns restoreTiming + cold boot flag; warm leaves it null", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-timing-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const snapshotRef = createWorkspaceSnapshotV2Ref();

      const coldRestored = await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map(),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              await mkdir(request.durableRoot, { recursive: true });
              await writeFile(path.join(request.durableRoot, "note.md"), "restored\n", "utf8");
              return {
                sizeGuardMs: 1,
                dataKeyUnwrapMs: 2,
                presignGetMs: 4,
                objectFetchMs: 5,
                objectFetchResponseHeadersMs: 2,
                objectFetchBodyReadMs: 3,
                decryptMs: 6,
                archiveExtractMs: 7,
                durableRootReplaceMs: 9,
                cleanupMs: 10,
                extractMs: 11,
                encryptedBytes: 12,
                plainBytes: 13,
              };
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({ snapshotRef }),
      });

      assert.equal(coldRestored.restoreWasCold, true);
      assert.deepEqual(coldRestored.restoreTiming, {
        sizeGuardMs: 1,
        dataKeyUnwrapMs: 2,
        presignGetMs: 4,
        objectFetchMs: 5,
        objectFetchResponseHeadersMs: 2,
        objectFetchBodyReadMs: 3,
        decryptMs: 6,
        archiveExtractMs: 7,
        durableRootReplaceMs: 9,
        cleanupMs: 10,
        extractMs: 11,
        encryptedBytes: 12,
        plainBytes: 13,
      });

      // Null-bootstrap (no snapshot ref) is a warm/empty path: restoreTiming stays null.
      const warmRestored = await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({ artifactBytesByHash: new Map() }),
        vaultRoot: path.join(workspaceRoot, "null-bootstrap-vault"),
        workspace: createWorkspaceState({ snapshotRef: null }),
      });
      assert.equal(warmRestored.restoreTiming, null);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("reuses a matching warm-clean v2 workspace marker once", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-warm-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "durable", "vault");
      const operatorHomeRoot = path.join(workspaceRoot, "durable", "home");
      const assistantStateRoot = resolveAssistantStatePaths(restoredVaultRoot).assistantStateRoot;
      const snapshotRef = createWorkspaceSnapshotV2Ref();
      const workspace = createWorkspaceState({ snapshotRef });
      await mkdir(assistantStateRoot, { recursive: true });
      await mkdir(operatorHomeRoot, { recursive: true });
      await writeFile(path.join(restoredVaultRoot, "vault.json"), "{}\n", "utf8");
      await writeFile(path.join(restoredVaultRoot, "note.md"), "warm local workspace\n", "utf8");
      assert.equal(
        await writeHostedWorkspaceCleanCheckpointMarkerBestEffort({
          vaultRoot: restoredVaultRoot,
          workspace,
        }),
        true,
      );

      let restoreCallCount = 0;
      const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map(),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot() {
              restoreCallCount += 1;
              throw new Error("matching warm marker should skip v2 snapshot restore.");
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace,
      });

      assert.equal(restored.mode, "snapshot");
      assert.equal(restored.restoreWasCold, false);
      assert.equal(restored.restoreTiming, null);
      assert.equal(restoreCallCount, 0);
      assert.equal(
        await readFile(path.join(restoredVaultRoot, "note.md"), "utf8"),
        "warm local workspace\n",
      );

      const coldRestoreCalls: string[] = [];
      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map(),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              coldRestoreCalls.push(request.ref.snapshotId);
              const vaultRoot = path.join(request.durableRoot, "vault");
              await mkdir(vaultRoot, { recursive: true });
              await writeFile(path.join(vaultRoot, "vault.json"), "{}\n", "utf8");
              await writeFile(path.join(vaultRoot, "note.md"), "cold restore\n", "utf8");
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace,
      });

      assert.deepEqual(coldRestoreCalls, [snapshotRef.snapshotId]);
      assert.equal(await readFile(path.join(restoredVaultRoot, "note.md"), "utf8"), "cold restore\n");
    } finally {
      await rm(workspaceRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("falls back to cold v2 restore when canonical receipt status changes", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-warm-receipts-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "durable", "vault");
      const operatorHomeRoot = path.join(workspaceRoot, "durable", "home");
      const assistantStateRoot = resolveAssistantStatePaths(restoredVaultRoot).assistantStateRoot;
      const snapshotRef = createWorkspaceSnapshotV2Ref();
      await mkdir(assistantStateRoot, { recursive: true });
      await mkdir(operatorHomeRoot, { recursive: true });
      await writeFile(path.join(restoredVaultRoot, "vault.json"), "{}\n", "utf8");

      assert.equal(
        await writeHostedWorkspaceCleanCheckpointMarkerBestEffort({
          vaultRoot: restoredVaultRoot,
          workspace: createWorkspaceState({ snapshotRef }),
        }),
        true,
      );

      const receiptLogBytes = new TextEncoder().encode(JSON.stringify({
        entries: [],
        schema: "murph.hosted-canonical-write-receipt-log.v1",
      }));
      const receiptLogSha256 = sha256HostedBundleHex(receiptLogBytes);
      const workspace = createWorkspaceState({
        redactedStatus: {
          hostedCanonicalWriteReceiptLogByteSize: receiptLogBytes.byteLength,
          hostedCanonicalWriteReceiptLogEntryCount: 0,
          hostedCanonicalWriteReceiptLogSha256: receiptLogSha256,
        },
        snapshotRef,
      });
      const restoreCalls: string[] = [];
      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map([[receiptLogSha256, receiptLogBytes]]),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              restoreCalls.push(request.ref.snapshotId);
              const vaultRoot = path.join(request.durableRoot, "vault");
              await mkdir(vaultRoot, { recursive: true });
              await writeFile(path.join(vaultRoot, "vault.json"), "{}\n", "utf8");
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace,
      });

      assert.deepEqual(restoreCalls, [snapshotRef.snapshotId]);
    } finally {
      await rm(workspaceRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("preserves v2 Codex continuity when the rollout exists", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-restore-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "durable", "vault");
      const providerSessionId = "00000000-0000-4000-8000-000000000051";
      const rolloutRelativePath =
        `sessions/2026/05/20/rollout-2026-05-20T01-02-03-${providerSessionId}.jsonl`;
      const snapshotRef = createWorkspaceSnapshotV2Ref();

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map(),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              await mkdir(path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions"), {
                recursive: true,
              });
              await mkdir(path.join(request.durableRoot, "home", ".codex-hosted", path.dirname(rolloutRelativePath)), {
                recursive: true,
              });
              await writeFile(
                path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions", "session.json"),
                JSON.stringify({
                  resumeState: {
                    codexRolloutRelativePath: rolloutRelativePath,
                    providerSessionId,
                    resumeRouteId: "route-ready",
                  },
                }) + "\n",
                "utf8",
              );
              await writeFile(
                path.join(request.durableRoot, "home", ".codex-hosted", rolloutRelativePath),
                "{\"type\":\"legacy-rollout\"}\n",
                "utf8",
              );
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef,
        }),
      });

      assert.equal(
        await readFile(path.join(workspaceRoot, "durable", "home", ".codex-hosted", rolloutRelativePath), "utf8"),
        "{\"type\":\"legacy-rollout\"}\n",
      );
    } finally {
      await rm(workspaceRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("clears v2 Codex resume when the rollout is missing", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-restore-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "durable", "vault");
      const providerSessionId = "00000000-0000-4000-8000-000000000053";
      const rolloutRelativePath =
        `sessions/2026/05/20/rollout-2026-05-20T01-02-03-${providerSessionId}.jsonl`;
      const snapshotRef = createWorkspaceSnapshotV2Ref();
      const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map(),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              await mkdir(path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions"), {
                recursive: true,
              });
              await writeFile(
                path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions", "session.json"),
                JSON.stringify({
                  resumeState: {
                    codexRolloutRelativePath: rolloutRelativePath,
                    providerSessionId,
                    resumeRouteId: "route-ready",
                  },
                }) + "\n",
                "utf8",
              );
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef,
        }),
      });

      assert.equal(restored.mode, "snapshot");
      const repairedSession = JSON.parse(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      assert.deepEqual(repairedSession, {
        resumeState: null,
      });
      await assert.rejects(
        readFile(path.join(workspaceRoot, "durable", "home", ".codex-hosted", rolloutRelativePath), "utf8"),
        { code: "ENOENT" },
      );
    } finally {
      await rm(workspaceRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("clears v2 Codex resume when the rollout belongs to a different thread", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-restore-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "durable", "vault");
      const providerSessionId = "00000000-0000-4000-8000-000000000055";
      const otherProviderSessionId = "00000000-0000-4000-8000-000000000056";
      const rolloutRelativePath =
        `sessions/2026/05/20/rollout-2026-05-20T01-02-03-${otherProviderSessionId}.jsonl`;
      const snapshotRef = createWorkspaceSnapshotV2Ref();

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map(),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              await mkdir(path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions"), {
                recursive: true,
              });
              await mkdir(path.join(request.durableRoot, "home", ".codex-hosted", path.dirname(rolloutRelativePath)), {
                recursive: true,
              });
              await writeFile(
                path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions", "session.json"),
                JSON.stringify({
                  resumeState: {
                    codexRolloutRelativePath: rolloutRelativePath,
                    providerSessionId,
                    resumeRouteId: "route-ready",
                  },
                }) + "\n",
                "utf8",
              );
              await writeFile(
                path.join(request.durableRoot, "home", ".codex-hosted", rolloutRelativePath),
                "other-thread-rollout\n",
                "utf8",
              );
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef,
        }),
      });

      const restoredSession = JSON.parse(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      assert.deepEqual(restoredSession, {
        resumeState: null,
      });
      await assert.rejects(
        readFile(path.join(workspaceRoot, "durable", "home", ".codex-hosted", rolloutRelativePath), "utf8"),
        { code: "ENOENT" },
      );
    } finally {
      await rm(workspaceRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("clears only v2 Codex sessions whose referenced rollout is missing", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-restore-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "durable", "vault");
      const preservedProviderSessionId = "00000000-0000-4000-8000-000000000061";
      const missingProviderSessionId = "00000000-0000-4000-8000-000000000062";
      const preservedRolloutRelativePath =
        `sessions/2026/05/20/rollout-2026-05-20T01-02-03-${preservedProviderSessionId}.jsonl`;
      const missingRolloutRelativePath =
        `sessions/2026/05/20/rollout-2026-05-20T02-03-04-${missingProviderSessionId}.jsonl`;
      const snapshotRef = createWorkspaceSnapshotV2Ref();

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map(),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              await mkdir(path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions"), {
                recursive: true,
              });
              await mkdir(path.join(request.durableRoot, "home", ".codex-hosted", path.dirname(preservedRolloutRelativePath)), {
                recursive: true,
              });
              await writeFile(
                path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions", "preserved.json"),
                JSON.stringify({
                  resumeState: {
                    codexRolloutRelativePath: preservedRolloutRelativePath,
                    providerSessionId: preservedProviderSessionId,
                    resumeRouteId: "route-preserved",
                  },
                }) + "\n",
                "utf8",
              );
              await writeFile(
                path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions", "missing.json"),
                JSON.stringify({
                  resumeState: {
                    codexRolloutRelativePath: missingRolloutRelativePath,
                    providerSessionId: missingProviderSessionId,
                    resumeRouteId: "route-missing",
                  },
                }) + "\n",
                "utf8",
              );
              await writeFile(
                path.join(request.durableRoot, "home", ".codex-hosted", preservedRolloutRelativePath),
                "preserved-rollout\n",
                "utf8",
              );
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef,
        }),
      });

      const preservedSession = JSON.parse(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "preserved.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const missingSession = JSON.parse(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "missing.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      assert.deepEqual(preservedSession, {
        resumeState: {
          codexRolloutRelativePath: preservedRolloutRelativePath,
          providerSessionId: preservedProviderSessionId,
          resumeRouteId: "route-preserved",
        },
      });
      assert.deepEqual(missingSession, {
        resumeState: null,
      });
      assert.equal(
        await readFile(path.join(workspaceRoot, "durable", "home", ".codex-hosted", preservedRolloutRelativePath), "utf8"),
        "preserved-rollout\n",
      );
    } finally {
      await rm(workspaceRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("ignores obsolete manifest digest when the v2 rollout exists", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-restore-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "durable", "vault");
      const providerSessionId = "00000000-0000-4000-8000-000000000052";
      const rolloutRelativePath =
        `sessions/2026/05/20/rollout-2026-05-20T01-02-03-${providerSessionId}.jsonl`;
      const actualRollout = "actual-rollout\n";
      const expectedRollout = "expect-rollout\n";
      const snapshotRef = createWorkspaceSnapshotV2Ref();

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map(),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              await mkdir(path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions"), {
                recursive: true,
              });
              await mkdir(path.join(request.durableRoot, "home", ".codex-hosted", path.dirname(rolloutRelativePath)), {
                recursive: true,
              });
              await mkdir(path.join(request.durableRoot, "home", ".murph"), {
                recursive: true,
              });
              await writeFile(
                path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions", "session.json"),
                JSON.stringify({
                  resumeState: {
                    codexRolloutRelativePath: rolloutRelativePath,
                    providerSessionId,
                    resumeRouteId: "route-ready",
                  },
                }) + "\n",
                "utf8",
              );
              await writeFile(
                path.join(request.durableRoot, "home", ".codex-hosted", rolloutRelativePath),
                actualRollout,
                "utf8",
              );
              await writeFile(
                path.join(request.durableRoot, "home", ".murph", "hosted-codex-continuity.json"),
                JSON.stringify({
                  schema: "murph.hosted-codex-continuity.v1",
                  threads: [{
                    codexRolloutRelativePath: rolloutRelativePath,
                    providerSessionId,
                    rolloutBlob: {
                      byteSize: Buffer.byteLength(actualRollout),
                      sha256: sha256HostedBundleHex(Buffer.from(expectedRollout)),
                      storage: "hosted-bundle.v1",
                    },
                  }],
                }) + "\n",
                "utf8",
              );
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef,
        }),
      });

      const repairedSession = JSON.parse(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      assert.deepEqual(repairedSession, {
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId,
          resumeRouteId: "route-ready",
        },
      });
      assert.equal(
        await readFile(path.join(workspaceRoot, "durable", "home", ".codex-hosted", rolloutRelativePath), "utf8"),
        actualRollout,
      );
    } finally {
      await rm(workspaceRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("preserves v2 Codex continuity while pruning extra Codex home files", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-restore-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "durable", "vault");
      const providerSessionId = "00000000-0000-4000-8000-000000000054";
      const rolloutRelativePath =
        `sessions/2026/05/20/rollout-2026-05-20T01-02-03-${providerSessionId}.jsonl`;
      const rollout = "rollout-ok\n";
      const snapshotRef = createWorkspaceSnapshotV2Ref();

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map(),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              await mkdir(path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions"), {
                recursive: true,
              });
              await mkdir(path.join(request.durableRoot, "home", ".codex-hosted", path.dirname(rolloutRelativePath)), {
                recursive: true,
              });
              await mkdir(path.join(request.durableRoot, "home", ".codex-hosted", "sessions", "2026", "05", "21"), {
                recursive: true,
              });
              await writeFile(
                path.join(request.durableRoot, "vault", ".runtime", "operations", "assistant", "sessions", "session.json"),
                JSON.stringify({
                  resumeState: {
                    codexRolloutRelativePath: rolloutRelativePath,
                    providerSessionId,
                    resumeRouteId: "route-ready",
                  },
                }) + "\n",
                "utf8",
              );
              await writeFile(
                path.join(request.durableRoot, "home", ".codex-hosted", rolloutRelativePath),
                rollout,
                "utf8",
              );
              await writeFile(
                path.join(
                  request.durableRoot,
                  "home",
                  ".codex-hosted",
                  "sessions",
                  "2026",
                  "05",
                  "21",
                  `rollout-2026-05-21T01-02-03-${providerSessionId}.jsonl`,
                ),
                "extra-rollout\n",
                "utf8",
              );
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef,
        }),
      });

      const repairedSession = JSON.parse(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;
      assert.deepEqual(repairedSession, {
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId,
          resumeRouteId: "route-ready",
        },
      });
      assert.equal(
        await readFile(path.join(workspaceRoot, "durable", "home", ".codex-hosted", rolloutRelativePath), "utf8"),
        rollout,
      );
      await assert.rejects(
        readFile(
          path.join(
            workspaceRoot,
            "durable",
            "home",
            ".codex-hosted",
            "sessions",
            "2026",
            "05",
            "21",
            `rollout-2026-05-21T01-02-03-${providerSessionId}.jsonl`,
          ),
          "utf8",
        ),
        { code: "ENOENT" },
      );
    } finally {
      await rm(workspaceRoot, {
        force: true,
        recursive: true,
      });
    }
  });

  test("v2 restore replays archived integration ingest amendment receipts", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-archived-ingest-receipt-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "durable", "vault");
      const snapshotRef = createWorkspaceSnapshotV2Ref();
      const logicalPath = "ledger/integration-ingests/2025/2025-10.jsonl";
      const archivedRecord = makeIntegrationIngestRecord({
        eventId: "evt_RestoreArchivedIngestReceipt1",
        id: "xfm_RestoreArchivedIngestReceipt1",
        importedAt: "2025-10-12T09:00:00.000Z",
      });
      const appendedRecord = makeIntegrationIngestRecord({
        eventId: "evt_RestoreArchivedIngestReceipt2",
        id: "xfm_RestoreArchivedIngestReceipt2",
        importedAt: "2025-10-13T09:00:00.000Z",
      });
      const secondAppendedRecord = makeIntegrationIngestRecord({
        eventId: "evt_RestoreArchivedIngestReceipt3",
        id: "xfm_RestoreArchivedIngestReceipt3",
        importedAt: "2025-10-14T09:00:00.000Z",
      });
      const basePayload = `${JSON.stringify(archivedRecord)}\n`;
      const baseBytes = Buffer.from(basePayload, "utf8");
      const appendPayload = `${JSON.stringify(appendedRecord)}\n`;
      const appendBytes = Buffer.from(appendPayload, "utf8");
      const appendSha256 = sha256HostedBundleHex(appendBytes);
      const secondBasePayload = `${basePayload}${appendPayload}`;
      const secondBaseBytes = Buffer.from(secondBasePayload, "utf8");
      const secondAppendPayload = `${JSON.stringify(secondAppendedRecord)}\n`;
      const secondAppendBytes = Buffer.from(secondAppendPayload, "utf8");
      const secondAppendSha256 = sha256HostedBundleHex(secondAppendBytes);
      const firstReceiptArtifact = createJsonArtifact({
        actions: [
          {
            allowArchivedIntegrationIngestAmendment: true,
            appendByteLength: appendBytes.byteLength,
            appendSha256,
            baseByteLength: baseBytes.byteLength,
            baseSha256: sha256HostedBundleHex(baseBytes),
            contentRef: {
              byteSize: appendBytes.byteLength,
              sha256: appendSha256,
            },
            kind: "jsonl_append",
            originalSize: baseBytes.byteLength,
            targetRelativePath: logicalPath,
          },
        ],
        committedAt: "2026-05-05T00:00:00.000Z",
        createdAt: "2026-05-05T00:00:00.000Z",
        occurredAt: "2026-05-05T00:00:00.000Z",
        operationId: "op_z_synthetic_archived_ingest_restore_first",
        operationType: "hosted_archived_ingest_restore_test",
        schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
        summary: "Restore first archived integration ingest amendment.",
        updatedAt: "2026-05-05T00:00:00.000Z",
      });
      const secondReceiptArtifact = createJsonArtifact({
        actions: [
          {
            allowArchivedIntegrationIngestAmendment: true,
            appendByteLength: secondAppendBytes.byteLength,
            appendSha256: secondAppendSha256,
            baseByteLength: secondBaseBytes.byteLength,
            baseSha256: sha256HostedBundleHex(secondBaseBytes),
            contentRef: {
              byteSize: secondAppendBytes.byteLength,
              sha256: secondAppendSha256,
            },
            kind: "jsonl_append",
            originalSize: secondBaseBytes.byteLength,
            targetRelativePath: logicalPath,
          },
        ],
        committedAt: "2026-05-05T00:00:00.000Z",
        createdAt: "2026-05-05T00:00:00.000Z",
        occurredAt: "2026-05-05T00:00:00.000Z",
        operationId: "op_a_synthetic_archived_ingest_restore_second",
        operationType: "hosted_archived_ingest_restore_test",
        schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
        summary: "Restore second archived integration ingest amendment.",
        updatedAt: "2026-05-05T00:00:00.000Z",
      });
      const receiptLogArtifact = createJsonArtifact({
        entries: [firstReceiptArtifact.ref, secondReceiptArtifact.ref, secondReceiptArtifact.ref],
        schema: "murph.hosted-canonical-write-receipt-log.v1",
      });
      const artifactBytesByHash = new Map<string, Uint8Array>([
        [appendSha256, appendBytes],
        [secondAppendSha256, secondAppendBytes],
        [firstReceiptArtifact.ref.sha256, firstReceiptArtifact.bytes],
        [secondReceiptArtifact.ref.sha256, secondReceiptArtifact.bytes],
        [receiptLogArtifact.ref.sha256, receiptLogArtifact.bytes],
      ]);
      let restoreCallCount = 0;

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash,
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              restoreCallCount += 1;
              const vaultRoot = path.join(request.durableRoot, "vault");
              await initializeVault({
                createdAt: "2026-05-05T00:00:00.000Z",
                vaultRoot,
              });
              await mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
              await writeFile(path.join(vaultRoot, `${logicalPath}.gz`), gzipSync(basePayload));
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          redactedStatus: {
            hostedCanonicalWriteReceiptLogByteSize: receiptLogArtifact.ref.byteSize,
            hostedCanonicalWriteReceiptLogEntryCount: 3,
            hostedCanonicalWriteReceiptLogSha256: receiptLogArtifact.ref.sha256,
          },
          snapshotRef,
        }),
      });

      assert.equal(restoreCallCount, 1);
      await assert.rejects(readFile(path.join(restoredVaultRoot, logicalPath), "utf8"), {
        code: "ENOENT",
      });
      await readFile(path.join(restoredVaultRoot, `${logicalPath}.gz`));
      assert.deepEqual(
        (await readIntegrationIngestEntries(restoredVaultRoot)).map((entry) => entry.record.id),
        [archivedRecord.id, appendedRecord.id, secondAppendedRecord.id],
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("v2 restore replays archived event amendments idempotently", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-v2-archived-event-receipt-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "durable", "vault");
      const snapshotRef = createWorkspaceSnapshotV2Ref();
      const logicalPath = "ledger/events/2025/2025-10.jsonl";
      const archivedRecord = { id: "evt_RestoreArchivedEventReceipt1" };
      const appendedRecord = { id: "evt_RestoreArchivedEventReceipt2" };
      const basePayload = `${JSON.stringify(archivedRecord)}\n`;
      const baseBytes = Buffer.from(basePayload, "utf8");
      const appendPayload = `${JSON.stringify(appendedRecord)}\n`;
      const appendBytes = Buffer.from(appendPayload, "utf8");
      const appendSha256 = sha256HostedBundleHex(appendBytes);
      const receiptArtifact = createJsonArtifact({
        actions: [
          {
            appendByteLength: appendBytes.byteLength,
            appendSha256,
            baseByteLength: baseBytes.byteLength,
            baseSha256: sha256HostedBundleHex(baseBytes),
            contentRef: {
              byteSize: appendBytes.byteLength,
              sha256: appendSha256,
            },
            kind: "jsonl_append",
            originalSize: baseBytes.byteLength,
            targetRelativePath: logicalPath,
          },
        ],
        committedAt: "2026-05-05T00:00:00.000Z",
        createdAt: "2026-05-05T00:00:00.000Z",
        occurredAt: "2026-05-05T00:00:00.000Z",
        operationId: "op_synthetic_archived_event_restore",
        operationType: "hosted_archived_event_restore_test",
        schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
        summary: "Restore an archived event amendment.",
        updatedAt: "2026-05-05T00:00:00.000Z",
      });
      const receiptLogArtifact = createJsonArtifact({
        entries: [receiptArtifact.ref, receiptArtifact.ref],
        schema: "murph.hosted-canonical-write-receipt-log.v1",
      });
      const artifactBytesByHash = new Map<string, Uint8Array>([
        [appendSha256, appendBytes],
        [receiptArtifact.ref.sha256, receiptArtifact.bytes],
        [receiptLogArtifact.ref.sha256, receiptLogArtifact.bytes],
      ]);

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash,
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("abortSnapshotSession is not used during v2 restore.");
            },
            async completeSnapshotSession() {
              throw new Error("completeSnapshotSession is not used during v2 restore.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("putSnapshotObjectDirect is not used during v2 restore.");
            },
            async restoreWorkspaceSnapshot(request) {
              const vaultRoot = path.join(request.durableRoot, "vault");
              await initializeVault({
                createdAt: "2026-05-05T00:00:00.000Z",
                vaultRoot,
              });
              await mkdir(path.dirname(path.join(vaultRoot, logicalPath)), { recursive: true });
              await writeFile(path.join(vaultRoot, `${logicalPath}.gz`), gzipSync(basePayload));
            },
            async startSnapshotSession() {
              throw new Error("startSnapshotSession is not used during v2 restore.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          redactedStatus: {
            hostedCanonicalWriteReceiptLogByteSize: receiptLogArtifact.ref.byteSize,
            hostedCanonicalWriteReceiptLogEntryCount: 2,
            hostedCanonicalWriteReceiptLogSha256: receiptLogArtifact.ref.sha256,
          },
          snapshotRef,
        }),
      });

      await assert.rejects(readFile(path.join(restoredVaultRoot, logicalPath), "utf8"), {
        code: "ENOENT",
      });
      await readFile(path.join(restoredVaultRoot, `${logicalPath}.gz`));
      assert.deepEqual(
        (await readEventLedgerShardRecords({
          relativePath: logicalPath,
          vaultRoot: restoredVaultRoot,
        })).map((record) => record.id),
        [archivedRecord.id, appendedRecord.id],
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

});

function flattenLogEntries(
  requests: readonly HostedRuntimeLogRequest[],
): HostedRuntimeLogRequest["entries"] {
  return requests.flatMap((request) => request.entries);
}

function createCodexSessionRecord(input: {
  alias?: string | null;
  resumeState?: unknown;
  sessionId: string;
}): {
  alias: string | null;
  binding: AssistantSessionBinding;
  createdAt: string;
  lastTurnAt: string | null;
  resumeState: unknown;
  schema: "murph.assistant-session.v1";
  sessionId: string;
  target: AssistantModelTarget;
  turnCount: number;
  updatedAt: string;
} {
  return {
    alias: input.alias ?? null,
    binding: createEmptyAssistantSessionBinding(),
    createdAt: "2026-05-05T00:00:00.000Z",
    lastTurnAt: null,
    resumeState: input.resumeState ?? null,
    schema: "murph.assistant-session.v1",
    sessionId: input.sessionId,
    target: createHostedCodexSessionTarget(),
    turnCount: 0,
    updatedAt: "2026-05-05T00:00:00.000Z",
  };
}

function createHostedCodexSessionTarget(): AssistantModelTarget {
  return {
    adapter: "codex-cli",
    approvalPolicy: "never",
    codexCommand: null,
    codexHome: null,
    model: "gpt-5.6-terra",
    modelProvider: "openai",
    oss: false,
    profile: null,
    reasoningEffort: "medium",
    sandbox: "danger-full-access",
  };
}

function createEmptyAssistantSessionBinding(): AssistantSessionBinding {
  return {
    actorId: null,
    channel: null,
    conversationKey: null,
    delivery: null,
    identityId: null,
    threadId: null,
    threadIsDirect: null,
  };
}

function makeIntegrationIngestRecord(input: {
  eventId: string;
  id: string;
  importedAt: string;
}): ReturnType<typeof buildIntegrationIngestRecord> {
  const role = `summary-${input.id}`;
  const part = buildIntegrationEvidencePart({
    content: JSON.stringify({ id: input.id }),
    fileName: `${input.id}.json`,
    mediaType: "application/json",
    role,
  });

  return buildIntegrationIngestRecord({
    eventCount: 1,
    eventIdsComplete: true,
    eventOutputs: [
      {
        id: input.eventId,
        roles: [role],
      },
    ],
    id: input.id,
    importedAt: input.importedAt,
    parts: [part],
    provider: "junction",
    sampleCount: 0,
    sampleIds: [],
    sampleIdsComplete: true,
    source: "device",
  });
}

function createJsonArtifact(value: unknown): {
  bytes: Uint8Array;
  ref: {
    byteSize: number;
    sha256: string;
  };
} {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  return {
    bytes,
    ref: {
      byteSize: bytes.byteLength,
      sha256: sha256HostedBundleHex(bytes),
    },
  };
}

function createBundleRef(input: {
  hash: string;
  key: string;
  size: number;
}): HostedExecutionBundleRef {
  return {
    ...input,
    updatedAt: "2026-05-05T00:00:00.000Z",
  };
}

function createWorkspaceSnapshotV2Ref(): HostedWorkspaceSnapshotV2Ref {
  const userId = "member_synthetic_workspace_restore";
  const snapshotId = "snapshot_restore_v2";
  const objectKey =
    "users/hsn_abcdef0123456789abcdef01/workspace-snapshots/snapshot_restore_v2.snapshot.enc";
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
    createdAt: "2026-05-05T00:00:00.000Z",
    encryption: {
      aad: buildHostedWorkspaceSnapshotV2Aad({
        objectKey,
        snapshotId,
        userId,
      }),
      ivBase64: "AQIDBAUGBwgJCgsM",
      rootKeyId: "root_key_restore_v2",
      scheme: HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME,
      wrappedDataKey: "wrapped_data_key_restore_v2",
    },
    objectKey,
    schema: HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
    snapshotId,
    upload: HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
    userId,
  } satisfies HostedWorkspaceSnapshotV2Ref;
}

function createRestorePlatform(input: {
  artifactBytesByHash: ReadonlyMap<string, Uint8Array>;
  artifactGetCalls?: string[];
  logRequests?: HostedRuntimeLogRequest[];
  workspaceSnapshotPort?: HostedRuntimePlatform["workspaceSnapshotPort"];
}): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get(sha256) {
        input.artifactGetCalls?.push(sha256);
        return input.artifactBytesByHash.get(sha256) ?? null;
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
        input.logRequests?.push(request);
        return {
          loggedCount: request.entries.length,
        };
      },
    },
    ...(input.workspaceSnapshotPort ? { workspaceSnapshotPort: input.workspaceSnapshotPort } : {}),
  };
}

function createWorkspaceState(input: {
  redactedStatus?: HostedWorkspaceState["redactedStatus"];
  snapshotRef: HostedWorkspaceState["snapshotRef"];
}): HostedWorkspaceState {
  return {
    createdAt: "2026-05-05T00:00:00.000Z",
    ...(input.redactedStatus ? { redactedStatus: input.redactedStatus } : {}),
    snapshotRef: input.snapshotRef,
    updatedAt: "2026-05-05T00:00:00.000Z",
    userId: "member_synthetic_workspace_restore",
    version: "9",
  };
}
