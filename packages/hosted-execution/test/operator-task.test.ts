import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantAskRequestedWake,
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "../src/builders.ts";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
} from "../src/contracts.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";

describe("hosted operator task contracts", () => {
  it("round trips the closed read-only operator task target", () => {
    const occurredAt = "2026-08-25T18:00:00.000Z";
    const wake = buildHostedExecutionAssistantAskRequestedWake({
      ask: {
        expiresAt: new Date(
          Date.parse(occurredAt) + HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
        ).toISOString(),
        question: "Inspect the selected automation identity.",
        target: { kind: "operator_task", taskId: "opt_synthetic" },
      },
      eventId: `aask_req_${"a".repeat(64)}`,
      memberId: "hbm_synthetic",
      occurredAt,
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
  });

  it("accepts the message-only operator prompt profile", () => {
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant.notification.requested:operator-task:synthetic",
      memberId: "hbm_synthetic",
      notification: {
        instructions: "Write one natural direct message.",
        notificationPromptProfile: "operator-message",
        responsePolicy: { kind: "require_send" },
        route: {
          actorId: null,
          channel: "telegram",
          delivery: { kind: "thread", target: "thread_synthetic" },
          identityId: null,
          threadId: "thread_synthetic",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-08-25T18:00:00.000Z",
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
  });
});
