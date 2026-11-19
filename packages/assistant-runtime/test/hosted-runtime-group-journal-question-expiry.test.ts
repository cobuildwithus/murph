import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_GROUP_JOURNAL_EVENT_ID_PREFIX,
  HOSTED_RUNTIME_GROUP_JOURNAL_QUESTION_TTL_MS,
} from "@murphai/hosted-execution/runtime-control";
import {
  sendAssistantNotification,
  type AssistantExecutionContext,
} from "@murphai/assistant-engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  executeHostedAssistantNotificationWake,
} from "../src/hosted-runtime/events/assistant-notification.ts";
import {
  executeHostedMailboxEvent,
} from "../src/hosted-runtime/events.ts";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";
import {
  prepareHostedSystemMailboxItemForCheckpoint,
  restoreHostedSystemMailboxCheckpointRollbackState,
} from "../src/hosted-runtime/system-mailbox.ts";
import {
  readHostedSystemMailboxState,
  resolveHostedSystemMailboxHandledThroughSeq,
  type HostedSystemMailboxPendingItem,
} from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  createHostedRuntimeResolvedConfig,
  createHostedRuntimeWorkspace,
} from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  executeHostedMailboxEvent: vi.fn(),
  sendAssistantNotification: vi.fn(),
}));

vi.mock("@murphai/assistant-engine", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/assistant-engine")>(),
  sendAssistantNotification: mocks.sendAssistantNotification,
}));

vi.mock("../src/hosted-runtime/events.ts", () => ({
  executeHostedMailboxEvent: mocks.executeHostedMailboxEvent,
}));

type AssistantNotificationInput = Parameters<
  typeof sendAssistantNotification
>[0];
type HostedMailboxEventInput = Parameters<typeof executeHostedMailboxEvent>[0];

const OCCURRED_AT = "2036-09-14T08:30:00.000Z";
const EXPIRES_AT = new Date(
  Date.parse(OCCURRED_AT) + HOSTED_RUNTIME_GROUP_JOURNAL_QUESTION_TTL_MS,
).toISOString();
const BEFORE_EXPIRY = new Date(Date.parse(EXPIRES_AT) - 1).toISOString();
const EVENT_ID = `${HOSTED_RUNTIME_GROUP_JOURNAL_EVENT_ID_PREFIX}${"c".repeat(64)}`;
const MAILBOX_ITEM_ID = "mailbox_group_journal_question_synthetic";
const EXECUTION_CONTEXT: AssistantExecutionContext = {
  hosted: {
    memberId: "member_synthetic",
    userEnvKeys: [],
  },
};
const DELIVERY_SENTINEL = new Error("Synthetic delivery start sentinel.");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BEFORE_EXPIRY);
  mocks.executeHostedMailboxEvent.mockReset();
  mocks.sendAssistantNotification.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("hosted group Journal question expiry", () => {
  it("delivers until the final millisecond of the window", async () => {
    let deliveryStarts = 0;
    mocks.sendAssistantNotification.mockImplementation(
      async (input: AssistantNotificationInput) => {
        await runBeforeDelivery(input);
        deliveryStarts += 1;
        throw DELIVERY_SENTINEL;
      },
    );

    await expect(executeQuestionWake(createQuestionWake(EVENT_ID)))
      .rejects.toBe(DELIVERY_SENTINEL);
    expect(deliveryStarts).toBe(1);
  });

  it("ends without delivery once the window elapses", async () => {
    vi.setSystemTime(EXPIRES_AT);
    let deliveryStarts = 0;
    mocks.sendAssistantNotification.mockImplementation(
      async (input: AssistantNotificationInput) => {
        await runBeforeDelivery(input);
        deliveryStarts += 1;
        throw new Error("Delivery should not start after the window.");
      },
    );

    const result = await executeQuestionWake(createQuestionWake(EVENT_ID));

    expect(deliveryStarts).toBe(0);
    expect(result).toMatchObject({
      deliveryIntentIds: [],
      mailboxLane: "assistant-notification",
      redactedLogEntries: expect.arrayContaining([
        expect.objectContaining({
          redacted: expect.objectContaining({
            eventCode:
              "assistant.notification.group_journal_question_expired_terminal_no_send",
            terminalDisposition: "group_journal_question_expired",
          }),
        }),
      ]),
    });
  });

  it("leaves other exact-text notifications on their own lifetime", async () => {
    vi.setSystemTime(EXPIRES_AT);
    let deliveryStarts = 0;
    mocks.sendAssistantNotification.mockImplementation(
      async (input: AssistantNotificationInput) => {
        await runBeforeDelivery(input);
        deliveryStarts += 1;
        throw DELIVERY_SENTINEL;
      },
    );

    await expect(executeQuestionWake(
      createQuestionWake("assistant.notification.requested:synthetic-exact"),
    )).rejects.toBe(DELIVERY_SENTINEL);
    expect(deliveryStarts).toBe(1);
  });

  it("advances the system lane past a question that waited out the window", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-hosted-group-journal-question-expiry-",
    );
    vi.setSystemTime(EXPIRES_AT);
    const item = createPendingQuestionItem();
    let deliveryStarts = 0;
    mocks.sendAssistantNotification.mockImplementation(
      async (input: AssistantNotificationInput) => {
        await runBeforeDelivery(input);
        deliveryStarts += 1;
        throw new Error("Delivery should not start after the window.");
      },
    );
    mocks.executeHostedMailboxEvent.mockImplementation(
      async (eventInput: HostedMailboxEventInput) => {
        if (
          eventInput.wake.kind !== "assistant.notification.requested"
          || eventInput.executionContext === null
        ) {
          throw new TypeError("Expected an assistant notification event.");
        }
        return await executeHostedAssistantNotificationWake({
          executionContext: eventInput.executionContext,
          forceQueueOnly:
            eventInput.forceQueueOnlyAssistantNotification === true,
          sourceMailboxItemId: eventInput.sourceMailboxItemId ?? null,
          vaultRoot: eventInput.vaultRoot,
          wake: eventInput.wake,
        });
      },
    );

    try {
      await restoreHostedSystemMailboxCheckpointRollbackState({
        state: { pending: [item] },
        vaultRoot: workspace.vaultRoot,
      });
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "1",
        now: EXPIRES_AT,
        state: await readHostedSystemMailboxState(workspace.vaultRoot),
      })).toBe("0");

      const result = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: EXECUTION_CONTEXT,
        now: () => EXPIRES_AT,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      expect(result).toMatchObject({
        itemId: MAILBOX_ITEM_ID,
        metrics: { deliveryIntentIds: [] },
        status: "processed",
      });
      expect(deliveryStarts).toBe(0);
      const after = await readHostedSystemMailboxState(workspace.vaultRoot);
      expect(after.pending).toEqual([]);
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "1",
        now: EXPIRES_AT,
        state: after,
      })).toBe("1");
    } finally {
      await workspace.cleanup();
    }
  });
});

