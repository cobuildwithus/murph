import {
  TEST_NOW,
  TEST_USER_ID,
  createBrowserVaultReplicaRef,
  createBundleRef,
  createAssistantAskRequestedWake,
  createConsentedMemberAssistantAskRequestedWake,
  createDeferred,
  createDeviceSyncResolvedConfig,
  createDeviceSyncSystemWakeForMailboxItem,
  createEmptyDeviceSyncPort,
  createMailboxItem,
  createMailboxPort,
  createOperatorTaskAssistantAskRequestedWake,
  createPlatform,
  createResolvedAssistantAskSystemMailboxItem,
  createResolvedDeviceSyncSystemMailboxItem,
  createResolvedRuntimeControlSystemMailboxItem,
  createSnapshotDeviceSyncPort,
  createVaultSnapshotBundle,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceSnapshotV2Ref,
  createWorkspaceState,
  enqueueDeviceSyncSystemMailboxItemForTest,
  enqueueEnvironmentInterviewSystemMailboxItemForTest,
  enqueuePendingEffectsSystemMailboxItemForTest,
  mocks,
  readCapturedRuntimePhaseLogs,
  readCheckpointConversationWatermark,
  removeTempRoot,
  requireEventIndex,
  stageAssistantInputEventForMailboxItem,
  stagePendingLinqAssistantInputForMailboxItem,
  withRealTimeout,
  writeSyntheticAssistantAutoReplyTerminalEvidence,
  writeMailboxImportStateFile,
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
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionEnvironmentInterviewCompletedWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionRuntimeControlWake,
  deriveHostedExecutionErrorCode,
} from "@murphai/hosted-execution";
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
  buildHostedWorkspaceSnapshotV2Aad,
  HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_V2_AAD_PURPOSE,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
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
  runHostedWorkspaceAssistantPhase,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";
