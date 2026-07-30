import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  listAssistantOutboxIntents,
  resolveAssistantSession,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine";
import { createDefaultLocalAssistantModelTarget } from "@murphai/operator-config/assistant-backend";
import {
  buildHostedExecutionAssistantAskCompletedWake,
  createHostedExecutionReviewedAssistantAskCompletionDeliveryKey,
  HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
} from "@murphai/hosted-execution";

import {
  executeHostedAssistantAskCompletedWake,
} from "../src/hosted-runtime/events/assistant-ask-completion.ts";

describe("hosted Assistant Ask completion production", () => {
  it("persists Telegram authority on the fixed non-disclosing fallback", async () => {
    const vault = await mkdtemp(
      path.join(os.tmpdir(), "hosted-assistant-ask-telegram-outbox-"),
    );

    try {
      const threadId = "telegram_group_completion";
      const origin = await upsertAssistantInputEvent({
        event: {
          content: { text: "Murph, tell them about my sleep." },
          conversation: {
            accountId: null,
            actorId: "telegram_sender",
            actorIsSelf: false,
            source: "telegram",
            threadId,
            threadIsDirect: false,
          },
          occurredAt: "2026-07-15T11:00:00.000Z",
          replyTarget: {
            channel: "telegram",
            messageId: "1234",
            threadId,
          },
          sourceMetadata: {
            externalThreadRouteAuthorityPresent: true,
            kind: "telegram",
            mediaGroupId: null,
            replyContext: null,
          },
          sourceRef: {
            causalSeq: null,
            dedupeKey: "dedupe-telegram-completion",
            eventId: "event-telegram-completion",
            itemId: "item-telegram-completion",
            kind: "hosted-mailbox",
            lane: "conversation",
            laneSeq: "1",
            payloadSchema: "murph.hosted-mailbox-item.v1",
            payloadSource: "inline",
            source: "hosted-mailbox",
            wakeSchema: "murph.hosted-execution-wake.v1",
          },
        },
        vault,
      });
      const resolved = await resolveAssistantSession({
        actorId: "telegram_sender",
        bindingDeliveryTarget: threadId,
        channel: "telegram",
        target: createDefaultLocalAssistantModelTarget(),
        threadId,
        threadIsDirect: false,
        vault,
      });
      const eventId = "aask_done_telegram_completion_outbox";
      const deliveryIdempotencyKey =
        createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
          eventId,
        );
      const wake = buildHostedExecutionAssistantAskCompletedWake({
        ask: {
          expiresAt: "2099-07-15T12:10:00.000Z",
          origin: {
            assistantInputId: origin.inputId,
            kind: "accepted_input",
            sessionId: resolved.session.sessionId,
          },
          question: "Murph, tell them about my sleep.",
          requestId: "aask_req_telegram_completion_outbox",
          result: {
            answer: null,
            outcome: "cannot_answer",
          },
          targetLabel: null,
        },
        eventId,
        memberId: "member-telegram-group-runtime",
        occurredAt: "2026-07-15T12:05:00.000Z",
      });
      await executeHostedAssistantAskCompletedWake({
        executionContext: {
          hosted: {
            defaultTarget: createDefaultLocalAssistantModelTarget(),
            memberId: "member-telegram-group-runtime",
            userEnvKeys: [],
          },
        },
        sourceMailboxItemId: eventId,
        vaultRoot: vault,
        wake,
      });

      expect(await listAssistantOutboxIntents(vault)).toEqual([
        expect.objectContaining({
          answeredMailboxItemIds: [eventId],
          bindingDelivery: {
            kind: "thread",
            target: threadId,
          },
          channel: "telegram",
          deliveryIdempotencyKey,
          externalThreadRouteAuthority: {
            channel: "telegram",
            containerMemberId: "member-telegram-group-runtime",
            threadId,
          },
          message: HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
          reviewedAssistantAskCompletionExpiresAt:
            "2099-07-15T12:10:00.000Z",
          status: "pending",
          threadId,
          threadIsDirect: false,
        }),
      ]);
    } finally {
      await rm(vault, { force: true, recursive: true });
    }
  });
});
