import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionGatewayMessageSendDispatch,
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  buildHostedExecutionVaultShareAcceptedDispatch,
} from "@murphai/hosted-execution";
import { createHostedRuntimeEffectsPortStub } from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  assistantGatewayLocalMessageSender: Symbol("assistantGatewayLocalMessageSender"),
  assistantGatewayLocalProjectionSourceReader: Symbol(
    "assistantGatewayLocalProjectionSourceReader",
  ),
  handleHostedShareAcceptedDispatch: vi.fn(),
  ingestHostedEmailMessage: vi.fn(),
  ingestHostedLinqMessage: vi.fn(),
  ingestHostedTelegramMessage: vi.fn(),
  prepareHostedDispatchContext: vi.fn(),
  queueAssistantFirstContactWelcome: vi.fn(),
  sendGatewayMessageLocal: vi.fn(),
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  prepareHostedDispatchContext: mocks.prepareHostedDispatchContext,
}));

vi.mock("@murphai/assistant-engine", () => ({
  queueAssistantFirstContactWelcome: mocks.queueAssistantFirstContactWelcome,
}));

vi.mock("@murphai/assistant-engine/gateway-local-adapter", () => ({
  assistantGatewayLocalMessageSender: mocks.assistantGatewayLocalMessageSender,
  assistantGatewayLocalProjectionSourceReader: mocks.assistantGatewayLocalProjectionSourceReader,
}));

vi.mock("@murphai/gateway-local", () => ({
  sendGatewayMessageLocal: mocks.sendGatewayMessageLocal,
}));

vi.mock("../src/hosted-runtime/events/email.ts", () => ({
  ingestHostedEmailMessage: mocks.ingestHostedEmailMessage,
}));

vi.mock("../src/hosted-runtime/events/linq.ts", () => ({
  ingestHostedLinqMessage: mocks.ingestHostedLinqMessage,
}));

vi.mock("../src/hosted-runtime/events/share.ts", () => ({
  handleHostedShareAcceptedDispatch: mocks.handleHostedShareAcceptedDispatch,
}));

vi.mock("../src/hosted-runtime/events/telegram.ts", () => ({
  ingestHostedTelegramMessage: mocks.ingestHostedTelegramMessage,
}));

import { executeHostedDispatchEvent } from "../src/hosted-runtime/events.ts";

function createRuntime(userEnv: Readonly<Record<string, string>> = {}) {
  return {
    commitTimeoutMs: null,
    platform: {
      artifactStore: {
        async get() {
          return null;
        },
        async put() {},
      },
      deviceSyncPort: null,
      effectsPort: createHostedRuntimeEffectsPortStub(),
      usageExportPort: null,
    },
    userEnv: { ...userEnv },
  } as const;
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.prepareHostedDispatchContext.mockResolvedValue(null);
  mocks.handleHostedShareAcceptedDispatch.mockResolvedValue({
    shareImportResult: null,
    shareImportTitle: null,
  });
});

