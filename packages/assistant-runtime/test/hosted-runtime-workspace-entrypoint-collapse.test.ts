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
  mocks,
  removeTempRoot,
  requireEventIndex,
  stageAssistantInputEventForMailboxItem,
  stagePendingLinqAssistantInputForMailboxItem,
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

describe("hosted workspace runtime entrypoint", () => {test("collapse invariant 1: fresh conversation wake runs before idle shutdown checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-collapse-invariant-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 180_000;
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_collapse_invariant_fresh_conversation_preempts",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "1".repeat(64),
                  key: "users/bundles/member-synthetic/collapse-fresh-conversation.bundle.json",
                  size: 640,
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
                workspace: createWorkspaceState({
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  version: "4",
                }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              events.push(
                `assistant.phase:${assistantPhaseCalls}:`
                  + `${input.workspace?.nextWakeAt ?? "none"}`,
              );
              if (assistantPhaseCalls === 1) {
                assistantOneObserved.resolve();
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                  redactedStatus: {
                    hostedAssistantProgressed: true,
                  },
                };
              }

              assistantTwoObserved.resolve();
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

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      assert.equal(checkpointRequests.length, 0);

      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_collapse_fresh_conversation",
        laneSeq: "1",
        occurredAt: "2026-04-27T00:00:01.000Z",
      }));
      runtimeWakeSignal.notify(Date.parse(TEST_NOW) + 1);

      await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
      assert.equal(checkpointRequests.length, 0);
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      const result = await resultPromise;

      assert.ok(
        requireEventIndex(events, "assistant.phase:2:none")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
      );
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_collapse_fresh_conversation",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [
        ["idle_shutdown", null, null],
      ]);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("confirmed assistant configuration updates apply to the next hot foreground phase", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-assistant-target-refresh-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 180_000;
    const phaseObserved = [
      createDeferred<void>(),
      createDeferred<void>(),
      createDeferred<void>(),
      createDeferred<void>(),
      createDeferred<void>(),
    ];
    const configurationRequests: HostedRuntimeAssistantConfigurationControlRequest[] = [];
    const configurationResponses: HostedRuntimeAssistantConfigurationToolResponse[] = [
      {
        action: "update",
        result: {
          appliesAt: "next_turn",
          availableModels: ["gpt-5.6-terra", "gpt-5.6-sol"],
          availableProviders: ["openai", "venice"],
          availableReasoningEfforts: ["low", "high"],
          configurationAvailable: true,
          dormantSolPreference: false,
          model: "gpt-5.6-sol",
          provider: "openai",
          reasoningEffort: "high",
          requiredPlan: null,
          solAvailable: true,
          status: "updated",
        },
      },
      {
        action: "update",
        result: {
          appliesAt: "next_turn",
          availableModels: [],
          availableProviders: [],
          availableReasoningEfforts: [],
          configurationAvailable: false,
          dormantSolPreference: false,
          model: "gpt-5.6-terra",
          provider: "openai",
          reasoningEffort: "low",
          requiredPlan: null,
          solAvailable: false,
          status: "unavailable",
        },
      },
      {
        action: "update",
        result: {
          appliesAt: "next_turn",
          availableModels: ["gpt-5.6-terra", "gpt-5.6-sol"],
          availableProviders: ["openai", "venice"],
          availableReasoningEfforts: ["low", "high"],
          configurationAvailable: true,
          dormantSolPreference: false,
          model: "gpt-5.6-terra",
          provider: "openai",
          reasoningEffort: "low",
          requiredPlan: null,
          solAvailable: true,
          status: "unchanged",
        },
      },
      {
        action: "update",
        result: {
          appliesAt: "next_turn",
          availableModels: ["gpt-5.6-terra", "gpt-5.6-sol"],
          availableProviders: ["openai", "venice"],
          availableReasoningEfforts: ["low", "high"],
          configurationAvailable: true,
          dormantSolPreference: false,
          model: "gpt-5.6-sol",
          provider: "openai",
          reasoningEffort: "high",
          requiredPlan: null,
          solAvailable: true,
          status: "updated",
        },
      },
      {
        action: "update",
        result: {
          appliesAt: "next_turn",
          availableModels: ["gpt-5.6-terra", "gpt-5.6-sol"],
          availableProviders: ["openai", "venice"],
          availableReasoningEfforts: ["low", "high"],
          configurationAvailable: true,
          dormantSolPreference: false,
          model: "gpt-5.6-sol",
          provider: "openai",
          reasoningEffort: "high",
          requiredPlan: null,
          solAvailable: true,
          status: "unchanged",
        },
      },
    ];
    const observedTargets: Array<{
      forwardedEffort: string | undefined;
      forwardedModel: string | undefined;
      runtimeEffort: string | undefined;
      runtimeModel: string | undefined;
    }> = [];
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      mocks.runHostedIdleCheckpointMaintenance.mockClear();
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            forwardedEnv: {
              HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
              HOSTED_ASSISTANT_REASONING_EFFORT: "low",
            },
            request: {
              attemptId: "attempt_assistant_target_refresh",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "9".repeat(64),
                  key: "users/bundles/member-synthetic/assistant-target-refresh.bundle.json",
                  size: 640,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox.importItem:${item.item.id}`);
              return { status: "imported" };
            },
            platform: createPlatform({
              assistantConfigurationToolPort: {
                async request(request) {
                  configurationRequests.push(request);
                  if (request.action === "read") {
                    return {
                      action: "read",
                      result: {
                        availableModels: ["gpt-5.6-terra", "gpt-5.6-sol"],
                        availableProviders: ["openai", "venice"],
                        availableReasoningEfforts: ["low", "high"],
                        configurationAvailable: true,
                        dormantSolPreference: false,
                        model: "gpt-5.6-terra",
                        provider: "openai",
                        reasoningEffort: "low",
                        solAvailable: true,
                      },
                    };
                  }
                  const response = configurationResponses.shift();
                  assert.ok(response, "Unexpected assistant configuration request.");
                  return response;
                },
              },
              mailboxPort: createMailboxPort({ events, items: mailboxItems }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  version: "4",
                }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              const observedTarget = {
                forwardedEffort:
                  input.runtime.forwardedEnv.HOSTED_ASSISTANT_REASONING_EFFORT,
                forwardedModel: input.runtime.forwardedEnv.HOSTED_ASSISTANT_MODEL,
                runtimeEffort: input.runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT,
                runtimeModel: input.runtimeEnv.HOSTED_ASSISTANT_MODEL,
              };
              observedTargets.push(observedTarget);
              events.push(`assistant.phase:${assistantPhaseCalls}:${observedTarget.runtimeModel}`);

              const configurationTool =
                input.runtime.platform.assistantConfigurationToolPort;
              assert.ok(configurationTool);
              if (assistantPhaseCalls === 1) {
                await configurationTool.request({
                  action: "update",
                  assistantInputId: `ain_${"1".repeat(32)}`,
                  model: "gpt-5.6-sol",
                  reasoningEffort: "high",
                });
                assert.deepEqual(
                  {
                    forwardedEffort:
                      input.runtime.forwardedEnv.HOSTED_ASSISTANT_REASONING_EFFORT,
                    forwardedModel: input.runtime.forwardedEnv.HOSTED_ASSISTANT_MODEL,
                    runtimeEffort:
                      input.runtimeEnv.HOSTED_ASSISTANT_REASONING_EFFORT,
                    runtimeModel: input.runtimeEnv.HOSTED_ASSISTANT_MODEL,
                  },
                  observedTarget,
                  "The running phase must retain its starting target.",
                );
              } else if (assistantPhaseCalls === 2) {
                await configurationTool.request({ action: "read" });
                await configurationTool.request({
                  action: "update",
                  assistantInputId: `ain_${"2".repeat(32)}`,
                  model: "gpt-5.6-terra",
                  reasoningEffort: "low",
                });
              } else if (assistantPhaseCalls === 3) {
                await configurationTool.request({
                  action: "update",
                  assistantInputId: `ain_${"3".repeat(32)}`,
                  model: "gpt-5.6-terra",
                  reasoningEffort: "low",
                });
              } else if (assistantPhaseCalls === 4) {
                await configurationTool.request({
                  action: "update",
                  assistantInputId: `ain_${"4".repeat(32)}`,
                  model: "gpt-5.6-sol",
                  reasoningEffort: "high",
                });
              } else if (assistantPhaseCalls === 5) {
                await configurationTool.request({
                  action: "update",
                  assistantInputId: `ain_${"5".repeat(32)}`,
                  model: "gpt-5.6-sol",
                  reasoningEffort: "high",
                });
              }

              phaseObserved[assistantPhaseCalls - 1]?.resolve();
              return assistantPhaseCalls < 5
                ? {
                    checkpointReason: "assistant_runtime_commit" as const,
                    nextWakeAt: null,
                    nextWakeReason: null,
                    progressed: true,
                    redactedStatus: { hostedAssistantProgressed: true },
                  }
                : {
                    progressed: false,
                    redactedStatus: { hostedAssistantProgressed: false },
                  };
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(phaseObserved[0]!.promise, 15_000, () => events.join(","));
      for (let nextPhase = 2; nextPhase <= 5; nextPhase += 1) {
        await waitForFakeTimerScheduled(() => events.join(","));
        assert.equal(checkpointRequests.length, 0);
        mailboxItems.push(createMailboxItem({
          id: `mailbox_item_assistant_target_refresh_${nextPhase}`,
          laneSeq: String(nextPhase - 1),
          occurredAt: `2026-04-27T00:00:0${nextPhase - 1}.000Z`,
        }));
        runtimeWakeSignal.notify(Date.parse(TEST_NOW) + nextPhase - 1);
        await withRealTimeout(
          phaseObserved[nextPhase - 1]!.promise,
          15_000,
          () => events.join(","),
        );
      }

      assert.deepEqual(observedTargets, [
        {
          forwardedEffort: "low",
          forwardedModel: "gpt-5.6-terra",
          runtimeEffort: "low",
          runtimeModel: "gpt-5.6-terra",
        },
        {
          forwardedEffort: "high",
          forwardedModel: "gpt-5.6-sol",
          runtimeEffort: "high",
          runtimeModel: "gpt-5.6-sol",
        },
        {
          forwardedEffort: "high",
          forwardedModel: "gpt-5.6-sol",
          runtimeEffort: "high",
          runtimeModel: "gpt-5.6-sol",
        },
        {
          forwardedEffort: "low",
          forwardedModel: "gpt-5.6-terra",
          runtimeEffort: "low",
          runtimeModel: "gpt-5.6-terra",
        },
        {
          forwardedEffort: "high",
          forwardedModel: "gpt-5.6-sol",
          runtimeEffort: "high",
          runtimeModel: "gpt-5.6-sol",
        },
      ]);
      assert.deepEqual(configurationRequests.map((request) => request.action), [
        "update",
        "read",
        "read",
        "update",
        "read",
        "update",
        "read",
        "update",
        "read",
        "update",
      ]);
      assert.equal(configurationResponses.length, 0);
      assert.equal(checkpointRequests.length, 0);

      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      const result = await resultPromise;
      assert.equal(result.status, "idle");
      assert.equal(checkpointRequests.length, 1);
      expect(mocks.runHostedIdleCheckpointMaintenance).toHaveBeenCalledOnce();
      // Idle maintenance can still check runtime configuration, while usage
      // attribution comes from the model actually bound to the warm thread.
      expect(mocks.runHostedIdleCheckpointMaintenance).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-5.6-sol",
        }),
      );
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    {
      expectedCheckpointDelayMs: 180_000,
      expectedImmediateRecheck: undefined,
      expectedWakeReason: "assistant",
      mailboxWakeAt: new Date(Date.parse(TEST_NOW) + 5 * 60_000).toISOString(),
      scenario: "retains the serviced assistant wake ahead of a future mailbox wake",
    },
    {
      expectedCheckpointDelayMs: 0,
      expectedImmediateRecheck: true,
      expectedWakeReason: "mailbox",
      mailboxWakeAt: TEST_NOW,
      scenario: "hands a due mailbox wake to its owner after assistant service",
    },
  ])("collapse invariant 2a: $scenario", async ({
    expectedCheckpointDelayMs,
    expectedImmediateRecheck,
    expectedWakeReason,
    mailboxWakeAt,
  }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-collapse-invariant-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 180_000;
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    const runtimeAbortController = new AbortController();
    let firstCheckpointStartedAtMs: number | null = null;
    let assistantPhaseCalls = 0;
    let invocationPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      invocationPromise =
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_collapse_invariant_due_assistant_waits",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              firstCheckpointStartedAtMs ??= Date.now();
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "2".repeat(64),
                  key: "users/bundles/member-synthetic/collapse-due-assistant-waits.bundle.json",
                  size: 640,
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
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              events.push(
                `assistant.phase:${assistantPhaseCalls}:`
                  + `${input.workspace?.nextWakeAt ?? "none"}`,
              );
              if (assistantPhaseCalls === 1) {
                assistantOneObserved.resolve();
                return {
                  checkpointReason: "assistant_runtime_commit",
                  invocationLocalAssistantWakeAt: TEST_NOW,
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  progressed: true,
                  redactedStatus: {
                    hostedAssistantProgressed: true,
                  },
                };
              }

              assistantTwoObserved.resolve();
              return {
                nextWakeAt: mailboxWakeAt,
                nextWakeReason: "mailbox",
                progressed: false,
                redactedStatus: {
                  hostedAssistantProgressed: false,
                },
              };
            },
            signal: runtimeAbortController.signal,
            vaultRoot,
          },
        );
      const resultPromise = withRealTimeout(
        invocationPromise,
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      if (expectedCheckpointDelayMs > 0) {
        await waitForFakeTimerScheduled(() => events.join(","));
      }
      await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1:none",
        `assistant.phase:2:${TEST_NOW}`,
      ]);

      if (expectedCheckpointDelayMs > 0) {
        await vi.advanceTimersByTimeAsync(expectedCheckpointDelayMs - 1);
        assert.equal(checkpointRequests.length, 0);
        await vi.advanceTimersByTimeAsync(1);
      } else {
        await vi.runAllTimersAsync();
      }
      const result = await resultPromise;

      assert.equal(
        firstCheckpointStartedAtMs,
        Date.parse(TEST_NOW) + expectedCheckpointDelayMs,
      );
      assert.ok(
        requireEventIndex(events, `assistant.phase:2:${TEST_NOW}`)
          < requireEventIndex(events, "snapshot:idle_shutdown"),
      );
      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [
        ["idle_shutdown", TEST_NOW, expectedWakeReason],
      ]);
      assert.equal(result.immediateRecheckRequested, expectedImmediateRecheck);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, TEST_NOW);
      assert.equal(result.nextWakeReason, expectedWakeReason);
      assert.equal(assistantPhaseCalls, 2);
    } finally {
      runtimeAbortController.abort(new DOMException("Synthetic test cleanup.", "AbortError"));
      await invocationPromise?.catch(() => undefined);
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("a requested owner handoff checkpoints after the current foreground pass", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-collapse-invariant-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const checkpointObserved = createDeferred<void>();
    const assistantObserved = createDeferred<void>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const runtimeAbortController = new AbortController();
    let assistantPhaseCalls = 0;
    let invocationPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      invocationPromise =
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_collapse_invariant_owner_handoff",
              idleCheckpointDelayMs: 180_000,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              checkpointObserved.resolve();
              return {
                snapshotRef: createBundleRef({
                  hash: "8".repeat(64),
                  key: "users/bundles/member-synthetic/collapse-owner-handoff.bundle.json",
                  size: 640,
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
                  version: "4",
                }),
              }),
            }),
            async runAssistantPhase() {
              assistantPhaseCalls += 1;
              assistantObserved.resolve();
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: new Date(Date.parse(TEST_NOW) + 60_000).toISOString(),
                nextWakeReason: "assistant",
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
              };
            },
            runtimeWakeSignal,
            signal: runtimeAbortController.signal,
            vaultRoot,
          },
        );
      const resultPromise = withRealTimeout(
        invocationPromise,
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      runtimeWakeSignal.notify({
        requestedProcessingMode: "system_mailbox",
      });
      await withRealTimeout(checkpointObserved.promise, 15_000, () => events.join(","));
      const result = await resultPromise;

      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [
        [
          "idle_shutdown",
          new Date(Date.parse(TEST_NOW) + 60_000).toISOString(),
          "assistant",
        ],
      ]);
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(assistantPhaseCalls, 1);
    } finally {
      runtimeAbortController.abort(new DOMException("Synthetic test cleanup.", "AbortError"));
      await invocationPromise?.catch(() => undefined);
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("collapse invariant 2b: mailbox budget exhaustion waits for the idle checkpoint delay", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-collapse-invariant-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const importObserved = createDeferred<void>();
    const idleCheckpointDelayMs = 180_000;
    const runtimeAbortController = new AbortController();
    let firstCheckpointStartedAtMs: number | null = null;
    let assistantPhaseCalls = 0;
    let invocationPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      invocationPromise =
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_collapse_invariant_budget_waits",
              budget: {
                maxMailboxItems: 1,
              },
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              firstCheckpointStartedAtMs ??= Date.now();
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "3".repeat(64),
                  key: "users/bundles/member-synthetic/collapse-budget-waits.bundle.json",
                  size: 640,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox.importItem:${item.item.id}`);
              importObserved.resolve();
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [
                  createMailboxItem({
                    id: "mailbox_item_collapse_budget_001",
                    laneSeq: "1",
                  }),
                  createMailboxItem({
                    createdAt: "9999-01-01T00:00:00.000Z",
                    id: "mailbox_item_collapse_budget_002",
                    laneSeq: "2",
                  }),
                ],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            async runAssistantPhase() {
              assistantPhaseCalls += 1;
              events.push(`assistant.phase:${assistantPhaseCalls}`);
              return {
                progressed: false,
                redactedStatus: {
                  hostedAssistantProgressed: false,
                },
              };
            },
            signal: runtimeAbortController.signal,
            vaultRoot,
          },
        );
      const resultPromise = withRealTimeout(
        invocationPromise,
        15_000,
        () => events.join(","),
      );
      void resultPromise.catch(() => undefined);

      await withRealTimeout(importObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - 1);
      assert.equal(checkpointRequests.length, 0);
      await vi.advanceTimersByTimeAsync(1);
      const result = await resultPromise;

      assert.equal(firstCheckpointStartedAtMs, Date.parse(TEST_NOW) + idleCheckpointDelayMs);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_collapse_budget_001",
      ]);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.nextWakeReason,
      ]), [
        ["idle_shutdown", "mailbox"],
      ]);
      assert.equal(result.status, "budget_exhausted");
      assert.match(result.nextWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
    } finally {
      runtimeAbortController.abort(new DOMException("Synthetic test cleanup.", "AbortError"));
      await invocationPromise?.catch(() => undefined);
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("collapse invariant 2c: durable follow-up effects do not pull the first checkpoint earlier", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-collapse-invariant-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 180_000;
    const assistantObserved = createDeferred<void>();
    const durableEffectObserved = createDeferred<void>();
    const durableWakeAt = "2026-04-27T00:02:00.000Z";
    let firstCheckpointStartedAtMs: number | null = null;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_collapse_invariant_durable_followup_waits",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              firstCheckpointStartedAtMs ??= Date.now();
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: `${checkpointRequests.length + 1}`.repeat(64).slice(0, 64),
                  key:
                    "users/bundles/member-synthetic/"
                    + `collapse-durable-followup-waits-${checkpointRequests.length}.bundle.json`,
                  size: 640,
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
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            async runAssistantPhase() {
              events.push("assistant.phase:1");
              assistantObserved.resolve();
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: async () => {
                    events.push("durable-effect");
                    durableEffectObserved.resolve();
                    return {
                      nextWakeAt: durableWakeAt,
                      nextWakeReason: "system-mailbox",
                      requiresFollowUpCheckpoint: true,
                    };
                  },
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
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs - 1);
      assert.equal(checkpointRequests.length, 0);
      await vi.advanceTimersByTimeAsync(1);
      await withRealTimeout(durableEffectObserved.promise, 15_000, () => events.join(","));
      if (vi.getTimerCount() > 0) {
        await vi.runOnlyPendingTimersAsync();
      }
      const result = await resultPromise;

      assert.equal(firstCheckpointStartedAtMs, Date.parse(TEST_NOW) + idleCheckpointDelayMs);
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown")
          < requireEventIndex(events, "durable-effect"),
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, durableWakeAt);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("collapse invariant 2d: shutdown checkpoints dirty state immediately", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-collapse-invariant-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const shutdownController = new AbortController();

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_collapse_invariant_shutdown_immediate",
            idleCheckpointDelayMs: 180_000,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "4".repeat(64),
                key: "users/bundles/member-synthetic/collapse-shutdown-immediate.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ id: "mailbox_item_collapse_shutdown", laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase() {
            events.push("assistant.phase:1");
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

      assert.ok(
        requireEventIndex(events, "assistant.phase:1")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
      );
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("collapse invariant 3a: hot due assistant progress clears the wake before checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-collapse-invariant-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 60_000;
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_collapse_invariant_due_assistant_serviced",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: `${checkpointRequests.length + 5}`.repeat(64).slice(0, 64),
                  key:
                    "users/bundles/member-synthetic/"
                    + `collapse-due-assistant-serviced-${checkpointRequests.length}.bundle.json`,
                  size: 640,
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
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              events.push(
                `assistant.phase:${assistantPhaseCalls}:`
                  + `${input.workspace?.nextWakeAt ?? "none"}`,
              );
              if (assistantPhaseCalls === 1) {
                assistantOneObserved.resolve();
                return {
                  checkpointReason: "assistant_runtime_commit",
                  invocationLocalAssistantWakeAt: TEST_NOW,
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  progressed: true,
                  redactedStatus: {
                    hostedAssistantProgressed: true,
                  },
                };
              }

              assistantTwoObserved.resolve();
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
              };
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      const result = await resultPromise;

      assert.ok(
        requireEventIndex(events, `assistant.phase:2:${TEST_NOW}`)
          < requireEventIndex(events, "snapshot:idle_shutdown"),
      );
      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [
        ["idle_shutdown", null, null],
      ]);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("collapse invariant 3b: due device-sync wake committed by checkpoint is returned without assistant service", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-collapse-invariant-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 180_000;
    const assistantObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_collapse_invariant_device_sync_returned",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "6".repeat(64),
                  key: "users/bundles/member-synthetic/collapse-device-sync-returned.bundle.json",
                  size: 640,
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
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            async runAssistantPhase() {
              assistantPhaseCalls += 1;
              events.push(`assistant.phase:${assistantPhaseCalls}`);
              assistantObserved.resolve();
              return {
                checkpointReason: "system_mailbox_receipt",
                nextWakeAt: TEST_NOW,
                nextWakeReason: "device-sync.reconcile",
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
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
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      const result = await resultPromise;

      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [
        ["idle_shutdown", TEST_NOW, "device-sync.reconcile"],
      ]);
      assert.equal(result.immediateRecheckRequested, true);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, TEST_NOW);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("round4: foreground drain loop terminates with device-sync maintenance and assistant input churn", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-round4-drain-loop-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const continuationWakeAt = "2026-04-27T00:00:30.000Z";
    const mailboxItems: HostedMailboxItem[] = [
      createMailboxItem({
        id: "mailbox_item_round4_drain_loop_001",
        laneSeq: "1",
      }),
    ];
    let assistantPhaseCalls = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_round4_foreground_drain_loop_terminates",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/round4-drain-loop.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.lane !== "conversation") {
              return { status: "imported" };
            }

            return {
              assistantInputId: await stagePendingLinqAssistantInputForMailboxItem({
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
              workspace: createWorkspaceState({
                nextWakeAt: TEST_NOW,
                nextWakeReason: "device-sync.reconcile",
                version: "4",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls > 6) {
              throw new Error("Foreground drain loop did not terminate.");
            }

            if (assistantPhaseCalls <= 2) {
              const nextSeq = String(assistantPhaseCalls + 1);
              const nextItemId = `mailbox_item_round4_drain_loop_00${nextSeq}`;
              mailboxItems.push(createMailboxItem({
                id: nextItemId,
                laneSeq: nextSeq,
                occurredAt: `2026-04-27T00:00:0${nextSeq}.000Z`,
              }));
              runtimeWakeSignal.notify(Date.parse(TEST_NOW) + assistantPhaseCalls);
              await waitUntil(() => {
                assert.ok(events.includes(`mailbox.importItem:${nextItemId}`));
              });
            }

            return {
              checkpointReason: "assistant_runtime_commit" as const,
              deviceSyncMaintenanceRan: true,
              nextWakeAt: continuationWakeAt,
              nextWakeReason: "device-sync.reconcile",
              progressed: true,
              redactedStatus: {
                hostedAssistantProgressed: true,
                hostedDeviceSyncSkipped: false,
              },
            };
          },
          signal: runtimeAbortController.signal,
          vaultRoot,
        },
      );

      const result = await withRealTimeout(
        resultPromise,
        5_000,
        () => `Foreground drain loop did not return. Events: ${events.join(",")}`,
      );

      assert.equal(assistantPhaseCalls, 3);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_round4_drain_loop_001",
        "mailbox.importItem:mailbox_item_round4_drain_loop_002",
        "mailbox.importItem:mailbox_item_round4_drain_loop_003",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [
        ["idle_shutdown", continuationWakeAt, "device-sync.reconcile"],
      ]);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, continuationWakeAt);
    } finally {
      runtimeAbortController.abort();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("round4: committed due assistant wake hidden pre-checkpoint is still serviced, not lost", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-round4-hidden-wake-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 50;
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    const assistantThreeObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_round4_committed_due_assistant_hidden_then_serviced",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: `${checkpointRequests.length + 1}`.repeat(64).slice(0, 64),
                  key:
                    "users/bundles/member-synthetic/"
                    + `round4-hidden-wake-${checkpointRequests.length}.bundle.json`,
                  size: 640,
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
                workspace: createWorkspaceState({
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  version: "4",
                }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              events.push(
                `assistant.phase:${assistantPhaseCalls}:`
                  + `${input.workspace?.nextWakeAt ?? "none"}:`
                  + `${input.workspace?.nextWakeReason ?? "none"}`,
              );
              if (assistantPhaseCalls === 1) {
                assistantOneObserved.resolve();
                setTimeout(() => {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_round4_hidden_wake_conversation",
                    laneSeq: "1",
                    occurredAt: "2026-04-27T00:00:01.000Z",
                  }));
                  runtimeWakeSignal.notify(Date.parse(TEST_NOW) + 1);
                }, 0);
                return {
                  checkpointReason: "canonical_runtime_commit" as const,
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  progressed: true,
                  redactedStatus: {
                    hostedAssistantProgressed: true,
                  },
                };
              }

              if (assistantPhaseCalls === 2) {
                assistantTwoObserved.resolve();
                return {
                  progressed: false,
                  redactedStatus: {
                    hostedAssistantProgressed: false,
                  },
                };
              }

              if (assistantPhaseCalls === 3) {
                assistantThreeObserved.resolve();
                return {
                  checkpointReason: "assistant_runtime_commit" as const,
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                  redactedStatus: {
                    hostedAssistantProgressed: true,
                  },
                };
              }

              throw new Error("Committed due assistant wake should be serviced exactly once after checkpoint.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(0);
      await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
      assert.equal(checkpointRequests.length, 0);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        `assistant.phase:1:${TEST_NOW}:assistant`,
        "assistant.phase:2:none:none",
      ]);

      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      await withRealTimeout(assistantThreeObserved.promise, 15_000, () => events.join(","));
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown")
          < requireEventIndex(events, `assistant.phase:3:${TEST_NOW}:assistant`),
      );
      assert.ok(
        requireEventIndex(events, "mailbox.importItem:mailbox_item_round4_hidden_wake_conversation")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
      );

      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      const result = await resultPromise;

      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [
        ["idle_shutdown", TEST_NOW, "assistant"],
        ["idle_shutdown", null, null],
      ]);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  for (const scenario of [
    {
      name: "replacement",
      nextWakeAt: "2026-04-27T00:05:00.000Z",
      nextWakeReason: "assistant" as const,
      resultStatus: "scheduled" as const,
      systemItemId: null,
    },
    {
      name: "clear",
      nextWakeAt: null,
      nextWakeReason: null,
      resultStatus: "idle" as const,
      systemItemId: "mailbox_item_collapse_stale_clear_system",
    },
    {
      name: "null-reason-clear",
      nextWakeAt: null,
      nextWakeReason: null,
      resultStatus: "idle" as const,
      systemItemId: "mailbox_item_collapse_stale_null_reason_system",
    },
  ]) {
    test(`collapse invariant 4: stale committed assistant wake is not replayed before checkpoint (${scenario.name})`, async () => {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-collapse-invariant-"));
      const events: string[] = [];
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const mailboxItems: HostedMailboxItem[] = [];
      const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
      const idleCheckpointDelayMs = 50;
      const staleWakeAt = TEST_NOW;
      const assistantOneObserved = createDeferred<void>();
      const assistantTwoObserved = createDeferred<void>();
      let assistantPhaseCalls = 0;

      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      try {
        vi.setSystemTime(new Date(TEST_NOW));
        await initializeVault({ createdAt: TEST_NOW, vaultRoot });

        const resultPromise = withRealTimeout(
          runHostedWorkspaceRuntimeJobInProcess(
            createWorkspaceRuntimeJobInput({
              request: {
                attemptId: `attempt_collapse_invariant_stale_${scenario.name}`,
                idleCheckpointDelayMs,
                leaseGeneration: "9",
                userId: TEST_USER_ID,
                workspaceVersion: "4",
              },
            }),
            {
              async createCheckpointSnapshot(snapshotInput) {
                events.push(`snapshot:${snapshotInput.reason}`);
                return {
                  snapshotRef: createBundleRef({
                    hash: "7".repeat(64),
                    key:
                      "users/bundles/member-synthetic/"
                      + `collapse-stale-${scenario.name}.bundle.json`,
                    size: 640,
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
                  workspace: createWorkspaceState({
                    nextWakeAt: staleWakeAt,
                    nextWakeReason: scenario.name === "null-reason-clear" ? null : "assistant",
                    version: "4",
                  }),
                }),
              }),
              runtimeWakeSignal,
              async runAssistantPhase(input) {
                assistantPhaseCalls += 1;
                events.push(
                  `assistant.phase:${assistantPhaseCalls}:`
                    + `${input.workspace?.nextWakeAt ?? "none"}`,
                );
                if (assistantPhaseCalls === 1) {
                  assistantOneObserved.resolve();
                  mailboxItems.push(createMailboxItem({
                    id: `mailbox_item_collapse_stale_${scenario.name}_conversation`,
                    laneSeq: "1",
                    occurredAt: "2026-04-27T00:00:01.000Z",
                  }));
                  setTimeout(() => runtimeWakeSignal.notify(Date.parse(TEST_NOW) + 1), 0);
                  return {
                    checkpointReason: "canonical_runtime_commit",
                    nextWakeAt: scenario.nextWakeAt,
                    nextWakeReason: scenario.nextWakeReason,
                    progressed: true,
                    redactedStatus: {
                      hostedAssistantProgressed: true,
                    },
                  };
                }

                assistantTwoObserved.resolve();
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

        await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
        await waitForFakeTimerScheduled(() => events.join(","));
        await vi.advanceTimersByTimeAsync(0);
        await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
        await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
        if (vi.getTimerCount() > 0) {
          await vi.runOnlyPendingTimersAsync();
        }
        const result = await resultPromise;

        const assistantEvents = events.filter((event) =>
          event.startsWith("assistant.phase:")
        );
        assert.deepEqual(
          assistantEvents.filter((event) => event.includes(staleWakeAt)),
          [`assistant.phase:1:${staleWakeAt}`],
        );
        assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
        assert.equal(checkpointRequests[0]?.nextWakeAt, scenario.nextWakeAt);
        assert.equal(checkpointRequests[0]?.nextWakeReason, scenario.nextWakeReason);
        assert.equal(result.status, scenario.resultStatus);
        assert.equal(result.nextWakeAt, scenario.nextWakeAt);
        assert.ok(
          requireEventIndex(
            events,
            `mailbox.importItem:mailbox_item_collapse_stale_${scenario.name}_conversation`,
          )
            < requireEventIndex(events, "snapshot:idle_shutdown"),
        );
      } finally {
        vi.useRealTimers();
        await removeTempRoot(vaultRoot);
      }
    });
  }

  test("collapse invariant 5: source-blind pre-checkpoint import is conversation-only and system work waits", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-collapse-invariant-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeAbortController = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 50;
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    const systemFollowUpWakeAt = "2099-04-27T00:10:00.000Z";
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_collapse_invariant_system_waits_for_checkpoint",
            idleCheckpointDelayMs,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/collapse-system-waits.bundle.json",
                size: 640,
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
              workspace: createWorkspaceState({
                nextWakeAt: TEST_NOW,
                nextWakeReason: "assistant",
                version: "4",
              }),
            }),
          }),
          runtimeWakeSignal,
          signal: runtimeAbortController.signal,
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push(
              `assistant.phase:${assistantPhaseCalls}:`
                + `${input.workspace?.nextWakeAt ?? "none"}`,
            );
            if (assistantPhaseCalls === 1) {
              assistantOneObserved.resolve();
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_collapse_system_after_checkpoint",
                kind: "member.channels.updated",
                lane: "system",
                laneSeq: "1",
                occurredAt: "2026-04-27T00:00:01.000Z",
              }));
              setTimeout(() => runtimeWakeSignal.notify(Date.parse(TEST_NOW) + 1), 0);
              return {
                checkpointReason: "canonical_runtime_commit",
                nextWakeAt: systemFollowUpWakeAt,
                nextWakeReason: "device-sync.reconcile",
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
              };
            }

            assistantTwoObserved.resolve();
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
      const resultWithTimeout = withRealTimeout(
        resultPromise,
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(0);
      assert.equal(
        events.includes("mailbox.importItem:mailbox_item_collapse_system_after_checkpoint"),
        false,
      );
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      if (vi.getTimerCount() > 0) {
        await vi.runOnlyPendingTimersAsync();
      }
      await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      const result = await resultWithTimeout;

      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown")
          < requireEventIndex(
            events,
            "mailbox.importItem:mailbox_item_collapse_system_after_checkpoint",
          ),
      );
      assert.ok(
        requireEventIndex(
          events,
          "mailbox.importItem:mailbox_item_collapse_system_after_checkpoint",
        )
          < requireEventIndex(events, `assistant.phase:2:${systemFollowUpWakeAt}`),
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.nextWakeAt, systemFollowUpWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "device-sync.reconcile");
      assert.equal(checkpointRequests[1]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[1]?.nextWakeAt, systemFollowUpWakeAt);
      assert.equal(checkpointRequests[1]?.nextWakeReason, "device-sync.reconcile");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, systemFollowUpWakeAt);
    } finally {
      vi.useRealTimers();
      runtimeAbortController.abort();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("collapse invariant 6: durable post-checkpoint wake is persisted by a follow-up checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-collapse-invariant-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 1;
    const durableWakeAt = "2026-04-27T00:03:00.000Z";
    const assistantObserved = createDeferred<void>();

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_collapse_invariant_durable_wake_followup",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: `${checkpointRequests.length + 9}`.repeat(64).slice(0, 64),
                  key:
                    "users/bundles/member-synthetic/"
                    + `collapse-durable-wake-followup-${checkpointRequests.length}.bundle.json`,
                  size: 640,
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
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            async runAssistantPhase() {
              events.push("assistant.phase:1");
              assistantObserved.resolve();
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: async () => {
                    events.push("durable-effect");
                    return {
                      nextWakeAt: durableWakeAt,
                      nextWakeReason: "system-mailbox",
                      requiresFollowUpCheckpoint: true,
                    };
                  },
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
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      if (vi.getTimerCount() > 0) {
        await vi.runOnlyPendingTimersAsync();
      }
      const result = await resultPromise;

      const snapshotEvents = events.filter((event) => event === "snapshot:idle_shutdown");
      assert.equal(snapshotEvents.length, 2, events.join(","));
      assert.ok(
        requireEventIndex(events, "durable-effect")
          < events.lastIndexOf("snapshot:idle_shutdown"),
      );
      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [
        ["idle_shutdown", null, null],
        ["idle_shutdown", durableWakeAt, "system-mailbox"],
      ]);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, durableWakeAt);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("collapse invariant 7: redacted status counters survive a hot follow-up pass and checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-collapse-invariant-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 1;
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_collapse_invariant_redacted_status_survives",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: `${checkpointRequests.length + 11}`.repeat(64).slice(0, 64),
                  key:
                    "users/bundles/member-synthetic/"
                    + `collapse-redacted-status-${checkpointRequests.length}.bundle.json`,
                  size: 640,
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
                workspace: createWorkspaceState({ version: "4" }),
              }),
            }),
            async runAssistantPhase() {
              assistantPhaseCalls += 1;
              events.push(`assistant.phase:${assistantPhaseCalls}`);
              if (assistantPhaseCalls === 1) {
                assistantOneObserved.resolve();
                const systemPreparedStatus: HostedRuntimeRedactedJson = {
                  hostedSystemMailboxPrepared: 1,
                };
                const systemRecordedStatus: HostedRuntimeRedactedJson = {
                  hostedSystemMailboxRecorded: 1,
                };
                return {
                  afterCheckpoint: async () => ({
                    checkpointReason: "system_mailbox_receipt" as const,
                    nextWakeAt: TEST_NOW,
                    nextWakeReason: "assistant",
                    redactedStatus: systemRecordedStatus,
                  }),
                  checkpointReason: "system_mailbox_receipt" as const,
                  invocationLocalAssistantWakeAt: TEST_NOW,
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  progressed: true,
                  redactedStatus: systemPreparedStatus,
                };
              }

              assistantTwoObserved.resolve();
              const assistantStatus: HostedRuntimeRedactedJson = {
                hostedAssistantProgressed: true,
                hostedSystemMailboxPrepared: 0,
                hostedSystemMailboxRecorded: 0,
              };
              return {
                checkpointReason: "assistant_runtime_commit" as const,
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
                redactedStatus: assistantStatus,
              };
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      const result = await resultPromise;

      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
        "assistant.phase:2",
      ]);
      assert.ok(
        requireEventIndex(events, "assistant.phase:2")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.redactedStatus?.hostedSystemMailboxPrepared, 1);
      assert.equal(result.redactedStatus?.hostedSystemMailboxRecorded, 1);
      assert.equal(result.redactedStatus?.hostedAssistantProgressed, true);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("fresh conversation wakes see projected wake state before the idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 180_000;
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_runtime_pre_checkpoint_conversation_wake",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "d".repeat(64),
                  key:
                    "users/bundles/member-synthetic/"
                    + "runtime-pre-checkpoint-conversation-wake.bundle.json",
                  size: 640,
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
                workspace: createWorkspaceState({
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  version: "4",
                }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              events.push(
                `assistant.phase:${assistantPhaseCalls}:`
                  + `${input.workspace?.nextWakeAt ?? "none"}:`
                  + `${input.workspace?.nextWakeReason ?? "none"}`,
              );
              if (assistantPhaseCalls === 1) {
                assistantOneObserved.resolve();
                return {
                  checkpointReason: "canonical_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                  redactedStatus: {
                    hostedAssistantProgressed: true,
                  },
                };
              }

              if (assistantPhaseCalls === 2) {
                assistantTwoObserved.resolve();
                return {
                  progressed: false,
                  redactedStatus: {
                    hostedAssistantProgressed: false,
                  },
                };
              }

              throw new Error("Fresh conversation wake replayed a stale assistant wake.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      assert.equal(checkpointRequests.length, 0);

      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_entrypoint_pre_checkpoint_conversation_wake",
        laneSeq: "1",
        occurredAt: "2026-04-27T00:00:01.000Z",
      }));
      runtimeWakeSignal.notify(Date.parse(TEST_NOW) + 1);

      await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
      assert.equal(checkpointRequests.length, 0);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        `assistant.phase:1:${TEST_NOW}:assistant`,
        "assistant.phase:2:none:none",
      ]);

      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      const result = await resultPromise;

      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_pre_checkpoint_conversation_wake",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.status, "idle");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("same-key checkpoint-blocked conversation wakes hide due assistant state before checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 180_000;
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    const assistantThreeObserved = createDeferred<void>();
    let assistantPhaseCalls = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_runtime_same_key_conversation_wake",
              idleCheckpointDelayMs,
              leaseGeneration: "9",
              userId: TEST_USER_ID,
              workspaceVersion: "4",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createBundleRef({
                  hash: `${checkpointRequests.length}`.repeat(64).slice(0, 64),
                  key:
                    "users/bundles/member-synthetic/"
                    + "runtime-same-key-conversation-wake.bundle.json",
                  size: 640,
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
                workspace: createWorkspaceState({
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  version: "4",
                }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPhaseCalls += 1;
              events.push(
                `assistant.phase:${assistantPhaseCalls}:`
                  + `${input.workspace?.nextWakeAt ?? "none"}:`
                  + `${input.workspace?.nextWakeReason ?? "none"}`,
              );
              if (assistantPhaseCalls === 1) {
                assistantOneObserved.resolve();
                return {
                  afterCheckpoint: async () => ({
                    checkpointReason: "provider_cleanup",
                    nextWakeAt: TEST_NOW,
                    nextWakeReason: "assistant",
                  }),
                  checkpointReason: "canonical_runtime_commit",
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  progressed: true,
                  redactedStatus: {
                    hostedAssistantProgressed: true,
                  },
                };
              }

              if (assistantPhaseCalls === 2) {
                assistantTwoObserved.resolve();
                return {
                  progressed: false,
                  redactedStatus: {
                    hostedAssistantProgressed: false,
                  },
                };
              }

              if (assistantPhaseCalls === 3) {
                assistantThreeObserved.resolve();
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                  redactedStatus: {
                    hostedAssistantProgressed: true,
                  },
                };
              }

              throw new Error("Same-key due assistant wake should service exactly once.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_entrypoint_same_key_conversation_wake",
        laneSeq: "1",
        occurredAt: "2026-04-27T00:00:01.000Z",
      }));
      runtimeWakeSignal.notify(Date.parse(TEST_NOW) + 1);

      await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
      assert.equal(checkpointRequests.length, 0);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        `assistant.phase:1:${TEST_NOW}:assistant`,
        "assistant.phase:2:none:none",
      ]);

      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      await withRealTimeout(assistantThreeObserved.promise, 15_000, () => events.join(","));
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown")
          < requireEventIndex(events, `assistant.phase:3:${TEST_NOW}:assistant`),
      );

      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      const result = await resultPromise;

      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.nextWakeAt,
        request.nextWakeReason,
      ]), [
        ["idle_shutdown", TEST_NOW, "assistant"],
        ["idle_shutdown", null, null],
      ]);
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.status, "idle");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("post-checkpoint projected wakes replace consumed phase wakes and wait for the idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-post-checkpoint-wake-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const phaseWakeAt = new Date(Date.now() + 30_000).toISOString();
    const postCheckpointWakeAt = new Date(Date.now() + 60_000).toISOString();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_post_checkpoint_projected_wake",
            idleCheckpointDelayMs: 75,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/runtime-post-checkpoint-projected-wake.bundle.json",
                size: 640,
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
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                version: "4",
              }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push(
              `assistant.phase:${assistantPhaseCalls}:${input.workspace?.nextWakeAt ?? "none"}`,
            );
            return {
              afterCheckpoint: async () => ({
                checkpointReason: "provider_cleanup",
                nextWakeAt: postCheckpointWakeAt,
                nextWakeReason: "assistant",
              }),
              checkpointReason: "outbox_sending",
              nextWakeAt: phaseWakeAt,
              nextWakeReason: "assistant",
              progressed: true,
              redactedStatus: {
                hostedAssistantNextWakeAt: phaseWakeAt,
                hostedOutboxPendingDeliveryEffects: 1,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, postCheckpointWakeAt);
      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.notEqual(result.nextWakeAt, phaseWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeAt, postCheckpointWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("same-timestamp post-checkpoint projected wakes wait for the idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-post-checkpoint-same-wake-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const postCheckpointWakeAt = new Date(Date.now() + 15).toISOString();
    const phaseInputIds: string[][] = [];
    const mailboxItems = [createMailboxItem({
      id: "mailbox_item_entrypoint_current_route_continuation",
    })];
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_post_checkpoint_same_projected_wake",
            idleCheckpointDelayMs: 75,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/runtime-post-checkpoint-same-wake.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return {
              assistantInputId: await stageAssistantInputEventForMailboxItem({
                item: item.item,
                threadId: "thread_current_route_continuation",
                threadIsDirect: false,
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
              workspace: createWorkspaceState({
                nextWakeAt: postCheckpointWakeAt,
                nextWakeReason: "assistant",
                version: "4",
              }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            phaseInputIds.push([
              ...(input.initialAssistantInputBatch?.assistantInputIds
                ?? input.initialMailboxImport.importResult.assistantInputIds
                ?? []),
            ]);
            events.push(
              `assistant.phase:${assistantPhaseCalls}:${input.workspace?.nextWakeAt ?? "none"}`,
            );
            if (assistantPhaseCalls === 1) {
              return {
                afterCheckpoint: async () => ({
                  checkpointReason: "outbox_receipt",
                  nextWakeAt: postCheckpointWakeAt,
                  nextWakeReason: "assistant",
                }),
                checkpointReason: "outbox_sending",
                nextWakeAt: postCheckpointWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                  hostedOutboxPendingDeliveryEffects: 1,
                },
              };
            }

            return {
              checkpointReason: "canonical_runtime_commit",
              nextWakeAt: null,
              progressed: true,
              redactedStatus: {
                hostedAssistantProgressed: true,
                hostedOutboxPendingDeliveryEffects: 0,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(assistantPhaseCalls, 2);
      assert.equal(phaseInputIds[0]?.length, 1);
      assert.deepEqual(phaseInputIds[1], []);
      assert.deepEqual(
        events.filter((event) =>
          event.startsWith("assistant.phase:") || event.startsWith("snapshot:")
        ),
        [
          `assistant.phase:1:${postCheckpointWakeAt}`,
          "snapshot:idle_shutdown",
          `assistant.phase:2:${postCheckpointWakeAt}`,
          "snapshot:idle_shutdown",
        ],
      );
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
        "idle_shutdown",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeAt, postCheckpointWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(checkpointRequests[1]?.nextWakeAt, null);
      assert.equal(checkpointRequests[1]?.nextWakeReason, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  });
