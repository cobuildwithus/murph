import assert from "node:assert/strict";

import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  type HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution/contracts";
import { afterEach, test, vi } from "vitest";

import type {
  HostedMailboxResolvedImportItem,
} from "../src/hosted-runtime/mailbox-import.ts";

const TEST_NOW = "2026-04-26T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_conversation_loader";
const CONVERSATION_MODULE_PATH =
  "../src/hosted-runtime/events/conversation.ts";

type ConversationEventsModule =
  typeof import("../src/hosted-runtime/events/conversation.ts");
type MailboxConversationImportModule =
  typeof import("../src/hosted-runtime/mailbox-conversation-import.ts");
type MailboxConversationImportInput = Parameters<
  MailboxConversationImportModule["importHostedConversationMailboxItem"]
>[0];

class HostedConversationInboxProjectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HostedConversationInboxProjectionError";
  }
}

afterEach(() => {
  vi.doUnmock(CONVERSATION_MODULE_PATH);
  vi.resetModules();
});

test("lazy conversation events import retries after rejection while preserving pending-load coalescing", async () => {
  vi.resetModules();
  const failedModuleLoad = createDeferred<ConversationEventsModule>();
  const successfulModuleLoad = createDeferred<ConversationEventsModule>();
  const moduleLoads = [failedModuleLoad, successfulModuleLoad];
  let moduleLoadCount = 0;
  const importHostedConversationMessageWakeIntoLocalInbox =
    vi.fn<ConversationEventsModule["importHostedConversationMessageWakeIntoLocalInbox"]>(
      async () => ({
        capture: {
          captureId: "capture_after_retry",
          createdAt: TEST_NOW,
          deduped: false,
          envelopePath: "raw/inbox/linq/capture_after_retry/envelope.json",
          eventId: "evt_capture_after_retry",
        },
        metrics: {
          nextWakeAt: null,
          parserProcessed: 0,
        },
      }),
    );

  vi.doMock(CONVERSATION_MODULE_PATH, async () => {
    const moduleLoad = moduleLoads[moduleLoadCount];
    moduleLoadCount += 1;
    if (!moduleLoad) {
      throw new Error("Unexpected extra conversation module import.");
    }
    return await moduleLoad.promise;
  });

  const { importHostedConversationMailboxItem } =
    await import("../src/hosted-runtime/mailbox-conversation-import.ts");
  const firstImport = importHostedConversationMailboxItem(
    createImportInput("001"),
  );
  await waitFor(() => moduleLoadCount === 1);
  failedModuleLoad.reject(new Error("synthetic dynamic import failure"));

  const firstOutcome = await firstImport;
  assert.equal(firstOutcome.status, "imported");
  assert.equal(firstOutcome.reasonCode, "conversation-import.module-load-failed");
  assert.notEqual(firstOutcome.reasonCode, "conversation-import.projection-failed");
  assert.equal(importHostedConversationMessageWakeIntoLocalInbox.mock.calls.length, 0);

  const secondImport = importHostedConversationMailboxItem(
    createImportInput("002"),
  );
  const concurrentImport = importHostedConversationMailboxItem(
    createImportInput("003"),
  );
  await waitFor(() => moduleLoadCount === 2);
  assert.equal(moduleLoadCount, 2);
  assert.equal(importHostedConversationMessageWakeIntoLocalInbox.mock.calls.length, 0);

  successfulModuleLoad.resolve({
    HostedConversationInboxProjectionError,
    importHostedConversationMessageWakeIntoLocalInbox,
  });
  const [secondOutcome, concurrentOutcome] = await Promise.all([
    secondImport,
    concurrentImport,
  ]);

  assert.equal(secondOutcome.status, "imported");
  assert.equal(secondOutcome.reasonCode ?? null, null);
  assert.equal(concurrentOutcome.status, "imported");
  assert.equal(concurrentOutcome.reasonCode ?? null, null);
  assert.equal(moduleLoadCount, 2);
  assert.equal(importHostedConversationMessageWakeIntoLocalInbox.mock.calls.length, 2);

  const memoizedOutcome = await importHostedConversationMailboxItem(
    createImportInput("004"),
  );
  assert.equal(memoizedOutcome.status, "imported");
  assert.equal(memoizedOutcome.reasonCode ?? null, null);
  assert.equal(moduleLoadCount, 2);
  assert.equal(importHostedConversationMessageWakeIntoLocalInbox.mock.calls.length, 3);
});

