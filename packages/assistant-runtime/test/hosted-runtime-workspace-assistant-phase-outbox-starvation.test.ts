import {
  createDueAssistantWorkspace,
  createPhaseInput,
  createSentDeliveryOutcome,
  loadHostedSystemMailboxRealImplementation,
  mocks,
  runHostedWorkspaceAssistantPhase,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import { buildHostedExecutionMealPhotoCapturedWake } from "@murphai/hosted-execution";
import {
  createAssistantOutboxIntent,
  listAssistantOutboxIntents,
  markAssistantContextSnapshotDirty,
  markAssistantOutboxIntentSentById,
  refreshAssistantContextSnapshot,
} from "@murphai/assistant-engine";
import { expect, test, vi } from "vitest";
import { hostedSystemMailboxWakeIsDueForModelFreeOwner } from "../src/hosted-runtime/wake-candidates.ts";
import { executeHostedManualMealPhotoWake } from "../src/hosted-runtime/events/assistant-notification.ts";
import { createNoopMailboxEffect } from "../src/hosted-runtime/events/mailbox-outcome.ts";

vi.mock("../src/hosted-runtime/events/assistant-notification.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/hosted-runtime/events/assistant-notification.ts")>(),
  executeHostedManualMealPhotoWake: vi.fn(),
}));

const NOW = "2026-04-27T00:10:00.000Z";
const IMPORTED_AT = "2026-04-27T00:00:00.000Z";
const TOMORROW = "2026-04-28T05:00:00.000Z";