describe("executeHostedDispatchEvent", () => {
  it("queues the welcome message for activation first contact and returns noop dispatch metrics", async () => {
    const bootstrapResult = {
      assistantConfigStatus: "saved",
      assistantConfigured: true,
      assistantProvider: "openai-compatible" as const,
      assistantSeeded: false,
      emailAutoReplyEnabled: true,
      telegramAutoReplyEnabled: true,
      vaultCreated: false,
    };
    mocks.prepareHostedDispatchContext.mockResolvedValue(bootstrapResult);

    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "evt_member_activated",
      firstContact: {
        channel: "linq",
        identityId: "hbidx:phone:v1:test",
        threadId: "thread_123",
        threadIsDirect: true,
      },
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const runtime = createRuntime();
    const result = await executeHostedDispatchEvent({
      dispatch,
      runtime,
      runtimeEnv: {
        OPENAI_API_KEY: "secret",
      },
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.prepareHostedDispatchContext).toHaveBeenCalledWith(
      "/tmp/assistant-runtime-events",
      dispatch,
      {
        OPENAI_API_KEY: "secret",
      },
    );
    expect(mocks.queueAssistantFirstContactWelcome).toHaveBeenCalledWith({
      channel: "linq",
      identityId: "hbidx:phone:v1:test",
      threadId: "thread_123",
      threadIsDirect: true,
      vault: "/tmp/assistant-runtime-events",
    });
    assert.deepEqual(result, {
      bootstrapResult,
      shareImportResult: null,
      shareImportTitle: null,
    });
  });

  it("routes Linq, Telegram, and email events to their hosted ingestion helpers", async () => {
    const runtime = createRuntime({
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
    });
    const vaultRoot = "/tmp/assistant-runtime-events";

    const linqDispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: "evt_linq",
      linqEvent: {
        event_type: "message.received",
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "15551234567",
      userId: "member_123",
    });
    await executeHostedDispatchEvent({
      dispatch: linqDispatch,
      runtime,
      runtimeEnv: {},
      vaultRoot,
    });

    const telegramDispatch = buildHostedExecutionTelegramMessageReceivedDispatch({
      eventId: "evt_telegram",
      occurredAt: "2026-04-08T00:01:00.000Z",
      telegramMessage: {
        messageId: "tg_message_123",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "chat_123",
      },
      userId: "member_123",
    });
    await executeHostedDispatchEvent({
      dispatch: telegramDispatch,
      runtime,
      runtimeEnv: {},
      vaultRoot,
    });

    const emailDispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "evt_email",
      identityId: "assistant@mail.example.test",
      occurredAt: "2026-04-08T00:02:00.000Z",
      rawMessageKey: "raw_123",
      selfAddress: "user@example.com",
      userId: "member_123",
    });
    await executeHostedDispatchEvent({
      dispatch: emailDispatch,
      runtime,
      runtimeEnv: {
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
      },
      vaultRoot,
    });

    expect(mocks.ingestHostedLinqMessage).toHaveBeenCalledWith(vaultRoot, linqDispatch);
    expect(mocks.ingestHostedTelegramMessage).toHaveBeenCalledWith(vaultRoot, telegramDispatch);
    expect(mocks.ingestHostedEmailMessage).toHaveBeenCalledWith(
      vaultRoot,
      emailDispatch,
      runtime.platform.effectsPort,
      runtime.userEnv,
    );
  });

  it("requires a hydrated share pack for hosted share acceptance", async () => {
    const dispatch = buildHostedExecutionVaultShareAcceptedDispatch({
      eventId: "evt_share",
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
      share: {
        ownerUserId: "member_sender",
        shareId: "share_123",
      },
    });

    await expect(
      executeHostedDispatchEvent({
        dispatch,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events",
      }),
    ).rejects.toThrow(
      "Hosted share accepted dispatch requires a hydrated runner sharePack.",
    );
    expect(mocks.handleHostedShareAcceptedDispatch).not.toHaveBeenCalled();
  });

  it("delegates gateway sends through the local gateway adapter", async () => {
    const dispatch = buildHostedExecutionGatewayMessageSendDispatch({
      clientRequestId: "client_123",
      eventId: "evt_gateway_send",
      occurredAt: "2026-04-08T00:00:00.000Z",
      replyToMessageId: "msg_parent",
      sessionKey: "session_123",
      text: "hello from hosted runtime",
      userId: "member_123",
    });

    await executeHostedDispatchEvent({
      dispatch,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.sendGatewayMessageLocal).toHaveBeenCalledWith({
      clientRequestId: "client_123",
      dispatchMode: "queue-only",
      messageSender: mocks.assistantGatewayLocalMessageSender,
      replyToMessageId: "msg_parent",
      sessionKey: "session_123",
      sourceReader: mocks.assistantGatewayLocalProjectionSourceReader,
      text: "hello from hosted runtime",
      vault: "/tmp/assistant-runtime-events",
    });
  });
});
