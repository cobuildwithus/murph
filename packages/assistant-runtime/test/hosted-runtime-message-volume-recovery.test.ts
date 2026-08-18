import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createAssistantOutboxIntent,
  readAssistantOutboxIntent,
  saveAssistantOutboxIntent,
} from "@murphai/assistant-engine";

import {
  drainHostedAssistantDeliveryControlPlaneWritesBestEffort,
  queueHostedAssistantPendingMessageVolumeReceiptsForVault,
} from "../src/hosted-runtime/callbacks.ts";

describe("hosted message-volume receipt recovery", () => {
  it("acknowledges a persisted due receipt once without redispatching the provider", async () => {
    const testTempRoot = process.env.MURPH_VITEST_TEMP_ROOT;
    if (!testTempRoot) {
      throw new Error("MURPH_VITEST_TEMP_ROOT is required.");
    }
    const vaultRoot = await mkdtemp(
      path.join(testTempRoot, "hosted-message-volume-recovery-"),
    );

    try {
      const sentAt = "2026-08-15T19:20:00.000Z";
      const recordedAt = "2026-08-15T19:20:01.000Z";
      const intent = await createAssistantOutboxIntent({
        channel: "telegram",
        createdAt: "2026-08-15T19:19:00.000Z",
        explicitTarget: "telegram-thread-1",
        message: "A persisted reply awaiting its volume receipt.",
        sessionId: "session_message_volume_recovery",
        threadId: "telegram-thread-1",
        threadIsDirect: true,
        turnId: "turn_message_volume_recovery",
        vault: vaultRoot,
      });
      await saveAssistantOutboxIntent(vaultRoot, {
        ...intent,
        attemptCount: 1,
        delivery: {
          channel: "telegram",
          idempotencyKey: `assistant-outbox:${intent.intentId}`,
          messageLength: intent.message.length,
          providerMessageId: "telegram-provider-message-1",
          providerThreadId: "telegram-thread-1",
          sentAt,
          target: "telegram-thread-1",
          targetKind: "thread",
        },
        lastAttemptAt: sentAt,
        messageVolumeReceiptRecordedAt: null,
        nextAttemptAt: sentAt,
        sentAt,
        status: "sent",
        updatedAt: sentAt,
      });
      const recordOutboundMessageVolumeReceipt = vi.fn(async () => ({
        recordedAt,
      }));

      await expect(queueHostedAssistantPendingMessageVolumeReceiptsForVault({
        effectsPort: { recordOutboundMessageVolumeReceipt },
        now: new Date("2026-08-15T19:21:00.000Z"),
        vaultRoot,
      })).resolves.toBe(1);
      await drainHostedAssistantDeliveryControlPlaneWritesBestEffort();

      await expect(readAssistantOutboxIntent(vaultRoot, intent.intentId))
        .resolves.toMatchObject({
          messageVolumeReceiptRecordedAt: recordedAt,
          nextAttemptAt: null,
          status: "sent",
        });
      await expect(queueHostedAssistantPendingMessageVolumeReceiptsForVault({
        effectsPort: { recordOutboundMessageVolumeReceipt },
        now: new Date("2026-08-15T19:22:00.000Z"),
        vaultRoot,
      })).resolves.toBe(0);
      expect(recordOutboundMessageVolumeReceipt).toHaveBeenCalledOnce();
      expect(recordOutboundMessageVolumeReceipt).toHaveBeenCalledWith({
        channel: "telegram",
        dedupeKey: intent.dedupeKey,
      }, {
        signal: expect.any(AbortSignal),
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });
});
