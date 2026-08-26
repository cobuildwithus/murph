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
  ensureHostedBootstrapMetadataForSystemMailboxTest,
  importRuntimeControlSystemMailboxItemForTest,
  readCapturedRuntimePhaseLogs,
  removeTempRoot,
  requireEventIndex,
  stageAssistantInputEventForMailboxItem,
  stagePendingLinqAssistantInputForMailboxItem,
  waitForFakeTimerScheduled,
  waitUntil,
  withRealTimeout,
  writeSyntheticAssistantAutoReplyTerminalEvidence,
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
  readAssistantInputEvent,
  shouldGroupAdjacentAssistantInputCandidates,
  updateAssistantInputAttachmentEvidence,
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
  writeAssistantAutoReplyReplyTerminalEvidence,
} from "@murphai/assistant-engine/assistant-automation";
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
import type {
  RuntimeWakeSignal,
} from "../src/hosted-runtime/runtime-wake.ts";
import {
  collectHostedPendingAssistantInputMediaRetentionProtections,
  compactHostedPendingAssistantInputIds,
  enqueueHostedPendingAssistantInputId,
  ensureHostedPendingAssistantInputIndex,
  inspectHostedPendingAssistantInputWakeCandidate,
  readHostedPendingAssistantInputIds,
} from "../src/hosted-runtime/pending-input-index.ts";
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
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";