test("successfully loaded conversation projection failures stay projection failures", async () => {
  vi.resetModules();
  let moduleLoadCount = 0;
  const importHostedConversationMessageWakeIntoLocalInbox =
    vi.fn<ConversationEventsModule["importHostedConversationMessageWakeIntoLocalInbox"]>(
      async () => {
        throw new HostedConversationInboxProjectionError(
          "synthetic projection failure after module load",
        );
      },
    );

  vi.doMock(CONVERSATION_MODULE_PATH, () => {
    moduleLoadCount += 1;
    return {
      HostedConversationInboxProjectionError,
      importHostedConversationMessageWakeIntoLocalInbox,
    };
  });

  const { importHostedConversationMailboxItem } =
    await import("../src/hosted-runtime/mailbox-conversation-import.ts");
  const outcome = await importHostedConversationMailboxItem(
    createImportInput("005"),
  );

  assert.equal(outcome.status, "imported");
  assert.equal(outcome.reasonCode, "conversation-import.projection-failed");
  assert.equal(moduleLoadCount, 1);
  assert.equal(importHostedConversationMessageWakeIntoLocalInbox.mock.calls.length, 1);
});

function createImportInput(
  suffix: string,
): MailboxConversationImportInput {
  const wake = createConversationWake(suffix);
  return {
    decodePayload: {
      async decode() {
        return {
          status: "decoded",
          wake,
        };
      },
    },
    item: createResolvedConversationMailboxItem({
      dedupeKey: wake.eventId,
      id: `mailbox_item_conversation_${suffix}`,
      laneSeq: String(Number(suffix)),
      occurredAt: wake.occurredAt,
    }),
    async prepareWakeContext() {},
    runtime: createRuntime(),
    stageAssistantInputEvent: createAssistantInputEventStager(),
    vaultRoot: "synthetic-vault-root",
  };
}

function createAssistantInputEventStager(): NonNullable<
  MailboxConversationImportInput["stageAssistantInputEvent"]
> {
  return async () => ({
    inputId: "ain_00000000000000000000000000000000",
    async recordProjection() {},
  });
}

function createRuntime(): MailboxConversationImportInput["runtime"] {
  return {
    forwardedEnv: {},
    parserToolchain: null,
    platform: {
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
    },
    platformEnv: {},
    resolvedConfig: {
      channelCapabilities: {
        emailSendReady: false,
        telegramBotConfigured: false,
        whatsappCloudApiConfigured: false,
      },
      deviceSync: null,
      managedAutoReplyChannels: [
        {
          capabilityReady: true,
          channel: "linq",
          memberChannel: "linq",
        },
      ],
    },
    userEnv: {},
  };
}

function createResolvedConversationMailboxItem(
  overrides: Partial<HostedMailboxItem> = {},
): HostedMailboxResolvedImportItem {
  const item = createMailboxItem(overrides);

  return {
    item,
    payload: {
      payloadCiphertext: "ciphertext_inline_synthetic",
      payloadSchema: item.payloadSchema,
      requestId: null,
      source: "inline",
      status: "resolved",
    },
    route: {
      action: "import-conversation-message",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    },
  };
}

function createMailboxItem(overrides: Partial<HostedMailboxItem> = {}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: "evt_synthetic_conversation_001",
    expiresAt: null,
    id: "mailbox_item_conversation_001",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_inline_synthetic",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    ...overrides,
  };
}

function createConversationWake(suffix: string): HostedExecutionConversationMessageWake {
  const seconds = String(Number(suffix)).padStart(2, "0");
  return {
    eventId: `evt_synthetic_conversation_${suffix}`,
    kind: "conversation.message",
    message: {
      channel: "linq",
      linqMessage: {
        chatId: "chat_synthetic_loader",
        from: "+15550100000",
        isFromMe: false,
        messageId: `msg_synthetic_loader_${suffix}`,
        parts: [
          {
            type: "text",
            value: `loader message ${suffix}`,
          },
        ],
      },
      phoneLookupKey: "+15550100000",
    },
    occurredAt: `2026-04-26T00:00:${seconds}.000Z`,
    userId: TEST_USER_ID,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  reject(reason: unknown): void;
  resolve(value: T): void;
} {
  let rejectDeferred: ((reason: unknown) => void) | null = null;
  let resolveDeferred: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    rejectDeferred = reject;
    resolveDeferred = resolve;
  });
  return {
    promise,
    reject(reason) {
      rejectDeferred?.(reason);
    },
    resolve(value) {
      resolveDeferred?.(value);
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error("Timed out waiting for expected test state.");
}
