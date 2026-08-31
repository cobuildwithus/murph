import {
  TEST_NOW,
  TEST_USER_ID,
  createBundleRef,
  createDeferred,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  readCapturedHostedExecutionLogs,
  readCapturedRuntimePhaseLogs,
  removeTempRoot,
  requireEventIndex,
  waitForFakeTimerScheduled,
  waitUntil,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

import assert from "node:assert/strict";
import { access, appendFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  addCaptureWithLookup,
  CURRENT_VAULT_FORMAT_VERSION,
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  buildIntegrationEvidencePart,
  buildIntegrationIngestRecord,
  findCaptureByLookup,
  initializeVault,
  patchAutomation,
  readHabitatAspect,
  readJsonlRecords,
  repairVault,
  runCanonicalWrite,
  showAutomation,
  upsertAutomation,
  validateVault,
} from "@murphai/core";
import {
  openInboxRuntime,
  persistCanonicalInboxCapture,
  rebuildRuntimeFromVault,
} from "@murphai/inboxd";
import {
  appendAssistantTranscriptEntries,
  createAssistantOutboxIntent,
  ensureAutomaticMealCloseoutAutomation,
  getAssistantCronStatus,
  listAssistantTranscriptEntries,
  MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
  listAssistantOutboxIntents,
  markAssistantOutboxIntentSentById,
  readAssistantContextSnapshotState,
  refreshAssistantContextSnapshotBestEffort,
  recordHostedMailboxAssistantInputItem,
  saveAssistantOutboxIntent,
  saveAssistantSession,
  type AssistantHostedImageGenerationLauncher,
  type RunAssistantAutomationPassInput,
} from "@murphai/assistant-engine";
import {
  readAssistantInputEvent,
  shouldGroupAdjacentAssistantInputCandidates,
  updateAssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
  writeAssistantAutoReplyReplyTerminalEvidence,
} from "@murphai/assistant-engine/assistant-automation";
import {
  saveAssistantAutomationState,
  updateAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";
import {
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  createHostedPortableWorkspaceManifestFromBundle,
  listPendingAssistantRuntimeIssueRecords,
  restoreHostedBundleRoots,
  restoreHostedExecutionContext,
  snapshotHostedPortableWorkspaceDelta,
  snapshotHostedAssistantRuntimeHotState,
  snapshotHostedBundleRoots,
  writePendingAssistantRuntimeIssueRecord,
  writeHostedBundleTextFile,
} from "@murphai/runtime-state/node";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  readHostedRuntimeFailurePhaseCode,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedMailboxPayloadFetchRequest,
  type HostedMailboxPayloadFetchResponse,
  type HostedRuntimeRedactedJson,
  type HostedRuntimeLatencyTraceRequest,
  type HostedRuntimeLogRequest,
  type HostedRuntimeAssistantConfigurationControlRequest,
  type HostedRuntimeAssistantConfigurationSnapshot,
  type HostedRuntimeAssistantConfigurationToolResponse,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { describe, expect, test, vi } from "vitest";
import {
  createCoalescingRuntimeWakeSignal,
  HostedRuntimeCheckpointInterruptedByWakeError,
  HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError,
  HostedWorkspaceRunnerUserMismatchError,
  drainHostedRuntimeDeferredUsageCompletionsBestEffort,
  parseHostedAssistantWorkspaceRuntimeJobInput,
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedWorkspaceRuntimeJobOptions,
  type HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
} from "../src/hosted-runtime.ts";
import {
  collectHostedPendingAssistantInputMediaRetentionProtections,
  compactHostedPendingAssistantInputIds,
  enqueueHostedPendingAssistantInputId,
  ensureHostedPendingAssistantInputIndex,
  inspectHostedPendingAssistantInputWakeCandidate,
  readHostedPendingAssistantInputIds,
} from "../src/hosted-runtime/pending-input-index.ts";
import {
  markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort,
  restoreHostedWorkspaceRuntimeJobWorkspace,
  writeHostedWorkspaceCleanCheckpointMarkerBestEffort,
} from "../src/hosted-runtime/workspace-restore.ts";
import {
  recordHostedMaterializedArtifactPaths,
  resolveHostedMaterializedArtifactStateRelativePath,
} from "../src/hosted-runtime/materialized-artifact-state.ts";
import {
  createHostedAssistantInputSource,
  selectHostedAssistantInputIds,
} from "../src/hosted-runtime/turn-input.ts";
import {
  HostedRuntimeArtifactReadError,
  type HostedRuntimeDeviceSyncPort,
  type HostedRuntimeMailboxPort,
  type HostedRuntimePlatform,
  type RuntimeLivenessPort,
  type HostedRuntimeWorkspacePort,
  type HostedRuntimeWorkspaceSnapshotPort,
} from "../src/hosted-runtime-contracts.ts";

describe("hosted workspace runtime entrypoint", () => {test("carries inbox media retention wake through the idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const dayMs = 24 * 60 * 60 * 1000;
    const recordedAt = new Date(Date.now() - 13 * dayMs).toISOString();
    const expectedRetentionWakeAt = new Date(Date.parse(recordedAt) + 14 * dayMs).toISOString();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await compactHostedPendingAssistantInputIds({ vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_retention_wake",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "2".repeat(64),
                key: "users/bundles/member-synthetic/retention-wake.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            await initializeVault({ createdAt: TEST_NOW, vaultRoot });
            await persistCanonicalInboxCapture({
              vaultRoot,
              captureId: "cap_workspace_retention_wake",
              eventId: "evt_01JQ8PWXP5A68SQM1W0GYM41V1",
              storedAt: recordedAt,
              input: {
                source: "telegram",
                externalId: "msg-workspace-retention-wake",
                accountId: "self",
                thread: {
                  id: "thread-workspace-retention-wake",
                  isDirect: true,
                },
                actor: {
                  isSelf: false,
                },
                occurredAt: recordedAt,
                receivedAt: recordedAt,
                text: "fresh media",
                attachments: [
                  {
                    kind: "audio",
                    mime: "audio/mp4",
                    fileName: "voice.m4a",
                    data: Buffer.from("audio-bytes"),
                  },
                ],
                raw: {},
              },
            });
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      const idleCheckpoint = checkpointRequests.find((request) => request.reason === "idle_shutdown");
      assert.ok(idleCheckpoint);
      assert.equal(idleCheckpoint.nextWakeAt, null);
      assert.equal(idleCheckpoint.nextWakeReason, null);
      assert.equal(
        idleCheckpoint.inboxMediaRetentionWakeAt,
        expectedRetentionWakeAt,
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, expectedRetentionWakeAt);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("preserves committed inbox media retention wake through durable follow-up checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const dayMs = 24 * 60 * 60 * 1000;
    const recordedAt = new Date(Date.now() - 13 * dayMs).toISOString();
    const expectedRetentionWakeAt = new Date(Date.parse(recordedAt) + 14 * dayMs).toISOString();
    const durableWakeAt = new Date(Date.parse(expectedRetentionWakeAt) + dayMs).toISOString();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: durableWakeAt,
        nextWakeReason: "system-mailbox",
        requiresFollowUpCheckpoint: true,
      };
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await compactHostedPendingAssistantInputIds({ vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_retention_follow_up_wake",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "3".repeat(64),
                key: "users/bundles/member-synthetic/retention-follow-up-wake.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            await initializeVault({ createdAt: TEST_NOW, vaultRoot });
            await persistCanonicalInboxCapture({
              vaultRoot,
              captureId: "cap_workspace_retention_follow_up",
              eventId: "evt_01JQ8PWXP5A68SQM1W0GYM41V2",
              storedAt: recordedAt,
              input: {
                source: "telegram",
                externalId: "msg-workspace-retention-follow-up",
                accountId: "self",
                thread: {
                  id: "thread-workspace-retention-follow-up",
                  isDirect: true,
                },
                actor: {
                  isSelf: false,
                },
                occurredAt: recordedAt,
                receivedAt: recordedAt,
                text: "fresh media",
                attachments: [
                  {
                    kind: "audio",
                    mime: "audio/mp4",
                    fileName: "voice.m4a",
                    data: Buffer.from("audio-bytes"),
                  },
                ],
                raw: {},
              },
            });
            return {
              afterCheckpoint: async () => ({
                afterDurableCheckpoint: durableEffect,
                checkpointReason: "assistant_runtime_commit",
              }),
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.equal(durableEffect.mock.calls.length, 1);
      const durableCheckpointRequests = checkpointRequests.filter(
        (request) => request.reason !== "canonical_runtime_commit",
      );
      assert.deepEqual(
        durableCheckpointRequests.map((request) => [
          request.nextWakeAt,
          request.nextWakeReason,
          request.inboxMediaRetentionWakeAt,
        ]),
        [
          [null, null, expectedRetentionWakeAt],
          [durableWakeAt, "system-mailbox", expectedRetentionWakeAt],
        ],
      );
      assert.ok(
        events.indexOf("workspace.checkpoint") < events.indexOf("durable-effect"),
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, expectedRetentionWakeAt);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("services a due inbox media retention wake without mailbox or assistant progress", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const recordedAt = "2026-04-01T00:00:00.000Z";
    const dueWakeAt = "2026-04-15T00:00:00.000Z";

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const persisted = await persistCanonicalInboxCapture({
        vaultRoot,
        captureId: "cap_workspace_due_retention_wake",
        eventId: "evt_01JQ8PWXP5A68SQM1W0GYM41V2",
        storedAt: recordedAt,
        input: {
          source: "telegram",
          externalId: "msg-workspace-due-retention-wake",
          accountId: "self",
          thread: {
            id: "thread-workspace-due-retention-wake",
            isDirect: true,
          },
          actor: {
            isSelf: false,
          },
          occurredAt: recordedAt,
          receivedAt: recordedAt,
          text: "old media",
          attachments: [
            {
              kind: "audio",
              mime: "audio/mp4",
              fileName: "voice.m4a",
              data: Buffer.from("audio-bytes"),
            },
          ],
          raw: {},
        },
      });
      const audioPath = persisted.stored.attachments[0]?.storedPath ?? "";
      assert.ok(audioPath);
      assert.ok((await stat(path.join(vaultRoot, audioPath))).isFile());

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_due_retention_wake",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/due-retention-wake.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                inboxMediaRetentionWakeAt: dueWakeAt,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      await assert.rejects(stat(path.join(vaultRoot, audioPath)), { code: "ENOENT" });
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(checkpointRequests[0]?.inboxMediaRetentionWakeAt, null);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("a rearmed dormant snapshot retires generated image bytes and restores the tombstone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "murph-generated-image-retention-proof-"),
    );
    const sourceVaultRoot = path.join(workspaceRoot, "source-vault");
    const liveVaultRoot = path.join(workspaceRoot, "live-vault");
    const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
    const finalVaultRoot = path.join(workspaceRoot, "final-vault");
    const sourceImagePath = path.join(workspaceRoot, "generated-image.webp");
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const crashCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const recoveredCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const checkpointedWorkspaces: HostedWorkspaceState[] = [];
    const abortController = new AbortController();
    const abortReason = new Error(
      "Synthetic stop after generated-image retirement receipt checkpoint.",
    );
    const lookupKey = "generated:workspace-retention-proof";
    const recordedAt = "2026-04-01T00:00:00.000Z";

    try {
      await initializeVault({ createdAt: recordedAt, vaultRoot: sourceVaultRoot });
      await writeFile(sourceImagePath, "private-generated-image-bytes");
      const capture = await addCaptureWithLookup({
        attachments: [{ role: "media_1", sourcePath: sourceImagePath }],
        draft: {
          note: "Assistant-generated image saved for later visual reuse.",
          occurredAt: recordedAt,
          recordedAt,
          source: "derived",
          tags: ["assistant-generated-image", "generated-image"],
          title: "Generated image",
        },
        lookupAttachmentRole: "media_1",
        lookupKey,
        rawImport: {
          importKind: "capture",
          importedAt: recordedAt,
          provenance: {
            family: "capture",
            generatedImage: { schema: "murph.generated-image.v1" },
            mediaCount: 1,
          },
          source: "murph.generate_image",
        },
        vaultRoot: sourceVaultRoot,
      });
      const imageRef = capture.event.attachments?.[0]?.relativePath ?? null;
      assert.ok(imageRef);

      const baseBundle = await snapshotHostedBundleRoots({
        externalizeFile: async (file) => {
          if (!file.path.startsWith("raw/")) {
            return null;
          }
          const sha256 = sha256HostedBundleHex(file.bytes);
          artifactBytesByHash.set(sha256, file.bytes);
          return { byteSize: file.bytes.byteLength, sha256 };
        },
        kind: "vault",
        roots: [{ root: sourceVaultRoot, rootKey: "vault" }],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      artifactBytesByHash.set(baseHash, baseBundle);
      const baseSnapshotRef = createBundleRef({
        hash: baseHash,
        key: `synthetic/generated-image-retention/${baseHash}.bundle`,
        size: baseBundle.byteLength,
      });

      await expect(runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_generated_image_retention",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            processingMode: "inbox_media_retention",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error(
              "Interrupted generated-image retirement must not publish a snapshot.",
            );
          },
          async importItem() {
            throw new Error(
              "Generated-image retention-only processing must not import mailbox items.",
            );
          },
          platform: createPlatform({
            artifactBytesByHash,
            mailboxPort: createMailboxPort({ events: [], items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: crashCheckpointRequests,
              events: [],
              checkpointWorkspace(request) {
                const workspace = createWorkspaceState({
                  inboxMediaRetentionWakeAt:
                    request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
                checkpointedWorkspaces.push(workspace);
                if (
                  request.reason === "canonical_runtime_commit"
                  && !abortController.signal.aborted
                ) {
                  abortController.abort(abortReason);
                }
                return workspace;
              },
              workspace: createWorkspaceState({
                inboxMediaRetentionWakeAt: "2026-04-15T00:00:00.000Z",
                snapshotRef: baseSnapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error(
              "Generated-image retention-only processing must not enter the assistant phase.",
            );
          },
          signal: abortController.signal,
          vaultRoot: liveVaultRoot,
        },
      )).rejects.toBe(abortReason);

      assert.deepEqual(
        crashCheckpointRequests.map((request) => request.reason),
        ["canonical_runtime_commit"],
      );
      const workspaceAfterCrash = checkpointedWorkspaces[0];
      assert.ok(workspaceAfterCrash);
      assert.deepEqual(workspaceAfterCrash.snapshotRef, baseSnapshotRef);
      assert.equal(
        workspaceAfterCrash.inboxMediaRetentionWakeAt,
        "2026-04-15T00:00:00.000Z",
      );
      assert.equal(
        typeof workspaceAfterCrash.redactedStatus
          ?.hostedCanonicalWriteReceiptLogSha256,
        "string",
      );

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_generated_image_retention_recovery",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "8",
            processingMode: "inbox_media_retention",
            userId: TEST_USER_ID,
            workspaceVersion: workspaceAfterCrash.version,
          },
        }),
        {
          async createCheckpointSnapshot() {
            await expect(readFile(path.join(restoredVaultRoot, imageRef), "utf8"))
              .resolves.toContain("generated_image_retention");
            const bundle = await snapshotHostedBundleRoots({
              externalizeFile: async (file) => {
                if (!file.path.startsWith("raw/")) {
                  return null;
                }
                const sha256 = sha256HostedBundleHex(file.bytes);
                artifactBytesByHash.set(sha256, file.bytes);
                return { byteSize: file.bytes.byteLength, sha256 };
              },
              kind: "vault",
              roots: [{
                root: restoredVaultRoot,
                rootKey: "vault",
                shouldIncludeRelativePath: (relativePath) =>
                  relativePath !== resolveHostedMaterializedArtifactStateRelativePath(),
              }],
            });
            assert.ok(bundle);
            const hash = sha256HostedBundleHex(bundle);
            artifactBytesByHash.set(hash, bundle);
            return {
              snapshotRef: createBundleRef({
                hash,
                key: `synthetic/generated-image-retention/${hash}.bundle`,
                size: bundle.byteLength,
              }),
            };
          },
          async importItem() {
            throw new Error(
              "Generated-image retention recovery must not import mailbox items.",
            );
          },
          platform: createPlatform({
            artifactBytesByHash,
            mailboxPort: createMailboxPort({ events: [], items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: recoveredCheckpointRequests,
              events: [],
              workspace: workspaceAfterCrash,
            }),
          }),
          async runAssistantPhase() {
            throw new Error(
              "Generated-image retention recovery must not enter the assistant phase.",
            );
          },
          vaultRoot: restoredVaultRoot,
        },
      );

      assert.equal(result.status, "idle");
      assert.deepEqual(
        recoveredCheckpointRequests.map((request) => request.reason),
        ["idle_shutdown"],
      );
      const retainedSnapshotRef =
        recoveredCheckpointRequests.at(-1)?.snapshotRef ?? null;
      assert.ok(retainedSnapshotRef);
      const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createPlatform({
          artifactBytesByHash,
          mailboxPort: createMailboxPort({ events: [], items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events: [],
            workspace: createWorkspaceState({
              snapshotRef: retainedSnapshotRef,
              version: "1",
            }),
          }),
        }),
        vaultRoot: finalVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: retainedSnapshotRef,
          version: "1",
        }),
      });
      await restored.materializeWorkspaceArtifacts([
        "derived/captures/generated-image-lookups.json",
        imageRef,
        ...(capture.manifestPath ? [capture.manifestPath] : []),
      ]);

      const tombstone = JSON.parse(
        await readFile(path.join(finalVaultRoot, imageRef), "utf8"),
      );
      expect(tombstone).toMatchObject({
        purgedAt: "2026-04-15T00:00:00.000Z",
        reason: "generated_image_retention",
      });
      await expect(findCaptureByLookup({
        lookupKey,
        vaultRoot: finalVaultRoot,
      })).resolves.toMatchObject({
        eventId: capture.eventId,
        status: "deleted",
      });
      const ledger = await readJsonlRecords({
        relativePath: capture.ledgerFile,
        vaultRoot: finalVaultRoot,
      });
      expect(ledger).toHaveLength(2);
      expect(ledger[1]).toMatchObject({
        id: capture.eventId,
        lifecycle: { revision: 2, state: "deleted" },
      });
      // Bundles do not encode empty directories; restore the ordinary vault
      // scaffold before asking the full validator to inspect the checkpoint.
      await repairVault({ vaultRoot: finalVaultRoot });
      expect(await validateVault({ vaultRoot: finalVaultRoot })).toMatchObject({
        issues: [],
        valid: true,
      });
    } finally {
      vi.useRealTimers();
      await removeTempRoot(workspaceRoot);
    }
  });

  test("a rearmed dormant snapshot retires receipt-backed content while preserving legacy transcript history", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "murph-workspace-retention-proof-"),
    );
    const sourceVaultRoot = path.join(workspaceRoot, "source-vault");
    const liveVaultRoot = path.join(workspaceRoot, "live-vault");
    const restoredVaultRoot = path.join(workspaceRoot, "restored-vault");
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const contentPhrase = "private apricot retention proof phrase";
    const captureId = "cap_workspace_message_retention_proof";
    const inputRecordedAt = "2026-04-01T00:00:00.000Z";
    const dueWakeAt = "2026-04-15T00:00:00.000Z";
    const sessionId = "session_workspace_message_retention_proof";
    const legacyEntries = [
      {
        createdAt: "2026-07-24T00:00:00.000Z",
        kind: "user",
        schema: "murph.assistant-transcript-entry.v1",
        text: "recent legacy member context survives phase one",
      },
      {
        createdAt: "2026-07-24T00:01:00.000Z",
        kind: "assistant",
        schema: "murph.assistant-transcript-entry.v1",
        text: "paired assistant context survives phase one",
      },
    ] as const;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceVaultRoot });
      await persistCanonicalInboxCapture({
        vaultRoot: sourceVaultRoot,
        captureId,
        eventId: "evt_01JQ8PWXP5A68SQM1W0GYM41R7",
        storedAt: inputRecordedAt,
        input: {
          source: "telegram",
          externalId: "msg-workspace-message-retention-proof",
          accountId: "self",
          thread: {
            id: "thread-workspace-message-retention-proof",
            isDirect: true,
          },
          actor: {
            isSelf: false,
          },
          occurredAt: inputRecordedAt,
          receivedAt: inputRecordedAt,
          text: contentPhrase,
          attachments: [],
          raw: {
            body: contentPhrase,
          },
        },
      });
      const sourceRuntime = await openInboxRuntime({
        vaultRoot: sourceVaultRoot,
      });
      try {
        await rebuildRuntimeFromVault({
          enqueueParserJobs: false,
          runtime: sourceRuntime,
          vaultRoot: sourceVaultRoot,
        });
        assert.equal(
          sourceRuntime.searchCaptures({ text: "apricot" }).length,
          1,
        );
      } finally {
        sourceRuntime.close();
      }
      const parserDirectory = path.join(
        sourceVaultRoot,
        "derived",
        "inbox",
        captureId,
      );
      await mkdir(parserDirectory, { recursive: true });
      await writeFile(
        path.join(parserDirectory, "attachment-text.json"),
        `${JSON.stringify({ text: contentPhrase })}\n`,
        "utf8",
      );
      await saveAssistantAutomationState(sourceVaultRoot, {
        autoReply: [{
          channel: "telegram",
          eligibleAfter: null,
          enabledAt: inputRecordedAt,
        }],
        updatedAt: inputRecordedAt,
        version: 1,
      });
      const pendingInput = await upsertAssistantInputEvent({
        event: {
          content: {
            text: contentPhrase,
            transcriptText: contentPhrase,
            userMessageContent: [{
              text: contentPhrase,
              type: "text" as const,
            }],
          },
          conversation: {
            accountId: "acct_1",
            actorId: "actor_1",
            actorIsSelf: false,
            source: "telegram",
            threadId: "thread-workspace-message-retention-proof",
            threadIsDirect: true,
          },
          occurredAt: inputRecordedAt,
          receivedAt: inputRecordedAt,
          replyTarget: {
            channel: "telegram",
            messageId: "msg-workspace-message-retention-proof",
            threadId: "thread-workspace-message-retention-proof",
          },
          sourceRef: {
            dedupeKey: "dedupe_workspace_message_retention_proof",
            eventId: "evt_workspace_message_retention_proof",
            itemId: "item_workspace_message_retention_proof",
            kind: "hosted-mailbox" as const,
            lane: "conversation" as const,
            laneSeq: "10",
            payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
            payloadSource: "inline" as const,
            source: "hosted-mailbox" as const,
            wakeSchema: "murph.hosted-execution-wake.v1",
          },
        },
        vault: sourceVaultRoot,
      });
      await enqueueHostedPendingAssistantInputId({
        inputId: pendingInput.inputId,
        vaultRoot: sourceVaultRoot,
      });
      await appendAssistantTranscriptEntries(sourceVaultRoot, sessionId, [{
        contentReceivedAt: inputRecordedAt,
        createdAt: inputRecordedAt,
        kind: "user",
        text: contentPhrase,
      }]);
      await appendFile(
        path.join(
          resolveAssistantStatePaths(sourceVaultRoot).assistantStateRoot,
          "transcripts",
          `${sessionId}.jsonl`,
        ),
        `${legacyEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        "utf8",
      );

      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [{ root: sourceVaultRoot, rootKey: "vault" }],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      artifactBytesByHash.set(baseHash, baseBundle);
      const baseSnapshotRef = createBundleRef({
        hash: baseHash,
        key: `synthetic/message-retention/${baseHash}.bundle`,
        size: baseBundle.byteLength,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_message_retention_proof",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            processingMode: "inbox_media_retention",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            const bundle = await snapshotHostedBundleRoots({
              kind: "vault",
              roots: [{ root: liveVaultRoot, rootKey: "vault" }],
            });
            assert.ok(bundle);
            const hash = sha256HostedBundleHex(bundle);
            artifactBytesByHash.set(hash, bundle);
            return {
              snapshotRef: createBundleRef({
                hash,
                key: `synthetic/message-retention/${hash}.bundle`,
                size: bundle.byteLength,
              }),
            };
          },
          async importItem() {
            throw new Error(
              "Retention-only processing must not import mailbox items.",
            );
          },
          platform: createPlatform({
            artifactBytesByHash,
            mailboxPort: createMailboxPort({ events: [], items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events: [],
              workspace: createWorkspaceState({
                inboxMediaRetentionWakeAt: dueWakeAt,
                snapshotRef: baseSnapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error(
              "Retention-only processing must not enter the assistant phase.",
            );
          },
          vaultRoot: liveVaultRoot,
        },
      );

      assert.equal(result.status, "idle");
      const retainedSnapshotRef = checkpointRequests.at(-1)?.snapshotRef ?? null;
      assert.ok(retainedSnapshotRef);
      await restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: createPlatform({
          artifactBytesByHash,
          mailboxPort: createMailboxPort({ events: [], items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events: [],
            workspace: createWorkspaceState({
              snapshotRef: retainedSnapshotRef,
              version: "1",
            }),
          }),
        }),
        vaultRoot: restoredVaultRoot,
        workspace: createWorkspaceState({
          snapshotRef: retainedSnapshotRef,
          version: "1",
        }),
      });

      const restoredRuntime = await openInboxRuntime({
        vaultRoot: restoredVaultRoot,
      });
      try {
        assert.equal(
          restoredRuntime.searchCaptures({ text: "apricot" }).length,
          0,
        );
        const capture = restoredRuntime.getCapture(captureId);
        assert.ok(capture);
        assert.equal(capture.text, null);
        assert.deepEqual(capture.raw, {});
      } finally {
        restoredRuntime.close();
      }
      await assert.rejects(
        access(path.join(
          restoredVaultRoot,
          "derived",
          "inbox",
          captureId,
          "attachment-text.json",
        )),
        { code: "ENOENT" },
      );
      const retiredInput = await readAssistantInputEvent({
        inputId: pendingInput.inputId,
        vault: restoredVaultRoot,
      });
      assert.ok(retiredInput?.contentRetiredAt);
      assert.equal(JSON.stringify(retiredInput).includes(contentPhrase), false);
      const transcript = await listAssistantTranscriptEntries(
        restoredVaultRoot,
        sessionId,
      );
      assert.equal(transcript[0]?.text, "");
      assert.ok(transcript[0]?.textRetiredAt);
      expect(transcript.slice(1)).toEqual(legacyEntries);
      expect(transcript[1]).not.toHaveProperty("contentReceivedAt");
      expect(transcript[1]).not.toHaveProperty("textRetiredAt");
      const laterTurnSource = createHostedAssistantInputSource({
        initialPendingInputIds: [],
        pendingInputRefreshMode: "none",
        selectedInputIds: [pendingInput.inputId],
        vaultRoot: restoredVaultRoot,
      });
      const laterTurn = await laterTurnSource.listInputCandidates({
        sourceId: "telegram",
      });
      assert.equal(JSON.stringify(laterTurn).includes(contentPhrase), false);
    } finally {
      await removeTempRoot(workspaceRoot);
    }
  });

  test("retention-only processing preserves assistant wake without entering assistant phase", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const recordedAt = "2026-04-01T00:00:00.000Z";
    const dueWakeAt = "2026-04-15T00:00:00.000Z";

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const persisted = await persistCanonicalInboxCapture({
        vaultRoot,
        captureId: "cap_workspace_retention_only",
        eventId: "evt_01JQ8PWXP5A68SQM1W0GYM41V9",
        storedAt: recordedAt,
        input: {
          source: "telegram",
          externalId: "msg-workspace-retention-only",
          accountId: "self",
          thread: {
            id: "thread-workspace-retention-only",
            isDirect: true,
          },
          actor: {
            isSelf: false,
          },
          occurredAt: recordedAt,
          receivedAt: recordedAt,
          text: "old media",
          attachments: [
            {
              kind: "audio",
              mime: "audio/mp4",
              fileName: "voice.m4a",
              data: Buffer.from("audio-bytes"),
            },
          ],
          raw: {},
        },
      });
      const audioPath = persisted.stored.attachments[0]?.storedPath ?? "";
      assert.ok(audioPath);
      assert.ok((await stat(path.join(vaultRoot, audioPath))).isFile());
      await saveAssistantAutomationState(vaultRoot, {
        autoReply: [{
          channel: "telegram",
          eligibleAfter: null,
          enabledAt: recordedAt,
        }],
        updatedAt: recordedAt,
        version: 1,
      });
      const pendingInput = await upsertAssistantInputEvent({
        event: {
          content: {
            text: "pending old media",
            transcriptText: "pending old media",
            userMessageContent: [{
              text: "pending old media",
              type: "text" as const,
            }],
          },
          conversation: {
            accountId: "acct_1",
            actorId: "actor_1",
            actorIsSelf: false,
            source: "telegram",
            threadId: "thread-workspace-retention-only",
            threadIsDirect: true,
          },
          occurredAt: recordedAt,
          receivedAt: recordedAt,
          replyTarget: {
            channel: "telegram",
            messageId: "msg-workspace-retention-only",
            threadId: "thread-workspace-retention-only",
          },
          sourceRef: {
            dedupeKey: "dedupe_workspace_retention_only",
            eventId: "evt_workspace_retention_only",
            itemId: "item_workspace_retention_only",
            kind: "hosted-mailbox" as const,
            lane: "conversation" as const,
            laneSeq: "10",
            payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
            payloadSource: "inline" as const,
            source: "hosted-mailbox" as const,
            wakeSchema: "murph.hosted-execution-wake.v1",
          },
        },
        vault: vaultRoot,
      });
      await updateAssistantInputProjection({
        inputId: pendingInput.inputId,
        projection: {
          captureId: "cap_workspace_retention_only",
          status: "succeeded",
        },
        vault: vaultRoot,
      });
      await updateAssistantInputAttachmentEvidence({
        attachmentEvidence: {
          attachments: [],
          optionalInboxCaptureId: "cap_workspace_retention_only",
          reasonCode: "inbox_projection_unavailable",
          source: "hosted-inbox-projection",
          status: "failed",
          updatedAt: recordedAt,
        },
        inputId: pendingInput.inputId,
        vault: vaultRoot,
      });
      await enqueueHostedPendingAssistantInputId({
        inputId: pendingInput.inputId,
        vaultRoot,
      });
      // Pin the protection-collection clock inside the 14-day window from
      // recordedAt — the round-36 age cap drops protection for inputs older
      // than the retention window, but the test's purpose is to demonstrate
      // the protection IS collected when the input is fresh; the broader
      // wipe-vs-retention interaction is what the surrounding flow exercises.
      assert.deepEqual(
        await collectHostedPendingAssistantInputMediaRetentionProtections({
          now: "2026-04-10T00:00:00.000Z",
          vaultRoot,
        }),
        {
          protectedAttachmentIds: [],
          protectedCaptureIds: ["cap_workspace_retention_only"],
          protectedStoredPaths: [],
        },
      );

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_retention_only",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            processingMode: "inbox_media_retention",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "9".repeat(64),
                key: "users/bundles/member-synthetic/retention-only.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                inboxMediaRetentionWakeAt: dueWakeAt,
                nextWakeAt: dueWakeAt,
                nextWakeReason: "assistant_due",
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Retention-only processing must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.nextWakeAt, dueWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant_due");
      assert.equal(checkpointRequests[0]?.inboxMediaRetentionWakeAt, null);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueWakeAt);
      assert.equal(result.nextWakeReason, "assistant_due");
      // This vault has no snapshot ref, so the runtime restore takes the
      // null-bootstrap branch and wipes the vault before retention runs. The
      // observable absence of the audio file here proves the bootstrap flow
      // runs as expected; the production-faithful pending-input protection
      // contract (audio survives a 14-day-old retention sweep) is verified by
      // `runHostedPendingInputProtectedIdleMaintenance forwards collected
      // pending-input protections to runHostedIdleCheckpointMaintenance`
      // against a seeded vault that no longer needs restore.
      await assert.rejects(
        stat(path.join(vaultRoot, audioPath)),
        (error: unknown) =>
          error instanceof Error
          && (error as NodeJS.ErrnoException).code === "ENOENT",
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("retention-only processing yields before checkpointing when a foreground wake interrupts maintenance", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const createCheckpointSnapshot = vi.fn(async () => {
      events.push("snapshot:idle_shutdown");
      return {
        snapshotRef: createBundleRef({
          hash: "7".repeat(64),
          key: "users/bundles/member-synthetic/retention-only-interrupted.bundle.json",
          size: 512,
        }),
      };
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      runtimeWakeSignal.notify(new Date("2026-04-26T00:00:01.000Z").getTime());

      await assert.rejects(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_retention_only_interrupted",
              idleCheckpointDelayMs: 1,
              leaseGeneration: "7",
              processingMode: "inbox_media_retention",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            createCheckpointSnapshot,
            async importItem() {
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({
                  inboxMediaRetentionWakeAt: "2026-04-15T00:00:00.000Z",
                  version: "0",
                }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase() {
              throw new Error("Retention-only processing must not enter assistant phase.");
            },
            vaultRoot,
          },
        ),
        HostedRuntimeCheckpointInterruptedByWakeError,
      );
      expect(createCheckpointSnapshot).not.toHaveBeenCalled();
      assert.deepEqual(checkpointRequests, []);
      assert.equal(events.includes("workspace.checkpoint"), false);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("retention-only shutdown ignores pending runtime wake and preserves due retention wake", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    const dueWakeAt = "2026-04-15T00:00:00.000Z";

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      shutdownController.abort(new Error("Synthetic container SIGTERM."));
      runtimeWakeSignal.notify(new Date("2026-04-15T00:00:01.000Z").getTime());

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_retention_only_shutdown_pending_wake",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            processingMode: "inbox_media_retention",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            events.push("snapshot:idle_shutdown");
            return {
              snapshotRef: createBundleRef({
                hash: "6".repeat(64),
                key: "users/bundles/member-synthetic/retention-only-shutdown-pending-wake.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                inboxMediaRetentionWakeAt: dueWakeAt,
                version: "0",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            throw new Error("Retention-only processing must not enter assistant phase.");
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.inboxMediaRetentionWakeAt, dueWakeAt);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueWakeAt);
      assert.equal(result.nextWakeReason, "inbox_media_retention");
      assert.equal(result.immediateRecheckRequested, undefined);
      assert.equal(events.includes("snapshot:idle_shutdown"), true);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpoints local mutations from deferred durable checkpoint effects before returning", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 180_000;
    const durableWakeAt = new Date(
      Date.parse(TEST_NOW) + idleCheckpointDelayMs + 120_000,
    ).toISOString();
    const assistantObserved = createDeferred<void>();
    let firstCheckpointStartedAtMs: number | null = null;
    let secondCheckpointStartedAtMs: number | null = null;
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: durableWakeAt,
        nextWakeReason: "assistant",
        requiresFollowUpCheckpoint: true,
      };
    });

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_durable_effect_follow_up_checkpoint",
              idleCheckpointDelayMs,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              if (firstCheckpointStartedAtMs === null) {
                firstCheckpointStartedAtMs = Date.now();
              } else {
                secondCheckpointStartedAtMs ??= Date.now();
              }
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "8".repeat(64),
                  key: "users/bundles/member-synthetic/durable-effect-follow-up.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem() {
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [createMailboxItem({ laneSeq: "1" })],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            async runAssistantPhase() {
              assistantObserved.resolve();
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: durableEffect,
                  checkpointReason: "system_mailbox_receipt",
                }),
                checkpointReason: "system_mailbox_receipt",
                progressed: true,
              };
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      assert.equal(checkpointRequests.length, 0);
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - 1_000);
      assert.equal(checkpointRequests.length, 0);
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await resultPromise;

      const checkpointEventIndexes = events
        .map((event, index) => event === "workspace.checkpoint" ? index : -1)
        .filter((index) => index >= 0);
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
        "idle_shutdown",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0", "1"],
      );
      assert.equal(firstCheckpointStartedAtMs, Date.parse(TEST_NOW) + idleCheckpointDelayMs);
      assert.equal(secondCheckpointStartedAtMs, Date.parse(TEST_NOW) + idleCheckpointDelayMs);
      assert.equal(checkpointRequests[1]?.nextWakeAt, durableWakeAt);
      assert.equal(checkpointRequests[1]?.nextWakeReason, "assistant");
      assert.ok(checkpointEventIndexes[0] < events.indexOf("durable-effect"));
      assert.ok(events.indexOf("durable-effect") < checkpointEventIndexes[1]);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, durableWakeAt);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("waits for deferred import enrichment before idle checkpointing dirty runtime state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const enrichmentGate = createDeferred<void>();
    let resultPromise: Promise<Awaited<ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess>>>
      | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_import_enrichment_checkpoint_barrier",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/import-enrichment-barrier.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            events.push("import");
            return {
              afterCheckpoint: async () => {
                events.push("mailbox:afterCheckpoint:start");
                await enrichmentGate.promise;
                events.push("mailbox:afterCheckpoint:done");
                return {
                  attachmentEvidenceUpdated: true,
                  kind: "inbox_projection",
                  projectionUpdated: true,
                  reasonCode: null,
                  status: "succeeded",
                };
              },
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            events.push("assistant");
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      await waitUntil(() => {
        assert.equal(events.includes("mailbox:afterCheckpoint:start"), true);
      });
      assert.equal(events.includes("snapshot:idle_shutdown"), false);
      assert.equal(events.includes("workspace.checkpoint"), false);
      assert.equal(checkpointRequests.length, 0);

      enrichmentGate.resolve();
      const result = await resultPromise;

      assert.equal(result.status, "idle");
      assert.ok(
        requireEventIndex(events, "mailbox:afterCheckpoint:done")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
      );
      assert.ok(
        requireEventIndex(events, "mailbox:afterCheckpoint:done")
          < requireEventIndex(events, "workspace.checkpoint"),
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
    } finally {
      enrichmentGate.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpoints a deferred durable checkpoint effect wake after draining a checkpoint wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const durableWakeAt = "2026-04-27T00:04:00.000Z";
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      runtimeWakeSignal.notify();
      return {
        nextWakeAt: durableWakeAt,
        nextWakeReason: "device-sync.reconcile",
      };
    });
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_durable_effect_checkpoint_wake_drain",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "7".repeat(64),
                key: "users/bundles/member-synthetic/durable-effect-checkpoint-wake-drain.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: durableEffect,
                  checkpointReason: "assistant_runtime_commit",
                }),
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      assert.equal(durableEffect.mock.calls.length, 1);
      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
      ]);
      assert.ok(
        events.indexOf("durable-effect") < events.lastIndexOf("workspace.checkpoint"),
      );
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", null, null],
          ["idle_shutdown", durableWakeAt, "device-sync.reconcile"],
        ],
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, durableWakeAt);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("continues later deferred durable checkpoint effects after one fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingDurableEffect = vi.fn(async () => {
      events.push("durable-effect:failing");
      throw new Error("synthetic durable effect failure");
    });
    const followUpDurableEffect = vi.fn(async () => {
      events.push("durable-effect:follow-up");
      return {
        nextWakeAt: "2026-04-27T00:03:00.000Z",
        nextWakeReason: "device-sync.reconcile",
      };
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_durable_effect_failure_isolated",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "1".repeat(64),
                key: "users/bundles/member-synthetic/durable-effect-failure-isolated.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              afterCheckpoint: async () => ({
                afterDurableCheckpoint: [
                  failingDurableEffect,
                  followUpDurableEffect,
                ],
                checkpointReason: "assistant_runtime_commit",
              }),
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.equal(failingDurableEffect.mock.calls.length, 1);
      assert.equal(followUpDurableEffect.mock.calls.length, 1);
      assert.deepEqual(events.slice(events.indexOf("workspace.checkpoint") + 1), [
        "durable-effect:failing",
        "durable-effect:follow-up",
        "snapshot:idle_shutdown",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", null, null],
          ["idle_shutdown", "2026-04-27T00:03:00.000Z", "device-sync.reconcile"],
        ],
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, "2026-04-27T00:03:00.000Z");
    } finally {
      consoleError.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not run deferred durable checkpoint effects when idle checkpoint fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await expect(runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_durable_effect_failure",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/durable-effect-failure.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "0" }),
                };
              },
              async checkpoint() {
                events.push("workspace.checkpoint");
                throw new Error("checkpoint failed before durable effects");
              },
            },
          }),
          async runAssistantPhase() {
            return {
              afterCheckpoint: async () => ({
                afterDurableCheckpoint: durableEffect,
                checkpointReason: "assistant_runtime_commit",
              }),
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      )).rejects.toThrow("checkpoint failed before durable effects");

      assert.equal(durableEffect.mock.calls.length, 0);
      assert.deepEqual(events.includes("durable-effect"), false);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fails closed when invocation workspace state has a stale version", async () => {
    const events: string[] = [];

    await expect(
      runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_invocation_workspace_stale",
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspace: createWorkspaceState({ version: "6" }),
            workspaceVersion: "5",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Snapshot should not run after stale invocation workspace.");
          },
          async importItem() {
            throw new Error("Import should not run after stale invocation workspace.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events,
              workspace: null,
            }),
          }),
          vaultRoot: "synthetic-vault-root",
        },
      ),
    ).rejects.toBeInstanceOf(HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError);

    assert.deepEqual(events, []);
  });

  test("fails closed when invocation workspace state belongs to another user", async () => {
    const events: string[] = [];
    const artifactGetCalls: string[] = [];

    await expect(
      runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_invocation_workspace_other_user",
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspace: createWorkspaceState({
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/other-user.bundle.json",
                size: 512,
              }),
              userId: "member_synthetic_workspace_other",
              version: "0",
            }),
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Snapshot should not run after invocation workspace user mismatch.");
          },
          async importItem() {
            throw new Error("Import should not run after invocation workspace user mismatch.");
          },
          platform: createPlatform({
            artifactGetCalls,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events,
              workspace: null,
            }),
          }),
          vaultRoot: "synthetic-vault-root",
        },
      ),
    ).rejects.toBeInstanceOf(HostedWorkspaceRunnerUserMismatchError);

    assert.deepEqual(events, []);
    assert.deepEqual(artifactGetCalls, []);
  });

  test("emits metadata-only phase boundary logs for checkpoint and runtime shutdown", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      async ackDirtyStateProcessed() {
        throw new Error("Device sync ack should not run.");
      },
      async applyUpdates() {
        throw new Error("Device sync apply should not run.");
      },
      async createConnectLink() {
        throw new Error("Device sync connect link should not run.");
      },
      async fetchDirtyStates() {
        throw new Error("Device sync dirty state should not run.");
      },
      async fetchSnapshot() {
        throw new Error("Device sync snapshot should not run.");
      },
    };

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_phase_checkpoint",
          idleCheckpointDelayMs: 1,
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      }), {
        async createCheckpointSnapshot(snapshotInput) {
          assert.equal(snapshotInput.idleCheckpointTrigger, "idle_window");
          assert.equal(snapshotInput.runtimeWakePendingAtCheckpoint, false);
          return {
            snapshotRef: createBundleRef({
              hash: "d".repeat(64),
              key: "users/bundles/member-synthetic/phase-checkpoint.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem() {
          return { status: "imported" };
        },
        platform: createPlatform({
          deviceSyncPort,
          mailboxPort: createMailboxPort({
            events: [],
            items: [createMailboxItem({ laneSeq: "1" })],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events: [],
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        vaultRoot,
      });

      const phaseLogs = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_phase_checkpoint",
        spy: consoleInfo,
      });
      expect(phaseLogs.map((entry) => [
        entry.details.runtimePhase,
        entry.details.runtimePhaseStatus,
      ])).toEqual(expect.arrayContaining([
        ["workspace.checkpoint.idle_shutdown", "start"],
        ["workspace.checkpoint.idle_shutdown", "done"],
        ["runtime.return", "done"],
      ]));
      expect(
        phaseLogs.find((entry) =>
          entry.details.runtimePhase === "workspace.checkpoint.idle_shutdown"
          && entry.details.runtimePhaseStatus === "start"
        )?.details,
      ).toEqual(expect.objectContaining({
        idleCheckpointTrigger: "idle_window",
        runtimeWakePendingAtCheckpoint: false,
        shutdownSignalAbortedAtCheckpoint: false,
      }));
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(checkpointRequests[0]?.runtimeWakePendingAtCheckpoint, false);
      assert.equal(phaseLogs.every((entry) => entry.userId === null), true);
      assert.equal(
        readCapturedHostedExecutionLogs(consoleInfo)
          .some((entry) => JSON.stringify(entry).includes(TEST_USER_ID)),
        false,
      );
      assert.equal(checkpointRequests.length, 1);
    } finally {
      if (previousStdIoLogSetting === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
      }
      consoleInfo.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  });
