import {
  TEST_NOW,
  createBundleRef,
  createCanonicalReceiptLogArtifacts,
  createDeferred,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createSaturatedCanonicalReceiptLogArtifacts,
  createVaultSnapshotBundle,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceSnapshotV2Ref,
  createWorkspaceState,
  isPlainJsonObject,
  listHostedCanonicalWriteReceiptLogArtifacts,
  mocks,
  parseJsonArtifact,
  readCheckpointConversationWatermark,
  removeTempRoot,
  requireEventIndex,
  sha256Hex,
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
import {
  buildHostedExecutionLayeredSnapshotRef,
  buildHostedExecutionWorkingSnapshotRef,
  isHostedWorkspaceSnapshotV2Ref,
  readHostedExecutionSnapshotBaseRef,
} from "@murphai/hosted-execution/parsers";
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
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BACKGROUND_YIELD_THRESHOLD,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES,
  hostedCanonicalWriteReceiptRecoveryStatusFields,
  readHostedCanonicalWriteReceiptRecoveryWake,
} from "../src/hosted-runtime/canonical-write-receipt-log.ts";
import {
  createEmptyHostedMailboxImportState,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
  HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
  readHostedMailboxImportState,
  writeHostedMailboxImportState,
  type HostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import {
  HostedRuntimeArtifactReadError,
  type HostedRuntimeDeviceSyncPort,
  type HostedRuntimeMailboxPort,
  type HostedRuntimePlatform,
  type RuntimeLivenessPort,
  type HostedRuntimeWorkspacePort,
  type HostedRuntimeWorkspaceSnapshotPort,
} from "../src/hosted-runtime-contracts.ts";

describe("hosted workspace runtime entrypoint", () => {test("runs assistant outbox phase after restored mailbox checkpoint with restored vault root", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
          return {
            snapshotRef: createBundleRef({
              hash: snapshotInput.reason === "import" ? "1".repeat(64) : "2".repeat(64),
              key: `users/bundles/member-synthetic/${snapshotInput.reason}.bundle.json`,
              size: 512,
            }),
          };
        },
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({
            events,
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_assistant_phase",
                laneSeq: "1",
              }),
            ],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: null,
          }),
        }),
        async runAssistantPhase(input) {
          assert.equal(input.restored.vaultRoot, path.resolve(vaultRoot));
          assert.equal(
            (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
            "1",
          );
          events.push("assistant");
          return {
            checkpointReason: "outbox_sending",
            progressed: true,
            redactedStatus: {
              hostedAssistantProgressed: true,
            },
          };
        },
        vaultRoot,
      });

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:1",
        "assistant",
        "snapshot:idle_shutdown:1",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("defers alarm mailbox import when an active alarm absorbs pending conversation work", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: snapshotInput.reason === "import" ? "3".repeat(64) : "4".repeat(64),
                key: `users/bundles/member-synthetic/${snapshotInput.reason}.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`import:${item.item.laneSeq}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_alarm_absorbed_pending_work",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: TEST_NOW,
                nextWakeReason: "assistant",
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            assert.equal(
              (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
              "1",
            );
            events.push("assistant");
            return {
              checkpointReason: "outbox_sending",
              progressed: true,
              redactedStatus: {
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:1",
        "assistant",
        "snapshot:idle_shutdown:1",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("retains foreground reply authority when canonical receipt recovery fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const baseSnapshotRef = createWorkspaceSnapshotV2Ref(
      "snapshot-receipt-recovery-failed",
    );
    const firstPayloadBytes = Buffer.from("partial receipt write\n", "utf8");
    const firstPayloadHash = sha256Hex(firstPayloadBytes);
    const missingPayloadHash = "e".repeat(64);
    const receiptBytes = Buffer.from(`${JSON.stringify({
      actions: [
        {
          byteLength: firstPayloadBytes.byteLength,
          contentRef: {
            byteSize: firstPayloadBytes.byteLength,
            sha256: firstPayloadHash,
          },
          effect: "create",
          kind: "text_upsert",
          sha256: firstPayloadHash,
          targetRelativePath: "journal/partial-receipt-write.md",
        },
        {
          byteLength: 1,
          contentRef: {
            byteSize: 1,
            sha256: missingPayloadHash,
          },
          effect: "create",
          kind: "text_upsert",
          sha256: missingPayloadHash,
          targetRelativePath: "journal/missing-receipt-write.md",
        },
      ],
      committedAt: TEST_NOW,
      createdAt: TEST_NOW,
      occurredAt: TEST_NOW,
      operationId: "op_synthetic_partial_receipt_recovery",
      operationType: "hosted_canonical_write_test",
      schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
      summary: "Reject a partial multi-action receipt recovery.",
      updatedAt: TEST_NOW,
    }, null, 2)}\n`, "utf8");
    const receiptHash = sha256Hex(receiptBytes);
    const receiptLogBytes = Buffer.from(`${JSON.stringify({
      entries: [
        {
          byteSize: receiptBytes.byteLength,
          sha256: receiptHash,
        },
      ],
      schema: "murph.hosted-canonical-write-receipt-log.v1",
    }, null, 2)}\n`, "utf8");
    const receiptLogHash = sha256Hex(receiptLogBytes);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const logWriteRelease = createDeferred<void>();
    let foregroundCanonicalWriteCompleted = false;
    let logWriteSettled = false;
    let restoreCallCount = 0;
    const basePlatform = createPlatform({
      artifactBytesByHash: new Map([
        [firstPayloadHash, firstPayloadBytes],
        [receiptHash, receiptBytes],
        [receiptLogHash, receiptLogBytes],
      ]),
      artifactLabelsByHash: new Map([
        [firstPayloadHash, "first-payload"],
        [missingPayloadHash, "missing-payload"],
        [receiptHash, "partial-receipt"],
        [receiptLogHash, "receipt-log"],
      ]),
      events,
      logRequests,
      mailboxPort: createMailboxPort({
        events,
        items: [createMailboxItem({
          id: "mailbox_item_entrypoint_receipt_recovery_failed",
          laneSeq: "1",
        })],
      }),
      workspacePort: createWorkspacePort({
        checkpointRequests,
        events,
        workspace: createWorkspaceState({
          redactedStatus: {
            hostedCanonicalWriteReceiptLogByteSize: receiptLogBytes.byteLength,
            hostedCanonicalWriteReceiptLogSha256: receiptLogHash,
          },
          snapshotRef: baseSnapshotRef,
          version: "0",
        }),
      }),
      workspaceSnapshotPort: {
        async abortSnapshotSession() {
          throw new Error("Receipt recovery test should not abort snapshots.");
        },
        async completeSnapshotSession() {
          throw new Error("Receipt recovery test should not complete snapshots.");
        },
        async putSnapshotObjectDirect() {
          throw new Error("Receipt recovery test should not upload snapshots.");
        },
        async restoreWorkspaceSnapshot(input) {
          restoreCallCount += 1;
          await initializeVault({ createdAt: TEST_NOW, vaultRoot: input.durableRoot });
        },
        async startSnapshotSession() {
          throw new Error("Receipt recovery test should not start snapshots.");
        },
      },
    });
    const baseLogPort = basePlatform.logPort;
    if (!baseLogPort) {
      throw new Error("Receipt recovery proof requires a hosted runtime log port.");
    }
    const baseArtifactStore = basePlatform.artifactStore;
    let terminalArtifactReadAttempts = 0;
    const platform: HostedRuntimePlatform = {
      ...basePlatform,
      artifactStore: {
        ...baseArtifactStore,
        async get(sha256, context) {
          if (sha256 === missingPayloadHash) {
            terminalArtifactReadAttempts += 1;
            throw new HostedRuntimeArtifactReadError({
              cause: new Error("Hosted artifact is persistently unreadable."),
              retryable: false,
            });
          }
          return await baseArtifactStore.get(sha256, context);
        },
      },
      logPort: {
        async write(request) {
          const response = await baseLogPort.write(request);
          await logWriteRelease.promise;
          logWriteSettled = true;
          return response;
        },
      },
    };

    try {
      await withRealTimeout(runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
          return {
            snapshotRef: createBundleRef({
              hash: "5".repeat(64),
              key: "users/bundles/member-synthetic/receipt-recovery-failed.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          return { status: "imported" };
        },
        platform,
        async runAssistantPhase(input) {
          assert.equal(
            (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
            "1",
          );
          await assert.rejects(
            readFile(path.join(vaultRoot, "journal", "partial-receipt-write.md"), "utf8"),
            /ENOENT/u,
          );
          if (!foregroundCanonicalWriteCompleted) {
            await runCanonicalWrite({
              mutate: async ({ batch }) => {
                await batch.stageTextWrite(
                  "journal/foreground-reply-work.md",
                  "foreground reply work\n",
                );
              },
              occurredAt: TEST_NOW,
              operationType: "hosted_canonical_write_test",
              summary: "Persist foreground reply work after failed recovery.",
              vaultRoot: input.restored.vaultRoot,
            });
            foregroundCanonicalWriteCompleted = true;
          }
          events.push("assistant");
          return { progressed: false };
        },
        vaultRoot,
      }), 15_000, () => events.join(","));

      const recoveryLogIndex = requireEventIndex(
        events,
        "runtime.log:runner.error",
      );
      const mailboxFetchIndex = requireEventIndex(events, "mailbox.fetch");
      const importIndex = requireEventIndex(events, "import:1");
      const assistantIndex = requireEventIndex(events, "assistant");
      const snapshotIndex = requireEventIndex(events, "snapshot:idle_shutdown:1");
      assert.ok(recoveryLogIndex < mailboxFetchIndex);
      assert.ok(mailboxFetchIndex < importIndex);
      assert.ok(importIndex < assistantIndex);
      assert.ok(assistantIndex < snapshotIndex);
      assert.equal(
        events.filter((event) => event === "artifact.get:receipt-log").length,
        1,
      );
      assert.equal(restoreCallCount, 2);
      assert.equal(terminalArtifactReadAttempts, 1);
      assert.equal(logWriteSettled, false);
      assert.equal(consoleWarn.mock.calls.length, 1);
      const recoveryLog = logRequests.flatMap((request) => request.entries).find(
        (entry) => entry.errorCode === "canonical_write_receipt_recovery_failed",
      );
      assert.equal(
        recoveryLog?.errorCode,
        "canonical_write_receipt_recovery_failed",
      );
      assert.equal(
        recoveryLog?.redactedJson?.canonicalWriteReceiptRecoveryFailed,
        1,
      );
      assert.equal(recoveryLog?.eventCode, "runner.error");
      assert.equal(recoveryLog?.level, "warn");
      assert.equal(recoveryLog?.phase, "restore");
      assert.equal(recoveryLog?.redactedJson?.nestedErrorCode, "runtime_error");
      assert.equal(
        recoveryLog?.redactedJson?.safeErrorMessage,
        "Canonical receipt recovery rejected unsafe state; foreground reply authority continued.",
      );
      assert.equal(JSON.stringify(recoveryLog).includes("partial receipt write"), false);
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        undefined,
      );
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedCanonicalWriteReceiptLogByteSize,
        undefined,
      );
      assert.equal(
        await readFile(path.join(vaultRoot, "journal", "foreground-reply-work.md"), "utf8"),
        "foreground reply work\n",
      );
    } finally {
      logWriteRelease.resolve();
      consoleWarn.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    {
      expectedReadAttempts: 3,
      failingArtifact: "receipt-log" as const,
    },
    {
      expectedReadAttempts: 2,
      failingArtifact: "receipt" as const,
    },
    {
      expectedReadAttempts: 2,
      failingArtifact: "second-payload" as const,
    },
  ])("retries a durable canonical receipt after transient $failingArtifact unavailability", async ({
    expectedReadAttempts,
    failingArtifact,
  }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const baseSnapshotRef = createWorkspaceSnapshotV2Ref(
      "snapshot-transient-receipt-read",
    );
    const firstRestoredPayloadBytes = Buffer.from("first restored canonical write\n", "utf8");
    const firstRestoredPayloadHash = sha256Hex(firstRestoredPayloadBytes);
    const secondRestoredPayloadBytes = Buffer.from("second restored canonical write\n", "utf8");
    const secondRestoredPayloadHash = sha256Hex(secondRestoredPayloadBytes);
    const receiptBytes = Buffer.from(`${JSON.stringify({
      actions: [
        {
          byteLength: firstRestoredPayloadBytes.byteLength,
          contentRef: {
            byteSize: firstRestoredPayloadBytes.byteLength,
            sha256: firstRestoredPayloadHash,
          },
          effect: "create",
          kind: "text_upsert",
          sha256: firstRestoredPayloadHash,
          targetRelativePath: "journal/first-restored-after-transient-read.md",
        },
        {
          byteLength: secondRestoredPayloadBytes.byteLength,
          contentRef: {
            byteSize: secondRestoredPayloadBytes.byteLength,
            sha256: secondRestoredPayloadHash,
          },
          effect: "create",
          kind: "text_upsert",
          sha256: secondRestoredPayloadHash,
          targetRelativePath: "journal/second-restored-after-transient-read.md",
        },
      ],
      committedAt: TEST_NOW,
      createdAt: TEST_NOW,
      occurredAt: TEST_NOW,
      operationId: "op_synthetic_transient_receipt_read",
      operationType: "hosted_canonical_write_test",
      schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
      summary: "Replay canonical work after transient artifact unavailability.",
      updatedAt: TEST_NOW,
    }, null, 2)}\n`, "utf8");
    const receiptHash = sha256Hex(receiptBytes);
    const receiptLogBytes = Buffer.from(`${JSON.stringify({
      entries: [{
        byteSize: receiptBytes.byteLength,
        sha256: receiptHash,
      }],
      schema: "murph.hosted-canonical-write-receipt-log.v1",
    }, null, 2)}\n`, "utf8");
    const receiptLogHash = sha256Hex(receiptLogBytes);
    const durableWorkspace = createWorkspaceState({
      redactedStatus: {
        hostedCanonicalWriteReceiptLogByteSize: receiptLogBytes.byteLength,
        hostedCanonicalWriteReceiptLogSha256: receiptLogHash,
      },
      snapshotRef: baseSnapshotRef,
      version: "0",
    });
    const basePlatform = createPlatform({
      artifactBytesByHash: new Map([
        [receiptLogHash, receiptLogBytes],
        [receiptHash, receiptBytes],
        [firstRestoredPayloadHash, firstRestoredPayloadBytes],
        [secondRestoredPayloadHash, secondRestoredPayloadBytes],
      ]),
      artifactLabelsByHash: new Map([
        [receiptLogHash, "receipt-log"],
        [receiptHash, "receipt"],
        [firstRestoredPayloadHash, "first-payload"],
        [secondRestoredPayloadHash, "second-payload"],
      ]),
      events,
      mailboxPort: createMailboxPort({ events, items: [] }),
      workspacePort: createWorkspacePort({
        checkpointRequests,
        events,
        workspace: durableWorkspace,
      }),
      workspaceSnapshotPort: {
        async abortSnapshotSession() {
          throw new Error("Transient receipt read test should not abort snapshots.");
        },
        async completeSnapshotSession() {
          throw new Error("Transient receipt read test should not complete snapshots.");
        },
        async putSnapshotObjectDirect() {
          throw new Error("Transient receipt read test should not upload snapshots.");
        },
        async restoreWorkspaceSnapshot(input) {
          await rm(input.durableRoot, { force: true, recursive: true });
          await initializeVault({ createdAt: TEST_NOW, vaultRoot: input.durableRoot });
        },
        async startSnapshotSession() {
          throw new Error("Transient receipt read test should not start snapshots.");
        },
      },
    });
    const transientReadCause = Object.assign(
      new Error("Hosted artifact fetch failed with HTTP 503."),
      { status: 503, statusCode: 503 },
    );
    const transientReadError = new HostedRuntimeArtifactReadError({
      cause: transientReadCause,
      retryable: true,
    });
    const baseArtifactStore = basePlatform.artifactStore;
    const failingArtifactHash = {
      "receipt-log": receiptLogHash,
      receipt: receiptHash,
      "second-payload": secondRestoredPayloadHash,
    }[failingArtifact];
    let transientReadAttempts = 0;
    const platform: HostedRuntimePlatform = {
      ...basePlatform,
      artifactStore: {
        ...baseArtifactStore,
        async get(sha256, context) {
          if (sha256 === failingArtifactHash && transientReadAttempts++ === 0) {
            throw transientReadError;
          }
          return await baseArtifactStore.get(sha256, context);
        },
      },
    };
    let assistantPhaseCalls = 0;
    const runtimeOptions: HostedWorkspaceRuntimeJobOptions = {
      async createCheckpointSnapshot() {
        return {
          snapshotRef: createWorkspaceSnapshotV2Ref(
            "snapshot-after-transient-receipt-read",
          ),
        };
      },
      async importItem() {
        throw new Error("Transient receipt read test should not import mailbox work.");
      },
      platform,
      async runAssistantPhase(input) {
        assistantPhaseCalls += 1;
        assert.equal(
          await readFile(
            path.join(vaultRoot, "journal", "first-restored-after-transient-read.md"),
            "utf8",
          ),
          "first restored canonical write\n",
        );
        assert.equal(
          await readFile(
            path.join(vaultRoot, "journal", "second-restored-after-transient-read.md"),
            "utf8",
          ),
          "second restored canonical write\n",
        );
        await runCanonicalWrite({
          mutate: async ({ batch }) => {
            await batch.stageTextWrite(
              "journal/foreground-after-transient-read.md",
              "fresh foreground write\n",
            );
          },
          occurredAt: TEST_NOW,
          operationType: "hosted_canonical_write_test",
          summary: "Persist foreground work after canonical receipt retry.",
          vaultRoot: input.restored.vaultRoot,
        });
        return { progressed: false };
      },
      vaultRoot,
    };

    try {
      await assert.rejects(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput(),
          runtimeOptions,
        ),
        (error) => error === transientReadCause,
      );
      assert.equal(checkpointRequests.length, 0);
      assert.equal(assistantPhaseCalls, 0);
      assert.equal(
        durableWorkspace.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        receiptLogHash,
      );
      await assert.rejects(
        readFile(path.join(vaultRoot, "journal", "first-restored-after-transient-read.md")),
        /ENOENT/u,
      );
      await assert.rejects(
        readFile(path.join(vaultRoot, "journal", "second-restored-after-transient-read.md")),
        /ENOENT/u,
      );

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput(),
        runtimeOptions,
      );

      assert.equal(transientReadAttempts, expectedReadAttempts);
      assert.equal(assistantPhaseCalls, 1);
      assert.equal(
        await readFile(
          path.join(vaultRoot, "journal", "first-restored-after-transient-read.md"),
          "utf8",
        ),
        "first restored canonical write\n",
      );
      assert.equal(
        await readFile(
          path.join(vaultRoot, "journal", "second-restored-after-transient-read.md"),
          "utf8",
        ),
        "second restored canonical write\n",
      );
      assert.equal(
        await readFile(
          path.join(vaultRoot, "journal", "foreground-after-transient-read.md"),
          "utf8",
        ),
        "fresh foreground write\n",
      );
      assert.equal(
        typeof checkpointRequests[0]?.redactedStatus
          ?.hostedCanonicalWriteReceiptLogSha256,
        "string",
      );
      assert.notEqual(
        checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        receiptLogHash,
      );
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        undefined,
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("rejects consecutive failed receipt logs without creating repair ownership", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const artifactLabelsByHash = new Map<string, string>();
    const baseSnapshotRef = createWorkspaceSnapshotV2Ref(
      "snapshot-unreadable-receipt-log",
    );
    const unreadableReceiptLogBytes = Buffer.from('{"schema":"invalid"}\n', "utf8");
    const unreadableReceiptLogHash = sha256Hex(unreadableReceiptLogBytes);
    artifactBytesByHash.set(unreadableReceiptLogHash, unreadableReceiptLogBytes);
    artifactLabelsByHash.set(unreadableReceiptLogHash, "first-failed-receipt-log");
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const firstCrash = new Error("Synthetic crash after foreground canonical checkpoint.");
    let assistantInvocation = 0;
    let durableWorkspace = createWorkspaceState({
      redactedStatus: {
        hostedCanonicalWriteReceiptLogByteSize: unreadableReceiptLogBytes.byteLength,
        hostedCanonicalWriteReceiptLogSha256: unreadableReceiptLogHash,
      },
      snapshotRef: baseSnapshotRef,
      version: "0",
    });
    let restoreCallCount = 0;
    const workspacePort: HostedRuntimeWorkspacePort = {
      async checkpoint(request) {
        events.push("workspace.checkpoint");
        checkpointRequests.push(request);
        durableWorkspace = createWorkspaceState({
          inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
          nextWakeAt: request.nextWakeAt ?? null,
          nextWakeReason: request.nextWakeReason ?? null,
          redactedStatus: request.redactedStatus ?? null,
          snapshotRef: request.snapshotRef,
          version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
        });
        return {
          checkpointed: true,
          workspace: durableWorkspace,
        };
      },
      async read() {
        events.push("workspace.read");
        return {
          fetchedAt: TEST_NOW,
          workspace: durableWorkspace,
        };
      },
    };
    const platform = createPlatform({
      artifactBytesByHash,
      artifactLabelsByHash,
      events,
      logRequests,
      mailboxPort: createMailboxPort({
        events,
        items: [createMailboxItem({
          id: "mailbox_item_entrypoint_consecutive_receipt_failures",
          laneSeq: "1",
        })],
      }),
      workspacePort,
      workspaceSnapshotPort: {
        async abortSnapshotSession() {
          throw new Error("Consecutive receipt failure test should not abort snapshots.");
        },
        async completeSnapshotSession() {
          throw new Error("Consecutive receipt failure test should not complete snapshots.");
        },
        async putSnapshotObjectDirect() {
          throw new Error("Consecutive receipt failure test should not upload snapshots.");
        },
        async restoreWorkspaceSnapshot(input) {
          restoreCallCount += 1;
          await rm(input.durableRoot, { force: true, recursive: true });
          await initializeVault({ createdAt: TEST_NOW, vaultRoot: input.durableRoot });
        },
        async startSnapshotSession() {
          throw new Error("Consecutive receipt failure test should not start snapshots.");
        },
      },
    });
    const runAssistantPhase: NonNullable<HostedWorkspaceRuntimeJobOptions["runAssistantPhase"]> = async (input) => {
      assistantInvocation += 1;
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "1",
      );
      if (assistantInvocation === 1) {
        await runCanonicalWrite({
          mutate: async ({ batch }) => {
            await batch.stageTextWrite(
              "journal/foreground-before-crash.md",
              "foreground write before crash\n",
            );
          },
          occurredAt: TEST_NOW,
          operationType: "hosted_canonical_write_test",
          summary: "Persist foreground work after the first rejected receipt log.",
          vaultRoot: input.restored.vaultRoot,
        });
        events.push("assistant:1");
        throw firstCrash;
      }
      await assert.rejects(
        readFile(path.join(vaultRoot, "journal", "foreground-before-crash.md"), "utf8"),
        /ENOENT/u,
      );
      await runCanonicalWrite({
        mutate: async ({ batch }) => {
          await batch.stageTextWrite(
            "journal/foreground-after-second-failure.md",
            "foreground write after second failure\n",
          );
        },
        occurredAt: TEST_NOW,
        operationType: "hosted_canonical_write_test",
        summary: "Persist foreground work after the second rejected receipt log.",
        vaultRoot: input.restored.vaultRoot,
      });
      events.push("assistant:2");
      return { progressed: false };
    };

    try {
      const runtimeOptions: HostedWorkspaceRuntimeJobOptions = {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}`);
          return {
            snapshotRef: createWorkspaceSnapshotV2Ref(
              "snapshot-consecutive-receipt-failures",
            ),
          };
        },
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          return { status: "imported" as const };
        },
        platform,
        runAssistantPhase,
        vaultRoot,
      };
      await assert.rejects(
        withRealTimeout(
          runHostedWorkspaceRuntimeJobInProcess(
            createWorkspaceRuntimeJobInput(),
            runtimeOptions,
          ),
          15_000,
          () => events.join(","),
        ),
        (error) => error === firstCrash,
      );

      const firstForegroundCheckpoint = checkpointRequests.find(
        (request) => request.reason === "canonical_runtime_commit",
      );
      const secondFailedLogHash = firstForegroundCheckpoint?.redactedStatus
        ?.hostedCanonicalWriteReceiptLogSha256;
      assert.equal(typeof secondFailedLogHash, "string");
      assert.notEqual(secondFailedLogHash, unreadableReceiptLogHash);
      artifactBytesByHash.delete(String(secondFailedLogHash));
      artifactLabelsByHash.set(String(secondFailedLogHash), "second-failed-receipt-log");
      await rm(vaultRoot, { force: true, recursive: true });
      runtimeOptions.platform = {
        ...platform,
        artifactStore: createPlatform({
          artifactBytesByHash,
          artifactLabelsByHash,
          events,
          mailboxPort: null,
          workspacePort: null,
        }).artifactStore,
      };

      await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_second_receipt_failure",
              workspaceVersion: durableWorkspace.version,
            },
          }),
          runtimeOptions,
        ),
        15_000,
        () => events.join(","),
      );

      assert.ok(requireEventIndex(events, "import:1") < requireEventIndex(events, "assistant:1"));
      assert.ok(requireEventIndex(events, "assistant:1") < requireEventIndex(events, "assistant:2"));
      assert.equal(
        events.filter((event) => event === "artifact.get:first-failed-receipt-log").length,
        1,
      );
      assert.equal(
        events.filter((event) => event === "artifact.get:second-failed-receipt-log").length,
        1,
      );
      assert.equal(restoreCallCount, 4);
      const recoveryLogs = logRequests.flatMap((request) => request.entries).filter(
        (entry) => entry.errorCode === "canonical_write_receipt_recovery_failed",
      );
      assert.equal(recoveryLogs.length, 2);
      for (const recoveryLog of recoveryLogs) {
        assert.equal(recoveryLog.level, "warn");
        assert.equal(recoveryLog.redactedJson?.canonicalWriteReceiptRecoveryFailed, 1);
      }
      assert.equal(JSON.stringify(recoveryLogs).includes('"schema":"invalid"'), false);
      const foregroundCanonicalCheckpoints = checkpointRequests.filter(
        (request) => request.reason === "canonical_runtime_commit",
      );
      assert.equal(foregroundCanonicalCheckpoints.length, 2);
      assert.equal(
        foregroundCanonicalCheckpoints[0]?.redactedStatus
          ?.hostedCanonicalWriteReceiptLogSha256,
        secondFailedLogHash,
      );
      assert.equal(
        typeof foregroundCanonicalCheckpoints[1]?.redactedStatus
          ?.hostedCanonicalWriteReceiptLogSha256,
        "string",
      );
      assert.notEqual(
        foregroundCanonicalCheckpoints[1]?.redactedStatus
          ?.hostedCanonicalWriteReceiptLogSha256,
        secondFailedLogHash,
      );
      for (const checkpointRequest of checkpointRequests) {
        assert.equal(
          Object.keys(checkpointRequest.redactedStatus ?? {}).some((key) =>
            key.startsWith("hostedCanonicalWriteRepair")
          ),
          false,
        );
      }
      const finalStatus = checkpointRequests.at(-1)?.redactedStatus;
      assert.equal(finalStatus?.hostedCanonicalWriteReceiptLogSha256, undefined);
      assert.equal(finalStatus?.hostedCanonicalWriteReceiptLogByteSize, undefined);
      assert.equal(
        await readFile(
          path.join(vaultRoot, "journal", "foreground-after-second-failure.md"),
          "utf8",
        ),
        "foreground write after second failure\n",
      );
    } finally {
      consoleWarn.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  test("preserves host cancellation during canonical receipt recovery", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const abortController = new AbortController();
    const abortReason = new Error("Synthetic host cancellation during receipt recovery.");
    const missingReceiptHash = "f".repeat(64);
    const receiptLogBytes = Buffer.from(`${JSON.stringify({
      entries: [{
        byteSize: 1,
        sha256: missingReceiptHash,
      }],
      schema: "murph.hosted-canonical-write-receipt-log.v1",
    }, null, 2)}\n`, "utf8");
    const receiptLogHash = sha256Hex(receiptLogBytes);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const basePlatform = createPlatform({
      artifactBytesByHash: new Map([
        [receiptLogHash, receiptLogBytes],
      ]),
      artifactLabelsByHash: new Map([
        [missingReceiptHash, "missing-receipt"],
        [receiptLogHash, "receipt-log"],
      ]),
      events,
      logRequests,
      mailboxPort: createMailboxPort({
        events,
        items: [createMailboxItem({ laneSeq: "1" })],
      }),
      workspacePort: createWorkspacePort({
        checkpointRequests: [],
        events,
        workspace: createWorkspaceState({
          redactedStatus: {
            hostedCanonicalWriteReceiptLogByteSize: receiptLogBytes.byteLength,
            hostedCanonicalWriteReceiptLogSha256: receiptLogHash,
          },
          version: "0",
        }),
      }),
    });
    const baseArtifactStore = basePlatform.artifactStore;
    const platform: HostedRuntimePlatform = {
      ...basePlatform,
      artifactStore: {
        ...baseArtifactStore,
        async get(sha256, context) {
          const bytes = await baseArtifactStore.get(sha256, context);
          if (sha256 === missingReceiptHash) {
            abortController.abort(abortReason);
          }
          return bytes;
        },
      },
    };

    try {
      await assert.rejects(
        runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
          async createCheckpointSnapshot() {
            throw new Error("Cancelled receipt recovery must not checkpoint.");
          },
          async importItem() {
            throw new Error("Cancelled receipt recovery must not import mailbox work.");
          },
          platform,
          async runAssistantPhase() {
            throw new Error("Cancelled receipt recovery must not enter the assistant phase.");
          },
          signal: abortController.signal,
          vaultRoot,
        }),
        (error) => error === abortReason,
      );

      assert.ok(events.includes("artifact.get:receipt-log"));
      assert.ok(events.includes("artifact.get:missing-receipt"));
      assert.equal(events.includes("mailbox.fetch"), false);
      assert.equal(events.some((event) => event.startsWith("runtime.log:")), false);
      assert.equal(logRequests.length, 0);
      assert.equal(consoleWarn.mock.calls.length, 0);
    } finally {
      consoleWarn.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  test("persists hosted canonical write receipts before the idle workspace checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactPutCalls: Array<{ byteLength: number; sha256: string }> = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const artifactLabelsByHash = new Map<string, string>();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const platform = createPlatform({
        artifactBytesByHash,
        artifactLabelsByHash,
        artifactPutCalls,
        events,
        mailboxPort: createMailboxPort({
          events,
          items: [],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({ version: "0" }),
        }),
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}`);
          assert.equal(snapshotInput.reason, "idle_shutdown");
          const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({ vaultRoot });
          const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
          artifactLabelsByHash.set(hotHash, "canonical-hot-state");
          artifactBytesByHash.set(hotHash, hotSnapshot.bundle);
          return {
            snapshotRef: createBundleRef({
              hash: hotHash,
              key: "users/bundles/member-synthetic/canonical-hot.bundle.json",
              size: hotSnapshot.bundle.byteLength,
            }),
          };
        },
        async importItem() {
          throw new Error("Mailbox import should not run without mailbox items.");
        },
        platform,
        async runAssistantPhase(input) {
          await runCanonicalWrite({
            vaultRoot: input.restored.vaultRoot,
            operationType: "hosted_canonical_write_test",
            summary: "Persist hosted canonical write receipt.",
            occurredAt: TEST_NOW,
            mutate: async ({ batch }) => {
              await batch.stageTextWrite("journal/2026-04-27.md", "exact hosted note\n");
            },
          });
          return { progressed: false };
        },
        vaultRoot,
      });

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "mailbox.fetch",
        "artifact.put:unlabeled-artifact",
        "artifact.put:unlabeled-artifact",
        "artifact.put:unlabeled-artifact",
        "workspace.checkpoint",
        "snapshot:idle_shutdown",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "canonical_runtime_commit",
        "idle_shutdown",
      ]);
      assert.equal(artifactPutCalls.length, 3);
      const expectedPayloadBytes = Buffer.from("exact hosted note\n", "utf8");
      const expectedPayloadSha256 = sha256Hex(expectedPayloadBytes);
      assert.deepEqual(
        artifactPutCalls.find((call) => call.sha256 === expectedPayloadSha256),
        {
          byteLength: expectedPayloadBytes.byteLength,
          sha256: expectedPayloadSha256,
        },
      );
      const receiptLogs = listHostedCanonicalWriteReceiptLogArtifacts(artifactBytesByHash);
      assert.equal(receiptLogs.length, 1);
      assert.equal(receiptLogs[0]?.entries.length, 1);
      const canonicalCheckpointRedactedStatus = checkpointRequests[0]?.redactedStatus ?? {};
      assert.equal(
        canonicalCheckpointRedactedStatus.hostedCanonicalWriteReceiptLogSha256,
        receiptLogs[0]?.sha256,
      );
      assert.equal(
        canonicalCheckpointRedactedStatus.hostedCanonicalWriteReceiptLogByteSize,
        artifactBytesByHash.get(receiptLogs[0]?.sha256 ?? "")?.byteLength,
      );
      assert.equal(
        canonicalCheckpointRedactedStatus.hostedCanonicalWriteReceiptLogEntryCount,
        undefined,
      );
      const checkpointRedactedStatus = checkpointRequests[1]?.redactedStatus ?? {};
      assert.equal(checkpointRedactedStatus.hostedCanonicalWriteReceiptLogEntryCount, undefined);
      assert.equal(checkpointRedactedStatus.hostedCanonicalWriteReceiptLogSha256, undefined);
      assert.equal(checkpointRedactedStatus.hostedCanonicalWriteReceiptLogByteSize, undefined);
      assert.equal(result.redactedStatus?.hostedCanonicalWriteReceiptLogEntryCount, undefined);
      assert.equal(result.redactedStatus?.hostedCanonicalWriteReceiptLogSha256, undefined);
      assert.equal(result.redactedStatus?.hostedCanonicalWriteReceiptLogByteSize, undefined);
      assert.equal(
        await readFile(path.join(vaultRoot, "journal", "2026-04-27.md"), "utf8"),
        "exact hosted note\n",
      );
      const receiptRoot = path.join(
        resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
        "receipts",
        "canonical-writes",
      );
      await assert.rejects(readdir(receiptRoot));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("consolidates a restored receipt log at the admission boundary before foreground writes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactGetCalls: string[] = [];
    const events: string[] = [];
    let assistantPhaseCalls = 0;
    let foregroundPendingGuardChecks = 0;
    let snapshotCalls = 0;

    try {
      const {
        artifactBytesByHash,
        receiptHash,
        receiptLogBytes,
        receiptLogHash,
      } = createCanonicalReceiptLogArtifacts(
        HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BACKGROUND_YIELD_THRESHOLD,
      );
      const priorNextWakeAt = "2099-04-28T12:00:00.000Z";
      const initialWorkspace = createWorkspaceState({
        nextWakeAt: priorNextWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: {
          hostedCanonicalWriteReceiptLogByteSize: receiptLogBytes.byteLength,
          hostedCanonicalWriteReceiptLogSha256: receiptLogHash,
          hostedMailboxConversationImportedSeq: "0",
        },
        version: "0",
      });

      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          snapshotCalls += 1;
          events.push(`snapshot:${snapshotInput.reason}`);
          assert.equal(snapshotInput.reason, "idle_shutdown");
          return {
            snapshotRef: createWorkspaceSnapshotV2Ref(
              `snapshot-saturated-receipt-recovery-${snapshotCalls}`,
            ),
          };
        },
        async importItem() {
          throw new Error("Mailbox import should not run without mailbox items.");
        },
        platform: createPlatform({
          artifactBytesByHash,
          artifactGetCalls,
          events,
          mailboxPort: createMailboxPort({
            events,
            items: [],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            checkpointResponse(request) {
              if (
                request.reason === "idle_shutdown"
                && request.expectedWorkspaceVersion === "0"
              ) {
                foregroundPendingGuardChecks += 1;
                if (request.nextWakeAt === null || request.nextWakeReason !== "mailbox") {
                  return {
                    checkpointConflictReason: "foreground_pending",
                    checkpointed: false,
                    workspace: initialWorkspace,
                  };
                }
              }
              return {
                checkpointed: true,
                workspace: createWorkspaceState({
                  inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                }),
              };
            },
            events,
            workspace: initialWorkspace,
          }),
        }),
        async runAssistantPhase(input) {
          assistantPhaseCalls += 1;
          await runCanonicalWrite({
            vaultRoot: input.restored.vaultRoot,
            operationType: "hosted_canonical_write_test",
            summary: "Write after saturated receipt recovery.",
            occurredAt: TEST_NOW,
            mutate: async ({ batch }) => {
              await batch.stageTextWrite(
                "journal/saturated-receipt-recovery.md",
                "recovered canonical write\n",
              );
            },
          });
          return { progressed: false };
        },
        vaultRoot,
      });

      assert.equal(assistantPhaseCalls, 1);
      assert.equal(foregroundPendingGuardChecks, 1);
      assert.deepEqual(artifactGetCalls, [receiptLogHash, receiptHash]);
      assert.deepEqual(events.filter((event) => event.startsWith("snapshot:")), [
        "snapshot:idle_shutdown",
        "snapshot:idle_shutdown",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
        "import",
        "canonical_runtime_commit",
        "idle_shutdown",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "0",
        "1",
        "2",
        "3",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "mailbox");
      assert.ok(checkpointRequests[0]?.nextWakeAt);
      assert.notEqual(checkpointRequests[0]?.nextWakeAt, priorNextWakeAt);
      assert.equal(checkpointRequests[1]?.nextWakeAt, priorNextWakeAt);
      assert.equal(checkpointRequests[1]?.nextWakeReason, "assistant");
      assert.deepEqual(checkpointRequests[1]?.snapshotRef, checkpointRequests[0]?.snapshotRef);
      assert.equal(checkpointRequests[2]?.nextWakeAt, priorNextWakeAt);
      assert.equal(checkpointRequests[2]?.nextWakeReason, "assistant");
      assert.deepEqual(checkpointRequests[2]?.snapshotRef, checkpointRequests[0]?.snapshotRef);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        receiptLogHash,
      );
      assert.deepEqual(
        readHostedCanonicalWriteReceiptRecoveryWake(checkpointRequests[0]?.redactedStatus),
        {
          nextWakeAt: priorNextWakeAt,
          nextWakeReason: "assistant",
        },
      );
      assert.equal(
        checkpointRequests[1]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        undefined,
      );
      assert.equal(
        readHostedCanonicalWriteReceiptRecoveryWake(checkpointRequests[1]?.redactedStatus),
        null,
      );
      assert.equal(
        checkpointRequests[3]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        undefined,
      );
      assert.equal(
        await readFile(
          path.join(vaultRoot, "journal", "saturated-receipt-recovery.md"),
          "utf8",
        ),
        "recovered canonical write\n",
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("yields at the restored receipt admission boundary and resumes after an accepted snapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    let assistantPhaseCalls = 0;
    let idleCheckpointCalls = 0;
    let snapshotCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const {
        artifactBytesByHash,
        receiptLogBytes,
        receiptLogHash,
      } = createCanonicalReceiptLogArtifacts(
        HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BACKGROUND_YIELD_THRESHOLD - 1,
      );
      let persistedWorkspace = createWorkspaceState({
        redactedStatus: {
          hostedCanonicalWriteReceiptLogByteSize: receiptLogBytes.byteLength,
          hostedCanonicalWriteReceiptLogSha256: receiptLogHash,
        },
        version: "0",
      });
      const runInvocation = async (attemptId: string) => {
        const startingWorkspace = persistedWorkspace;
        return await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId,
              workspaceVersion: startingWorkspace.version,
            },
          }),
          {
            async createCheckpointSnapshot() {
              snapshotCalls += 1;
              const snapshot = await createVaultSnapshotBundle({
                key:
                  `users/bundles/member-synthetic/receipt-capacity-${snapshotCalls}.bundle.json`,
                vaultRoot,
              });
              artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
              return { snapshotRef: snapshot.snapshotRef };
            },
            async importItem() {
              throw new Error("Receipt capacity test has no mailbox input.");
            },
            platform: createPlatform({
              artifactBytesByHash,
              events,
              mailboxPort: createMailboxPort({ events, items: [] }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                checkpointResponse(request) {
                  persistedWorkspace = createWorkspaceState({
                    inboxMediaRetentionWakeAt:
                      request.inboxMediaRetentionWakeAt ?? null,
                    nextWakeAt: request.nextWakeAt ?? null,
                    nextWakeReason: request.nextWakeReason ?? null,
                    redactedStatus: request.redactedStatus ?? null,
                    snapshotRef: request.snapshotRef,
                    version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                  });
                  if (request.reason === "idle_shutdown") {
                    idleCheckpointCalls += 1;
                  }
                  return { checkpointed: true, workspace: persistedWorkspace };
                },
                events,
                workspace: startingWorkspace,
              }),
            }),
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              assert.equal(input.shouldYieldBackgroundMaintenance?.(), false);
              await runCanonicalWrite({
                vaultRoot: input.restored.vaultRoot,
                operationType: "hosted_canonical_write_test",
                summary: "Exercise the hosted receipt admission boundary.",
                occurredAt: TEST_NOW,
                mutate: async ({ batch }) => {
                  await batch.stageTextWrite(
                    `journal/receipt-capacity-${assistantPhaseCalls}.md`,
                    `receipt capacity pass ${assistantPhaseCalls}\n`,
                  );
                },
              });
              assert.equal(
                input.shouldYieldBackgroundMaintenance?.(),
                assistantPhaseCalls === 1,
              );
              return { progressed: false };
            },
            vaultRoot,
          },
        );
      };

      await runInvocation("attempt_receipt_capacity_initial");
      const result = await runInvocation("attempt_receipt_capacity_follow_up");

      assert.equal(assistantPhaseCalls, 2);
      assert.equal(idleCheckpointCalls, 2);
      const firstIdleCheckpointIndex = checkpointRequests.findIndex(
        (request) => request.reason === "idle_shutdown",
      );
      assert.notEqual(firstIdleCheckpointIndex, -1);
      const firstIdleCheckpoint = checkpointRequests[firstIdleCheckpointIndex];
      assert.equal(
        firstIdleCheckpoint?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        undefined,
      );
      const canonicalCheckpoints = checkpointRequests.filter(
        (request) => request.reason === "canonical_runtime_commit",
      );
      assert.ok(canonicalCheckpoints.length >= 2);
      const receiptLogsBySha = new Map(
        listHostedCanonicalWriteReceiptLogArtifacts(artifactBytesByHash)
          .map((log) => [log.sha256, log] as const),
      );
      const canonicalEntryCounts = canonicalCheckpoints.map((request) => {
        const sha = request.redactedStatus
          ?.hostedCanonicalWriteReceiptLogSha256;
        return typeof sha === "string"
          ? receiptLogsBySha.get(sha)?.entryCount ?? null
          : null;
      });
      assert.equal(
        canonicalEntryCounts[0],
        HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BACKGROUND_YIELD_THRESHOLD,
      );
      assert.ok(
        canonicalEntryCounts.slice(1).some((count) =>
          count !== null
          && count > 0
          && count < HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES
        ),
      );
      assert.equal(
        result.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        undefined,
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("restores the original wake from a persisted saturated recovery marker", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const {
      artifactBytesByHash,
      receiptLogBytes,
      receiptLogHash,
    } = createSaturatedCanonicalReceiptLogArtifacts();
    const priorNextWakeAt = "2099-07-09T00:00:00.000Z";

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput(),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createWorkspaceSnapshotV2Ref(
                "snapshot-saturated-receipt-no-follow-up",
              ),
            };
          },
          async importItem() {
            throw new Error("Mailbox import should not run without mailbox items.");
          },
          platform: createPlatform({
            artifactBytesByHash,
            events,
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: "2026-07-09T00:00:00.000Z",
                nextWakeReason: "mailbox",
                redactedStatus: {
                  hostedCanonicalWriteReceiptLogByteSize: receiptLogBytes.byteLength,
                  hostedCanonicalWriteReceiptLogSha256: receiptLogHash,
                  ...hostedCanonicalWriteReceiptRecoveryStatusFields({
                    nextWakeAt: priorNextWakeAt,
                    nextWakeReason: "assistant",
                  }),
                },
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

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
        "import",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "0",
        "1",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "mailbox");
      assert.ok(checkpointRequests[0]?.nextWakeAt);
      assert.equal(checkpointRequests[1]?.nextWakeAt, priorNextWakeAt);
      assert.equal(checkpointRequests[1]?.nextWakeReason, "assistant");
      assert.deepEqual(checkpointRequests[1]?.snapshotRef, checkpointRequests[0]?.snapshotRef);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        receiptLogHash,
      );
      assert.deepEqual(
        readHostedCanonicalWriteReceiptRecoveryWake(checkpointRequests[0]?.redactedStatus),
        {
          nextWakeAt: priorNextWakeAt,
          nextWakeReason: "assistant",
        },
      );
      assert.equal(
        checkpointRequests[1]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        undefined,
      );
      assert.equal(
        readHostedCanonicalWriteReceiptRecoveryWake(checkpointRequests[1]?.redactedStatus),
        null,
      );
      assert.equal(result.nextWakeAt, priorNextWakeAt);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("retains the saturated recovery marker when the wake reset checkpoint fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const wakeResetFailure = new Error("Synthetic wake reset checkpoint failure.");
    const {
      artifactBytesByHash,
      receiptLogBytes,
      receiptLogHash,
    } = createSaturatedCanonicalReceiptLogArtifacts();
    const initialWorkspace = createWorkspaceState({
      redactedStatus: {
        hostedCanonicalWriteReceiptLogByteSize: receiptLogBytes.byteLength,
        hostedCanonicalWriteReceiptLogSha256: receiptLogHash,
      },
      version: "0",
    });

    try {
      await expect(runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput(),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createWorkspaceSnapshotV2Ref(
                "snapshot-saturated-receipt-reset-failure",
              ),
            };
          },
          async importItem() {
            throw new Error("Mailbox import must not start before wake reset succeeds.");
          },
          platform: createPlatform({
            artifactBytesByHash,
            events,
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointResponse(request) {
                if (request.expectedWorkspaceVersion === "1") {
                  throw wakeResetFailure;
                }
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    nextWakeAt: request.nextWakeAt ?? null,
                    nextWakeReason: request.nextWakeReason ?? null,
                    redactedStatus: request.redactedStatus ?? null,
                    snapshotRef: request.snapshotRef,
                    version: "1",
                  }),
                };
              },
              events,
              workspace: initialWorkspace,
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Assistant work must not start before wake reset succeeds.");
          },
          vaultRoot,
        },
      )).rejects.toThrow(wakeResetFailure.message);

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
        "import",
      ]);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        receiptLogHash,
      );
      assert.deepEqual(
        readHostedCanonicalWriteReceiptRecoveryWake(checkpointRequests[0]?.redactedStatus),
        {
          nextWakeAt: null,
          nextWakeReason: null,
        },
      );
      assert.equal(
        checkpointRequests[1]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        undefined,
      );
      assert.equal(checkpointRequests[0]?.nextWakeReason, "mailbox");
      assert.equal(checkpointRequests[1]?.nextWakeReason, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("restores canonical write receipts and context dirtiness from a pre-idle checkpoint", async () => {
    const firstVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const restoredVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const restoredCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const baseSnapshotRef = createWorkspaceSnapshotV2Ref("snapshot-canonical-crash-base");
    const checkpointedWorkspaces: HostedWorkspaceState[] = [];
    const abortController = new AbortController();
    const abortReason = new Error("Synthetic stop after canonical receipt checkpoint.");
    const rawDeleteRelativePath = "raw/inbox/expired/pre-idle-crash.bin";

    try {
      await expect(
        runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            throw new Error("Canonical crash test should not reach snapshotting.");
          },
          async importItem() {
            throw new Error("Mailbox import should not run without mailbox items.");
          },
          platform: createPlatform({
            artifactBytesByHash,
            events,
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace(request) {
                const workspace = createWorkspaceState({
                  inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
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
              events,
              workspace: createWorkspaceState({
                snapshotRef: baseSnapshotRef,
                version: "0",
              }),
            }),
            workspaceSnapshotPort: {
              async abortSnapshotSession() {
                throw new Error("Canonical crash test should not abort snapshots.");
              },
              async completeSnapshotSession() {
                throw new Error("Canonical crash test should not complete snapshots.");
              },
              async putSnapshotObjectDirect() {
                throw new Error("Canonical crash test should not upload snapshots.");
              },
              async restoreWorkspaceSnapshot(input) {
                await initializeVault({ createdAt: TEST_NOW, vaultRoot: input.durableRoot });
                const rawDeleteAbsolutePath = path.join(input.durableRoot, rawDeleteRelativePath);
                await mkdir(path.dirname(rawDeleteAbsolutePath), { recursive: true });
                await writeFile(rawDeleteAbsolutePath, "expired private bytes", "utf8");
              },
              async startSnapshotSession() {
                throw new Error("Canonical crash test should not start snapshots.");
              },
            },
          }),
          signal: abortController.signal,
          async runAssistantPhase(input) {
            await runCanonicalWrite({
              vaultRoot: input.restored.vaultRoot,
              operationType: "hosted_canonical_write_test",
              summary: "Persist hosted canonical write receipt before crash.",
              occurredAt: TEST_NOW,
              mutate: async ({ batch }) => {
                await batch.stageTextWrite(
                  "bank/conditions/pre-idle-crash.md",
                  "crash durable health context\n",
                );
                await batch.stageDelete(rawDeleteRelativePath, { allowRaw: true });
              },
            });
            return { progressed: false };
          },
          vaultRoot: firstVaultRoot,
        }),
      ).rejects.toBe(abortReason);

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "canonical_runtime_commit",
      ]);
      const workspaceAfterCrash = checkpointedWorkspaces[0];
      assert.ok(workspaceAfterCrash);
      assert.equal(
        workspaceAfterCrash.redactedStatus?.hostedCanonicalWriteReceiptLogEntryCount,
        undefined,
      );
      assert.equal(
        typeof workspaceAfterCrash.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        "string",
      );
      assert.deepEqual(workspaceAfterCrash.snapshotRef, baseSnapshotRef);
      assert.equal(
        await readFile(
          path.join(firstVaultRoot, "bank", "conditions", "pre-idle-crash.md"),
          "utf8",
        ),
        "crash durable health context\n",
      );
      assert.deepEqual(
        (await readAssistantContextSnapshotState(firstVaultRoot))?.pendingDirtyDomains,
        ["health_context"],
      );
      await assert.rejects(stat(path.join(firstVaultRoot, rawDeleteRelativePath)), {
        code: "ENOENT",
      });

      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          workspaceVersion: workspaceAfterCrash.version,
        },
      }), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`restore-snapshot:${snapshotInput.reason}`);
          assert.equal(snapshotInput.reason, "idle_shutdown");
          const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
            vaultRoot: restoredVaultRoot,
          });
          const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
          artifactBytesByHash.set(hotHash, hotSnapshot.bundle);
          return {
            snapshotRef: createBundleRef({
              hash: hotHash,
              key: "users/bundles/member-synthetic/canonical-crash-restore-hot.bundle.json",
              size: hotSnapshot.bundle.byteLength,
            }),
          };
        },
        async importItem() {
          throw new Error("Restored mailbox import should not run without mailbox items.");
        },
        platform: createPlatform({
          artifactBytesByHash,
          events,
          mailboxPort: createMailboxPort({
            events,
            items: [],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests: restoredCheckpointRequests,
            events,
            workspace: workspaceAfterCrash,
          }),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("Canonical restore test should not abort snapshots.");
            },
            async completeSnapshotSession() {
              throw new Error("Canonical restore test should not complete snapshots.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("Canonical restore test should not upload snapshots.");
            },
            async restoreWorkspaceSnapshot(input) {
              await initializeVault({ createdAt: TEST_NOW, vaultRoot: input.durableRoot });
              const rawDeleteAbsolutePath = path.join(input.durableRoot, rawDeleteRelativePath);
              await mkdir(path.dirname(rawDeleteAbsolutePath), { recursive: true });
              await writeFile(rawDeleteAbsolutePath, "expired private bytes", "utf8");
            },
            async startSnapshotSession() {
              throw new Error("Canonical restore test should not start snapshots.");
            },
          },
        }),
        async runAssistantPhase() {
          return { progressed: false };
        },
        vaultRoot: restoredVaultRoot,
      });

      assert.equal(
        await readFile(
          path.join(restoredVaultRoot, "bank", "conditions", "pre-idle-crash.md"),
          "utf8",
        ),
        "crash durable health context\n",
      );
      assert.deepEqual(
        (await readAssistantContextSnapshotState(restoredVaultRoot))?.pendingDirtyDomains,
        ["health_context"],
      );
      await assert.rejects(stat(path.join(restoredVaultRoot, rawDeleteRelativePath)), {
        code: "ENOENT",
      });
      assert.equal(restoredCheckpointRequests.length, 1);
      assert.equal(restoredCheckpointRequests[0]?.reason, "idle_shutdown");
      const restoredCheckpointStatus = restoredCheckpointRequests[0]?.redactedStatus ?? {};
      assert.equal(
        restoredCheckpointStatus.hostedCanonicalWriteReceiptLogSha256,
        undefined,
      );
      assert.equal(
        restoredCheckpointStatus.hostedCanonicalWriteReceiptLogByteSize,
        undefined,
      );
      assert.equal(
        restoredCheckpointStatus.hostedCanonicalWriteReceiptLogEntryCount,
        undefined,
      );
    } finally {
      await removeTempRoot(firstVaultRoot);
      await removeTempRoot(restoredVaultRoot);
    }
  });

  test("services a due one-shot automation after its canonical checkpoint survives host abort", async () => {
    const firstVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const restoredVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const restoredCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const baseSnapshotRef = createWorkspaceSnapshotV2Ref(
      "snapshot-one-shot-automation-abort-base",
    );
    const checkpointedWorkspaces: HostedWorkspaceState[] = [];
    const abortController = new AbortController();
    const abortReason = new Error(
      "Synthetic stop after one-shot automation checkpoint.",
    );
    const originalAutomationPass =
      mocks.runAssistantAutomationPass.getMockImplementation();
    let automationPassCount = 0;

    assert.ok(originalAutomationPass);
    try {
      await expect(
        runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
          async createCheckpointSnapshot() {
            throw new Error("One-shot abort test should not reach snapshotting.");
          },
          async importItem() {
            throw new Error("One-shot abort test should not import mailbox items.");
          },
          platform: createPlatform({
            artifactBytesByHash,
            events,
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace(request) {
                const workspace = createWorkspaceState({
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
              events,
              workspace: createWorkspaceState({
                snapshotRef: baseSnapshotRef,
                version: "0",
              }),
            }),
            workspaceSnapshotPort: {
              async abortSnapshotSession() {
                throw new Error("One-shot abort test should not abort snapshots.");
              },
              async completeSnapshotSession() {
                throw new Error("One-shot abort test should not complete snapshots.");
              },
              async putSnapshotObjectDirect() {
                throw new Error("One-shot abort test should not upload snapshots.");
              },
              async restoreWorkspaceSnapshot(input) {
                await initializeVault({
                  createdAt: TEST_NOW,
                  vaultRoot: input.durableRoot,
                });
              },
              async startSnapshotSession() {
                throw new Error("One-shot abort test should not start snapshots.");
              },
            },
          }),
          signal: abortController.signal,
          async runAssistantPhase(input) {
            await upsertAutomation({
              automationId: "automation_01JQ8PWXP5A68SQM1W0GYM41V9",
              continuityPolicy: "fresh",
              instructions: "Send the scheduled reminder.",
              now: new Date(TEST_NOW),
              route: {
                channel: "linq",
                deliveryTarget: "synthetic_direct_chat",
                identityId: null,
                participantId: null,
                threadId: "synthetic_direct_chat",
                threadIsDirect: true,
              },
              schedule: {
                at: TEST_NOW,
                kind: "at",
              },
              status: "active",
              title: "Synthetic one-shot reminder",
              vaultRoot: input.restored.vaultRoot,
            });
            return { progressed: false };
          },
          vaultRoot: firstVaultRoot,
        }),
      ).rejects.toBe(abortReason);

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "canonical_runtime_commit",
      ]);
      const workspaceAfterCrash = checkpointedWorkspaces[0];
      assert.ok(workspaceAfterCrash);
      assert.deepEqual(workspaceAfterCrash.snapshotRef, baseSnapshotRef);
      assert.match(workspaceAfterCrash.nextWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(workspaceAfterCrash.nextWakeReason, "assistant");

      mocks.runAssistantAutomationPass.mockImplementation(
        async () => {
          automationPassCount += 1;
          const automation = await showAutomation({
            automationId: "automation_01JQ8PWXP5A68SQM1W0GYM41V9",
            vaultRoot: restoredVaultRoot,
          });
          assert.ok(automation);
          assert.equal(automation.status, "active");
          assert.deepEqual(automation.schedule, {
            at: TEST_NOW,
            kind: "at",
          });
          return {
            currentTurnDeliveryIntentIds: [],
            nextWakeAt: null,
            progressed: false,
          };
        },
      );

      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          workspaceVersion: workspaceAfterCrash.version,
        },
      }), {
        async createCheckpointSnapshot() {
          return {
            snapshotRef: baseSnapshotRef,
          };
        },
        async importItem() {
          throw new Error("Restored one-shot wake should not need mailbox input.");
        },
        platform: createPlatform({
          artifactBytesByHash,
          events,
          mailboxPort: createMailboxPort({
            events,
            items: [],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests: restoredCheckpointRequests,
            events,
            workspace: workspaceAfterCrash,
          }),
          workspaceSnapshotPort: {
            async abortSnapshotSession() {
              throw new Error("One-shot restore test should not abort snapshots.");
            },
            async completeSnapshotSession() {
              throw new Error("One-shot restore test should not complete snapshots.");
            },
            async putSnapshotObjectDirect() {
              throw new Error("One-shot restore test should not upload snapshots.");
            },
            async restoreWorkspaceSnapshot(input) {
              await initializeVault({
                createdAt: TEST_NOW,
                vaultRoot: input.durableRoot,
              });
            },
            async startSnapshotSession() {
              throw new Error("One-shot restore test should not start snapshots.");
            },
          },
        }),
        vaultRoot: restoredVaultRoot,
      });

      assert.equal(automationPassCount, 2);
      assert.ok(
        restoredCheckpointRequests.some((request) =>
          request.reason === "idle_shutdown"
        ),
      );
    } finally {
      mocks.runAssistantAutomationPass.mockImplementation(originalAutomationPass);
      await removeTempRoot(firstVaultRoot);
      await removeTempRoot(restoredVaultRoot);
    }
  });

  test("receipts late pre-checkpoint mailbox canonical writes before the next foreground commit", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-base-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let assistantPhaseCalls = 0;
    let wakeTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceVaultRoot });
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [{ root: sourceVaultRoot, rootKey: "vault" }],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const baseRef = createBundleRef({
        hash: baseHash,
        key: "users/bundles/member-synthetic/canonical-pre-checkpoint-base.bundle.json",
        size: baseBundle.byteLength,
      });
      artifactBytesByHash.set(baseHash, baseBundle);
      const initialHotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        vaultRoot: sourceVaultRoot,
      });
      const initialHotHash = sha256HostedBundleHex(initialHotSnapshot.bundle);
      const initialHotRef = createBundleRef({
        hash: initialHotHash,
        key: "users/bundles/member-synthetic/canonical-pre-checkpoint-initial-hot.bundle.json",
        size: initialHotSnapshot.bundle.byteLength,
      });
      artifactBytesByHash.set(initialHotHash, initialHotSnapshot.bundle);
      const platform = createPlatform({
        artifactBytesByHash,
        events,
        mailboxPort: createMailboxPort({
          events,
          items: mailboxItems,
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({
            snapshotRef: buildHostedExecutionLayeredSnapshotRef({
              base: baseRef,
              hot: initialHotRef,
            }),
            version: "0",
          }),
        }),
      });

      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          idleCheckpointDelayMs: 200,
        },
      }), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}`);
          assert.equal(snapshotInput.reason, "idle_shutdown");
          const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({ vaultRoot });
          const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
          artifactBytesByHash.set(hotHash, hotSnapshot.bundle);
          return {
            snapshotRef: createBundleRef({
              hash: hotHash,
              key: "users/bundles/member-synthetic/canonical-pre-checkpoint-hot.bundle.json",
              size: hotSnapshot.bundle.byteLength,
            }),
          };
        },
        async importItem(item) {
          events.push(`mailbox.importItem:${item.item.id}`);
          await persistCanonicalInboxCapture({
            vaultRoot,
            captureId: "cap_workspace_pre_checkpoint_mailbox",
            eventId: "evt_01JQ8PWXP5A68SQM1W0GYM41V4",
            storedAt: TEST_NOW,
            input: {
              source: "telegram",
              externalId: item.item.id,
              accountId: "self",
              thread: {
                id: "thread-workspace-pre-checkpoint-mailbox",
                isDirect: true,
              },
              actor: {
                isSelf: false,
              },
              occurredAt: TEST_NOW,
              receivedAt: TEST_NOW,
              text: "late mailbox conversation",
              attachments: [],
              raw: {},
            },
          });
          return { status: "imported" };
        },
        platform,
        async runAssistantPhase(input) {
          assistantPhaseCalls += 1;
          const noteName = assistantPhaseCalls === 1 ? "first" : "second";
          await runCanonicalWrite({
            vaultRoot: input.restored.vaultRoot,
            operationType: "hosted_canonical_write_test",
            summary: `Persist ${noteName} hosted canonical write receipt.`,
            occurredAt: TEST_NOW,
            mutate: async ({ batch }) => {
              await batch.stageTextWrite(
                `journal/pre-checkpoint-${noteName}.md`,
                `${noteName} hosted note\n`,
              );
            },
          });
          if (assistantPhaseCalls === 1) {
            wakeTimer = setTimeout(() => {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_canonical_pre_checkpoint_002",
                laneSeq: "1",
              }));
              runtimeWakeSignal.notify();
            }, 10);
          }
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        runtimeWakeSignal,
        vaultRoot,
      });

      assert.equal(assistantPhaseCalls, 2);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_canonical_pre_checkpoint_002",
      ]);
      assert.deepEqual(events.filter((event) => event.startsWith("snapshot:")), [
        "snapshot:idle_shutdown",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "canonical_runtime_commit",
        "canonical_runtime_commit",
        "canonical_runtime_commit",
        "idle_shutdown",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "0",
        "1",
        "2",
        "3",
      ]);
      const receiptLogs = listHostedCanonicalWriteReceiptLogArtifacts(artifactBytesByHash);
      assert.equal(receiptLogs.length, 3);
      const receiptLogsBySha = new Map(receiptLogs.map((log) => [log.sha256, log]));
      const firstReceiptLog = receiptLogsBySha.get(
        String(checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256),
      );
      const mailboxReceiptLog = receiptLogsBySha.get(
        String(checkpointRequests[1]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256),
      );
      const finalReceiptLog = receiptLogsBySha.get(
        String(checkpointRequests[2]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256),
      );
      assert.equal(firstReceiptLog?.entries.length, 1);
      assert.equal(mailboxReceiptLog?.entries.length, 2);
      assert.equal(finalReceiptLog?.entries.length, 3);
      const mailboxReceiptRef = mailboxReceiptLog?.entries.at(-1);
      assert.ok(isPlainJsonObject(mailboxReceiptRef));
      assert.ok(typeof mailboxReceiptRef.sha256 === "string");
      const mailboxReceiptBytes = artifactBytesByHash.get(mailboxReceiptRef.sha256);
      assert.ok(mailboxReceiptBytes);
      const mailboxReceipt = parseJsonArtifact(mailboxReceiptBytes);
      assert.ok(isPlainJsonObject(mailboxReceipt));
      assert.equal(mailboxReceipt.operationType, "inbox_capture_persist");
      const finalReceiptRef = finalReceiptLog?.entries.at(-1);
      assert.ok(isPlainJsonObject(finalReceiptRef));
      assert.ok(typeof finalReceiptRef.sha256 === "string");
      const finalReceiptBytes = artifactBytesByHash.get(finalReceiptRef.sha256);
      assert.ok(finalReceiptBytes);
      const finalReceipt = parseJsonArtifact(finalReceiptBytes);
      assert.ok(isPlainJsonObject(finalReceipt));
      assert.equal(finalReceipt.operationType, "hosted_canonical_write_test");
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        undefined,
      );
      assert.equal(
        checkpointRequests[1]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "1",
      );
      assert.match(checkpointRequests[1]?.nextWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(checkpointRequests[1]?.nextWakeReason, "assistant");
      assert.equal(
        checkpointRequests[2]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        finalReceiptLog?.sha256,
      );
      assert.equal(
        checkpointRequests[2]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "1",
      );
      assert.equal(
        checkpointRequests[2]?.redactedStatus?.hostedCanonicalWriteReceiptLogEntryCount,
        undefined,
      );
      const checkpointRedactedStatus = checkpointRequests[3]?.redactedStatus ?? {};
      assert.equal(checkpointRedactedStatus.hostedCanonicalWriteReceiptLogEntryCount, undefined);
      assert.equal(checkpointRedactedStatus.hostedCanonicalWriteReceiptLogSha256, undefined);
      assert.equal(checkpointRedactedStatus.hostedCanonicalWriteReceiptLogByteSize, undefined);
      assert.equal(
        await readFile(path.join(vaultRoot, "journal", "pre-checkpoint-first.md"), "utf8"),
        "first hosted note\n",
      );
      assert.equal(
        await readFile(path.join(vaultRoot, "journal", "pre-checkpoint-second.md"), "utf8"),
        "second hosted note\n",
      );
      assert.equal(
        (
          await readFile(
            path.join(vaultRoot, "ledger", "inbox-captures", "2026", "2026-04.jsonl"),
            "utf8",
          )
        ).includes("cap_workspace_pre_checkpoint_mailbox"),
        true,
      );
    } finally {
      if (wakeTimer) {
        clearTimeout(wakeTimer);
      }
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceVaultRoot);
    }
  });

  test("does not roll back canonical writes when host aborts after receipt checkpoint acceptance", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const abortController = new AbortController();
    const abortReason = new Error(
      "Synthetic host abort after canonical receipt checkpoint acceptance.",
    );
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    let canonicalWriteCompleted = false;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const platform = createPlatform({
        artifactBytesByHash,
        events,
        mailboxPort: createMailboxPort({
          events,
          items: [],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          checkpointWorkspace(request) {
            const workspace = createWorkspaceState({
              inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
              nextWakeAt: request.nextWakeAt ?? null,
              nextWakeReason: request.nextWakeReason ?? null,
              redactedStatus: request.redactedStatus ?? null,
              snapshotRef: request.snapshotRef,
              version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
            });
            if (
              request.reason === "canonical_runtime_commit"
              && !abortController.signal.aborted
            ) {
              abortController.abort(abortReason);
            }
            return workspace;
          },
          events,
          workspace: createWorkspaceState({ version: "0" }),
        }),
      });

      let caught: unknown = null;
      try {
        await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
          request: {
            idleCheckpointDelayMs: 200,
          },
        }), {
          async createCheckpointSnapshot() {
            throw new Error("Canonical receipt abort regression should not need snapshots.");
          },
          async importItem() {
            return { status: "imported" };
          },
          platform,
          async runAssistantPhase(input) {
            await runCanonicalWrite({
              vaultRoot: input.restored.vaultRoot,
              operationType: "hosted_canonical_write_test",
              summary: "Persist canonical write despite post-checkpoint host abort.",
              occurredAt: TEST_NOW,
              mutate: async ({ batch }) => {
                await batch.stageTextWrite(
                  "journal/post-checkpoint-abort.md",
                  "canonical write survived abort\n",
                );
              },
            });
            canonicalWriteCompleted = true;
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          signal: abortController.signal,
          vaultRoot,
        });
      } catch (error) {
        caught = error;
      }

      assert.equal(
        canonicalWriteCompleted,
        true,
        JSON.stringify({
          caught: caught instanceof Error ? caught.stack ?? caught.message : String(caught),
          checkpointReasons: checkpointRequests.map((request) => request.reason),
          events,
        }, null, 2),
      );
      assert.equal(
        await readFile(path.join(vaultRoot, "journal", "post-checkpoint-abort.md"), "utf8"),
        "canonical write survived abort\n",
      );
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.reason, "canonical_runtime_commit");
      assert.equal(
        typeof checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        "string",
      );
      assert.equal(caught, abortReason);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not roll back canonical writes when host aborts during receipt artifact upload", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const abortController = new AbortController();
    const abortReason = new Error(
      "Synthetic host abort during canonical receipt artifact upload.",
    );
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    let canonicalWriteCompleted = false;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const platform = createPlatform({
        artifactBytesByHash,
        events,
        mailboxPort: createMailboxPort({
          events,
          items: [],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({ version: "0" }),
        }),
      });
      const putArtifact = platform.artifactStore.put;
      let artifactPutCount = 0;
      platform.artifactStore.put = async (artifact) => {
        const artifactPutOrdinal = ++artifactPutCount;
        await putArtifact(artifact);
        if (artifactPutOrdinal === 1 && !abortController.signal.aborted) {
          abortController.abort(abortReason);
        }
      };

      let caught: unknown = null;
      try {
        await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
          request: {
            idleCheckpointDelayMs: 200,
          },
        }), {
          async createCheckpointSnapshot() {
            throw new Error("Canonical receipt artifact abort regression should not need snapshots.");
          },
          async importItem() {
            return { status: "imported" };
          },
          platform,
          async runAssistantPhase(input) {
            await runCanonicalWrite({
              vaultRoot: input.restored.vaultRoot,
              operationType: "hosted_canonical_write_test",
              summary: "Persist canonical write despite receipt artifact upload abort.",
              occurredAt: TEST_NOW,
              mutate: async ({ batch }) => {
                await batch.stageTextWrite(
                  "journal/artifact-upload-abort.md",
                  "canonical write survived artifact abort\n",
                );
              },
            });
            canonicalWriteCompleted = true;
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          signal: abortController.signal,
          vaultRoot,
        });
      } catch (error) {
        caught = error;
      }

      assert.equal(
        canonicalWriteCompleted,
        true,
        JSON.stringify({
          caught: caught instanceof Error ? caught.stack ?? caught.message : String(caught),
          checkpointReasons: checkpointRequests.map((request) => request.reason),
          events,
        }, null, 2),
      );
      assert.equal(
        await readFile(path.join(vaultRoot, "journal", "artifact-upload-abort.md"), "utf8"),
        "canonical write survived artifact abort\n",
      );
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.reason, "canonical_runtime_commit");
      assert.equal(
        typeof checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        "string",
      );
      assert.equal(caught, abortReason);
      assert.equal(artifactPutCount >= 1, true);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("preserves host abort when receipt artifact upload fails after abort", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const abortController = new AbortController();
    const abortReason = new Error("Synthetic host abort during failed receipt upload.");
    const uploadFailure = new Error("Synthetic receipt artifact upload failure.");
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const platform = createPlatform({
        artifactBytesByHash,
        events,
        mailboxPort: createMailboxPort({
          events,
          items: [],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({ version: "0" }),
        }),
      });
      const putArtifact = platform.artifactStore.put;
      platform.artifactStore.put = async (artifact) => {
        await putArtifact(artifact);
        abortController.abort(abortReason);
        throw uploadFailure;
      };

      const outcome = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            idleCheckpointDelayMs: 200,
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Failed receipt upload regression should not need snapshots.");
          },
          async importItem() {
            return { status: "imported" };
          },
          platform,
          async runAssistantPhase(input) {
            await runCanonicalWrite({
              vaultRoot: input.restored.vaultRoot,
              operationType: "hosted_canonical_write_test",
              summary: "Fail a canonical receipt upload after host abort.",
              occurredAt: TEST_NOW,
              mutate: async ({ batch }) => {
                await batch.stageTextWrite(
                  "journal/failed-artifact-upload-abort.md",
                  "canonical write before failed receipt upload\n",
                );
              },
            });
            return { progressed: false };
          },
          signal: abortController.signal,
          vaultRoot,
        },
      ).catch((error: unknown) => error);

      assert.equal(outcome, abortReason);
      assert.equal(checkpointRequests.length, 0);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  });