async function runBeforeDelivery(
  input: AssistantNotificationInput,
): Promise<void> {
  await input.beforeDelivery?.({
    decision: {
      kind: "send_message",
      privateSummary: "Sent required exact notification text.",
      text: "Synthetic question?",
    },
    deliveryOutcome: null,
    response: "Synthetic question?",
  });
}

async function executeQuestionWake(
  wake: ReturnType<typeof createQuestionWake>,
) {
  return await executeHostedAssistantNotificationWake({
    executionContext: EXECUTION_CONTEXT,
    forceQueueOnly: true,
    sourceMailboxItemId: MAILBOX_ITEM_ID,
    vaultRoot: "/synthetic-vault",
    wake,
  });
}

function createQuestionWake(eventId: string) {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId,
    memberId: "member_synthetic",
    notification: {
      deliveryDedupeToken: eventId,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: eventId,
      externalThreadRouteAuthority: null,
      instructions: "Ask one synthetic private question.",
      responsePolicy: {
        kind: "require_send_exact_text",
        text: "Synthetic question?",
      },
      route: {
        actorId: null,
        channel: "linq",
        delivery: { kind: "thread", target: "thread_synthetic" },
        identityId: "identity_synthetic",
        threadId: "thread_synthetic",
        threadIsDirect: true,
      },
    },
    occurredAt: OCCURRED_AT,
  });
}

function createPendingQuestionItem(): HostedSystemMailboxPendingItem {
  return {
    attemptCount: 0,
    itemId: MAILBOX_ITEM_ID,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: EVENT_ID,
    mailboxLaneSeq: "1",
    nextAttemptAt: null,
    occurredAt: OCCURRED_AT,
    postCheckpointRecord: null,
    preferenceCausalSeq: null,
    requestId: null,
    routeAction: "dispatch-assistant-notification",
    status: "pending",
    wake: createQuestionWake(EVENT_ID),
  };
}

function createRuntime(): Parameters<
  typeof prepareHostedSystemMailboxItemForCheckpoint
>[0]["runtime"] {
  const platform: HostedRuntimePlatform = {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {},
    },
  };

  return {
    commitTimeoutMs: null,
    forwardedEnv: {},
    platform,
    platformEnv: {},
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: {},
  };
}
