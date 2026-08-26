import {
  REAL_SET_TIMEOUT,
  TEST_NOW,
  TEST_USER_ID,
  createBundleRef,
  createConsentedMemberAssistantAskRequestedWake,
  createDeferred,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createPrivateCurrentSenderAssistantAskRequestedWake,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceSnapshotV2Ref,
  createWorkspaceState,
  ensureHostedBootstrapMetadataForSystemMailboxTest,
  mocks,
  readCapturedHostedExecutionLogs,
  readCapturedRuntimePhaseLogs,
  removeTempRoot,
  requireEventIndex,
  stageAssistantInputEventForMailboxItem,
  stagePendingLinqAssistantInputForMailboxItem,
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
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionEnvironmentInterviewCompletedWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActionRequestedWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionPendingEffectsReconcileRequestedWake,
  buildHostedExecutionRuntimeControlWake,
  deriveHostedExecutionErrorCode,
} from "@murphai/hosted-execution";
import type {
  MemberActionRequestV1,
  WorkoutLiveApplyMemberActionV1,
  WorkoutLiveSnapshotMemberActionV1,
} from "@murphai/contracts";
import {
  addLiveWorkoutExercise,
  logLiveWorkoutSet,
  readLiveWorkoutCardEditor,
  startLiveWorkout,
} from "@murphai/vault-usecases/workouts";
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
  HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
  type HostedExecutionAssistantAskRequestedWake,
  type HostedBrowserVaultReplicaRef,
  type HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";
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
  prepareHostedWakeContext,
} from "../src/hosted-runtime/context.ts";
import type {
  RuntimeWakeSignal,
} from "../src/hosted-runtime/runtime-wake.ts";
import {
  createHostedAssistantTurnEnvironment,
  normalizeHostedAssistantRuntimeConfig,
} from "../src/hosted-runtime/environment.ts";
import {
  resolveHostedPendingAssistantInputWakeAt,
} from "../src/hosted-runtime/pending-assistant-input.ts";
import {
  enqueueHostedSystemMailboxItem,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
  updateHostedSystemMailboxState,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  createHostedWorkspaceBridgeMailboxImporter,
} from "../src/hosted-runtime/snapshot-bridge-mailbox.ts";
import {
  HostedRuntimeArtifactReadError,
  type HostedRuntimeDeviceSyncPort,
  type HostedRuntimeMailboxPort,
  type HostedRuntimePlatform,
  type RuntimeLivenessPort,
  type HostedRuntimeWorkspacePort,
  type HostedRuntimeWorkspaceSnapshotPort,
} from "../src/hosted-runtime-contracts.ts";

