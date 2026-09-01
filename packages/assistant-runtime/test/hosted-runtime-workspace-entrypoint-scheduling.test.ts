import {
  REAL_SET_TIMEOUT,
  TEST_NOW,
  TEST_USER_ID,
  createAssistantAskRequestedWake,
  createBundleRef,
  createDeferred,
  createDeviceSyncResolvedConfig,
  createEmptyDeviceSyncPort,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  enqueueDeviceSyncSystemMailboxItemForTest,
  importRuntimeControlSystemMailboxItemForTest,
  mocks,
  readCapturedRuntimePhaseLogs,
  readCheckpointConversationWatermark,
  removeTempRoot,
  requireEventIndex,
  stageAssistantInputEventForMailboxItem,
  stagePendingHostedImageCompletionInputForMailboxItem,
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
  enqueueHostedSystemMailboxItem,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";

describe("hosted workspace runtime entrypoint", () => {test("reports mailbox budget exhaustion only after deferring an overflow item", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];
    const importObserved = createDeferred<void>();
    const idleCheckpointDelayMs = 180_000;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              budget: {
                maxMailboxItems: 1,
              },
              idleCheckpointDelayMs,
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "b".repeat(64),
                  key: "users/bundles/member-synthetic/workspace-budget.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              imported.push(item.item.id);
              importObserved.resolve();
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [
                  createMailboxItem({
                    id: "mailbox_item_entrypoint_budget_001",
                    laneSeq: "1",
                  }),
                  createMailboxItem({
                    createdAt: "9999-01-01T00:00:00.000Z",
                    id: "mailbox_item_entrypoint_budget_002",
                    laneSeq: "2",
                  }),
                ],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            async runAssistantPhase() {
              return {
                progressed: false,
                redactedStatus: {
                  hostedAssistantProgressed: false,
                },
              };
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(importObserved.promise, 15_000, () => events.join(","));
      assert.deepEqual(imported, ["mailbox_item_entrypoint_budget_001"]);
      await waitForFakeTimerScheduled(() => events.join(","));
      assert.equal(checkpointRequests.length, 0);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
      ]);
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - 1_000);
      assert.equal(checkpointRequests.length, 0);
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await resultPromise;

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "snapshot:1",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      const mailboxRetryWakeAt = result.nextWakeAt;
      assert.match(mailboxRetryWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(checkpointRequests[0]?.nextWakeAt, mailboxRetryWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "mailbox");
      assert.deepEqual(result, {
        immediateRecheckRequested: true,
        nextWakeAt: mailboxRetryWakeAt,
        nextWakeReason: "mailbox",
        redactedStatus: {
          hostedMailboxBlockedCount: 1,
          hostedMailboxConversationImportedSeq: "1",
          hostedMailboxFetchedCount: 2,
          hostedMailboxImportedCount: 1,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 1,
          hostedMailboxSystemHandledThroughSeq: "0",
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "budget_exhausted",
      });
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("schedules a system-mailbox wake when import checkpoints before assistant phase", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];
    const systemItem = createMailboxItem({
      id: "mailbox_item_entrypoint_import_checkpoint_system_wake",
      kind: "runtime.manual-requested",
      lane: "system",
      laneSeq: "1",
    });
    const conversationItem = createMailboxItem({
      id: "mailbox_item_entrypoint_import_checkpoint_deferred_conversation",
      laneSeq: "1",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_import_checkpoint_system_wake",
            budget: {
              maxMailboxItems: 1,
            },
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
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/import-checkpoint-system-wake.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            imported.push(`${item.item.lane}:${item.item.laneSeq}`);
            if (item.item.lane !== "system") {
              throw new Error("Conversation item should be budget-deferred before import.");
            }
            const outcome = await importRuntimeControlSystemMailboxItemForTest({
              item: item.item,
              vaultRoot,
            });
            await runCanonicalWrite({
              mutate: async ({ batch }) => {
                await batch.stageTextWrite(
                  "bank/queued-system-import.md",
                  "queued system import\n",
                );
              },
              occurredAt: TEST_NOW,
              operationType: "hosted_queued_system_import_test",
              summary: "Persist queued system mailbox import",
              vaultRoot,
            });
            return outcome;
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [systemItem, conversationItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Import-only system wake scheduling should not run assistant phase.");
          },
          vaultRoot,
        },
      );

      const systemMailbox = await readHostedSystemMailboxState(vaultRoot);
      assert.deepEqual(imported, ["system:1"]);
      assert.equal(systemMailbox.pending.length, 1);
      assert.equal(systemMailbox.pending[0]?.attemptCount, 0);
      assert.equal(checkpointRequests[0]?.reason, "canonical_runtime_commit");
      assert.equal(
        typeof checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        "string",
      );
      assert.equal(checkpointRequests[0]?.nextWakeAt, TEST_NOW);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(result.nextWakeAt, TEST_NOW);
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.status, "scheduled");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("hands off checkpoint-gated assistant wake after mailbox budget exhaustion", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];
    const dueAssistantWakeAt = new Date(Date.parse(TEST_NOW) - 1_000).toISOString();
    const assistantObserved = createDeferred<void>();
    const idleCheckpointDelayMs = 180_000;
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              budget: {
                maxMailboxItems: 1,
              },
              idleCheckpointDelayMs,
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "d".repeat(64),
                  key: "users/bundles/member-synthetic/workspace-budget-due-assistant-wake.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              imported.push(item.item.id);
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [
                  createMailboxItem({
                    id: "mailbox_item_entrypoint_budget_due_wake_001",
                    laneSeq: "1",
                  }),
                  createMailboxItem({
                    createdAt: "9999-01-01T00:00:00.000Z",
                    id: "mailbox_item_entrypoint_budget_due_wake_002",
                    laneSeq: "2",
                  }),
                ],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            async runAssistantPhase() {
              assistantPhaseCalls += 1;
              events.push(`assistant:${assistantPhaseCalls}`);
              assistantObserved.resolve();
              if (assistantPhaseCalls > 1) {
                throw new Error("Budget-exhausted attempt should hand off the checkpoint-gated wake.");
              }

              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: dueAssistantWakeAt,
                nextWakeReason: "assistant",
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
      assert.deepEqual(imported, ["mailbox_item_entrypoint_budget_due_wake_001"]);
      assert.equal(assistantPhaseCalls, 1);
      assert.equal(checkpointRequests.length, 0);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "assistant:1",
      ]);
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - 1_000);
      assert.equal(checkpointRequests.length, 0);
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await resultPromise;

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "assistant:1",
        "snapshot:1",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeAt, dueAssistantWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(result.nextWakeAt, dueAssistantWakeAt);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.status, "budget_exhausted");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns mailbox retry wake for an unbootstrapped sidecar item without idle checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];
    const sidecarItem = createMailboxItem({
      id: "mailbox_item_entrypoint_sidecar_retry",
      laneSeq: "1",
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_entrypoint_sidecar_retry",
    });
    const baseMailboxPort = createMailboxPort({
      events,
      items: [sidecarItem],
    });

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          throw new Error("Retry-only mailbox scheduling should not snapshot unchanged state.");
        },
        async importItem(item) {
          imported.push(item.item.id);
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort: {
            ...baseMailboxPort,
            async fetchPayload(): Promise<HostedMailboxPayloadFetchResponse> {
              events.push("mailbox.fetchPayload");
              return {
                fetchedAt: TEST_NOW,
                payload: null,
                unavailable: {
                  code: "not_found",
                  retryable: true,
                },
              };
            },
          },
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        vaultRoot,
      });

      assert.deepEqual(imported, []);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
      ]);
      assert.deepEqual(checkpointRequests, []);
      const mailboxRetryWakeAt = result.nextWakeAt;
      assert.match(mailboxRetryWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.deepEqual(result, {
        nextWakeAt: mailboxRetryWakeAt,
        nextWakeReason: "mailbox",
        redactedStatus: {
          hostedMailboxBlockedCount: 1,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 0,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 1,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns next wake from the checkpointed workspace after import commits", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousWakeAt = "2099-04-27T00:05:00.000Z";
    const events: string[] = [];

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          return {
            snapshotRef: createBundleRef({
              hash: "c".repeat(64),
              key: "users/bundles/member-synthetic/workspace-cleared-wake.bundle.json",
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
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_wake_001",
                laneSeq: "1",
              }),
            ],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            checkpointWorkspace(request) {
              return createWorkspaceState({
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
                redactedStatus: request.redactedStatus ?? null,
                snapshotRef: request.snapshotRef,
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
              });
            },
            events,
            workspace: createWorkspaceState({
              nextWakeAt: previousWakeAt,
              nextWakeReason: "alarm",
              version: "0",
            }),
          }),
        }),
        async runAssistantPhase() {
          return { progressed: false };
        },
        vaultRoot,
      });

      assert.equal(result.nextWakeAt, previousWakeAt);
      assert.equal(result.status, "scheduled");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("binds provider batches to stored input ids and conversation activity", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const conversationActivity: string[] = [];

    try {
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          throw new Error("No-progress compatibility pass should not checkpoint.");
        },
        async importItem() {
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events: [], items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events: [],
            workspace: createWorkspaceState(),
          }),
        }),
        onConversationActivityObserved(observation) {
          conversationActivity.push(observation);
        },
        async runAssistantPhase(input) {
          assert.equal(typeof input.beforeProviderAcceptedInputs, "function");
          assert.equal(input.currentAssistantInputId?.(), null);
          const firstInputId = await stageAssistantInputEventForMailboxItem({
            causalSeq: "41",
            item: createMailboxItem({
              id: "mailbox_item_preference_batch_1",
              laneSeq: "41",
              occurredAt: "2026-04-26T00:00:01.000Z",
            }),
            vaultRoot,
          });
          const secondInputId = await stageAssistantInputEventForMailboxItem({
            causalSeq: "42",
            item: createMailboxItem({
              id: "mailbox_item_preference_batch_2",
              laneSeq: "42",
              occurredAt: "2026-04-26T00:00:02.000Z",
            }),
            vaultRoot,
          });
          const invalidRelease = await input.beforeProviderAcceptedInputs?.({
            turnId: "turn_hosted_runtime_test",
            acceptedInputs: [
              { id: firstInputId, source: "assistant-input" },
              {
                id: "ain_22222222222222222222222222222222",
                source: "assistant-input",
              },
            ],
          });
          assert.equal(input.currentAssistantInputId?.(), null);
          assert.deepEqual(conversationActivity, ["uncertain"]);
          await invalidRelease?.();
          const release = await input.beforeProviderAcceptedInputs?.({
            turnId: "turn_hosted_runtime_test",
            acceptedInputs: [
              { id: secondInputId, source: "assistant-input" },
              { id: firstInputId, source: "assistant-input" },
            ],
          });
          assert.equal(
            input.currentAssistantInputId?.(),
            secondInputId,
          );
          assert.equal(typeof release, "function");
          await release?.();
          assert.equal(input.currentAssistantInputId?.(), null);
          assert.deepEqual(conversationActivity, ["uncertain", "observed"]);

          const systemInputId = await stageAssistantInputEventForMailboxItem({
            causalSeq: "43",
            item: createMailboxItem({
              id: "mailbox_item_preference_batch_system",
              lane: "system",
              laneSeq: "43",
              occurredAt: "2026-04-26T00:00:03.000Z",
            }),
            lane: "system",
            vaultRoot,
          });
          const systemRelease = await input.beforeProviderAcceptedInputs?.({
            turnId: "turn_hosted_runtime_test",
            acceptedInputs: [
              { id: systemInputId, source: "assistant-input" },
            ],
          });
          await systemRelease?.();
          const genericRelease = await input.beforeProviderAcceptedInputs?.({
            turnId: "turn_hosted_runtime_test",
            acceptedInputs: [
              { id: "system_runtime_input", source: "system" },
            ],
          });
          await genericRelease?.();
          assert.deepEqual(conversationActivity, ["uncertain", "observed"]);
          return { progressed: false };
        },
        vaultRoot,
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("hands a pending turn to a fresh invocation before servicing a later wake", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TEST_NOW));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-provider-handoff-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let assistantPhaseCount = 0;
    let providerEgressCount = 0;

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_provider_handoff",
            idleCheckpointDelayMs: 180_000,
            leaseGeneration: "1",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/provider-handoff.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            return {
              assistantInputId: await stageAssistantInputEventForMailboxItem({
                item: item.item,
                vaultRoot,
              }),
              status: "imported",
            };
          },
          platform: createPlatform({
            assistantConfigurationToolPort: {
              async request() {
                return {
                  action: "read",
                  result: {
                    availableModels: ["gpt-5.6-luna", "gpt-5.6-terra"],
                    availableProviders: ["openai", "venice"],
                    availableReasoningEfforts: ["low", "medium", "high", "xhigh"],
                    configurationAvailable: true,
                    dormantSolPreference: false,
                    model: "gpt-5.6-terra",
                    provider: "venice",
                    reasoningEffort: "low",
                    solAvailable: false,
                  },
                };
              },
            },
            mailboxPort: createMailboxPort({ events: [], items: mailboxItems }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointWorkspace: (request) => {
                mailboxItems.push(createMailboxItem({
                  id: "mailbox_item_provider_handoff_retry",
                  laneSeq: "1",
                }));
                runtimeWakeSignal.notify();
                return createWorkspaceState({
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
              },
              events: [],
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            assistantPhaseCount += 1;
            if (assistantPhaseCount > 1) {
              throw new Error(
                "A stale-provider invocation must checkpoint before servicing another wake.",
              );
            }
            try {
              await input.beforeProviderAcceptedInputs?.({
                turnId: "turn_hosted_runtime_test",
                acceptedInputs: [{ id: "system_provider_handoff", source: "system" }],
              });
            } catch (error) {
              assert.equal(
                error instanceof Error ? error.name : null,
                "AssistantActiveTurnInputUnavailableError",
              );
              return {
                checkpointReason: "canonical_runtime_commit",
                nextWakeAt: new Date(Date.now() + 30_000).toISOString(),
                progressed: true,
              };
            }
            providerEgressCount += 1;
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      assert.equal(providerEgressCount, 0);
      assert.equal(assistantPhaseCount, 1);
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(checkpointRequests.length, 1);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("defers provider egress when live provider authority is unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TEST_NOW));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-provider-authority-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let providerEgressCount = 0;

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_provider_authority_unavailable",
            idleCheckpointDelayMs: 180_000,
            leaseGeneration: "1",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Provider authority deferral must not checkpoint.");
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            assistantConfigurationToolPort: {
              async request() {
                throw new Error("control plane unavailable");
              },
            },
            mailboxPort: createMailboxPort({ events: [], items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events: [],
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            try {
              await input.beforeProviderAcceptedInputs?.({
                turnId: "turn_hosted_runtime_test",
                acceptedInputs: [{ id: "system_provider_authority", source: "system" }],
              });
            } catch (error) {
              assert.equal(
                error instanceof Error ? error.name : null,
                "AssistantActiveTurnInputUnavailableError",
              );
              return { progressed: false };
            }
            providerEgressCount += 1;
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      assert.equal(providerEgressCount, 0);
      assert.equal(result.status, "idle");
      assert.equal(checkpointRequests.length, 0);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("hands a detached ask to a fresh invocation when the live provider changes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-detached-provider-handoff-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const prepareStarted = createDeferred<void>();
    const prepareRelease = createDeferred<void>();
    const idleMaintenanceCallCount =
      mocks.runHostedIdleCheckpointMaintenance.mock.calls.length;
    const askItem = createMailboxItem({
      dedupeKey: "ask_event_detached_provider_handoff",
      id: "mailbox_item_detached_provider_handoff",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "1",
    });
    let completionCalls = 0;
    let providerEgressCount = 0;

    mocks.executeReadOnlyAssistantAsk.mockImplementationOnce(async (askInput) => {
      events.push("ask.started");
      await askInput.beforeProviderEntry?.();
      providerEgressCount += 1;
      return { answer: "stale answer", outcome: "answered" };
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_detached_provider_handoff",
              idleCheckpointDelayMs: 180_000,
              leaseGeneration: "1",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot() {
              return {
                snapshotRef: createBundleRef({
                  hash: "b".repeat(64),
                  key: "users/bundles/member-synthetic/detached-provider-handoff.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              events.push("ask.imported");
              return await enqueueHostedSystemMailboxItem({
                item,
                vaultRoot,
                wake: createAssistantAskRequestedWake({
                  eventId: askItem.dedupeKey,
                }),
              });
            },
            platform: createPlatform({
              assistantAskPort: {
                async request(request) {
                  if (request.action === "complete") {
                    events.push("ask.completed");
                    completionCalls += 1;
                    return { action: "complete", status: "completed" };
                  }
                  events.push("ask.prepared");
                  prepareStarted.resolve();
                  await prepareRelease.promise;
                  return {
                    action: "prepare",
                    question: "What did the group decide?",
                    status: "ready",
                    targetLabel: "100 Club",
                  };
                },
              },
              assistantConfigurationToolPort: {
                async request() {
                  return {
                    action: "read",
                    result: {
                      availableModels: ["gpt-5.6-luna", "gpt-5.6-terra"],
                      availableProviders: ["openai", "venice"],
                      availableReasoningEfforts: ["low", "medium", "high", "xhigh"],
                      configurationAvailable: true,
                      dormantSolPreference: false,
                      model: "gpt-5.6-terra",
                      provider: "venice",
                      reasoningEffort: "low",
                      solAvailable: false,
                    },
                  };
                },
              },
              mailboxPort: createMailboxPort({ events, items: [askItem] }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events: [],
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            async runAssistantPhase() {
              events.push("foreground");
              await prepareStarted.promise;
              prepareRelease.resolve();
              return { progressed: false };
            },
            runtimeWakeSignal,
            vaultRoot,
          },
        ),
        30_000,
        () => JSON.stringify({
          checkpointCount: checkpointRequests.length,
          completionCalls,
          events,
          providerEgressCount,
        }),
      );

      assert.equal(providerEgressCount, 0);
      assert.equal(completionCalls, 0);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeReason, "assistant");
      assert.ok(result.nextWakeAt);
      assert.equal(
        mocks.runHostedIdleCheckpointMaintenance.mock.calls[
          idleMaintenanceCallCount
        ]?.[0].pendingWork,
        true,
      );
      assert.equal(checkpointRequests.length, 1);
      const pending = (await readHostedSystemMailboxState(vaultRoot)).pending;
      assert.equal(pending.length, 1);
      assert.equal(pending[0]?.itemId, askItem.id);
      assert.equal(pending[0]?.status, "pending");
      assert.equal(pending[0]?.nextAttemptAt, null);
    } finally {
      prepareRelease.resolve();
      await removeTempRoot(vaultRoot);
    }
  }, 45_000);

  test("keeps device-sync ownership when invocation projections tie on wake time", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const tiedWakeAt = "2099-04-27T00:05:00.000Z";
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          return {
            snapshotRef: createBundleRef({
              hash: "d".repeat(64),
              key: "users/bundles/member-synthetic/device-sync-tied-projection.bundle.json",
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
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_wake_tie",
                laneSeq: "1",
              }),
            ],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            checkpointWorkspace(request) {
              return createWorkspaceState({
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
                redactedStatus: request.redactedStatus ?? null,
                snapshotRef: request.snapshotRef,
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
              });
            },
            events,
            workspace: createWorkspaceState({
              nextWakeAt: tiedWakeAt,
              nextWakeReason: "assistant",
              version: "0",
            }),
          }),
        }),
        async runAssistantPhase() {
          return {
            checkpointReason: "assistant_runtime_commit",
            nextWakeAt: tiedWakeAt,
            nextWakeReason: "device-sync.reconcile",
            progressed: true,
            redactedStatus: {
              hostedAssistantNextWakeAt: tiedWakeAt,
              hostedAssistantProgressed: true,
            },
          };
        },
        vaultRoot,
      });

      assert.equal(result.nextWakeAt, tiedWakeAt);
      assert.equal(result.status, "scheduled");
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, tiedWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "device-sync.reconcile");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("idle checkpoint retains an earlier future device-sync mailbox wake over the assistant scalar", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const deviceWakeAt = "2026-04-27T00:00:10.000Z";
    const assistantWakeAt = "2026-04-27T00:00:20.000Z";
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:idle-device-wake-retention",
      id: "mailbox_item_entrypoint_idle_device_wake_retention_system",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            idleCheckpointDelayMs: 1,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "4".repeat(64),
                key: "users/bundles/member-synthetic/idle-device-wake-retention.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            await enqueueDeviceSyncSystemMailboxItemForTest({
              item: deviceItem,
              vaultRoot,
            });
            await updateHostedSystemMailboxState(vaultRoot, (state) => ({
              pending: state.pending.map((item) =>
                item.itemId === deviceItem.id
                  ? {
                      ...item,
                      nextAttemptAt: deviceWakeAt,
                      routeAction: "run-device-sync-wake",
                    }
                  : item
              ),
            }));
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_idle_device_wake_retention",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              nextWakeAt: assistantWakeAt,
              nextWakeReason: "assistant",
              progressed: false,
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeAt, deviceWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
      assert.equal(result.nextWakeAt, deviceWakeAt);
      assert.equal(result.nextWakeReason, "device-sync.reconcile");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("canonical runtime-status checkpoint retains an earlier future device-sync mailbox wake over the assistant scalar", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const deviceWakeAt = "2026-04-27T00:00:10.000Z";
    const assistantWakeAt = "2026-04-27T00:00:20.000Z";
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:status-device-wake-retention",
      id: "mailbox_item_entrypoint_status_device_wake_retention_system",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const canonicalWriteItem = createMailboxItem({
      id: "mailbox_item_entrypoint_status_device_wake_retention_write",
      kind: "runtime.manual-requested",
      lane: "system",
      laneSeq: "1",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "5".repeat(64),
                key: "users/bundles/member-synthetic/status-device-wake-retention.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            assert.equal(item.item.id, canonicalWriteItem.id);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [canonicalWriteItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: assistantWakeAt,
                nextWakeReason: "assistant",
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            await enqueueDeviceSyncSystemMailboxItemForTest({
              item: deviceItem,
              vaultRoot,
            });
            await updateHostedSystemMailboxState(vaultRoot, (state) => ({
              pending: state.pending.map((pendingItem) =>
                pendingItem.itemId === deviceItem.id
                  ? {
                      ...pendingItem,
                      nextAttemptAt: deviceWakeAt,
                      routeAction: "run-device-sync-wake",
                    }
                  : pendingItem
              ),
            }));
            await runCanonicalWrite({
              mutate: async ({ batch }) => {
                await batch.stageTextWrite(
                  "bank/status-device-wake-retention.md",
                  "synthetic canonical status checkpoint\n",
                );
              },
              occurredAt: TEST_NOW,
              operationType: "hosted_status_device_wake_retention_test",
              summary: "Persist synthetic status checkpoint",
              vaultRoot,
            });
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      const canonicalCheckpoint = checkpointRequests.find(
        (request) => request.reason === "canonical_runtime_commit",
      );
      assert.ok(canonicalCheckpoint);
      assert.equal(
        typeof canonicalCheckpoint.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        "string",
      );
      assert.equal(canonicalCheckpoint.nextWakeAt, deviceWakeAt);
      assert.equal(canonicalCheckpoint.nextWakeReason, "device-sync.reconcile");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns scheduled when no mailbox import runs and the workspace has a future wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const nextWakeAt = "2099-04-27T00:05:00.000Z";

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run without mailbox state changes.");
        },
        async importItem() {
          throw new Error("Import should not run when no mailbox items are fetched.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({
              nextWakeAt,
              nextWakeReason: "alarm",
              version: "0",
            }),
          }),
        }),
        vaultRoot,
      });

      assert.deepEqual(events, ["workspace.read", "mailbox.fetch", "mailbox.fetch"]);
      assert.deepEqual(result, {
        nextWakeAt,
        nextWakeReason: "alarm",
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 0,
          hostedMailboxImportedCount: 0,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("drops stale workspace wake when no mailbox import runs", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const staleWakeAt = "2000-04-27T00:05:00.000Z";

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run without mailbox state changes.");
        },
        async importItem() {
          throw new Error("Import should not run when no mailbox items are fetched.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({
              nextWakeAt: staleWakeAt,
              nextWakeReason: "alarm",
              version: "0",
            }),
          }),
        }),
        async runAssistantPhase() {
          return { progressed: false };
        },
        vaultRoot,
      });

      assert.deepEqual(events, ["workspace.read", "mailbox.fetch", "mailbox.fetch"]);
      assert.deepEqual(result, {
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 0,
          hostedMailboxImportedCount: 0,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fresh due assistant wake supersedes a progressed projection marker with a stale carried device-sync wake", async () => {
    // Incident shape (2026-08-15): a workspace restores with a stale,
    // already-past device-sync.reconcile wake. While runtime state is dirty
    // with pending durable effects (a delivered reply's consume acks), a
    // foreground pass arms a fresh due assistant wake (a just-scheduled
    // reminder's canonical assistant-now). The pre-checkpoint preserve branch
    // previously returned the stale carried token over that fresh due wake,
    // so the checkpoint disarmed the reminder and the workspace stayed
    // dormant until unrelated inbound activity.
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const staleDeviceWakeAt = new Date(Date.now() - 9 * 60 * 60 * 1_000).toISOString();
    const freshDueWakeAt = new Date(Date.now() - 1_000).toISOString();
    const foregroundAfterCheckpointGate = createDeferred<void>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_stale_supersede_001",
        laneSeq: "1",
      }),
    ];
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {};
    });
    let assistantPass = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_stale_supersede",
            idleCheckpointDelayMs: 25,
            leaseGeneration: "3",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/stale-supersede.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.id !== "mailbox_item_entrypoint_stale_supersede_001") {
              return { status: "imported" };
            }
            return {
              afterCheckpoint: async () => {
                events.push("mailbox.afterCheckpoint:start");
                await foregroundAfterCheckpointGate.promise;
                events.push("mailbox.afterCheckpoint:done");
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
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleDeviceWakeAt,
                nextWakeReason: "device-sync.reconcile",
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPass += 1;
            events.push(`assistant:${assistantPass}`);

            if (assistantPass === 1) {
              // The delivered-reply pass: a causal-only-style lane re-emits
              // the restored stale device wake it carried (PR #914 lanes only
              // tighten, so a preserved device token flows back out of the
              // pass result) and leaves pending durable effects so runtime
              // state stays dirty (checkpoint pending) for the next pass —
              // the incident interleaving.
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: durableEffect,
                  checkpointReason: "system_mailbox_receipt",
                }),
                checkpointReason: "system_mailbox_receipt",
                nextWakeAt: staleDeviceWakeAt,
                nextWakeReason: "device-sync.reconcile",
                progressed: true,
                // System-owner and foreground results can merge this marker
                // onto a genuinely progressed pass. That composite result
                // must keep foreground authority instead of handing the stale
                // device token back to its owner.
                runtimeProjectionCheckpointRequested: true,
              };
            }

            if (assistantPass === 2) {
              // The reminder pass: arms a fresh, already-due assistant wake
              // while the stale device token is still the carried projection.
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: freshDueWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            // The service pass for the due assistant wake must observe the
            // fresh value, never the resurrected stale device timestamp.
            assert.equal(input.workspace?.nextWakeAt, freshDueWakeAt);
            assert.equal(input.workspace?.nextWakeReason, "assistant");
            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: null,
              nextWakeReason: null,
              progressed: true,
            };
          },
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      await waitUntil(() => {
        assert.equal(events.includes("mailbox.afterCheckpoint:start"), true, events.join(","));
      }, 10_000);
      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_entrypoint_stale_supersede_002",
        laneSeq: "2",
      }));
      runtimeWakeSignal.notify();
      await waitUntil(() => {
        assert.equal(events.includes("assistant:2"), true);
      });
      foregroundAfterCheckpointGate.resolve();

      const result = await withRealTimeout(
        resultPromise,
        15_000,
        () => events.join(","),
      );

      const persistedWakes = checkpointRequests.map((request) => [
        request.nextWakeAt,
        request.nextWakeReason,
      ]);
      assert.ok(
        persistedWakes.every(([wakeAt]) => wakeAt !== staleDeviceWakeAt),
        `stale device wake resurrected into a checkpoint: ${JSON.stringify(persistedWakes)}`,
      );
      assert.ok(
        persistedWakes.some(([wakeAt, reason]) =>
          wakeAt === freshDueWakeAt && reason === "assistant"
        ),
        `fresh due assistant wake missing from checkpoints: ${JSON.stringify(persistedWakes)}`,
      );
      assert.equal(assistantPass, 3, events.join(","));
      assert.equal(result.nextWakeAt, null);
    } finally {
      foregroundAfterCheckpointGate.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    {
      checkpointConversation: false,
      checkpointConversationInputAhead: false,
      checkpointFreshTerminalConversation: false,
      checkpointRuntimeWake: false,
      checkpointTrustedCompletion: false,
      checkpointSystemControl: false,
      generatedImageRetention: false,
      handoff: "no-signal reconciliation",
    },
    {
      checkpointConversation: false,
      checkpointConversationInputAhead: false,
      checkpointFreshTerminalConversation: false,
      checkpointRuntimeWake: true,
      checkpointTrustedCompletion: false,
      checkpointSystemControl: false,
      generatedImageRetention: false,
      handoff: "empty checkpoint runtime recheck",
    },
    {
      checkpointConversation: true,
      checkpointConversationInputAhead: true,
      checkpointFreshTerminalConversation: false,
      checkpointRuntimeWake: false,
      checkpointTrustedCompletion: false,
      checkpointSystemControl: false,
      generatedImageRetention: false,
      handoff: "conversation input hint",
    },
    {
      checkpointConversation: true,
      checkpointConversationInputAhead: false,
      checkpointFreshTerminalConversation: false,
      checkpointRuntimeWake: true,
      checkpointTrustedCompletion: false,
      checkpointSystemControl: false,
      generatedImageRetention: false,
      handoff: "retained checkpoint wake",
    },
    {
      checkpointConversation: false,
      checkpointConversationInputAhead: false,
      checkpointFreshTerminalConversation: false,
      checkpointRuntimeWake: false,
      checkpointTrustedCompletion: false,
      checkpointSystemControl: false,
      generatedImageRetention: true,
      handoff: "no-signal reconciliation after a status commit",
    },
    {
      checkpointConversation: false,
      checkpointConversationInputAhead: false,
      checkpointFreshTerminalConversation: false,
      checkpointRuntimeWake: true,
      checkpointTrustedCompletion: false,
      checkpointSystemControl: true,
      generatedImageRetention: false,
      handoff: "system-only runtime control",
    },
    {
      checkpointConversation: false,
      checkpointConversationInputAhead: false,
      checkpointFreshTerminalConversation: false,
      checkpointRuntimeWake: true,
      checkpointTrustedCompletion: false,
      checkpointTrustedCompletionRetry: true,
      checkpointSystemControl: false,
      generatedImageRetention: false,
      handoff: "retried trusted completion quiet window",
    },
    {
      checkpointAssistantInputRetry: "conversation" as const,
      checkpointConversation: false,
      checkpointConversationInputAhead: false,
      checkpointFreshTerminalConversation: false,
      checkpointRuntimeWake: false,
      checkpointTrustedCompletion: false,
      checkpointSystemControl: false,
      generatedImageRetention: false,
      handoff: "retried conversation input quiet window",
    },
    {
      checkpointAssistantInputRetry: "hosted-image" as const,
      checkpointConversation: false,
      checkpointConversationInputAhead: false,
      checkpointFreshTerminalConversation: false,
      checkpointRuntimeWake: false,
      checkpointTrustedCompletion: false,
      checkpointSystemControl: false,
      generatedImageRetention: false,
      handoff: "retried hosted image completion quiet window",
    },
    {
      checkpointConversation: false,
      checkpointConversationInputAhead: false,
      checkpointFreshTerminalConversation: true,
      checkpointRuntimeWake: true,
      checkpointTrustedCompletion: false,
      checkpointSystemControl: false,
      generatedImageRetention: false,
      handoff: "fresh terminal conversation quiet window",
    },
  ])("older due assistant carry honors $handoff before persisting a later reminder", async (
    {
      checkpointAssistantInputRetry,
      checkpointConversation,
      checkpointConversationInputAhead,
      checkpointFreshTerminalConversation,
      checkpointRuntimeWake,
      checkpointTrustedCompletion,
      checkpointTrustedCompletionRetry,
      checkpointSystemControl,
      generatedImageRetention,
    },
  ) => {
    // The predecessor already received its one hot attempt. A later reminder
    // appears before checkpoint; when conversation input arrives while that
    // checkpoint commits, it must retain foreground priority.
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "murph-workspace-entrypoint-"),
    );
    const sourceVaultRoot = path.join(workspaceRoot, "source-vault");
    const vaultRoot = path.join(workspaceRoot, "live-vault");
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 180_000;
    const olderDueWakeAt = new Date(Date.parse(TEST_NOW) - 60_000).toISOString();
    const reconciliationWakeAt = TEST_NOW;
    const reminderWakeAt = new Date(
      Date.parse(TEST_NOW) + 5 * 60_000,
    ).toISOString();
    const reminderAutomationId = "automation_01JQ8PWXP5A68SQM1W0GYM41V7";
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const olderWakeHotAttemptComplete = createDeferred<void>();
    const olderWakePersisted = createDeferred<void>();
    const reminderCreated = createDeferred<void>();
    const reminderWakePersisted = createDeferred<void>();
    const assistantInputRetryFailed = createDeferred<void>();
    const assistantInputRetryHandled = createDeferred<void>();
    const freshTerminalConversationHandled = createDeferred<void>();
    const trustedCompletionHandled = createDeferred<void>();
    const trustedCompletionRetryFailed = createDeferred<void>();
    const firstCheckpointConversationHandled = createDeferred<void>();
    const secondCheckpointConversationHandled = createDeferred<void>();
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_assistant_carry_mask_001",
        laneSeq: "1",
      }),
    ];
    let assistantPass = 0;
    let assistantInputRetryAttempts = 0;
    let assistantInputRetryId: string | null = null;
    let freshTerminalConversationInputId: string | null = null;
    let reminderReconciled = false;
    let snapshotCount = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      let initialSnapshotRef: HostedWorkspaceState["snapshotRef"] = null;
      if (generatedImageRetention) {
        const recordedAt = "2026-04-01T00:00:00.000Z";
        const sourceImagePath = path.join(workspaceRoot, "generated-image-source.webp");
        await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceVaultRoot });
        await writeFile(sourceImagePath, "generated image bytes");
        await addCaptureWithLookup({
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
          lookupKey: "generated:assistant-carry-status-commit",
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
        await rm(sourceImagePath);
        assert.deepEqual(
          (await readHostedSystemMailboxState(sourceVaultRoot)).pending,
          [],
        );
        const baseBundle = await snapshotHostedBundleRoots({
          kind: "vault",
          roots: [{ root: sourceVaultRoot, rootKey: "vault" }],
        });
        assert.ok(baseBundle);
        const baseHash = sha256HostedBundleHex(baseBundle);
        artifactBytesByHash.set(baseHash, baseBundle);
        initialSnapshotRef = createBundleRef({
          hash: baseHash,
          key: `synthetic/assistant-carry-status-commit/${baseHash}.bundle`,
          size: baseBundle.byteLength,
        });
      } else {
        await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      }

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_assistant_carry_mask",
            idleCheckpointDelayMs,
            leaseGeneration: "3",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotCount += 1;
            events.push(
              `snapshot:${snapshotCount}:`
              + `${snapshotInput.reason}:${Date.now()}`,
            );
            return {
              snapshotRef: createBundleRef({
                hash: `${snapshotCount}`.repeat(64).slice(0, 64),
                key:
                  "users/bundles/member-synthetic/"
                  + `assistant-carry-mask-${snapshotCount}.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (
              item.item.id
                === "mailbox_item_entrypoint_assistant_carry_mask_fresh_terminal"
            ) {
              freshTerminalConversationInputId =
                await stagePendingLinqAssistantInputForMailboxItem({
                  causalSeq: item.item.laneSeq,
                  item: item.item,
                  vaultRoot,
                });
              assert.ok(context?.onConversationInputStaged);
              context.onConversationInputStaged("linq");
              return {
                assistantInputId: freshTerminalConversationInputId,
                status: "imported",
              };
            }
            if (
              item.item.id
                === "mailbox_item_entrypoint_assistant_carry_mask_input_retry"
            ) {
              assistantInputRetryId = checkpointAssistantInputRetry === "hosted-image"
                ? await stagePendingHostedImageCompletionInputForMailboxItem({
                    item: item.item,
                    vaultRoot,
                  })
                : await stagePendingLinqAssistantInputForMailboxItem({
                    causalSeq: item.item.laneSeq,
                    item: item.item,
                    vaultRoot,
                  });
              if (checkpointAssistantInputRetry === "conversation") {
                assert.ok(context?.onConversationInputStaged);
                context.onConversationInputStaged("linq");
              }
              return {
                assistantInputId: assistantInputRetryId,
                status: "imported",
              };
            }
            if (item.item.lane === "system") {
              if (item.item.kind === "assistant.notification.requested") {
                if (checkpointTrustedCompletionRetry) {
                  events.push("trusted-completion:retryable-failed");
                  trustedCompletionRetryFailed.resolve();
                }
                return { status: "imported" };
              }
              return await importRuntimeControlSystemMailboxItemForTest({
                item: item.item,
                vaultRoot,
              });
            }
            if (
              item.item.id === "mailbox_item_entrypoint_assistant_carry_mask_003"
              || item.item.id === "mailbox_item_entrypoint_assistant_carry_mask_004"
            ) {
              assert.ok(context?.onConversationInputStaged);
              context.onConversationInputStaged("linq");
            }
            return { status: "imported" };
          },
          platform: createPlatform({
            artifactBytesByHash,
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              checkpointResponse(request) {
                const workspace = createWorkspaceState({
                  inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                  nextWakeAt: request.nextWakeAt ?? null,
                  nextWakeReason: request.nextWakeReason ?? null,
                  redactedStatus: request.redactedStatus ?? null,
                  snapshotRef: request.snapshotRef,
                  version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                });
                if (request.reason === "canonical_runtime_commit") {
                  events.push(
                    `workspace.checkpoint:canonical_runtime_commit:${request.nextWakeAt ?? "none"}`,
                  );
                }
                const idleCheckpointCount = checkpointRequests.filter(
                  (checkpointRequest) => checkpointRequest.reason === "idle_shutdown",
                ).length;
                if (request.reason === "idle_shutdown" && idleCheckpointCount === 1) {
                  events.push("runtime-wake:persisted-older-assistant");
                  if (checkpointConversation) {
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_assistant_carry_mask_003",
                      laneSeq: "3",
                    }));
                  }
                  if (checkpointFreshTerminalConversation) {
                    mailboxItems.push(createMailboxItem({
                      id:
                        "mailbox_item_entrypoint_assistant_carry_mask_"
                        + "fresh_terminal",
                      laneSeq: "3",
                    }));
                  }
                  if (checkpointSystemControl) {
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_assistant_carry_mask_system_001",
                      kind: "runtime.manual-requested",
                      lane: "system",
                      laneSeq: "1",
                    }));
                  }
                  if (
                    checkpointTrustedCompletion
                    && !checkpointTrustedCompletionRetry
                  ) {
                    mailboxItems.push(createMailboxItem({
                      dedupeKey:
                        "assistant.notification.requested:phone-call-result:"
                        + "assistant_carry_mask:generation:1",
                      id:
                        "mailbox_item_entrypoint_assistant_carry_mask_"
                        + "trusted_completion_001",
                      kind: "assistant.notification.requested",
                      lane: "system",
                      laneSeq: "1",
                    }));
                  }
                  olderWakePersisted.resolve();
                  if (checkpointRuntimeWake) {
                    runtimeWakeSignal.notify(Date.now());
                  }
                }
                if (request.nextWakeAt === reminderWakeAt) {
                  reminderWakePersisted.resolve();
                }
                return {
                  conversationInputAhead:
                    request.reason === "idle_shutdown"
                    && idleCheckpointCount === 1
                    && checkpointConversationInputAhead,
                  checkpointed: true,
                  workspace,
                };
              },
              events,
              workspace: createWorkspaceState({
                snapshotRef: initialSnapshotRef,
                version: "0",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            assistantPass += 1;
            const presentedWakeAt = input.workspace?.nextWakeAt ?? "none";
            events.push(`assistant:${assistantPass}:${presentedWakeAt}:${Date.now()}`);

            if (
              freshTerminalConversationInputId !== null
              && !events.includes("fresh-terminal-conversation:handled")
            ) {
              const release = await input.beforeProviderAcceptedInputs?.({
                turnId: "turn_hosted_runtime_test",
                acceptedInputs: [{
                  id: freshTerminalConversationInputId,
                  source: "assistant-input",
                }],
              });
              assert.ok(release);
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: freshTerminalConversationInputId,
                vaultRoot,
              });
              await release?.();
              events.push("fresh-terminal-conversation:handled");
              freshTerminalConversationHandled.resolve();
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: reconciliationWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            if (
              assistantInputRetryId !== null
              && !events.includes("assistant-input-retry:handled")
            ) {
              assistantInputRetryAttempts += 1;
              const release = await input.beforeProviderAcceptedInputs?.({
                turnId: "turn_hosted_runtime_test",
                acceptedInputs: [{
                  id: assistantInputRetryId,
                  source: "assistant-input",
                }],
              });
              await release?.();
              events.push(
                `assistant-input-retry:attempt:${assistantInputRetryAttempts}`,
              );
              if (assistantInputRetryAttempts === 1) {
                if (checkpointAssistantInputRetry === "hosted-image") {
                  assistantInputRetryFailed.resolve();
                }
                return {
                  checkpointReason: "assistant_runtime_commit",
                  invocationLocalAssistantWakeAt: olderDueWakeAt,
                  nextWakeAt: olderDueWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }
              if (
                assistantInputRetryAttempts === 2
                && checkpointAssistantInputRetry === "conversation"
              ) {
                assistantInputRetryFailed.resolve();
                return { progressed: false };
              }
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: assistantInputRetryId,
                vaultRoot,
              });
              events.push("assistant-input-retry:handled");
              assistantInputRetryHandled.resolve();
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: reconciliationWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            const handlesTrustedCompletion =
              (checkpointTrustedCompletion || checkpointTrustedCompletionRetry)
              && events.includes(
                "mailbox.importItem:"
                + "mailbox_item_entrypoint_assistant_carry_mask_"
                + "trusted_completion_001",
              )
              && !events.includes("trusted-completion:handled");
            if (handlesTrustedCompletion) {
              events.push("trusted-completion:handled");
              trustedCompletionHandled.resolve();
              if (checkpointTrustedCompletionRetry) {
                reminderReconciled = true;
              }
              return {
                checkpointReason: "assistant_runtime_commit",
                foregroundPrioritySystemCompletionProcessed: true,
                nextWakeAt: checkpointTrustedCompletionRetry
                  ? reminderWakeAt
                  : reconciliationWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            if (assistantPass === 1) {
              return {
                checkpointReason: "assistant_runtime_commit",
                invocationLocalAssistantWakeAt: olderDueWakeAt,
                nextWakeAt: olderDueWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            if (assistantPass === 2) {
              olderWakeHotAttemptComplete.resolve();
              return { progressed: false };
            }

            if (assistantPass === 3) {
              assert.equal(presentedWakeAt, "none");
              await upsertAutomation({
                automationId: reminderAutomationId,
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
                  at: reminderWakeAt,
                  kind: "at",
                },
                status: "active",
                title: "Synthetic reminder",
                vaultRoot: input.restored.vaultRoot,
              });
              reminderCreated.resolve();
              if (checkpointTrustedCompletionRetry) {
                mailboxItems.push(createMailboxItem({
                  dedupeKey:
                    "assistant.notification.requested:usage-referral-reward:"
                    + "assistant_carry_mask_retry",
                  id:
                    "mailbox_item_entrypoint_assistant_carry_mask_"
                    + "trusted_completion_001",
                  kind: "assistant.notification.requested",
                  lane: "system",
                  laneSeq: "1",
                }));
                runtimeWakeSignal.notify(Date.now());
              }
              if (checkpointAssistantInputRetry) {
                mailboxItems.push(createMailboxItem({
                  id:
                    "mailbox_item_entrypoint_assistant_carry_mask_input_retry",
                  laneSeq: "3",
                }));
                runtimeWakeSignal.notify(Date.now());
              }
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: reconciliationWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            if (presentedWakeAt === reconciliationWakeAt) {
              if (generatedImageRetention) {
                const refresh = await refreshAssistantContextSnapshotBestEffort({
                  now: () => new Date(Date.now()).toISOString(),
                  vaultRoot: input.restored.vaultRoot,
                });
                assert.equal(refresh.refreshed, true);
                assert.deepEqual(refresh.pendingDirtyDomains, []);
              }
              reminderReconciled = true;
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: reminderWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            if (
              checkpointConversation
              || checkpointTrustedCompletion
              || checkpointTrustedCompletionRetry
            ) {
              const handlingSecondConversation = events.includes(
                "mailbox.importItem:mailbox_item_entrypoint_assistant_carry_mask_004",
              );
              const expectedMailboxItemId = handlingSecondConversation
                ? "mailbox_item_entrypoint_assistant_carry_mask_004"
                : "mailbox_item_entrypoint_assistant_carry_mask_003";
              assert.ok(
                events.includes(
                  `mailbox.importItem:${expectedMailboxItemId}`,
                ),
                events.join(","),
              );
              if (handlingSecondConversation) {
                secondCheckpointConversationHandled.resolve();
              } else {
                firstCheckpointConversationHandled.resolve();
              }
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: reminderReconciled
                  ? reminderWakeAt
                  : reconciliationWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: null,
              nextWakeReason: null,
              progressed: true,
            };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        olderWakeHotAttemptComplete.promise,
        15_000,
        () => events.join(","),
      );
      await waitForFakeTimerScheduled(() => events.join(","));
      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_entrypoint_assistant_carry_mask_002",
        laneSeq: "2",
      }));
      runtimeWakeSignal.notify(Date.parse(TEST_NOW));
      await withRealTimeout(reminderCreated.promise, 15_000, () => events.join(","));
      if (checkpointAssistantInputRetry) {
        await withRealTimeout(
          assistantInputRetryFailed.promise,
          15_000,
          () => events.join(","),
        );
      }
      await new Promise((resolve) => REAL_SET_TIMEOUT(resolve, 0));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      await withRealTimeout(olderWakePersisted.promise, 15_000, () => events.join(","));
      if (checkpointTrustedCompletionRetry) {
        await withRealTimeout(
          trustedCompletionRetryFailed.promise,
          15_000,
          () => events.join(","),
        );
      }
      if (checkpointFreshTerminalConversation) {
        await withRealTimeout(
          freshTerminalConversationHandled.promise,
          15_000,
          () => events.join(","),
        );
        await new Promise((resolve) => REAL_SET_TIMEOUT(resolve, 0));
        await waitForFakeTimerScheduled(() => events.join(","));
        assert.equal(
          events.some((event) => event.startsWith("snapshot:2:")),
          false,
          events.join(","),
        );
        await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - 1);
        assert.equal(
          events.some((event) => event.startsWith("snapshot:2:")),
          false,
          events.join(","),
        );
        await vi.advanceTimersByTimeAsync(1);
      }
      if (generatedImageRetention) {
        assert.deepEqual(
          (await readHostedSystemMailboxState(vaultRoot)).pending,
          [],
        );
        const cronStatus = await getAssistantCronStatus(vaultRoot);
        assert.equal(cronStatus.dueJobs, 0);
        assert.equal(cronStatus.nextRunAt, reminderWakeAt);
        const firstIdleCheckpointIndex = checkpointRequests.findIndex(
          (request) => request.reason === "idle_shutdown",
        );
        const retentionCanonicalWrite = checkpointRequests
          .slice(0, firstIdleCheckpointIndex)
          .filter((request) => request.reason === "canonical_runtime_commit")
          .at(-1);
        assert.ok(retentionCanonicalWrite);
        assert.equal(retentionCanonicalWrite.nextWakeAt, olderDueWakeAt);
        assert.equal(retentionCanonicalWrite.nextWakeReason, "assistant");
        const firstSnapshotIndex = events.findIndex((event) =>
          event.startsWith("snapshot:1:idle_shutdown:")
        );
        assert.notEqual(firstSnapshotIndex, -1, events.join(","));
        assert.ok(
          requireEventIndex(
            events,
            `workspace.checkpoint:canonical_runtime_commit:${olderDueWakeAt}`,
          ) < firstSnapshotIndex,
          events.join(","),
        );
      }

      const persistedDispatchIndex = events.indexOf(
        "runtime-wake:persisted-older-assistant",
      );
      assert.notEqual(persistedDispatchIndex, -1, events.join(","));

      if (checkpointTrustedCompletion || checkpointTrustedCompletionRetry) {
        await withRealTimeout(
          trustedCompletionHandled.promise,
          15_000,
          () => events.join(","),
        );
        await new Promise((resolve) => REAL_SET_TIMEOUT(resolve, 0));
        await waitForFakeTimerScheduled(() => events.join(","));
        assert.equal(
          events.some((event) => event.startsWith("snapshot:2:")),
          false,
          events.join(","),
        );

        await vi.advanceTimersByTimeAsync(1_000);
        mailboxItems.push(createMailboxItem({
          id: "mailbox_item_entrypoint_assistant_carry_mask_004",
          laneSeq: "3",
        }));
        runtimeWakeSignal.notify(Date.now());
        await withRealTimeout(
          secondCheckpointConversationHandled.promise,
          15_000,
          () => events.join(","),
        );
        await new Promise((resolve) => REAL_SET_TIMEOUT(resolve, 0));
        await waitForFakeTimerScheduled(() => events.join(","));

        await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - 1);
        assert.equal(
          events.some((event) => event.startsWith("snapshot:2:")),
          false,
          events.join(","),
        );
        await vi.advanceTimersByTimeAsync(1);
      }

      if (checkpointAssistantInputRetry) {
        await withRealTimeout(
          assistantInputRetryHandled.promise,
          15_000,
          () => events.join(","),
        );
        await new Promise((resolve) => REAL_SET_TIMEOUT(resolve, 0));
        await waitForFakeTimerScheduled(() => events.join(","));
        assert.equal(
          events.some((event) => event.startsWith("snapshot:2:")),
          false,
          events.join(","),
        );
        await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - 1);
        assert.equal(
          events.some((event) => event.startsWith("snapshot:2:")),
          false,
          events.join(","),
        );
        await vi.advanceTimersByTimeAsync(1);
        await withRealTimeout(
          (async () => {
            while (!events.some((event) => event.startsWith("snapshot:2:"))) {
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
          })(),
          15_000,
          () => events.join(","),
        );
        const secondSnapshotIndex = events.findIndex((event) =>
          event.startsWith("snapshot:2:")
        );
        assert.equal(
          events[secondSnapshotIndex],
          `snapshot:2:idle_shutdown:${
            Date.parse(TEST_NOW) + 2 * idleCheckpointDelayMs
          }`,
        );
        assert.ok(
          requireEventIndex(events, "assistant-input-retry:handled")
            < secondSnapshotIndex,
          events.join(","),
        );
        return;
      }

      if (checkpointConversation) {
        await withRealTimeout(
          firstCheckpointConversationHandled.promise,
          15_000,
          () => events.join(","),
        );
        await new Promise((resolve) => REAL_SET_TIMEOUT(resolve, 0));
        await waitForFakeTimerScheduled(() => events.join(","));
        assert.equal(
          events.some((event) => event.startsWith("snapshot:2:")),
          false,
          events.join(","),
        );

        await vi.advanceTimersByTimeAsync(1_000);
        mailboxItems.push(createMailboxItem({
          id: "mailbox_item_entrypoint_assistant_carry_mask_004",
          laneSeq: "4",
        }));
        runtimeWakeSignal.notify(Date.now());
        await withRealTimeout(
          secondCheckpointConversationHandled.promise,
          15_000,
          () => events.join(","),
        );
        await new Promise((resolve) => REAL_SET_TIMEOUT(resolve, 0));
        await waitForFakeTimerScheduled(() => events.join(","));

        await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - 1);
        assert.equal(
          events.some((event) => event.startsWith("snapshot:2:")),
          false,
          events.join(","),
        );
        await vi.advanceTimersByTimeAsync(1);
      }

      await withRealTimeout(
        reminderWakePersisted.promise,
        15_000,
        () => JSON.stringify({ checkpointRequests, events }, null, 2),
      );
      const persistedWakes = checkpointRequests
        .filter((request) => request.reason === "idle_shutdown")
        .map((request) => [request.nextWakeAt, request.nextWakeReason]);
      assert.deepEqual(persistedWakes.slice(0, 2), [
        [olderDueWakeAt, "assistant"],
        [reminderWakeAt, "assistant"],
      ]);
      const secondSnapshotIndex = events.findIndex((event) =>
        event.startsWith("snapshot:2:")
      );
      assert.notEqual(secondSnapshotIndex, -1, events.join(","));
      if (checkpointTrustedCompletion || checkpointTrustedCompletionRetry) {
        const trustedCompletionImportIndex = requireEventIndex(
          events,
          "mailbox.importItem:"
          + "mailbox_item_entrypoint_assistant_carry_mask_"
          + "trusted_completion_001",
        );
        const trustedCompletionHandledIndex = requireEventIndex(
          events,
          "trusted-completion:handled",
        );
        const reconciliationAssistantIndex = events.findIndex((event) =>
          event.startsWith("assistant:")
          && event.includes(`:${reconciliationWakeAt}:`)
        );
        if (checkpointTrustedCompletionRetry) {
          assert.ok(
            trustedCompletionImportIndex < persistedDispatchIndex,
            events.join(","),
          );
        } else {
          assert.ok(
            trustedCompletionImportIndex > persistedDispatchIndex,
            events.join(","),
          );
        }
        assert.ok(trustedCompletionHandledIndex > trustedCompletionImportIndex, events.join(","));
        if (checkpointTrustedCompletionRetry) {
          assert.ok(
            reconciliationAssistantIndex < trustedCompletionHandledIndex,
            events.join(","),
          );
        } else {
          assert.ok(
            reconciliationAssistantIndex >= trustedCompletionHandledIndex,
            events.join(","),
          );
        }
        assert.ok(reconciliationAssistantIndex < secondSnapshotIndex, events.join(","));
        assert.ok(
          requireEventIndex(
            events,
            "mailbox.importItem:mailbox_item_entrypoint_assistant_carry_mask_004",
          ) < secondSnapshotIndex,
          events.join(","),
        );
        assert.equal(
          events[secondSnapshotIndex],
          `snapshot:2:idle_shutdown:${
            Date.parse(TEST_NOW)
            + idleCheckpointDelayMs
            + 1_000
            + idleCheckpointDelayMs
          }`,
        );
        return;
      }
      if (checkpointFreshTerminalConversation) {
        assert.equal(
          events[secondSnapshotIndex],
          `snapshot:2:idle_shutdown:${
            Date.parse(TEST_NOW) + 2 * idleCheckpointDelayMs
          }`,
        );
        assert.ok(
          requireEventIndex(
            events,
            "mailbox.importItem:"
            + "mailbox_item_entrypoint_assistant_carry_mask_fresh_terminal",
          ) < secondSnapshotIndex,
          events.join(","),
        );
        assert.ok(
          requireEventIndex(events, "fresh-terminal-conversation:handled")
            < secondSnapshotIndex,
          events.join(","),
        );
        return;
      }
      if (!checkpointConversation) {
        assert.equal(
          events[secondSnapshotIndex],
          `snapshot:2:idle_shutdown:${Date.parse(TEST_NOW) + idleCheckpointDelayMs}`,
        );
        const reconciliationAssistantIndex = events.findIndex((event) =>
          event.includes(`:${reconciliationWakeAt}:`)
        );
        assert.ok(
          reconciliationAssistantIndex > persistedDispatchIndex,
          events.join(","),
        );
        assert.ok(reconciliationAssistantIndex < secondSnapshotIndex, events.join(","));
        const systemControlImportIndex = events.indexOf(
          "mailbox.importItem:mailbox_item_entrypoint_assistant_carry_mask_system_001",
        );
        if (checkpointSystemControl) {
          assert.ok(systemControlImportIndex > persistedDispatchIndex, events.join(","));
          assert.ok(systemControlImportIndex < reconciliationAssistantIndex, events.join(","));
        } else {
          assert.equal(systemControlImportIndex, -1, events.join(","));
          assert.equal(
            events.slice(persistedDispatchIndex + 1).some((event) =>
              event.startsWith("mailbox.importItem:")
            ),
            false,
            events.join(","),
          );
        }
        return;
      }
      const firstForegroundAssistantIndex = events.findIndex((event) =>
        event.startsWith("assistant:4:")
      );
      const secondForegroundAssistantIndex = events.findIndex((event) =>
        event.startsWith("assistant:6:")
      );
      const reconciliationAssistantIndex = events.findIndex((event) =>
        event.includes(`:${reconciliationWakeAt}:`)
      );
      assert.notEqual(firstForegroundAssistantIndex, -1, events.join(","));
      assert.notEqual(secondForegroundAssistantIndex, -1, events.join(","));
      assert.notEqual(reconciliationAssistantIndex, -1, events.join(","));
      assert.equal(
        events[secondSnapshotIndex],
        `snapshot:2:idle_shutdown:${
          Date.parse(TEST_NOW) + idleCheckpointDelayMs + 1_000 + idleCheckpointDelayMs
        }`,
      );
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_assistant_carry_mask_003",
        ) < secondSnapshotIndex,
        events.join(","),
      );
      assert.ok(
        firstForegroundAssistantIndex < secondSnapshotIndex,
        events.join(","),
      );
      assert.ok(
        reconciliationAssistantIndex < secondSnapshotIndex,
        events.join(","),
      );
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_assistant_carry_mask_004",
        ) < secondSnapshotIndex,
        events.join(","),
      );
      assert.ok(
        secondForegroundAssistantIndex < secondSnapshotIndex,
        events.join(","),
      );
    } finally {
      runtimeAbortController.abort();
      vi.useRealTimers();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(workspaceRoot);
    }
  });

  test("carried due device-sync wake is preserved verbatim when the pass observes no due work", async () => {
    // Without a fresh due observation, the carried due token keeps its exact
    // timestamp and reason so checkpoint-gate identity stays stable and the
    // orchestrator's device-sync branch still owns servicing it.
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const staleDeviceWakeAt = new Date(Date.now() - 9 * 60 * 60 * 1_000).toISOString();

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_stale_device_wake_preserved",
            idleCheckpointDelayMs: 25,
            leaseGeneration: "3",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "9".repeat(64),
                key: "users/bundles/member-synthetic/stale-device-wake-preserved.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_stale_device_wake_002",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleDeviceWakeAt,
                nextWakeReason: "device-sync.reconcile",
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: null,
              nextWakeReason: null,
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      // Depending on whether the idle checkpoint or the import reconciliation
      // lands first, the carried token is either preserved or replaced by the
      // pass's own (null) authority. The invariant: a surviving carried due
      // token keeps its exact timestamp and reason — never re-stamped to a
      // fresh clock reading, never re-labelled to another reason.
      const observedWakes = [
        ...checkpointRequests.map((request) => [
          request.nextWakeAt ?? null,
          request.nextWakeReason ?? null,
        ]),
        [result.nextWakeAt, result.nextWakeAt === null ? null : "device-sync.reconcile"],
      ];
      for (const [wakeAt, reason] of observedWakes) {
        assert.ok(
          wakeAt === null
            || (wakeAt === staleDeviceWakeAt && reason === "device-sync.reconcile"),
          `carried due token was re-stamped or re-labelled: ${wakeAt}:${reason}`,
        );
      }
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not dirty-checkpoint a consumed alarm wake when the assistant phase ends idle", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const staleWakeAt = "2026-04-27T00:05:00.000Z";

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "7".repeat(64),
                key: "users/bundles/member-synthetic/alarm-idle.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Import should not run when no mailbox items are fetched.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleWakeAt,
                nextWakeReason: "assistant",
                version: "0",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "mailbox.fetch",
      ]);
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(result, {
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 0,
          hostedMailboxImportedCount: 0,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    {
      checkpointed: false,
      expectedWorkspaceVersion: "0",
      label: "no-progress",
    },
    {
      checkpointed: true,
      expectedWorkspaceVersion: "1",
      label: "post-checkpoint",
    },
  ])(
    "schedules one delayed continuation in the $label path when forced browser-vault refresh maintenance times out",
    async ({ checkpointed, expectedWorkspaceVersion, label }) => {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
      const attemptId = `attempt_synthetic_browser_vault_marker_force_${label}`;
      const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const events: string[] = [];
      const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      const retryAt = new Date(Date.parse(TEST_NOW) + 60_000).toISOString();

      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockResolvedValueOnce({
        attempt: "initial",
        configuredTimeoutMs: 30_000,
        currentStepElapsedMs: 12_000,
        refreshElapsedMs: 30_000,
        refreshStage: "replica_write",
        refreshStep: "replica_write",
        source: { fileCount: 7, totalBytes: 4_096 },
        status: "deferred_timeout",
      });

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date(TEST_NOW));
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
        await initializeVault({ createdAt: TEST_NOW, vaultRoot });

        const result = await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot() {
              return {
                snapshotRef: createBundleRef({
                  hash: "e".repeat(64),
                  key: `users/bundles/member-synthetic/browser-vault-timeout-${label}.bundle.json`,
                  size: 512,
                }),
              };
            },
            async importItem() {
              throw new Error("Import should not run when no mailbox items are fetched.");
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({ events, items: [] }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            async runAssistantPhase() {
              return checkpointed
                ? {
                    browserVaultReplicaRefreshRequested: true,
                    checkpointReason: "assistant_runtime_commit" as const,
                    progressed: true as const,
                  }
                : {
                    browserVaultReplicaRefreshRequested: true,
                    progressed: false as const,
                  };
            },
            vaultRoot,
          },
        );

        expect(mocks.refreshHostedBrowserVaultReplicaFromRuntime).toHaveBeenCalledTimes(1);
        expect(mocks.refreshHostedBrowserVaultReplicaFromRuntime).toHaveBeenCalledWith(
          expect.objectContaining({
            force: true,
            vaultRoot,
            workspace: expect.objectContaining({
              version: expectedWorkspaceVersion,
            }),
          }),
        );
        expect(checkpointRequests).toHaveLength(checkpointed ? 1 : 0);
        expect(result.status).toBe("scheduled");
        expect(result.nextWakeAt).toBe(retryAt);
        expect(result.nextWakeReason).toBe("assistant");
        expect(result.immediateRecheckRequested).toBeUndefined();
        const refreshLog = readCapturedRuntimePhaseLogs({
          attemptId,
          spy: consoleInfo,
        }).find((entry) =>
          entry.details.runtimePhase === "browser_vault.refresh"
          && entry.details.runtimePhaseStatus === "done"
          && entry.details.browserVaultRefreshStatus === "deferred_timeout"
        );
        assert.ok(refreshLog);
        expect(Object.fromEntries(
          Object.entries(refreshLog.details).filter(([key]) => key.startsWith("browserVault")),
        )).toEqual({
          browserVaultRefreshAttempt: "initial",
          browserVaultRefreshConfiguredTimeoutMs: 30_000,
          browserVaultRefreshCurrentStepElapsedMs: 12_000,
          browserVaultRefreshElapsedMs: 30_000,
          browserVaultRefreshStage: "replica_write",
          browserVaultRefreshStatus: "deferred_timeout",
          browserVaultRefreshStep: "replica_write",
          browserVaultReplicaSourceFileCount: 7,
          browserVaultReplicaSourceTotalBytes: 4_096,
        });
      } finally {
        if (previousStdIoLogSetting === undefined) {
          delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
        } else {
          process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
        }
        consoleInfo.mockRestore();
        mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
        vi.useRealTimers();
        await removeTempRoot(vaultRoot);
      }
    },
  );

  test("retries the requested browser-vault refresh after a browser-only wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const browserItems: HostedMailboxItem[] = [];
    const refreshImplementation =
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.getMockImplementation();
    let assistantPhaseCount = 0;
    let refreshCount = 0;

    mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(async () => {
      refreshCount += 1;
      if (refreshCount === 1) {
        events.push("browser.refresh:deferred");
        browserItems.push(createMailboxItem({
          dedupeKey: "runtime-control:browser-vault-refresh:later",
          id: "mailbox_browser_refresh_later",
          kind: "runtime.browser-vault-refresh-requested",
          lane: "system",
          laneSeq: "1",
        }));
        runtimeWakeSignal.notify();
        return {
          source: { fileCount: 0, totalBytes: 0 },
          status: "deferred_runtime_wake",
        };
      }
      events.push("browser.refresh:completed");
      return { status: "skipped_no_port" };
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_browser_refresh_browser_only_wake",
            idleCheckpointDelayMs: 1,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/browser-refresh-order.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: browserItems }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            assistantPhaseCount += 1;
            return assistantPhaseCount === 1
              ? {
                  browserVaultReplicaRefreshRequested: true,
                  checkpointReason: "canonical_runtime_commit",
                  progressed: true,
                }
              : { progressed: false };
          },
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      const deferredIndex = events.indexOf("browser.refresh:deferred");
      const completedIndex = events.indexOf("browser.refresh:completed");
      expect(deferredIndex).toBeGreaterThan(-1);
      expect(completedIndex).toBeGreaterThan(deferredIndex);
      expect(events.slice(deferredIndex + 1, completedIndex)).toContain("mailbox.fetch");
    } finally {
      const restoreRefreshImplementation =
        refreshImplementation
        ?? mocks.actualRefreshHostedBrowserVaultReplicaFromRuntime;
      if (restoreRefreshImplementation) {
        mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(
          restoreRefreshImplementation,
        );
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("skips no-progress browser-vault refresh after shutdown begins", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const shutdownController = new AbortController();

    mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_browser_vault_shutdown_skip",
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("No-progress shutdown refresh test should not checkpoint.");
          },
          async importItem() {
            throw new Error("Import should not run when no mailbox items are fetched.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            shutdownController.abort(
              new DOMException("Synthetic container SIGTERM.", "AbortError"),
            );
            return {
              browserVaultReplicaRefreshRequested: true,
              progressed: false,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      expect(mocks.refreshHostedBrowserVaultReplicaFromRuntime).not.toHaveBeenCalled();
      expect(result.status).toBe("idle");
    } finally {
      shutdownController.abort(new Error("Test cleanup."));
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    {
      label: "assistant-labeled",
      nextWakeReason: "assistant" as const,
    },
    {
      label: "null-labeled",
      nextWakeReason: null,
    },
    {
      label: "explicit device-sync",
      nextWakeReason: "device-sync.reconcile" as const,
    },
  ])("e2e clears stale $label scheduled device-sync wake when no dirty work remains", async (input) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const staleWakeAt = "2026-04-26T23:59:59.000Z";

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            idleCheckpointDelayMs: 1,
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/stale-device-sync-clear.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Import should not run when no mailbox items are fetched.");
          },
          platform: createPlatform({
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleWakeAt,
                nextWakeReason: input.nextWakeReason,
                version: "0",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      const expectedEvents = [
        "workspace.read",
        "mailbox.fetch",
        "mailbox.fetch",
        ...(input.nextWakeReason === "device-sync.reconcile"
          ? ["workspace.checkpoint"]
          : []),
        "snapshot:idle_shutdown",
        "workspace.checkpoint",
      ];
      assert.deepEqual(events, expectedEvents);
      const shouldRunDeviceSync = input.nextWakeReason === "device-sync.reconcile";
      assert.equal(deviceSyncPort.fetchSnapshotCalls, shouldRunDeviceSync ? 1 : 0);
      assert.equal(deviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.equal(checkpointRequests.length, shouldRunDeviceSync ? 2 : 1);
      const terminalCheckpoint = checkpointRequests.at(-1);
      assert.equal(terminalCheckpoint?.reason, "idle_shutdown");
      assert.equal(terminalCheckpoint?.nextWakeAt, null);
      assert.equal(terminalCheckpoint?.nextWakeReason, null);
      if (shouldRunDeviceSync) {
        assert.equal(checkpointRequests[0]?.reason, "canonical_runtime_commit");
        assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
        assert.equal(typeof checkpointRequests[0]?.nextWakeAt, "string");
      }
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.redactedStatus?.hostedMailboxFetchedCount, 0);
      assert.equal(result.redactedStatus?.hostedMailboxImportedCount, 0);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  });