test.each(["dirty-context", "clean-context", "due-cron"] as const)(
  "delivers an uncollected notification on the next default pass with a recording device owner: %s",
  async (shape) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-outbox-starvation-"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    try {
      await initializeVault({ createdAt: IMPORTED_AT, vaultRoot });
      const callbacks = await vi.importActual<typeof import("../src/hosted-runtime/callbacks.ts")>(
        "../src/hosted-runtime/callbacks.ts",
      );
      const mailbox = await vi.importActual<typeof import("../src/hosted-runtime/system-mailbox-state.ts")>(
        "../src/hosted-runtime/system-mailbox-state.ts",
      );
      const engine = await vi.importActual<typeof import("@murphai/assistant-engine")>("@murphai/assistant-engine");
      const system = await loadHostedSystemMailboxRealImplementation();
      mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(mailbox.resolveHostedSystemMailboxNextWakeCandidate);
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(system.prepareHostedSystemMailboxItemForCheckpoint);
      mocks.resolveHostedAssistantOutboxNextWakeAt.mockImplementation(callbacks.resolveHostedAssistantOutboxNextWakeAt);
      mocks.collectHostedAssistantDeliverySideEffects.mockImplementation(callbacks.collectHostedAssistantDeliverySideEffects);
      mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockImplementation(callbacks.prepareHostedAssistantDeliveryEffectsForDispatch);
      mocks.readAssistantOutboxIntent.mockImplementation(engine.readAssistantOutboxIntent);
      const workspace = createDueAssistantWorkspace({
        nextWakeAt: IMPORTED_AT, nextWakeReason: "assistant",
        nextDefaultProcessingWakeAt: IMPORTED_AT, nextDefaultProcessingWakeReason: "assistant",
        systemMailboxProgressGeneration: "1",
      });
      const phase = createPhaseInput({ importedCount: 0, now: () => NOW, vaultRoot, workspace });
      const notification = await createAssistantOutboxIntent({
        bindingDelivery: { kind: "thread", target: "synthetic_chat" },
        channel: "linq", createdAt: "2026-04-27T00:03:00.000Z",
        deliveryIdempotencyKey: "assistant.notification.requested:meal-photo:manual:synthetic_capture",
        deliveryTransportIdempotent: true, message: "Synthetic meal notification ready to deliver.",
        sessionId: "synthetic_notification_session", threadId: "synthetic_chat",
        threadIsDirect: true, turnId: "synthetic_notification_turn", vault: vaultRoot,
      });
      expect(notification).toMatchObject({ status: "pending", attemptCount: 0, lastError: null,
        delivery: null, deliveryConfirmationPending: false, media: [], deliverySource: null,
        automationAuthority: null, scheduledOccurrenceAt: null });
      // The notification turn yielded before collection. It has no preferred
      // identity in any later reply turn, despite sharing the same chat.
      expect(await callbacks.collectHostedAssistantDeliverySideEffects({
        includeBackgroundDueIntents: false, platform: phase.runtime.platform, vaultRoot,
      })).toEqual([]);
      for (let reply = 0; reply < 8; reply += 1) {
        const intent = await createAssistantOutboxIntent({
          bindingDelivery: notification.bindingDelivery, channel: "linq", createdAt: NOW,
          deliveryTransportIdempotent: true, message: "Synthetic reply " + reply,
          sessionId: "synthetic_conversation_session", threadId: "synthetic_chat", threadIsDirect: true,
          turnId: "synthetic_reply_turn_" + reply, vault: vaultRoot,
        });
        for (const includeBackgroundDueIntents of [false, true]) {
          const effects = await callbacks.collectHostedAssistantDeliverySideEffects({
            includeBackgroundDueIntents, platform: phase.runtime.platform,
            preferredIntentIds: [intent.intentId], vaultRoot,
          });
          expect(effects.map((effect) => effect.effectId)).toEqual([intent.intentId]);
        }
        await markSent(intent.intentId);
      }
      expect(await callbacks.resolveHostedAssistantOutboxNextWakeAt({ vaultRoot, now: new Date(NOW) }))
        .toBe(notification.nextAttemptAt);
      await mailbox.updateHostedSystemMailboxState(vaultRoot, () => ({ pending: [{
        attemptCount: 20, deviceSyncContinuationOwner: true,
        itemId: "synthetic_device_continuation", lastAttemptAt: IMPORTED_AT,
        lastErrorCode: null, lastErrorMessage: null,
        mailboxDedupeKey: "device-sync.wake:synthetic_continuation", mailboxLaneSeq: "1",
        nextAttemptAt: null, occurredAt: "2026-04-20T00:00:00.000Z", requestId: null,
        routeAction: "run-device-sync-wake", status: "recording",
        wake: { kind: "device-sync.wake", eventId: "device-sync.wake:synthetic_continuation",
          occurredAt: IMPORTED_AT, reason: "reconcile_due", userId: "member_synthetic_phase" },
        postCheckpointRecord: { kind: "device-sync.dirty-processed-batch", records: [],
          nextWakeAt: TOMORROW, retainMailboxItemUntil: "2026-04-27T06:00:00.000Z",
          retainedWake: { kind: "device-sync.wake", eventId: "device-sync.wake:synthetic_continuation",
            occurredAt: IMPORTED_AT, reason: "reconcile_due", userId: "member_synthetic_phase",
            connectionId: "synthetic_connection", hint: { reason: "manual_reconcile",
              nextReconcileAt: "2026-04-27T06:00:00.000Z", jobs: [{ kind: "resource",
              dedupeKey: "synthetic_future_sleep", availableAt: TOMORROW, maxAttempts: 3,
              payload: { resource: "sleep", resourceCategory: "summary", sourceProviderSlug: "whoop_v2",
                windowStart: IMPORTED_AT, windowEnd: NOW } }] } },
        },
      }] }));
      const owner = await mailbox.resolveHostedSystemMailboxNextWakeCandidate({ vaultRoot, now: () => NOW });
      expect(hostedSystemMailboxWakeIsDueForModelFreeOwner(owner, Date.parse(NOW))).toBe(true);
      await refreshAssistantContextSnapshot({ vaultRoot, now: () => NOW });
      mocks.drainHostedPreparedAssistantDeliveries.mockImplementation(async (input) => {
        const outcomes = [];
        for (const prepared of input.preparedDispatches) {
          await markSent(prepared.intentId);
          outcomes.push({ ...createSentDeliveryOutcome(), deliveryChannel: "linq",
            effectId: prepared.intentId });
        }
        return outcomes;
      });
      const statuses: string[] = [];
      const results = [];
      for (let pass = 0; pass < 2; pass += 1) {
        if (shape !== "clean-context") {
          // Canonical event-ledger writes invalidate these context domains.
          await markAssistantContextSnapshotDirty({ domains: ["blood_tests", "journal_plans"], vaultRoot });
        }
        if (shape === "due-cron") {
          mocks.getAssistantCronStatus.mockResolvedValue({ dueJobs: 1, enabledJobs: 1,
            nextRunAt: NOW, runningJobs: 0, totalJobs: 1 });
        }
        const result = await runHostedWorkspaceAssistantPhase(phase);
        const postCheckpoint = await result.afterCheckpoint?.();
        if (pass === 0 && postCheckpoint) {
          expect(postCheckpoint.nextWakeAt).not.toBe(IMPORTED_AT);
        }
        if (pass === 1 && shape !== "due-cron" && statuses[0] === "sent") {
          expect(result.runtimeProjectionCheckpointRequested).toBe(true);
        }
        results.push({ checkpoint: result.checkpointReason, wake: result.nextWakeReason });
        statuses.push((await listAssistantOutboxIntents(vaultRoot)).find(
          (intent) => intent.intentId === notification.intentId,
        )!.status);
      }
      expect(statuses, JSON.stringify({ shape, results })).toEqual(["sent", "sent"]);
      expect(mocks.drainHostedPreparedAssistantDeliveries).toHaveBeenCalledTimes(1);
      expect(await callbacks.resolveHostedAssistantOutboxNextWakeAt({ vaultRoot, now: new Date(NOW) })).toBeNull();
      async function markSent(intentId: string) {
        await markAssistantOutboxIntentSentById({ intentId, vault: vaultRoot, delivery: {
          channel: "linq", idempotencyKey: "synthetic_delivery_" + intentId, messageLength: 10,
          providerMessageId: "synthetic_provider_" + intentId, providerThreadId: "synthetic_chat",
          sentAt: NOW, target: "synthetic_chat", targetKind: "thread",
        } });
      }
    } finally {
      vi.useRealTimers();
      await rm(vaultRoot, { force: true, recursive: true });
    }
  },
);

