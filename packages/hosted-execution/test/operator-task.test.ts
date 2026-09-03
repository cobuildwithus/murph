import { describe, expect, it } from "vitest";

import {
  buildHostedExecutionAssistantAskRequestedWake,
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "../src/builders.ts";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_REQUEST_TTL_MS,
  HOSTED_EXECUTION_OPERATOR_DIAGNOSTIC_PERMISSION_TEXT,
} from "../src/contracts.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";
import {
  parseHostedOperatorTaskControlRequest,
  parseHostedOperatorTaskControlResponse,
} from "../src/operator-task-control.ts";

describe("hosted operator task contracts", () => {
  it("keeps the diagnostic permission scoped to one read-only target workspace", () => {
    expect(HOSTED_EXECUTION_OPERATOR_DIAGNOSTIC_PERMISSION_TEXT).toMatch(
      /targeted Murph workspace/u,
    );
    expect(HOSTED_EXECUTION_OPERATOR_DIAGNOSTIC_PERMISSION_TEXT).toMatch(
      /available read-only tools/u,
    );
    expect(HOSTED_EXECUTION_OPERATOR_DIAGNOSTIC_PERMISSION_TEXT).toMatch(
      /only to the authorized operator/u,
    );
    expect(HOSTED_EXECUTION_OPERATOR_DIAGNOSTIC_PERMISSION_TEXT).not.toMatch(
      /invoke tools/u,
    );
  });

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
      eventId: "assistant.notification.requested:operator-task:opt_synthetic",
      memberId: "hbm_synthetic",
      notification: {
        deliveryDedupeToken:
          "assistant.notification.requested:operator-task:opt_synthetic",
        deliveryDispatchMode: "queue-only",
        deliveryIdempotencyKey:
          "assistant.notification.requested:operator-task:opt_synthetic",
        externalThreadRouteAuthority: {
          accountLookupKey: "account_synthetic",
          channel: "telegram",
          containerMemberId: "hbm_synthetic",
          threadId: "thread_synthetic",
        },
        instructions: "Author one natural direct message.",
        notificationPromptProfile: "operator-message",
        operatorTask: {
          expiresAt: "2026-08-25T18:10:00.000Z",
          taskId: "opt_synthetic",
        },
        responsePolicy: { kind: "require_send" },
        route: {
          actorId: null,
          channel: "telegram",
          delivery: { kind: "explicit", target: "thread_synthetic" },
          identityId: null,
          threadId: "thread_synthetic",
          threadIsDirect: true,
        },
      },
      occurredAt: "2026-08-25T18:00:00.000Z",
    });

    expect(parseHostedExecutionWake(wake)).toEqual(wake);
  });

  it("parses the closed runtime control contract", () => {
    expect(parseHostedOperatorTaskControlRequest({
      action: "authorize",
      expiresAt: "2036-08-25T18:10:00.000Z",
      requestId: "assistant.notification.requested:operator-task:opt_synthetic",
      taskId: "opt_synthetic",
    })).toEqual({
      action: "authorize",
      expiresAt: "2036-08-25T18:10:00.000Z",
      requestId: "assistant.notification.requested:operator-task:opt_synthetic",
      taskId: "opt_synthetic",
    });
    expect(parseHostedOperatorTaskControlResponse({ status: "completed" }))
      .toEqual({ status: "completed" });
    expect(parseHostedOperatorTaskControlResponse({ status: "failed" }))
      .toEqual({ status: "failed" });
  });
});
