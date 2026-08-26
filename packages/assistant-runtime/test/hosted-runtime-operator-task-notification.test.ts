import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  type HostedOperatorTaskControlResponse,
} from "@murphai/hosted-execution";
import {
  sendAssistantNotification,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  executeHostedAssistantNotificationWake,
} from "../src/hosted-runtime/events/assistant-notification.ts";

const mocks = vi.hoisted(() => ({
  sendAssistantNotification: vi.fn(),
}));

vi.mock("@murphai/assistant-engine", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/assistant-engine")>(),
  sendAssistantNotification: mocks.sendAssistantNotification,
}));

type AssistantNotificationInput = Parameters<typeof sendAssistantNotification>[0];

const TASK_ID = "opt_synthetic";
const EVENT_ID = `assistant.notification.requested:operator-task:${TASK_ID}`;
const EXPIRES_AT = "2036-08-25T18:10:00.000Z";
const EXECUTION_CONTEXT: AssistantExecutionContext = {
  hosted: { memberId: "hbm_synthetic", userEnvKeys: [] },
};

beforeEach(() => {
  mocks.sendAssistantNotification.mockReset();
});

describe("hosted operator task notification", () => {
  it("revalidates before provider and outbox, then completes after one queued intent", async () => {
    const controlOperatorTask = vi.fn()
      .mockResolvedValueOnce({ status: "authorized" } satisfies HostedOperatorTaskControlResponse)
      .mockResolvedValueOnce({ status: "authorized" } satisfies HostedOperatorTaskControlResponse)
      .mockResolvedValueOnce({ status: "completed" } satisfies HostedOperatorTaskControlResponse);
    mocks.sendAssistantNotification.mockImplementation(
      async (input: AssistantNotificationInput) => {
        await input.beforeProviderAcceptedInputs?.({
          acceptedInputs: [],
          turnId: "turn_operator_synthetic",
        });
        await input.beforeDelivery?.({
          decision: {
            kind: "send_message",
            privateSummary: "Synthetic operator task.",
            text: "Synthetic member message.",
          },
          response: "Synthetic member message.",
        });
        return {
          decision: {
            kind: "send_message" as const,
            privateSummary: "Synthetic operator task.",
            text: "Synthetic member message.",
          },
          deliveryOutcome: {
            intentId: "intent_operator_synthetic",
            kind: "queued" as const,
            session: { sessionId: "session_operator_synthetic" },
          },
          response: "Synthetic member message.",
          session: { sessionId: "session_operator_synthetic" },
        };
      },
    );

    const outcome = await executeHostedAssistantNotificationWake({
      effectsPort: { controlOperatorTask },
      executionContext: EXECUTION_CONTEXT,
      forceQueueOnly: true,
      sourceMailboxItemId: EVENT_ID,
      vaultRoot: "/synthetic-vault",
      wake: createOperatorMessageWake(),
    });

    expect(outcome.deliveryIntentIds).toEqual(["intent_operator_synthetic"]);
    expect(controlOperatorTask.mock.calls.map(([request]) => request.action))
      .toEqual(["authorize", "authorize", "complete"]);
  });

  it("terminally consumes an expired task before provider admission", async () => {
    const controlOperatorTask = vi.fn().mockResolvedValue(
      { status: "expired" } satisfies HostedOperatorTaskControlResponse,
    );
    let providerStarts = 0;
    mocks.sendAssistantNotification.mockImplementation(
      async (input: AssistantNotificationInput) => {
        await input.beforeProviderAcceptedInputs?.({
          acceptedInputs: [],
          turnId: "turn_operator_expired",
        });
        providerStarts += 1;
        throw new Error("Provider must not start for an expired operator task.");
      },
    );

    const outcome = await executeHostedAssistantNotificationWake({
      effectsPort: { controlOperatorTask },
      executionContext: EXECUTION_CONTEXT,
      forceQueueOnly: true,
      sourceMailboxItemId: EVENT_ID,
      vaultRoot: "/synthetic-vault",
      wake: createOperatorMessageWake(),
    });

    expect(providerStarts).toBe(0);
    expect(outcome.deliveryIntentIds).toEqual([]);
    expect(outcome.redactedLogEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        redacted: expect.objectContaining({
          eventCode: "assistant.notification.operator_task_terminal_no_send",
        }),
      }),
    ]));
  });
});

function createOperatorMessageWake() {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: EVENT_ID,
    memberId: "hbm_synthetic",
    notification: {
      deliveryDedupeToken: EVENT_ID,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: EVENT_ID,
      externalThreadRouteAuthority: {
        accountLookupKey: "account_synthetic",
        channel: "linq",
        containerMemberId: "hbm_synthetic",
        threadId: "thread_synthetic",
      },
      instructions: "Author one natural in-chat continuation.",
      notificationPromptProfile: "operator-message",
      operatorTask: { expiresAt: EXPIRES_AT, taskId: TASK_ID },
      responsePolicy: { kind: "require_send" },
      route: {
        actorId: null,
        channel: "linq",
        delivery: { kind: "explicit", target: "thread_synthetic" },
        identityId: "identity_synthetic",
        threadId: "thread_synthetic",
        threadIsDirect: true,
      },
    },
    occurredAt: "2036-08-25T18:00:00.000Z",
  });
}