import {
  createHostedWorkspaceRuntimeBridgeJobOptions,
  type HostedWorkspaceSnapshotArchiveBuilder,
} from "../src/hosted-runtime/snapshot-bridge.ts";
import {
  markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort,
  restoreHostedWorkspaceRuntimeJobWorkspace,
  writeHostedWorkspaceCleanCheckpointMarkerBestEffort,
} from "../src/hosted-runtime/workspace-restore.ts";
import {
  createEmptyHostedMailboxImportState,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
  HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
  readHostedMailboxImportState,
  writeHostedMailboxImportState,
  type HostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";
import {
  enqueueHostedSystemMailboxItem,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  findNextHostedSystemMailboxQueueItem,
  isHostedSystemMailboxModelFreeExactNotificationItem,
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  HostedRuntimeArtifactReadError,
  type HostedRuntimeDeviceSyncPort,
  type HostedRuntimePlatform,
  type RuntimeLivenessPort,
  type HostedRuntimeWorkspacePort,
  type HostedRuntimeWorkspaceSnapshotPort,
} from "../src/hosted-runtime-contracts.ts";

describe("hosted workspace runtime entrypoint", () => {test("reads workspace, imports mailbox prefix, snapshots through the semantic checkpoint builder, and checkpoints", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const items = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_001",
        laneSeq: "1",
      }),
    ];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      events,
      workspace: createWorkspaceState({ version: "0" }),
    });
    const mailboxPort = createMailboxPort({ events, items });
    const imported: Array<{ id: string; route: string }> = [];
    const importContextMilestones: unknown[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    runtimeWakeSignal.notify({
      notifiedAtEpochMs: 1_777_000_000_075,
      orchestration: {
        activeFenceObservedAtEpochMs: 1_777_000_000_060,
        activeFenceTargetWasPriorVersion: false,
        activeWakeAccepted: true,
        activeWakeFinishedAtEpochMs: 1_777_000_000_075,
        activeWakeStartedAtEpochMs: 1_777_000_000_065,
        triggeredByWebDirect: true,
      },
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_workspace_entrypoint",
            budget: {
              maxMailboxItems: 10,
            },
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            const state = await readHostedMailboxImportState({ vaultRoot });
            events.push(`snapshot:${state.watermarks.conversation}`);
            assert.equal(await readCheckpointConversationWatermark(snapshotInput, vaultRoot), "1");
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/workspace-entrypoint.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            imported.push({
              id: item.item.id,
              route: item.route.action,
            });
            events.push(`import:${item.item.id}`);
            // Snapshot at call time: the milestone object is shared and mutated
            // by the runtime across the post-restore phase-breakdown rebuild.
            importContextMilestones.push(structuredClone(context?.latencyMilestones ?? null));
            return { status: "imported" };
          },
          // Incoming container-side milestones: the post-restore rebuild must
          // PRESERVE the dispatch sub-object alongside the rebuilt restore/boot
          // (a dropped dispatch here previously killed the instrumentation
          // end-to-end despite valid headers and a valid parser).
          latencyMilestones: {
            phaseBreakdown: {
              schemaVersion: 1,
              orchestration: {
                activeFenceObservedAtEpochMs: 1_776_999_999_910,
                activeFenceTargetWasPriorVersion: true,
                activeWakeAccepted: false,
                activeWakeElapsedMs: 20,
                activeWakeFinishedAtEpochMs: 1_776_999_999_940,
                activeWakeFoundNoActiveChild: true,
                activeWakeStartedAtEpochMs: 1_776_999_999_920,
                freshStartInvocationAcceptedAtEpochMs: 1_776_999_999_990,
                freshStartRequestedAtEpochMs: 1_776_999_999_900,
                replacedStaleFence: true,
                replacementFenceClearElapsedMs: 5,
                replacementFenceClearedAtEpochMs: 1_776_999_999_950,
                replacementFenceClearStartedAtEpochMs: 1_776_999_999_945,
                triggeredByWebDirect: false,
              },
              dispatch: {
                invokeReceivedAtEpochMs: 1_777_000_000_000,
                containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
              },
              boot: { nodeStartupMs: 4321 },
            },
            runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          },
          platform: createPlatform({
            mailboxPort,
            workspacePort,
          }),
          runtimeWakeSignal,
          vaultRoot,
        });
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:mailbox_item_entrypoint_001",
        "snapshot:1",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(imported, [
        {
          id: "mailbox_item_entrypoint_001",
          route: "import-conversation-message",
        },
      ]);
      expect(importContextMilestones).toEqual([
        expect.objectContaining({
          phaseBreakdown: expect.objectContaining({
            schemaVersion: 1,
            orchestration: {
              activeFenceObservedAtEpochMs: 1_776_999_999_910,
              activeFenceTargetWasPriorVersion: true,
              activeWakeAccepted: false,
              activeWakeElapsedMs: 20,
              activeWakeFinishedAtEpochMs: 1_776_999_999_940,
              activeWakeFoundNoActiveChild: true,
              activeWakeStartedAtEpochMs: 1_776_999_999_920,
              freshStartInvocationAcceptedAtEpochMs: 1_776_999_999_990,
              freshStartRequestedAtEpochMs: 1_776_999_999_900,
              replacedStaleFence: true,
              replacementFenceClearElapsedMs: 5,
              replacementFenceClearedAtEpochMs: 1_776_999_999_950,
              replacementFenceClearStartedAtEpochMs: 1_776_999_999_945,
              triggeredByWebDirect: false,
            },
            dispatch: {
              invokeReceivedAtEpochMs: 1_777_000_000_000,
              containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
            },
            boot: expect.objectContaining({
              nodeStartupMs: 4321,
              restoreWasCold: expect.any(Boolean),
            }),
            wake: expect.objectContaining({
              runtimeWakeNotifiedAtEpochMs: 1_777_000_000_075,
              foregroundWaitResolvedAtEpochMs: expect.any(Number),
              foregroundImportStartedAtEpochMs: expect.any(Number),
            }),
          }),
          runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          runtimePhaseStartedAt: expect.any(String),
          workspaceRestoreDoneAt: expect.any(String),
        }),
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.deepEqual(result, {
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "1",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 1,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemHandledThroughSeq: "0",
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("exports pending assistant runtime issues after an idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const exportedIssueIds: string[] = [];
    const exportedIssues: unknown[] = [];
    const issueRecord = {
      component: "assistant.codex-action",
      details: {
        actionKind: "command.execution",
        durationMsBucket: "lt_1s",
        exitCode: 1,
        outputBytesBucket: "0",
      },
      environment: "hosted" as const,
      errorCode: "CODEX_COMMAND_EXIT_NONZERO",
      fingerprint: "abcdef123456abcdef123456",
      issueId: "ari_0123456789abcdef_abcdef123456abcdef123456",
      issueKind: "tool_error" as const,
      occurredAt: "2026-04-27T00:00:00.000Z",
      operation: "command.execution",
      phase: "provider_turn" as const,
      releaseSha: "0123456789abcdef0123456789abcdef01234567",
      runtimeAttemptId:
        "runtime-write-e2cfcf20-f792-4133-b40b-3f381b371dda",
      runtimeName: "cloudflare-hosted-runner",
      schema: "murph.assistant-runtime-issue.v1" as const,
      severity: "warning" as const,
      summary: "Codex command execution failed during provider turn.",
      surface: null,
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_issue_export",
            budget: {
              maxMailboxItems: 10,
            },
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push("snapshot");
            assert.equal(await readCheckpointConversationWatermark(snapshotInput, vaultRoot), "1");
            assert.deepEqual(
              (await listPendingAssistantRuntimeIssueRecords({ vault: vaultRoot }))
                .map((record) => record.issueId),
              [issueRecord.issueId],
            );
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/issue-export.bundle.json",
                size: 256,
              }),
            };
          },
          async importItem() {
            events.push("import");
            await writePendingAssistantRuntimeIssueRecord({
              record: issueRecord,
              vault: vaultRoot,
            });
            return { status: "imported" };
          },
          platform: createPlatform({
            events,
            issueExportPort: {
              async recordIssues(issues) {
                events.push("issue.export");
                exportedIssues.push(...issues);
                const issueIds = issues.map((issue) => {
                  const issueId = (issue as { issueId?: unknown }).issueId;
                  if (typeof issueId !== "string") {
                    throw new Error("expected exported issue id");
                  }
                  return issueId;
                });
                exportedIssueIds.push(...issueIds);
                return {
                  issueIds,
                  recorded: issues.length,
                };
              },
            },
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_issue_export_001",
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
          vaultRoot,
        },
      );

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.deepEqual(exportedIssueIds, [issueRecord.issueId]);
      assert.deepEqual(exportedIssues, [issueRecord]);
      assert.ok(
        events.indexOf("snapshot") < events.indexOf("workspace.checkpoint"),
        "workspace checkpoint should commit the dirty workspace snapshot before telemetry",
      );
      assert.ok(
        events.indexOf("workspace.checkpoint") < events.indexOf("issue.export"),
        "issue export should run after the durable workspace checkpoint",
      );
      assert.deepEqual(await listPendingAssistantRuntimeIssueRecords({ vault: vaultRoot }), []);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("imports system bootstrap before initial conversation import for cold vaults", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const imported: string[] = [];
    const assistantWorkspaceVersions: string[] = [];
    let bootstrapImported = false;
    mocks.prepareHostedCodexAssistantProcess.mockClear();
    mocks.cancelPendingWarmCodexPreinitialization.mockClear();

    const conversationItem = createMailboxItem({
      id: "mailbox_item_entrypoint_image_only_001",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: "1",
    });
    const systemItem = createMailboxItem({
      id: "mailbox_item_entrypoint_member_activated_001",
      kind: "member.activated",
      lane: "system",
      laneSeq: "1",
    });

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_cold_conversation_bootstrap",
            budget: {
              maxMailboxItems: 10,
            },
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            assert.equal(snapshotInput.reason, "idle_shutdown");
            assert.equal(await readCheckpointConversationWatermark(snapshotInput, vaultRoot), "1");
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/cold-bootstrap.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            imported.push(`${item.item.lane}:${item.item.kind}`);
            if (item.item.kind === "member.activated") {
              await initializeVault({ createdAt: TEST_NOW, vaultRoot });
              bootstrapImported = true;
              return { status: "imported" };
            }

            assert.equal(bootstrapImported, true);
            context?.onConversationInputStaged?.("linq");
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
              fetchRequests,
              items: [conversationItem, systemItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            const workspaceVersion = input.workspace?.version ?? "missing";
            assistantWorkspaceVersions.push(workspaceVersion);
            assert.equal(
              typeof input.workspace?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
              workspaceVersion === "1" ? "string" : "undefined",
            );
            assert.equal(input.initialMailboxImport.state.watermarks.system, "1");
            assert.equal(input.initialMailboxImport.state.watermarks.conversation, "1");
            return {
              progressed: false,
              redactedStatus: {
                hostedAssistantProgressed: false,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)), [
        ["system", "conversation"],
        ["conversation"],
        ["system"],
      ]);
      assert.deepEqual(imported, [
        "system:member.activated",
        "conversation:conversation.message",
      ]);
      assert.deepEqual(assistantWorkspaceVersions, ["1", "2"]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "canonical_runtime_commit",
        "idle_shutdown",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["0", "1"],
      );
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxSystemImportedSeq,
        "1",
      );
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "1",
      );
      assert.equal(
        typeof checkpointRequests[0]?.redactedStatus?.hostedCanonicalWriteReceiptLogSha256,
        "string",
      );
      assert.match(checkpointRequests[0]?.nextWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(checkpointRequests[1]?.nextWakeAt, checkpointRequests[0]?.nextWakeAt);
      assert.equal(checkpointRequests[1]?.nextWakeReason, "assistant");
      assert.equal(result.nextWakeAt, checkpointRequests[0]?.nextWakeAt);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(
        mocks.cancelPendingWarmCodexPreinitialization.mock.calls.length,
        0,
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    {
      expectedStatus: "idle" as const,
      expectedWakeReason: null,
      initialWakeAt: null,
      initialWakeReason: null,
      name: "terminal system import does not invent assistant work",
      retrySecondItem: false,
    },
    {
      expectedStatus: "scheduled" as const,
      expectedWakeReason: "alarm",
      initialWakeAt: "2099-04-27T00:05:00.000Z",
      initialWakeReason: "alarm",
      name: "terminal system import preserves the committed wake",
      retrySecondItem: false,
    },
    {
      expectedStatus: "scheduled" as const,
      expectedWakeReason: "mailbox",
      initialWakeAt: null,
      initialWakeReason: null,
      name: "terminal system import preserves its mailbox retry",
      retrySecondItem: true,
    },
  ])("canonical checkpoint: $name", async (scenario) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_terminal_system_import",
        kind: "meal-photo.captured",
        lane: "system",
        laneSeq: "1",
      }),
      ...(scenario.retrySecondItem
        ? [createMailboxItem({
            id: "mailbox_item_retryable_system_import",
            kind: "meal-photo.captured",
            lane: "system",
            laneSeq: "2",
          })]
        : []),
    ];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput(),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/terminal-system-import.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            if (item.item.laneSeq === "2") {
              return {
                reasonCode: "synthetic_retryable_system_import",
                retryable: true,
                status: "blocked" as const,
              };
            }
            await runCanonicalWrite({
              mutate: async ({ batch }) => {
                await batch.stageTextWrite(
                  "bank/terminal-system-import.md",
                  "terminal system import\n",
                );
              },
              occurredAt: TEST_NOW,
              operationType: "hosted_terminal_system_import_test",
              summary: "Persist terminal system mailbox import",
              vaultRoot,
            });
            return { status: "imported" as const };
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
                nextWakeAt: scenario.initialWakeAt,
                nextWakeReason: scenario.initialWakeReason,
                version: "0",
              }),
            }),
          }),
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
      assert.equal(canonicalCheckpoint.redactedStatus?.hostedMailboxSystemImportedSeq, "1");
      assert.equal(canonicalCheckpoint.nextWakeReason, scenario.expectedWakeReason);
      if (scenario.expectedWakeReason === "mailbox") {
        assert.match(canonicalCheckpoint.nextWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      } else {
        assert.equal(canonicalCheckpoint.nextWakeAt, scenario.initialWakeAt);
      }
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, canonicalCheckpoint.nextWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, scenario.expectedWakeReason);
      assert.equal(result.nextWakeAt, canonicalCheckpoint.nextWakeAt);
      assert.equal(result.nextWakeReason ?? null, scenario.expectedWakeReason);
      assert.equal(result.status, scenario.expectedStatus);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox mode checkpoints the imported meal automation before cleaning staging", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const imported: string[] = [];
    mocks.prepareHostedCodexAssistantProcess.mockClear();
    mocks.cancelPendingWarmCodexPreinitialization.mockClear();
    const mealPhotoItem = createMailboxItem({
      dedupeKey: "meal-photo:system-mailbox-only",
      id: "mailbox_item_system_mailbox_only_meal",
      kind: "meal-photo.captured",
      lane: "system",
      laneSeq: "1",
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-only-before.bundle.json",
        vaultRoot,
      });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_only",
            processingMode: "system_mailbox",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-only.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            imported.push(`${item.item.lane}:${item.item.kind}`);
            await ensureAutomaticMealCloseoutAutomation({
              defaultRoute: {
                channel: "linq",
                deliverySource: null,
                deliveryTarget: null,
                identityId: null,
                participantId: null,
                threadId: "linq_home_thread",
                threadIsDirect: true,
              },
              routeValidationProfile: "hosted",
              vaultRoot,
            });
            return {
              afterCheckpoint: async () => {
                events.push("meal-photo.delete");
                return {
                  attachmentEvidenceUpdated: null,
                  kind: "meal_photo_cleanup" as const,
                  projectionUpdated: null,
                  reasonCode: "meal_photo.deleted",
                  status: "succeeded" as const,
                };
              },
              reasonCode: "meal_photo.imported",
              status: "imported",
            };
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [
                mealPhotoItem,
                createMailboxItem({
                  id: "mailbox_item_system_mailbox_only_conversation",
                  kind: "conversation.message",
                  lane: "conversation",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox processing must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.deepEqual(
        fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)),
        [["system"]],
      );
      assert.deepEqual(imported, ["system:meal-photo.captured"]);
      const importCheckpoint = checkpointRequests
        .slice()
        .reverse()
        .find((request) =>
          request.redactedStatus?.hostedMailboxSystemImportedSeq === "1"
        );
      assert.equal(
        importCheckpoint?.redactedStatus?.hostedMailboxSystemImportedSeq,
        "1",
      );
      assert.equal(
        importCheckpoint?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "0",
      );
      const cronStatus = await getAssistantCronStatus(vaultRoot, {
        turnEnvironment: {
          currentWorkingDirectory: null,
          env: {
            MURPH_HOSTED_RUNTIME_PROCESS: "1",
            VAULT: vaultRoot,
          },
        },
      });
      assert.ok(cronStatus.nextRunAt);
      assert.ok(importCheckpoint?.nextWakeAt);
      assert.equal(importCheckpoint?.nextWakeReason, "assistant");
      assert.equal(result.nextWakeAt, importCheckpoint?.nextWakeAt);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(
        mocks.cancelPendingWarmCodexPreinitialization.mock.calls.length,
        0,
      );
      assert.ok(
        requireEventIndex(events, "workspace.checkpoint")
          < requireEventIndex(events, "meal-photo.delete"),
        JSON.stringify(events),
      );
      await expect(showAutomation({
        automationId: MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
        vaultRoot,
      })).resolves.toMatchObject({
        schedule: {
          kind: "dailyLocal",
          localTime: "21:00",
        },
        status: "active",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox mode runs already-imported pending device-sync without new mailbox rows", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const staleAssistantWakeAt = "2026-04-26T23:59:59.000Z";
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:already-imported",
      id: "mailbox_item_system_mailbox_device_already_imported",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.prepareHostedCodexRuntimeEnvironment.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-already-imported-device-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_already_imported_device",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-already-imported-device.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleAssistantWakeAt,
                nextWakeReason: "assistant",
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox device-sync must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.deepEqual(
        fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)),
        [["system"]],
      );
      assert.equal(fetchRequests[0]?.lanes[0]?.importedSeq, "1");
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(deviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(mocks.prepareHostedCodexRuntimeEnvironment.mock.calls.length, 0);
      assert.equal(
        mocks.cancelPendingWarmCodexPreinitialization.mock.calls.length,
        0,
      );
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, null);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, null);
      assert.ok(checkpointRequests.length > 0);
      assert.equal(
        checkpointRequests.every((request) =>
          request.systemMailboxProgressGeneration === "0"
        ),
        true,
      );
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "1",
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.nextWakeReason ?? null, null);
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
      expect(mocks.refreshHostedBrowserVaultReplicaFromRuntime).toHaveBeenCalledTimes(1);
      expect(mocks.refreshHostedBrowserVaultReplicaFromRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          force: true,
          vaultRoot,
        }),
      );
    } finally {
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox mode converges restored handled progress exactly once without new mailbox rows", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    let snapshotOrdinal = 0;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.prepareHostedCodexRuntimeEnvironment.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-progress-convergence-before.bundle.json",
        vaultRoot,
      });
      artifactBytesByHash.set(restoredWorkspace.hash, restoredWorkspace.bytes);
      let currentWorkspace = createWorkspaceState({
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 0,
          hostedMailboxImportedCount: 0,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemHandledThroughSeq: "1",
          hostedMailboxSystemImportedSeq: "1",
        },
        snapshotRef: restoredWorkspace.snapshotRef,
        version: "0",
      });
      const workspacePort: HostedRuntimeWorkspacePort = {
        async checkpoint(request) {
          events.push("workspace.checkpoint");
          checkpointRequests.push(request);
          currentWorkspace = createWorkspaceState({
            inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
            nextDefaultProcessingWakeAt:
              request.nextDefaultProcessingWakeAt ?? null,
            nextDefaultProcessingWakeReason:
              request.nextDefaultProcessingWakeReason ?? null,
            nextWakeAt: request.nextWakeAt ?? null,
            nextWakeReason: request.nextWakeReason ?? null,
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: request.snapshotRef,
            systemMailboxProgressGeneration:
              request.systemMailboxProgressGeneration ?? null,
            version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
          });
          return {
            checkpointed: true,
            workspace: currentWorkspace,
          };
        },
        async read() {
          events.push("workspace.read");
          return {
            fetchedAt: TEST_NOW,
            workspace: currentWorkspace,
          };
        },
      };
      const runSystemMailboxPass = async (attemptId: string) =>
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              assistantExecutionBlocked: true,
              attemptId,
              processingMode: "system_mailbox",
              workspaceVersion: currentWorkspace.version,
            },
            resolvedConfig: createDeviceSyncResolvedConfig(),
          }),
          {
            async createCheckpointSnapshot() {
              snapshotOrdinal += 1;
              const snapshot = await createVaultSnapshotBundle({
                key: `users/bundles/member-synthetic/system-mailbox-progress-convergence-${snapshotOrdinal}.bundle.json`,
                vaultRoot,
              });
              artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
              return { snapshotRef: snapshot.snapshotRef };
            },
            async importItem() {
              throw new Error("Restored system mailbox progress must not import a new row.");
            },
            platform: createPlatform({
              artifactBytesByHash,
              deviceSyncPort,
              mailboxPort: createMailboxPort({
                events,
                fetchRequests,
                items: [],
              }),
              workspacePort,
            }),
            async runAssistantPhase() {
              throw new Error("System mailbox progress convergence must not enter assistant phase.");
            },
            vaultRoot,
          },
        );

      await runSystemMailboxPass(
        "attempt_synthetic_system_mailbox_progress_convergence_stabilize",
      );
      checkpointRequests.length = 0;
      events.length = 0;
      fetchRequests.length = 0;
      currentWorkspace = {
        ...currentWorkspace,
        redactedStatus: {
          ...currentWorkspace.redactedStatus,
          hostedMailboxSystemHandledThroughSeq: "0",
          hostedMailboxSystemImportedSeq: "1",
        },
      };

      const firstResult = await runSystemMailboxPass(
        "attempt_synthetic_system_mailbox_progress_convergence_first",
      );

      assert.equal(firstResult.status, "idle");
      assert.equal(
        checkpointRequests.length,
        1,
        JSON.stringify({
          events,
          checkpoints: checkpointRequests.map((request) => ({
            handled: request.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
            imported: request.redactedStatus?.hostedMailboxSystemImportedSeq,
            nextWakeAt: request.nextWakeAt,
            nextWakeReason: request.nextWakeReason,
          })),
        }),
      );
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxSystemImportedSeq,
        "1",
      );
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "1",
      );
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      const repairCheckpointLog = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_system_mailbox_progress_convergence_first",
        spy: consoleInfo,
      }).find((entry) =>
        entry.details.runtimePhase === "workspace.checkpoint.idle_shutdown"
        && entry.details.runtimePhaseStatus === "done"
        && entry.details.restoredSystemMailboxProgressAheadAtCheckpoint === true
      );
      assert.equal(repairCheckpointLog?.details.checkpointed, true);
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 0);
      assert.equal(deviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(mocks.prepareHostedCodexRuntimeEnvironment.mock.calls.length, 0);

      const secondResult = await runSystemMailboxPass(
        "attempt_synthetic_system_mailbox_progress_convergence_aligned",
      );

      assert.equal(secondResult.status, "idle");
      assert.equal(checkpointRequests.length, 1);
      assert.deepEqual(
        fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)),
        [["system"], ["system"]],
      );
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);

      for (const [scenario, importedSeq, handledThroughSeq] of [
        ["canonical_ahead", "2", "2"],
        ["crossed", "2", "0"],
        ["missing_imported", null, "1"],
        ["malformed_handled", "1", "01"],
      ] as const) {
        const redactedStatus = { ...currentWorkspace.redactedStatus };
        delete redactedStatus.hostedMailboxSystemHandledThroughSeq;
        delete redactedStatus.hostedMailboxSystemImportedSeq;
        if (importedSeq !== null) {
          redactedStatus.hostedMailboxSystemImportedSeq = importedSeq;
        }
        if (handledThroughSeq !== null) {
          redactedStatus.hostedMailboxSystemHandledThroughSeq = handledThroughSeq;
        }
        currentWorkspace = {
          ...currentWorkspace,
          redactedStatus,
        };

        const attemptId =
          `attempt_synthetic_system_mailbox_progress_convergence_${scenario}`;
        const result = await runSystemMailboxPass(attemptId);

        assert.equal(result.status, "idle", scenario);
        assert.equal(checkpointRequests.length, 1, scenario);
        assert.equal(
          readCapturedRuntimePhaseLogs({ attemptId, spy: consoleInfo }).some((entry) =>
            entry.details.restoredSystemMailboxProgressAheadAtCheckpoint === true
          ),
          false,
          scenario,
        );
      }
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
  });

  test("system mailbox webhook dirty work reaches quiescence without starting provider cadence", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const connectionId = "device_sync_connection_webhook_dirty";
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:webhook-dirty",
      id: "mailbox_item_system_mailbox_device_webhook_dirty",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const baseDeviceSyncPort = createSnapshotDeviceSyncPort({
      connectionId,
      nextReconcileAt: TEST_NOW,
    });
    let fetchDirtyStatesCalls = 0;
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...baseDeviceSyncPort,
      async fetchDirtyStates() {
        fetchDirtyStatesCalls += 1;
        return {
          hasMore: false,
          items: [],
          nextWakeAt: null,
          userId: TEST_USER_ID,
        };
      },
    };
    const providerFetch = vi.fn(async () =>
      new Response(JSON.stringify({ records: [] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal("fetch", providerFetch);
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncSystemMailboxItem(deviceItem),
        vaultRoot,
        wake: {
          connectionId,
          eventId: deviceItem.dedupeKey,
          expectedConnectedAt: TEST_NOW,
          hint: {
            occurredAt: TEST_NOW,
            reason: "webhook_dirty_transition",
          },
          kind: "device-sync.wake",
          occurredAt: TEST_NOW,
          provider: "whoop",
          reason: "webhook_hint",
          userId: TEST_USER_ID,
        },
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-webhook-dirty-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_webhook_dirty",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-webhook-dirty.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox device-sync must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.equal(baseDeviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(fetchDirtyStatesCalls, 1);
      assert.equal(providerFetch.mock.calls.length, 0);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.nextWakeReason ?? null, null);
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "1",
      );
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox mode applies Environment answers without a model and refreshes the browser replica", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const interviewItem = createMailboxItem({
      dedupeKey: "environment-interview:entrypoint-isolation",
      id: "mailbox_item_environment_interview_entrypoint_isolation",
      kind: "environment-interview.completed",
      lane: "system",
      laneSeq: "1",
    });

    try {
      mocks.prepareHostedCodexRuntimeEnvironment.mockClear();
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueEnvironmentInterviewSystemMailboxItemForTest({
        item: interviewItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/environment-interview-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_environment_interview_entrypoint_isolation",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/environment-interview-after.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported Environment work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [createMailboxItem({
                id: "mailbox_item_environment_interview_unrelated_conversation",
                kind: "conversation.message",
                lane: "conversation",
                laneSeq: "1",
              })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: "2026-04-26T23:59:59.000Z",
                nextWakeReason: "assistant",
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Model-free Environment work must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.deepEqual(
        fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)),
        [["system"]],
      );
      await expect(readHabitatAspect({
        slug: "sleep-environment",
        vaultRoot,
      })).resolves.toMatchObject({
        indicators: { night_temp_c: 19 },
      });
      expect(mocks.refreshHostedBrowserVaultReplicaFromRuntime).toHaveBeenCalledTimes(1);
      expect(mocks.prepareHostedCodexRuntimeEnvironment).not.toHaveBeenCalled();
      expect(mocks.prepareHostedCodexAssistantProcess).not.toHaveBeenCalled();
      expect(result.status).toBe("idle");
    } finally {
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      await removeTempRoot(vaultRoot);
    }
  });

  test("blocked system mailbox mode delivers one exact group-join confirmation without draining a generic notification", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const exactText = "You are now part of the synthetic group.";
    const deliveryBodies: unknown[] = [];
    const exactDeliveryKey = "group-join:membership_blocked_exact";
    const exactDedupeKey =
      `assistant.notification.requested:${exactDeliveryKey}`;
    const genericDeliveryKey = "generic:blocked_after_group_join";
    const genericDedupeKey =
      `assistant.notification.requested:${genericDeliveryKey}`;
    const exactItem = createMailboxItem({
      dedupeKey: exactDedupeKey,
      id: "mailbox_item_group_join_blocked_exact",
      kind: "assistant.notification.requested",
      lane: "system",
      laneSeq: "1",
    });
    const genericItem = createMailboxItem({
      dedupeKey: genericDedupeKey,
      id: "mailbox_item_group_join_later_generic",
      kind: "assistant.notification.requested",
      lane: "system",
      laneSeq: "2",
    });
    const buildResolvedNotificationItem = (
      item: HostedMailboxItem,
    ): HostedMailboxResolvedImportItem => ({
      item,
      payload: {
        payloadCiphertext: "ciphertext",
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        requestId: `request_${item.id}`,
        source: "inline",
        status: "resolved",
      },
      route: {
        action: "dispatch-assistant-notification",
        advanceProgress: true,
        itemRef: {
          id: item.id,
          kind: item.kind,
          lane: item.lane,
          laneSeq: item.laneSeq,
        },
        state: "route",
      },
    });
    const buildNotificationWake = (input: {
      deliveryKey: string;
      eventId: string;
      text: string;
    }) =>
      buildHostedExecutionAssistantNotificationRequestedWake({
        eventId: input.eventId,
        memberId: TEST_USER_ID,
        notification: {
          deliveryDispatchMode: "queue-only",
          deliveryDedupeToken: input.deliveryKey,
          deliveryIdempotencyKey: input.deliveryKey,
          instructions: "Send the exact private confirmation text.",
          responsePolicy: {
            kind: "require_send_exact_text",
            text: input.text,
          },
          route: {
            actorId: null,
            channel: "linq",
            delivery: {
              kind: "thread",
              target: "linq_private_group_join_thread",
            },
            identityId: "hbidx:phone:v1:group-join-test",
            threadId: "hbidx:thread:v1:group-join-test",
            threadIsDirect: true,
          },
        },
        occurredAt: TEST_NOW,
      });
    const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
      const method =
        init?.method
        ?? (request instanceof Request ? request.method : "GET");
      const url = request instanceof Request ? request.url : String(request);
      if (method === "POST" && url.includes("/messages")) {
        deliveryBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          message: { id: "provider_group_join_confirmation" },
        }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      return new Response(null, { status: 204 });
    });

    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.prepareHostedCodexRuntimeEnvironment.mockClear();
      mocks.runAssistantAutomationPass.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: buildResolvedNotificationItem(exactItem),
        vaultRoot,
        wake: buildNotificationWake({
          deliveryKey: exactDeliveryKey,
          eventId: exactDedupeKey,
          text: exactText,
        }),
      });
      await enqueueHostedSystemMailboxItem({
        item: buildResolvedNotificationItem(genericItem),
        vaultRoot,
        wake: buildNotificationWake({
          deliveryKey: genericDeliveryKey,
          eventId: genericDedupeKey,
          text: "Generic automatic message.",
        }),
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "2";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/blocked-group-join-before.bundle.json",
        vaultRoot,
      });
      const completedResult = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          platformEnv: {
            TELEGRAM_BOT_TOKEN: "",
          },
          forwardedEnv: {
            LINQ_API_TOKEN: "synthetic-linq-token",
          },
          request: {
            assistantExecutionBlocked: true,
            attemptId: "attempt_synthetic_blocked_group_join_exact",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: {
            channelCapabilities: {
              emailSendReady: false,
              telegramBotConfigured: false,
            },
            deviceSync: null,
            managedAutoReplyChannels: [{
              capabilityReady: true,
              channel: "linq",
              memberChannel: "linq",
            }],
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/blocked-group-join.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported notifications must not import a new row.");
          },
          platform: {
            ...createPlatform({
              artifactBytesByHash: new Map([
                [restoredWorkspace.hash, restoredWorkspace.bytes],
              ]),
              mailboxPort: createMailboxPort({ events, items: [] }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({
                  snapshotRef: restoredWorkspace.snapshotRef,
                  version: "0",
                }),
              }),
            }),
            effectsPort: {
              async assertLinqRecentInboundEngagement(request) {
                assert.equal(request.target, "linq_private_group_join_thread");
                return {
                  providerDispatchClaimed: true,
                  resolvedRoute: {
                    conversationThreadId: null,
                    directRecipientPhoneNumber: null,
                    fromPhoneNumber: null,
                    target: "linq_private_group_join_thread",
                    targetKind: "thread",
                    threadIsDirect: true,
                  },
                };
              },
              async readRawEmailMessage() {
                return null;
              },
              async recordLinqDeliveryOutcome(request) {
                events.push(
                  `provider.record:${request.providerMessageId ?? "missing"}`,
                );
              },
              async sendEmail() {},
            },
            providerFetch,
          },
          async runAssistantPhase() {
            throw new Error("Blocked exact notification must not enter assistant execution.");
          },
          vaultRoot,
        },
      );

      const pendingAfter = await readHostedSystemMailboxState(vaultRoot);
      const outboxAfter = await listAssistantOutboxIntents(vaultRoot);
      assert.equal(deliveryBodies.length, 1, JSON.stringify({
        events,
        outbox: outboxAfter.map((intent) => ({
          deliveryIdempotencyKey: intent.deliveryIdempotencyKey,
          status: intent.status,
        })),
        pending: pendingAfter.pending.map((item) => ({
          itemId: item.itemId,
          mailboxDedupeKey: item.mailboxDedupeKey,
          status: item.status,
        })),
        result: completedResult,
      }));
      expect(JSON.stringify(deliveryBodies[0])).toContain(exactText);
      assert.deepEqual(
        outboxAfter.map((intent) => ({
          deliveryIdempotencyKey: intent.deliveryIdempotencyKey,
          status: intent.status,
        })),
        [{
          deliveryIdempotencyKey: exactDeliveryKey,
          status: "sent",
        }],
      );
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(mocks.prepareHostedCodexRuntimeEnvironment.mock.calls.length, 0);
      assert.equal(mocks.runAssistantAutomationPass.mock.calls.length, 0);
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus
          ?.hostedMailboxSystemHandledThroughSeq,
        "1",
      );
      assert.deepEqual(
        pendingAfter.pending.map((item) => ({
          itemId: item.itemId,
          mailboxDedupeKey: item.mailboxDedupeKey,
          mailboxLaneSeq: item.mailboxLaneSeq,
        })),
        [{
          itemId: genericItem.id,
          mailboxDedupeKey: genericDedupeKey,
          mailboxLaneSeq: "2",
        }],
      );
      assert.equal(completedResult.status, "scheduled", JSON.stringify(completedResult));
      assert.equal(completedResult.nextWakeAt, TEST_NOW);
      assert.equal(completedResult.nextWakeReason, "assistant");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    {
      channel: "linq" as const,
      checkpointConversationInputAhead: false,
      expectedProviderSends: 1,
      initialOutboxState: "pending" as const,
      providerOutcome: "success" as const,
    },
    {
      channel: "linq" as const,
      checkpointConversationInputAhead: true,
      expectedProviderSends: 0,
      initialOutboxState: "pending" as const,
      providerOutcome: "success" as const,
    },
    {
      channel: "linq" as const,
      checkpointConversationInputAhead: true,
      expectedProviderSends: 0,
      initialOutboxState: "due_retryable" as const,
      providerOutcome: "success" as const,
    },
    {
      channel: "linq" as const,
      checkpointConversationInputAhead: false,
      expectedProviderSends: 0,
      initialOutboxState: "retryable" as const,
      providerOutcome: "success" as const,
    },
    {
      channel: "linq" as const,
      checkpointConversationInputAhead: false,
      expectedProviderSends: 0,
      initialOutboxState: "sent" as const,
      providerOutcome: "success" as const,
    },
    {
      channel: "telegram" as const,
      checkpointConversationInputAhead: true,
      expectedProviderSends: 0,
      initialOutboxState: "pending" as const,
      providerOutcome: "success" as const,
    },
    {
      channel: "telegram" as const,
      checkpointConversationInputAhead: true,
      expectedProviderSends: 0,
      initialOutboxState: "due_retryable" as const,
      providerOutcome: "success" as const,
    },
    {
      channel: "linq" as const,
      checkpointConversationInputAhead: false,
      expectedProviderSends: 3,
      initialOutboxState: "pending" as const,
      providerOutcome: "retryable_failure" as const,
    },
    {
      channel: "linq" as const,
      checkpointConversationInputAhead: false,
      expectedProviderSends: 3,
      initialOutboxState: "pending" as const,
      providerOutcome: "retryable_failure_with_host_abort" as const,
    },
  ])("system mailbox mode resumes a restored exact group-join delivery from its durable identity ($channel, $initialOutboxState outbox, provider: $providerOutcome, foreground checkpoint: $checkpointConversationInputAhead)", async ({
    channel,
    checkpointConversationInputAhead,
    expectedProviderSends,
    initialOutboxState,
    providerOutcome,
  }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const deliveryBodies: unknown[] = [];
    const retryCheckpointAbortController = new AbortController();
    const retryCheckpointAbortReason = new Error(
      "Synthetic host abort during exact delivery retry checkpoint.",
    );
    const exactText = "You are now part of the synthetic group.";
    const exactDeliveryKey = "group-join:membership_restored_exact";
    const exactTarget = channel === "telegram"
      ? "123456789"
      : "linq_private_group_join_thread";
    const exactIdentityId = channel === "telegram"
      ? "telegram-bot"
      : "hbidx:phone:v1:group-join-restored-test";
    const exactThreadId = channel === "telegram"
      ? exactTarget
      : "hbidx:thread:v1:group-join-restored-test";
    const exactDedupeKey =
      `assistant.notification.requested:${exactDeliveryKey}`;
    let providerFailuresRemaining =
      providerOutcome === "success" ? 0 : 3;
    const providerRetries = providerOutcome !== "success";
    const retryWakeAt = new Date(
      Date.parse(TEST_NOW) + 5 * 60_000,
    ).toISOString();
    const exactItem = createMailboxItem({
      dedupeKey: exactDedupeKey,
      id: "mailbox_item_group_join_restored_exact",
      kind: "assistant.notification.requested",
      lane: "system",
      laneSeq: "1",
    });
    const exactWake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: exactDedupeKey,
      memberId: TEST_USER_ID,
      notification: {
        deliveryDispatchMode: "queue-only",
        deliveryDedupeToken: exactDeliveryKey,
        deliveryIdempotencyKey: exactDeliveryKey,
        instructions: "Send the exact private confirmation text.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: exactText,
        },
        route: {
          actorId: null,
          channel,
          delivery: {
            kind: "thread",
            target: exactTarget,
          },
          identityId: exactIdentityId,
          threadId: exactThreadId,
          threadIsDirect: true,
        },
      },
      occurredAt: TEST_NOW,
    });
    const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
      const method =
        init?.method
        ?? (request instanceof Request ? request.method : "GET");
      const url = request instanceof Request ? request.url : String(request);
      if (
        method === "POST"
        && (
          (channel === "linq" && url.includes("/messages"))
          || (channel === "telegram" && url.endsWith("/sendMessage"))
        )
      ) {
        deliveryBodies.push(JSON.parse(String(init?.body)));
        if (providerFailuresRemaining > 0) {
          providerFailuresRemaining -= 1;
          return new Response(JSON.stringify({
            error: { message: "Synthetic retryable provider failure." },
          }), {
            headers: { "content-type": "application/json" },
            status: 503,
          });
        }
        return new Response(JSON.stringify(
          channel === "telegram"
            ? {
                ok: true,
                result: { message_id: 123 },
              }
            : {
                message: { id: "provider_group_join_restored_confirmation" },
              },
        ), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      return new Response(null, { status: 204 });
    });
    const effectsPort = {
      async assertLinqRecentInboundEngagement() {
        assert.equal(channel, "linq");
        return {
          providerDispatchClaimed: true,
          resolvedRoute: {
            conversationThreadId: null,
            directRecipientPhoneNumber: null,
            fromPhoneNumber: null,
            target: exactTarget,
            targetKind: "thread" as const,
            threadIsDirect: true,
          },
        };
      },
      async readRawEmailMessage() {
        return null;
      },
      async recordLinqDeliveryOutcome(request: {
        providerMessageId?: string | null;
      }) {
        events.push(
          `provider.record:${request.providerMessageId ?? "missing"}`,
        );
      },
      async sendEmail() {},
    };

    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.prepareHostedCodexRuntimeEnvironment.mockClear();
      mocks.runAssistantAutomationPass.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: {
          item: exactItem,
          payload: {
            payloadCiphertext: "ciphertext",
            payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
            requestId: `request_${exactItem.id}`,
            source: "inline",
            status: "resolved",
          },
          route: {
            action: "dispatch-assistant-notification",
            advanceProgress: true,
            itemRef: {
              id: exactItem.id,
              kind: exactItem.kind,
              lane: exactItem.lane,
              laneSeq: exactItem.laneSeq,
            },
            state: "route",
          },
        },
        vaultRoot,
        wake: exactWake,
      });
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: state.pending.map((item) =>
          item.itemId === exactItem.id
            ? {
                ...item,
                attemptCount: 1,
                lastAttemptAt: TEST_NOW,
                status: "recording",
              }
            : item
        ),
      }));
      const exactIntent = await createAssistantOutboxIntent({
        channel,
        createdAt: TEST_NOW,
        dedupeToken: exactDeliveryKey,
        deliveryIdempotencyKey: exactDeliveryKey,
        deliveryTransportIdempotent: channel === "linq",
        explicitTarget: exactTarget,
        identityId: exactIdentityId,
        message: exactText,
        sessionId: "session_group_join_restored_exact",
        threadId: exactThreadId,
        threadIsDirect: true,
        turnId: "turn_group_join_restored_exact",
        vault: vaultRoot,
      });
      if (
        initialOutboxState === "retryable"
        || initialOutboxState === "due_retryable"
      ) {
        await saveAssistantOutboxIntent(vaultRoot, {
          ...exactIntent,
          attemptCount: 1,
          lastAttemptAt: TEST_NOW,
          lastError: {
            code: "ASSISTANT_DELIVERY_RETRYABLE",
            message: "Synthetic retry window.",
          },
          nextAttemptAt:
            initialOutboxState === "due_retryable" ? TEST_NOW : retryWakeAt,
          status: "retryable",
          updatedAt: TEST_NOW,
        });
      }
      if (initialOutboxState === "sent") {
        const sentIntent = await markAssistantOutboxIntentSentById({
          delivery: {
            channel,
            idempotencyKey: exactDeliveryKey,
            messageLength: exactText.length,
            providerMessageId: "provider_group_join_already_sent",
            providerThreadId: exactTarget,
            sentAt: TEST_NOW,
            target: exactTarget,
            targetKind: "explicit",
          },
          intentId: exactIntent.intentId,
          vault: vaultRoot,
        });
        assert.equal(sentIntent?.status, "sent");
      }
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/blocked-group-join-restored-before.bundle.json",
        vaultRoot,
      });
      const checkpointBundles: Array<Awaited<
        ReturnType<typeof createVaultSnapshotBundle>
      >> = [];

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          platformEnv: {
            TELEGRAM_BOT_TOKEN:
              channel === "telegram" ? "synthetic-telegram-token" : "",
          },
          forwardedEnv: {
            LINQ_API_TOKEN:
              channel === "linq" ? "synthetic-linq-token" : "",
          },
          request: {
            assistantExecutionBlocked: true,
            attemptId: "attempt_synthetic_blocked_group_join_restored_exact",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: {
            channelCapabilities: {
              emailSendReady: false,
              telegramBotConfigured: channel === "telegram",
            },
            deviceSync: null,
            managedAutoReplyChannels: [{
              capabilityReady: true,
              channel,
              memberChannel: channel,
            }],
          },
        }),
        {
          async createCheckpointSnapshot() {
            const checkpointBundle = await createVaultSnapshotBundle({
              key:
                "users/bundles/member-synthetic/"
                + `blocked-group-join-restored-checkpoint-${
                  checkpointRequests.length + 1
                }.bundle.json`,
              vaultRoot,
            });
            checkpointBundles.push(checkpointBundle);
            if (
              providerOutcome === "retryable_failure_with_host_abort"
              && checkpointRequests.length === 1
            ) {
              retryCheckpointAbortController.abort(
                retryCheckpointAbortReason,
              );
            }
            return {
              snapshotRef: checkpointBundle.snapshotRef,
            };
          },
          async importItem() {
            throw new Error("Restored notification must not import a new row.");
          },
          platform: {
            ...createPlatform({
              artifactBytesByHash: new Map([
                [restoredWorkspace.hash, restoredWorkspace.bytes],
              ]),
              mailboxPort: createMailboxPort({ events, items: [] }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                ...(checkpointConversationInputAhead
                  ? {
                      checkpointResponse(request) {
                        return {
                          checkpointed: true,
                          conversationInputAhead: checkpointRequests.length === 1,
                          workspace: createWorkspaceState({
                            inboxMediaRetentionWakeAt:
                              request.inboxMediaRetentionWakeAt ?? null,
                            ...(request.systemMailboxProgressGeneration === undefined
                              ? {}
                              : {
                                  nextDefaultProcessingWakeAt:
                                    request.nextDefaultProcessingWakeAt ?? null,
                                  nextDefaultProcessingWakeReason:
                                    request.nextDefaultProcessingWakeReason ?? null,
                                  systemMailboxProgressGeneration:
                                    request.systemMailboxProgressGeneration,
                                }),
                            nextWakeAt: request.nextWakeAt ?? null,
                            nextWakeReason: request.nextWakeReason ?? null,
                            redactedStatus: request.redactedStatus ?? null,
                            snapshotRef: request.snapshotRef,
                            version: String(
                              BigInt(request.expectedWorkspaceVersion) + 1n,
                            ),
                          }),
                        };
                      },
                    }
                  : {}),
                events,
                workspace: createWorkspaceState({
                  snapshotRef: restoredWorkspace.snapshotRef,
                  version: "0",
                }),
              }),
            }),
            effectsPort,
            providerFetch,
          },
          async runAssistantPhase() {
            throw new Error("Restored exact notification must not enter assistant execution.");
          },
          signal: retryCheckpointAbortController.signal,
          vaultRoot,
        },
      );

      if (providerOutcome === "retryable_failure_with_host_abort") {
        await assert.rejects(resultPromise, retryCheckpointAbortReason);
        assert.equal(deliveryBodies.length, expectedProviderSends);
        const abortedOutbox = await listAssistantOutboxIntents(vaultRoot);
        const abortedRetryWakeAt = abortedOutbox.at(0)?.nextAttemptAt ?? null;
        assert.ok(abortedRetryWakeAt);
        assert.deepEqual(
          abortedOutbox.map((intent) => ({
            nextAttemptAt: intent.nextAttemptAt,
            status: intent.status,
          })),
          [{
            nextAttemptAt: abortedRetryWakeAt,
            status: "retryable",
          }],
        );
        const durableRetryWorkspace = checkpointBundles.at(-1);
        assert.ok(durableRetryWorkspace);
        const durableRetryRoot = await mkdtemp(
          path.join(tmpdir(), "murph-workspace-entrypoint-aborted-retry-"),
        );
        try {
          await restoreHostedBundleRoots({
            bytes: durableRetryWorkspace.bytes,
            expectedKind: "vault",
            roots: { vault: durableRetryRoot },
          });
          assert.deepEqual(
            (await listAssistantOutboxIntents(durableRetryRoot)).map(
              (intent) => ({
                nextAttemptAt: intent.nextAttemptAt,
                status: intent.status,
              }),
            ),
            [{
              nextAttemptAt: abortedRetryWakeAt,
              status: "retryable",
            }],
          );
          assert.deepEqual(
            (await readHostedSystemMailboxState(durableRetryRoot)).pending.map(
              (item) => ({
                nextAttemptAt: item.nextAttemptAt,
                status: item.status,
              }),
            ),
            [{
              nextAttemptAt: abortedRetryWakeAt,
              status: "recording",
            }],
          );
        } finally {
          await removeTempRoot(durableRetryRoot);
        }
        return;
      }

      const result = await resultPromise;

      if (channel === "telegram" && checkpointConversationInputAhead) {
        const preparedWorkspace = checkpointBundles.at(0);
        assert.ok(preparedWorkspace);
        const preparedCheckpointRoot = await mkdtemp(
          path.join(tmpdir(), "murph-workspace-entrypoint-prepared-checkpoint-"),
        );
        try {
          await restoreHostedBundleRoots({
            bytes: preparedWorkspace.bytes,
            expectedKind: "vault",
            roots: { vault: preparedCheckpointRoot },
          });
          assert.deepEqual(
            (await listAssistantOutboxIntents(preparedCheckpointRoot)).map(
              (intent) => ({
                preparedDispatchTokenPresent:
                  intent.preparedDispatchToken !== null,
                status: intent.status,
              }),
            ),
            [{
              preparedDispatchTokenPresent: true,
              status: "sending",
            }],
          );
        } finally {
          await removeTempRoot(preparedCheckpointRoot);
        }
      }

      assert.equal(deliveryBodies.length, expectedProviderSends, JSON.stringify({
        outbox: (await listAssistantOutboxIntents(vaultRoot)).map((intent) => ({
          deliveryIdempotencyKey: intent.deliveryIdempotencyKey,
          status: intent.status,
        })),
        pending: (await readHostedSystemMailboxState(vaultRoot)).pending.map(
          (item) => ({ itemId: item.itemId, status: item.status }),
        ),
        result,
      }));
      if (expectedProviderSends === 1) {
        expect(JSON.stringify(deliveryBodies[0])).toContain(exactText);
      }
      const outboxAfter = await listAssistantOutboxIntents(vaultRoot);
      const providerRetryWakeAt = providerRetries
        ? outboxAfter.at(0)?.nextAttemptAt ?? null
        : null;
      if (providerRetries) {
        assert.ok(providerRetryWakeAt);
        assert.deepEqual(
          outboxAfter.map((intent) => ({
            nextAttemptAt: intent.nextAttemptAt,
            status: intent.status,
          })),
          [{
            nextAttemptAt: providerRetryWakeAt,
            status: "retryable",
          }],
        );
      }
      if (checkpointConversationInputAhead) {
        assert.deepEqual(
          outboxAfter.map((intent) => ({
            nextAttemptAt: intent.nextAttemptAt,
            status: intent.status,
          })),
          [{
            nextAttemptAt: TEST_NOW,
            status:
              initialOutboxState === "due_retryable" ? "retryable" : "pending",
          }],
        );
      }
      const pendingAfter = (await readHostedSystemMailboxState(vaultRoot)).pending;
      if (providerRetries) {
        assert.deepEqual(
          pendingAfter.map((item) => ({
            nextAttemptAt: item.nextAttemptAt,
            status: item.status,
          })),
          [{
            nextAttemptAt: providerRetryWakeAt,
            status: "recording",
          }],
        );
        assert.notEqual(
          checkpointRequests.at(-1)?.redactedStatus
            ?.hostedMailboxSystemHandledThroughSeq,
          "1",
        );
      } else if (initialOutboxState === "retryable") {
        assert.deepEqual(
          pendingAfter.map((item) => ({
            nextAttemptAt: item.nextAttemptAt,
            status: item.status,
          })),
          [{
            nextAttemptAt: retryWakeAt,
            status: "recording",
          }],
        );
        assert.notEqual(
          checkpointRequests.at(-1)?.redactedStatus
            ?.hostedMailboxSystemHandledThroughSeq,
          "1",
        );
      } else if (checkpointConversationInputAhead) {
        assert.deepEqual(
          pendingAfter.map((item) => ({
            nextAttemptAt: item.nextAttemptAt,
            status: item.status,
          })),
          [{
            nextAttemptAt: null,
            status: "recording",
          }],
        );
        assert.notEqual(
          checkpointRequests.at(-1)?.redactedStatus
            ?.hostedMailboxSystemHandledThroughSeq,
          "1",
        );
      } else {
        assert.deepEqual(pendingAfter, []);
        assert.equal(
          checkpointRequests.at(-1)?.redactedStatus
            ?.hostedMailboxSystemHandledThroughSeq,
          "1",
        );
      }
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(mocks.prepareHostedCodexRuntimeEnvironment.mock.calls.length, 0);
      assert.equal(mocks.runAssistantAutomationPass.mock.calls.length, 0);
      if (providerRetries) {
        assert.equal(result.status, "scheduled");
        assert.equal(result.nextWakeAt, providerRetryWakeAt);
        assert.equal(result.nextWakeReason, "assistant_delivery");
      } else if (initialOutboxState === "retryable") {
        assert.equal(result.status, "scheduled");
        assert.equal(result.nextWakeAt, retryWakeAt);
        assert.equal(result.nextWakeReason, "assistant_delivery");
      } else if (checkpointConversationInputAhead) {
        assert.equal(result.immediateRecheckRequested, true);
        assert.equal(result.status, "scheduled");
        assert.equal(result.nextWakeAt, TEST_NOW);
        assert.equal(result.nextWakeReason, "assistant");
      } else {
        assert.equal(result.status, "idle");
        assert.equal(result.nextWakeAt, null);
      }
      if (providerRetries) {
        const durableRetryWorkspace = checkpointBundles.at(-1);
        assert.ok(durableRetryWorkspace);
        const durableRetryRoot = await mkdtemp(
          path.join(tmpdir(), "murph-workspace-entrypoint-durable-retry-"),
        );
        try {
          await restoreHostedBundleRoots({
            bytes: durableRetryWorkspace.bytes,
            expectedKind: "vault",
            roots: { vault: durableRetryRoot },
          });
          assert.deepEqual(
            (await listAssistantOutboxIntents(durableRetryRoot)).map(
              (intent) => ({
                nextAttemptAt: intent.nextAttemptAt,
                status: intent.status,
              }),
            ),
            [{
              nextAttemptAt: providerRetryWakeAt,
              status: "retryable",
            }],
          );
          assert.deepEqual(
            (await readHostedSystemMailboxState(durableRetryRoot)).pending.map(
              (item) => ({
                nextAttemptAt: item.nextAttemptAt,
                status: item.status,
              }),
            ),
            [{
              nextAttemptAt: providerRetryWakeAt,
              status: "recording",
            }],
          );
        } finally {
          await removeTempRoot(durableRetryRoot);
        }

        const durableRetryWorkspaceVersion = String(
          BigInt(
            checkpointRequests.at(-1)?.expectedWorkspaceVersion ?? "0",
          ) + 1n,
        );
        const runColdRetryWorkspace = async (input: {
          attemptId: string;
          workspace: Awaited<ReturnType<typeof createVaultSnapshotBundle>>;
          workspaceVersion: string;
        }) => {
          const coldCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
          const coldCheckpointBundles: Array<Awaited<
            ReturnType<typeof createVaultSnapshotBundle>
          >> = [];
          const coldResult = await runHostedWorkspaceRuntimeJobInProcess(
            createWorkspaceRuntimeJobInput({
              platformEnv: { TELEGRAM_BOT_TOKEN: "" },
              forwardedEnv: { LINQ_API_TOKEN: "synthetic-linq-token" },
              request: {
                assistantExecutionBlocked: true,
                attemptId: input.attemptId,
                processingMode: "system_mailbox",
                workspaceVersion: input.workspaceVersion,
              },
              resolvedConfig: {
                channelCapabilities: {
                  emailSendReady: false,
                  telegramBotConfigured: false,
                },
                deviceSync: null,
                managedAutoReplyChannels: [{
                  capabilityReady: true,
                  channel: "linq",
                  memberChannel: "linq",
                }],
              },
            }),
            {
              async createCheckpointSnapshot() {
                const checkpointBundle = await createVaultSnapshotBundle({
                  key:
                    "users/bundles/member-synthetic/"
                    + `${input.attemptId}-${coldCheckpointRequests.length + 1}.bundle.json`,
                  vaultRoot,
                });
                coldCheckpointBundles.push(checkpointBundle);
                return { snapshotRef: checkpointBundle.snapshotRef };
              },
              async importItem() {
                throw new Error(
                  "Cold-restored retry notification must not import a new row.",
                );
              },
              platform: {
                ...createPlatform({
                  artifactBytesByHash: new Map([
                    [input.workspace.hash, input.workspace.bytes],
                  ]),
                  mailboxPort: createMailboxPort({ events, items: [] }),
                  workspacePort: createWorkspacePort({
                    checkpointRequests: coldCheckpointRequests,
                    events,
                    workspace: createWorkspaceState({
                      snapshotRef: input.workspace.snapshotRef,
                      version: input.workspaceVersion,
                    }),
                  }),
                }),
                effectsPort,
                providerFetch,
              },
              async runAssistantPhase() {
                throw new Error(
                  "Cold-restored retry notification must not enter assistant execution.",
                );
              },
              vaultRoot,
            },
          );
          return {
            checkpointBundles: coldCheckpointBundles,
            checkpointRequests: coldCheckpointRequests,
            result: coldResult,
          };
        };

        const sendsAfterProviderFailure = deliveryBodies.length;
        const beforeRetry = await runColdRetryWorkspace({
          attemptId: "attempt_synthetic_group_join_cold_before_retry",
          workspace: durableRetryWorkspace,
          workspaceVersion: durableRetryWorkspaceVersion,
        });
        assert.equal(deliveryBodies.length, sendsAfterProviderFailure);
        assert.equal(beforeRetry.checkpointRequests.length, 1);
        assert.equal(
          beforeRetry.checkpointRequests[0]?.nextWakeAt,
          providerRetryWakeAt,
        );
        assert.equal(
          beforeRetry.checkpointRequests[0]?.nextWakeReason,
          "assistant_delivery",
        );
        assert.equal(beforeRetry.result.status, "scheduled");
        assert.equal(beforeRetry.result.nextWakeAt, providerRetryWakeAt);
        assert.deepEqual(
          (await listAssistantOutboxIntents(vaultRoot)).map((intent) => ({
            nextAttemptAt: intent.nextAttemptAt,
            status: intent.status,
          })),
          [{
            nextAttemptAt: providerRetryWakeAt,
            status: "retryable",
          }],
        );

        if (!providerRetryWakeAt) {
          throw new Error("Provider retry wake must be available after failure.");
        }
        vi.setSystemTime(new Date(providerRetryWakeAt));
        const beforeRetryWorkspace = beforeRetry.checkpointBundles.at(-1);
        assert.ok(beforeRetryWorkspace);
        const beforeRetryWorkspaceVersion = String(
          BigInt(
            beforeRetry.checkpointRequests.at(-1)
              ?.expectedWorkspaceVersion ?? durableRetryWorkspaceVersion,
          ) + 1n,
        );
        const atRetry = await runColdRetryWorkspace({
          attemptId: "attempt_synthetic_group_join_cold_at_retry",
          workspace: beforeRetryWorkspace,
          workspaceVersion: beforeRetryWorkspaceVersion,
        });
        assert.equal(deliveryBodies.length, sendsAfterProviderFailure + 1);
        assert.deepEqual(
          (await listAssistantOutboxIntents(vaultRoot)).map((intent) =>
            intent.status
          ),
          ["sent"],
        );
        assert.deepEqual(
          (await readHostedSystemMailboxState(vaultRoot)).pending,
          [],
        );
        assert.equal(
          atRetry.checkpointRequests.at(-1)?.redactedStatus
            ?.hostedMailboxSystemHandledThroughSeq,
          "1",
        );
        assert.equal(atRetry.result.status, "idle");
      }
      if (checkpointConversationInputAhead) {
        assert.deepEqual(
          checkpointRequests.map((request) => request.expectedWorkspaceVersion),
          ["0", "1"],
        );
        if (channel === "telegram") {
          const ambiguousWorkspace = checkpointBundles.at(0);
          assert.ok(ambiguousWorkspace);
          const ambiguousCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
          const ambiguousResult = await runHostedWorkspaceRuntimeJobInProcess(
            createWorkspaceRuntimeJobInput({
              platformEnv: {
                TELEGRAM_BOT_TOKEN: "synthetic-telegram-token",
              },
              forwardedEnv: { LINQ_API_TOKEN: "" },
              request: {
                assistantExecutionBlocked: true,
                attemptId:
                  "attempt_synthetic_blocked_group_join_restored_telegram_ambiguous",
                processingMode: "system_mailbox",
                workspaceVersion: "1",
              },
              resolvedConfig: {
                channelCapabilities: {
                  emailSendReady: false,
                  telegramBotConfigured: true,
                },
                deviceSync: null,
                managedAutoReplyChannels: [{
                  capabilityReady: true,
                  channel: "telegram",
                  memberChannel: "telegram",
                }],
              },
            }),
            {
              async createCheckpointSnapshot() {
                return {
                  snapshotRef: createBundleRef({
                    hash: "f".repeat(64),
                    key:
                      "users/bundles/member-synthetic/"
                      + "blocked-group-join-restored-telegram-ambiguous.bundle.json",
                    size: 512,
                  }),
                };
              },
              async importItem() {
                throw new Error(
                  "Ambiguous Telegram notification must not import a new row.",
                );
              },
              platform: {
                ...createPlatform({
                  artifactBytesByHash: new Map([
                    [ambiguousWorkspace.hash, ambiguousWorkspace.bytes],
                  ]),
                  mailboxPort: createMailboxPort({ events, items: [] }),
                  workspacePort: createWorkspacePort({
                    checkpointRequests: ambiguousCheckpointRequests,
                    events,
                    workspace: createWorkspaceState({
                      snapshotRef: ambiguousWorkspace.snapshotRef,
                      version: "1",
                    }),
                  }),
                }),
                effectsPort,
                providerFetch,
              },
              async runAssistantPhase() {
                throw new Error(
                  "Ambiguous Telegram notification must not enter assistant execution.",
                );
              },
              vaultRoot,
            },
          );

          assert.equal(deliveryBodies.length, 0);
          assert.deepEqual(
            (await listAssistantOutboxIntents(vaultRoot)).map((intent) => ({
              preparedDispatchTokenPresent:
                intent.preparedDispatchToken !== null,
              status: intent.status,
            })),
            [{
              preparedDispatchTokenPresent: true,
              status: "sending",
            }],
          );
          assert.equal(ambiguousResult.status, "scheduled");
          assert.ok(ambiguousResult.nextWakeAt);
          assert.ok(ambiguousResult.nextWakeAt > TEST_NOW);
        }
        const resumedWorkspaceVersion = String(
          BigInt(
            checkpointRequests.at(-1)?.expectedWorkspaceVersion ?? "0",
          ) + 1n,
        );
        const resumedWorkspace = checkpointBundles.at(-1);
        assert.ok(resumedWorkspace);
        const resumedCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
        const resumedResult = await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            platformEnv: {
              TELEGRAM_BOT_TOKEN:
                channel === "telegram" ? "synthetic-telegram-token" : "",
            },
            forwardedEnv: {
              LINQ_API_TOKEN:
                channel === "linq" ? "synthetic-linq-token" : "",
            },
            request: {
              assistantExecutionBlocked: true,
              attemptId:
                "attempt_synthetic_blocked_group_join_restored_after_foreground",
              processingMode: "system_mailbox",
              workspaceVersion: resumedWorkspaceVersion,
            },
            resolvedConfig: {
              channelCapabilities: {
                emailSendReady: false,
                telegramBotConfigured: channel === "telegram",
              },
              deviceSync: null,
              managedAutoReplyChannels: [{
                capabilityReady: true,
                channel,
                memberChannel: channel,
              }],
            },
          }),
          {
            async createCheckpointSnapshot() {
              return {
                snapshotRef: createBundleRef({
                  hash: "e".repeat(64),
                  key:
                    "users/bundles/member-synthetic/"
                    + "blocked-group-join-restored-after-foreground-done.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem() {
              throw new Error(
                "Foreground-preempted notification must not import a new row.",
              );
            },
            platform: {
              ...createPlatform({
                artifactBytesByHash: new Map([
                  [resumedWorkspace.hash, resumedWorkspace.bytes],
                ]),
                mailboxPort: createMailboxPort({ events, items: [] }),
                workspacePort: createWorkspacePort({
                  checkpointRequests: resumedCheckpointRequests,
                  events,
                  workspace: createWorkspaceState({
                    snapshotRef: resumedWorkspace.snapshotRef,
                    version: resumedWorkspaceVersion,
                  }),
                }),
              }),
              effectsPort,
              providerFetch,
            },
            async runAssistantPhase() {
              throw new Error(
                "Resumed exact notification must not enter assistant execution.",
              );
            },
            vaultRoot,
          },
        );

        assert.equal(deliveryBodies.length, 1);
        expect(JSON.stringify(deliveryBodies[0])).toContain(exactText);
        assert.deepEqual(
          (await listAssistantOutboxIntents(vaultRoot)).map((intent) =>
            intent.status
          ),
          ["sent"],
        );
        assert.deepEqual(
          (await readHostedSystemMailboxState(vaultRoot)).pending,
          [],
        );
        assert.equal(
          resumedCheckpointRequests.at(-1)?.redactedStatus
            ?.hostedMailboxSystemHandledThroughSeq,
          "1",
        );
        assert.equal(resumedResult.status, "idle");
      }
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox mode hands ready approvals to the foreground owner before device-sync", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const approvalEffectIds = [
      "effect_system_mailbox_approval_a",
      "effect_system_mailbox_approval_b",
    ];
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:before-system-mailbox-approvals",
      id: "mailbox_item_system_mailbox_device_before_approvals",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
      occurredAt: "2026-04-26T23:59:00.000Z",
    });
    const approvalItems = approvalEffectIds.map((effectId, index) =>
      createMailboxItem({
        dedupeKey: `runtime.pending-effects-reconcile-requested:${effectId}`,
        id: `mailbox_item_system_mailbox_approval_${index + 1}`,
        kind: "runtime.pending-effects-reconcile-requested",
        lane: "system",
        laneSeq: String(index + 2),
      })
    );
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.collectHostedAssistantDeliverySideEffects.mockClear();
      mocks.drainHostedPreparedAssistantDeliveries.mockClear();
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockClear();
      mocks.prepareHostedCodexRuntimeEnvironment.mockClear();
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      mocks.collectHostedAssistantDeliverySideEffects.mockImplementation(
        async (input) => {
          const effectId = input.preferredEffectIds?.[0] ?? null;
          if (!effectId || !approvalEffectIds.includes(effectId)) {
            return [];
          }
          return [{
            deliveryPhase: "foreground_current_turn",
            effectId,
            fingerprint: `fingerprint_${effectId}`,
            kind: "assistant.delivery",
            payload: {
              actorId: null,
              answeredMailboxItemIds: [],
              bindingDeliveryKind: null,
              bindingDeliveryTarget: null,
              channel: "linq",
              deliverySourceKey: null,
              explicitTarget: null,
              identityId: null,
              idempotencyKey: `assistant-outbox:${effectId}`,
              media: [],
              message: `Synthetic approved delivery ${effectId}`,
              replyToMessageId: null,
              sessionId: "session_system_mailbox_approval_owner",
              subject: null,
              threadId: null,
              threadIsDirect: true,
              transportIdempotent: true,
              turnId: "turn_system_mailbox_approval_owner",
            },
          }];
        },
      );
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: [],
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementation(async (input) => {
        assert.equal(deviceSyncPort.fetchSnapshotCalls, 0);
        for (const effect of input.assistantDeliveryEffects) {
          events.push(`approval.delivery:${effect.effectId}`);
        }
        return [];
      });
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      for (const [index, item] of approvalItems.entries()) {
        await enqueuePendingEffectsSystemMailboxItemForTest({
          effectId: approvalEffectIds[index]!,
          item,
          vaultRoot,
        });
      }
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "3";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-approval-owner-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_approval_owner",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "9".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-approval-owner.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported approval work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push("approval.foreground-owner");
            return await runHostedWorkspaceAssistantPhase({
              ...input,
              now: () => TEST_NOW,
            });
          },
          vaultRoot,
        },
      );

      assert.ok(assistantPhaseCalls >= 2);
      assert.deepEqual(
        mocks.collectHostedAssistantDeliverySideEffects.mock.calls.map(
          ([input]) => input.preferredEffectIds ?? [],
        ),
        approvalEffectIds.map((effectId) => [effectId]),
        events.join(","),
      );
      assert.equal(
        mocks.drainHostedPreparedAssistantDeliveries.mock.calls.length,
        2,
        events.join(","),
      );
      assert.deepEqual(
        events.filter((event) => event.startsWith("approval.delivery:")),
        approvalEffectIds.map((effectId) => `approval.delivery:${effectId}`),
        events.join(","),
      );
      assert.ok(events.includes("workspace.checkpoint"), events.join(","));
      assert.ok(deviceSyncPort.fetchSnapshotCalls <= 1);
      const remainingWakeKinds = (await readHostedSystemMailboxState(vaultRoot))
        .pending.map((item) => item.wake.kind);
      assert.equal(
        remainingWakeKinds.includes("runtime.pending-effects-reconcile-requested"),
        false,
      );
      if (deviceSyncPort.fetchSnapshotCalls === 0) {
        assert.ok(remainingWakeKinds.includes("device-sync.wake"));
        assert.equal(result.nextWakeReason, "device-sync.reconcile");
      }
    } finally {
      if (mocks.actualCollectHostedAssistantDeliverySideEffects) {
        mocks.collectHostedAssistantDeliverySideEffects.mockImplementation(
          mocks.actualCollectHostedAssistantDeliverySideEffects,
        );
      }
      if (mocks.actualDrainHostedPreparedAssistantDeliveries) {
        mocks.drainHostedPreparedAssistantDeliveries.mockImplementation(
          mocks.actualDrainHostedPreparedAssistantDeliveries,
        );
      }
      if (mocks.actualPrepareHostedAssistantDeliveryEffectsForDispatch) {
        mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockImplementation(
          mocks.actualPrepareHostedAssistantDeliveryEffectsForDispatch,
        );
      }
      mocks.collectHostedAssistantDeliverySideEffects.mockClear();
      mocks.drainHostedPreparedAssistantDeliveries.mockClear();
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockClear();
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox mode schedules retained model-free work when browser refresh defers to a runtime wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:browser-refresh-runtime-wake",
      id: "mailbox_item_system_mailbox_device_browser_refresh_runtime_wake",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const refreshImplementation =
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.getMockImplementation();

    mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(async (input) => {
      assert.equal(input.force, true);
      runtimeWakeSignal.notify();
      return {
        source: { fileCount: 0, totalBytes: 0 },
        status: "deferred_runtime_wake",
      };
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.prepareHostedCodexRuntimeEnvironment.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-device-browser-refresh-wake-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_device_browser_refresh_wake",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-device-browser-refresh-wake.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            throw new Error("System mailbox device-sync must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.equal(result.immediateRecheckRequested, undefined);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, TEST_NOW);
      assert.equal(result.nextWakeReason, "device-sync.reconcile");
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(deviceSyncPort.fetchDirtyStatesCalls, 0);
      expect(mocks.refreshHostedBrowserVaultReplicaFromRuntime).toHaveBeenCalledTimes(1);
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "0",
      );
      const state = await readHostedSystemMailboxState(vaultRoot);
      const retained = state.pending.find((item) => item.itemId === deviceItem.id);
      assert.equal(retained?.status, "recording");
      assert.equal(retained?.postCheckpointRecord, null);
    } finally {
      const restoreRefreshImplementation =
        refreshImplementation
        ?? mocks.actualRefreshHostedBrowserVaultReplicaFromRuntime;
      if (restoreRefreshImplementation) {
        mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(
          restoreRefreshImplementation,
        );
      }
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpoints a stale assistant projection, then advances the imported device frontier under the system owner", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const staleDefaultWakeAt = "2026-04-26T23:59:00.000Z";
    const staleDeviceWakeAt = "2026-04-26T23:58:00.000Z";
    const runningAt = "2026-04-26T23:59:30.000Z";
    const futurePendingEffectsWakeAt = "2026-04-27T00:10:00.000Z";
    const automationId = "automation_01JQ8PWXP5A68SQM1W0GYM41XZ";
    const deviceHead = createMailboxItem({
      dedupeKey: "device-sync.wake:stale-default-projection-head",
      id: "mailbox_item_stale_default_projection_device_head",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const pendingEffects = createMailboxItem({
      dedupeKey: "runtime.pending-effects-reconcile-requested:stale-default-projection",
      id: "mailbox_item_stale_default_projection_pending_effects",
      kind: "runtime.pending-effects-reconcile-requested",
      lane: "system",
      laneSeq: "3",
    });
    const deviceTail = createMailboxItem({
      dedupeKey: "device-sync.wake:stale-default-projection-tail",
      id: "mailbox_item_stale_default_projection_device_tail",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "4",
    });
    const deviceSyncPort = createEmptyDeviceSyncPort();
    let assistantPhaseCalls = 0;
    let snapshotOrdinal = 0;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.runAssistantAutomationPass.mockClear();
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await upsertAutomation({
        automationId,
        continuityPolicy: "fresh",
        instructions: "Record one synthetic scheduled check-in.",
        now: new Date(staleDefaultWakeAt),
        route: {
          channel: "linq",
          deliveryTarget: "synthetic_direct_chat",
          identityId: null,
          participantId: null,
          threadId: "synthetic_direct_chat",
          threadIsDirect: true,
        },
        schedule: { at: staleDefaultWakeAt, kind: "at" },
        status: "active",
        title: "Synthetic stale projection check-in",
        vaultRoot,
      });
      const cronAutomationStatePath = resolveAssistantStatePaths(
        vaultRoot,
      ).cronAutomationStatePath;
      await mkdir(path.dirname(cronAutomationStatePath), { recursive: true });
      await writeFile(
        cronAutomationStatePath,
        `${JSON.stringify({
          jobs: [{
            alias: null,
            createdAt: staleDefaultWakeAt,
            jobId: automationId,
            schema: "murph.assistant-canonical-cron-runtime-state.v1",
            sessionId: null,
            state: {
              activatedAt: staleDefaultWakeAt,
              consecutiveFailures: 0,
              lastError: null,
              lastFailedAt: null,
              lastRunAt: null,
              lastSucceededAt: null,
              pendingDeliveryIntentId: null,
              pendingOccurrenceAt: staleDefaultWakeAt,
              retryAfterAt: null,
              runningAt,
              runningClaimId: "claim_synthetic_stale_default",
              runningPid: process.pid,
            },
            updatedAt: runningAt,
          }],
          version: 1,
        }, null, 2)}\n`,
      );
      assert.deepEqual(await getAssistantCronStatus(vaultRoot), {
        dueJobs: 0,
        enabledJobs: 1,
        nextRunAt: staleDefaultWakeAt,
        runningJobs: 1,
        totalJobs: 1,
      });

      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceHead,
        vaultRoot,
      });
      await enqueuePendingEffectsSystemMailboxItemForTest({
        effectId: "effect_synthetic_stale_default_projection",
        item: pendingEffects,
        vaultRoot,
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceTail,
        vaultRoot,
      });
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: state.pending.map((item) =>
          item.itemId === pendingEffects.id
            ? { ...item, nextAttemptAt: futurePendingEffectsWakeAt }
            : item
        ),
      }));
      const pendingBeforeInvocation = structuredClone(
        (await readHostedSystemMailboxState(vaultRoot)).pending,
      );
      assert.deepEqual(
        pendingBeforeInvocation.map((item) => item.mailboxLaneSeq),
        ["1", "3", "4"],
      );
      assert.equal(
        findNextHostedSystemMailboxQueueItem({
          allowedRouteActions: null,
          now: TEST_NOW,
          state: { pending: pendingBeforeInvocation },
        })?.itemId,
        deviceHead.id,
      );
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "4";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/stale-default-projection-before.bundle.json",
        vaultRoot,
      });
      artifactBytesByHash.set(restoredWorkspace.hash, restoredWorkspace.bytes);
      let currentWorkspace = createWorkspaceState({
        nextDefaultProcessingWakeAt: staleDefaultWakeAt,
        nextDefaultProcessingWakeReason: "assistant",
        nextWakeAt: staleDeviceWakeAt,
        nextWakeReason: "device-sync.reconcile",
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 0,
          hostedMailboxImportedCount: 0,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemHandledThroughSeq: "0",
          hostedMailboxSystemImportedSeq: "4",
        },
        snapshotRef: restoredWorkspace.snapshotRef,
        systemMailboxProgressGeneration: "1",
        version: "0",
      });
      const workspacePort: HostedRuntimeWorkspacePort = {
        async checkpoint(request) {
          events.push("workspace.checkpoint");
          checkpointRequests.push(request);
          currentWorkspace = createWorkspaceState({
            inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
            nextDefaultProcessingWakeAt:
              request.nextDefaultProcessingWakeAt ?? null,
            nextDefaultProcessingWakeReason:
              request.nextDefaultProcessingWakeReason ?? null,
            nextWakeAt: request.nextWakeAt ?? null,
            nextWakeReason: request.nextWakeReason ?? null,
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: request.snapshotRef,
            systemMailboxProgressGeneration:
              request.systemMailboxProgressGeneration ?? null,
            version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
          });
          return {
            checkpointed: true,
            workspace: currentWorkspace,
          };
        },
        async read() {
          events.push("workspace.read");
          return {
            fetchedAt: TEST_NOW,
            workspace: currentWorkspace,
          };
        },
      };
      const platform = createPlatform({
        artifactBytesByHash,
        artifactGetCalls,
        deviceSyncPort,
        mailboxPort: createMailboxPort({
          events,
          fetchRequests,
          items: [],
        }),
        workspacePort,
      });
      const createCheckpointSnapshot = async () => {
        snapshotOrdinal += 1;
        const snapshot = await createVaultSnapshotBundle({
          key:
            `users/bundles/member-synthetic/stale-default-projection-${snapshotOrdinal}.bundle.json`,
          vaultRoot,
        });
        artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
        return { snapshotRef: snapshot.snapshotRef };
      };

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_stale_default_projection",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          createCheckpointSnapshot,
          async importItem() {
            throw new Error("The restored 0/4/4 mailbox must not import a new row.");
          },
          platform,
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            const phaseResult = await runHostedWorkspaceAssistantPhase({
              ...input,
              now: () => TEST_NOW,
            });
            assert.equal(phaseResult.progressed, false);
            assert.equal(phaseResult.nextWakeAt, TEST_NOW);
            assert.equal(phaseResult.nextWakeReason, "device-sync.reconcile");
            return phaseResult;
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 1);
      assert.equal(checkpointRequests.length, 1);
      const checkpoint = checkpointRequests[0];
      assert.ok(checkpoint);
      assert.equal(checkpoint.reason, "idle_shutdown");
      assert.equal(checkpoint.expectedWorkspaceVersion, "0");
      assert.equal(checkpoint.nextWakeAt, TEST_NOW);
      assert.equal(checkpoint.nextWakeReason, "device-sync.reconcile");
      assert.equal(
        checkpoint.nextDefaultProcessingWakeAt,
        futurePendingEffectsWakeAt,
      );
      assert.equal(checkpoint.nextDefaultProcessingWakeReason, "assistant");
      assert.equal(checkpoint.systemMailboxProgressGeneration, "1");
      assert.equal(
        checkpoint.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "0",
      );
      assert.equal(
        checkpoint.redactedStatus?.hostedMailboxSystemImportedSeq,
        "4",
      );
      assert.equal(checkpoint.redactedStatus?.hostedMailboxFetchedCount, 0);
      assert.equal(checkpoint.redactedStatus?.hostedMailboxImportedCount, 0);
      assert.equal(result.status, "scheduled");
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.nextWakeAt, TEST_NOW);
      assert.equal(result.nextWakeReason, "device-sync.reconcile");
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 0);
      assert.equal(deviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.equal(mocks.runAssistantAutomationPass.mock.calls.length, 0);
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending,
        pendingBeforeInvocation,
      );
      assert.equal(currentWorkspace.version, "1");
      assert.deepEqual(currentWorkspace.snapshotRef, checkpoint.snapshotRef);
      assert.equal(
        artifactBytesByHash.has(currentWorkspace.snapshotRef.hash),
        true,
      );

      const checkpointCountBeforeSystemPass = checkpointRequests.length;
      const artifactGetCountBeforeSystemPass = artifactGetCalls.length;
      const fetchCountBeforeSystemPass = fetchRequests.length;
      const systemResult = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_stale_default_projection_system_handoff",
            processingMode: "system_mailbox",
            workspaceVersion: currentWorkspace.version,
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          createCheckpointSnapshot,
          async importItem() {
            throw new Error("The handed-off 0/4/4 mailbox must not import a new row.");
          },
          platform,
          async runAssistantPhase() {
            throw new Error("The system owner handoff must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      const systemPassCheckpoints = checkpointRequests.slice(
        checkpointCountBeforeSystemPass,
      );
      assert.ok(systemPassCheckpoints.length > 0);
      const systemCheckpoint = systemPassCheckpoints.at(-1);
      assert.ok(systemCheckpoint);
      assert.equal(
        systemCheckpoint.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "2",
      );
      assert.equal(
        systemCheckpoint.redactedStatus?.hostedMailboxSystemImportedSeq,
        "4",
      );
      assert.equal(
        systemPassCheckpoints.every((request) =>
          request.systemMailboxProgressGeneration === "1"
        ),
        true,
      );
      assert.equal(currentWorkspace.systemMailboxProgressGeneration, "1");
      assert.equal(
        artifactGetCalls.slice(artifactGetCountBeforeSystemPass).includes(
          checkpoint.snapshotRef.hash,
        ),
        true,
      );
      assert.deepEqual(
        fetchRequests.slice(fetchCountBeforeSystemPass).map((request) =>
          request.lanes.map((lane) => ({
            importedSeq: lane.importedSeq,
            lane: lane.lane,
          }))
        ),
        [[{ importedSeq: "4", lane: "system" }]],
      );
      assert.equal(systemResult.status, "scheduled");
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(deviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.equal(assistantPhaseCalls, 1);
      assert.equal(mocks.runAssistantAutomationPass.mock.calls.length, 0);
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      const remainingPending = (await readHostedSystemMailboxState(vaultRoot)).pending;
      assert.deepEqual(
        remainingPending.map((item) => item.mailboxLaneSeq),
        ["3", "4"],
      );
      assert.deepEqual(remainingPending, pendingBeforeInvocation.slice(1));
    } finally {
      mocks.runAssistantAutomationPass.mockClear();
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("default foreground hands a timed-out browser refresh to the model-free system owner", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const conversationItem = createMailboxItem({
      id: "mailbox_item_default_browser_vault_foreground",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: "1",
    });
    const refreshItem = createMailboxItem({
      dedupeKey: "runtime.browser-vault-refresh-requested:default-timeout-retry",
      id: "mailbox_item_default_browser_vault_timeout_retry",
      kind: "runtime.browser-vault-refresh-requested",
      lane: "system",
      laneSeq: "1",
    });
    const refreshWake = buildHostedExecutionRuntimeControlWake({
      eventId: refreshItem.dedupeKey,
      kind: "runtime.browser-vault-refresh-requested",
      occurredAt: refreshItem.occurredAt,
      userId: TEST_USER_ID,
    });
    const refreshImplementation =
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.getMockImplementation();
    const automationImplementation =
      mocks.runAssistantAutomationPass.getMockImplementation();
    const foregroundAssistantInputIds: string[] = [];
    const importedRefreshRecords: Array<
      Awaited<ReturnType<typeof readHostedSystemMailboxState>>["pending"][number]
    > = [];
    let importedForegroundAssistantInputId: string | null = null;
    let forcedRefreshCalls = 0;
    let snapshotIndex = 0;

    mocks.runAssistantAutomationPass.mockImplementation(
      async (automationInput: RunAssistantAutomationPassInput) => {
        const candidates = await automationInput.inputSource?.listInputCandidates({
          afterCursor: null,
          limit: 10,
          sourceId: "linq",
        });
        const inputIds = candidates?.inputs.map((candidate) => candidate.event.inputId) ?? [];
        if (inputIds.length === 0) {
          return {
            currentTurnDeliveryIntentIds: [],
            nextWakeAt: null,
            progressed: false,
          };
        }

        events.push("foreground.default-work");
        foregroundAssistantInputIds.push(...inputIds);
        for (const inputId of inputIds) {
          await writeSyntheticAssistantAutoReplyTerminalEvidence({
            inputId,
            vaultRoot,
          });
        }
        return {
          currentTurnDeliveryIntentIds: [],
          nextWakeAt: null,
          progressed: true,
        };
      },
    );
    mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(async (input) => {
      if (input.force !== true) {
        return { status: "skipped_no_port" };
      }
      forcedRefreshCalls += 1;
      events.push(`browser-vault.refresh:${forcedRefreshCalls}`);
      if (forcedRefreshCalls === 1) {
        assert.equal(input.attempt, "initial");
        return {
          attempt: "initial",
          configuredTimeoutMs: 30_000,
          currentStepElapsedMs: 8_000,
          refreshElapsedMs: 30_000,
          refreshStage: "replica_serialization",
          refreshStep: "replica_serialization",
          source: { fileCount: 2, totalBytes: 1_024 },
          status: "deferred_timeout",
        };
      }
      if (forcedRefreshCalls === 2) {
        assert.equal(input.attempt, "retry");
        const publishedReplicaRef = createBrowserVaultReplicaRef({
          generatedAt: new Date().toISOString(),
          generation: 1,
          source: {
            dataVersion: "browser-vault-default-timeout-retry",
            sourceBundleHash: "e".repeat(64),
          },
        });
        return {
          byteLength: publishedReplicaRef.byteLength,
          content: {
            entities: 0,
            hasPrivateContent: false,
            labResultRows: 0,
            metricGoalProgressRows: 0,
            metricRows: 0,
            metricSelectionRows: 0,
            searchRows: 0,
            sourceHealthRows: 0,
            timelineRows: 0,
            weeklySampleSummaries: 0,
          },
          freshness: {
            freshness: "stale",
            reason: "missing",
            shouldRefresh: true,
          },
          replicaRef: publishedReplicaRef,
          source: { fileCount: 2, totalBytes: 1_024 },
          status: "published",
        };
      }
      throw new Error("A terminal Browser Vault refresh must not retry again.");
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/default-browser-vault-timeout-retry-before.bundle.json",
        vaultRoot,
      });
      artifactBytesByHash.set(restoredWorkspace.hash, restoredWorkspace.bytes);
      let currentWorkspace = createWorkspaceState({
        nextWakeAt: TEST_NOW,
        nextWakeReason: "assistant",
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 0,
          hostedMailboxImportedCount: 0,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemHandledThroughSeq: "0",
          hostedMailboxSystemImportedSeq: "0",
        },
        snapshotRef: restoredWorkspace.snapshotRef,
        version: "0",
      });
      const workspacePort: HostedRuntimeWorkspacePort = {
        async checkpoint(request) {
          events.push("workspace.checkpoint");
          checkpointRequests.push(request);
          currentWorkspace = createWorkspaceState({
            browserVaultReplicaRef: currentWorkspace.browserVaultReplicaRef ?? null,
            inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
            ...(request.systemMailboxProgressGeneration === undefined
              ? {}
              : {
                  nextDefaultProcessingWakeAt:
                    request.nextDefaultProcessingWakeAt ?? null,
                  nextDefaultProcessingWakeReason:
                    request.nextDefaultProcessingWakeReason ?? null,
                  systemMailboxProgressGeneration:
                    request.systemMailboxProgressGeneration,
                }),
            nextWakeAt: request.nextWakeAt ?? null,
            nextWakeReason: request.nextWakeReason ?? null,
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: request.snapshotRef,
            version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
          });
          return {
            checkpointed: true,
            workspace: currentWorkspace,
          };
        },
        async read() {
          events.push("workspace.read");
          return {
            fetchedAt: new Date().toISOString(),
            workspace: currentWorkspace,
          };
        },
      };
      const platform = createPlatform({
        artifactBytesByHash,
        mailboxPort: createMailboxPort({
          events,
          items: [conversationItem, refreshItem],
        }),
        workspacePort,
      });
      const runWorkspacePass = async (
        attemptId: string,
        processingMode: "default" | "system_mailbox" = "default",
      ) =>
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              ...(processingMode === "system_mailbox"
                ? {
                    assistantExecutionBlocked: true as const,
                    processingMode,
                  }
                : {}),
              attemptId,
              workspaceVersion: currentWorkspace.version,
            },
          }),
          {
            async createCheckpointSnapshot() {
              snapshotIndex += 1;
              const snapshot = await createVaultSnapshotBundle({
                key: `users/bundles/member-synthetic/default-browser-vault-timeout-retry-${snapshotIndex}.bundle.json`,
                vaultRoot,
              });
              artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
              return { snapshotRef: snapshot.snapshotRef };
            },
            async importItem(item, context) {
              if (item.item.id === refreshItem.id) {
                const outcome = await enqueueHostedSystemMailboxItem({
                  item,
                  vaultRoot,
                  wake: refreshWake,
                });
                const importedRefreshRecord =
                  (await readHostedSystemMailboxState(vaultRoot)).pending.find(
                    (pendingItem) => pendingItem.itemId === refreshItem.id,
                  );
                assert.equal(importedRefreshRecord?.status, "pending");
                assert.ok(importedRefreshRecord);
                importedRefreshRecords.push(structuredClone(importedRefreshRecord));
                return outcome;
              }
              assert.equal(item.item.id, conversationItem.id);
              context?.onConversationInputStaged?.("linq");
              importedForegroundAssistantInputId =
                await stageAssistantInputEventForMailboxItem({
                  item: item.item,
                  vaultRoot,
                });
              return {
                assistantInputId: importedForegroundAssistantInputId,
                status: "imported",
              };
            },
            platform,
            async runAssistantPhase(input) {
              assert.equal(processingMode, "default");
              events.push("assistant.phase");
              return await runHostedWorkspaceAssistantPhase(input);
            },
            vaultRoot,
          },
        );

      const foreground = await runWorkspacePass(
        "attempt_synthetic_default_browser_vault_foreground",
      );

      assert.equal(forcedRefreshCalls, 0);
      assert.equal(foreground.status, "scheduled");
      assert.equal(foreground.immediateRecheckRequested, true);
      assert.equal(foreground.nextWakeReason, "assistant");
      const foregroundRecheckAt = foreground.nextWakeAt;
      assert.ok(foregroundRecheckAt);
      assert.ok(importedForegroundAssistantInputId);
      assert.deepEqual(foregroundAssistantInputIds, [importedForegroundAssistantInputId]);
      const importedRefreshRecord = importedRefreshRecords[0];
      assert.ok(importedRefreshRecord);
      const foregroundState = await readHostedSystemMailboxState(vaultRoot);
      assert.equal(foregroundState.pending.length, 1);
      const pending = foregroundState.pending[0];
      assert.equal(pending?.itemId, importedRefreshRecord.itemId);
      assert.equal(
        pending?.mailboxDedupeKey,
        importedRefreshRecord.mailboxDedupeKey,
      );
      assert.equal(pending?.mailboxLaneSeq, importedRefreshRecord.mailboxLaneSeq);
      assert.equal(pending?.occurredAt, importedRefreshRecord.occurredAt);
      assert.equal(pending?.requestId, importedRefreshRecord.requestId);
      assert.deepEqual(pending?.wake, importedRefreshRecord.wake);
      assert.equal(pending?.status, "pending");
      assert.equal(pending?.postCheckpointRecord, null);
      assert.equal(pending?.nextAttemptAt, null);
      const checkpointCountAfterForeground = checkpointRequests.length;
      vi.setSystemTime(new Date(foregroundRecheckAt));
      const timeoutInvocationAt = new Date().toISOString();
      const retryAt = new Date(Date.now() + 60_000).toISOString();

      const timedOut = await runWorkspacePass(
        "attempt_synthetic_system_mailbox_browser_vault_timeout",
        "system_mailbox",
      );

      assert.equal(forcedRefreshCalls, 1);
      assert.equal(timedOut.status, "scheduled");
      assert.equal(timedOut.nextWakeAt, retryAt);
      assert.equal(timedOut.nextWakeReason, "assistant");
      assert.equal(timedOut.immediateRecheckRequested, undefined);
      assert.ok(
        requireEventIndex(events, "foreground.default-work")
          < requireEventIndex(events, "browser-vault.refresh:1"),
      );
      const checkpointCountAfterTimeout = checkpointRequests.length;
      assert.ok(checkpointCountAfterTimeout > checkpointCountAfterForeground);
      const timeoutCheckpoint = checkpointRequests.at(-1);
      assert.equal(timeoutCheckpoint?.nextWakeAt, retryAt);
      assert.equal(timeoutCheckpoint?.nextWakeReason, "assistant");
      assert.equal(
        timeoutCheckpoint?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "0",
      );
      const timeoutState = await readHostedSystemMailboxState(vaultRoot);
      assert.equal(timeoutState.pending.length, 1);
      const retained = timeoutState.pending[0];
      assert.equal(retained?.itemId, importedRefreshRecord.itemId);
      assert.equal(
        retained?.mailboxDedupeKey,
        importedRefreshRecord.mailboxDedupeKey,
      );
      assert.equal(retained?.mailboxLaneSeq, importedRefreshRecord.mailboxLaneSeq);
      assert.equal(retained?.occurredAt, importedRefreshRecord.occurredAt);
      assert.equal(retained?.requestId, importedRefreshRecord.requestId);
      assert.deepEqual(retained?.wake, importedRefreshRecord.wake);
      assert.equal(retained?.status, "recording");
      assert.equal(retained?.postCheckpointRecord, null);
      assert.equal(retained?.nextAttemptAt, retryAt);

      vi.setSystemTime(new Date(Date.parse(timeoutInvocationAt) + 30_000));
      const beforeRetry = await runWorkspacePass(
        "attempt_synthetic_system_mailbox_browser_vault_timeout_before_retry",
        "system_mailbox",
      );

      assert.equal(forcedRefreshCalls, 1);
      assert.equal(beforeRetry.status, "scheduled");
      const deferredDefaultOwnerWakeAt = beforeRetry.nextWakeAt;
      assert.ok(deferredDefaultOwnerWakeAt);
      assert.notEqual(deferredDefaultOwnerWakeAt, retryAt);
      assert.ok(Date.parse(deferredDefaultOwnerWakeAt) > Date.parse(retryAt));
      assert.equal(beforeRetry.nextWakeReason, "assistant");
      assert.equal(beforeRetry.immediateRecheckRequested, undefined);
      assert.equal(checkpointRequests.length, checkpointCountAfterTimeout);
      assert.equal(currentWorkspace.nextWakeAt, retryAt);
      assert.equal(currentWorkspace.nextWakeReason, "assistant");
      const beforeRetryRecord = (await readHostedSystemMailboxState(vaultRoot)).pending[0];
      assert.deepEqual(beforeRetryRecord, retained);

      vi.setSystemTime(new Date(retryAt));
      const published = await runWorkspacePass(
        "attempt_synthetic_system_mailbox_browser_vault_timeout_published",
        "system_mailbox",
      );

      const publicationCheckpoint = checkpointRequests.at(-1);
      const expectedRetentionWakeAt = new Date(
        Date.parse(conversationItem.createdAt) + 14 * 24 * 60 * 60 * 1000,
      ).toISOString();
      assert.equal(forcedRefreshCalls, 2);
      assert.equal(published.status, "scheduled");
      assert.equal(published.immediateRecheckRequested, undefined);
      assert.equal(published.nextWakeAt, deferredDefaultOwnerWakeAt);
      assert.equal(published.nextWakeReason, "assistant");
      assert.ok(
        Date.parse(deferredDefaultOwnerWakeAt)
          < Date.parse(expectedRetentionWakeAt),
      );
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
      assert.equal(publicationCheckpoint?.nextWakeAt, deferredDefaultOwnerWakeAt);
      assert.equal(publicationCheckpoint?.nextWakeReason, "assistant");
      assert.equal(
        publicationCheckpoint?.inboxMediaRetentionWakeAt,
        expectedRetentionWakeAt,
      );
      assert.equal(
        publicationCheckpoint?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "1",
      );
    } finally {
      if (automationImplementation) {
        mocks.runAssistantAutomationPass.mockImplementation(automationImplementation);
      }
      const restoreRefreshImplementation =
        refreshImplementation
        ?? mocks.actualRefreshHostedBrowserVaultReplicaFromRuntime;
      if (restoreRefreshImplementation) {
        mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(
          restoreRefreshImplementation,
        );
      }
      mocks.runAssistantAutomationPass.mockClear();
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox mode preserves one browser timeout retry across projection backoff and exposes its successor", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const events: string[] = [];
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const refreshItem = createMailboxItem({
      dedupeKey: "runtime.browser-vault-refresh-requested:timeout-retry",
      id: "mailbox_item_system_mailbox_browser_vault_timeout_retry",
      kind: "runtime.browser-vault-refresh-requested",
      lane: "system",
      laneSeq: "1",
    });
    const refreshWake = buildHostedExecutionRuntimeControlWake({
      eventId: refreshItem.dedupeKey,
      kind: "runtime.browser-vault-refresh-requested",
      occurredAt: refreshItem.occurredAt,
      userId: TEST_USER_ID,
    });
    const successorText = "Synthetic Browser Vault successor completed.";
    const successorDeliveryKey = "group-join:browser-vault-timeout-successor";
    const successorDedupeKey =
      `assistant.notification.requested:${successorDeliveryKey}`;
    const successorItem = createMailboxItem({
      dedupeKey: successorDedupeKey,
      id: "mailbox_item_system_mailbox_browser_vault_timeout_successor",
      kind: "assistant.notification.requested",
      lane: "system",
      laneSeq: "2",
    });
    const successorTarget = "synthetic_browser_vault_timeout_successor";
    const successorIdentityId = "hbidx:phone:v1:browser-vault-timeout-successor";
    const successorThreadId = "hbidx:thread:v1:browser-vault-timeout-successor";
    const successorWake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: successorDedupeKey,
      memberId: TEST_USER_ID,
      notification: {
        deliveryDispatchMode: "queue-only",
        deliveryDedupeToken: successorDeliveryKey,
        deliveryIdempotencyKey: successorDeliveryKey,
        instructions: "Send the exact synthetic completion text.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: successorText,
        },
        route: {
          actorId: null,
          channel: "linq",
          delivery: {
            kind: "thread",
            target: successorTarget,
          },
          identityId: successorIdentityId,
          threadId: successorThreadId,
          threadIsDirect: true,
        },
      },
      occurredAt: TEST_NOW,
    });
    const refreshImplementation =
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.getMockImplementation();
    const projectionRetryAt = new Date(
      Date.parse(TEST_NOW) + 60_000,
    ).toISOString();
    const timeoutRetryAt = new Date(
      Date.parse(projectionRetryAt) + 60_000,
    ).toISOString();
    const projectionRetryAfterTimeoutAt = new Date(
      Date.parse(timeoutRetryAt) + 60_000,
    ).toISOString();
    const successorAt = new Date(
      Date.parse(projectionRetryAfterTimeoutAt) + 30_000,
    ).toISOString();
    const thirdRetryAt = new Date(
      Date.parse(projectionRetryAfterTimeoutAt) + 60_000,
    ).toISOString();
    let projectionReads = 0;
    let projectionShouldFail = true;
    let refreshCalls = 0;
    let snapshotIndex = 0;

    mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(async (input) => {
      assert.equal(input.force, true);
      refreshCalls += 1;
      if (refreshCalls === 1) {
        assert.equal(input.attempt, "initial");
        return {
          attempt: "initial",
          configuredTimeoutMs: 30_000,
          currentStepElapsedMs: 9_000,
          refreshElapsedMs: 30_000,
          refreshStage: "replica_construction",
          refreshStep: "replica_construction_experiment_outcome_read",
          source: { fileCount: 2, totalBytes: 1_024 },
          status: "deferred_timeout",
        };
      }
      if (refreshCalls === 2) {
        assert.equal(input.attempt, "retry");
        return {
          attempt: "retry",
          configuredTimeoutMs: 30_000,
          currentStepElapsedMs: 18_000,
          refreshElapsedMs: 30_000,
          refreshStage: "replica_construction",
          refreshStep: "replica_construction_projection",
          source: { fileCount: 2, totalBytes: 1_024 },
          status: "deferred_timeout",
        };
      }
      throw new Error("A second Browser Vault timeout must terminalize without a third refresh.");
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedRuntimeControlSystemMailboxItem(refreshItem),
        vaultRoot,
        wake: refreshWake,
      });
      await enqueueHostedSystemMailboxItem({
        item: {
          item: successorItem,
          payload: {
            payloadCiphertext: "ciphertext",
            payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
            requestId: `request_${successorItem.id}`,
            source: "inline",
            status: "resolved",
          },
          route: {
            action: "dispatch-assistant-notification",
            advanceProgress: true,
            itemRef: {
              id: successorItem.id,
              kind: successorItem.kind,
              lane: successorItem.lane,
              laneSeq: successorItem.laneSeq,
            },
            state: "route",
          },
        },
        vaultRoot,
        wake: successorWake,
      });
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: state.pending.map((item) =>
          item.itemId === refreshItem.id
            ? {
                ...item,
                attemptCount: 1,
                lastAttemptAt: "2026-04-26T23:59:00.000Z",
                postCheckpointRecord: null,
                status: "recording" as const,
              }
            : item.itemId === successorItem.id
              ? {
                  ...item,
                  attemptCount: 1,
                  lastAttemptAt: TEST_NOW,
                  nextAttemptAt: successorAt,
                  status: "recording" as const,
                }
              : item
        ),
      }));
      const successorIntent = await createAssistantOutboxIntent({
        channel: "linq",
        createdAt: TEST_NOW,
        dedupeToken: successorDeliveryKey,
        deliveryIdempotencyKey: successorDeliveryKey,
        deliveryTransportIdempotent: true,
        explicitTarget: successorTarget,
        identityId: successorIdentityId,
        message: successorText,
        sessionId: "session_browser_vault_timeout_successor",
        threadId: successorThreadId,
        threadIsDirect: true,
        turnId: "turn_browser_vault_timeout_successor",
        vault: vaultRoot,
      });
      const sentSuccessorIntent = await markAssistantOutboxIntentSentById({
        delivery: {
          channel: "linq",
          idempotencyKey: successorDeliveryKey,
          messageLength: successorText.length,
          providerMessageId: "provider_browser_vault_timeout_successor",
          providerThreadId: successorTarget,
          sentAt: TEST_NOW,
          target: successorTarget,
          targetKind: "explicit",
        },
        intentId: successorIntent.intentId,
        vault: vaultRoot,
      });
      assert.equal(sentSuccessorIntent?.status, "sent");
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "2";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-browser-vault-timeout-retry-before.bundle.json",
        vaultRoot,
      });
      artifactBytesByHash.set(restoredWorkspace.hash, restoredWorkspace.bytes);
      let currentWorkspace = createWorkspaceState({
        nextWakeAt: TEST_NOW,
        nextWakeReason: "assistant",
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 0,
          hostedMailboxImportedCount: 0,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemHandledThroughSeq: "0",
          hostedMailboxSystemImportedSeq: "2",
        },
        snapshotRef: restoredWorkspace.snapshotRef,
        version: "0",
      });
      const workspacePort: HostedRuntimeWorkspacePort = {
        async checkpoint(request) {
          events.push("workspace.checkpoint");
          checkpointRequests.push(request);
          currentWorkspace = createWorkspaceState({
            browserVaultReplicaRef: currentWorkspace.browserVaultReplicaRef ?? null,
            inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
            ...(request.systemMailboxProgressGeneration === undefined
              ? {}
              : {
                  nextDefaultProcessingWakeAt:
                    request.nextDefaultProcessingWakeAt ?? null,
                  nextDefaultProcessingWakeReason:
                    request.nextDefaultProcessingWakeReason ?? null,
                  systemMailboxProgressGeneration:
                    request.systemMailboxProgressGeneration,
                }),
            nextWakeAt: request.nextWakeAt ?? null,
            nextWakeReason: request.nextWakeReason ?? null,
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: request.snapshotRef,
            version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
          });
          return {
            checkpointed: true,
            workspace: currentWorkspace,
          };
        },
        async read() {
          events.push("workspace.read");
          return {
            fetchedAt: new Date().toISOString(),
            workspace: currentWorkspace,
          };
        },
      };
      const persistHarnessVaultState = async (label: string) => {
        snapshotIndex += 1;
        const snapshot = await createVaultSnapshotBundle({
          key: `users/bundles/member-synthetic/system-mailbox-browser-vault-${label}-${snapshotIndex}.bundle.json`,
          vaultRoot,
        });
        artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
        currentWorkspace = {
          ...currentWorkspace,
          snapshotRef: snapshot.snapshotRef,
        };
      };
      const platform = createPlatform({
        artifactBytesByHash,
        mailboxPort: createMailboxPort({ events, items: [] }),
        vaultSharePort: {
          async listActiveProjectionScopes() {
            projectionReads += 1;
            if (projectionShouldFail) {
              throw new Error("Synthetic Browser Vault projection failure.");
            }
            return {
              projectionKinds: [],
              projectionScopes: [],
            };
          },
          async deliver() {
            throw new Error("No Browser Vault projection should be delivered.");
          },
        },
        workspacePort,
      });
      const runSystemPass = async (attemptId: string) =>
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              assistantExecutionBlocked: true,
              attemptId,
              processingMode: "system_mailbox",
              workspaceVersion: currentWorkspace.version,
            },
          }),
          {
            async createCheckpointSnapshot() {
              snapshotIndex += 1;
              const snapshot = await createVaultSnapshotBundle({
                key: `users/bundles/member-synthetic/system-mailbox-browser-vault-timeout-retry-${snapshotIndex}.bundle.json`,
                vaultRoot,
              });
              artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
              return { snapshotRef: snapshot.snapshotRef };
            },
            async importItem() {
              throw new Error("Already-imported Browser Vault refresh work must not import a new row.");
            },
            platform,
            async runAssistantPhase() {
              throw new Error("System mailbox Browser Vault refresh must not enter assistant phase.");
            },
            vaultRoot,
          },
        );

      const projectionFailedBeforeRefresh = await runSystemPass(
        "attempt_synthetic_system_mailbox_browser_vault_projection_before_timeout",
      );

      assert.equal(refreshCalls, 0);
      assert.equal(projectionReads, 1);
      assert.equal(projectionFailedBeforeRefresh.status, "scheduled");
      assert.equal(projectionFailedBeforeRefresh.nextWakeAt, projectionRetryAt);
      assert.equal(projectionFailedBeforeRefresh.nextWakeReason, "assistant");
      assert.equal(projectionFailedBeforeRefresh.immediateRecheckRequested, undefined);
      assert.equal(checkpointRequests.length, 0);
      const stateAfterProjectionFailure =
        await readHostedSystemMailboxState(vaultRoot);
      assert.equal(stateAfterProjectionFailure.pending.length, 2);
      const projectionBackoffItem = stateAfterProjectionFailure.pending.find(
        (item) => item.itemId === refreshItem.id,
      );
      assert.ok(projectionBackoffItem);
      assert.equal(projectionBackoffItem.status, "recording");
      assert.equal(projectionBackoffItem.postCheckpointRecord, null);
      assert.equal(projectionBackoffItem.nextAttemptAt, projectionRetryAt);
      assert.equal(
        projectionBackoffItem.lastErrorCode,
        "HOSTED_VAULT_SHARE_PROJECTION_FAILED",
      );
      assert.equal(
        projectionBackoffItem.lastErrorMessage,
        "Vault-share projection failed before device-sync acknowledgement.",
      );
      await persistHarnessVaultState("projection-before-timeout");

      projectionShouldFail = false;
      vi.setSystemTime(new Date(projectionRetryAt));
      const timedOut = await runSystemPass(
        "attempt_synthetic_system_mailbox_browser_vault_timeout",
      );

      assert.equal(refreshCalls, 1);
      assert.equal(projectionReads, 2);
      assert.equal(timedOut.status, "scheduled");
      assert.equal(timedOut.nextWakeAt, timeoutRetryAt);
      assert.equal(timedOut.nextWakeReason, "assistant");
      assert.equal(timedOut.immediateRecheckRequested, undefined);
      const checkpointCountAfterTimeout = checkpointRequests.length;
      assert.equal(checkpointCountAfterTimeout, 1);
      const timeoutCheckpoint = checkpointRequests.at(-1);
      assert.equal(timeoutCheckpoint?.nextWakeAt, timeoutRetryAt);
      assert.equal(timeoutCheckpoint?.nextWakeReason, "assistant");
      assert.equal(
        checkpointRequests.filter((request) =>
          request.nextWakeAt === timeoutRetryAt
          && request.nextWakeReason === "assistant"
        ).length,
        1,
      );
      assert.equal(
        timeoutCheckpoint?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "0",
      );
      const stateAfterFirstTimeout = await readHostedSystemMailboxState(vaultRoot);
      assert.equal(stateAfterFirstTimeout.pending.length, 2);
      const retained = stateAfterFirstTimeout.pending.find(
        (item) => item.itemId === refreshItem.id,
      );
      const retainedSuccessor = stateAfterFirstTimeout.pending.find(
        (item) => item.itemId === successorItem.id,
      );
      assert.equal(retained?.itemId, refreshItem.id);
      assert.equal(retained?.mailboxDedupeKey, refreshItem.dedupeKey);
      assert.equal(retained?.mailboxLaneSeq, refreshItem.laneSeq);
      assert.equal(retained?.occurredAt, refreshItem.occurredAt);
      assert.deepEqual(retained?.wake, refreshWake);
      assert.equal(retained?.status, "recording");
      assert.equal(retained?.postCheckpointRecord, null);
      assert.equal(retained?.lastErrorCode, null);
      assert.equal(retained?.lastErrorMessage, null);
      assert.equal(retained?.nextAttemptAt, timeoutRetryAt);
      assert.ok(retainedSuccessor);
      assert.equal(
        isHostedSystemMailboxModelFreeExactNotificationItem(retainedSuccessor),
        true,
      );
      assert.equal(retainedSuccessor.nextAttemptAt, successorAt);
      const prematureAt = new Date(
        Date.parse(projectionRetryAt) + 30_000,
      ).toISOString();
      assert.equal(
        findNextHostedSystemMailboxQueueItem({
          allowedRouteActions: null,
          now: prematureAt,
          state: stateAfterFirstTimeout,
        }),
        null,
      );

      vi.setSystemTime(new Date(prematureAt));
      const beforeRetry = await runSystemPass(
        "attempt_synthetic_system_mailbox_browser_vault_timeout_before_retry",
      );

      assert.equal(refreshCalls, 1);
      assert.equal(beforeRetry.status, "idle");
      assert.equal(beforeRetry.nextWakeAt, null);
      assert.equal(beforeRetry.nextWakeReason ?? null, null);
      assert.equal(beforeRetry.immediateRecheckRequested, undefined);
      assert.equal(checkpointRequests.length, checkpointCountAfterTimeout);
      assert.equal(currentWorkspace.nextWakeAt, timeoutRetryAt);
      assert.equal(currentWorkspace.nextWakeReason, "assistant");
      const beforeRetryState = await readHostedSystemMailboxState(vaultRoot);
      assert.deepEqual(beforeRetryState, stateAfterFirstTimeout);
      assert.equal(
        findNextHostedSystemMailboxQueueItem({
          allowedRouteActions: null,
          now: timeoutRetryAt,
          state: beforeRetryState,
        })?.itemId,
        refreshItem.id,
      );

      projectionShouldFail = true;
      vi.setSystemTime(new Date(timeoutRetryAt));
      const projectionFailedAfterTimeout = await runSystemPass(
        "attempt_synthetic_system_mailbox_browser_vault_projection_before_timeout_retry",
      );

      assert.equal(refreshCalls, 1);
      assert.equal(projectionReads, 3);
      assert.equal(projectionFailedAfterTimeout.status, "scheduled");
      assert.equal(
        projectionFailedAfterTimeout.nextWakeAt,
        projectionRetryAfterTimeoutAt,
      );
      assert.equal(projectionFailedAfterTimeout.nextWakeReason, "assistant");
      assert.equal(projectionFailedAfterTimeout.immediateRecheckRequested, undefined);
      assert.equal(checkpointRequests.length, checkpointCountAfterTimeout);
      const stateAfterProjectionFailureAfterTimeout =
        await readHostedSystemMailboxState(vaultRoot);
      const timeoutRetryItem = stateAfterProjectionFailureAfterTimeout.pending.find(
        (item) => item.itemId === refreshItem.id,
      );
      assert.ok(timeoutRetryItem);
      assert.equal(timeoutRetryItem.status, "recording");
      assert.equal(timeoutRetryItem.postCheckpointRecord, null);
      assert.equal(timeoutRetryItem.lastErrorCode, null);
      assert.equal(timeoutRetryItem.lastErrorMessage, null);
      assert.equal(timeoutRetryItem.nextAttemptAt, projectionRetryAfterTimeoutAt);
      assert.deepEqual(
        stateAfterProjectionFailureAfterTimeout.pending.find(
          (item) => item.itemId === successorItem.id,
        ),
        retainedSuccessor,
      );
      await persistHarnessVaultState("projection-before-timeout-retry");

      projectionShouldFail = false;
      vi.setSystemTime(new Date(projectionRetryAfterTimeoutAt));
      const timedOutAgain = await runSystemPass(
        "attempt_synthetic_system_mailbox_browser_vault_timeout_retry",
      );

      assert.equal(refreshCalls, 2);
      assert.equal(projectionReads, 4);
      assert.equal(timedOutAgain.status, "scheduled");
      assert.equal(timedOutAgain.nextWakeAt, successorAt);
      assert.equal(timedOutAgain.nextWakeReason, "mailbox");
      assert.equal(timedOutAgain.immediateRecheckRequested, undefined);
      assert.equal(
        checkpointRequests.length,
        checkpointCountAfterTimeout + 1,
      );
      const checkpointCountAfterSecondTimeout = checkpointRequests.length;
      const secondTimeoutCheckpoint = checkpointRequests.at(-1);
      assert.equal(secondTimeoutCheckpoint?.nextWakeAt, successorAt);
      assert.notEqual(secondTimeoutCheckpoint?.nextWakeAt, thirdRetryAt);
      assert.equal(secondTimeoutCheckpoint?.nextWakeReason, "mailbox");
      assert.equal(
        checkpointRequests.some((request) => request.nextWakeAt === thirdRetryAt),
        false,
      );
      assert.equal(
        secondTimeoutCheckpoint?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "1",
      );
      const stateAfterSecondTimeout = await readHostedSystemMailboxState(vaultRoot);
      assert.equal(stateAfterSecondTimeout.pending.length, 1);
      assert.equal(stateAfterSecondTimeout.pending[0]?.itemId, successorItem.id);
      assert.equal(stateAfterSecondTimeout.pending[0]?.nextAttemptAt, successorAt);
      assert.equal(
        stateAfterSecondTimeout.pending.some((item) => item.itemId === refreshItem.id),
        false,
      );
      assert.equal(
        findNextHostedSystemMailboxQueueItem({
          allowedRouteActions: null,
          now: projectionRetryAfterTimeoutAt,
          state: stateAfterSecondTimeout,
        }),
        null,
      );
      assert.equal(
        findNextHostedSystemMailboxQueueItem({
          allowedRouteActions: null,
          now: successorAt,
          state: stateAfterSecondTimeout,
        })?.itemId,
        successorItem.id,
      );

      const initialTimeoutLog = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_system_mailbox_browser_vault_timeout",
        spy: consoleInfo,
      }).find((entry) =>
        entry.details.runtimePhase === "browser_vault.refresh"
        && entry.details.runtimePhaseStatus === "done"
        && entry.details.browserVaultRefreshStatus === "deferred_timeout"
      );
      assert.ok(initialTimeoutLog);
      expect(Object.fromEntries(
        Object.entries(initialTimeoutLog.details).filter(([key]) =>
          key.startsWith("browserVault")
        ),
      )).toEqual({
        browserVaultRefreshAttempt: "initial",
        browserVaultRefreshConfiguredTimeoutMs: 30_000,
        browserVaultRefreshCurrentStepElapsedMs: 9_000,
        browserVaultRefreshElapsedMs: 30_000,
        browserVaultRefreshStage: "replica_construction",
        browserVaultRefreshStatus: "deferred_timeout",
        browserVaultRefreshStep:
          "replica_construction_experiment_outcome_read",
        browserVaultReplicaSourceFileCount: 2,
        browserVaultReplicaSourceTotalBytes: 1_024,
      });
      const retryTimeoutLog = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_system_mailbox_browser_vault_timeout_retry",
        spy: consoleInfo,
      }).find((entry) =>
        entry.details.runtimePhase === "browser_vault.refresh"
        && entry.details.runtimePhaseStatus === "done"
        && entry.details.browserVaultRefreshStatus === "deferred_timeout"
      );
      assert.ok(retryTimeoutLog);
      expect(Object.fromEntries(
        Object.entries(retryTimeoutLog.details).filter(([key]) =>
          key.startsWith("browserVault")
        ),
      )).toEqual({
        browserVaultRefreshAttempt: "retry",
        browserVaultRefreshConfiguredTimeoutMs: 30_000,
        browserVaultRefreshCurrentStepElapsedMs: 18_000,
        browserVaultRefreshElapsedMs: 30_000,
        browserVaultRefreshStage: "replica_construction",
        browserVaultRefreshStatus: "deferred_timeout",
        browserVaultRefreshStep: "replica_construction_projection",
        browserVaultReplicaSourceFileCount: 2,
        browserVaultReplicaSourceTotalBytes: 1_024,
      });

      vi.setSystemTime(new Date(successorAt));
      const successorProcessed = await runSystemPass(
        "attempt_synthetic_system_mailbox_browser_vault_timeout_successor",
      );

      assert.equal(refreshCalls, 2);
      assert.equal(successorProcessed.status, "idle");
      assert.equal(successorProcessed.nextWakeAt, null);
      assert.equal(successorProcessed.nextWakeReason ?? null, null);
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
      assert.equal(checkpointRequests.length, checkpointCountAfterSecondTimeout + 2);
      const checkpointCountAfterSuccessor = checkpointRequests.length;
      const successorCheckpoint = checkpointRequests.at(-1);
      assert.equal(successorCheckpoint?.nextWakeAt, null);
      assert.equal(successorCheckpoint?.nextWakeReason, null);
      assert.equal(
        successorCheckpoint?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "2",
      );
      const outboxAfterSuccessor = await listAssistantOutboxIntents(vaultRoot);
      assert.equal(
        outboxAfterSuccessor.find((intent) => intent.intentId === successorIntent.intentId)
          ?.status,
        "sent",
      );

      vi.setSystemTime(new Date(thirdRetryAt));
      const afterTerminalization = await runSystemPass(
        "attempt_synthetic_system_mailbox_browser_vault_timeout_after_terminalization",
      );

      assert.equal(refreshCalls, 2);
      assert.equal(afterTerminalization.status, "idle");
      assert.equal(afterTerminalization.nextWakeAt, null);
      assert.equal(afterTerminalization.nextWakeReason ?? null, null);
      assert.equal(checkpointRequests.length, checkpointCountAfterSuccessor);
    } finally {
      if (previousStdIoLogSetting === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
      }
      consoleInfo.mockRestore();
      const restoreRefreshImplementation =
        refreshImplementation
        ?? mocks.actualRefreshHostedBrowserVaultReplicaFromRuntime;
      if (restoreRefreshImplementation) {
        mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(
          restoreRefreshImplementation,
        );
      }
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox mode terminally records an unchanged oversized replica", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:browser-publish-retry",
      id: "mailbox_item_system_mailbox_device_browser_publish_retry",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const refreshImplementation =
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.getMockImplementation();
    let refreshCalls = 0;
    let snapshotIndex = 0;
    mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(async () => {
      refreshCalls += 1;
      return {
        byteLength: 51 * 1024 * 1024,
        content: {
          entities: 1,
          hasPrivateContent: true,
          labResultRows: 0,
          metricGoalProgressRows: 0,
          metricRows: 1,
          metricSelectionRows: 0,
          searchRows: 0,
          sourceHealthRows: 0,
          timelineRows: 0,
          weeklySampleSummaries: 0,
        },
        maxBytes: 50 * 1024 * 1024,
        source: { fileCount: 1, totalBytes: 51 * 1024 * 1024 },
        status: "refresh_failed_too_large",
      };
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: state.pending.map((item) =>
          item.itemId === deviceItem.id
            ? {
                ...item,
                attemptCount: 1,
                lastAttemptAt: "2026-04-25T23:59:00.000Z",
                postCheckpointRecord: null,
                status: "recording" as const,
              }
            : item
        ),
      }));
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-device-browser-publish-retry-before.bundle.json",
        vaultRoot,
      });
      artifactBytesByHash.set(restoredWorkspace.hash, restoredWorkspace.bytes);
      const createRunOptions = (workspace: HostedWorkspaceState) => ({
        async createCheckpointSnapshot() {
          snapshotIndex += 1;
          const snapshot = await createVaultSnapshotBundle({
            key: `users/bundles/member-synthetic/system-mailbox-device-browser-publish-retry-${snapshotIndex}.bundle.json`,
            vaultRoot,
          });
          artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
          return {
            snapshotRef: snapshot.snapshotRef,
          };
        },
        async importItem() {
          throw new Error("Already-imported system mailbox work should not import a new row.");
        },
        platform: createPlatform({
          artifactBytesByHash,
          deviceSyncPort,
          mailboxPort: createMailboxPort({
            events,
            fetchRequests,
            items: [],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace,
          }),
        }),
        async runAssistantPhase() {
          throw new Error("System mailbox device-sync must not enter assistant phase.");
        },
        vaultRoot,
      });

      const firstResult = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_device_browser_publish_retry",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        createRunOptions(createWorkspaceState({
          nextWakeAt: TEST_NOW,
          nextWakeReason: "device-sync.reconcile",
          redactedStatus: {
            hostedMailboxBlockedCount: 0,
            hostedMailboxConversationImportedSeq: "0",
            hostedMailboxFetchedCount: 0,
            hostedMailboxImportedCount: 0,
            hostedMailboxRetryableBlockedCount: 0,
            hostedMailboxSystemHandledThroughSeq: "0",
            hostedMailboxSystemImportedSeq: "1",
          },
          snapshotRef: restoredWorkspace.snapshotRef,
          version: "0",
        })),
      );

      assert.equal(refreshCalls, 1);
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 0);
      assert.equal(deviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.equal(firstResult.status, "idle");
      assert.equal(firstResult.nextWakeAt, null);
      assert.equal(firstResult.nextWakeReason ?? null, null);
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "1",
      );
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, null);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, null);
    } finally {
      const restoreRefreshImplementation =
        refreshImplementation
        ?? mocks.actualRefreshHostedBrowserVaultReplicaFromRuntime;
      if (restoreRefreshImplementation) {
        mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(
          restoreRefreshImplementation,
        );
      }
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    "runtime.maintenance-requested",
    "runtime.browser-vault-refresh-requested",
  ] as const)("system mailbox mode drains model-free %s control work", async (kind) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const maintenanceItem = createMailboxItem({
      dedupeKey: "runtime.maintenance-requested:device-recovery-owner",
      id: "mailbox_item_system_mailbox_operator_maintenance",
      kind,
      lane: "system",
      laneSeq: "1",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedRuntimeControlSystemMailboxItem(maintenanceItem),
        vaultRoot,
        wake: buildHostedExecutionRuntimeControlWake({
          eventId: maintenanceItem.dedupeKey,
          kind,
          occurredAt: maintenanceItem.occurredAt,
          userId: TEST_USER_ID,
        }),
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-operator-maintenance-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_operator_maintenance",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-operator-maintenance.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported operator maintenance must not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox device recovery must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.equal(deviceSyncPort.fetchSnapshotCalls, 0);
      assert.equal(deviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.nextWakeReason ?? null, null);
      assert.equal(result.status, "idle");
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "1",
      );
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("replica publish conflict terminally records the device item without reapplying", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:replica-publish-retry",
      id: "mailbox_item_system_mailbox_device_replica_publish_retry",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const deviceSyncPort = createSnapshotDeviceSyncPort({
      connectionId: "device_sync_connection_replica_publish_retry",
      nextReconcileAt: "2026-04-27T00:05:00.000Z",
    });
    let browserPublishCalls = 0;
    let browserWriteCalls = 0;
    let snapshotOrdinal = 0;
    let currentWorkspace: HostedWorkspaceState | null = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-replica-publish-retry-before.bundle.json",
        vaultRoot,
      });
      artifactBytesByHash.set(restoredWorkspace.hash, restoredWorkspace.bytes);
      currentWorkspace = createWorkspaceState({
        browserVaultReplicaRef: {
          byteLength: 1,
          dataVersion: "browser-vault-stale",
          generatedAt: "2026-04-26T00:00:00.000Z",
          generation: 1,
          keyId: "browser-vault-replica:stale",
          objectKey: "users/browser-vault-replicas/member-synthetic/stale.json",
          replicaSchema: "murph.browser-vault-replica",
          runtimeRootKeyId: "udrk:runtime:synthetic-root",
          schema: "murph.hosted-browser-vault-replica-ref.v1",
          sourceBundleHash: "0".repeat(64),
        },
        snapshotRef: restoredWorkspace.snapshotRef,
        version: "0",
      });
      const workspacePort: HostedRuntimeWorkspacePort = {
        async checkpoint(request) {
          checkpointRequests.push(request);
          assert.ok(currentWorkspace);
          currentWorkspace = createWorkspaceState({
            browserVaultReplicaRef: currentWorkspace.browserVaultReplicaRef ?? null,
            inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
            nextWakeAt: request.nextWakeAt ?? null,
            nextWakeReason: request.nextWakeReason ?? null,
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: request.snapshotRef,
            version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
          });
          return {
            checkpointed: true,
            workspace: currentWorkspace,
          };
        },
        async read() {
          return {
            fetchedAt: TEST_NOW,
            workspace: currentWorkspace,
          };
        },
      };
      const platform = createPlatform({
        artifactBytesByHash,
        browserVaultReplicaPort: {
          async publishRef({ replicaRef }) {
            browserPublishCalls += 1;
            events.push(`browser-vault.publish:${browserPublishCalls}`);
            if (browserPublishCalls === 1) {
              return {
                published: false,
                workspace: currentWorkspace,
              };
            }
            assert.ok(currentWorkspace);
            currentWorkspace = {
              ...currentWorkspace,
              browserVaultReplicaRef: replicaRef,
            };
            return {
              published: true,
              workspace: currentWorkspace,
            };
          },
          async write({ replica }) {
            browserWriteCalls += 1;
            events.push(`browser-vault.write:${browserWriteCalls}`);
            return createBrowserVaultReplicaRef(replica);
          },
        },
        deviceSyncPort,
        mailboxPort: createMailboxPort({ events, items: [] }),
        workspacePort,
      });
      const runSystemPass = async (attemptId: string, workspaceVersion: string) =>
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId,
              processingMode: "system_mailbox",
              workspaceVersion,
            },
            resolvedConfig: createDeviceSyncResolvedConfig(),
          }),
          {
            async createCheckpointSnapshot() {
              snapshotOrdinal += 1;
              const snapshot = await createVaultSnapshotBundle({
                key: `users/bundles/member-synthetic/system-mailbox-replica-publish-retry-${snapshotOrdinal}.bundle.json`,
                vaultRoot,
              });
              artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
              return { snapshotRef: snapshot.snapshotRef };
            },
            async importItem() {
              throw new Error("Already-imported system mailbox work should not import a new row.");
            },
            platform,
            async runAssistantPhase() {
              throw new Error("System mailbox device-sync must not enter assistant phase.");
            },
            vaultRoot,
          },
        );

      const first = await runSystemPass(
        "attempt_synthetic_system_mailbox_replica_publish_retry_first",
        "0",
      );

      assert.equal(deviceSyncPort.applyUpdatesCalls, 1);
      assert.equal(browserPublishCalls, 1);
      assert.equal(browserWriteCalls, 1);
      assert.equal(first.nextWakeAt, "2026-04-27T00:05:00.000Z");
      assert.equal(first.nextWakeReason, "device-sync.reconcile");
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
      assert.ok(currentWorkspace);
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "1",
      );
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox device-sync preserves one canonical schedule event and one durable mailbox item through bounded at-least-once provider replay and quiescence", async () => {
    const warmWorkspaceRoot = await mkdtemp(
      path.join(tmpdir(), "murph-workspace-device-sync-closed-loop-warm-"),
    );
    const coldWorkspaceRoot = await mkdtemp(
      path.join(tmpdir(), "murph-workspace-device-sync-closed-loop-cold-"),
    );
    const warmVaultRoot = path.join(warmWorkspaceRoot, "durable", "vault");
    const coldVaultRoot = path.join(coldWorkspaceRoot, "durable", "vault");
    await Promise.all([
      mkdir(path.join(warmWorkspaceRoot, "durable", "home"), { recursive: true }),
      mkdir(path.join(warmWorkspaceRoot, "scratch"), { recursive: true }),
      mkdir(path.join(coldWorkspaceRoot, "durable", "home"), { recursive: true }),
      mkdir(path.join(coldWorkspaceRoot, "scratch"), { recursive: true }),
    ]);
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const providerRequestClasses: string[] = [];
    const cadencePublications: string[] = [];
    const observedMailboxItemIds = new Set<string>();
    const observedScheduleEventIds = new Set<string>();
    const capturedSnapshotFiles = new Map<
      string,
      ReadonlyMap<string, Uint8Array>
    >();
    const completedSnapshotIds = new Set<string>();
    const restoredSnapshotRefByAttempt = new Map<
      string,
      HostedWorkspaceSnapshotV2Ref
    >();
    const deviceSyncStatePresentWhenSnapshotBuilt = new Map<string, boolean>();
    const deviceSyncStatePresentAtRestoreByAttempt = new Map<string, boolean>();
    const dueAt = TEST_NOW;
    const connectedAt = "2026-04-26T12:00:00.000Z";
    const nextRecoveryBucketAt = "2026-04-27T00:05:00.000Z";
    const connectionId = "device_sync_connection_closed_loop";
    const scheduleEventId =
      `device-sync:scheduled-reconcile:v3:${connectionId}:${connectedAt}:${dueAt}`;
    const mailboxItemId = "mailbox_item_system_mailbox_device_closed_loop";
    const expectedWhoopRequestClasses = [
      "GET /developer/v2/activity/sleep",
      "GET /developer/v2/recovery",
      "GET /developer/v2/cycle",
      "GET /developer/v2/activity/workout",
    ] as const;
    const machineLocalDeviceSyncStateSuffix =
      ".runtime/operations/device-sync/state.sqlite";
    const deviceItem = createMailboxItem({
      createdAt: "2026-04-27T00:00:30.000Z",
      dedupeKey: scheduleEventId,
      id: mailboxItemId,
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
      occurredAt: dueAt,
    });
    let canonicalNextReconcileAt = dueAt;
    let currentWorkspace: HostedWorkspaceState | null = null;
    let checkpointAttempt = 0;
    let snapshotOrdinal = 0;
    let activeAttemptId = "unassigned";
    let failRecordCheckpoint = true;
    let failRetryFenceCheckpoint = false;
    const refreshImplementation =
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.getMockImplementation();

    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      async ackDirtyStateProcessed() {
        throw new Error("Device sync dirty ack should not run in this closed-loop proof.");
      },
      async applyUpdates(request) {
        for (const update of request.updates) {
          const nextReconcileAt = update.localState?.nextReconcileAt;
          if (typeof nextReconcileAt === "string") {
            canonicalNextReconcileAt = nextReconcileAt;
            cadencePublications.push(nextReconcileAt);
            events.push(`cadence.publish:${nextReconcileAt}`);
          }
        }
        return {
          appliedAt: request.occurredAt ?? new Date().toISOString(),
          updates: [],
          userId: TEST_USER_ID,
        };
      },
      async createConnectLink() {
        throw new Error("Device sync connect link should not run in this closed-loop proof.");
      },
      async fetchDirtyStates() {
        return {
          hasMore: false,
          items: [],
          nextWakeAt: null,
          userId: TEST_USER_ID,
        };
      },
      async fetchSnapshot() {
        return {
          connections: [{
            connection: {
              accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
              connectedAt,
              createdAt: connectedAt,
              displayName: "Synthetic WHOOP",
              externalAccountId: "synthetic-whoop-account-closed-loop",
              id: connectionId,
              metadata: {},
              provider: "whoop",
              scopes: [
                "offline",
                "read:cycles",
                "read:recovery",
                "read:sleep",
                "read:workout",
              ],
              status: "active",
              updatedAt: connectedAt,
            },
            credential: {
              kind: "oauth_tokens",
              tokenBundle: {
                accessToken: "synthetic-access-token",
                accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
                keyVersion: "synthetic-key-version",
                refreshToken: "synthetic-refresh-token",
                tokenVersion: 1,
              },
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: canonicalNextReconcileAt,
            },
          }],
          generatedAt: new Date().toISOString(),
          userId: TEST_USER_ID,
        };
      },
    };
    const completeWorkspaceCheckpoint = async (
      request: HostedWorkspaceCheckpointRequest,
    ): Promise<HostedWorkspaceCheckpointResponse> => {
      checkpointAttempt += 1;
      checkpointRequests.push(request);
      events.push(`checkpoint.attempt:${activeAttemptId}:${checkpointAttempt}`);
      if (
        failRetryFenceCheckpoint
        && request.reason === "canonical_runtime_commit"
      ) {
        events.push(`checkpoint.fail:${activeAttemptId}:${checkpointAttempt}`);
        throw new Error("synthetic retry-fence checkpoint transport fault");
      }
      if (
        failRecordCheckpoint
        && activeAttemptId === "attempt_device_sync_closed_loop_initial"
        && request.reason === "idle_shutdown"
      ) {
        events.push(`checkpoint.fail:${activeAttemptId}:${checkpointAttempt}`);
        throw new Error("synthetic checkpoint transport fault");
      }
      const checkpointedAt = new Date().toISOString();
      currentWorkspace = createWorkspaceState({
        checkpointedAt,
        inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
        ...(request.systemMailboxProgressGeneration === undefined
          ? {}
          : {
              nextDefaultProcessingWakeAt:
                request.nextDefaultProcessingWakeAt ?? null,
              nextDefaultProcessingWakeReason:
                request.nextDefaultProcessingWakeReason ?? null,
              systemMailboxProgressGeneration:
                request.systemMailboxProgressGeneration,
            }),
        nextWakeAt: request.nextWakeAt ?? null,
        nextWakeReason: request.nextWakeReason ?? null,
        redactedStatus: request.redactedStatus ?? null,
        snapshotRef: request.snapshotRef,
        updatedAt: checkpointedAt,
        version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
      });
      events.push(`checkpoint.commit:${activeAttemptId}:${currentWorkspace.version}`);
      return {
        checkpointed: true,
        workspace: currentWorkspace,
      };
    };
    const workspacePort: HostedRuntimeWorkspacePort = {
      async checkpoint(request) {
        return await completeWorkspaceCheckpoint(request);
      },
      async read() {
        return {
          fetchedAt: new Date().toISOString(),
          workspace: currentWorkspace,
        };
      },
    };
    const snapshotArchiveBuilder: HostedWorkspaceSnapshotArchiveBuilder = {
      async buildEncryptedSnapshot(input) {
        const snapshotFiles = new Map<string, Uint8Array>();
        for (const entry of input.archiveEntries) {
          if (entry.kind === "file") {
            snapshotFiles.set(
              entry.archivePath,
              new Uint8Array(await readFile(entry.absolutePath)),
            );
          }
        }
        capturedSnapshotFiles.set(input.aad.snapshotId, snapshotFiles);
        deviceSyncStatePresentWhenSnapshotBuilt.set(
          input.aad.snapshotId,
          await access(path.join(
            input.durableRoot,
            "vault",
            machineLocalDeviceSyncStateSuffix,
          )).then(
            () => true,
            () => false,
          ),
        );
        await mkdir(input.outputDir, { recursive: true });
        const temporaryDirectoryPath = await mkdtemp(
          path.join(input.outputDir, "device-sync-closed-loop-snapshot-"),
        );
        const encryptedFilePath = path.join(temporaryDirectoryPath, "snapshot.enc");
        const encryptedBytes = new TextEncoder().encode(
          `synthetic-encrypted-snapshot:${input.aad.snapshotId}`,
        );
        await writeFile(encryptedFilePath, encryptedBytes);
        const manifestBytes = new TextEncoder().encode(JSON.stringify(
          [...snapshotFiles].map(([archivePath, bytes]) => ({
            archivePath,
            byteLength: bytes.byteLength,
          })),
        ));
        return {
          compression: HOSTED_WORKSPACE_SNAPSHOT_COMPRESSION,
          encryptedByteSize: encryptedBytes.byteLength,
          encryptedFilePath,
          encryptedObjectSha256: sha256HostedBundleHex(encryptedBytes),
          fileCount: snapshotFiles.size,
          plaintextArchiveSha256: sha256HostedBundleHex(manifestBytes),
          temporaryDirectoryPath,
          totalPlainBytes: [...snapshotFiles.values()].reduce(
            (total, bytes) => total + bytes.byteLength,
            0,
          ),
        };
      },
    };
    const workspaceSnapshotPort: HostedRuntimeWorkspaceSnapshotPort = {
      async abortSnapshotSession(input) {
        capturedSnapshotFiles.delete(input.snapshotId);
        deviceSyncStatePresentWhenSnapshotBuilt.delete(input.snapshotId);
      },
      async completeSnapshotSession(input) {
        const checkpoint = await completeWorkspaceCheckpoint(input.checkpointRequest);
        completedSnapshotIds.add(input.ref.snapshotId);
        return {
          checkpoint,
          snapshotRef: input.ref,
        };
      },
      async putSnapshotObjectDirect(input) {
        await access(input.sourceFilePath);
        return {
          snapshotDirectR2PresignElapsedMs: 0,
          snapshotDirectR2PutElapsedMs: 0,
        };
      },
      async restoreWorkspaceSnapshot(input) {
        assert.equal(completedSnapshotIds.has(input.ref.snapshotId), true);
        const snapshotFiles = capturedSnapshotFiles.get(input.ref.snapshotId);
        assert.ok(snapshotFiles);
        assert.equal(restoredSnapshotRefByAttempt.has(activeAttemptId), false);
        restoredSnapshotRefByAttempt.set(activeAttemptId, input.ref);
        await rm(input.durableRoot, { force: true, recursive: true });
        await mkdir(input.durableRoot, { mode: 0o700, recursive: true });
        const resolvedDurableRoot = path.resolve(input.durableRoot);
        for (const [archivePath, bytes] of snapshotFiles) {
          const destination = path.resolve(input.durableRoot, archivePath);
          assert.ok(destination.startsWith(`${resolvedDurableRoot}${path.sep}`));
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, bytes);
        }
        const restoredDeviceSyncStatePath = path.join(
          input.durableRoot,
          "vault",
          machineLocalDeviceSyncStateSuffix,
        );
        const deviceSyncStatePresent = await access(restoredDeviceSyncStatePath).then(
          () => true,
          () => false,
        );
        deviceSyncStatePresentAtRestoreByAttempt.set(
          activeAttemptId,
          deviceSyncStatePresent,
        );
      },
      async startSnapshotSession() {
        snapshotOrdinal += 1;
        const snapshotId = `snapshot-device-sync-closed-loop-${snapshotOrdinal}`;
        const objectKey =
          `users/${TEST_USER_ID}/workspace-snapshots/${snapshotId}.snapshot.enc`;
        return {
          encryption: {
            aad: buildHostedWorkspaceSnapshotV2Aad({
              objectKey,
              snapshotId,
              userId: TEST_USER_ID,
            }),
            dataKeyBase64: Buffer.alloc(32).toString("base64"),
            ivBase64: Buffer.alloc(12).toString("base64"),
            rootKeyId: "synthetic-device-sync-closed-loop-root-key",
            scheme: HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
            wrappedDataKey: Buffer.from("synthetic-wrapped-data-key").toString("base64"),
          },
          limits: {
            maxSinglePartEncryptedBytes: 64 * 1024 * 1024,
            warnEncryptedBytes: 64 * 1024 * 1024,
          },
          objectKey,
          snapshotId,
        };
      },
    };
    const platform = createPlatform({
      artifactBytesByHash,
      deviceSyncPort,
      events,
      mailboxPort: createMailboxPort({ events, items: [] }),
      workspacePort,
      workspaceSnapshotPort,
    });
    const createProductionBridge = (input: {
      attemptId: string;
      vaultRoot: string;
    }) => {
      const runtimeJobInput = createWorkspaceRuntimeJobInput({
        request: {
          attemptId: input.attemptId,
          processingMode: "system_mailbox",
          workspace: currentWorkspace,
          workspaceVersion: currentWorkspace?.version ?? "0",
        },
        resolvedConfig: createDeviceSyncResolvedConfig(),
      });
      const runtime = runtimeJobInput.runtime;
      assert.ok(runtime);
      const bridgeOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
        decodeMailboxPayload: {
          async decode() {
            throw new Error(
              "Closed-loop wake is already imported into the durable system lane.",
            );
          },
        },
        platform,
        readCurrentLease: () => ({
          attemptId: runtimeJobInput.request.attemptId,
          leaseGeneration: runtimeJobInput.request.leaseGeneration,
          providerEgressToken: runtimeJobInput.request.providerEgressToken ?? null,
          userId: runtimeJobInput.request.userId,
          workspaceVersion:
            currentWorkspace?.version ?? runtimeJobInput.request.workspaceVersion,
        }),
        request: runtimeJobInput.request,
        runtime,
        snapshotArchiveBuilder,
        snapshotDiagnosticsHashSecret: "f".repeat(64),
        vaultRoot: input.vaultRoot,
        async waitForBackgroundAssistantWork() {},
      });
      return { bridgeOptions, runtimeJobInput };
    };
    const runSystemPass = async (input: {
      attemptId: string;
      vaultRoot: string;
    }) => {
      activeAttemptId = input.attemptId;
      const { bridgeOptions, runtimeJobInput } = createProductionBridge(input);
      return await runHostedWorkspaceRuntimeJobInProcess(runtimeJobInput, {
        ...bridgeOptions,
        async importItem() {
          throw new Error(
            "Closed-loop wake is already imported into the durable system lane.",
          );
        },
        async runAssistantPhase() {
          throw new Error("System mailbox device-sync must not enter assistant phase.");
        },
      });
    };

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal("fetch", vi.fn(async (
      request: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = request instanceof Request ? request.url : String(request);
      const method = (
        init?.method ?? (request instanceof Request ? request.method : "GET")
      ).toUpperCase();
      const requestClass = `${method} ${new URL(url).pathname}`;
      providerRequestClasses.push(requestClass);
      events.push(`provider.request:${requestClass}`);
      const records = requestClass === "GET /developer/v2/activity/sleep"
        ? [{
            end: "2026-04-26T07:30:00.000Z",
            id: "sleep-device-sync-closed-loop",
            nap: false,
            start: "2026-04-26T00:30:00.000Z",
            updated_at: "2026-04-26T08:00:00.000Z",
          }]
        : [];
      return new Response(JSON.stringify({ records }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    }));

    try {
      vi.setSystemTime(new Date("2026-04-27T00:00:30.000Z"));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.prepareHostedCodexRuntimeEnvironment.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      if (mocks.actualRefreshHostedBrowserVaultReplicaFromRuntime) {
        mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(
          mocks.actualRefreshHostedBrowserVaultReplicaFromRuntime,
        );
      }
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: warmVaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedDeviceSyncSystemMailboxItem(deviceItem),
        vaultRoot: warmVaultRoot,
        wake: {
          connectionId,
          eventId: scheduleEventId,
          expectedConnectedAt: connectedAt,
          hint: {
            nextReconcileAt: dueAt,
            occurredAt: dueAt,
          },
          kind: "device-sync.wake",
          occurredAt: dueAt,
          provider: "whoop",
          reason: "reconcile_due",
          userId: TEST_USER_ID,
        },
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(warmVaultRoot, importState);
      currentWorkspace = createWorkspaceState({
        version: "0",
      });
      activeAttemptId = "attempt_device_sync_closed_loop_seed_committed_input";
      const { bridgeOptions: committedInputBridge } = createProductionBridge({
        attemptId: activeAttemptId,
        vaultRoot: warmVaultRoot,
      });
      const committedInputSnapshot = await committedInputBridge.createCheckpointSnapshot({
        expectedWorkspaceVersion: "0",
        reason: "idle_shutdown",
      });
      const committedInputSnapshotRef = committedInputSnapshot.snapshotRef;
      assert.ok(isHostedWorkspaceSnapshotV2Ref(committedInputSnapshotRef));
      assert.ok(currentWorkspace);
      assert.equal(currentWorkspace.version, "1");
      assert.deepEqual(currentWorkspace.snapshotRef, committedInputSnapshotRef);
      assert.equal(
        deviceSyncStatePresentWhenSnapshotBuilt.get(
          committedInputSnapshotRef.snapshotId,
        ),
        false,
      );
      assert.equal(
        [...(capturedSnapshotFiles.get(committedInputSnapshotRef.snapshotId)?.keys()
          ?? [])].some((archivePath) =>
            archivePath.endsWith("/hosted-system-mailbox.json")
          ),
        true,
      );
      checkpointAttempt = 0;
      checkpointRequests.length = 0;
      events.length = 0;
      assert.equal(
        await writeHostedWorkspaceCleanCheckpointMarkerBestEffort({
          vaultRoot: warmVaultRoot,
          workspace: currentWorkspace,
        }),
        true,
      );

      const committedInputState = await readHostedSystemMailboxState(warmVaultRoot);
      assert.equal(committedInputState.pending.length, 1);
      const committedInputItem = committedInputState.pending[0];
      assert.ok(committedInputItem);
      assert.equal(committedInputItem.itemId, mailboxItemId);
      assert.equal(committedInputItem.mailboxDedupeKey, scheduleEventId);
      observedMailboxItemIds.add(committedInputItem.itemId);
      assert.equal(committedInputItem.wake.kind, "device-sync.wake");
      if (committedInputItem.wake.kind !== "device-sync.wake") {
        throw new Error(
          "Expected committed input workspace to contain the device-sync wake.",
        );
      }
      assert.equal(committedInputItem.wake.eventId, scheduleEventId);
      observedScheduleEventIds.add(committedInputItem.wake.eventId);
      const committedInputWorkspace = currentWorkspace;
      assert.ok(committedInputWorkspace);

      failRetryFenceCheckpoint = true;
      const rejectedRetryFenceResult = await runSystemPass({
        attemptId:
          "attempt_device_sync_closed_loop_retry_fence_rejected",
        vaultRoot: warmVaultRoot,
      });
      assert.equal(checkpointAttempt, 2);
      assert.equal(checkpointRequests.length, 2);
      assert.deepEqual(
        checkpointRequests.map((request) => request.reason),
        ["canonical_runtime_commit", "idle_shutdown"],
      );
      assert.equal(providerRequestClasses.length, 0);
      assert.equal(cadencePublications.length, 0);
      assert.equal(
        events.filter((event) => event.startsWith("provider.request:")).length,
        0,
      );
      assert.equal(
        events.filter((event) => event.startsWith("artifact.put:")).length,
        0,
      );
      assert.ok(currentWorkspace);
      assert.equal(currentWorkspace.version, "2");
      assert.equal(currentWorkspace.nextWakeReason, "device-sync.reconcile");
      assert.ok(currentWorkspace.nextWakeAt);
      assert.equal(
        currentWorkspace.redactedStatus
          ?.hostedMailboxSystemHandledThroughSeq
          ?? "0",
        "0",
      );
      assert.equal(rejectedRetryFenceResult.status, "scheduled");
      assert.equal(
        rejectedRetryFenceResult.nextWakeReason,
        "device-sync.reconcile",
      );
      assert.ok(rejectedRetryFenceResult.nextWakeAt);
      currentWorkspace = committedInputWorkspace;
      failRetryFenceCheckpoint = false;
      checkpointAttempt = 0;
      checkpointRequests.length = 0;
      events.length = 0;

      await assert.rejects(
        runSystemPass({
          attemptId: "attempt_device_sync_closed_loop_initial",
          vaultRoot: warmVaultRoot,
        }),
        /synthetic checkpoint transport fault/u,
      );

      assert.equal(checkpointAttempt, 3);
      assert.equal(checkpointRequests.length, 3);
      assert.deepEqual(
        checkpointRequests.map((request) => request.reason),
        [
          "canonical_runtime_commit",
          "canonical_runtime_commit",
          "idle_shutdown",
        ],
      );
      assert.deepEqual(
        checkpointRequests.map((request) => request.expectedWorkspaceVersion),
        ["1", "2", "3"],
      );
      assert.deepEqual(
        checkpointRequests.map((request) =>
          request.systemMailboxProgressGeneration
        ),
        ["0", "1", "1"],
      );
      assert.ok(currentWorkspace);
      assert.equal(currentWorkspace.version, "3");
      assert.equal(currentWorkspace.systemMailboxProgressGeneration, "1");
      const initialProviderRequestClasses = providerRequestClasses.slice();
      assert.deepEqual(initialProviderRequestClasses, expectedWhoopRequestClasses);
      assert.deepEqual(cadencePublications, []);
      assert.equal(canonicalNextReconcileAt, dueAt);
      const firstCheckpointAttemptIndex = events.indexOf(
        "checkpoint.attempt:attempt_device_sync_closed_loop_initial:1",
      );
      const lostRecordCheckpointIndex = events.indexOf(
        "checkpoint.fail:attempt_device_sync_closed_loop_initial:3",
      );
      assert.notEqual(firstCheckpointAttemptIndex, -1);
      assert.notEqual(lostRecordCheckpointIndex, -1);
      assert.ok(firstCheckpointAttemptIndex < lostRecordCheckpointIndex);
      assert.equal(
        events.slice(0, firstCheckpointAttemptIndex).filter((event) =>
          event.startsWith("provider.request:")
        ).length,
        0,
      );
      assert.equal(
        events.slice(0, firstCheckpointAttemptIndex).filter((event) =>
          event.startsWith("artifact.put:")
        ).length,
        0,
      );
      assert.equal(
        events.indexOf("checkpoint.commit:attempt_device_sync_closed_loop_initial:4"),
        -1,
      );
      const durablePostPullCheckpoint = checkpointRequests[1];
      assert.ok(durablePostPullCheckpoint);
      assert.deepEqual(currentWorkspace.snapshotRef, durablePostPullCheckpoint.snapshotRef);
      assert.deepEqual(currentWorkspace.snapshotRef, committedInputSnapshotRef);
      const failedPostPullCheckpoint = checkpointRequests[2];
      assert.ok(failedPostPullCheckpoint);
      const failedPostPullSnapshotRef = failedPostPullCheckpoint.snapshotRef;
      assert.ok(isHostedWorkspaceSnapshotV2Ref(failedPostPullSnapshotRef));
      assert.equal(
        completedSnapshotIds.has(failedPostPullSnapshotRef.snapshotId),
        false,
      );
      assert.equal(
        deviceSyncStatePresentWhenSnapshotBuilt.get(
          failedPostPullSnapshotRef.snapshotId,
        ),
        true,
      );
      const durablePostPullArchivePaths = [
        ...(capturedSnapshotFiles.get(failedPostPullSnapshotRef.snapshotId)?.keys()
          ?? []),
      ];
      assert.equal(
        durablePostPullArchivePaths.some((archivePath) =>
          archivePath.endsWith(machineLocalDeviceSyncStateSuffix)
        ),
        false,
      );
      assert.equal(
        durablePostPullArchivePaths.some((archivePath) =>
          archivePath.endsWith("/hosted-system-mailbox.json")
        ),
        true,
      );

      await removeTempRoot(warmWorkspaceRoot);
      vi.setSystemTime(new Date(nextRecoveryBucketAt));
      failRecordCheckpoint = false;
      const recoveryAttemptId =
        "attempt_device_sync_closed_loop_next_bucket_signal";
      const recovered = await runSystemPass({
        attemptId: recoveryAttemptId,
        vaultRoot: coldVaultRoot,
      });

      assert.deepEqual(
        restoredSnapshotRefByAttempt.get(recoveryAttemptId),
        committedInputSnapshotRef,
      );
      assert.equal(
        deviceSyncStatePresentAtRestoreByAttempt.get(recoveryAttemptId),
        false,
      );
      assert.equal(providerRequestClasses.length, 8);
      const replayedProviderRequestClasses = providerRequestClasses.slice(4);
      assert.deepEqual(
        [...replayedProviderRequestClasses].sort(),
        [...initialProviderRequestClasses].sort(),
      );
      assert.deepEqual(cadencePublications, []);
      assert.equal(canonicalNextReconcileAt, dueAt);
      assert.equal(recovered.nextWakeReason, "device-sync.reconcile");
      assert.ok(currentWorkspace);
      assert.equal(currentWorkspace.version, "6");
      assert.equal(currentWorkspace.systemMailboxProgressGeneration, "1");
      assert.equal(checkpointAttempt, 6);
      assert.equal(checkpointRequests.length, 6);
      assert.deepEqual(
        checkpointRequests.slice(3, 6).map((request) =>
          request.expectedWorkspaceVersion
        ),
        ["3", "4", "5"],
      );
      const recoveryCheckpointCommitIndexes = events.flatMap((event, index) =>
        event.startsWith(`checkpoint.commit:${recoveryAttemptId}:`) ? [index] : []
      );
      assert.equal(recoveryCheckpointCommitIndexes.length, 3);
      const durableRecoveryCompletionCheckpointIndex =
        recoveryCheckpointCommitIndexes[recoveryCheckpointCommitIndexes.length - 1];
      assert.notEqual(durableRecoveryCompletionCheckpointIndex, undefined);
      const retainedCompletionFence = await readHostedSystemMailboxState(coldVaultRoot);
      assert.equal(retainedCompletionFence.pending.length, 1);
      const retainedItem = retainedCompletionFence.pending[0];
      assert.ok(retainedItem);
      assert.equal(retainedItem.itemId, mailboxItemId);
      assert.equal(retainedItem.mailboxDedupeKey, scheduleEventId);
      observedMailboxItemIds.add(retainedItem.itemId);
      assert.equal(retainedItem.status, "pending");
      assert.equal(retainedItem.wake.kind, "device-sync.wake");
      if (retainedItem.wake.kind !== "device-sync.wake") {
        throw new Error("Expected retained completion-fence wake after cold restore.");
      }
      assert.equal(retainedItem.wake.eventId, scheduleEventId);
      observedScheduleEventIds.add(retainedItem.wake.eventId);
      assert.equal(retainedItem.wake.hint?.reason, "retained_completion_fence");
      assert.deepEqual(retainedItem.wake.hint?.jobs, []);
      assert.equal(
        retainedItem.wake.hint?.nextReconcileAt,
        "2026-04-27T06:05:00.000Z",
      );
      const completionFenceAt = retainedItem.nextAttemptAt;
      assert.equal(completionFenceAt, "2026-04-27T00:05:30.000Z");

      vi.setSystemTime(new Date(completionFenceAt));
      const providerRequestsBeforeCompletion = providerRequestClasses.length;
      const settled = await runSystemPass({
        attemptId: "attempt_device_sync_closed_loop_completion_fence",
        vaultRoot: coldVaultRoot,
      });

      assert.equal(providerRequestClasses.length, providerRequestsBeforeCompletion);
      assert.equal(providerRequestClasses.length, 8);
      assert.deepEqual(cadencePublications, ["2026-04-27T06:05:00.000Z"]);
      assert.equal(canonicalNextReconcileAt, "2026-04-27T06:05:00.000Z");
      const cadenceEventIndex = events.indexOf(
        "cadence.publish:2026-04-27T06:05:00.000Z",
      );
      assert.notEqual(cadenceEventIndex, -1);
      assert.ok(
        durableRecoveryCompletionCheckpointIndex !== undefined
        && durableRecoveryCompletionCheckpointIndex < cadenceEventIndex,
      );
      assert.deepEqual((await readHostedSystemMailboxState(coldVaultRoot)).pending, []);
      assert.equal(settled.status, "scheduled");
      assert.equal(settled.nextWakeAt, "2026-04-27T06:05:00.000Z");
      assert.equal(settled.nextWakeReason, "device-sync.reconcile");
      assert.deepEqual(
        checkpointRequests.slice(6, 9).map((request) =>
          request.expectedWorkspaceVersion
        ),
        ["6", "7", "8"],
      );
      assert.ok(currentWorkspace);
      assert.equal(currentWorkspace.version, "9");

      const checkpointAttemptsAfterSettlement = checkpointAttempt;
      assert.equal(checkpointAttemptsAfterSettlement, 9);
      assert.equal(checkpointRequests.length, 9);
      assert.equal(
        events.filter((event) => event.startsWith("checkpoint.fail:")).length,
        1,
      );
      const providerRequestClassesAfterSettlement = providerRequestClasses.length;
      assert.equal(providerRequestClassesAfterSettlement, 8);
      const convergenceBucketAt = "2026-04-27T00:10:00.000Z";
      const convergenceAttemptId =
        `attempt_device_sync_closed_loop_quiescent_${convergenceBucketAt}`;
      vi.setSystemTime(new Date(convergenceBucketAt));
      const providerRequestsBeforeConvergence = providerRequestClasses.length;
      const checkpointAttemptsBeforeConvergence = checkpointAttempt;
      const converged = await runSystemPass({
        attemptId: convergenceAttemptId,
        vaultRoot: coldVaultRoot,
      });
      assert.equal(converged.status, "idle");
      assert.equal(converged.nextWakeAt, null);
      assert.equal(converged.nextWakeReason, undefined);
      assert.equal(providerRequestClasses.length, providerRequestsBeforeConvergence);
      assert.equal(checkpointAttempt, checkpointAttemptsBeforeConvergence + 1);
      assert.equal(checkpointRequests.at(-1)?.expectedWorkspaceVersion, "9");
      assert.ok(currentWorkspace);
      assert.equal(currentWorkspace.version, "10");

      const quiescentBucketAt = "2026-04-27T00:15:00.000Z";
      const quiescentAttemptId =
        `attempt_device_sync_closed_loop_quiescent_${quiescentBucketAt}`;
      vi.setSystemTime(new Date(quiescentBucketAt));
      const providerRequestsBeforeQuiescence = providerRequestClasses.length;
      const checkpointAttemptsBeforeQuiescence = checkpointAttempt;
      const quiescent = await runSystemPass({
        attemptId: quiescentAttemptId,
        vaultRoot: coldVaultRoot,
      });
      assert.equal(quiescent.status, "idle");
      assert.equal(quiescent.nextWakeAt, null);
      assert.equal(quiescent.nextWakeReason, undefined);
      assert.equal(providerRequestClasses.length, providerRequestsBeforeQuiescence);
      assert.equal(checkpointAttempt, checkpointAttemptsBeforeQuiescence);
      assert.ok(currentWorkspace);
      assert.equal(currentWorkspace.version, "10");
      assert.equal(
        providerRequestClasses.length,
        providerRequestClassesAfterSettlement,
      );
      assert.equal(checkpointAttempt, checkpointAttemptsAfterSettlement + 1);
      assert.equal(checkpointAttempt, 10);
      assert.equal(checkpointAttempt, checkpointRequests.length);
      assert.equal(
        events.filter((event) => event.startsWith("checkpoint.commit:")).length,
        9,
      );
      assert.deepEqual([...observedScheduleEventIds], [scheduleEventId]);
      assert.deepEqual([...observedMailboxItemIds], [mailboxItemId]);
      assert.equal(
        checkpointRequests.some((request) =>
          request.nextWakeReason === "device-sync.reconcile"
        ),
        true,
      );
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(mocks.prepareHostedCodexRuntimeEnvironment.mock.calls.length, 0);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      const restoreRefreshImplementation =
        refreshImplementation
        ?? mocks.actualRefreshHostedBrowserVaultReplicaFromRuntime;
      if (restoreRefreshImplementation) {
        mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(
          restoreRefreshImplementation,
        );
      }
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      await removeTempRoot(warmWorkspaceRoot);
      await removeTempRoot(coldWorkspaceRoot);
    }
  });

  test("keeps restored replyable input ahead of a consented ask and device maintenance", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const vaultRoot = path.join(workspaceRoot, "durable", "vault");
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const pendingInputItem = createMailboxItem({
      id: "mailbox_item_restored_reply_before_ask",
      lane: "conversation",
      laneSeq: "1",
      occurredAt: "2026-04-27T00:00:01.000Z",
    });
    const firstAsk = createMailboxItem({
      dedupeKey: "assistant.ask.requested:restored-reply-first",
      expiresAt: "2026-04-27T00:10:00.000Z",
      id: "mailbox_item_restored_reply_ask",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "1",
    });
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:restored-reply-device",
      id: "mailbox_item_restored_reply_device",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "2",
    });
    let assistantAskPrepareCalls = 0;
    const originalAutomationPass =
      mocks.runAssistantAutomationPass.getMockImplementation();
    const assistantInputServiced = createDeferred<void>();
    const assistantRuntimeAbortController = new AbortController();
    let assistantRuntimePromise:
      | ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess>
      | null = null;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      assert.ok(originalAutomationPass);
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await Promise.all([
        mkdir(resolveAssistantStatePaths(vaultRoot).assistantStateRoot, {
          recursive: true,
        }),
        mkdir(path.join(workspaceRoot, "durable", "home"), { recursive: true }),
      ]);
      const pendingAssistantInputId = await stagePendingLinqAssistantInputForMailboxItem({
        item: pendingInputItem,
        vaultRoot,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedAssistantAskSystemMailboxItem(firstAsk),
        vaultRoot,
        wake: createConsentedMemberAssistantAskRequestedWake({
          eventId: firstAsk.dedupeKey,
        }),
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "2";
      await writeMailboxImportStateFile(vaultRoot, importState);

      const restoredWorkspaceState = createWorkspaceState({
        nextWakeAt: TEST_NOW,
        nextWakeReason: "assistant",
        snapshotRef: createWorkspaceSnapshotV2Ref(
          "snapshot_synthetic_restored_reply_handoff",
        ),
        version: "0",
      });
      assert.equal(
        await writeHostedWorkspaceCleanCheckpointMarkerBestEffort({
          vaultRoot,
          workspace: restoredWorkspaceState,
        }),
        true,
      );

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_restored_reply_before_ask",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("An unchanged restored-input handoff must not checkpoint.");
          },
          async importItem() {
            throw new Error("Restored reply ordering work was already imported.");
          },
          platform: createPlatform({
            assistantAskPort: {
              async request(request) {
                if (request.action === "complete") {
                  throw new Error("Terminal restored-reply ask must not complete again.");
                }
                assistantAskPrepareCalls += 1;
                return {
                  action: "prepare",
                  status: "terminal",
                  terminalReason: "unavailable",
                };
              },
            },
            deviceSyncPort,
            events,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: restoredWorkspaceState,
            }),
            workspaceSnapshotPort: {
              async abortSnapshotSession() {
                throw new Error("Warm restored-input handoff must not abort snapshots.");
              },
              async completeSnapshotSession() {
                throw new Error("Warm restored-input handoff must not complete snapshots.");
              },
              async putSnapshotObjectDirect() {
                throw new Error("Warm restored-input handoff must not upload snapshots.");
              },
              async restoreWorkspaceSnapshot() {
                throw new Error("Warm restored-input handoff must reuse the clean workspace.");
              },
              async startSnapshotSession() {
                throw new Error("Warm restored-input handoff must not start snapshots.");
              },
            },
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox mode must hand the restored reply to an assistant wake.");
          },
          vaultRoot,
        },
      );

      assert.equal(assistantAskPrepareCalls, 0);
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 0);
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(result.nextWakeAt, TEST_NOW);
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(checkpointRequests.length, 0);
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => [
          item.itemId,
          item.status,
        ]),
        [
          [firstAsk.id, "pending"],
          [deviceItem.id, "pending"],
        ],
      );

      const assistantWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/restored-reply-assistant-handoff.bundle.json",
        vaultRoot,
      });
      let assistantPhaseInputIds: readonly string[] = [];
      mocks.runAssistantAutomationPass.mockImplementation(
        async (automationInput: RunAssistantAutomationPassInput) => {
          const candidates = await automationInput.inputSource?.listInputCandidates({
            afterCursor: null,
            limit: 10,
            sourceId: "linq",
          });
          const inputIds = candidates?.inputs.map((candidate) =>
            candidate.event.inputId
          ) ?? [];
          if (inputIds.length === 0) {
            return {
              currentTurnDeliveryIntentIds: [],
              nextWakeAt: null,
              progressed: false,
            };
          }

          assistantPhaseInputIds = inputIds;
          await writeSyntheticAssistantAutoReplyTerminalEvidence({
            inputId: pendingAssistantInputId,
            vaultRoot,
          });
          assistantInputServiced.resolve();
          return {
            currentTurnDeliveryIntentIds: [],
            nextWakeAt: null,
            progressed: true,
          };
        },
      );
      assistantRuntimePromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_restored_reply_assistant_handoff",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/restored-reply-assistant-handoff-after.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Assistant handoff input was already imported.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[assistantWorkspace.hash, assistantWorkspace.bytes]]),
            assistantAskPort: {
              async request(request) {
                if (request.action === "complete") {
                  throw new Error("Terminal restored-reply ask must not complete again.");
                }
                assistantAskPrepareCalls += 1;
                return {
                  action: "prepare",
                  status: "terminal",
                  terminalReason: "unavailable",
                };
              },
            },
            deviceSyncPort,
            events,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: result.nextWakeAt,
                nextWakeReason: result.nextWakeReason,
                snapshotRef: assistantWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          signal: assistantRuntimeAbortController.signal,
          vaultRoot,
        },
      );
      await withRealTimeout(
        assistantInputServiced.promise,
        30_000,
        () => events.join(","),
      );
      assert.deepEqual(assistantPhaseInputIds, [pendingAssistantInputId]);
      assistantRuntimeAbortController.abort(
        new DOMException("Synthetic assistant handoff proof complete.", "AbortError"),
      );
      await assistantRuntimePromise.catch(() => undefined);
    } finally {
      assistantRuntimeAbortController.abort(
        new DOMException("Synthetic test cleanup.", "AbortError"),
      );
      await assistantRuntimePromise?.catch(() => undefined);
      if (originalAutomationPass) {
        mocks.runAssistantAutomationPass.mockImplementation(
          originalAutomationPass,
        );
      }
      vi.useRealTimers();
      await removeTempRoot(workspaceRoot);
    }
  });

  test("keeps a restored reply immediate across a same-key checkpoint handoff", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const pendingInputItem = createMailboxItem({
      id: "mailbox_item_same_key_reply",
      lane: "conversation",
      laneSeq: "1",
      occurredAt: "2026-04-27T00:00:01.000Z",
    });
    const firstAsk = createMailboxItem({
      dedupeKey: "assistant.ask.requested:same-key-reply",
      expiresAt: "2026-04-27T00:10:00.000Z",
      id: "mailbox_item_same_key_reply_ask",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "1",
    });
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:same-key-reply-device",
      id: "mailbox_item_same_key_reply_device",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "2",
    });
    const importedTail = createMailboxItem({
      dedupeKey: "device-sync.wake:same-key-reply-tail",
      id: "mailbox_item_same_key_reply_tail",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "3",
    });
    let assistantAskPrepareCalls = 0;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await stagePendingLinqAssistantInputForMailboxItem({
        item: pendingInputItem,
        vaultRoot,
      });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedAssistantAskSystemMailboxItem(firstAsk),
        vaultRoot,
        wake: createConsentedMemberAssistantAskRequestedWake({
          eventId: firstAsk.dedupeKey,
        }),
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "2";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/same-key-reply-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_same_key_reply_handoff",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/same-key-reply-after.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            assert.equal(item.item.id, importedTail.id);
            await enqueueHostedSystemMailboxItem({
              item: createResolvedDeviceSyncSystemMailboxItem(item.item),
              vaultRoot,
              wake: createDeviceSyncSystemWakeForMailboxItem(item.item),
            });
            return {
              reasonCode: "device_sync.queued",
              status: "imported",
            };
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            assistantAskPort: {
              async request() {
                assistantAskPrepareCalls += 1;
                throw new Error("A same-key restored reply must hand off before Ask preparation.");
              },
            },
            deviceSyncPort,
            events,
            mailboxPort: createMailboxPort({ events, items: [importedTail] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: TEST_NOW,
                nextWakeReason: "assistant",
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox mode must hand the restored reply to an assistant wake.");
          },
          vaultRoot,
        },
      );

      assert.equal(assistantAskPrepareCalls, 0);
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 0);
      assert.equal(result.nextWakeAt, TEST_NOW);
      assert.equal(result.nextWakeReason, "assistant");
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, TEST_NOW);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) =>
          item.itemId
        ),
        [firstAsk.id, deviceItem.id, importedTail.id],
      );
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    { approvedAskCount: 1, ownerKind: "member ask" },
    { approvedAskCount: 2, ownerKind: "member ask" },
    { approvedAskCount: 0, ownerKind: "operator diagnostic" },
  ])("keeps the exact $ownerKind durable-head ask ahead of $approvedAskCount pre-barrier approved follow-up(s) and device work", async ({
    approvedAskCount,
    ownerKind,
  }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const preAssistantSystemFetchStarted = createDeferred<void>();
    const preAssistantSystemFetchRelease = createDeferred<void>();
    const runtimeAbortController = new AbortController();
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const originalFetchSnapshot = deviceSyncPort.fetchSnapshot.bind(deviceSyncPort);
    deviceSyncPort.fetchSnapshot = async (input) => {
      events.push("device.snapshot");
      return await originalFetchSnapshot(input);
    };
    const firstAsk = createMailboxItem({
      dedupeKey: "assistant.ask.requested:pre-barrier-first",
      expiresAt: "2026-04-27T00:10:00.000Z",
      id: "mailbox_item_pre_barrier_first_ask",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "1",
    });
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:pre-barrier-device",
      id: "mailbox_item_pre_barrier_device",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "2",
    });
    const approvedAsks = Array.from({ length: approvedAskCount }, (_, index) =>
      createMailboxItem({
        dedupeKey: `assistant.ask.requested:pre-barrier-approved-${index + 1}`,
        expiresAt: "2026-04-27T00:10:00.000Z",
        id: `mailbox_item_pre_barrier_approved_ask_${index + 1}`,
        kind: "assistant.ask.requested",
        lane: "system",
        laneSeq: String(index + 3),
      })
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedAssistantAskSystemMailboxItem(firstAsk),
        vaultRoot,
        wake: ownerKind === "operator diagnostic"
          ? createOperatorTaskAssistantAskRequestedWake({
              eventId: firstAsk.dedupeKey,
            })
          : createConsentedMemberAssistantAskRequestedWake({
              eventId: firstAsk.dedupeKey,
            }),
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "2";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/pre-barrier-approved-before.bundle.json",
        vaultRoot,
      });
      const mailboxPort = createMailboxPort({ events, items: approvedAsks });
      const fetchMailbox = mailboxPort.fetch.bind(mailboxPort);
      mailboxPort.fetch = async (request) => {
        if (
          request.lanes.length === 1
          && request.lanes[0]?.lane === "system"
          && request.requestId.includes(":pre-assistant-system:")
        ) {
          events.push("pre-assistant-system-fetch.started");
          preAssistantSystemFetchStarted.resolve();
          await preAssistantSystemFetchRelease.promise;
        }
        return await fetchMailbox(request);
      };

      const runtimePromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_pre_barrier_approved_asks",
            idleCheckpointDelayMs: 1,
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/pre-barrier-approved-after.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            assert.ok(approvedAsks.some((ask) => ask.id === item.item.id));
            events.push(`ask.imported:${item.item.id}`);
            return await enqueueHostedSystemMailboxItem({
              item,
              vaultRoot,
              wake: createAssistantAskRequestedWake({
                eventId: item.item.dedupeKey,
              }),
            });
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            assistantAskPort: {
              async request(request) {
                if (request.action === "complete") {
                  throw new Error("Terminal startup-order asks must not complete again.");
                }
                events.push(`ask.prepare:${request.requestId}`);
                return {
                  action: "prepare",
                  status: "terminal",
                  terminalReason: "unavailable",
                };
              },
            },
            deviceSyncPort,
            events,
            mailboxPort,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );
      void runtimePromise.catch(() => undefined);

      await withRealTimeout(
        preAssistantSystemFetchStarted.promise,
        10_000,
        () => events.join(","),
      );
      assert.deepEqual(
        events.filter((event) => event.startsWith("ask.prepare:")),
        [],
      );
      preAssistantSystemFetchRelease.resolve();
      await withRealTimeout(
        (async () => {
          while (
            !events.includes(`ask.prepare:${firstAsk.dedupeKey}`)
            || (await readHostedSystemMailboxState(vaultRoot)).pending.some(
              (item) => item.itemId === firstAsk.id,
            )
          ) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        })(),
        15_000,
        () => events.join(","),
      );

      const preparedRequestIds = events
        .filter((event) => event.startsWith("ask.prepare:"))
        .map((event) => event.slice("ask.prepare:".length));
      assert.equal(preparedRequestIds[0], firstAsk.dedupeKey);
      const firstAskIndex = events.indexOf(`ask.prepare:${firstAsk.dedupeKey}`);
      for (const approvedAsk of approvedAsks) {
        const approvedAskIndex = events.indexOf(`ask.prepare:${approvedAsk.dedupeKey}`);
        if (approvedAskIndex >= 0) {
          assert.ok(firstAskIndex < approvedAskIndex);
        }
      }
      const deviceIndex = events.indexOf("device.snapshot");
      if (deviceIndex >= 0) {
        assert.ok(firstAskIndex < deviceIndex);
      }
      runtimeAbortController.abort(
        new DOMException("Synthetic startup-order proof complete.", "AbortError"),
      );
      await runtimePromise.catch(() => undefined);
    } finally {
      runtimeAbortController.abort(
        new DOMException("Synthetic test cleanup.", "AbortError"),
      );
      preAssistantSystemFetchRelease.resolve();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  }, 90_000);

  test.each([
    { approved: false, laterKind: "ordinary", ownerKind: "member ask" },
    { approved: true, laterKind: "approved", ownerKind: "member ask" },
    {
      approved: false,
      laterKind: "ordinary",
      ownerKind: "operator diagnostic",
    },
  ])("retires an unstarted exact $ownerKind across a foreground causal rerun with a $laterKind later ask", async ({
    approved,
    ownerKind,
  }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const remoteItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const preAssistantSystemFetchStarted = createDeferred<void>();
    const preAssistantSystemFetchRelease = createDeferred<void>();
    const assistantAskPrepareStarted = createDeferred<void>();
    const firstAssistantPhaseStarted = createDeferred<void>();
    const firstAssistantPhaseRelease = createDeferred<void>();
    const secondAssistantPhaseStarted = createDeferred<void>();
    const secondAssistantPhaseRelease = createDeferred<void>();
    const conversationImported = createDeferred<void>();
    const runtimeAbortController = new AbortController();
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const firstAsk = createMailboxItem({
      dedupeKey: "assistant.ask.requested:pre-watcher-foreground",
      expiresAt: "2026-04-27T00:10:00.000Z",
      id: "mailbox_item_pre_watcher_ask",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "1",
    });
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:pre-watcher-foreground",
      id: "mailbox_item_pre_watcher_device",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "2",
    });
    const lateAsk = createMailboxItem({
      dedupeKey: "assistant.ask.requested:pre-watcher-late",
      expiresAt: "2026-04-27T00:10:00.000Z",
      id: "mailbox_item_pre_watcher_late_ask",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "3",
    });
    const conversationItem = createMailboxItem({
      id: "mailbox_item_pre_watcher_conversation",
      lane: "conversation",
      laneSeq: "1",
      occurredAt: "2026-04-27T00:00:01.000Z",
    });
    const followUpConversationItem = createMailboxItem({
      id: "mailbox_item_pre_watcher_conversation_follow_up",
      lane: "conversation",
      laneSeq: "2",
      occurredAt: "2026-04-27T00:00:02.000Z",
    });
    let assistantAskPrepareCalls = 0;
    const importedAssistantInputIds = new Map<string, string>();
    const assistantPhaseInputIds: (readonly string[])[] = [];
    let heldPreAssistantSystemFetch = false;
    let runtimePromise:
      | ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess>
      | null = null;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedAssistantAskSystemMailboxItem(firstAsk),
        vaultRoot,
        wake: ownerKind === "operator diagnostic"
          ? createOperatorTaskAssistantAskRequestedWake({
              eventId: firstAsk.dedupeKey,
            })
          : createConsentedMemberAssistantAskRequestedWake({
              eventId: firstAsk.dedupeKey,
            }),
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "2";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/pre-watcher-foreground-before.bundle.json",
        vaultRoot,
      });
      const mailboxPort = createMailboxPort({
        events,
        items: remoteItems,
      });
      const fetchMailbox = mailboxPort.fetch.bind(mailboxPort);
      mailboxPort.fetch = async (request) => {
        events.push(`mailbox.request:${request.requestId}`);
        if (
          !heldPreAssistantSystemFetch
          && request.lanes.length === 1
          && request.lanes[0]?.lane === "system"
          && request.requestId.includes(":pre-assistant-system:")
        ) {
          heldPreAssistantSystemFetch = true;
          events.push("pre-assistant-system-fetch.started");
          preAssistantSystemFetchStarted.resolve();
          await preAssistantSystemFetchRelease.promise;
          events.push("pre-assistant-system-fetch.released");
        }
        return await fetchMailbox(request);
      };

      runtimePromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_pre_watcher_foreground",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/pre-watcher-foreground-after.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            if (item.item.id === lateAsk.id) {
              events.push("ask.late.imported");
              return await enqueueHostedSystemMailboxItem({
                item,
                vaultRoot,
                wake: approved
                  ? createAssistantAskRequestedWake({ eventId: lateAsk.dedupeKey })
                  : createConsentedMemberAssistantAskRequestedWake({
                      eventId: lateAsk.dedupeKey,
                    }),
              });
            }
            assert.ok(
              item.item.id === conversationItem.id
              || item.item.id === followUpConversationItem.id,
            );
            context?.onConversationInputStaged?.("linq");
            const importedAssistantInputId = await stageAssistantInputEventForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            importedAssistantInputIds.set(item.item.id, importedAssistantInputId);
            if (item.item.id === conversationItem.id) {
              conversationImported.resolve();
            }
            events.push(`conversation.imported:${item.item.laneSeq}`);
            return {
              assistantInputId: importedAssistantInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            assistantAskPort: {
              async request(request) {
                if (request.action === "complete") {
                  throw new Error("A preempted startup-window ask must not complete.");
                }
                assert.equal(approved, true);
                assert.equal(request.requestId, lateAsk.dedupeKey);
                assistantAskPrepareCalls += 1;
                events.push("ask.prepare");
                assistantAskPrepareStarted.resolve();
                return {
                  action: "prepare",
                  status: "terminal",
                  terminalReason: "unavailable",
                };
              },
            },
            deviceSyncPort,
            events,
            mailboxPort,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            assistantPhaseInputIds.push(
              input.latestAssistantInputBatch?.()?.assistantInputIds ?? [],
            );
            const assistantPhaseOrdinal = assistantPhaseInputIds.length;
            events.push(`assistant.phase:${assistantPhaseOrdinal}`);
            if (assistantPhaseOrdinal === 1) {
              firstAssistantPhaseStarted.resolve();
              await firstAssistantPhaseRelease.promise;
            } else if (assistantPhaseOrdinal === 2) {
              secondAssistantPhaseStarted.resolve();
              await secondAssistantPhaseRelease.promise;
            }
            return { progressed: false };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        preAssistantSystemFetchStarted.promise,
        30_000,
        () => events.join(","),
      );
      const preWatcherAskOwner = await Promise.race([
        assistantAskPrepareStarted.promise.then(() => "ask" as const),
        new Promise<"blocked">((resolve) => {
          setTimeout(() => resolve("blocked"), 1_000);
        }),
      ]);
      assert.equal(preWatcherAskOwner, "blocked");
      assert.equal(assistantAskPrepareCalls, 0);

      remoteItems.push(conversationItem, lateAsk);
      runtimeWakeSignal.notify();
      preAssistantSystemFetchRelease.resolve();
      await withRealTimeout(
        firstAssistantPhaseStarted.promise,
        30_000,
        () => events.join(","),
      );
      if (approved) {
        await withRealTimeout(
          assistantAskPrepareStarted.promise,
          30_000,
          () => events.join(","),
        );
        await withRealTimeout(
          conversationImported.promise,
          30_000,
          () => events.join(","),
        );
      }

      const importedAssistantInputId = importedAssistantInputIds.get(
        conversationItem.id,
      );
      assert.ok(importedAssistantInputId, events.join(","));
      if (approved) {
        assert.deepEqual(assistantPhaseInputIds, [[importedAssistantInputId]]);
      } else {
        remoteItems.push(followUpConversationItem);
        runtimeWakeSignal.notify();
        firstAssistantPhaseRelease.resolve();
        await withRealTimeout(
          secondAssistantPhaseStarted.promise,
          30_000,
          () => events.join(","),
        );
        const importedFollowUpAssistantInputId = importedAssistantInputIds.get(
          followUpConversationItem.id,
        );
        assert.ok(importedFollowUpAssistantInputId);
        assert.deepEqual(assistantPhaseInputIds, [
          [importedAssistantInputId],
          [importedFollowUpAssistantInputId],
        ]);
      }
      assert.equal(assistantAskPrepareCalls, approved ? 1 : 0);
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 0);
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => [
          item.itemId,
          item.status,
        ]),
        approved
          ? [
              [firstAsk.id, "pending"],
              [deviceItem.id, "pending"],
              [lateAsk.id, "sending"],
            ]
          : [
              [firstAsk.id, "pending"],
              [deviceItem.id, "pending"],
              [lateAsk.id, "pending"],
            ],
      );
    } finally {
      runtimeAbortController.abort(
        new DOMException("Synthetic startup-window proof complete.", "AbortError"),
      );
      preAssistantSystemFetchRelease.resolve();
      firstAssistantPhaseRelease.resolve();
      secondAssistantPhaseRelease.resolve();
      if (runtimePromise) {
        await withRealTimeout(
          runtimePromise.catch(() => undefined),
          30_000,
          () => `cleanup:${events.join(",")}`,
        );
      }
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  }, 45_000);

  test.each([
    { approved: false, laterKind: "ordinary" },
    { approved: true, laterKind: "approved" },
  ])("orders a later $laterKind ask after the exact durable-head ask", async ({
    approved,
  }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const remoteItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const firstPrepareStarted = createDeferred<void>();
    const firstPrepareRelease = createDeferred<void>();
    const deviceAttempted = createDeferred<void>();
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const originalFetchSnapshot = deviceSyncPort.fetchSnapshot.bind(deviceSyncPort);
    deviceSyncPort.fetchSnapshot = async (input) => {
      events.push("device.snapshot");
      deviceAttempted.resolve();
      return await originalFetchSnapshot(input);
    };
    const firstAsk = createMailboxItem({
      dedupeKey: "assistant.ask.requested:exact-owner-first",
      expiresAt: "2026-04-27T00:10:00.000Z",
      id: "mailbox_item_exact_owner_ask_first",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "1",
    });
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:exact-owner-device",
      id: "mailbox_item_exact_owner_device",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "2",
    });
    const ordinaryAsk = createMailboxItem({
      dedupeKey: "assistant.ask.requested:exact-owner-ordinary",
      expiresAt: "2026-04-27T00:10:00.000Z",
      id: "mailbox_item_exact_owner_ask_ordinary",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "3",
    });
    const laterAsk = createMailboxItem({
      dedupeKey: "assistant.ask.requested:exact-owner-later",
      expiresAt: "2026-04-27T00:10:00.000Z",
      id: "mailbox_item_exact_owner_ask_later",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "4",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedAssistantAskSystemMailboxItem(firstAsk),
        vaultRoot,
        wake: createConsentedMemberAssistantAskRequestedWake({
          eventId: firstAsk.dedupeKey,
        }),
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "2";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/exact-owner-before.bundle.json",
        vaultRoot,
      });

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_exact_assistant_ask_owner",
            idleCheckpointDelayMs: 1,
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            events.push("snapshot");
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/exact-owner-after.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            assert.ok(
              item.item.id === ordinaryAsk.id || item.item.id === laterAsk.id,
            );
            events.push(
              item.item.id === ordinaryAsk.id
                ? "ask.ordinary.imported"
                : "ask.later.imported",
            );
            return await enqueueHostedSystemMailboxItem({
              item,
              vaultRoot,
              wake: approved && item.item.id === laterAsk.id
                ? createAssistantAskRequestedWake({ eventId: laterAsk.dedupeKey })
                : createConsentedMemberAssistantAskRequestedWake({
                    eventId: item.item.dedupeKey,
                  }),
            });
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            assistantAskPort: {
              async request(request) {
                if (request.action === "complete") {
                  throw new Error("Terminal exact-owner asks must not complete again.");
                }
                if (request.requestId === firstAsk.dedupeKey) {
                  events.push("ask.first.prepare");
                  firstPrepareStarted.resolve();
                  await firstPrepareRelease.promise;
                  remoteItems.push(ordinaryAsk, laterAsk);
                  runtimeWakeSignal.notify();
                  events.push("ask.first.terminal");
                } else {
                  assert.equal(request.requestId, laterAsk.dedupeKey);
                  events.push("ask.later.prepare");
                }
                return {
                  action: "prepare",
                  status: "terminal",
                  terminalReason: "unavailable",
                };
              },
            },
            deviceSyncPort,
            events,
            mailboxPort: createMailboxPort({ events, items: remoteItems }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      await withRealTimeout(
        firstPrepareStarted.promise,
        10_000,
        () => events.join(","),
      );
      const prematureOwner = await Promise.race([
        deviceAttempted.promise.then(() => "device" as const),
        new Promise<"blocked">((resolve) => {
          setTimeout(() => resolve("blocked"), 250);
        }),
      ]);
      assert.equal(prematureOwner, "blocked");
      assert.equal(events.includes("ask.later.prepare"), false);

      firstPrepareRelease.resolve();
      const result = await withRealTimeout(
        resultPromise,
        30_000,
        () => events.join(","),
      );
      const firstTerminalIndex = events.indexOf("ask.first.terminal");
      assert.notEqual(firstTerminalIndex, -1, events.join(","));
      const deviceSnapshotIndex = events.indexOf("device.snapshot");
      const laterAskIndex = events.indexOf("ask.later.prepare");
      if (approved) {
        assert.notEqual(laterAskIndex, -1);
        assert.ok(firstTerminalIndex < laterAskIndex, events.join(","));
        assert.ok(laterAskIndex < deviceSnapshotIndex, events.join(","));
        assert.equal(deviceSyncPort.fetchSnapshotCalls, 1);
      } else {
        assert.equal(laterAskIndex, -1, events.join(","));
        assert.equal(deviceSnapshotIndex, -1, events.join(","));
        assert.equal(deviceSyncPort.fetchSnapshotCalls, 0);
      }
      assert.equal(result.status, "scheduled");
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => [
          item.itemId,
          item.status,
        ]),
        approved
          ? [[ordinaryAsk.id, "pending"]]
          : [
              [deviceItem.id, "pending"],
              [ordinaryAsk.id, "pending"],
              [laterAsk.id, "pending"],
            ],
      );
    } finally {
      firstPrepareRelease.resolve();
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  }, 45_000);

  test.each([
    { ownerKind: "member ask" },
    { ownerKind: "operator diagnostic" },
  ])("resumes approved asks after foreground requeues an active exact $ownerKind", async ({
    ownerKind,
  }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const remoteItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const firstAskExecutionStarted = createDeferred<void>();
    const firstAskExecutionAborted = createDeferred<void>();
    const conversationImported = createDeferred<void>();
    const assistantPhaseStarted = createDeferred<void>();
    const assistantPhaseRelease = createDeferred<void>();
    const approvedAskPrepareStarted = createDeferred<void>();
    const runtimeAbortController = new AbortController();
    const firstAsk = createMailboxItem({
      dedupeKey: "assistant.ask.requested:foreground-requeue-first",
      expiresAt: "2026-04-27T00:10:00.000Z",
      id: "mailbox_item_foreground_requeue_first_ask",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "1",
    });
    const conversationItem = createMailboxItem({
      id: "mailbox_item_foreground_requeue_conversation",
      lane: "conversation",
      laneSeq: "1",
      occurredAt: "2026-04-27T00:00:01.000Z",
    });
    const approvedAsk = createMailboxItem({
      dedupeKey: "assistant.ask.requested:foreground-requeue-approved",
      expiresAt: "2026-04-27T00:10:00.000Z",
      id: "mailbox_item_foreground_requeue_approved_ask",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "2",
    });
    const preparedRequestIds: string[] = [];
    let assistantPhaseFinished = false;
    let runtimePromise:
      | ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess>
      | null = null;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.executeConsentedReadOnlyAssistantAsk.mockImplementationOnce(
        async (askInput) => {
          events.push("ask.first.execution.started");
          firstAskExecutionStarted.resolve();
          return await new Promise((_resolve, reject) => {
            const abort = () => {
              events.push("ask.first.execution.aborted");
              firstAskExecutionAborted.resolve();
              reject(askInput.abortSignal?.reason);
            };
            if (askInput.abortSignal?.aborted) {
              abort();
              return;
            }
            askInput.abortSignal?.addEventListener("abort", abort, { once: true });
          });
        },
      );
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueHostedSystemMailboxItem({
        item: createResolvedAssistantAskSystemMailboxItem(firstAsk),
        vaultRoot,
        wake: ownerKind === "operator diagnostic"
          ? createOperatorTaskAssistantAskRequestedWake({
              eventId: firstAsk.dedupeKey,
            })
          : createConsentedMemberAssistantAskRequestedWake({
              eventId: firstAsk.dedupeKey,
            }),
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/foreground-requeue-before.bundle.json",
        vaultRoot,
      });

      runtimePromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_foreground_requeue_resume",
            idleCheckpointDelayMs: 180_000,
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/foreground-requeue-after.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            if (item.item.id === approvedAsk.id) {
              events.push("ask.approved.imported");
              return await enqueueHostedSystemMailboxItem({
                item,
                vaultRoot,
                wake: createAssistantAskRequestedWake({
                  eventId: approvedAsk.dedupeKey,
                }),
              });
            }
            assert.equal(item.item.id, conversationItem.id);
            context?.onConversationInputStaged?.("linq");
            const assistantInputId = await stageAssistantInputEventForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            events.push("conversation.imported");
            conversationImported.resolve();
            return {
              assistantInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            assistantAskPort: {
              async request(request) {
                if (request.action === "complete") {
                  throw new Error("A foreground-preempted ask must not complete.");
                }
                preparedRequestIds.push(request.requestId);
                if (request.requestId === firstAsk.dedupeKey) {
                  return {
                    action: "prepare",
                    disclosure: {
                      permissionText: "Share only synthetic availability for this proof.",
                    },
                    question: "synthetic foreground-preemptible question",
                    status: "ready",
                    targetLabel: "Synthetic group",
                  };
                }
                assert.equal(request.requestId, approvedAsk.dedupeKey);
                events.push("ask.approved.prepare");
                approvedAskPrepareStarted.resolve();
                return {
                  action: "prepare",
                  status: "terminal",
                  terminalReason: "unavailable",
                };
              },
            },
            events,
            mailboxPort: createMailboxPort({ events, items: remoteItems }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            events.push("assistant.phase.started");
            assistantPhaseStarted.resolve();
            await assistantPhaseRelease.promise;
            assistantPhaseFinished = true;
            return { progressed: false };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );
      void runtimePromise.catch(() => undefined);

      await withRealTimeout(
        firstAskExecutionStarted.promise,
        30_000,
        () => events.join(","),
      );
      remoteItems.push(conversationItem);
      runtimeWakeSignal.notify();
      await withRealTimeout(
        firstAskExecutionAborted.promise,
        30_000,
        () => events.join(","),
      );
      await withRealTimeout(
        conversationImported.promise,
        30_000,
        () => events.join(","),
      );
      await withRealTimeout(
        assistantPhaseStarted.promise,
        30_000,
        () => events.join(","),
      );
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => [
          item.itemId,
          item.status,
        ]),
        [[firstAsk.id, "pending"]],
      );

      remoteItems.push(approvedAsk);
      runtimeWakeSignal.notify();
      await withRealTimeout(
        approvedAskPrepareStarted.promise,
        30_000,
        () => events.join(","),
      );
      assert.equal(assistantPhaseFinished, false);
      assert.deepEqual(preparedRequestIds, [
        firstAsk.dedupeKey,
        approvedAsk.dedupeKey,
      ]);
      assert.equal(
        (await readHostedSystemMailboxState(vaultRoot)).pending.some(
          (item) => item.itemId === firstAsk.id && item.status === "pending",
        ),
        true,
      );
    } finally {
      runtimeAbortController.abort(
        new DOMException("Synthetic foreground-requeue proof complete.", "AbortError"),
      );
      assistantPhaseRelease.resolve();
      if (runtimePromise) {
        await withRealTimeout(
          runtimePromise.catch(() => undefined),
          30_000,
          () => `cleanup:${events.join(",")}`,
        );
      }
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  }, 45_000);

  test("system mailbox mode imports and runs a new device-sync row in the same invocation", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const imported: string[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:new-import",
      id: "mailbox_item_system_mailbox_device_new_import",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-new-device-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_new_device",
            leaseGeneration: "19",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-new-device.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            imported.push(`${item.item.lane}:${item.item.kind}`);
            await enqueueHostedSystemMailboxItem({
              item: createResolvedDeviceSyncSystemMailboxItem(item.item),
              vaultRoot,
              wake: createDeviceSyncSystemWakeForMailboxItem(item.item),
            });
            return {
              reasonCode: "device_sync.queued",
              status: "imported",
            };
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            logRequests,
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [deviceItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox device-sync must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.deepEqual(imported, ["system:device-sync.wake"]);
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(deviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemImportedSeq,
        "1",
      );
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "1",
      );
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, null);
      assert.equal(result.status, "idle");
      assert.deepEqual((await readHostedSystemMailboxState(vaultRoot)).pending, []);
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      const lifecycleEntries = logRequests
        .flatMap((request) => request.entries)
        .filter((entry) => entry.eventCode.startsWith("device-sync.pass_"));
      assert.deepEqual(lifecycleEntries.map((entry) => ({
        attemptId: entry.attemptId,
        eventCode: entry.eventCode,
        leaseGeneration: entry.leaseGeneration,
        workspaceVersion: entry.workspaceVersion,
      })), [
        {
          attemptId: "attempt_synthetic_system_mailbox_new_device",
          eventCode: "device-sync.pass_started",
          leaseGeneration: "19",
          workspaceVersion: "0",
        },
        {
          attemptId: "attempt_synthetic_system_mailbox_new_device",
          eventCode: "device-sync.pass_finished",
          leaseGeneration: "19",
          workspaceVersion: "0",
        },
      ]);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox mode rederives a genuine assistant source after clearing stale assistant projection", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const staleAssistantWakeAt = "2026-04-26T23:59:59.000Z";
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:assistant-source",
      id: "mailbox_item_system_mailbox_device_assistant_source",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const pendingInputItem = createMailboxItem({
      id: "mailbox_item_system_mailbox_pending_assistant_source",
      lane: "conversation",
      laneSeq: "1",
      occurredAt: "2026-04-27T00:00:01.000Z",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await stagePendingLinqAssistantInputForMailboxItem({
        item: pendingInputItem,
        vaultRoot,
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-assistant-source-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_device_assistant_source",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-assistant-source.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleAssistantWakeAt,
                nextWakeReason: "assistant",
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox mode must not serve pending assistant input.");
          },
          vaultRoot,
        },
      );

      assert.equal(deviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.notEqual(checkpointRequests.at(-1)?.nextWakeAt, staleAssistantWakeAt);
      assert.equal(result.nextWakeReason, "assistant");
      assert.notEqual(result.nextWakeAt, staleAssistantWakeAt);
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox mode keeps device-sync wake identity on execution failure", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:execution-failure",
      id: "mailbox_item_system_mailbox_device_execution_failure",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    let fetchSnapshotCalls = 0;
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      async ackDirtyStateProcessed() {
        throw new Error("Device sync dirty ack should not run for execution failure.");
      },
      async applyUpdates(request) {
        return {
          appliedAt: request.occurredAt ?? TEST_NOW,
          updates: [],
          userId: TEST_USER_ID,
        };
      },
      async createConnectLink() {
        throw new Error("Device sync connect link should not run in this e2e.");
      },
      async fetchDirtyStates() {
        return {
          hasMore: false,
          items: [],
          nextWakeAt: null,
          userId: TEST_USER_ID,
        };
      },
      async fetchSnapshot() {
        fetchSnapshotCalls += 1;
        throw new Error("synthetic device-sync snapshot failure");
      },
    };

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-device-execution-failure-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_device_execution_failure",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-device-execution-failure.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("System mailbox device-sync failure must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.equal(fetchSnapshotCalls, 1);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeReason, "device-sync.reconcile");
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "device-sync.reconcile");
      const state = await readHostedSystemMailboxState(vaultRoot);
      const pendingItem = state.pending.find((item) => item.itemId === deviceItem.id) ?? null;
      assert.ok(pendingItem);
      assert.equal(pendingItem.routeAction, "run-device-sync-wake");
      assert.equal(pendingItem.nextAttemptAt, result.nextWakeAt);
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "0",
      );
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    {
      defaultOwnedSystemMailboxWakeAt: null,
      dueAssistantWakePending: false,
      scenario: "without a foreground handoff",
    },
    {
      defaultOwnedSystemMailboxWakeAt: null,
      dueAssistantWakePending: true,
      scenario: "with assistant work already due",
    },
    {
      defaultOwnedSystemMailboxWakeAt: TEST_NOW,
      dueAssistantWakePending: false,
      scenario: "with a ready default-owned mailbox wake behind the device wake",
    },
    {
      defaultOwnedSystemMailboxWakeAt: "2026-04-27T00:06:00.000Z",
      dueAssistantWakePending: false,
      scenario: "with a future default-owned mailbox retry behind the device wake",
    },
  ])("system mailbox mode preserves successful dirty-ack follow-up wake $scenario", async ({
    defaultOwnedSystemMailboxWakeAt,
    dueAssistantWakePending,
  }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:dirty-ack-follow-up",
      id: "mailbox_item_system_mailbox_device_dirty_ack_follow_up",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const followUpWakeAt = "2026-04-27T00:03:00.000Z";
    const defaultAssistantWakeAt = dueAssistantWakePending
      ? TEST_NOW
      : "2026-04-27T00:08:00.000Z";
    const projectedDefaultWakeAt = defaultOwnedSystemMailboxWakeAt
      ?? defaultAssistantWakeAt;
    const defaultOwnerHandoffExpected =
      dueAssistantWakePending
      || (
        defaultOwnedSystemMailboxWakeAt !== null
        && Date.parse(defaultOwnedSystemMailboxWakeAt) <= Date.parse(TEST_NOW)
      );
    const defaultOwnedItem = createMailboxItem({
      dedupeKey: "assistant.ask.requested:dirty-ack-follow-up",
      expiresAt: "2026-04-27T00:10:00.000Z",
      id: "mailbox_item_system_mailbox_default_owned_dirty_ack_follow_up",
      kind: "assistant.ask.requested",
      lane: "system",
      laneSeq: "2",
    });
    const baseDeviceSyncPort = createEmptyDeviceSyncPort();
    let dirtyAckCalls = 0;
    let browserPublishCalls = 0;
    let browserWriteCalls = 0;
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...baseDeviceSyncPort,
      async ackDirtyStateProcessed(request) {
        dirtyAckCalls += 1;
        events.push("device-sync.dirty-ack");
        const { signal, ...record } = request;
        assert.deepEqual(record, {
          connectionId: "device_sync_connection_synthetic",
          processedDirtyPayloadIds: ["dirty_payload_synthetic"],
          processedRevision: "7",
        });
        assert.ok(signal);
        assert.equal(signal.aborted, false);
        return {
          connectionId: request.connectionId,
          dirtyRevision: "8",
          nextWakeAt: followUpWakeAt,
          processedRevision: request.processedRevision,
          recorded: true,
          stillDirty: true,
          userId: TEST_USER_ID,
        };
      },
    };

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await upsertAutomation({
        automationId: "automation_01JQ8PWXP5A68SQM1W0GYM41XZ",
        continuityPolicy: "fresh",
        instructions: "Send one synthetic scheduled reminder.",
        now: new Date(Date.parse(TEST_NOW) - 60_000),
        route: {
          channel: "linq",
          deliveryTarget: "synthetic_direct_chat",
          identityId: null,
          participantId: null,
          threadId: "synthetic_direct_chat",
          threadIsDirect: true,
        },
        schedule: { at: defaultAssistantWakeAt, kind: "at" },
        status: "active",
        title: "Synthetic scheduled reminder",
        vaultRoot,
      });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      if (defaultOwnedSystemMailboxWakeAt !== null) {
        await enqueueHostedSystemMailboxItem({
          item: createResolvedAssistantAskSystemMailboxItem(defaultOwnedItem),
          vaultRoot,
          wake: createConsentedMemberAssistantAskRequestedWake({
            eventId: defaultOwnedItem.dedupeKey,
          }),
        });
      }
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: state.pending.map((item) => {
          if (item.itemId === deviceItem.id) {
            return {
                ...item,
                postCheckpointRecord: {
                  connectionId: "device_sync_connection_synthetic",
                  kind: "device-sync.dirty-processed" as const,
                  processedDirtyPayloadIds: ["dirty_payload_synthetic"],
                  processedRevision: "7",
                },
                status: "recording" as const,
              };
          }
          if (
            item.itemId === defaultOwnedItem.id
            && defaultOwnedSystemMailboxWakeAt !== null
          ) {
            return {
              ...item,
              nextAttemptAt: defaultOwnedSystemMailboxWakeAt === TEST_NOW
                ? null
                : defaultOwnedSystemMailboxWakeAt,
            };
          }
          return item;
        }),
      }));
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = defaultOwnedSystemMailboxWakeAt === null
        ? "1"
        : "2";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-device-dirty-ack-follow-up-before.bundle.json",
        vaultRoot,
      });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_device_dirty_ack_follow_up",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "9".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-device-dirty-ack-follow-up.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            browserVaultReplicaPort: {
              async publishRef({ replicaRef }) {
                browserPublishCalls += 1;
                events.push("browser-vault.publish");
                return {
                  published: true,
                  workspace: createWorkspaceState({
                    browserVaultReplicaRef: replicaRef,
                    version: "1",
                  }),
                };
              },
              async write({ replica }) {
                browserWriteCalls += 1;
                events.push("browser-vault.write");
                return createBrowserVaultReplicaRef(replica);
              },
            },
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            vaultSharePort: {
              async listActiveProjectionScopes() {
                return {
                  generationTokensByProjectionScopeKey: {
                    "sleep-times.v0": "a".repeat(43),
                  },
                  projectionKinds: ["sleep-times.v0" as const],
                  projectionScopes: [{ projectionKind: "sleep-times.v0" as const }],
                };
              },
              async deliver() {
                events.push("vault-share.deliver");
                return { status: "delivered" };
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Successful dirty ack must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.equal(
        dirtyAckCalls,
        1,
        JSON.stringify({
          checkpointRequests,
          events,
          mailboxState: await readHostedSystemMailboxState(vaultRoot),
          result,
        }),
      );
      assert.equal(browserWriteCalls, 1);
      assert.equal(browserPublishCalls, 1);
      assert.ok(events.includes("vault-share.deliver"), JSON.stringify(events));
      assert.ok(
        requireEventIndex(events, "browser-vault.publish")
          < requireEventIndex(events, "device-sync.dirty-ack"),
        JSON.stringify(events),
      );
      assert.ok(
        requireEventIndex(events, "workspace.checkpoint")
          < requireEventIndex(events, "vault-share.deliver"),
        JSON.stringify(events),
      );
      assert.ok(
        requireEventIndex(events, "vault-share.deliver")
          < requireEventIndex(events, "device-sync.dirty-ack"),
        JSON.stringify(events),
      );
      assert.equal(result.status, "scheduled");
      assert.equal(
        result.nextWakeAt,
        defaultOwnerHandoffExpected ? TEST_NOW : followUpWakeAt,
      );
      assert.equal(
        result.nextWakeReason,
        defaultOwnerHandoffExpected ? "assistant" : "device-sync.reconcile",
      );
      assert.equal(
        result.immediateRecheckRequested,
        defaultOwnerHandoffExpected ? true : undefined,
      );
      assert.equal(
        checkpointRequests.at(-1)?.nextWakeAt,
        defaultOwnerHandoffExpected ? TEST_NOW : followUpWakeAt,
      );
      assert.equal(
        checkpointRequests.at(-1)?.nextWakeReason,
        defaultOwnerHandoffExpected ? "assistant" : "device-sync.reconcile",
      );
      assert.equal(
        checkpointRequests.at(-1)?.nextDefaultProcessingWakeAt,
        projectedDefaultWakeAt,
      );
      assert.equal(
        checkpointRequests.at(-1)?.nextDefaultProcessingWakeReason,
        "assistant",
      );
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "1",
      );
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending.map((item) => item.itemId),
        defaultOwnedSystemMailboxWakeAt === null ? [] : [defaultOwnedItem.id],
      );
      if (!defaultOwnerHandoffExpected) {
        const followUpCheckpointIndex = checkpointRequests.findIndex((request) =>
          request.nextWakeAt === followUpWakeAt
          && request.nextWakeReason === "device-sync.reconcile"
        );
        assert.ok(followUpCheckpointIndex >= 0);
        assert.equal(
          checkpointRequests.slice(followUpCheckpointIndex + 1).some((request) =>
            request.nextWakeAt === null && request.nextWakeReason === null
          ),
          false,
        );
      }
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("system mailbox mode keeps device-sync wake identity on dirty ack failure", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const deviceItem = createMailboxItem({
      dedupeKey: "device-sync.wake:dirty-ack-failure",
      id: "mailbox_item_system_mailbox_device_dirty_ack_failure",
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: "1",
    });
    const baseDeviceSyncPort = createEmptyDeviceSyncPort();
    let dirtyAckCalls = 0;
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      ...baseDeviceSyncPort,
      async ackDirtyStateProcessed() {
        dirtyAckCalls += 1;
        throw new Error("synthetic dirty ack failure");
      },
    };

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.prepareHostedCodexAssistantProcess.mockClear();
      mocks.cancelPendingWarmCodexPreinitialization.mockClear();
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await enqueueDeviceSyncSystemMailboxItemForTest({
        item: deviceItem,
        vaultRoot,
      });
      await updateHostedSystemMailboxState(vaultRoot, (state) => ({
        pending: state.pending.map((item) =>
          item.itemId === deviceItem.id
            ? {
                ...item,
                postCheckpointRecord: {
                  connectionId: "device_sync_connection_synthetic",
                  kind: "device-sync.dirty-processed" as const,
                  processedDirtyPayloadIds: ["dirty_payload_synthetic"],
                  processedRevision: "7",
                },
                status: "recording" as const,
              }
            : item
        ),
      }));
      const importState = createEmptyHostedMailboxImportState();
      importState.watermarks.system = "1";
      await writeMailboxImportStateFile(vaultRoot, importState);
      const restoredWorkspace = await createVaultSnapshotBundle({
        key: "users/bundles/member-synthetic/system-mailbox-device-dirty-ack-failure-before.bundle.json",
        vaultRoot,
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_system_mailbox_device_dirty_ack_failure",
            processingMode: "system_mailbox",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/system-mailbox-device-dirty-ack-failure.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Already-imported system mailbox work should not import a new row.");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[restoredWorkspace.hash, restoredWorkspace.bytes]]),
            deviceSyncPort,
            logRequests,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: restoredWorkspace.snapshotRef,
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Dirty ack retry must not enter assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.equal(dirtyAckCalls, 1);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeReason, "device-sync.reconcile");
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "device-sync.reconcile");
      const state = await readHostedSystemMailboxState(vaultRoot);
      assert.equal(state.pending.length, 1);
      assert.equal(state.pending[0]?.routeAction, "run-device-sync-wake");
      assert.equal(state.pending[0]?.status, "recording");
      assert.equal(state.pending[0]?.nextAttemptAt, result.nextWakeAt);
      assert.equal(
        checkpointRequests.at(-1)?.redactedStatus?.hostedMailboxSystemHandledThroughSeq,
        "0",
      );
      const failureEntries = logRequests.flatMap((request) => request.entries);
      assert.equal(
        failureEntries.filter((entry) => entry.eventCode === "device-sync.job_failed").length,
        0,
      );
      const persistenceFailure = failureEntries.find(
        (entry) => entry.eventCode === "device-sync.dirty_ack_persistence_failed",
      );
      if (!persistenceFailure) {
        throw new Error("Expected a distinct dirty-ack persistence failure diagnostic.");
      }
      assert.equal(typeof persistenceFailure.at, "string");
      assert.equal(persistenceFailure.component, "device-sync");
      assert.equal(persistenceFailure.errorCode, "runtime_error");
      assert.equal(
        persistenceFailure.eventCode,
        "device-sync.dirty_ack_persistence_failed",
      );
      assert.equal(persistenceFailure.level, "warn");
      assert.equal(persistenceFailure.phase, "checkpoint");
      assert.deepEqual(persistenceFailure.redactedJson, {
        errorCode: "runtime_error",
        nextWakeAtPresent: true,
        safeErrorMessage: "Hosted execution runtime failed.",
      });
      assert.ok(!JSON.stringify(persistenceFailure).includes("synthetic dirty ack failure"));
      assert.ok(!JSON.stringify(persistenceFailure).includes("device_sync_connection_synthetic"));
      assert.ok(!JSON.stringify(persistenceFailure).includes("dirty_payload_synthetic"));
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  });