describe("hosted runtime shutdown signal", () => {
  test("an already-signalled shutdown checkpoints immediately instead of waiting out the idle window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const shutdownController = new AbortController();

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_signal_pre",
            // Far longer than the test timeout: only the shutdown signal can
            // start the idle checkpoint this fast.
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            assert.equal(snapshotInput.idleCheckpointTrigger, "shutdown_signal");
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-signal-pre.bundle.json",
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
            shutdownController.abort(
              new DOMException("Synthetic container SIGTERM.", "AbortError"),
            );
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(checkpointRequests[0]?.inboxMediaRetentionWakeAt, null);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);

      const phaseLogs = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_shutdown_signal_pre",
        spy: consoleInfo,
      });
      expect(
        phaseLogs.find((entry) =>
          entry.details.runtimePhase === "workspace.checkpoint.idle_shutdown"
          && entry.details.runtimePhaseStatus === "start"
        )?.details,
      ).toEqual(expect.objectContaining({
        idleCheckpointTrigger: "shutdown_signal",
        runtimeWakePendingAtCheckpoint: false,
        shutdownSignalAbortedAtCheckpoint: true,
      }));
      expect(
        phaseLogs.find((entry) =>
          entry.details.runtimePhase === "workspace.checkpoint.idle_shutdown"
          && entry.details.runtimePhaseStatus === "done"
        )?.details,
      ).toEqual(expect.objectContaining({
        idleCheckpointTrigger: "shutdown_signal",
        runtimeWakePendingAtCheckpoint: false,
        shutdownSignalAbortedAtCheckpoint: true,
      }));
    } finally {
      if (previousStdIoLogSetting === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
      }
      consoleInfo.mockRestore();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("a same-key due continuation produced before shutdown requests one successor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(TEST_NOW));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const shutdownController = new AbortController();
    shutdownController.abort(new Error("Synthetic container SIGTERM."));

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_preserved_due_wake",
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-preserved-due-wake.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
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
            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: TEST_NOW,
              nextWakeReason: "assistant",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, TEST_NOW);
      assert.equal(result.nextWakeAt, TEST_NOW);
      assert.equal(result.immediateRecheckRequested, true);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("generated captures preserve the earliest exact retention wake through shutdown", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "murph-image-retention-wake-"),
    );
    const vaultRoot = path.join(workspaceRoot, "vault");
    const sourceImagePath = path.join(workspaceRoot, "generated-source.webp");
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const shutdownController = new AbortController();
    const capturesQueued = createDeferred<void>();
    const assistantRelease = createDeferred<void>();
    let assistantPhaseCalls = 0;
    let canonicalCheckpointCount = 0;
    let originInputId: string | null = null;
    const synchronousRecordedAt = "2026-04-27T02:00:00.000Z";
    const firstRecordedAt = "2026-04-27T01:00:00.000Z";
    const secondRecordedAt = TEST_NOW;
    const synchronousWakeAt = "2026-05-11T02:00:00.000Z";
    const firstWakeAt = "2026-05-11T01:00:00.000Z";
    const secondWakeAt = "2026-05-11T00:00:00.000Z";
    const mailboxItems = [createMailboxItem({
      id: "mailbox_item_generated_retention_wake_origin",
      laneSeq: "1",
    })];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await writeFile(sourceImagePath, "generated image bytes");
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [{ root: vaultRoot, rootKey: "vault" }],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      artifactBytesByHash.set(baseHash, baseBundle);
      const baseSnapshotRef = createBundleRef({
        hash: baseHash,
        key: `synthetic/generated-retention-wake/${baseHash}.bundle`,
        size: baseBundle.byteLength,
      });
      const persistCapture = async (input: {
        lookupKey: string;
        recordedAt: string;
        persistCanonicalWrite: <T>(
          write: () => Promise<T>,
          metadata: { retentionWakeAt: string },
        ) => Promise<T>;
        retentionWakeAt: string;
      }) => {
        await input.persistCanonicalWrite(
          () => addCaptureWithLookup({
            attachments: [{ role: "media_1", sourcePath: sourceImagePath }],
            draft: {
              note: "Assistant-generated image saved for later visual reuse.",
              occurredAt: input.recordedAt,
              recordedAt: input.recordedAt,
              source: "derived",
              tags: ["assistant-generated-image", "generated-image"],
              title: "Generated image",
            },
            lookupAttachmentRole: "media_1",
            lookupKey: input.lookupKey,
            rawImport: {
              importKind: "capture",
              importedAt: input.recordedAt,
              provenance: {
                family: "capture",
                generatedImage: { schema: "murph.generated-image.v1" },
                mediaCount: 1,
              },
              source: "murph.generate_image",
            },
            vaultRoot,
          }),
          { retentionWakeAt: input.retentionWakeAt },
        );
        return {
          media: null,
          runtimeIssue: null,
          savedImageRef: null,
        };
      };

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_generated_retention_wake_shutdown",
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            assert.equal(snapshotInput.idleCheckpointTrigger, "shutdown_signal");
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/generated-retention-wake.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            originInputId = await stagePendingLinqAssistantInputForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            mailboxItems.length = 0;
            return { assistantInputId: originInputId, status: "imported" };
          },
          platform: createPlatform({
            artifactBytesByHash,
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace(request) {
                if (
                  request.reason === "canonical_runtime_commit"
                  && request.inboxMediaRetentionWakeAt !== null
                ) {
                  canonicalCheckpointCount += 1;
                }
                const workspace = createWorkspaceState({
                  inboxMediaRetentionWakeAt:
                    request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
                return workspace;
              },
              events,
              workspace: createWorkspaceState({
                snapshotRef: baseSnapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls > 1) {
              return { progressed: false };
            }
            assert.ok(originInputId);
            const releaseProviderInputs =
              await input.beforeProviderAcceptedInputs?.({
                turnId: "turn_hosted_runtime_test",
                acceptedInputs: [{
                  id: originInputId,
                  source: "assistant-input",
                }],
              });
            await writeSyntheticAssistantAutoReplyTerminalEvidence({
              inputId: originInputId,
              vaultRoot,
            });
            assert.ok(input.persistGeneratedImageCapture);
            await persistCapture({
              lookupKey: "generated:retention-wake-synchronous-group",
              persistCanonicalWrite: input.persistGeneratedImageCapture,
              recordedAt: synchronousRecordedAt,
              retentionWakeAt: synchronousWakeAt,
            });
            assert.equal(input.imageGenerationLauncher?.launch({
              continuationSessionId: "asst_retention_wake",
              operationId: "image_operation_retention_wake_later",
              originAssistantInputId: originInputId,
              originAssistantInputIdExact: true,
              run: async (_signal, persistCanonicalWrite) =>
                await persistCapture({
                  lookupKey: "generated:retention-wake-later",
                  persistCanonicalWrite,
                  recordedAt: firstRecordedAt,
                  retentionWakeAt: firstWakeAt,
                }),
            }), "started");
            assert.equal(input.imageGenerationLauncher?.launch({
              continuationSessionId: "asst_retention_wake",
              operationId: "image_operation_retention_wake_earlier",
              originAssistantInputId: originInputId,
              originAssistantInputIdExact: true,
              run: async (_signal, persistCanonicalWrite) =>
                await persistCapture({
                  lookupKey: "generated:retention-wake-earlier",
                  persistCanonicalWrite,
                  recordedAt: secondRecordedAt,
                  retentionWakeAt: secondWakeAt,
                }),
            }), "started");
            await releaseProviderInputs?.();
            capturesQueued.resolve();
            await assistantRelease.promise;
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );
      await withRealTimeout(capturesQueued.promise, 5_000, () => JSON.stringify({
        assistantPhaseCalls,
        events,
      }, null, 2));
      shutdownController.abort(
        new DOMException("Synthetic container SIGTERM.", "AbortError"),
      );
      assistantRelease.resolve();
      await withRealTimeout(resultPromise, 10_000, () => JSON.stringify({
        canonicalCheckpointCount,
        checkpointRequests,
        events,
      }, null, 2));

      const canonicalWakes = checkpointRequests
        .filter((request) =>
          request.reason === "canonical_runtime_commit"
          && request.inboxMediaRetentionWakeAt !== null
        )
        .map((request) => request.inboxMediaRetentionWakeAt);
      assert.deepEqual(
        canonicalWakes,
        [synchronousWakeAt, firstWakeAt, secondWakeAt],
        JSON.stringify({ checkpointRequests, events }, null, 2),
      );
      const idleCheckpoint = checkpointRequests.at(-1);
      assert.equal(idleCheckpoint?.reason, "idle_shutdown");
      assert.equal(idleCheckpoint?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(idleCheckpoint?.inboxMediaRetentionWakeAt, secondWakeAt);
    } finally {
      assistantRelease.resolve();
      if (!shutdownController.signal.aborted) {
        shutdownController.abort(
          new DOMException("Synthetic test cleanup.", "AbortError"),
        );
      }
      await removeTempRoot(workspaceRoot);
    }
  }, 30_000);

  test("a shutdown-staged image failure wakes the next invocation exactly once", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "murph-image-shutdown-handoff-"));
    const firstVaultRoot = path.join(root, "first-vault");
    const secondVaultRoot = path.join(root, "second-vault");
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const firstCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const secondCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const firstAssistantMayFinish = createDeferred<void>();
    const providerStarted = createDeferred<void>();
    const shutdownController = new AbortController();
    let completionInputId: string | null = null;
    let imageProviderInvocationCount = 0;
    let firstAssistantPhaseCalls = 0;
    let secondAssistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: firstVaultRoot });
      const firstResultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_image_shutdown_handoff_first",
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            const bundle = await snapshotHostedBundleRoots({
              kind: "vault",
              roots: [{ root: firstVaultRoot, rootKey: "vault" }],
            });
            assert.ok(bundle);
            const hash = sha256HostedBundleHex(bundle);
            artifactBytesByHash.set(hash, bundle);
            return {
              snapshotRef: createBundleRef({
                hash,
                key: "users/bundles/member-synthetic/image-shutdown-handoff-first.bundle.json",
                size: bundle.byteLength,
              }),
            };
          },
          async importItem(item) {
            const assistantInputId =
              await stagePendingLinqAssistantInputForMailboxItem({
                item: item.item,
                threadId: "thread_image_shutdown_handoff",
                vaultRoot: firstVaultRoot,
              });
            return { assistantInputId, status: "imported" };
          },
          platform: createPlatform({
            artifactBytesByHash,
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({
                id: "mailbox_item_image_shutdown_handoff_origin",
                laneSeq: "1",
              })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests: firstCheckpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(phaseInput) {
            firstAssistantPhaseCalls += 1;
            assert.equal(firstAssistantPhaseCalls, 1);
            const assistantInputIds =
              phaseInput.initialAssistantInputBatch?.assistantInputIds
              ?? phaseInput.initialMailboxImport.importResult.assistantInputIds
              ?? [];
            assert.equal(assistantInputIds.length, 1);
            const originInputId = assistantInputIds[0]!;
            const releaseProviderInputs =
              await phaseInput.beforeProviderAcceptedInputs?.({
                turnId: "turn_hosted_runtime_test",
                acceptedInputs: [{
                  id: originInputId,
                  source: "assistant-input",
                }],
              });
            await writeSyntheticAssistantAutoReplyTerminalEvidence({
              inputId: originInputId,
              vaultRoot: firstVaultRoot,
            });
            assert.equal(
              phaseInput.imageGenerationLauncher?.launch({
                continuationSessionId: "asst_image_shutdown_handoff",
                operationId: "image_operation_shutdown_handoff",
                originAssistantInputId: originInputId,
                originAssistantInputIdExact: true,
                scopeId: "session_image_shutdown_handoff",
                async run(signal) {
                  imageProviderInvocationCount += 1;
                  providerStarted.resolve();
                  return await new Promise((_, reject) => {
                    if (signal.aborted) {
                      reject(signal.reason);
                      return;
                    }
                    signal.addEventListener(
                      "abort",
                      () => reject(signal.reason),
                      { once: true },
                    );
                  });
                },
              }),
              "started",
            );
            await releaseProviderInputs?.();
            await firstAssistantMayFinish.promise;
            return {
              checkpointReason: "assistant_runtime_commit" as const,
              foregroundReplyFailed: 0,
              nextWakeAt: null,
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot: firstVaultRoot,
        },
      );

      await withRealTimeout(providerStarted.promise, 5_000, () => events.join(","));
      shutdownController.abort(
        new DOMException("Synthetic container SIGTERM.", "AbortError"),
      );
      firstAssistantMayFinish.resolve();
      const firstResult = await withRealTimeout(
        firstResultPromise,
        15_000,
        () => events.join(","),
      );

      assert.equal(firstAssistantPhaseCalls, 1);
      assert.equal(firstCheckpointRequests.length, 1);
      assert.equal(firstCheckpointRequests[0]?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(firstCheckpointRequests[0]?.nextWakeReason, "assistant");
      assert.ok(firstCheckpointRequests[0]?.nextWakeAt);
      assert.equal(firstResult.nextWakeReason, "assistant");
      assert.equal(firstResult.nextWakeAt, firstCheckpointRequests[0]?.nextWakeAt);
      const pendingAfterShutdown = await compactHostedPendingAssistantInputIds({
        vaultRoot: firstVaultRoot,
      });
      assert.equal(pendingAfterShutdown.length, 1);
      completionInputId = pendingAfterShutdown[0]!;
      const completion = await readAssistantInputEvent({
        inputId: completionInputId,
        vault: firstVaultRoot,
      });
      assert.equal(completion?.conversation?.threadId, "thread_image_shutdown_handoff");
      assert.equal(
        completion?.sourceRef.kind === "hosted-mailbox"
          ? completion.sourceRef.payloadSchema
          : null,
        "murph.hosted-image-completion.v1",
      );

      const secondWorkspace = createWorkspaceState({
        nextWakeAt: firstCheckpointRequests[0]?.nextWakeAt ?? null,
        nextWakeReason: "assistant",
        snapshotRef: firstCheckpointRequests[0]?.snapshotRef ?? null,
        version: "1",
      });
      const secondResult = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_image_shutdown_handoff_second",
              idleCheckpointDelayMs: 1,
              leaseGeneration: "8",
              userId: TEST_USER_ID,
              workspaceVersion: secondWorkspace.version,
            },
          }),
          {
            async createCheckpointSnapshot() {
              const bundle = await snapshotHostedBundleRoots({
                kind: "vault",
                roots: [{ root: secondVaultRoot, rootKey: "vault" }],
              });
              assert.ok(bundle);
              const hash = sha256HostedBundleHex(bundle);
              artifactBytesByHash.set(hash, bundle);
              return {
                snapshotRef: createBundleRef({
                  hash,
                  key: "users/bundles/member-synthetic/image-shutdown-handoff-second.bundle.json",
                  size: bundle.byteLength,
                }),
              };
            },
            async importItem() {
              throw new Error("The restart handoff must not require a new mailbox item.");
            },
            platform: createPlatform({
              artifactBytesByHash,
              mailboxPort: createMailboxPort({ events, items: [] }),
              workspacePort: createWorkspacePort({
                checkpointRequests: secondCheckpointRequests,
                events,
                workspace: secondWorkspace,
              }),
            }),
            async runAssistantPhase(phaseInput) {
              secondAssistantPhaseCalls += 1;
              assert.equal(secondAssistantPhaseCalls, 1);
              const assistantInputIds =
                phaseInput.initialAssistantInputBatch?.assistantInputIds
                ?? phaseInput.initialMailboxImport.importResult.assistantInputIds
                ?? [];
              assert.deepEqual(assistantInputIds, []);
              assert.ok(completionInputId);
              assert.ok(await readAssistantInputEvent({
                inputId: completionInputId,
                vault: secondVaultRoot,
              }));
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: completionInputId,
                vaultRoot: secondVaultRoot,
              });
              return {
                checkpointReason: "assistant_runtime_commit" as const,
                foregroundReplyFailed: 0,
                nextWakeAt: null,
                progressed: true,
              };
            },
            vaultRoot: secondVaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(secondAssistantPhaseCalls, 1);
      assert.equal(secondResult.nextWakeReason, "inbox_media_retention");
      assert.equal(imageProviderInvocationCount, 1);
      assert.deepEqual(
        await compactHostedPendingAssistantInputIds({ vaultRoot: secondVaultRoot }),
        [],
      );
    } finally {
      firstAssistantMayFinish.resolve();
      if (!shutdownController.signal.aborted) {
        shutdownController.abort(
          new DOMException("Synthetic test cleanup.", "AbortError"),
        );
      }
      await removeTempRoot(root);
    }
  }, 30_000);

  test("a pending runtime wake after shutdown does not interrupt the idle shutdown checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_pending_runtime_wake",
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-pending-runtime-wake.bundle.json",
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
            if (assistantPhaseCalls === 1) {
              shutdownController.abort(
                new DOMException("Synthetic container SIGTERM.", "AbortError"),
              );
              runtimeWakeSignal.notify(1_777_000_000_075);
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }

            throw new Error("Runtime wake should not run a foreground pass after shutdown starts.");
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("a pre-shutdown no-work runtime wake commits once when shutdown arrives", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
    const firstDirtyWaitStarted = createDeferred<void>();
    const retainedDirtyWaitStarted = createDeferred<void>();
    const shutdownController = new AbortController();
    let activeDirtyWake: ((notification: { notifiedAtEpochMs: number }) => void) | null = null;
    let assistantPhaseFinished = false;
    let assistantPhaseCalls = 0;
    let dirtyWaitCount = 0;
    const runtimeWakeSignal: RuntimeWakeSignal = {
      consumePending() {
        return null;
      },
      notify(input) {
        const notifiedAtEpochMs =
          typeof input === "number" ? input : input?.notifiedAtEpochMs ?? Date.now();
        activeDirtyWake?.({ notifiedAtEpochMs });
      },
      wait(signal) {
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("Runtime wake wait was aborted.", "AbortError"),
          );
        }
        return new Promise((resolve, reject) => {
          const resolveCurrent = (notification: { notifiedAtEpochMs: number }) => {
            cleanup();
            resolve(notification);
          };
          const abort = () => {
            cleanup();
            reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new DOMException("Runtime wake wait was aborted.", "AbortError"),
            );
          };
          const cleanup = () => {
            signal?.removeEventListener("abort", abort);
            if (activeDirtyWake === resolveCurrent) {
              activeDirtyWake = null;
            }
          };
          if (assistantPhaseFinished) {
            dirtyWaitCount += 1;
            activeDirtyWake = resolveCurrent;
            if (dirtyWaitCount === 1) {
              firstDirtyWaitStarted.resolve();
            } else if (dirtyWaitCount === 2) {
              retainedDirtyWaitStarted.resolve();
            }
          }
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_stale_runtime_wake",
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            assert.equal(snapshotInput.idleCheckpointTrigger, "shutdown_signal");
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-stale-runtime-wake.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return {
              assistantInputId: "assistant_input_shutdown_stale_runtime_wake",
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
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
            if (assistantPhaseCalls > 1) {
              throw new Error(
                "Stale pre-shutdown runtime wake should not run after shutdown checkpointing.",
              );
            }
            assistantPhaseFinished = true;
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        firstDirtyWaitStarted.promise,
        1_000,
        () => "Dirty checkpoint wait did not arm.",
      );
      runtimeWakeSignal.notify(1_777_000_000_095);
      await withRealTimeout(
        retainedDirtyWaitStarted.promise,
        1_000,
        () => "Dirty checkpoint wait did not retain the no-work wake.",
      );
      assert.equal(checkpointRequests.length, 0);
      shutdownController.abort(
        new DOMException("Synthetic container SIGTERM.", "AbortError"),
      );

      const result = await resultPromise;

      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        [],
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(checkpointRequests[0]?.runtimeWakePendingAtCheckpoint, true);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(result.status, "idle");
      const phaseLogs = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_shutdown_stale_runtime_wake",
        spy: consoleInfo,
      });
      expect(
        phaseLogs.find((entry) =>
          entry.details.runtimePhase === "workspace.checkpoint.idle_shutdown"
          && entry.details.runtimePhaseStatus === "start"
      )?.details,
      ).toEqual(expect.objectContaining({
        idleCheckpointTrigger: "shutdown_signal",
        runtimeWakePendingAtCheckpoint: true,
        shutdownSignalAbortedAtCheckpoint: true,
      }));
    } finally {
      if (previousStdIoLogSetting === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
      }
      consoleInfo.mockRestore();
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown after an idle-window checkpoint does not resnapshot a retained runtime wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
    const firstDirtyWaitStarted = createDeferred<void>();
    const retainedDirtyWaitStarted = createDeferred<void>();
    const shutdownController = new AbortController();
    let activeDirtyWake: ((notification: { notifiedAtEpochMs: number }) => void) | null = null;
    let assistantPhaseFinished = false;
    let assistantPhaseCalls = 0;
    let dirtyWaitCount = 0;
    const checkpointSnapshotTriggers: Array<
      HostedWorkspaceCheckpointRequest["idleCheckpointTrigger"]
    > = [];
    const runtimeWakeSignal: RuntimeWakeSignal = {
      consumePending() {
        return null;
      },
      notify(input) {
        const notifiedAtEpochMs =
          typeof input === "number" ? input : input?.notifiedAtEpochMs ?? Date.now();
        activeDirtyWake?.({ notifiedAtEpochMs });
      },
      wait(signal) {
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("Runtime wake wait was aborted.", "AbortError"),
          );
        }
        return new Promise((resolve, reject) => {
          const resolveCurrent = (notification: { notifiedAtEpochMs: number }) => {
            cleanup();
            resolve(notification);
          };
          const abort = () => {
            cleanup();
            reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new DOMException("Runtime wake wait was aborted.", "AbortError"),
            );
          };
          const cleanup = () => {
            signal?.removeEventListener("abort", abort);
            if (activeDirtyWake === resolveCurrent) {
              activeDirtyWake = null;
            }
          };
          if (assistantPhaseFinished) {
            dirtyWaitCount += 1;
            activeDirtyWake = resolveCurrent;
            if (dirtyWaitCount === 1) {
              firstDirtyWaitStarted.resolve();
            } else if (dirtyWaitCount === 2) {
              retainedDirtyWaitStarted.resolve();
            }
          }
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_after_idle_window_trigger",
            idleCheckpointDelayMs: 50,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            checkpointSnapshotTriggers.push(snapshotInput.idleCheckpointTrigger);
            if (snapshotInput.runtimeWakePendingAtCheckpoint) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_shutdown_after_idle_window_trigger",
                laneSeq: "1",
              }));
              shutdownController.abort(
                new DOMException("Synthetic container SIGTERM.", "AbortError"),
              );
            }
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-after-idle-window-trigger.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return {
              assistantInputId: "assistant_input_shutdown_after_idle_window_trigger",
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
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
            if (assistantPhaseCalls > 1) {
              throw new Error(
                "Retained runtime wake should not run after shutdown starts.",
              );
            }
            assistantPhaseFinished = true;
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        firstDirtyWaitStarted.promise,
        1_000,
        () => "Dirty checkpoint wait did not arm.",
      );
      runtimeWakeSignal.notify(1_777_000_000_105);
      await withRealTimeout(
        retainedDirtyWaitStarted.promise,
        1_000,
        () => "Dirty checkpoint wait did not retain the no-work wake.",
      );
      const result = await resultPromise;

      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        [],
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(checkpointRequests[0]?.runtimeWakePendingAtCheckpoint, true);
      assert.equal(checkpointRequests.length, 1);
      assert.deepEqual(checkpointSnapshotTriggers, ["idle_window"]);
      assert.equal(result.status, "idle");
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown while consuming a retained post-checkpoint wake does not resnapshot it", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
    const shutdownController = new AbortController();
    let assistantPhaseCalls = 0;
    let checkpointSnapshotCreated = false;
    let postCheckpointWakeConsumed = false;
    const checkpointSnapshotTriggers: Array<
      HostedWorkspaceCheckpointRequest["idleCheckpointTrigger"]
    > = [];
    const runtimeWakeSignal: RuntimeWakeSignal = {
      consumePending() {
        if (checkpointSnapshotCreated && !postCheckpointWakeConsumed) {
          postCheckpointWakeConsumed = true;
          mailboxItems.push(createMailboxItem({
            id: "mailbox_item_shutdown_during_post_checkpoint_wake",
            laneSeq: "1",
          }));
          shutdownController.abort(
            new DOMException("Synthetic container SIGTERM.", "AbortError"),
          );
          return { notifiedAtEpochMs: 1_777_000_000_105 };
        }
        return null;
      },
      notify() {},
      wait(signal) {
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("Runtime wake wait was aborted.", "AbortError"),
          );
        }
        return new Promise((_resolve, reject) => {
          const abort = () => {
            signal?.removeEventListener("abort", abort);
            reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new DOMException("Runtime wake wait was aborted.", "AbortError"),
            );
          };
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_during_post_checkpoint_wake",
            idleCheckpointDelayMs: 50,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            checkpointSnapshotTriggers.push(snapshotInput.idleCheckpointTrigger);
            checkpointSnapshotCreated = true;
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-during-post-checkpoint-wake.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return {
              assistantInputId: "assistant_input_shutdown_during_post_checkpoint_wake",
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
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
            if (assistantPhaseCalls > 1) {
              throw new Error(
                "Retained runtime wake should not run after shutdown starts.",
              );
            }
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(postCheckpointWakeConsumed, true);
      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        [],
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(checkpointRequests.length, 1);
      assert.deepEqual(checkpointSnapshotTriggers, ["idle_window"]);
      assert.equal(result.status, "idle");
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown after a no-work post-checkpoint fetch schedules replacement without resnapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
    const shutdownController = new AbortController();
    let assistantPhaseCalls = 0;
    let checkpointSnapshotCreated = false;
    let postCheckpointWakeConsumed = false;
    let shutdownAfterConversationFetch = false;
    const checkpointSnapshotTriggers: Array<
      HostedWorkspaceCheckpointRequest["idleCheckpointTrigger"]
    > = [];
    const runtimeWakeSignal: RuntimeWakeSignal = {
      consumePending() {
        if (checkpointSnapshotCreated && !postCheckpointWakeConsumed) {
          postCheckpointWakeConsumed = true;
          mailboxItems.push(createMailboxItem({
            id: "mailbox_item_shutdown_after_no_work_conversation",
            kind: "member.activated",
            lane: "system",
            laneSeq: "1",
          }));
          return { notifiedAtEpochMs: 1_777_000_000_135 };
        }
        return null;
      },
      notify() {},
      wait(signal) {
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("Runtime wake wait was aborted.", "AbortError"),
          );
        }
        return new Promise((_resolve, reject) => {
          const abort = () => {
            signal?.removeEventListener("abort", abort);
            reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new DOMException("Runtime wake wait was aborted.", "AbortError"),
            );
          };
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const mailboxPort = createMailboxPort({
        events,
        items: mailboxItems,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_after_no_work_conversation",
            idleCheckpointDelayMs: 50,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            checkpointSnapshotTriggers.push(snapshotInput.idleCheckpointTrigger);
            checkpointSnapshotCreated = true;
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-after-no-work-conversation.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return {
              assistantInputId: "assistant_input_shutdown_after_no_work_conversation",
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: {
              ...mailboxPort,
              async fetch(request) {
                const lanes = request.lanes.map((lane) => lane.lane).join(",");
                events.push(`mailbox.fetch.lanes:${lanes}`);
                const response = await mailboxPort.fetch(request);
                if (
                  checkpointSnapshotCreated
                  && !shutdownAfterConversationFetch
                  && request.lanes.some((lane) => lane.lane === "conversation")
                ) {
                  shutdownAfterConversationFetch = true;
                  shutdownController.abort(
                    new DOMException("Synthetic container SIGTERM.", "AbortError"),
                  );
                }
                return response;
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls > 1) {
              throw new Error(
                "Consumed runtime wake should be handed to the replacement runtime.",
              );
            }
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(postCheckpointWakeConsumed, true);
      assert.equal(shutdownAfterConversationFetch, true);
      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        [],
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(checkpointRequests.length, 1);
      assert.deepEqual(checkpointSnapshotTriggers, ["idle_window"]);
      assert.equal(result.status, "scheduled");
      assert.match(result.nextWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(result.nextWakeReason, "mailbox");
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown after a retained system import preserves its wake and effects", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    let assistantPhaseCalls = 0;
    let postCheckpointEffectCalls = 0;
    let postCheckpointWakeQueued = false;
    const checkpointSnapshotTriggers: Array<
      HostedWorkspaceCheckpointRequest["idleCheckpointTrigger"]
    > = [];
    const systemItem = createMailboxItem({
      id: "mailbox_item_shutdown_after_system_import",
      kind: "runtime.manual-requested",
      lane: "system",
      laneSeq: "1",
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_after_system_import",
            idleCheckpointDelayMs: 50,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            checkpointSnapshotTriggers.push(snapshotInput.idleCheckpointTrigger);
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-after-system-import.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            const outcome = await importRuntimeControlSystemMailboxItemForTest({
              item: item.item,
              vaultRoot,
            });
            shutdownController.abort(
              new DOMException("Synthetic container SIGTERM.", "AbortError"),
            );
            return {
              ...outcome,
              afterCheckpoint: async () => {
                postCheckpointEffectCalls += 1;
                return {
                  attachmentEvidenceUpdated: null,
                  kind: "meal_photo_cleanup" as const,
                  projectionUpdated: null,
                  reasonCode: null,
                  status: "succeeded" as const,
                };
              },
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: mailboxItems }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace: (request) => {
                if (request.reason === "idle_shutdown" && !postCheckpointWakeQueued) {
                  postCheckpointWakeQueued = true;
                  mailboxItems.push(systemItem);
                  runtimeWakeSignal.notify();
                }
                return createWorkspaceState({
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
              },
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls > 1) {
              throw new Error("Retained system work should be handed to the replacement runtime.");
            }
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(postCheckpointWakeQueued, true);
      assert.equal(assistantPhaseCalls, 1);
      assert.equal(postCheckpointEffectCalls, 1);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        ["mailbox.importItem:mailbox_item_shutdown_after_system_import"],
      );
      const systemMailbox = await readHostedSystemMailboxState(vaultRoot);
      assert.equal(
        systemMailbox.pending.some((item) => item.itemId === systemItem.id),
        true,
      );
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemImportedSeq,
        "1",
      );
      const pendingAssistantWakeAt = checkpointRequests.at(-1)?.nextWakeAt;
      assert.match(pendingAssistantWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.deepEqual(checkpointSnapshotTriggers, ["idle_window", "shutdown_signal"]);
      assert.equal(result.nextWakeAt, pendingAssistantWakeAt);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.status, "scheduled");
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown after a consumed post-checkpoint replay fetch leaves the row to replacement", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
    const shutdownController = new AbortController();
    let assistantPhaseCalls = 0;
    let checkpointSnapshotCreated = false;
    let postCheckpointWakeConsumed = false;
    let shutdownAfterConversationFetch = false;
    const checkpointSnapshotTriggers: Array<
      HostedWorkspaceCheckpointRequest["idleCheckpointTrigger"]
    > = [];
    const runtimeWakeSignal: RuntimeWakeSignal = {
      consumePending() {
        if (checkpointSnapshotCreated && !postCheckpointWakeConsumed) {
          postCheckpointWakeConsumed = true;
          mailboxItems.push(createMailboxItem({
            consumedAt: TEST_NOW,
            id: "mailbox_item_shutdown_after_consumed_replay",
            laneSeq: "1",
          }));
          mailboxItems.push(createMailboxItem({
            id: "mailbox_item_shutdown_after_consumed_replay_system",
            kind: "member.activated",
            lane: "system",
            laneSeq: "1",
          }));
          return { notifiedAtEpochMs: 1_777_000_000_145 };
        }
        return null;
      },
      notify() {},
      wait(signal) {
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("Runtime wake wait was aborted.", "AbortError"),
          );
        }
        return new Promise((_resolve, reject) => {
          const abort = () => {
            signal?.removeEventListener("abort", abort);
            reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new DOMException("Runtime wake wait was aborted.", "AbortError"),
            );
          };
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const mailboxPort = createMailboxPort({
        events,
        items: mailboxItems,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_after_consumed_replay",
            idleCheckpointDelayMs: 50,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            checkpointSnapshotTriggers.push(snapshotInput.idleCheckpointTrigger);
            checkpointSnapshotCreated = true;
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-after-consumed-replay.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            assert.equal(item.durablyConsumed, true);
            return {
              assistantInputId: "assistant_input_shutdown_after_consumed_replay",
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: {
              ...mailboxPort,
              async fetch(request) {
                const lanes = request.lanes.map((lane) => lane.lane).join(",");
                events.push(`mailbox.fetch.lanes:${lanes}`);
                const response = await mailboxPort.fetch(request);
                if (
                  checkpointSnapshotCreated
                  && !shutdownAfterConversationFetch
                  && request.lanes.some((lane) => lane.lane === "conversation")
                ) {
                  shutdownAfterConversationFetch = true;
                  shutdownController.abort(
                    new DOMException("Synthetic container SIGTERM.", "AbortError"),
                  );
                }
                return response;
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls > 1) {
              throw new Error(
                "Consumed replay wake should be handed to the replacement runtime.",
              );
            }
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(postCheckpointWakeConsumed, true);
      assert.equal(shutdownAfterConversationFetch, true);
      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        [],
      );
      assert.equal(
        events.includes("mailbox.importItem:mailbox_item_shutdown_after_consumed_replay_system"),
        false,
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(checkpointRequests.length, 1);
      assert.deepEqual(checkpointSnapshotTriggers, ["idle_window"]);
      assert.equal(result.status, "scheduled");
      assert.match(result.nextWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(result.nextWakeReason, "mailbox");

      const mailboxStateBeforeReplacement = await readHostedMailboxImportState({
        vaultRoot,
      });
      assert.equal(mailboxStateBeforeReplacement.watermarks.conversation, "0");
      assert.equal(mailboxStateBeforeReplacement.watermarks.system, "0");
      await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);

      const replacementCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const replacementImportedIds: string[] = [];
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_after_consumed_replay_replacement",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "8",
            userId: TEST_USER_ID,
            workspaceVersion: "1",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key:
                  "users/bundles/member-synthetic/shutdown-after-consumed-replay-replacement.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            replacementImportedIds.push(item.item.id);
            if (item.item.id === "mailbox_item_shutdown_after_consumed_replay") {
              assert.equal(item.durablyConsumed, true);
            }
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems.filter((item) => item.lane === "conversation"),
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests: replacementCheckpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: result.nextWakeAt ?? null,
                nextWakeReason: result.nextWakeReason ?? null,
                version: "1",
              }),
            }),
          }),
          async runAssistantPhase() {
            return {
              nextWakeAt: null,
              progressed: false,
              redactedStatus: { hostedAssistantProgressed: false },
            };
          },
          vaultRoot,
        },
      );
      assert.ok(
        replacementImportedIds.includes(
          "mailbox_item_shutdown_after_consumed_replay",
        ),
        events.join(","),
      );
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown after importing a retained post-checkpoint wake schedules its staged assistant input", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
    const shutdownController = new AbortController();
    let assistantPhaseCalls = 0;
    let checkpointSnapshotCreated = false;
    let postCheckpointWakeConsumed = false;
    const checkpointSnapshotTriggers: Array<
      HostedWorkspaceCheckpointRequest["idleCheckpointTrigger"]
    > = [];
    const runtimeWakeSignal: RuntimeWakeSignal = {
      consumePending() {
        if (checkpointSnapshotCreated && !postCheckpointWakeConsumed) {
          postCheckpointWakeConsumed = true;
          mailboxItems.push(createMailboxItem({
            id: "mailbox_item_shutdown_after_post_checkpoint_import",
            laneSeq: "1",
          }));
          return { notifiedAtEpochMs: 1_777_000_000_105 };
        }
        return null;
      },
      notify() {},
      wait(signal) {
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("Runtime wake wait was aborted.", "AbortError"),
          );
        }
        return new Promise((_resolve, reject) => {
          const abort = () => {
            signal?.removeEventListener("abort", abort);
            reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new DOMException("Runtime wake wait was aborted.", "AbortError"),
            );
          };
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_after_post_checkpoint_import",
            idleCheckpointDelayMs: 50,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            checkpointSnapshotTriggers.push(snapshotInput.idleCheckpointTrigger);
            checkpointSnapshotCreated = true;
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-after-post-checkpoint-import.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            shutdownController.abort(
              new DOMException("Synthetic container SIGTERM.", "AbortError"),
            );
            return {
              assistantInputId: "assistant_input_shutdown_after_post_checkpoint_import",
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
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
            if (assistantPhaseCalls > 1) {
              throw new Error(
                "Retained runtime wake should be handed to the replacement runtime.",
              );
            }
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(postCheckpointWakeConsumed, true);
      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        ["mailbox.importItem:mailbox_item_shutdown_after_post_checkpoint_import"],
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(checkpointRequests[1]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[1]?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(
        checkpointRequests[1]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "1",
      );
      const pendingAssistantWakeAt = checkpointRequests[1]?.nextWakeAt;
      assert.match(pendingAssistantWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(checkpointRequests[1]?.nextWakeReason, "assistant");
      assert.deepEqual(checkpointSnapshotTriggers, [
        "idle_window",
        "shutdown_signal",
      ]);
      assert.equal(result.nextWakeAt, pendingAssistantWakeAt);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.status, "scheduled");
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown after importing a retained pre-checkpoint wake schedules its staged assistant input", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
    const firstDirtyWaitStarted = createDeferred<void>();
    const retainedDirtyWaitStarted = createDeferred<void>();
    const shutdownController = new AbortController();
    let activeDirtyWake: ((notification: { notifiedAtEpochMs: number }) => void) | null = null;
    let assistantPhaseFinished = false;
    let assistantPhaseCalls = 0;
    let dirtyWaitCount = 0;
    const checkpointSnapshotTriggers: Array<
      HostedWorkspaceCheckpointRequest["idleCheckpointTrigger"]
    > = [];
    const runtimeWakeSignal: RuntimeWakeSignal = {
      consumePending() {
        return null;
      },
      notify(input) {
        const notifiedAtEpochMs =
          typeof input === "number" ? input : input?.notifiedAtEpochMs ?? Date.now();
        activeDirtyWake?.({ notifiedAtEpochMs });
      },
      wait(signal) {
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("Runtime wake wait was aborted.", "AbortError"),
          );
        }
        return new Promise((resolve, reject) => {
          const resolveCurrent = (notification: { notifiedAtEpochMs: number }) => {
            cleanup();
            resolve(notification);
          };
          const abort = () => {
            cleanup();
            reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new DOMException("Runtime wake wait was aborted.", "AbortError"),
            );
          };
          const cleanup = () => {
            signal?.removeEventListener("abort", abort);
            if (activeDirtyWake === resolveCurrent) {
              activeDirtyWake = null;
            }
          };
          if (assistantPhaseFinished) {
            dirtyWaitCount += 1;
            activeDirtyWake = resolveCurrent;
            if (dirtyWaitCount === 1) {
              firstDirtyWaitStarted.resolve();
            } else if (dirtyWaitCount === 2) {
              retainedDirtyWaitStarted.resolve();
            }
          }
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_after_pre_checkpoint_import",
            idleCheckpointDelayMs: 50,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            checkpointSnapshotTriggers.push(snapshotInput.idleCheckpointTrigger);
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-after-pre-checkpoint-import.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            shutdownController.abort(
              new DOMException("Synthetic container SIGTERM.", "AbortError"),
            );
            return {
              assistantInputId: "assistant_input_shutdown_after_pre_checkpoint_import",
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
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
            if (assistantPhaseCalls > 1) {
              throw new Error(
                "Retained runtime wake should be handed to the replacement runtime.",
              );
            }
            assistantPhaseFinished = true;
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        firstDirtyWaitStarted.promise,
        1_000,
        () => "Dirty checkpoint wait did not arm.",
      );
      runtimeWakeSignal.notify(1_777_000_000_115);
      await withRealTimeout(
        retainedDirtyWaitStarted.promise,
        1_000,
        () => "Dirty checkpoint wait did not retain the no-work wake.",
      );
      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_shutdown_after_pre_checkpoint_import",
        laneSeq: "1",
      }));

      const result = await resultPromise;

      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        ["mailbox.importItem:mailbox_item_shutdown_after_pre_checkpoint_import"],
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(checkpointRequests[0]?.runtimeWakePendingAtCheckpoint, true);
      assert.equal(checkpointRequests[1]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[1]?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(
        checkpointRequests[1]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "1",
      );
      const pendingAssistantWakeAt = checkpointRequests[1]?.nextWakeAt;
      assert.match(pendingAssistantWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(checkpointRequests[1]?.nextWakeReason, "assistant");
      assert.deepEqual(checkpointSnapshotTriggers, [
        "idle_window",
        "shutdown_signal",
      ]);
      assert.equal(result.nextWakeAt, pendingAssistantWakeAt);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.status, "scheduled");
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown during a retained pre-checkpoint foreground pass schedules its staged assistant input", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
    const firstDirtyWaitStarted = createDeferred<void>();
    const retainedDirtyWaitStarted = createDeferred<void>();
    const shutdownController = new AbortController();
    let activeDirtyWake: ((notification: { notifiedAtEpochMs: number }) => void) | null = null;
    let assistantPhaseFinished = false;
    let assistantPhaseCalls = 0;
    let dirtyWaitCount = 0;
    const checkpointSnapshotTriggers: Array<
      HostedWorkspaceCheckpointRequest["idleCheckpointTrigger"]
    > = [];
    const runtimeWakeSignal: RuntimeWakeSignal = {
      consumePending() {
        return null;
      },
      notify(input) {
        const notifiedAtEpochMs =
          typeof input === "number" ? input : input?.notifiedAtEpochMs ?? Date.now();
        activeDirtyWake?.({ notifiedAtEpochMs });
      },
      wait(signal) {
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("Runtime wake wait was aborted.", "AbortError"),
          );
        }
        return new Promise((resolve, reject) => {
          const resolveCurrent = (notification: { notifiedAtEpochMs: number }) => {
            cleanup();
            resolve(notification);
          };
          const abort = () => {
            cleanup();
            reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new DOMException("Runtime wake wait was aborted.", "AbortError"),
            );
          };
          const cleanup = () => {
            signal?.removeEventListener("abort", abort);
            if (activeDirtyWake === resolveCurrent) {
              activeDirtyWake = null;
            }
          };
          if (assistantPhaseFinished) {
            dirtyWaitCount += 1;
            activeDirtyWake = resolveCurrent;
            if (dirtyWaitCount === 1) {
              firstDirtyWaitStarted.resolve();
            } else if (dirtyWaitCount === 2) {
              retainedDirtyWaitStarted.resolve();
            }
          }
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_during_pre_checkpoint_pass",
            idleCheckpointDelayMs: 50,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            checkpointSnapshotTriggers.push(snapshotInput.idleCheckpointTrigger);
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-during-pre-checkpoint-pass.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return {
              assistantInputId: await stageAssistantInputEventForMailboxItem({
                item: item.item,
                vaultRoot,
              }),
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls === 1) {
              assistantPhaseFinished = true;
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }
            shutdownController.abort(
              new DOMException("Synthetic container SIGTERM.", "AbortError"),
            );
            throw input.signal?.reason instanceof Error
              ? input.signal.reason
              : new DOMException("Synthetic container SIGTERM.", "AbortError");
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        firstDirtyWaitStarted.promise,
        1_000,
        () => "Dirty checkpoint wait did not arm.",
      );
      runtimeWakeSignal.notify(1_777_000_000_125);
      await withRealTimeout(
        retainedDirtyWaitStarted.promise,
        1_000,
        () => "Dirty checkpoint wait did not retain the no-work wake.",
      );
      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_shutdown_during_pre_checkpoint_pass",
        laneSeq: "1",
      }));

      const result = await resultPromise;

      assert.equal(assistantPhaseCalls, 2);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        ["mailbox.importItem:mailbox_item_shutdown_during_pre_checkpoint_pass"],
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(checkpointRequests[0]?.runtimeWakePendingAtCheckpoint, true);
      assert.equal(checkpointRequests[1]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[1]?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(
        checkpointRequests[1]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "1",
      );
      const pendingAssistantWakeAt = checkpointRequests[1]?.nextWakeAt;
      assert.match(pendingAssistantWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(checkpointRequests[1]?.nextWakeReason, "assistant");
      assert.deepEqual(checkpointSnapshotTriggers, [
        "idle_window",
        "shutdown_signal",
      ]);
      assert.equal(result.nextWakeAt, pendingAssistantWakeAt);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.status, "scheduled");
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown after projecting a due assistant wake checkpoints instead of servicing it", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const shutdownController = new AbortController();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_due_assistant_handoff",
            idleCheckpointDelayMs: 50,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            assert.equal(snapshotInput.idleCheckpointTrigger, "shutdown_signal");
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-due-assistant-handoff.bundle.json",
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
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls > 1) {
              throw new Error("Due assistant wake should be handed to the replacement runtime.");
            }
            shutdownController.abort(
              new DOMException("Synthetic container SIGTERM.", "AbortError"),
            );
            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: TEST_NOW,
              nextWakeReason: "assistant",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(checkpointRequests[0]?.nextWakeAt, TEST_NOW);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, TEST_NOW);
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown during post-checkpoint due assistant import returns the due wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [];
    const shutdownController = new AbortController();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_during_due_assistant_import",
            idleCheckpointDelayMs: 50,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            assert.equal(snapshotInput.idleCheckpointTrigger, "idle_window");
            mailboxItems.push(createMailboxItem({
              id: "mailbox_item_shutdown_during_due_assistant_import",
              laneSeq: "1",
            }));
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-during-due-assistant-import.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            events.push(`mailbox.importItem:${item.item.id}`);
            assert.ok(context?.signal);
            shutdownController.abort(
              new DOMException("Synthetic container SIGTERM.", "AbortError"),
            );
            assert.equal(context.signal.aborted, true);
            return {
              assistantInputId: "assistant_input_shutdown_during_due_assistant_import",
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls > 1) {
              throw new Error("Due assistant wake should stop when shutdown begins.");
            }
            return {
              afterCheckpoint: async () => ({
                afterDurableCheckpoint: async () => ({}),
                checkpointReason: "assistant_runtime_commit",
              }),
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: TEST_NOW,
              nextWakeReason: "assistant",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        ["mailbox.importItem:mailbox_item_shutdown_during_due_assistant_import"],
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, TEST_NOW);
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown checkpoint ignores post-shutdown runtime wake and does not wait for pending import enrichment", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    const enrichmentGate = createDeferred<void>();
    const snapshotStarted = createDeferred<void>();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_pending_import_wake",
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            assert.equal(snapshotInput.idleCheckpointTrigger, "shutdown_signal");
            snapshotStarted.resolve();
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-pending-import-wake.bundle.json",
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
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls === 1) {
              shutdownController.abort(
                new DOMException("Synthetic container SIGTERM.", "AbortError"),
              );
              runtimeWakeSignal.notify(1_777_000_000_085);
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }

            throw new Error("Runtime wake should not preempt pending import enrichment.");
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      await waitUntil(() => {
        assert.equal(events.includes("mailbox:afterCheckpoint:start"), true);
      });
      assert.equal(assistantPhaseCalls, 1);
      await withRealTimeout(
        snapshotStarted.promise,
        1_000,
        () => `Shutdown checkpoint did not start while import enrichment was pending: ${
          events.join(",")
        }`,
      );
      assert.equal(events.includes("mailbox:afterCheckpoint:done"), false);

      enrichmentGate.resolve();
      const result = await resultPromise;
      await waitUntil(() => {
        assert.equal(events.includes("mailbox:afterCheckpoint:done"), true);
      });

      assert.equal(assistantPhaseCalls, 1);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(checkpointRequests[0]?.inboxMediaRetentionWakeAt, null);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown")
          < requireEventIndex(events, "mailbox:afterCheckpoint:done"),
      );
    } finally {
      enrichmentGate.resolve();
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown after idle-window trigger does not wait for pending import enrichment", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const shutdownController = new AbortController();
    const enrichmentGate = createDeferred<void>();
    const enrichmentStarted = createDeferred<void>();
    const effectsWaitStarted = createDeferred<void>();
    const snapshotStarted = createDeferred<void>();
    const attemptId = "attempt_synthetic_shutdown_after_idle_window_pending_enrichment";
    const checkpointSnapshotTriggers: Array<
      HostedWorkspaceCheckpointRequest["idleCheckpointTrigger"]
    > = [];
    let assistantPhaseCalls = 0;
    let runtimeWakeWaitCalls = 0;
    let resultPromise: Promise<Awaited<ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess>>>
      | null = null;
    const runtimeWakeSignal: RuntimeWakeSignal = {
      consumePending() {
        return null;
      },
      notify() {},
      wait(signal) {
        runtimeWakeWaitCalls += 1;
        events.push(`runtimeWake.wait:${runtimeWakeWaitCalls}`);
        if (
          runtimeWakeWaitCalls > 1
          && events.includes("mailbox:afterCheckpoint:start")
        ) {
          effectsWaitStarted.resolve();
        }
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("Runtime wake wait was aborted.", "AbortError"),
          );
        }
        return new Promise((_resolve, reject) => {
          const abort = () => {
            signal?.removeEventListener("abort", abort);
            reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new DOMException("Runtime wake wait was aborted.", "AbortError"),
            );
          };
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId,
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.idleCheckpointTrigger}`);
            checkpointSnapshotTriggers.push(snapshotInput.idleCheckpointTrigger);
            snapshotStarted.resolve();
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-idle-window-pending-enrichment.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            events.push("import");
            return {
              afterCheckpoint: async () => {
                events.push("mailbox:afterCheckpoint:start");
                enrichmentStarted.resolve();
                await enrichmentGate.promise;
                events.push("mailbox:afterCheckpoint:done");
                return {
                  attachmentEvidenceUpdated: false,
                  kind: "inbox_projection",
                  projectionUpdated: false,
                  reasonCode: "test.noop",
                  status: "partial",
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
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        enrichmentStarted.promise,
        1_000,
        () => `Pending enrichment did not start: ${events.join(",")}`,
      );
      await waitForFakeTimerScheduled(() => `Idle checkpoint timer was not scheduled: ${
        events.join(",")
      }`);
      await vi.advanceTimersByTimeAsync(1);
      await withRealTimeout(
        effectsWaitStarted.promise,
        1_000,
        () => `Runtime did not reach the post-checkpoint effects wait: ${events.join(",")}`,
      );
      shutdownController.abort(
        new DOMException("Synthetic container SIGTERM.", "AbortError"),
      );
      await withRealTimeout(
        snapshotStarted.promise,
        1_000,
        () => `Idle-window shutdown checkpoint did not start while enrichment was pending: ${
          events.join(",")
        }`,
      );
      assert.equal(events.includes("mailbox:afterCheckpoint:done"), false);

      enrichmentGate.resolve();
      await resultPromise;
      await waitUntil(() => {
        assert.equal(events.includes("mailbox:afterCheckpoint:done"), true);
      });

      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(checkpointSnapshotTriggers, ["idle_window"]);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.ok(
        requireEventIndex(events, "snapshot:idle_window")
          < requireEventIndex(events, "mailbox:afterCheckpoint:done"),
      );

      const phaseLogs = readCapturedRuntimePhaseLogs({ attemptId, spy: consoleInfo });
      expect(
        phaseLogs.find((entry) =>
          entry.details.runtimePhase === "workspace.checkpoint.idle_shutdown"
          && entry.details.runtimePhaseStatus === "start"
        )?.details,
      ).toEqual(expect.objectContaining({
        idleCheckpointTrigger: "idle_window",
        runtimeWakePendingAtCheckpoint: false,
        shutdownSignalAbortedAtCheckpoint: true,
      }));
    } finally {
      if (previousStdIoLogSetting === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
      }
      consoleInfo.mockRestore();
      vi.useRealTimers();
      shutdownController.abort(new Error("Test cleanup."));
      enrichmentGate.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown after accepting a wake during checkpoint does not resnapshot metadata", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [
      createMailboxItem({
        id: "mailbox_item_checkpoint_wake_initial",
        laneSeq: "1",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    let assistantPhaseCalls = 0;
    let checkpointSnapshotCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_checkpoint_accepted_wake",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            checkpointSnapshotCalls += 1;
            events.push(`snapshot:${checkpointSnapshotCalls}:${snapshotInput.idleCheckpointTrigger}`);
            if (checkpointSnapshotCalls === 1) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_checkpoint_wake_late",
                laneSeq: "2",
              }));
              runtimeWakeSignal.notify(1_777_000_000_155);
              shutdownController.abort(
                new DOMException("Synthetic container SIGTERM.", "AbortError"),
              );
            }
            return {
              snapshotRef: createBundleRef({
                hash: `${checkpointSnapshotCalls}`.repeat(64).slice(0, 64),
                key: `users/bundles/member-synthetic/shutdown-checkpoint-accepted-wake-${checkpointSnapshotCalls}.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return {
              assistantInputId: await stageAssistantInputEventForMailboxItem({
                item: item.item,
                vaultRoot,
              }),
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "0" }),
                };
              },
              async checkpoint(request) {
                events.push("workspace.checkpoint");
                checkpointRequests.push(request);
                return {
                  checkpointed: true,
                  conversationInputAhead: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    version: "1",
                  }),
                };
              },
            },
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls > 1) {
              throw new Error(
                "Accepted checkpoint wake should be handed to the replacement runtime.",
              );
            }
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        ["mailbox.importItem:mailbox_item_checkpoint_wake_initial"],
      );
      assert.equal(checkpointSnapshotCalls, 1);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(result.status, "idle");
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("shutdown durable-effect follow-up hands off its selected predecessor", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems: ReturnType<typeof createMailboxItem>[] = [
      createMailboxItem({
        id: "mailbox_item_durable_effect_initial",
        laneSeq: "1",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const shutdownController = new AbortController();
    const dueAssistantWakeAt = TEST_NOW;
    const durableEffectWakeAt = "2035-01-01T00:00:00.000Z";
    let assistantPhaseCalls = 0;
    let checkpointSnapshotCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_durable_effect_handoff",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            checkpointSnapshotCalls += 1;
            events.push(`snapshot:${checkpointSnapshotCalls}:${snapshotInput.idleCheckpointTrigger}`);
            if (checkpointSnapshotCalls === 1) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_durable_effect_late",
                laneSeq: "2",
              }));
              runtimeWakeSignal.notify(1_777_000_000_155);
              shutdownController.abort(
                new DOMException("Synthetic container SIGTERM.", "AbortError"),
              );
            }
            return {
              snapshotRef: createBundleRef({
                hash: `d${checkpointSnapshotCalls}`.repeat(64).slice(0, 64),
                key:
                  "users/bundles/member-synthetic/"
                  + `shutdown-durable-effect-handoff-${checkpointSnapshotCalls}.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return {
              assistantInputId: await stageAssistantInputEventForMailboxItem({
                item: item.item,
                vaultRoot,
              }),
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "0" }),
                };
              },
              async checkpoint(request) {
                events.push("workspace.checkpoint");
                checkpointRequests.push(request);
                return {
                  checkpointed: true,
                  conversationInputAhead: true,
                  workspace: createWorkspaceState({
                    inboxMediaRetentionWakeAt:
                      request.inboxMediaRetentionWakeAt ?? null,
                    nextWakeAt: request.nextWakeAt ?? null,
                    nextWakeReason: request.nextWakeReason ?? null,
                    redactedStatus: request.redactedStatus ?? null,
                    snapshotRef: request.snapshotRef,
                    version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                  }),
                };
              },
            },
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            if (assistantPhaseCalls > 1) {
              throw new Error(
                "Accepted checkpoint wake should be handed to the replacement runtime.",
              );
            }
            return {
              afterCheckpoint: async () => ({
                afterDurableCheckpoint: async () => {
                  events.push("durable-effect");
                  return {
                    nextWakeAt: durableEffectWakeAt,
                    nextWakeReason: "system-mailbox",
                    requiresFollowUpCheckpoint: true,
                  };
                },
                checkpointReason: "system_mailbox_receipt",
              }),
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: dueAssistantWakeAt,
              nextWakeReason: "assistant",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events.filter((event) => event.startsWith("mailbox.importItem:")),
        ["mailbox.importItem:mailbox_item_durable_effect_initial"],
      );
      assert.equal(checkpointRequests.length, 2);
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(checkpointRequests[1]?.idleCheckpointTrigger, "shutdown_signal");
      assert.equal(checkpointRequests[1]?.nextWakeReason, "assistant");
      assert.equal(checkpointRequests[1]?.nextWakeAt, dueAssistantWakeAt);
      assert.ok(
        requireEventIndex(events, "snapshot:1:idle_window")
          < requireEventIndex(events, "durable-effect"),
      );
      assert.ok(
        requireEventIndex(events, "durable-effect")
          < requireEventIndex(events, "snapshot:2:shutdown_signal"),
      );
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, checkpointRequests[1]?.nextWakeAt);
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("an already-signalled shutdown preserves a due media retention wake", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const shutdownController = new AbortController();
    const recordedAt = "2026-04-01T00:00:00.000Z";
    const dueWakeAt = "2026-04-15T00:00:00.000Z";

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const persisted = await persistCanonicalInboxCapture({
        vaultRoot,
        captureId: "cap_workspace_shutdown_retention_wake",
        eventId: "evt_01JQ8PWXP5A68SQM1W0GYM41V3",
        storedAt: recordedAt,
        input: {
          source: "telegram",
          externalId: "msg-workspace-shutdown-retention-wake",
          accountId: "self",
          thread: {
            id: "thread-workspace-shutdown-retention-wake",
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
      shutdownController.abort(new Error("Synthetic container SIGTERM."));

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_due_retention_wake",
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-retention-wake.bundle.json",
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
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(checkpointRequests[0]?.inboxMediaRetentionWakeAt, dueWakeAt);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueWakeAt);
      assert.equal(result.immediateRecheckRequested, undefined);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("a shutdown media-retention wake keeps its reason on a competing assistant wake", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const shutdownController = new AbortController();
    const assistantWakeAt = "2026-04-15T00:01:00.000Z";
    const dueWakeAt = "2026-04-15T00:00:00.000Z";

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      shutdownController.abort(new Error("Synthetic container SIGTERM."));

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_retention_beats_assistant_wake",
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-retention-beats-assistant.bundle.json",
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
            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: assistantWakeAt,
              nextWakeReason: "assistant",
              progressed: true,
              redactedStatus: {
                hostedAssistantNextWakeAt: assistantWakeAt,
                hostedAssistantProgressed: true,
              },
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.nextWakeAt, assistantWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(checkpointRequests[0]?.inboxMediaRetentionWakeAt, dueWakeAt);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedAssistantNextWakeAt,
        assistantWakeAt,
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueWakeAt);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("a shutdown after a projected wake pass still preserves due media retention", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const shutdownController = new AbortController();
    const dueWakeAt = new Date(Date.now() - 1_000).toISOString();
    const projectedWakeAt = new Date(Date.now() + 15).toISOString();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_after_projected_wake_retention",
            idleCheckpointDelayMs: 75,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-after-projected-retention.bundle.json",
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
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push(
              `assistant.phase:${assistantPhaseCalls}:${
                input.workspace?.inboxMediaRetentionWakeAt
                  ? "inbox_media_retention"
                  : input.workspace?.nextWakeReason ?? "none"
              }`,
            );
            if (assistantPhaseCalls === 1) {
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: projectedWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: projectedWakeAt,
                  hostedAssistantProgressed: true,
                },
              };
            }

            shutdownController.abort(new Error("Synthetic container SIGTERM."));
            return {
              progressed: false,
              redactedStatus: {
                hostedAssistantNextWakeAt: null,
                hostedAssistantProgressed: false,
              },
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 2);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1:inbox_media_retention",
        "assistant.phase:2:inbox_media_retention",
      ]);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.nextWakeAt, projectedWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(checkpointRequests[0]?.inboxMediaRetentionWakeAt, dueWakeAt);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueWakeAt);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("a shutdown signalled mid-wait interrupts the idle window and checkpoints", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const shutdownController = new AbortController();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_signal_mid",
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-signal-mid.bundle.json",
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
            setTimeout(() => {
              shutdownController.abort(
                new DOMException("Synthetic container SIGTERM.", "AbortError"),
              );
            }, 50);
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.inboxMediaRetentionWakeAt, null);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);
});