test.each(["manual-meal", "unrelated-notification"] as const)(
  "keeps the due cron preflight exception scoped to member meal work: %s",
  async (shape) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-meal-cron-priority-"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    try {
      await initializeVault({ createdAt: IMPORTED_AT, vaultRoot });
      const mailbox = await vi.importActual<typeof import("../src/hosted-runtime/system-mailbox-state.ts")>(
        "../src/hosted-runtime/system-mailbox-state.ts",
      );
      const system = await loadHostedSystemMailboxRealImplementation();
      mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(mailbox.resolveHostedSystemMailboxNextWakeCandidate);
      mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(system.prepareHostedSystemMailboxItemForCheckpoint);
      mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementation(system.recordHostedSystemMailboxItemAfterCheckpoint);
      mocks.getAssistantCronStatus.mockResolvedValue({ dueJobs: 1, enabledJobs: 1,
        nextRunAt: NOW, runningJobs: 0, totalJobs: 1 });
      const order: string[] = [];
      vi.mocked(executeHostedManualMealPhotoWake).mockImplementation(async () => {
        order.push("meal");
        return createNoopMailboxEffect({ conversationMetrics: null, mailboxLane: "assistant-notification" });
      });
      const automation = mocks.runHostedAssistantAutomationLane.getMockImplementation()!;
      mocks.runHostedAssistantAutomationLane.mockImplementation(async (...args) => {
        order.push("cron");
        return automation(...args);
      });
      const wake = buildHostedExecutionMealPhotoCapturedWake({ byteLength: 4,
        captureId: "c".repeat(64), capturedAt: IMPORTED_AT,
        directRoute: { channel: "linq", threadId: "synthetic_meal_chat" },
        eventId: "meal-photo:manual:" + "c".repeat(64), mealPhotoKey: "synthetic_photo_key",
        memberId: "member_synthetic_phase", occurredAt: IMPORTED_AT, sha256: "a".repeat(64) });
      await mailbox.updateHostedSystemMailboxState(vaultRoot, () => ({ pending: [{
        attemptCount: 0, itemId: "synthetic_notification", lastAttemptAt: null,
        lastErrorCode: null, lastErrorMessage: null, mailboxDedupeKey: wake.eventId,
        mailboxLaneSeq: "1", nextAttemptAt: null, occurredAt: IMPORTED_AT,
        postCheckpointRecord: null, requestId: null, routeAction: "dispatch-assistant-notification",
        status: "pending", wake: shape === "manual-meal" ? wake : {
          kind: "assistant.notification.requested", eventId: "synthetic_background_notification",
          occurredAt: IMPORTED_AT, userId: "member_synthetic_phase",
          notification: { instructions: "Synthetic background task.", route: {
            actorId: null, channel: "linq", identityId: null,
            delivery: { kind: "thread", target: "synthetic_background_chat" },
            threadId: "synthetic_background_chat", threadIsDirect: true,
          } },
        },
      }] }));
      const result = await runHostedWorkspaceAssistantPhase(createPhaseInput({
        importedCount: 0, now: () => NOW, vaultRoot,
        workspace: createDueAssistantWorkspace({ systemMailboxProgressGeneration: "1",
          nextDefaultProcessingWakeAt: IMPORTED_AT, nextDefaultProcessingWakeReason: "assistant" }),
      }));
      await result.afterCheckpoint?.();
      expect(order).toEqual(shape === "manual-meal" ? ["meal", "cron"] : ["cron"]);
      expect((await mailbox.readHostedSystemMailboxState(vaultRoot)).pending).toHaveLength(
        shape === "manual-meal" ? 0 : 1,
      );
    } finally {
      vi.useRealTimers();
      await rm(vaultRoot, { force: true, recursive: true });
    }
  },
);
