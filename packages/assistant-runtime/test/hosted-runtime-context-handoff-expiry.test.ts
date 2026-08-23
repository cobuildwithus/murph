import {
  buildHostedExecutionAssistantNotificationRequestedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_EVENT_ID_PREFIX,
  HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_TTL_MS,
} from "@murphai/hosted-execution/runtime-control";
import {
  createAssistantOutboxIntent,
  listAssistantOutboxIntents,
  readAssistantOutboxIntent,
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

const OCCURRED_AT = "2036-08-22T19:00:00.000Z";
const EXPIRES_AT = new Date(
  Date.parse(OCCURRED_AT) + HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_TTL_MS,
).toISOString();
const BEFORE_EXPIRY = new Date(Date.parse(EXPIRES_AT) - 1).toISOString();
const EVENT_ID = `${HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_EVENT_ID_PREFIX}${
  "a".repeat(64)
}`;
const EXECUTION_CONTEXT: AssistantExecutionContext = {
  hosted: {
    memberId: "member_synthetic",
    userEnvKeys: [],
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BEFORE_EXPIRY);
  mocks.executeHostedMailboxEvent.mockReset();
  mocks.sendAssistantNotification.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("hosted group context handoff expiry", () => {
  it("allows provider admission until the final millisecond before expiry", async () => {
    const wake = createGroupContextHandoffWake();
    const providerStarted = new Error("Synthetic provider start sentinel.");
    let providerStarts = 0;
    mocks.sendAssistantNotification.mockImplementation(
      async (input: AssistantNotificationInput) => {
        await input.beforeProviderAcceptedInputs?.({
          acceptedInputs: [],
          turnId: "turn_context_handoff_synthetic",
        });
        providerStarts += 1;
        throw providerStarted;
      },
    );

    await expect(executeHostedAssistantNotificationWake({
      executionContext: EXECUTION_CONTEXT,
      forceQueueOnly: true,
      sourceMailboxItemId: "mailbox_context_handoff_synthetic",
      vaultRoot: "/synthetic-vault",
      wake,
    })).rejects.toBe(providerStarted);
    expect(providerStarts).toBe(1);
  });

  it("terminally consumes a recovered sending handoff that crosses inclusive expiry before provider admission", async () => {
    const workspace = await createHostedRuntimeWorkspace(
      "murph-hosted-context-handoff-expiry-",
    );
    const item = createSendingGroupContextHandoffItem();
    let providerStarts = 0;

    mocks.sendAssistantNotification.mockImplementation(
      async (input: AssistantNotificationInput) => {
        expect(Date.now()).toBe(Date.parse(BEFORE_EXPIRY));
        vi.setSystemTime(EXPIRES_AT);
        await input.beforeProviderAcceptedInputs?.({
          acceptedInputs: [],
          turnId: "turn_context_handoff_synthetic",
        });
        providerStarts += 1;
        throw new Error("Provider should not start after handoff expiry.");
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
      const durableIntent = await createAssistantOutboxIntent({
        answeredMailboxItemIds: [item.itemId],
        bindingDelivery: {
          kind: "thread",
          target: "thread_synthetic",
        },
        channel: "linq",
        createdAt: OCCURRED_AT,
        dedupeToken: EVENT_ID,
        deliveryIdempotencyKey: EVENT_ID,
        deliveryTransportIdempotent: true,
        externalThreadRouteAuthority: {
          accountLookupKey: "account_synthetic",
          channel: "linq",
          containerMemberId: "member_synthetic",
          threadId: "thread_synthetic",
        },
        identityId: "identity_synthetic",
        message: "Previously authored synthetic group reply.",
        sessionId: "session_context_handoff_synthetic",
        threadId: "thread_synthetic",
        threadIsDirect: false,
        turnId: "turn_context_handoff_synthetic",
        vault: workspace.vaultRoot,
      });
      const persistedIntentBefore = await readAssistantOutboxIntent(
        workspace.vaultRoot,
        durableIntent.intentId,
      );
      await restoreHostedSystemMailboxCheckpointRollbackState({
        state: { pending: [item] },
        vaultRoot: workspace.vaultRoot,
      });

      const before = await readHostedSystemMailboxState(workspace.vaultRoot);
      expect(before.pending).toEqual([item]);
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "1",
        now: EXPIRES_AT,
        state: before,
      })).toBe("0");

      const result = await prepareHostedSystemMailboxItemForCheckpoint({
        executionContext: EXECUTION_CONTEXT,
        now: () => BEFORE_EXPIRY,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: workspace.vaultRoot,
      });

      expect(result).toMatchObject({
        itemId: item.itemId,
        metrics: {
          deliveryIntentIds: [],
          mailboxLane: "assistant-notification",
          redactedLogEntries: expect.arrayContaining([
            expect.objectContaining({
              redacted: expect.objectContaining({
                eventCode:
                  "assistant.notification.context_handoff_expired_terminal_no_send",
                terminalDisposition: "context_handoff_expired",
              }),
            }),
          ]),
        },
        status: "processed",
      });
      expect(mocks.executeHostedMailboxEvent).toHaveBeenCalledTimes(1);
      expect(mocks.sendAssistantNotification).toHaveBeenCalledTimes(1);
      expect(providerStarts).toBe(0);

      const after = await readHostedSystemMailboxState(workspace.vaultRoot);
      expect(after.pending).toEqual([]);
      expect(resolveHostedSystemMailboxHandledThroughSeq({
        importedSeq: "1",
        now: EXPIRES_AT,
        state: after,
      })).toBe("1");
      await expect(readAssistantOutboxIntent(
        workspace.vaultRoot,
        durableIntent.intentId,
      )).resolves.toEqual(persistedIntentBefore);
      await expect(listAssistantOutboxIntents(workspace.vaultRoot)).resolves
        .toEqual([persistedIntentBefore]);
    } finally {
      await workspace.cleanup();
    }
  });
});

function createGroupContextHandoffWake() {
  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: EVENT_ID,
    memberId: "member_synthetic",
    notification: {
      deliveryDedupeToken: EVENT_ID,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: EVENT_ID,
      externalThreadRouteAuthority: {
        accountLookupKey: "account_synthetic",
        channel: "linq",
        containerMemberId: "member_synthetic",
        threadId: "thread_synthetic",
      },
      groupContextHandoff: {
        membershipId: "membership_synthetic",
        originAssistantInputId: `ain_${"b".repeat(32)}`,
      },
      instructions: "Use bounded synthetic context.",
      notificationPromptProfile: "context-handoff",
      responsePolicy: { kind: "require_send" },
      route: {
        actorId: null,
        channel: "linq",
        delivery: { kind: "thread", target: "thread_synthetic" },
        identityId: "identity_synthetic",
        threadId: "thread_synthetic",
        threadIsDirect: false,
      },
    },
    occurredAt: OCCURRED_AT,
  });
}

function createSendingGroupContextHandoffItem(): HostedSystemMailboxPendingItem {
  return {
    attemptCount: 1,
    itemId: "mailbox_context_handoff_synthetic",
    lastAttemptAt: OCCURRED_AT,
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
    status: "sending",
    wake: createGroupContextHandoffWake(),
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
