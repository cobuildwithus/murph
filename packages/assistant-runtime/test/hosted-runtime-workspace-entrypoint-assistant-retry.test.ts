import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { initializeVault } from "@murphai/core";
import type {
  HostedWorkspaceCheckpointRequest,
} from "@murphai/hosted-execution/runtime-control";
import { describe, test, vi } from "vitest";

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
  waitForFakeTimerScheduled,
  withRealTimeout,
  writeSyntheticAssistantAutoReplyTerminalEvidence,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import {
  runHostedWorkspaceRuntimeJobInProcess,
} from "../src/hosted-runtime.ts";
import {
  runHostedWorkspaceAssistantPhase,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";

const IDLE_CHECKPOINT_DELAY_MS = 180_000;
const SELECTED_INPUT_WAKE_DELAY_MS = 10_000;
const UNRELATED_CRON_WAKE_DELAY_MS = 20_000;
const EXACT_RETRY_WAKE_DELAY_MS = 30_000;

function createAutomationPassResult(input: {
  cronProcessed: number;
  cronRetryObligation?: {
    jobId: string;
    retryAt: string;
  };
  nextWakeAt: string | null;
  progressed: boolean;
  replyFailed?: number;
  replyReplied?: number;
  replyWakeAt?: string | null;
}) {
  return {
    cronProcessed: input.cronProcessed,
    ...(input.cronRetryObligation
      ? { cronRetryObligation: input.cronRetryObligation }
      : {}),
    currentTurnDeliveryIntentIds: [],
    nextWakeAt: input.nextWakeAt,
    outboxAttempted: 0,
    progressed: input.progressed,
    replies: {
      considered:
        (input.replyFailed ?? 0) > 0 || (input.replyReplied ?? 0) > 0 ? 1 : 0,
      failed: input.replyFailed ?? 0,
      nextWakeAt: input.replyWakeAt ?? null,
      replied: input.replyReplied ?? 0,
      skipped: 0,
    },
    routing: {
      considered: 0,
      failed: 0,
      nextWakeAt: null,
      noAction: 0,
      routed: 0,
      skipped: 0,
    },
  };
}

async function runExactRetrySequence(input: {
  selectedInputWake: boolean;
}): Promise<void> {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), "murph-workspace-assistant-exact-retry-"),
  );
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const observedPasses = Array.from(
    { length: input.selectedInputWake ? 4 : 3 },
    () => createDeferred<void>(),
  );
  const selectedInputWakeAt = new Date(
    Date.parse(TEST_NOW) + SELECTED_INPUT_WAKE_DELAY_MS,
  ).toISOString();
  const unrelatedCronWakeAt = new Date(
    Date.parse(TEST_NOW) + UNRELATED_CRON_WAKE_DELAY_MS,
  ).toISOString();
  const retryObligation = {
    jobId: "canonical-connection-lost-job-a",
    retryAt: new Date(
      Date.parse(TEST_NOW) + EXACT_RETRY_WAKE_DELAY_MS,
    ).toISOString(),
  };
  const assistantInputItem = input.selectedInputWake
    ? createMailboxItem({
        dedupeKey: "dedupe_selected_input_before_exact_cron_retry",
        id: "mailbox_item_selected_input_before_exact_cron_retry",
      })
    : null;
  const passResults = input.selectedInputWake
    ? [
        createAutomationPassResult({
          cronProcessed: 1,
          cronRetryObligation: retryObligation,
          nextWakeAt: selectedInputWakeAt,
          progressed: true,
          replyFailed: 1,
          replyWakeAt: selectedInputWakeAt,
        }),
        createAutomationPassResult({
          cronProcessed: 0,
          cronRetryObligation: retryObligation,
          nextWakeAt: unrelatedCronWakeAt,
          progressed: true,
          replyReplied: 1,
        }),
        createAutomationPassResult({
          cronProcessed: 1,
          cronRetryObligation: retryObligation,
          nextWakeAt: null,
          progressed: true,
        }),
        createAutomationPassResult({
          cronProcessed: 1,
          nextWakeAt: null,
          progressed: true,
        }),
      ]
    : [
        createAutomationPassResult({
          cronProcessed: 1,
          cronRetryObligation: retryObligation,
          nextWakeAt: unrelatedCronWakeAt,
          progressed: true,
        }),
        createAutomationPassResult({
          cronProcessed: 1,
          cronRetryObligation: retryObligation,
          nextWakeAt: null,
          progressed: true,
        }),
        createAutomationPassResult({
          cronProcessed: 1,
          nextWakeAt: null,
          progressed: true,
        }),
      ];
  const requiredNextWakeByPass: Array<string | undefined> =
    input.selectedInputWake
      ? [selectedInputWakeAt, unrelatedCronWakeAt, undefined, undefined]
      : [unrelatedCronWakeAt, undefined, undefined];
  const expectedInvocationWakeByPass = input.selectedInputWake
    ? [selectedInputWakeAt, null, null, null]
    : [null, null, null];
  const expectedPassAtMs = input.selectedInputWake
    ? [
        Date.parse(TEST_NOW),
        Date.parse(selectedInputWakeAt),
        Date.parse(unrelatedCronWakeAt),
        Date.parse(retryObligation.retryAt),
      ]
    : [
        Date.parse(TEST_NOW),
        Date.parse(unrelatedCronWakeAt),
        Date.parse(retryObligation.retryAt),
      ];
  const expectedPassLabels = input.selectedInputWake
    ? ["initial", "selected-input", "unrelated-cron-b", "exact-retry-a"]
    : ["initial", "unrelated-cron-b", "exact-retry-a"];
  let automationPass = 0;
  let assistantPass = 0;
  let freshAssistantInputId: string | null = null;

  mocks.runAssistantAutomationPass.mockReset().mockImplementation(async (passInput) => {
    const index = automationPass;
    automationPass += 1;
    const result = passResults[index];
    if (!result) {
      throw new Error("Exact cron retry sequence ran an unexpected assistant pass.");
    }
    if (index === 0) {
      assert.equal(passInput.cronRetryObligation ?? null, null);
    } else {
      assert.deepEqual(passInput.cronRetryObligation, retryObligation);
    }
    events.push(`automation:${expectedPassLabels[index]}:${Date.now()}`);
    return result;
  });

  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  try {
    vi.setSystemTime(new Date(TEST_NOW));
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });

    const resultPromise = withRealTimeout(
      runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: input.selectedInputWake
              ? "attempt_selected_input_before_exact_cron_retry"
              : "attempt_unrelated_cron_before_exact_retry",
            idleCheckpointDelayMs: IDLE_CHECKPOINT_DELAY_MS,
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
                hash: "9".repeat(64),
                key: input.selectedInputWake
                  ? "users/bundles/member-synthetic/selected-input-exact-retry.bundle.json"
                  : "users/bundles/member-synthetic/unrelated-cron-exact-retry.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            freshAssistantInputId = await stageAssistantInputEventForMailboxItem({
              item: item.item,
              vaultRoot,
            });
            return {
              assistantInputId: freshAssistantInputId,
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: assistantInputItem ? [assistantInputItem] : [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(phaseInput) {
            const index = assistantPass;
            assistantPass += 1;
            events.push(`assistant:${expectedPassLabels[index]}:${Date.now()}`);
            if (input.selectedInputWake && index === 0) {
              assert.ok(freshAssistantInputId);
              assert.deepEqual(
                phaseInput.initialAssistantInputBatch?.assistantInputIds
                  ?? phaseInput.initialMailboxImport.importResult.assistantInputIds,
                [freshAssistantInputId],
              );
            }
            if (index > 0) {
              assert.deepEqual(
                phaseInput.assistantCronRetryObligation,
                retryObligation,
              );
            }

            const result = await runHostedWorkspaceAssistantPhase(phaseInput);
            if (input.selectedInputWake && index === 1) {
              assert.ok(freshAssistantInputId);
              await writeSyntheticAssistantAutoReplyTerminalEvidence({
                inputId: freshAssistantInputId,
                vaultRoot,
              });
            }
            const requiredNextWakeAt = requiredNextWakeByPass[index];
            if (requiredNextWakeAt !== undefined) {
              assert.equal(result.nextWakeAt, requiredNextWakeAt);
            }
            assert.equal(
              result.invocationLocalAssistantWakeAt ?? null,
              expectedInvocationWakeByPass[index],
            );
            if (index === passResults.length - 1) {
              assert.equal(
                Object.hasOwn(result, "assistantCronRetryObligation"),
                true,
              );
              assert.equal(result.assistantCronRetryObligation, null);
            } else {
              assert.deepEqual(
                result.assistantCronRetryObligation,
                retryObligation,
              );
            }
            observedPasses[index]?.resolve();
            return result;
          },
          vaultRoot,
        },
      ),
      15_000,
      () => events.join(","),
    );

    await withRealTimeout(observedPasses[0]!.promise, 15_000, () => events.join(","));
    const dueDelays = input.selectedInputWake
      ? [
          SELECTED_INPUT_WAKE_DELAY_MS,
          UNRELATED_CRON_WAKE_DELAY_MS,
          EXACT_RETRY_WAKE_DELAY_MS,
        ]
      : [UNRELATED_CRON_WAKE_DELAY_MS, EXACT_RETRY_WAKE_DELAY_MS];
    let elapsedMs = 0;
    for (const [index, dueDelayMs] of dueDelays.entries()) {
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(dueDelayMs - elapsedMs - 1);
      assert.equal(assistantPass, index + 1);
      assert.ok(!events.includes("snapshot:idle_shutdown"), events.join(","));
      await vi.advanceTimersByTimeAsync(1);
      elapsedMs = dueDelayMs;
      await withRealTimeout(
        observedPasses[index + 1]!.promise,
        15_000,
        () => events.join(","),
      );
      assert.ok(!events.includes("snapshot:idle_shutdown"), events.join(","));
    }

    await waitForFakeTimerScheduled(() => events.join(","));
    await vi.advanceTimersByTimeAsync(IDLE_CHECKPOINT_DELAY_MS);
    await resultPromise;

    assert.equal(assistantPass, passResults.length, events.join(","));
    for (let index = 1; index < expectedPassLabels.length; index += 1) {
      assert.ok(
        requireEventIndex(
          events,
          `assistant:${expectedPassLabels[index - 1]}:${expectedPassAtMs[index - 1]}`,
        ) < requireEventIndex(
          events,
          `assistant:${expectedPassLabels[index]}:${expectedPassAtMs[index]}`,
        ),
        events.join(","),
      );
    }
    assert.ok(
      requireEventIndex(
        events,
        `assistant:exact-retry-a:${Date.parse(retryObligation.retryAt)}`,
      ) < requireEventIndex(events, "snapshot:idle_shutdown"),
      events.join(","),
    );
  } finally {
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
}

describe("hosted workspace exact assistant cron retry", () => {
  test("runs unrelated cron B at T+20 and exact retry A at T+30 before idle checkpoint", async () => {
    await runExactRetrySequence({ selectedInputWake: false });
  });

  test("runs selected input at T+10, cron B at T+20, and exact retry A at T+30", async () => {
    await runExactRetrySequence({ selectedInputWake: true });
  });
});
