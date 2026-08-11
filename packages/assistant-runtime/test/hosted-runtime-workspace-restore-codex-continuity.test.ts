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
  readIntegrationIngestEntries,
} from "@murphai/core";
import {
  type AssistantSessionResumeState,
  type AssistantSessionBinding,
  type AssistantModelTarget,
} from "@murphai/operator-config/assistant-cli-contracts";
import {
  createHostedPortableWorkspaceManifestFromBundle,
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  snapshotHostedAssistantRuntimeHotState,
  snapshotHostedBundleRoots,
  snapshotHostedPortableWorkspaceDelta,
  writeHostedBundleTextFile,
  type HostedExecutionBundleRef,
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
import type {
  HostedRuntimeLogRequest,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { describe, test } from "vitest";

import {
  materializeLegacyWorkspaceRefsForV2Snapshot,
} from "../src/hosted-runtime/legacy-snapshot-materialization.ts";
import {
  markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort,
  restoreHostedWorkspaceRuntimeJobWorkspace,
  writeHostedWorkspaceCleanCheckpointMarkerBestEffort,
} from "../src/hosted-runtime/workspace-restore.ts";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime-contracts.ts";

describe("hosted workspace restore Codex continuity", () => {
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

  test("preserves Codex provider continuity when hot state includes its exact rollout", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-restore-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const sourceBaseOperatorHomeRoot = path.join(workspaceRoot, "base-operator-home");
      const sourceHotVaultRoot = path.join(workspaceRoot, "hot-vault");
      const sourceHotOperatorHomeRoot = path.join(workspaceRoot, "hot-operator-home");
      const baseAssistantRoot = resolveAssistantStatePaths(sourceBaseVaultRoot).assistantStateRoot;
      const threadId = "00000000-0000-4000-8000-000000000005";
      const rolloutRelativePath =
        `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
      const resumeState = {
        codexRolloutRelativePath: rolloutRelativePath,
        providerSessionId: threadId,
        resumeRouteId: "route-latest",
      };
      await mkdir(path.join(baseAssistantRoot, "outbox"), { recursive: true });
      await mkdir(path.join(baseAssistantRoot, "sessions"), { recursive: true });
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
      await writeFile(
        path.join(baseAssistantRoot, "outbox", "intent-old.json"),
        "{\"intent\":\"old\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(baseAssistantRoot, "sessions", "session-latest.json"),
        JSON.stringify({
          resumeState,
          session: "base",
        }) + "\n",
        "utf8",
      );
      await mkdir(path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06"), {
        recursive: true,
      });
      const baseRolloutJson = "{\"codex\":\"old\"}\n";
      await writeFile(
        path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", rolloutRelativePath),
        baseRolloutJson,
        "utf8",
      );
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
          {
            root: sourceBaseOperatorHomeRoot,
            rootKey: "operator-home",
          },
        ],
      });
      assert.ok(baseBundle);

      const hotAssistantRoot = resolveAssistantStatePaths(sourceHotVaultRoot).assistantStateRoot;
      await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
      await writeFile(
        path.join(hotAssistantRoot, "sessions", "session-latest.json"),
        JSON.stringify({
          resumeState,
          session: "latest",
        }) + "\n",
        "utf8",
      );
      await mkdir(path.join(sourceHotOperatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06"), {
        recursive: true,
      });
      await writeFile(
        path.join(sourceHotOperatorHomeRoot, ".codex-hosted", rolloutRelativePath),
        "{\"codex\":\"latest\"}\n",
        "utf8",
      );
      const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        operatorHomeRoot: sourceHotOperatorHomeRoot,
        vaultRoot: sourceHotVaultRoot,
      });
      const baseHash = sha256HostedBundleHex(baseBundle);
      const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
      const artifactGetCalls: string[] = [];
      const logRequests: HostedRuntimeLogRequest[] = [];

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map([
            [baseHash, baseBundle],
            [hotHash, hotSnapshot.bundle],
          ]),
          artifactGetCalls,
          logRequests,
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: buildHostedExecutionLayeredSnapshotRef({
            base: createBundleRef({
              hash: baseHash,
              key: "users/bundles/member-synthetic/base.bundle.json",
              size: baseBundle.byteLength,
            }),
            hot: createBundleRef({
              hash: hotHash,
              key: `cloudflare-workspace-hot-state/${hotHash}.bundle`,
              size: hotSnapshot.bundle.byteLength,
            }),
          }),
        }),
      });

      assert.deepEqual(artifactGetCalls, [baseHash, hotHash]);
      assert.equal(await readFile(path.join(restoredVaultRoot, "note.md"), "utf8"), "base note\n");
      await assert.rejects(
        readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "outbox", "intent-old.json"),
          "utf8",
        ),
      );
      assert.equal(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session-latest.json"),
          "utf8",
        ),
        JSON.stringify({
          resumeState,
          session: "latest",
        }) + "\n",
      );
      const restoredOperatorHomeRoot = path.join(
        path.dirname(restoredVaultRoot),
        `${path.basename(restoredVaultRoot)}-operator-home`,
      );
      assert.equal(
        await readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", rolloutRelativePath), "utf8"),
        "{\"codex\":\"latest\"}\n",
      );
      await assert.rejects(
        readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", "sessions", "old-only.json"), "utf8"),
      );
      assert.deepEqual(flattenLogEntries(logRequests), []);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
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

  test("restores externalized hot Codex rollout artifacts before continuity verification", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-hot-artifact-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceHotVaultRoot = path.join(workspaceRoot, "hot-vault");
      const sourceHotOperatorHomeRoot = path.join(workspaceRoot, "hot-operator-home");
      const hotAssistantRoot = resolveAssistantStatePaths(sourceHotVaultRoot).assistantStateRoot;
      const threadId = "00000000-0000-4000-8000-000000000045";
      const rolloutRelativePath =
        `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
      const rolloutJson = `${"{\"codex\":\"artifact\"}\n".repeat(64)}`;
      const resumeState = {
        codexRolloutRelativePath: rolloutRelativePath,
        providerSessionId: threadId,
        resumeRouteId: "route-artifact",
      };
      const artifactBytesByHash = new Map<string, Uint8Array>();
      await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
      await mkdir(path.join(sourceHotOperatorHomeRoot, ".codex-hosted", path.dirname(rolloutRelativePath)), {
        recursive: true,
      });
      await writeFile(
        path.join(hotAssistantRoot, "sessions", "session-latest.json"),
        JSON.stringify({
          resumeState,
          session: "artifact",
        }) + "\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceHotOperatorHomeRoot, ".codex-hosted", rolloutRelativePath),
        rolloutJson,
        "utf8",
      );

      const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        codexContinuityArtifactSink: async (artifact) => {
          artifactBytesByHash.set(artifact.ref.sha256, new Uint8Array(artifact.bytes));
        },
        operatorHomeRoot: sourceHotOperatorHomeRoot,
        vaultRoot: sourceHotVaultRoot,
      });
      const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
      const rolloutHash = sha256HostedBundleHex(Buffer.from(rolloutJson));
      assert.ok(artifactBytesByHash.has(rolloutHash));
      artifactBytesByHash.set(hotHash, hotSnapshot.bundle);
      const artifactGetCalls: string[] = [];

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash,
          artifactGetCalls,
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: createBundleRef({
            hash: hotHash,
            key: `cloudflare-workspace-hot-state/${hotHash}.bundle`,
            size: hotSnapshot.bundle.byteLength,
          }),
        }),
      });

      assert.deepEqual(artifactGetCalls, [hotHash, rolloutHash]);
      const restoredOperatorHomeRoot = path.join(
        path.dirname(restoredVaultRoot),
        `${path.basename(restoredVaultRoot)}-operator-home`,
      );
      assert.equal(
        await readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", rolloutRelativePath), "utf8"),
        rolloutJson,
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("cold-restores unchanged legacy snapshots instead of reusing dirty local roots", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-base-cache-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const sourceBaseOperatorHomeRoot = path.join(workspaceRoot, "base-operator-home");
      await mkdir(sourceBaseVaultRoot, { recursive: true });
      await mkdir(path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", "sessions"), {
        recursive: true,
      });
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
      await writeFile(
        path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", "sessions", "old-only.json"),
        "{\"codex\":\"old\"}\n",
        "utf8",
      );
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
          {
            root: sourceBaseOperatorHomeRoot,
            rootKey: "operator-home",
          },
        ],
      });
      assert.ok(baseBundle);

      const firstHotSnapshot = await createHotStateSnapshot({
        sessionName: "first",
        threadId: "00000000-0000-4000-8000-000000000011",
        workspaceRoot,
      });
      const secondHotSnapshot = await createHotStateSnapshot({
        sessionName: "second",
        threadId: "00000000-0000-4000-8000-000000000012",
        workspaceRoot,
      });
      const baseHash = sha256HostedBundleHex(baseBundle);
      const firstHotHash = sha256HostedBundleHex(firstHotSnapshot.bundle);
      const secondHotHash = sha256HostedBundleHex(secondHotSnapshot.bundle);
      const artifactGetCalls: string[] = [];
      const logRequests: HostedRuntimeLogRequest[] = [];
      const platform = createRestorePlatform({
        artifactBytesByHash: new Map([
          [baseHash, baseBundle],
          [firstHotHash, firstHotSnapshot.bundle],
          [secondHotHash, secondHotSnapshot.bundle],
        ]),
        artifactGetCalls,
        logRequests,
      });
      const baseRef = createBundleRef({
        hash: baseHash,
        key: "users/bundles/member-synthetic/base-cache.bundle.json",
        size: baseBundle.byteLength,
      });
      const secondSnapshotRef = buildHostedExecutionLayeredSnapshotRef({
        base: baseRef,
        hot: createBundleRef({
          hash: secondHotHash,
          key: `cloudflare-workspace-hot-state/${secondHotHash}.bundle`,
          size: secondHotSnapshot.bundle.byteLength,
        }),
      });

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: buildHostedExecutionLayeredSnapshotRef({
            base: baseRef,
            hot: createBundleRef({
              hash: firstHotHash,
              key: `cloudflare-workspace-hot-state/${firstHotHash}.bundle`,
              size: firstHotSnapshot.bundle.byteLength,
            }),
          }),
        }),
      });

      assert.deepEqual(artifactGetCalls, [baseHash, firstHotHash]);
      artifactGetCalls.length = 0;
      logRequests.length = 0;
      const restoredOperatorHomeRoot = path.join(
        path.dirname(restoredVaultRoot),
        `${path.basename(restoredVaultRoot)}-operator-home`,
      );
      await writeFile(
        path.join(restoredOperatorHomeRoot, ".codex-hosted", "config.toml"),
        "sandbox_mode = \"danger-full-access\"\n",
        "utf8",
      );

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: secondSnapshotRef,
        }),
      });

      assert.deepEqual(artifactGetCalls, [baseHash, secondHotHash]);
      await assert.rejects(
        readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", "config.toml"), "utf8"),
      );
      assert.equal(await readFile(path.join(restoredVaultRoot, "note.md"), "utf8"), "base note\n");
      assert.equal(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session-latest.json"),
          "utf8",
        ),
        JSON.stringify({
          resumeState: secondHotSnapshot.resumeState,
          session: "second",
        }) + "\n",
      );
      assert.deepEqual(flattenLogEntries(logRequests), []);

      const rolloutRelativePath = secondHotSnapshot.resumeState.rolloutRelativePath;
      assert.ok(rolloutRelativePath);
      await writeFile(
        path.join(restoredOperatorHomeRoot, ".codex-hosted", "config.toml"),
        "sandbox_mode = \"danger-full-access\"\n",
        "utf8",
      );
      artifactGetCalls.length = 0;
      logRequests.length = 0;

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: secondSnapshotRef,
        }),
      });

      assert.deepEqual(artifactGetCalls, [baseHash, secondHotHash]);
      await assert.rejects(
        readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", "config.toml"), "utf8"),
      );
      assert.equal(
        await readFile(
          path.join(restoredVaultRoot, ".runtime", "operations", "assistant", "sessions", "session-latest.json"),
          "utf8",
        ),
        JSON.stringify({
          resumeState: secondHotSnapshot.resumeState,
          session: "second",
        }) + "\n",
      );
      assert.deepEqual(flattenLogEntries(logRequests), []);

      await rm(
        path.join(
          restoredOperatorHomeRoot,
          ".codex-hosted",
          rolloutRelativePath,
        ),
        { force: true },
      );
      artifactGetCalls.length = 0;

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: secondSnapshotRef,
        }),
      });
      assert.deepEqual(artifactGetCalls, [baseHash, secondHotHash]);
      assert.equal(
        await readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", rolloutRelativePath), "utf8"),
        JSON.stringify({ session: "second" }) + "\n",
      );

      const staleThreadId = "00000000-0000-4000-8000-000000000099";
      const staleRolloutRelativePath =
        `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${staleThreadId}.jsonl`;
      const staleRolloutJson = "{\"session\":\"stale\"}\n";
      await mkdir(path.join(restoredOperatorHomeRoot, ".codex-hosted", path.dirname(staleRolloutRelativePath)), {
        recursive: true,
      });
      await writeFile(
        path.join(restoredOperatorHomeRoot, ".codex-hosted", staleRolloutRelativePath),
        staleRolloutJson,
        "utf8",
      );
      artifactGetCalls.length = 0;

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: secondSnapshotRef,
        }),
      });
      assert.deepEqual(artifactGetCalls, [baseHash, secondHotHash]);

      const secondRolloutJson = JSON.stringify({ session: "second" }) + "\n";
      await writeFile(
        path.join(
          restoredOperatorHomeRoot,
          ".codex-hosted",
          rolloutRelativePath,
        ),
        "{\"session\":\"corrupted\"}\n",
        "utf8",
      );
      artifactGetCalls.length = 0;

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: secondSnapshotRef,
        }),
      });
      assert.deepEqual(artifactGetCalls, [baseHash, secondHotHash]);
      assert.equal(
        await readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", rolloutRelativePath), "utf8"),
        secondRolloutJson,
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("does not restore retired vault-share roots from legacy base or delta snapshots", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-retired-vault-share-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const sourceCurrentVaultRoot = path.join(workspaceRoot, "current-vault");
      await mkdir(path.join(sourceBaseVaultRoot, "vault-share"), { recursive: true });
      await mkdir(path.join(sourceBaseVaultRoot, "derived", "vault-share"), { recursive: true });
      await mkdir(path.join(sourceBaseVaultRoot, "vault-share-backup"), { recursive: true });
      await writeFile(
        path.join(sourceBaseVaultRoot, "vault-share", "base.json"),
        "{\"retired\":\"base\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceBaseVaultRoot, "derived", "vault-share", "base.json"),
        "{\"retired\":\"derived-base\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceBaseVaultRoot, "vault-share-backup", "base.json"),
        "{\"preserved\":\"base\"}\n",
        "utf8",
      );
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [{
          root: sourceBaseVaultRoot,
          rootKey: "vault",
        }],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const baseManifest = createHostedPortableWorkspaceManifestFromBundle(baseBundle);

      await mkdir(path.join(sourceCurrentVaultRoot, "vault-share"), { recursive: true });
      await mkdir(path.join(sourceCurrentVaultRoot, "derived", "vault-share"), { recursive: true });
      await mkdir(path.join(sourceCurrentVaultRoot, "vault-share-backup"), { recursive: true });
      await writeFile(
        path.join(sourceCurrentVaultRoot, "vault-share", "base.json"),
        "{\"retired\":\"base\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceCurrentVaultRoot, "vault-share", "delta.json"),
        "{\"retired\":\"delta\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceCurrentVaultRoot, "derived", "vault-share", "base.json"),
        "{\"retired\":\"derived-base\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceCurrentVaultRoot, "derived", "vault-share", "delta.json"),
        "{\"retired\":\"derived-delta\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceCurrentVaultRoot, "vault-share-backup", "base.json"),
        "{\"preserved\":\"updated\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceCurrentVaultRoot, "vault-share-backup", "delta.json"),
        "{\"preserved\":\"delta\"}\n",
        "utf8",
      );
      const delta = await snapshotHostedPortableWorkspaceDelta({
        baseManifest,
        baseSnapshotHash: baseHash,
        vaultRoot: sourceCurrentVaultRoot,
      });
      assert.equal(delta.kind, "changed");
      const deltaHash = sha256HostedBundleHex(delta.bundle);
      const artifactGetCalls: string[] = [];

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map([
            [baseHash, baseBundle],
            [deltaHash, delta.bundle],
          ]),
          artifactGetCalls,
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: buildHostedExecutionWorkingSnapshotRef({
            base: createBundleRef({
              hash: baseHash,
              key: `cloudflare-workspace-base/${baseHash}.bundle`,
              size: baseBundle.byteLength,
            }),
            delta: createBundleRef({
              hash: deltaHash,
              key: `cloudflare-workspace-delta/${deltaHash}.bundle`,
              size: delta.bundle.byteLength,
            }),
          }),
        }),
      });

      assert.deepEqual(artifactGetCalls, [baseHash, baseHash, deltaHash]);
      for (const retiredPath of [
        "vault-share/base.json",
        "vault-share/delta.json",
        "derived/vault-share/base.json",
        "derived/vault-share/delta.json",
      ]) {
        await assert.rejects(
          readFile(path.join(restoredVaultRoot, retiredPath), "utf8"),
          { code: "ENOENT" },
        );
      }
      assert.equal(
        await readFile(path.join(restoredVaultRoot, "vault-share-backup", "base.json"), "utf8"),
        "{\"preserved\":\"updated\"}\n",
      );
      assert.equal(
        await readFile(path.join(restoredVaultRoot, "vault-share-backup", "delta.json"), "utf8"),
        "{\"preserved\":\"delta\"}\n",
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("does not restore retired vault-share roots from legacy hot snapshots", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-retired-hot-vault-share-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const sourceHotVaultRoot = path.join(workspaceRoot, "hot-vault");
      await mkdir(sourceBaseVaultRoot, { recursive: true });
      await writeFile(path.join(sourceBaseVaultRoot, "base-note.md"), "base note\n", "utf8");
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [{ root: sourceBaseVaultRoot, rootKey: "vault" }],
      });
      assert.ok(baseBundle);

      await mkdir(path.join(sourceHotVaultRoot, "vault-share"), { recursive: true });
      await mkdir(path.join(sourceHotVaultRoot, "derived", "vault-share"), { recursive: true });
      await mkdir(path.join(sourceHotVaultRoot, "vault-share-backup"), { recursive: true });
      await writeFile(
        path.join(sourceHotVaultRoot, "vault-share", "hot.json"),
        "{\"retired\":\"hot\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceHotVaultRoot, "derived", "vault-share", "hot.json"),
        "{\"retired\":\"derived-hot\"}\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceHotVaultRoot, "vault-share-backup", "hot.json"),
        "{\"preserved\":\"hot\"}\n",
        "utf8",
      );
      const hotBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [{ root: sourceHotVaultRoot, rootKey: "vault" }],
      });
      assert.ok(hotBundle);

      const baseHash = sha256HostedBundleHex(baseBundle);
      const hotHash = sha256HostedBundleHex(hotBundle);
      const artifactGetCalls: string[] = [];
      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map([
            [baseHash, baseBundle],
            [hotHash, hotBundle],
          ]),
          artifactGetCalls,
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: buildHostedExecutionLayeredSnapshotRef({
            base: createBundleRef({
              hash: baseHash,
              key: `cloudflare-workspace-base/${baseHash}.bundle`,
              size: baseBundle.byteLength,
            }),
            hot: createBundleRef({
              hash: hotHash,
              key: `cloudflare-workspace-hot-state/${hotHash}.bundle`,
              size: hotBundle.byteLength,
            }),
          }),
        }),
      });

      assert.deepEqual(artifactGetCalls, [baseHash, hotHash]);
      for (const retiredPath of [
        "vault-share/hot.json",
        "derived/vault-share/hot.json",
      ]) {
        await assert.rejects(
          readFile(path.join(restoredVaultRoot, retiredPath), "utf8"),
          { code: "ENOENT" },
        );
      }
      assert.equal(
        await readFile(path.join(restoredVaultRoot, "vault-share-backup", "hot.json"), "utf8"),
        "{\"preserved\":\"hot\"}\n",
      );
      assert.equal(
        await readFile(path.join(restoredVaultRoot, "base-note.md"), "utf8"),
        "base note\n",
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("cold-restores legacy base snapshots when local Codex continuity is stale", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-base-cache-stale-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const sourceBaseOperatorHomeRoot = path.join(workspaceRoot, "base-operator-home");
      const baseAssistantRoot = resolveAssistantStatePaths(sourceBaseVaultRoot).assistantStateRoot;
      const threadId = "00000000-0000-4000-8000-000000000039";
      const rolloutRelativePath =
        `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
      const rolloutJson = "{\"codex\":\"base\"}\n";
      await mkdir(path.join(baseAssistantRoot, "sessions"), { recursive: true });
      await mkdir(path.join(sourceBaseOperatorHomeRoot, ".murph"), { recursive: true });
      await mkdir(path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", path.dirname(rolloutRelativePath)), {
        recursive: true,
      });
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
      await writeFile(
        path.join(baseAssistantRoot, "sessions", "session-latest.json"),
        JSON.stringify({
          resumeState: {
            codexRolloutRelativePath: rolloutRelativePath,
            providerSessionId: threadId,
            resumeRouteId: "route-base",
          },
          session: "base",
        }) + "\n",
        "utf8",
      );
      await writeFile(
        path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", rolloutRelativePath),
        rolloutJson,
        "utf8",
      );
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
          {
            root: sourceBaseOperatorHomeRoot,
            rootKey: "operator-home",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const baseRef = createBundleRef({
        hash: baseHash,
        key: `cloudflare-workspace-base/${baseHash}.bundle`,
        size: baseBundle.byteLength,
      });
      const artifactGetCalls: string[] = [];
      const platform = createRestorePlatform({
        artifactBytesByHash: new Map([[baseHash, baseBundle]]),
        artifactGetCalls,
      });

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: baseRef,
        }),
      });
      assert.deepEqual(artifactGetCalls, [baseHash]);

      const restoredOperatorHomeRoot = path.join(
        path.dirname(restoredVaultRoot),
        `${path.basename(restoredVaultRoot)}-operator-home`,
      );
      artifactGetCalls.length = 0;

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: baseRef,
        }),
      });

      assert.deepEqual(artifactGetCalls, [baseHash]);
      assert.equal(
        await readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", rolloutRelativePath), "utf8"),
        rolloutJson,
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("restores legacy hot snapshots without Codex manifest integrity checks", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-integrity-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const hotSnapshot = await createHotStateSnapshot({
        sessionName: "integrity",
        threadId: "00000000-0000-4000-8000-000000000013",
        workspaceRoot,
      });
      const rolloutRelativePath = hotSnapshot.resumeState.rolloutRelativePath;
      assert.ok(rolloutRelativePath);
      const tamperedBundle = writeHostedBundleTextFile({
        bytes: hotSnapshot.bundle,
        kind: "vault",
        path: `.codex-hosted/${rolloutRelativePath}`,
        root: "operator-home",
        text: "{\"session\":\"tampered\"}\n",
      });
      const tamperedHash = sha256HostedBundleHex(tamperedBundle);

      const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map([[tamperedHash, tamperedBundle]]),
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: createBundleRef({
            hash: tamperedHash,
            key: `cloudflare-workspace-hot-state/${tamperedHash}.bundle`,
            size: tamperedBundle.byteLength,
          }),
        }),
      });

      assert.equal(
        await readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", rolloutRelativePath), "utf8"),
        "{\"session\":\"tampered\"}\n",
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("cold-restores legacy hot snapshots from durable bundles", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-cache-missing-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      await mkdir(sourceBaseVaultRoot, { recursive: true });
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const hotSnapshot = await createHotStateSnapshot({
        sessionName: "cache-missing",
        threadId: "00000000-0000-4000-8000-000000000028",
        workspaceRoot,
      });
      const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
      const snapshotRef = buildHostedExecutionLayeredSnapshotRef({
        base: createBundleRef({
          hash: baseHash,
          key: `cloudflare-workspace-base/${baseHash}.bundle`,
          size: baseBundle.byteLength,
        }),
        hot: createBundleRef({
          hash: hotHash,
          key: `cloudflare-workspace-hot-state/${hotHash}.bundle`,
          size: hotSnapshot.bundle.byteLength,
        }),
      });
      const artifactGetCalls: string[] = [];
      const platform = createRestorePlatform({
        artifactBytesByHash: new Map([
          [baseHash, baseBundle],
          [hotHash, hotSnapshot.bundle],
        ]),
        artifactGetCalls,
      });

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef,
        }),
      });
      artifactGetCalls.length = 0;

      const restoredOperatorHomeRoot = path.join(
        path.dirname(restoredVaultRoot),
        `${path.basename(restoredVaultRoot)}-operator-home`,
      );

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef,
        }),
      });
      assert.deepEqual(artifactGetCalls, [baseHash, hotHash]);
      const rolloutRelativePath = hotSnapshot.resumeState.rolloutRelativePath;
      assert.ok(rolloutRelativePath);
      assert.equal(
        await readFile(path.join(restoredOperatorHomeRoot, ".codex-hosted", rolloutRelativePath), "utf8"),
        JSON.stringify({ session: "cache-missing" }) + "\n",
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("does not keep dirty live foreground state for an unchanged legacy snapshot", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-live-state-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      await mkdir(sourceBaseVaultRoot, { recursive: true });
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
      const lazyRelativePath = "raw/inbox/live/lazy.txt";
      const lazyBytes = Buffer.from("lazy inbox artifact\n", "utf8");
      const lazyArtifactHash = sha256HostedBundleHex(lazyBytes);
      const lazyProviderRelativePath = "raw/integrations/provider/snapshot.json";
      const lazyProviderBytes = Buffer.from("{\"provider\":\"lazy\"}\n", "utf8");
      const lazyProviderArtifactHash = sha256HostedBundleHex(lazyProviderBytes);
      await mkdir(path.dirname(path.join(sourceBaseVaultRoot, lazyRelativePath)), { recursive: true });
      await writeFile(path.join(sourceBaseVaultRoot, lazyRelativePath), lazyBytes);
      await mkdir(path.dirname(path.join(sourceBaseVaultRoot, lazyProviderRelativePath)), { recursive: true });
      await writeFile(path.join(sourceBaseVaultRoot, lazyProviderRelativePath), lazyProviderBytes);
      const baseBundle = await snapshotHostedBundleRoots({
        externalizeFile: async (file) => {
          if (file.path !== lazyRelativePath && file.path !== lazyProviderRelativePath) {
            return null;
          }

          const byteSize = file.path === lazyProviderRelativePath
            ? lazyProviderBytes.byteLength
            : lazyBytes.byteLength;
          const sha256 = file.path === lazyProviderRelativePath
            ? lazyProviderArtifactHash
            : lazyArtifactHash;

          return {
            byteSize,
            sha256,
          };
        },
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const snapshotRef = createBundleRef({
        hash: baseHash,
        key: `cloudflare-workspace-base/${baseHash}.bundle`,
        size: baseBundle.byteLength,
      });
      const artifactGetCalls: string[] = [];
      const artifactBytesByHash = new Map<string, Uint8Array>([
        [baseHash, baseBundle],
        [lazyArtifactHash, lazyBytes],
        [lazyProviderArtifactHash, lazyProviderBytes],
      ]);
      const platform = createRestorePlatform({
        artifactBytesByHash,
        artifactGetCalls,
      });

      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef,
        }),
      });
      assert.deepEqual(artifactGetCalls, [baseHash]);
      await assert.rejects(readFile(path.join(restoredVaultRoot, lazyRelativePath), "utf8"), {
        code: "ENOENT",
      });
      await assert.rejects(readFile(path.join(restoredVaultRoot, lazyProviderRelativePath), "utf8"), {
        code: "ENOENT",
      });

      await writeFile(path.join(restoredVaultRoot, "live-mailbox-state.txt"), "seq=467\n", "utf8");
      await markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort({
        snapshotRef,
        vaultRoot: restoredVaultRoot,
      });
      artifactGetCalls.length = 0;
      const samePayloadSnapshotRef = createBundleRef({
        hash: baseHash,
        key: `cloudflare-workspace-base/alternate-${baseHash}.bundle`,
        size: baseBundle.byteLength,
      });

      const liveRestored = await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: samePayloadSnapshotRef,
        }),
      });

      assert.deepEqual(artifactGetCalls, [baseHash]);
      await assert.rejects(readFile(path.join(restoredVaultRoot, "live-mailbox-state.txt"), "utf8"), {
        code: "ENOENT",
      });
      const lazyMaterialized = await liveRestored.materializeWorkspaceArtifacts([
        lazyRelativePath,
        lazyProviderRelativePath,
      ]);
      assert.deepEqual([...lazyMaterialized.materializedArtifactPaths].sort(), [
        `vault:${lazyRelativePath}`,
        `vault:${lazyProviderRelativePath}`,
      ]);
      assert.deepEqual([...lazyMaterialized.missingArtifactPaths], []);
      assert.equal(await readFile(path.join(restoredVaultRoot, lazyRelativePath), "utf8"), "lazy inbox artifact\n");
      assert.equal(
        await readFile(path.join(restoredVaultRoot, lazyProviderRelativePath), "utf8"),
        "{\"provider\":\"lazy\"}\n",
      );
      await rm(path.join(restoredVaultRoot, lazyRelativePath));
      await materializeLegacyWorkspaceRefsForV2Snapshot({
        artifactStore: platform.artifactStore,
        operatorHomeRoot: liveRestored.operatorHomeRoot,
        plan: {
          currentSnapshotRefPresent: true,
          legacyBundleRefPresent: true,
          preservedInlineFileCount: 1,
          preservedState: {
            inlineFiles: [{
              bytes: lazyBytes,
              path: lazyRelativePath,
              root: "vault",
              sha256: lazyArtifactHash,
              size: lazyBytes.byteLength,
            }],
          },
          skippedInlineFiles: [{
            path: lazyRelativePath,
            root: "vault",
            sha256: lazyArtifactHash,
            size: lazyBytes.byteLength,
          }],
          skippedInlineFileCount: 1,
        },
        scratchRoot: path.join(workspaceRoot, "scratch"),
        vaultRoot: restoredVaultRoot,
      });
      await assert.rejects(readFile(path.join(restoredVaultRoot, lazyRelativePath), "utf8"), {
        code: "ENOENT",
      });

      const nextSourceVaultRoot = path.join(workspaceRoot, "next-base-vault");
      await mkdir(path.dirname(path.join(nextSourceVaultRoot, lazyRelativePath)), { recursive: true });
      const nextLazyBytes = Buffer.from("next lazy inbox artifact\n", "utf8");
      const nextLazyArtifactHash = sha256HostedBundleHex(nextLazyBytes);
      await writeFile(path.join(nextSourceVaultRoot, "note.md"), "next base note\n", "utf8");
      await writeFile(path.join(nextSourceVaultRoot, lazyRelativePath), nextLazyBytes);
      const nextBaseBundle = await snapshotHostedBundleRoots({
        externalizeFile: async (file) => {
          if (file.path !== lazyRelativePath) {
            return null;
          }

          return {
            byteSize: nextLazyBytes.byteLength,
            sha256: nextLazyArtifactHash,
          };
        },
        kind: "vault",
        roots: [
          {
            root: nextSourceVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(nextBaseBundle);
      const nextBaseHash = sha256HostedBundleHex(nextBaseBundle);
      artifactBytesByHash.set(nextBaseHash, nextBaseBundle);
      artifactBytesByHash.set(nextLazyArtifactHash, nextLazyBytes);
      const nextSnapshotRef = createBundleRef({
        hash: nextBaseHash,
        key: `cloudflare-workspace-base/${nextBaseHash}.bundle`,
        size: nextBaseBundle.byteLength,
      });
      artifactGetCalls.length = 0;

      const nextRestored = await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform,
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: nextSnapshotRef,
        }),
      });

      assert.deepEqual(artifactGetCalls, [nextBaseHash]);
      await assert.rejects(readFile(path.join(restoredVaultRoot, lazyRelativePath), "utf8"), {
        code: "ENOENT",
      });
      const nextLazyMaterialized = await nextRestored.materializeWorkspaceArtifacts([lazyRelativePath]);
      assert.deepEqual([...nextLazyMaterialized.materializedArtifactPaths], [`vault:${lazyRelativePath}`]);
      assert.deepEqual([...nextLazyMaterialized.missingArtifactPaths], []);
      assert.equal(await readFile(path.join(restoredVaultRoot, lazyRelativePath), "utf8"), "next lazy inbox artifact\n");
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("sanitizes incomplete legacy base Codex resume state during restore", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-base-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const baseAssistantRoot = resolveAssistantStatePaths(sourceBaseVaultRoot).assistantStateRoot;
      await mkdir(path.join(baseAssistantRoot, "sessions"), { recursive: true });
      const legacySession = createCodexSessionRecord({
        alias: "primary",
        resumeState: {
          providerSessionId: "thread-test",
          resumeRouteId: "route-test",
        },
        sessionId: "session",
      });
      await writeFile(
        path.join(baseAssistantRoot, "sessions", "session.json"),
        JSON.stringify({
          ...legacySession,
          providerSessionId: "legacy-thread",
        }) + "\n",
        "utf8",
      );
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);

      const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map([[baseHash, baseBundle]]),
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: createBundleRef({
            hash: baseHash,
            key: "users/bundles/member-synthetic/base-incomplete.bundle.json",
            size: baseBundle.byteLength,
          }),
        }),
      });
      const restoredSession = JSON.parse(
        await readFile(path.join(restored.assistantStateRoot, "sessions", "session.json"), "utf8"),
      ) as Record<string, unknown>;
      assert.equal(restoredSession.resumeState, null);
      assert.equal(Object.hasOwn(restoredSession, "providerSessionId"), false);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  test("sanitizes incomplete legacy hot Codex resume state and clears stale base Codex home", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-codex-hot-"));

    try {
      const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
      const sourceBaseVaultRoot = path.join(workspaceRoot, "base-vault");
      const sourceBaseOperatorHomeRoot = path.join(workspaceRoot, "base-operator-home");
      const sourceHotVaultRoot = path.join(workspaceRoot, "hot-vault");
      await mkdir(sourceBaseVaultRoot, { recursive: true });
      await mkdir(path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", "sessions"), {
        recursive: true,
      });
      await writeFile(
        path.join(sourceBaseOperatorHomeRoot, ".codex-hosted", "sessions", "old-only.json"),
        "{\"codex\":\"old\"}\n",
        "utf8",
      );
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
          {
            root: sourceBaseOperatorHomeRoot,
            rootKey: "operator-home",
          },
        ],
      });
      assert.ok(baseBundle);

      const hotAssistantRoot = resolveAssistantStatePaths(sourceHotVaultRoot).assistantStateRoot;
      await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
      await writeFile(
        path.join(hotAssistantRoot, "sessions", "session.json"),
        JSON.stringify({
          providerSessionId: "thread-test",
          resumeRouteId: "route-test",
          session: "latest",
        }) + "\n",
        "utf8",
      );
      const hotBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceHotVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(hotBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const hotHash = sha256HostedBundleHex(hotBundle);

      const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createRestorePlatform({
          artifactBytesByHash: new Map([
            [baseHash, baseBundle],
            [hotHash, hotBundle],
          ]),
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: buildHostedExecutionLayeredSnapshotRef({
            base: createBundleRef({
              hash: baseHash,
              key: "users/bundles/member-synthetic/base-incomplete-hot.bundle.json",
              size: baseBundle.byteLength,
            }),
            hot: createBundleRef({
              hash: hotHash,
              key: "users/bundles/member-synthetic/hot-incomplete.bundle.json",
              size: hotBundle.byteLength,
            }),
          }),
        }),
      });
      const restoredSession = JSON.parse(
        await readFile(path.join(restored.assistantStateRoot, "sessions", "session.json"), "utf8"),
      ) as Record<string, unknown>;
      assert.deepEqual(restoredSession, {
        session: "latest",
      });
      await assert.rejects(
        readFile(path.join(restored.operatorHomeRoot, ".codex-hosted", "sessions", "old-only.json"), "utf8"),
        { code: "ENOENT" },
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

async function createHotStateSnapshot(input: {
  sessionName: string;
  threadId: string;
  workspaceRoot: string;
}): Promise<{
  bundle: Uint8Array;
  resumeState: AssistantSessionResumeState;
}> {
  const sourceHotVaultRoot = path.join(input.workspaceRoot, `hot-vault-${input.sessionName}`);
  const sourceHotOperatorHomeRoot = path.join(input.workspaceRoot, `hot-operator-home-${input.sessionName}`);
  const hotAssistantRoot = resolveAssistantStatePaths(sourceHotVaultRoot).assistantStateRoot;
  const rolloutRelativePath =
    `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${input.threadId}.jsonl`;
  const resumeState = {
    rolloutRelativePath,
    routeFingerprint: `route-${input.sessionName}`,
    threadId: input.threadId,
  };
  await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
  await mkdir(path.join(sourceHotOperatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06"), {
    recursive: true,
  });
  await writeFile(
    path.join(hotAssistantRoot, "sessions", "session-latest.json"),
    JSON.stringify({
      resumeState,
      session: input.sessionName,
    }) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(sourceHotOperatorHomeRoot, ".codex-hosted", rolloutRelativePath),
    JSON.stringify({
      session: input.sessionName,
    }) + "\n",
    "utf8",
  );
  const snapshot = await snapshotHostedAssistantRuntimeHotState({
    operatorHomeRoot: sourceHotOperatorHomeRoot,
    vaultRoot: sourceHotVaultRoot,
  });
  return {
    bundle: snapshot.bundle,
    resumeState,
  };
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
