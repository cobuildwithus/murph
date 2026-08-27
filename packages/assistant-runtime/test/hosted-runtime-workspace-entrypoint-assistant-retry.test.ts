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
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import {
  runHostedWorkspaceRuntimeJobInProcess,
} from "../src/hosted-runtime.ts";
import {
  runHostedWorkspaceAssistantPhase,
} from "../src/hosted-runtime/workspace-assistant-phase.ts";

describe("hosted workspace assistant retry projection", () => {
  test("preserves an exact cron retry after an earlier invocation-local hot wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-assistant-retry-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    const assistantThreeObserved = createDeferred<void>();
    const idleCheckpointDelayMs = 180_000;
    const earlierWakeDelayMs = 10_000;
    const retryWakeDelayMs = 30_000;
    const earlierWakeAt = new Date(
      Date.parse(TEST_NOW) + earlierWakeDelayMs,
    ).toISOString();
    const retryWakeAt = new Date(
      Date.parse(TEST_NOW) + retryWakeDelayMs,
    ).toISOString();
    const assistantInputItem = createMailboxItem({
      dedupeKey: "dedupe_scheduled_cron_retry_competing_hot_wake",
      id: "mailbox_item_scheduled_cron_retry_competing_hot_wake",
    });
    let assistantPass = 0;
    let freshAssistantInputId: string | null = null;

    mocks.runAssistantAutomationPass
      .mockResolvedValueOnce({
        cronProcessed: 1,
        cronRetryWakeAt: retryWakeAt,
        currentTurnDeliveryIntentIds: [],
        nextWakeAt: earlierWakeAt,
        outboxAttempted: 0,
        progressed: true,
        replies: {
          considered: 1,
          failed: 1,
          nextWakeAt: earlierWakeAt,
          replied: 0,
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
      })
      .mockResolvedValueOnce({
        cronProcessed: 0,
        currentTurnDeliveryIntentIds: [],
        nextWakeAt: retryWakeAt,
        outboxAttempted: 0,
        progressed: false,
        replies: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          replied: 0,
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
      })
      .mockResolvedValueOnce({
        cronProcessed: 1,
        currentTurnDeliveryIntentIds: [],
        nextWakeAt: null,
        outboxAttempted: 0,
        progressed: true,
        replies: {
          considered: 0,
          failed: 0,
          nextWakeAt: null,
          replied: 0,
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
      });

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_scheduled_cron_retry_competing_hot_wake",
              idleCheckpointDelayMs,
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
                  key: "users/bundles/member-synthetic/scheduled-cron-retry-competing.bundle.json",
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
                items: [assistantInputItem],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);
              if (assistantPass === 1) {
                assert.ok(freshAssistantInputId);
                assert.deepEqual(
                  input.initialAssistantInputBatch?.assistantInputIds
                    ?? input.initialMailboxImport.importResult.assistantInputIds,
                  [freshAssistantInputId],
                );
              }
              const result = await runHostedWorkspaceAssistantPhase(input);

              if (assistantPass === 1) {
                assert.equal(result.nextWakeAt, earlierWakeAt);
                assert.equal(result.invocationLocalAssistantWakeAt, earlierWakeAt);
                assert.equal(
                  result.invocationLocalAssistantCronRetrySuccessorWakeAt,
                  retryWakeAt,
                );
                assistantOneObserved.resolve();
              } else if (assistantPass === 2) {
                assert.equal(input.workspace?.nextWakeAt, earlierWakeAt);
                assert.equal(result.nextWakeAt, retryWakeAt);
                assert.equal(result.invocationLocalAssistantWakeAt, undefined);
                assert.equal(
                  result.invocationLocalAssistantCronRetrySuccessorWakeAt,
                  undefined,
                );
                assistantTwoObserved.resolve();
              } else if (assistantPass === 3) {
                assert.equal(input.workspace?.nextWakeAt, retryWakeAt);
                assistantThreeObserved.resolve();
              } else {
                throw new Error("Competing cron retry should require exactly two hot wakes.");
              }

              return result;
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(earlierWakeDelayMs - 1);
      assert.equal(assistantPass, 1);
      assert.ok(!events.includes("snapshot:idle_shutdown"), events.join(","));
      await vi.advanceTimersByTimeAsync(1);
      await withRealTimeout(assistantTwoObserved.promise, 15_000, () => events.join(","));
      assert.ok(!events.includes("snapshot:idle_shutdown"), events.join(","));

      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(retryWakeDelayMs - earlierWakeDelayMs - 1);
      assert.equal(assistantPass, 2);
      assert.ok(!events.includes("snapshot:idle_shutdown"), events.join(","));
      await vi.advanceTimersByTimeAsync(1);
      await withRealTimeout(assistantThreeObserved.promise, 15_000, () => events.join(","));
      assert.ok(!events.includes("snapshot:idle_shutdown"), events.join(","));

      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(idleCheckpointDelayMs);
      const result = await resultPromise;

      assert.equal(assistantPass, 3, events.join(","));
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(events, "assistant:3"),
        events.join(","),
      );
      assert.ok(
        requireEventIndex(events, "assistant:3")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
        events.join(","),
      );
      assert.equal(result.status, "scheduled");
      assert.ok(result.nextWakeAt);
      assert.ok(
        Date.parse(result.nextWakeAt) > Date.parse(retryWakeAt),
        events.join(","),
      );
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });
});