describe("hosted workspace runtime entrypoint", () => {test("keeps idle-window trigger when a queued runtime wake has no foreground work", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    let queuedWakePending = false;
    let queuedWakeConsumed = false;
    let wakeNotifiedAt = 0;
    mocks.prepareHostedCodexAssistantProcess.mockClear();
    mocks.cancelPendingWarmCodexPreinitialization.mockClear();
    const runtimeWakeSignal: RuntimeWakeSignal = {
      consumePending() {
        if (!queuedWakePending || queuedWakeConsumed) {
          return null;
        }
        queuedWakeConsumed = true;
        return { notifiedAtEpochMs: Date.now() };
      },
      notify() {
        queuedWakePending = true;
      },
      wait(signal) {
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("Runtime wake wait was aborted.", "AbortError"),
          );
        }
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => {
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new DOMException("Runtime wake wait was aborted.", "AbortError"),
            );
          }, { once: true });
        });
      },
    };

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_phase_checkpoint_queued_wake_idle_window",
          idleCheckpointDelayMs: 200,
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      }), {
        async createCheckpointSnapshot(snapshotInput) {
          assert.equal(snapshotInput.idleCheckpointTrigger, "idle_window");
          assert.equal(snapshotInput.runtimeWakePendingAtCheckpoint, true);
          return {
            snapshotRef: createBundleRef({
              hash: "e".repeat(64),
              key: "users/bundles/member-synthetic/phase-checkpoint-queued-wake.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem() {
          throw new Error("Queued wake without foreground work should not import mailbox items.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({
            events: [],
            items: [],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events: [],
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        runtimeWakeSignal,
        async runAssistantPhase() {
          wakeNotifiedAt = Date.now();
          runtimeWakeSignal.notify();
          return {
            checkpointReason: "assistant_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
      });

      const phaseLogs = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_phase_checkpoint_queued_wake_idle_window",
        spy: consoleInfo,
      });
      expect(
        phaseLogs.find((entry) =>
          entry.details.runtimePhase === "workspace.checkpoint.idle_shutdown"
          && entry.details.runtimePhaseStatus === "start"
        )?.details,
      ).toEqual(expect.objectContaining({
        idleCheckpointTrigger: "idle_window",
        runtimeWakePendingAtCheckpoint: true,
      }));
      assert.ok(wakeNotifiedAt > 0);
      assert.ok(Date.now() - wakeNotifiedAt >= 150);
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(checkpointRequests[0]?.runtimeWakePendingAtCheckpoint, true);
      assert.equal(mocks.prepareHostedCodexAssistantProcess.mock.calls.length, 0);
      assert.equal(
        mocks.cancelPendingWarmCodexPreinitialization.mock.calls.length,
        0,
      );
      assert.equal(result.status, "idle");
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

  test.each([
    {
      expectImmediateRecheck: false,
      expectedElapsedBoundaryMs: 850,
      foregroundWork: false,
      futureMailboxWake: false,
      label: "keeps the idle window when the provider still matches",
      providerReadOutcome: "openai" as const,
      slug: "matching_provider",
    },
    {
      expectImmediateRecheck: true,
      expectedElapsedBoundaryMs: 650,
      foregroundWork: false,
      futureMailboxWake: false,
      label: "hands off immediately when the provider changed",
      providerReadOutcome: "venice" as const,
      slug: "changed_provider",
    },
    {
      expectImmediateRecheck: true,
      expectedElapsedBoundaryMs: 650,
      foregroundWork: false,
      futureMailboxWake: true,
      label: "hands off immediately with a future mailbox continuation",
      providerReadOutcome: "venice" as const,
      slug: "changed_provider_future_mailbox",
    },
    {
      expectImmediateRecheck: true,
      expectedElapsedBoundaryMs: 650,
      foregroundWork: true,
      futureMailboxWake: false,
      label: "hands foreground work to the saved provider before importing it",
      providerReadOutcome: "venice" as const,
      slug: "changed_provider_foreground_work",
    },
    {
      expectImmediateRecheck: false,
      expectedElapsedBoundaryMs: 850,
      foregroundWork: false,
      futureMailboxWake: false,
      label: "keeps the idle window when provider authority is unavailable",
      providerReadOutcome: "unavailable" as const,
      slug: "provider_unavailable",
    },
  ])("$label after an external runtime wake", async ({
    expectImmediateRecheck,
    expectedElapsedBoundaryMs,
    foregroundWork,
    futureMailboxWake,
    providerReadOutcome,
    slug,
  }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const dirtyWaitStarted = createDeferred<void>();
    const mailboxItems: HostedMailboxItem[] = [];
    let assistantPhaseFinished = false;
    let assistantPhaseCount = 0;
    let activeDirtyWake: ((notification: { notifiedAtEpochMs: number }) => void) | null = null;
    let importedItemCount = 0;
    let providerReadCount = 0;
    let snapshotCount = 0;
    const runtimeWakeSignal: RuntimeWakeSignal = {
      consumePending() {
        return null;
      },
      notify() {
        activeDirtyWake?.({ notifiedAtEpochMs: Date.now() });
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
            activeDirtyWake = resolveCurrent;
            dirtyWaitStarted.resolve();
          }
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
    };

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: `attempt_synthetic_external_wake_${slug}`,
          idleCheckpointDelayMs: 1_000,
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      }), {
        async createCheckpointSnapshot(snapshotInput) {
          snapshotCount += 1;
          assert.equal(snapshotInput.idleCheckpointTrigger, "idle_window");
          assert.equal(snapshotInput.runtimeWakePendingAtCheckpoint, true);
          return {
            snapshotRef: createBundleRef({
              hash: "f".repeat(64),
              key: `users/bundles/member-synthetic/external-wake-${slug}.bundle.json`,
              size: 512,
            }),
          };
        },
        async importItem() {
          importedItemCount += 1;
          return { status: "imported" };
        },
        platform: createPlatform({
          assistantConfigurationToolPort: {
            async request() {
              providerReadCount += 1;
              if (providerReadOutcome === "unavailable") {
                throw new Error("control plane unavailable");
              }
              return {
                action: "read",
                result: {
                  availableModels: ["gpt-5.6-luna", "gpt-5.6-terra"],
                  availableProviders: ["openai", "venice"],
                  availableReasoningEfforts: ["low", "medium", "high", "xhigh"],
                  configurationAvailable: true,
                  dormantSolPreference: false,
                  model: "gpt-5.6-terra",
                  provider: providerReadOutcome,
                  reasoningEffort: "low",
                  solAvailable: false,
                },
              };
            },
          },
          mailboxPort: createMailboxPort({
            events: [],
            items: mailboxItems,
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events: [],
            workspace: createWorkspaceState({
              ...(futureMailboxWake
                ? {
                    nextWakeAt: new Date(Date.now() + 60_000).toISOString(),
                    nextWakeReason: "mailbox",
                  }
                : {}),
              version: "0",
            }),
          }),
        }),
        runtimeWakeSignal,
        async runAssistantPhase() {
          assistantPhaseCount += 1;
          assistantPhaseFinished = true;
          return {
            checkpointReason: "assistant_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
      });

      await withRealTimeout(
        dirtyWaitStarted.promise,
        1_000,
        () => "Dirty checkpoint wait did not arm.",
      );
      if (foregroundWork) {
        mailboxItems.push(createMailboxItem({
          id: "mailbox_item_provider_handoff_foreground",
          laneSeq: "1",
        }));
      }
      const wakeNotifiedAt = Date.now();
      runtimeWakeSignal.notify();

      const result = await resultPromise;
      const elapsedAfterWakeMs = Date.now() - wakeNotifiedAt;

      const phaseLogs = readCapturedRuntimePhaseLogs({
        attemptId: `attempt_synthetic_external_wake_${slug}`,
        spy: consoleInfo,
      });
      expect(
        phaseLogs.find((entry) =>
          entry.details.runtimePhase === "workspace.checkpoint.idle_shutdown"
          && entry.details.runtimePhaseStatus === "start"
        )?.details,
      ).toEqual(expect.objectContaining({
        idleCheckpointTrigger: "idle_window",
        runtimeWakePendingAtCheckpoint: true,
      }));
      assert.equal(snapshotCount, 1);
      assert.equal(providerReadCount, 1);
      assert.equal(importedItemCount, 0);
      assert.equal(assistantPhaseCount, 1);
      if (expectImmediateRecheck) {
        assert.ok(elapsedAfterWakeMs < expectedElapsedBoundaryMs);
      } else {
        assert.ok(elapsedAfterWakeMs >= expectedElapsedBoundaryMs);
      }
      assert.equal(checkpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(checkpointRequests[0]?.runtimeWakePendingAtCheckpoint, true);
      assert.equal(
        result.immediateRecheckRequested === true,
        expectImmediateRecheck,
      );
      assert.equal(result.status, futureMailboxWake ? "scheduled" : "idle");
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

  test("drains causal pending-effects and joined-group completion wakes before the dirty idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const foregroundCausalOnlyValues: boolean[] = [];
    let assistantPhaseCalls = 0;
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_causal_pending_effects_dirty_wake",
            idleCheckpointDelayMs: 500,
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
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/causal-pending-effects.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            if (item.item.kind === "assistant.ask.completed") {
              assert.equal(
                "assistantAskCompletionKind" in (context ?? {}),
                false,
              );
            }
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
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
            foregroundCausalOnlyValues.push(input.foregroundCausalOnly === true);
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              setTimeout(() => {
                mailboxItems.push(createMailboxItem({
                  id: "mailbox_item_entrypoint_causal_pending_effects",
                  kind: "runtime.pending-effects-reconcile-requested",
                  lane: "system",
                  laneSeq: "1",
                }));
                mailboxItems.push(createMailboxItem({
                  id:
                    "mailbox_item_entrypoint_"
                    + "causal_pending_effects_completion",
                  kind: "assistant.ask.completed",
                  lane: "system",
                  laneSeq: "2",
                }));
                runtimeWakeSignal.notify();
              }, 0);
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }
            if (assistantPhaseCalls === 2 || assistantPhaseCalls === 3) {
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      const result = await withRealTimeout(
        resultPromise,
        2_000,
        () => events.join(","),
      );

      assert.equal(assistantPhaseCalls, 4);
      assert.deepEqual(
        foregroundCausalOnlyValues,
        [false, true, true, true],
      );
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_causal_pending_effects",
        ) < requireEventIndex(events, "snapshot:idle_shutdown"),
        events.join(","),
      );
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:"
            + "mailbox_item_entrypoint_causal_pending_effects_completion",
        ) < requireEventIndex(events, "snapshot:idle_shutdown"),
        events.join(","),
      );
      assert.ok(
        requireEventIndex(events, "assistant.phase:3")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
        events.join(","),
      );
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  for (const actionKind of [
    "workout.live.apply",
    "workout.live.snapshot",
  ] as const) {
    test(`executes a ${actionKind} member action before the dirty idle checkpoint`, async () => {
      const vaultRoot = await mkdtemp(
        path.join(tmpdir(), "murph-workspace-entrypoint-"),
      );
      const events: string[] = [];
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const mailboxItems: HostedMailboxItem[] = [];
      const recordedOutcomes: Array<
        Parameters<
          NonNullable<HostedRuntimeMailboxPort["recordMemberActionOutcome"]>
        >[0]
      > = [];
      const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
      const actionId = actionKind === "workout.live.apply"
        ? "2f1c1fdc-c7b0-4d90-b902-8e6295959243"
        : "8676b264-9b91-4b50-8c73-184d7a63b901";
      const mailboxItem = createMailboxItem({
        dedupeKey: `member.action.requested:${actionId}`,
        id: `mailbox_item_entrypoint_${actionKind.replaceAll(".", "_")}`,
        kind: "member.action.requested",
        lane: "system",
        laneSeq: "1",
      });
      let assistantPhaseCalls = 0;
      let activeVaultRoot = vaultRoot;
      let memberActionWake: ReturnType<
        typeof buildHostedExecutionMemberActionRequestedWake
      > | null = null;
      let workoutId: string | null = null;

      try {
        await initializeVault({ createdAt: TEST_NOW, vaultRoot });
        await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);
        const embeddedWorkout = {
          exercises: [{
            name: "Push-up",
            sets: [{ actual: "8 reps", status: "completed" as const, target: null }],
          }],
          state: "active" as const,
          version: 1 as const,
        };
        const baseMailboxPort = createMailboxPort({
          events,
          items: mailboxItems,
        });
        const mailboxPort: HostedRuntimeMailboxPort = {
          ...baseMailboxPort,
          async recordMemberActionOutcome(outcome) {
            events.push("member-action:outcome-recorded");
            recordedOutcomes.push(outcome);
          },
        };
        const providerPassCallsBefore =
          mocks.runAssistantAutomationPass.mock.calls.length;

        const result = await withRealTimeout(
          runHostedWorkspaceRuntimeJobInProcess(
            createWorkspaceRuntimeJobInput({
              request: {
                attemptId: `attempt_pre_checkpoint_${actionKind.replaceAll(".", "_")}`,
                idleCheckpointDelayMs: 200,
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
                    hash: actionKind === "workout.live.apply"
                      ? "1".repeat(64)
                      : "2".repeat(64),
                    key:
                      "users/bundles/member-synthetic/"
                      + `${actionKind.replaceAll(".", "-")}.bundle.json`,
                    size: 512,
                  }),
                };
              },
              async importItem(item) {
                events.push(`mailbox.importItem:${item.item.id}`);
                assert.ok(memberActionWake);
                return await enqueueHostedSystemMailboxItem({
                  item,
                  vaultRoot: activeVaultRoot,
                  wake: memberActionWake,
                });
              },
              platform: createPlatform({
                mailboxPort,
                workspacePort: createWorkspacePort({
                  checkpointRequests,
                  events,
                  workspace: createWorkspaceState({ version: "0" }),
                }),
              }),
              runtimeWakeSignal,
              async runAssistantPhase(input) {
                assistantPhaseCalls += 1;
                events.push(`assistant.phase:${assistantPhaseCalls}`);
                if (assistantPhaseCalls === 1) {
                  activeVaultRoot = input.restored.vaultRoot;
                  await prepareHostedWakeContext(
                    activeVaultRoot,
                    buildHostedExecutionMemberActivatedWake({
                      eventId: "member.activated:workout-card-pre-checkpoint",
                      memberChannels: {
                        email: false,
                        linq: true,
                        telegram: false,
                      },
                      memberId: TEST_USER_ID,
                      occurredAt: TEST_NOW,
                      timeZone: "UTC",
                    }),
                    input.runtimeEnv,
                    input.runtime.resolvedConfig,
                    { operatorHomeRoot: input.restored.operatorHomeRoot },
                  );
                  const started = await startLiveWorkout({
                    name: "Workout",
                    startedAt: TEST_NOW,
                    vault: activeVaultRoot,
                  });
                  workoutId = started.eventId;
                  await addLiveWorkoutExercise({
                    mode: "bodyweight",
                    name: "Push-up",
                    order: 1,
                    vault: activeVaultRoot,
                    workoutId,
                  });
                  await logLiveWorkoutSet({
                    exerciseOrder: 1,
                    reps: 8,
                    requireExistingSet: true,
                    setOrder: 1,
                    vault: activeVaultRoot,
                    workoutId,
                  });
                  const initialCard = await readLiveWorkoutCardEditor({
                    presentation: embeddedWorkout,
                    vault: activeVaultRoot,
                    workoutId,
                  });
                  assert.ok(initialCard);
                  const initialSetResult =
                    initialCard.editor.exercises[0]?.sets[0]?.result;
                  assert.deepEqual(
                    initialSetResult,
                    { kind: "reps", reps: 8 },
                  );
                  const action:
                    | WorkoutLiveApplyMemberActionV1
                    | WorkoutLiveSnapshotMemberActionV1 =
                    actionKind === "workout.live.apply"
                      ? {
                          expectedWorkout: {
                            actionBinding: initialCard.editor.actionBinding,
                            exercises: [{
                              name: "Push-up",
                              sets: [{ logged: true }],
                            }],
                          },
                          kind: "workout.live.apply",
                          mutations: [{
                            exerciseName: "Push-up",
                            exercisePosition: 1,
                            expectedResult: initialSetResult,
                            kind: "set.put",
                            result: { kind: "reps", reps: 9 },
                            setPosition: 1,
                          }],
                          version: 1,
                        }
                      : {
                          kind: "workout.live.snapshot",
                          presentation: {
                            footer: null,
                            subtitle: null,
                            title: "Workout",
                            workout: initialCard.workout,
                          },
                          version: 1,
                          workoutBinding: initialCard.editor.actionBinding,
                        };
                  const requestedAt = new Date().toISOString();
                  const request = {
                    action,
                    actionId,
                    requestedAt,
                    schemaVersion: 1,
                  } satisfies MemberActionRequestV1;
                  memberActionWake =
                    buildHostedExecutionMemberActionRequestedWake({
                      eventId: `member.action.requested:${actionId}`,
                      memberId: TEST_USER_ID,
                      occurredAt: requestedAt,
                      request,
                    });
                  setTimeout(() => {
                    mailboxItems.push(mailboxItem);
                    runtimeWakeSignal.notify();
                  }, 0);
                  return {
                    checkpointReason: "assistant_runtime_commit",
                    progressed: true,
                  };
                }
                if (input.foregroundCausalOnly !== true) {
                  return { progressed: false };
                }
                const pendingBeforePhase = (
                  await readHostedSystemMailboxState(activeVaultRoot)
                ).pending;
                if (!pendingBeforePhase.some((item) =>
                  item.itemId === mailboxItem.id
                )) {
                  return await runHostedWorkspaceAssistantPhase(input);
                }
                assert.deepEqual(
                  pendingBeforePhase.map((item) => ({
                    itemId: item.itemId,
                    routeAction: item.routeAction,
                    status: item.status,
                    wakeKind: item.wake.kind,
                  })),
                  [{
                    itemId: mailboxItem.id,
                    routeAction: "apply-member-action",
                    status: "pending",
                    wakeKind: "member.action.requested",
                  }],
                  events.join(","),
                );
                const phaseResult = await runHostedWorkspaceAssistantPhase(input);
                const pendingAfterPhase = (
                  await readHostedSystemMailboxState(activeVaultRoot)
                ).pending;
                assert.deepEqual(
                  pendingAfterPhase.map((item) => ({
                    attemptCount: item.attemptCount,
                    lastErrorCode: item.lastErrorCode,
                    lastErrorMessage: item.lastErrorMessage,
                    postCheckpointKind: item.postCheckpointRecord?.kind ?? null,
                    status: item.status,
                  })),
                  [{
                    attemptCount: 1,
                    lastErrorCode: null,
                    lastErrorMessage: null,
                    postCheckpointKind: "member-action.outcome-recorded",
                    status: "recording",
                  }],
                  events.join(","),
                );
                events.push("member-action:canonical-result-prepared");
                events.push(
                  `assistant.phase-result:${phaseResult.progressed}:`
                    + `${phaseResult.checkpointReason}:`
                    + `${typeof phaseResult.afterCheckpoint}`,
                );
                return phaseResult;
              },
              vaultRoot,
            },
          ),
          5_000,
          () => events.join(","),
        );

        const importEvent = `mailbox.importItem:${mailboxItem.id}`;
        const canonicalResultPreparedIndex = events.indexOf(
          "member-action:canonical-result-prepared",
        );
        assert.notEqual(
          canonicalResultPreparedIndex,
          -1,
          events.join(","),
        );
        assert.ok(
          requireEventIndex(events, importEvent)
            < canonicalResultPreparedIndex,
          events.join(","),
        );
        assert.ok(
          requireEventIndex(events, "member-action:canonical-result-prepared")
            < requireEventIndex(
              events,
              "assistant.phase-result:true:system_mailbox_receipt:function",
            ),
          events.join(","),
        );
        assert.ok(
          requireEventIndex(
            events,
            "assistant.phase-result:true:system_mailbox_receipt:function",
          )
            < requireEventIndex(events, "member-action:outcome-recorded"),
          events.join(","),
        );
        assert.ok(
          requireEventIndex(events, "member-action:outcome-recorded")
            < requireEventIndex(events, "snapshot:idle_shutdown"),
          events.join(","),
        );
        assert.equal(
          mocks.runAssistantAutomationPass.mock.calls.length,
          providerPassCallsBefore,
        );
        assert.equal(recordedOutcomes.length, 1);
        assert.ok(
          result.status === "idle" || result.status === "scheduled",
          result.status,
        );

        if (actionKind === "workout.live.apply") {
          assert.equal(recordedOutcomes[0]?.status, "applied");
          assert.ok(workoutId);
          const refreshedCard = await readLiveWorkoutCardEditor({
            presentation: embeddedWorkout,
            vault: activeVaultRoot,
            workoutId,
          });
          assert.deepEqual(
            refreshedCard?.editor.exercises[0]?.sets[0]?.result,
            { kind: "reps", reps: 9 },
          );
        } else {
          assert.equal(recordedOutcomes[0]?.status, "unchanged");
          assert.equal(
            recordedOutcomes[0]?.result?.kind,
            "workout.live.snapshot",
          );
        }
      } finally {
        await removeTempRoot(vaultRoot);
      }
    });
  }

  test("admits a full visible safe-system prefix before checkpoint despite a later lane high-water", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    let assistantPhaseCalls = 0;
    let mailboxFetchesInFlight = 0;
    let peakMailboxFetchesInFlight = 0;
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);
      const foregroundConversationInputId =
        await stagePendingLinqAssistantInputForMailboxItem({
          item: createMailboxItem({
            id: "mailbox_item_safe_prefix_foreground_conversation",
            laneSeq: "1",
          }),
          threadId: "thread_maximum_safe_prefix",
          vaultRoot,
        });
      const baseMailboxPort = createMailboxPort({
        events,
        fetchRequests,
        items: mailboxItems,
      });
      const mailboxPort: HostedRuntimeMailboxPort = {
        ...baseMailboxPort,
        async fetch(request) {
          mailboxFetchesInFlight += 1;
          peakMailboxFetchesInFlight = Math.max(
            peakMailboxFetchesInFlight,
            mailboxFetchesInFlight,
          );
          try {
            const response = await baseMailboxPort.fetch(request);
            return response;
          } finally {
            mailboxFetchesInFlight -= 1;
          }
        },
      };
      const enqueueMaximumSafePrefix = () => {
        for (let revision = 1; revision <= 51; revision += 1) {
          mailboxItems.push(createMailboxItem({
            id: `mailbox_item_safe_prefix_system_${revision}`,
            kind: revision === 1
              ? "assistant.ask.completed"
              : "runtime.pending-effects-reconcile-requested",
            lane: "system",
            laneSeq: String(revision),
          }));
        }
        mailboxItems.push(createMailboxItem({
          dedupeKey:
            "assistant.notification.requested:generic:safe_prefix_later_row",
          id: "mailbox_item_safe_prefix_later_unsafe",
          kind: "assistant.notification.requested",
          lane: "system",
          laneSeq: "52",
        }));
      };
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_maximum_safe_prefix",
            budget: { maxMailboxItems: 50 },
            idleCheckpointDelayMs: 1_000,
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
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/maximum-safe-prefix.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort,
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
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: foregroundConversationInputId,
                vaultRoot,
              });
              setTimeout(() => {
                enqueueMaximumSafePrefix();
                runtimeWakeSignal.notify();
              }, 0);
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }
            return { progressed: false };
          },
          vaultRoot,
        },
      );
      const result = await withRealTimeout(
        resultPromise,
        5_000,
        () => events.join(","),
      );

      const exactCompletionImport =
        "mailbox.importItem:mailbox_item_safe_prefix_system_1";
      const laterUnsafeImport =
        "mailbox.importItem:mailbox_item_safe_prefix_later_unsafe";
      assert.ok(
        requireEventIndex(events, "assistant.phase:1")
          < requireEventIndex(events, exactCompletionImport),
        events.join(","),
      );
      assert.ok(
        requireEventIndex(events, exactCompletionImport)
          < requireEventIndex(events, "snapshot:idle_shutdown"),
        events.join(","),
      );
      assert.equal(events.includes(laterUnsafeImport), false, events.join(","));
      assert.equal(result.status, "budget_exhausted");
      const preCheckpointFetches = fetchRequests.filter((request) =>
        request.requestId.includes(
          ":checkpoint-interrupt-foreground-prefetch:",
        )
      );
      assert.equal(
        preCheckpointFetches.length,
        1,
        fetchRequests.map((request) =>
          `${request.requestId}:${request.limitPerLane}`
        ).join(","),
      );
      assert.ok(preCheckpointFetches.every((request) => request.limitPerLane === 51));
      assert.equal(
        fetchRequests.length,
        4,
        fetchRequests.map((request) => request.requestId).join(","),
      );

      assert.equal(result.nextWakeReason, "mailbox");
      assert.ok(result.nextWakeAt);
      assert.equal(peakMailboxFetchesInFlight, 1);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  for (const completion of [
    {
      dedupeKey: "member.activated:initial-owner-synthetic",
      kind: "member.activated",
      label: "member activation",
      preCheckpointSafe: true,
      conversationPrefixCount: 1,
    },
    {
      dedupeKey: "member.activated:full-prefetch-synthetic",
      kind: "member.activated",
      label: "member activation with a full conversation prefetch",
      preCheckpointSafe: true,
      conversationPrefixCount: 52,
    },
    {
      dedupeKey: "member.activated:prefetch-retry-synthetic",
      kind: "member.activated",
      label: "member activation after an initial prefetch retry",
      preCheckpointSafe: true,
      conversationPrefixCount: 1,
      initialPrefetchFails: true,
    },
    {
      conversationHighWaterAhead: true,
      dedupeKey: "member.activated:consumed-conversation-prefix-synthetic",
      kind: "member.activated",
      label: "member activation after a consumed conversation prefix",
      preCheckpointSafe: true,
    },
    {
      dedupeKey: "member.action.requested:workout-card-synthetic",
      kind: "member.action.requested",
      label: "workout-card member action",
      preCheckpointSafe: true,
    },
    {
      dedupeKey: "member.action.requested:workout-card-before-unsafe-synthetic",
      followedByUnsafeSystemItem: true,
      kind: "member.action.requested",
      label: "workout-card member action with a later unsafe system item",
      preCheckpointSafe: false,
    },
    {
      dedupeKey:
        "assistant.notification.requested:phone-call-result:phone_call_synthetic",
      kind: "assistant.notification.requested",
      label: "phone-call result",
      preCheckpointSafe: true,
    },
    {
      dedupeKey:
        "assistant.notification.requested:usage-referral-reward:referral_synthetic",
      kind: "assistant.notification.requested",
      label: "usage-referral reward",
      preCheckpointSafe: true,
    },
    {
      dedupeKey: "aask_done_private_synthetic",
      kind: "assistant.notification.requested",
      label: "legacy private Assistant Ask completion",
      preCheckpointSafe: true,
    },
    {
      dedupeKey: "aask_private_synthetic",
      kind: "assistant.notification.requested",
      label: "current private Assistant Ask completion",
      preCheckpointSafe: true,
    },
    {
      dedupeKey:
        "assistant.notification.requested:generic:notification_synthetic",
      kind: "assistant.notification.requested",
      label: "generic notification",
      preCheckpointSafe: false,
    },
  ] as const) {
    test(`${completion.preCheckpointSafe ? "runs" : "keeps"} a ${
      completion.label
    } ${completion.preCheckpointSafe ? "before" : "behind"} the dirty idle checkpoint`, async () => {
      const vaultRoot = await mkdtemp(
        path.join(tmpdir(), "murph-workspace-entrypoint-"),
      );
      const events: string[] = [];
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const mailboxItems: HostedMailboxItem[] = [];
      const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
      let assistantPhaseCalls = 0;

      try {
        const initialPrefetchFails = "initialPrefetchFails" in completion
          && completion.initialPrefetchFails === true;
        if (!initialPrefetchFails) {
          await initializeVault({ createdAt: TEST_NOW, vaultRoot });
          await ensureHostedBootstrapMetadataForSystemMailboxTest(vaultRoot);
        }
        const conversationPrefixCount = "conversationPrefixCount" in completion
          ? completion.conversationPrefixCount ?? 0
          : 0;
        const withConversationPrefix = conversationPrefixCount > 0;
        const conversationHighWaterAhead =
          "conversationHighWaterAhead" in completion
          && completion.conversationHighWaterAhead;
        if (withConversationPrefix) {
          mailboxItems.push(
            ...Array.from({ length: conversationPrefixCount }, (_, index) =>
              createMailboxItem({
                id:
                  `mailbox_item_entrypoint_external_completion_conversation_${index + 1}`,
                kind: "conversation.message",
                lane: "conversation",
                laneSeq: String(index + 1),
              })
            ),
            createMailboxItem({
              dedupeKey: completion.dedupeKey,
              id: "mailbox_item_entrypoint_external_completion",
              kind: completion.kind,
              lane: "system",
              laneSeq: "1",
            }),
          );
        }
        const baseMailboxPort = createMailboxPort({
          events,
          items: mailboxItems,
        });
        let initialPrefetchFailureCount = 0;
        const mailboxPort: HostedRuntimeMailboxPort = {
          ...baseMailboxPort,
          async fetch(request) {
            if (initialPrefetchFails && initialPrefetchFailureCount === 0) {
              initialPrefetchFailureCount += 1;
              events.push("mailbox.fetch:initial-prefetch-failed");
              throw new Error("Synthetic initial mailbox prefetch failure.");
            }
            const response = await baseMailboxPort.fetch(request);
            if (
              !conversationHighWaterAhead
              || !mailboxItems.some((item) => item.lane === "system")
            ) {
              return response;
            }
            return {
              ...response,
              maxSeqByLane: response.maxSeqByLane.map((entry) =>
                entry.lane === "conversation"
                  ? { ...entry, maxSeq: "1" }
                  : entry
              ),
            };
          },
        };
        const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: `attempt_synthetic_external_completion_${
                completion.preCheckpointSafe ? "safe" : "gated"
              }`,
              idleCheckpointDelayMs: 200,
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
                  key:
                    "users/bundles/member-synthetic/"
                    + "external-completion-dirty-wake.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox.importItem:${item.item.id}`);
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort,
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({
                  ...(initialPrefetchFails
                    ? {
                        snapshotRef: createWorkspaceSnapshotV2Ref(
                          "external-completion-prefetch-retry",
                        ),
                      }
                    : {}),
                  version: "0",
                }),
              }),
              ...(initialPrefetchFails
                ? {
                    workspaceSnapshotPort: {
                      async abortSnapshotSession() {
                        throw new Error("Prefetch retry should not abort snapshots.");
                      },
                      async completeSnapshotSession() {
                        throw new Error("Prefetch retry should not complete snapshots.");
                      },
                      async putSnapshotObjectDirect() {
                        throw new Error("Prefetch retry should not upload snapshots.");
                      },
                      async restoreWorkspaceSnapshot(input) {
                        await initializeVault({
                          createdAt: TEST_NOW,
                          vaultRoot: input.durableRoot,
                        });
                        await ensureHostedBootstrapMetadataForSystemMailboxTest(
                          input.durableRoot,
                        );
                      },
                      async startSnapshotSession() {
                        throw new Error("Prefetch retry should not start snapshots.");
                      },
                    },
                  }
                : {}),
            }),
            runtimeWakeSignal,
            async runAssistantPhase() {
              assistantPhaseCalls += 1;
              if (assistantPhaseCalls === 1 && !withConversationPrefix) {
                setTimeout(() => {
                  mailboxItems.push(createMailboxItem({
                    dedupeKey: completion.dedupeKey,
                    id: "mailbox_item_entrypoint_external_completion",
                    kind: completion.kind,
                    lane: "system",
                    laneSeq: "1",
                  }));
                  if (
                    "followedByUnsafeSystemItem" in completion
                    && completion.followedByUnsafeSystemItem === true
                  ) {
                    mailboxItems.push(createMailboxItem({
                      dedupeKey:
                        "assistant.notification.requested:generic:"
                        + "member_action_later_unsafe",
                      id:
                        "mailbox_item_entrypoint_external_completion_"
                        + "later_unsafe",
                      kind: "assistant.notification.requested",
                      lane: "system",
                      laneSeq: "2",
                    }));
                  }
                  runtimeWakeSignal.notify();
                }, 0);
                return {
                  checkpointReason: "assistant_runtime_commit",
                  progressed: true,
                };
              }
              return { progressed: false };
            },
            vaultRoot,
          },
        );

        const result = await withRealTimeout(
          resultPromise,
          2_000,
          () => events.join(","),
        );
        const importIndex = requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_external_completion",
        );
        const idleCheckpointIndex = requireEventIndex(
          events,
          "snapshot:idle_shutdown",
        );

        if (completion.preCheckpointSafe) {
          assert.ok(importIndex < idleCheckpointIndex, events.join(","));
        } else {
          assert.ok(idleCheckpointIndex < importIndex, events.join(","));
        }
        assert.equal(
          result.status,
          conversationHighWaterAhead
            || (withConversationPrefix && !initialPrefetchFails)
            ? "scheduled"
            : "idle",
        );
        assert.equal(
          initialPrefetchFailureCount,
          initialPrefetchFails ? 1 : 0,
        );
      } finally {
        await removeTempRoot(vaultRoot);
      }
    });
  }

  const externalCompletionDeliveryScenarios = [
    {
      dedupeKey:
        "assistant.notification.requested:phone-call-result:phone_call_real_path:generation:1",
      label: "generation-scoped phone-call result",
      privateCompletion: false,
    },
    {
      dedupeKey:
        "assistant.notification.requested:phone-call-result:phone_call_manual_real_path",
      label: "generationless manual phone-call result",
      privateCompletion: false,
    },
    {
      dedupeKey:
        "assistant.notification.requested:usage-referral-reward:referral_real_path",
      label: "usage-referral reward",
      privateCompletion: false,
    },
    {
      dedupeKey: `aask_done_${"b".repeat(64)}`,
      label: "legacy private Assistant Ask completion",
      privateCompletion: true,
    },
    {
      dedupeKey: `aask_private_${"b".repeat(64)}`,
      label: "current private Assistant Ask completion",
      privateCompletion: true,
    },
  ].flatMap((completion) =>
    ([
      {
        channel: "linq" as const,
        identityId: "hbidx:phone:v1:test",
        label: "Linq",
        target: "linq_source_thread",
        threadIsDirect: false,
      },
      {
        channel: "telegram" as const,
        identityId: "telegram-bot",
        label: "Telegram",
        target: "123456789",
        threadIsDirect: true,
      },
    ] as const).map((transport) => ({ completion, transport }))
  );
  for (const {
    completion,
    transport,
  } of externalCompletionDeliveryScenarios) {
    test(`${transport.label} handles a ${completion.label} through the real causal mailbox and outbox boundary`, async () => {
      const vaultRoot = await mkdtemp(
        path.join(tmpdir(), "murph-workspace-entrypoint-"),
      );
      const events: string[] = [];
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const logRequests: HostedRuntimeLogRequest[] = [];
      const mailboxItems: HostedMailboxItem[] = [];
      const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
      const privateAskExecutionRelease = createDeferred<void>();
      const privateProductionDelayShutdown = new AbortController();
      const deliveryKey = completion.privateCompletion
        ? `assistant-ask-private:${completion.dedupeKey}`
        : completion.dedupeKey.replace(
            "assistant.notification.requested:",
            "",
          );
      const telegramPhoneResultHasPendingInput =
        completion.label === "generation-scoped phone-call result"
        && transport.channel === "telegram";
      const completionRetriesOnce =
        completion.label === "usage-referral reward"
        && transport.channel === "linq";
      const requestId = `aask_req_${"a".repeat(64)}`;
      let activeVaultRoot = vaultRoot;
      let assistantPhaseCalls = 0;
      let completionAuthorityAttempts = 0;
      let completionProcessedPassObserved = false;
      let currentPhaseIsForegroundCausal = false;
      let phaseNow = TEST_NOW;
      let newerPendingInputId: string | null = null;
      let providerDispatchWasForegroundCausal: boolean | null = null;
      const providerFetch = vi.fn<typeof fetch>(async (request, init) => {
        const method =
          init?.method
          ?? (request instanceof Request ? request.method : "GET");
        const url =
          request instanceof Request
            ? request.url
            : String(request);
        if (
          method === "POST"
          && (
            (transport.channel === "linq" && url.includes("/messages"))
            || (transport.channel === "telegram" && url.endsWith("/sendMessage"))
          )
        ) {
          providerDispatchWasForegroundCausal =
            currentPhaseIsForegroundCausal;
          events.push(`provider.send:${deliveryKey}`);
          if (transport.channel === "telegram") {
            return new Response(
              JSON.stringify({
                ok: true,
                result: {
                  message_id: 123,
                },
              }),
              {
                headers: { "content-type": "application/json" },
                status: 200,
              },
            );
          }
          return new Response(
            JSON.stringify({
              message: {
                id: `provider_${deliveryKey.replaceAll(":", "_")}`,
              },
            }),
            {
              headers: { "content-type": "application/json" },
              status: 200,
            },
          );
        }
        return new Response(null, { status: 204 });
      });
      if (completion.privateCompletion) {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(TEST_NOW));
        mailboxItems.push(createMailboxItem({
          dedupeKey: requestId,
          expiresAt: "2026-04-27T00:10:00.000Z",
          id: requestId,
          kind: "assistant.ask.requested",
          lane: "system",
          laneSeq: "1",
        }));
        mocks.executeConsentedReadOnlyAssistantAsk.mockImplementationOnce(
          async () => {
            await privateAskExecutionRelease.promise;
            return {
              answer: "Mission complete.",
              outcome: "answered" as const,
            };
          },
        );
      }

      try {
        await initializeVault({ createdAt: TEST_NOW, vaultRoot });
        const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            forwardedEnv: {
              LINQ_API_TOKEN: "synthetic-linq-token",
            },
            platformEnv: {
              TELEGRAM_BOT_TOKEN: "synthetic-telegram-token",
            },
            resolvedConfig: {
              channelCapabilities: {
                emailSendReady: false,
                telegramBotConfigured: true,
              },
              deviceSync: null,
              managedAutoReplyChannels: [
                {
                  capabilityReady: true,
                  channel: "linq",
                  memberChannel: "linq",
                },
                {
                  capabilityReady: true,
                  channel: "telegram",
                  memberChannel: "telegram",
                },
              ],
            },
            request: {
              attemptId:
                `attempt_synthetic_external_completion_real_${
                  completion.privateCompletion
                    ? "private"
                    : completion.label === "generation-scoped phone-call result"
                      ? "phone"
                      : "referral"
                }_${transport.channel}`,
              idleCheckpointDelayMs:
                completion.privateCompletion && transport.channel === "linq"
                  ? 180_000
                  : 200,
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
                  hash:
                    snapshotInput.reason === "idle_shutdown"
                      ? "e".repeat(64)
                      : "d".repeat(64),
                  key:
                    "users/bundles/member-synthetic/"
                    + `${completion.label.replaceAll(" ", "-")}-${transport.channel}-real-path.bundle.json`,
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox.importItem:${item.item.id}`);
              if (item.item.kind === "conversation.message") {
                return {
                  assistantInputId: await stageAssistantInputEventForMailboxItem({
                    channel: "telegram",
                    item: item.item,
                    threadId: transport.target,
                    vaultRoot: activeVaultRoot,
                  }),
                  status: "imported",
                };
              }
              if (item.item.kind === "assistant.ask.requested") {
                return await enqueueHostedSystemMailboxItem({
                  item,
                  vaultRoot: activeVaultRoot,
                  wake: createPrivateCurrentSenderAssistantAskRequestedWake({
                    eventId: requestId,
                  }),
                });
              }
              const outcome = await enqueueHostedSystemMailboxItem({
                item,
                vaultRoot: activeVaultRoot,
                wake: buildHostedExecutionAssistantNotificationRequestedWake({
                  eventId: completion.dedupeKey,
                  memberId: TEST_USER_ID,
                  notification: {
                    deliveryDispatchMode: "queue-only",
                    deliveryDedupeToken: deliveryKey,
                    deliveryIdempotencyKey: deliveryKey,
                    ...((
                      transport.channel === "linq"
                      && !completion.privateCompletion
                    ) || telegramPhoneResultHasPendingInput
                      ? {
                          externalThreadRouteAuthority: {
                            ...(transport.channel === "linq"
                              ? { accountLookupKey: "linq-account-key" }
                              : {}),
                            channel: transport.channel,
                            containerMemberId: TEST_USER_ID,
                            threadId: transport.target,
                          },
                        }
                      : {}),
                    instructions: "Send the fixed completion text.",
                    ...(completion.privateCompletion
                      ? {
                          privateAssistantAskCompletion: {
                            expiresAt: "2026-04-27T00:10:00.000Z",
                            requestId,
                          },
                        }
                      : {}),
                    responsePolicy: {
                      kind: "require_send_exact_text",
                      text: "Mission complete.",
                    },
                    route: {
                      actorId: null,
                      channel: transport.channel,
                      delivery: {
                        kind: "thread",
                        target: transport.target,
                      },
                      identityId: transport.identityId,
                      threadId: transport.target,
                      threadIsDirect:
                        completion.privateCompletion
                        || transport.threadIsDirect,
                    },
                  },
                  occurredAt: TEST_NOW,
                }),
              });
              return outcome;
            },
            platform: {
              ...createPlatform({
                assistantAskPort: completion.privateCompletion
                  ? {
                      async request(request) {
                        if (request.action === "prepare") {
                          events.push("ask.prepare");
                          return {
                            action: "prepare",
                            disclosure: {
                              permissionText:
                                HOSTED_EXECUTION_CURRENT_SENDER_PRIVATE_PERMISSION_TEXT,
                            },
                            question: "What is my shoulder-safe workout?",
                            status: "ready",
                            targetLabel: null,
                          };
                        }
                        assert.deepEqual(request.result, {
                          answer: "Mission complete.",
                          outcome: "answered",
                        });
                        events.push("ask.complete");
                        if (!mailboxItems.some((item) =>
                          item.dedupeKey === completion.dedupeKey
                        )) {
                          mailboxItems.push(createMailboxItem({
                            dedupeKey: completion.dedupeKey,
                            expiresAt: "2026-04-27T00:10:00.000Z",
                            id: completion.dedupeKey,
                            kind: "assistant.notification.requested",
                            lane: "system",
                            laneSeq: "2",
                          }));
                        }
                        runtimeWakeSignal.notify();
                        return { action: "complete", status: "completed" };
                      },
                    }
                  : null,
                mailboxPort: createMailboxPort({
                  events,
                  items: mailboxItems,
                }),
                logRequests,
                workspacePort: createWorkspacePort({
                  checkpointRequests,
                  events,
                  checkpointWorkspace(request) {
                    return createWorkspaceState({
                      inboxMediaRetentionWakeAt:
                        request.inboxMediaRetentionWakeAt ?? null,
                      nextWakeAt: request.nextWakeAt ?? null,
                      nextWakeReason: request.nextWakeReason ?? null,
                      redactedStatus: request.redactedStatus ?? null,
                      snapshotRef: request.snapshotRef,
                      version: String(
                        BigInt(request.expectedWorkspaceVersion) + 1n,
                      ),
                    });
                  },
                  workspace: createWorkspaceState({ version: "0" }),
                }),
              }),
              effectsPort: {
                async assertAssistantAskPrivateCompletionAuthority(authority) {
                  assert.equal(
                    authority.answeredMailboxItemIds[0],
                    completion.dedupeKey,
                  );
                  assert.equal(authority.idempotencyKey, deliveryKey);
                  events.push(`authority.private:${completion.dedupeKey}`);
                },
                async assertExternalThreadRouteAuthority(authority) {
                  assert.equal(completion.privateCompletion, false);
                  assert.equal(authority.threadId, transport.target);
                  completionAuthorityAttempts += 1;
                  if (
                    completionRetriesOnce
                    && completionAuthorityAttempts === 1
                  ) {
                    throw new Error("Synthetic retryable completion failure.");
                  }
                },
                async assertLinqRecentInboundEngagement(request) {
                  assert.equal(request.target, transport.target);
                  return {
                    providerDispatchClaimed: true,
                    resolvedRoute: {
                      conversationThreadId: null,
                      directRecipientPhoneNumber: null,
                      fromPhoneNumber: null,
                      target: transport.target,
                      targetKind: "thread",
                      threadIsDirect: transport.threadIsDirect,
                    },
                  };
                },
                async readRawEmailMessage() {
                  return null;
                },
                async recordLinqDeliveryOutcome(request) {
                  events.push(
                    `provider.record:${request.providerThreadId ?? request.target}`,
                  );
                },
                async recordPhoneCallResultDeliveryOutcome(request) {
                  assert.equal(
                    completion.label,
                    "generation-scoped phone-call result",
                  );
                  assert.equal(request.generation, 1);
                  assert.equal(request.phoneCallId, "phone_call_real_path");
                  events.push(`phone-result.outcome:${request.status}`);
                },
                async sendEmail() {},
              },
              providerFetch,
            },
            runtimeWakeSignal,
            ...(completion.privateCompletion && transport.channel === "linq"
              ? { shutdownSignal: privateProductionDelayShutdown.signal }
              : {}),
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              currentPhaseIsForegroundCausal =
                input.foregroundCausalOnly === true;
              events.push(`assistant.phase:${assistantPhaseCalls}`);
              if (assistantPhaseCalls === 1) {
                activeVaultRoot = input.restored.vaultRoot;
                if (completion.privateCompletion) {
                  REAL_SET_TIMEOUT(() => {
                    privateAskExecutionRelease.resolve();
                  }, 100);
                }
                await prepareHostedWakeContext(
                  activeVaultRoot,
                  buildHostedExecutionMemberActivatedWake({
                    eventId: "member.activated:external-completion-real-path",
                    memberChannels: {
                      email: false,
                      linq: transport.channel === "linq",
                      telegram: transport.channel === "telegram",
                    },
                    memberId: TEST_USER_ID,
                    occurredAt: TEST_NOW,
                    timeZone: "UTC",
                  }),
                  input.runtimeEnv,
                  input.runtime.resolvedConfig,
                  {
                    operatorHomeRoot: input.restored.operatorHomeRoot,
                  },
                );
                if (telegramPhoneResultHasPendingInput) {
                  newerPendingInputId =
                    await stagePendingLinqAssistantInputForMailboxItem({
                      item: createMailboxItem({
                        createdAt: "2026-04-27T00:00:01.000Z",
                        id: "mailbox_item_phone_result_newer_input",
                        laneSeq: "1",
                        occurredAt: "2026-04-27T00:00:01.000Z",
                        updatedAt: "2026-04-27T00:00:01.000Z",
                      }),
                      threadId: "thread_phone_result_newer_input",
                      vaultRoot: activeVaultRoot,
                    });
                  events.push("assistant.input:newer-accepted");
                }
                if (!completion.privateCompletion) {
                  setTimeout(() => {
                    mailboxItems.push(createMailboxItem({
                      dedupeKey: completion.dedupeKey,
                      id: `mailbox_item_${deliveryKey.replaceAll(":", "_")}`,
                      kind: "assistant.notification.requested",
                      lane: "system",
                      laneSeq: "1",
                    }));
                    runtimeWakeSignal.notify();
                  }, 0);
                }
                return {
                  checkpointReason: "assistant_runtime_commit",
                  progressed: true,
                };
              }
              const externalCompletionPhase = 2;
              if (assistantPhaseCalls === externalCompletionPhase) {
                assert.equal(input.foregroundCausalOnly, true);
              }
              if (assistantPhaseCalls === externalCompletionPhase) {
                const pendingSystemMailbox =
                  (await readHostedSystemMailboxState(activeVaultRoot)).pending;
                assert.deepEqual(
                  pendingSystemMailbox.map((item) => ({
                    mailboxDedupeKey: item.mailboxDedupeKey,
                    routeAction: item.routeAction,
                    wakeKind: item.wake.kind,
                  })),
                  [{
                    mailboxDedupeKey: completion.dedupeKey,
                    routeAction: "dispatch-assistant-notification",
                    wakeKind: "assistant.notification.requested",
                  }],
                  events.join(","),
                );
                const pendingAssistantInputWakeAt =
                  await resolveHostedPendingAssistantInputWakeAt({
                    vaultRoot: activeVaultRoot,
                  });
                if (telegramPhoneResultHasPendingInput) {
                  assert.ok(pendingAssistantInputWakeAt);
                } else {
                  assert.equal(pendingAssistantInputWakeAt, null);
                }
              }
              if (
                telegramPhoneResultHasPendingInput
                && assistantPhaseCalls > 2
                && input.foregroundCausalOnly === true
              ) {
                assert.ok(newerPendingInputId);
                events.push("assistant.input:newer-lane-admitted");
                await writeSyntheticAssistantAutoReplyTerminalEvidence({
                  inputId: newerPendingInputId,
                  vaultRoot: activeVaultRoot,
                });
              }
              const phaseResult = await runHostedWorkspaceAssistantPhase({
                ...input,
                ...(completionRetriesOnce ? { now: () => phaseNow } : {}),
              });
              if (
                phaseResult.redactedStatus
                  ?.hostedSystemMailboxRetryableFailed === 1
              ) {
                assert.equal(completionRetriesOnce, true);
                assert.equal(
                  phaseResult.foregroundPrioritySystemCompletionProcessed,
                  undefined,
                );
                phaseNow = new Date(
                  Date.parse(phaseNow) + 60_000,
                ).toISOString();
                runtimeWakeSignal.notify(Date.parse(phaseNow));
              }
              if (
                phaseResult.foregroundPrioritySystemCompletionProcessed === true
              ) {
                completionProcessedPassObserved = true;
              }
              if (
                telegramPhoneResultHasPendingInput
                && assistantPhaseCalls === 2
              ) {
                events.push(
                  `runtime.checkpoint-prepared:${phaseResult.checkpointReason}`,
                );
              }
              const outboxIntents =
                await listAssistantOutboxIntents(activeVaultRoot);
              const completionIntent = outboxIntents.find((intent) =>
                intent.deliveryIdempotencyKey === deliveryKey
              );
              if (completionIntent) {
                events.push(
                  `outbox.completion.after-phase:${completionIntent.status}`,
                );
              }
              const outboxStatuses = outboxIntents.map((intent) => intent.status);
              events.push(
                `outbox.after-phase:${outboxStatuses.join("|")}`,
              );
              if (
                completion.privateCompletion
                && transport.channel === "linq"
                && outboxStatuses.includes("sent")
              ) {
                privateProductionDelayShutdown.abort(
                  new Error("Stop after production-delay private delivery."),
                );
              }
              return phaseResult;
            },
            vaultRoot,
          },
        );

        const result = await withRealTimeout(
          resultPromise,
          15_000,
          () => events.join(","),
        );
        const providerEvent = `provider.send:${deliveryKey}`;
        if (completion.privateCompletion) {
          const consentedAskInput =
            mocks.executeConsentedReadOnlyAssistantAsk.mock.calls.at(-1)?.[0];
          assert.equal(consentedAskInput?.answerMode, "direct_recipient");
          assert.ok(
            requireEventIndex(events, "ask.complete")
              < requireEventIndex(
                events,
                `mailbox.importItem:${completion.dedupeKey}`,
              ),
            events.join(","),
          );
          assert.equal(
            events.filter((event) =>
              event === `authority.private:${completion.dedupeKey}`
            ).length,
            2,
            events.join(","),
          );
          assert.ok(
            requireEventIndex(
              events,
              `authority.private:${completion.dedupeKey}`,
            ) < requireEventIndex(events, providerEvent),
            events.join(","),
          );
        }

        if (transport.channel === "telegram") {
          const finalIntents = await listAssistantOutboxIntents(activeVaultRoot);
          const telegramDiagnostics = JSON.stringify(
            finalIntents.map((intent) => ({
              lastErrorCode: intent.lastError?.code ?? null,
              status: intent.status,
            })),
          );
          assert.equal(
            events.filter((event) => event === providerEvent).length,
            1,
            `${events.join(",")};${telegramDiagnostics}`,
          );
          assert.equal(providerDispatchWasForegroundCausal, false);
          if (telegramPhoneResultHasPendingInput) {
            assert.ok(newerPendingInputId);
            assert.ok(
              requireEventIndex(events, "assistant.input:newer-lane-admitted")
                < requireEventIndex(events, providerEvent),
              events.join(","),
            );
            assert.ok(
              requireEventIndex(events, "phone-result.outcome:sending")
                < requireEventIndex(events, providerEvent),
              events.join(","),
            );
            assert.ok(
              requireEventIndex(events, providerEvent)
                < requireEventIndex(events, "phone-result.outcome:sent"),
              events.join(","),
            );
          } else {
            assert.ok(
              requireEventIndex(events, "outbox.after-phase:pending")
                < requireEventIndex(events, "snapshot:idle_shutdown"),
              events.join(","),
            );
            assert.ok(
              requireEventIndex(events, "snapshot:idle_shutdown")
                < requireEventIndex(events, providerEvent),
              events.join(","),
            );
          }
          assert.equal(finalIntents[0]?.status, "sent");
          assert.ok(assistantPhaseCalls >= 3);
          return;
        }

        assert.equal(providerDispatchWasForegroundCausal, true);
        assert.equal(
          events.filter((event) => event === providerEvent).length,
          1,
          events.join(","),
        );
        assert.equal(completionProcessedPassObserved, true, events.join(","));
        assert.ok(
          requireEventIndex(events, "outbox.completion.after-phase:sending")
            < requireEventIndex(events, providerEvent),
          events.join(","),
        );
        assert.ok(
          requireEventIndex(events, providerEvent)
            < requireEventIndex(events, "outbox.completion.after-phase:sent"),
          events.join(","),
        );
        assert.ok(
          requireEventIndex(events, providerEvent)
            < requireEventIndex(events, "snapshot:idle_shutdown"),
          events.join(","),
        );
        assert.ok(assistantPhaseCalls >= 3);
      } finally {
        privateAskExecutionRelease.resolve();
        privateProductionDelayShutdown.abort(new Error("Test cleanup."));
        if (completion.privateCompletion) {
          vi.useRealTimers();
        }
        await removeTempRoot(vaultRoot);
      }
    });
  }

  test("runs an imported private completion before checkpoint despite a newer unrelated system prefix", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-workspace-entrypoint-"),
    );
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const completionDedupeKey = `aask_done_${"c".repeat(64)}`;
    const completionItem = createMailboxItem({
      dedupeKey: completionDedupeKey,
      id: "mailbox_item_private_completion_imported",
      kind: "assistant.notification.requested",
      lane: "system",
      laneSeq: "1",
    });
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const enqueueCompletion = async () => {
        await enqueueHostedSystemMailboxItem({
          item: {
            item: completionItem,
            payload: {
              payloadCiphertext: "ciphertext",
              payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
              requestId: "request_private_completion_imported",
              source: "inline",
              status: "resolved",
            },
            route: {
              action: "dispatch-assistant-notification",
              advanceProgress: true,
              itemRef: {
                id: completionItem.id,
                kind: completionItem.kind,
                lane: completionItem.lane,
                laneSeq: completionItem.laneSeq,
              },
              state: "route",
            },
          },
          vaultRoot,
          wake: buildHostedExecutionAssistantNotificationRequestedWake({
            eventId: completionDedupeKey,
            memberId: TEST_USER_ID,
            notification: {
              deliveryDispatchMode: "queue-only",
              deliveryDedupeToken: `assistant-ask-private:${completionDedupeKey}`,
              deliveryIdempotencyKey:
                `assistant-ask-private:${completionDedupeKey}`,
              instructions: "Send the fixed completion text.",
              privateAssistantAskCompletion: {
                expiresAt: "2026-04-27T00:10:00.000Z",
                requestId: `aask_req_${"d".repeat(64)}`,
              },
              responsePolicy: {
                kind: "require_send_exact_text",
                text: "Mission complete.",
              },
              route: {
                actorId: null,
                channel: "linq",
                delivery: {
                  kind: "thread",
                  target: "+15555550123",
                },
                identityId: "linq_identity_private_completion_imported",
                threadId: "+15555550123",
                threadIsDirect: true,
              },
            },
            occurredAt: TEST_NOW,
          }),
        });
      };

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_private_completion_mixed_system_prefix",
              idleCheckpointDelayMs: 50,
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
                  hash: "c".repeat(64),
                  key:
                    "users/bundles/member-synthetic/"
                    + "private-completion-mixed-system-prefix.bundle.json",
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
              events.push(`assistant.phase:${assistantPhaseCalls}`);
              if (assistantPhaseCalls === 1) {
                await enqueueCompletion();
                // The completion is already local when newer unrelated remote
                // system work wakes the dirty pre-checkpoint pass.
                setTimeout(() => {
                  mailboxItems.push(createMailboxItem({
                    dedupeKey:
                      "assistant.notification.requested:generic:"
                      + "private_completion_later_generic",
                    id: "mailbox_item_private_completion_later_generic",
                    kind: "assistant.notification.requested",
                    lane: "system",
                    laneSeq: "1",
                  }));
                  runtimeWakeSignal.notify();
                }, 0);
                return {
                  checkpointReason: "assistant_runtime_commit",
                  progressed: true,
                };
              }
              if (assistantPhaseCalls === 2) {
                assert.equal(input.foregroundCausalOnly, true);
              }
              return { progressed: false };
            },
            vaultRoot,
          },
        ),
        3_000,
        () => events.join(","),
      );

      assert.ok(
        requireEventIndex(events, "assistant.phase:2")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
        events.join(","),
      );
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runs a joined-group completion before the dirty idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), "murph-workspace-entrypoint-"),
    );
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const foregroundCausalOnlyValues: boolean[] = [];
    const activeTurnCompletionImportObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_assistant_ask_completion_dirty_wake",
            idleCheckpointDelayMs: 500,
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
                hash: "e".repeat(64),
                key:
                  "users/bundles/member-synthetic/"
                  + "assistant-ask-completion-dirty-wake.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            assert.equal(item.route.action, "continue-assistant-ask");
            assert.equal(
              "assistantAskCompletionKind" in (context ?? {}),
              false,
            );
            events.push(`mailbox.importItem:${item.item.id}`);
            if (
              item.item.id
              === "mailbox_item_entrypoint_assistant_ask_completion_active_turn"
            ) {
              activeTurnCompletionImportObserved.resolve();
            }
            return { status: "imported" };
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
            foregroundCausalOnlyValues.push(
              input.foregroundCausalOnly === true,
            );
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              setTimeout(() => {
                mailboxItems.push(createMailboxItem({
                  id: "mailbox_item_entrypoint_assistant_ask_completion",
                  kind: "assistant.ask.completed",
                  lane: "system",
                  laneSeq: "1",
                }));
                runtimeWakeSignal.notify();
              }, 0);
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }
            if (assistantPhaseCalls === 2) {
              setTimeout(() => {
                mailboxItems.push(createMailboxItem({
                  id:
                    "mailbox_item_entrypoint_"
                    + "assistant_ask_completion_active_turn",
                  kind: "assistant.ask.completed",
                  lane: "system",
                  laneSeq: "2",
                }));
                runtimeWakeSignal.notify();
              }, 0);
              await withRealTimeout(
                activeTurnCompletionImportObserved.promise,
                2_000,
                () => events.join(","),
              );
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }
            if (assistantPhaseCalls === 3) {
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      const result = await withRealTimeout(
        resultPromise,
        2_000,
        () => events.join(","),
      );

      assert.equal(assistantPhaseCalls, 4);
      assert.deepEqual(
        foregroundCausalOnlyValues,
        [false, true, true, true],
      );
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_assistant_ask_completion",
        ) < requireEventIndex(events, "snapshot:idle_shutdown"),
        events.join(","),
      );
      assert.ok(
        requireEventIndex(events, "assistant.phase:3")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
        events.join(","),
      );
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:"
            + "mailbox_item_entrypoint_assistant_ask_completion_active_turn",
        ) < requireEventIndex(events, "snapshot:idle_shutdown"),
        events.join(","),
      );
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runs a late imported approval through the causal system owner before idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const foregroundCausalOnlyValues: boolean[] = [];
    const approvalImportObserved = createDeferred<void>();
    const effectId = "effect_late_imported_approval";
    const approvalItem = createMailboxItem({
      dedupeKey: `runtime.pending-effects-reconcile-requested:${effectId}`,
      id: "mailbox_item_late_imported_approval",
      kind: "runtime.pending-effects-reconcile-requested",
      lane: "system",
      laneSeq: "1",
    });
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const providerFetch = vi.fn<typeof fetch>(async () => {
      throw new Error("Late approval continuation must not enter a provider request.");
    });
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      mocks.collectHostedAssistantDeliverySideEffects.mockClear();
      mocks.drainHostedPreparedAssistantDeliveries.mockClear();
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockClear();
      mocks.collectHostedAssistantDeliverySideEffects.mockImplementation(
        async (input) => {
          if (input.preferredEffectIds?.[0] !== effectId) {
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
              message: "Synthetic approved attachment",
              replyToMessageId: null,
              sessionId: "session_late_imported_approval",
              subject: null,
              threadId: null,
              threadIsDirect: true,
              transportIdempotent: true,
              turnId: "turn_late_imported_approval",
            },
          }];
        },
      );
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockResolvedValue({
        preparedDispatches: [],
      });
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementation(async (input) => {
        for (const effect of input.assistantDeliveryEffects) {
          events.push(`approval.delivery:${effect.effectId}`);
        }
        return input.assistantDeliveryEffects.map((effect) => ({
          deliveryChannel: "linq",
          deliveryErrorCode: null,
          deliveryErrorMessage: null,
          deliveryStatus: "sent" as const,
          effectFingerprint: effect.fingerprint,
          effectId: effect.effectId,
          journalMethod: null,
          journalStatus: null,
          providerMessageId: "message_late_imported_approval",
          providerThreadId: null,
          retryable: false,
          target: null,
          targetKind: null,
        }));
      });

      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const platform = {
        ...createPlatform({
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
        providerFetch,
      } satisfies HostedRuntimePlatform;
      const bridgeImporter = createHostedWorkspaceBridgeMailboxImporter({
        decodeMailboxPayload: {
          async decode() {
            return {
              status: "decoded",
              wake: buildHostedExecutionPendingEffectsReconcileRequestedWake({
                effectId,
                eventId: approvalItem.dedupeKey,
                occurredAt: approvalItem.occurredAt,
                userId: TEST_USER_ID,
              }),
            };
          },
        },
        runtime: normalizeHostedAssistantRuntimeConfig({}, platform),
        vaultRoot,
      });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_late_imported_approval",
              idleCheckpointDelayMs: 200,
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
                  key: "users/bundles/member-synthetic/late-imported-approval.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem(item, context) {
              const outcome = await bridgeImporter(item, context);
              assert.equal(Object.hasOwn(outcome, "afterCheckpoint"), false);
              events.push(`approval.import:${outcome.status}`);
              approvalImportObserved.resolve();
              return outcome;
            },
            platform,
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              foregroundCausalOnlyValues.push(input.foregroundCausalOnly === true);
              events.push(`assistant.phase:${assistantPhaseCalls}`);
              if (assistantPhaseCalls === 1) {
                return {
                  afterCheckpoint: async () => {
                    mailboxItems.push(approvalItem);
                    runtimeWakeSignal.notify();
                    await withRealTimeout(
                      approvalImportObserved.promise,
                      2_000,
                      () => events.join(","),
                    );
                  },
                  afterCheckpointKeepsForegroundImportLoop: true,
                  checkpointReason: "assistant_runtime_commit",
                  progressed: true,
                };
              }
              return await runHostedWorkspaceAssistantPhase({
                ...input,
                now: () => TEST_NOW,
              });
            },
            vaultRoot,
          },
        ),
        4_000,
        () => events.join(","),
      );

      assert.ok(assistantPhaseCalls >= 2, events.join(","));
      assert.deepEqual(
        foregroundCausalOnlyValues.slice(0, 2),
        [false, true],
        events.join(","),
      );
      assert.equal(providerFetch.mock.calls.length, 0);
      assert.ok(
        mocks.collectHostedAssistantDeliverySideEffects.mock.calls.some(
          ([input]) => input.preferredEffectIds?.[0] === effectId,
        ),
        events.join(","),
      );
      assert.equal(mocks.drainHostedPreparedAssistantDeliveries.mock.calls.length, 1);
      const idleCheckpointIndex = requireEventIndex(events, "snapshot:idle_shutdown");
      assert.ok(
        requireEventIndex(events, `approval.delivery:${effectId}`)
          < idleCheckpointIndex,
        events.join(","),
      );
      assert.deepEqual(
        (await readHostedSystemMailboxState(vaultRoot)).pending,
        [],
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeReason, "assistant");
      assert.ok(Date.parse(result.nextWakeAt ?? "") > Date.parse(TEST_NOW));
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
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("preserves joined-group ask admission in an active dirty pre-checkpoint pass", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const foregroundCausalOnlyValues: boolean[] = [];
    const activeTurnAskImportObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_assistant_ask_dirty_wake",
            idleCheckpointDelayMs: 500,
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
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/assistant-ask-dirty-wake.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            assert.equal(item.route.action, "run-assistant-ask");
            assert.equal(
              context?.assistantAskRequestTargetKind,
              "joined_group",
            );
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.id === "mailbox_item_entrypoint_assistant_ask_active_turn") {
              activeTurnAskImportObserved.resolve();
            }
            return { status: "imported" };
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
            foregroundCausalOnlyValues.push(input.foregroundCausalOnly === true);
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              setTimeout(() => {
                mailboxItems.push(createMailboxItem({
                  id: "mailbox_item_entrypoint_assistant_ask_dirty_wake",
                  kind: "assistant.ask.requested",
                  lane: "system",
                  laneSeq: "1",
                }));
                runtimeWakeSignal.notify();
              }, 0);
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }
            if (assistantPhaseCalls === 2) {
              setTimeout(() => {
                mailboxItems.push(createMailboxItem({
                  id: "mailbox_item_entrypoint_assistant_ask_active_turn",
                  kind: "assistant.ask.requested",
                  lane: "system",
                  laneSeq: "2",
                }));
                runtimeWakeSignal.notify();
              }, 0);
              await withRealTimeout(
                activeTurnAskImportObserved.promise,
                2_000,
                () => events.join(","),
              );
            }
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      const result = await withRealTimeout(
        resultPromise,
        2_000,
        () => events.join(","),
      );

      assert.equal(assistantPhaseCalls, 2);
      assert.deepEqual(foregroundCausalOnlyValues, [false, true]);
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_assistant_ask_dirty_wake",
        ) < requireEventIndex(events, "snapshot:idle_shutdown"),
        events.join(","),
      );
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_assistant_ask_active_turn",
        ) < requireEventIndex(events, "snapshot:idle_shutdown"),
        events.join(","),
      );
      const idleCheckpointRequests = checkpointRequests.filter(
        (request) => request.reason === "idle_shutdown",
      );
      assert.equal(idleCheckpointRequests.length, 1);
      assert.equal(idleCheckpointRequests[0]?.idleCheckpointTrigger, "idle_window");
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  for (const withConversationWork of [false, true]) {
    test(`keeps a consented-member ask behind the dirty idle checkpoint${
      withConversationWork ? " while conversation work runs" : ""
    }`, async () => {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
      const events: string[] = [];
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const mailboxItems: HostedMailboxItem[] = [];
      const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
      const askItem = createMailboxItem({
        dedupeKey: `ask_event_entrypoint_consented_checkpoint_${
          withConversationWork ? "conversation" : "system"
        }`,
        expiresAt: "2026-04-27T00:10:00.000Z",
        id: `ask_event_entrypoint_consented_checkpoint_${
          withConversationWork ? "conversation" : "system"
        }`,
        kind: "assistant.ask.requested",
        lane: "system",
        laneSeq: "1",
      });
      const consentedWake = createConsentedMemberAssistantAskRequestedWake({
        eventId: askItem.dedupeKey,
      });
      let assistantPhaseCalls = 0;

      try {
        await initializeVault({ createdAt: TEST_NOW, vaultRoot });
        const platform = createPlatform({
          assistantAskPort: {
            async request(request) {
              if (request.action === "prepare") {
                events.push("ask.prepare");
                return {
                  action: "prepare",
                  status: "terminal",
                  terminalReason: "unavailable",
                };
              }
              return { action: "complete", status: "completed" };
            },
          },
          mailboxPort: createMailboxPort({ events, items: mailboxItems }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        });
        const bridgeImporter = createHostedWorkspaceBridgeMailboxImporter({
          decodeMailboxPayload: {
            async decode() {
              return { status: "decoded", wake: consentedWake };
            },
          },
          runtime: normalizeHostedAssistantRuntimeConfig({}, platform),
          vaultRoot,
        });
        const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: `attempt_synthetic_consented_checkpoint_${
                withConversationWork ? "conversation" : "system"
              }`,
              idleCheckpointDelayMs: 200,
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
                  hash: "d".repeat(64),
                  key: "users/bundles/member-synthetic/consented-checkpoint.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem(item, context) {
              if (item.item.lane === "conversation") {
                events.push(`conversation.import:${item.item.id}`);
                return { status: "imported" };
              }
              const outcome = await bridgeImporter(item, context);
              events.push(
                `ask.import:${
                  context?.assistantAskRequestTargetKind ?? "all"
                }:${outcome.status}`,
              );
              return outcome;
            },
            platform,
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              if (assistantPhaseCalls === 1) {
                setTimeout(() => {
                  if (withConversationWork) {
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_consented_checkpoint_conversation",
                      lane: "conversation",
                      laneSeq: "1",
                    }));
                  }
                  mailboxItems.push(askItem);
                  runtimeWakeSignal.notify();
                }, 0);
                return {
                  checkpointReason: "assistant_runtime_commit",
                  progressed: true,
                };
              }
              if (withConversationWork) {
                events.push("auto-reply.prepare");
                await input.prepareAutoReplyDelivery?.();
                events.push("auto-reply.delivered");
              }
              return { progressed: false };
            },
            vaultRoot,
          },
        );

        const result = await withRealTimeout(resultPromise, 4_000, () => events.join(","));

        assert.ok(events.includes("ask.import:joined_group:deferred"), events.join(","));
        const idleSnapshotIndex = requireEventIndex(events, "snapshot:idle_shutdown");
        if (withConversationWork) {
          assert.ok(events.includes("auto-reply.prepare"), events.join(","));
          assert.ok(events.includes("auto-reply.delivered"), events.join(","));
        }
        assert.equal(
          events.slice(0, idleSnapshotIndex).includes("ask.import:all:imported"),
          false,
          events.join(","),
        );
        const askPrepareIndex = events.indexOf("ask.prepare");
        assert.ok(askPrepareIndex === -1 || idleSnapshotIndex < askPrepareIndex, events.join(","));
        assert.equal(
          checkpointRequests.filter((request) => request.reason === "idle_shutdown").length,
          1,
        );
        assert.ok(result.status === "idle" || result.status === "scheduled");
      } finally {
        await removeTempRoot(vaultRoot);
      }
    });
  }

  test("keeps a mixed causal and device prefix gated until after checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    let assistantPhaseCalls = 0;
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_mixed_pending_effects_device_dirty_wake",
            idleCheckpointDelayMs: 200,
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
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/mixed-pending-effects-device.bundle.json",
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
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              setTimeout(() => {
                mailboxItems.push(
                  createMailboxItem({
                    id: "mailbox_item_entrypoint_mixed_device",
                    kind: "device-sync.wake",
                    lane: "system",
                    laneSeq: "1",
                  }),
                  createMailboxItem({
                    id: "mailbox_item_entrypoint_mixed_pending_effects",
                    kind: "runtime.pending-effects-reconcile-requested",
                    lane: "system",
                    laneSeq: "2",
                  }),
                );
                runtimeWakeSignal.notify();
              }, 0);
              return {
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      const result = await withRealTimeout(
        resultPromise,
        2_000,
        () => events.join(","),
      );

      const idleCheckpointIndex = requireEventIndex(events, "snapshot:idle_shutdown");
      assert.ok(
        idleCheckpointIndex < requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_mixed_device",
        ),
        events.join(","),
      );
      assert.ok(
        idleCheckpointIndex < requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_entrypoint_mixed_pending_effects",
        ),
        events.join(","),
      );
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("emits metadata-only phase boundary logs for runtime failures", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hiddenFailureMessage = "hidden prompt transcript failure";
    const hiddenFailureDetail = "hidden mailbox payload detail";

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const runFailure = (
        attemptId: string,
        failure: Error,
      ) => runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Failure phase test should not checkpoint.");
          },
          async importItem() {
            throw new Error("Failure phase test should not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events: [], items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events: [],
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            throw failure;
          },
          vaultRoot,
        },
      );
      const genericFailure = Object.assign(new Error(hiddenFailureMessage), {
        details: {
          payload: hiddenFailureDetail,
        },
      });

      await expect(runFailure(
        "attempt_synthetic_phase_failure",
        genericFailure,
      )).rejects.toBe(genericFailure);
      expect(readHostedRuntimeFailurePhaseCode(genericFailure)).toBe(
        "runtime_phase:foreground.pass",
      );
      expect(genericFailure).not.toHaveProperty("errorCode");

      const codedFailure = Object.assign(new Error("hidden coded runtime failure"), {
        code: "existing_runtime_failure_code",
      });
      expect(deriveHostedExecutionErrorCode(codedFailure)).toBe("runtime_error");
      await expect(runFailure(
        "attempt_synthetic_coded_phase_failure",
        codedFailure,
      )).rejects.toBe(codedFailure);
      expect(codedFailure.code).toBe("existing_runtime_failure_code");
      expect(codedFailure).not.toHaveProperty("errorCode");
      expect(readHostedRuntimeFailurePhaseCode(codedFailure)).toBe(
        "runtime_phase:foreground.pass",
      );

      const nestedCodedFailure = Object.assign(
        new Error("hidden nested-coded runtime failure"),
        {
          cause: Object.assign(new Error("hidden nested cause"), {
            code: "timeout",
          }),
        },
      );
      expect(deriveHostedExecutionErrorCode(nestedCodedFailure)).toBe("timeout");
      await expect(runFailure(
        "attempt_synthetic_nested_coded_phase_failure",
        nestedCodedFailure,
      )).rejects.toBe(nestedCodedFailure);
      expect(nestedCodedFailure).not.toHaveProperty("errorCode");
      expect(deriveHostedExecutionErrorCode(nestedCodedFailure)).toBe("timeout");
      expect(readHostedRuntimeFailurePhaseCode(nestedCodedFailure)).toBeNull();

      const genericCodedFailure = Object.assign(
        new Error("hidden generic-coded runtime failure"),
        { code: "runtime_error" },
      );
      await expect(runFailure(
        "attempt_synthetic_generic_coded_phase_failure",
        genericCodedFailure,
      )).rejects.toBe(genericCodedFailure);
      expect(genericCodedFailure.code).toBe("runtime_error");
      expect(genericCodedFailure).not.toHaveProperty("errorCode");
      expect(readHostedRuntimeFailurePhaseCode(genericCodedFailure)).toBe(
        "runtime_phase:foreground.pass",
      );

      const nestedGenericCodedFailure = new Error(
        "hidden nested generic-coded wrapper",
        {
          cause: Object.assign(new Error("hidden generic-coded cause"), {
            code: "runtime_error",
          }),
        },
      );
      await expect(runFailure(
        "attempt_synthetic_nested_generic_coded_phase_failure",
        nestedGenericCodedFailure,
      )).rejects.toBe(nestedGenericCodedFailure);
      expect(readHostedRuntimeFailurePhaseCode(nestedGenericCodedFailure)).toBe(
        "runtime_phase:foreground.pass",
      );

      const phaseLogs = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_phase_failure",
        spy: consoleError,
      });
      const failureLogs = phaseLogs.filter((entry) =>
        entry.details.runtimePhaseStatus === "fail"
      );
      expect(failureLogs.map((entry) => entry.details.runtimePhase)).toEqual([
        "foreground.pass",
        "runtime",
      ]);
      for (const entry of failureLogs) {
        expect(entry.details).toEqual(expect.objectContaining({
          failureDetailsPresent: true,
          failureMessagePresent: true,
          failureName: "Error",
        }));
      }
      const serializedLogs = JSON.stringify([
        ...readCapturedHostedExecutionLogs(consoleInfo),
        ...readCapturedHostedExecutionLogs(consoleError),
      ]);
      expect(serializedLogs).not.toContain(TEST_USER_ID);
      expect(serializedLogs).not.toContain(hiddenFailureMessage);
      expect(serializedLogs).not.toContain(hiddenFailureDetail);
      expect(serializedLogs).not.toContain("hidden coded runtime failure");
      expect(serializedLogs).not.toContain("hidden nested-coded runtime failure");
      expect(serializedLogs).not.toContain("hidden nested cause");
      expect(serializedLogs).not.toContain("hidden generic-coded runtime failure");
      expect(serializedLogs).not.toContain("hidden nested generic-coded wrapper");
      expect(serializedLogs).not.toContain("hidden generic-coded cause");
    } finally {
      if (previousStdIoLogSetting === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
      }
      consoleError.mockRestore();
      consoleInfo.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  test("emits a fail boundary for the open runtime phase when restore throws", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hiddenSnapshotHash = "f".repeat(64);

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const restoreFailure = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_restore_phase_failure",
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      }), {
        async createCheckpointSnapshot() {
          throw new Error("Restore phase test should not checkpoint.");
        },
        async importItem() {
          throw new Error("Restore phase test should not import mailbox items.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events: [], items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events: [],
            workspace: createWorkspaceState({
              snapshotRef: createBundleRef({
                hash: hiddenSnapshotHash,
                key: "users/bundles/member-synthetic/restore-phase-failure.bundle.json",
                size: 512,
              }),
              version: "0",
            }),
          }),
        }),
        vaultRoot,
      }).catch((error: unknown) => error);
      expect(restoreFailure).toMatchObject({
        message: "Hosted workspace runtime job snapshot restore failed.",
      });
      expect(readHostedRuntimeFailurePhaseCode(restoreFailure)).toBe(
        "runtime_phase:workspace.restore",
      );

      const failureLogs = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_restore_phase_failure",
        spy: consoleError,
      }).filter((entry) => entry.details.runtimePhaseStatus === "fail");
      expect(failureLogs.map((entry) => entry.details.runtimePhase)).toEqual([
        "workspace.restore",
        "runtime",
      ]);
      expect(failureLogs[0]?.details).toEqual(expect.objectContaining({
        failureDetailsPresent: false,
        failureMessagePresent: true,
        runtimePhaseDurationMs: expect.any(Number),
      }));

      const serializedLogs = JSON.stringify([
        ...readCapturedHostedExecutionLogs(consoleInfo),
        ...readCapturedHostedExecutionLogs(consoleError),
      ]);
      expect(serializedLogs).not.toContain(TEST_USER_ID);
      expect(serializedLogs).not.toContain(hiddenSnapshotHash);
    } finally {
      if (previousStdIoLogSetting === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
      }
      consoleError.mockRestore();
      consoleInfo.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  });
