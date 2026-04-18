import assert from "node:assert/strict";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionMemberChannelsUpdatedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  buildHostedExecutionVaultShareAcceptedDispatch,
} from "@murphai/hosted-execution";
import {
  createHostedRuntimeEffectsPortStub,
  createHostedRuntimeResolvedConfig,
} from "./hosted-runtime-test-helpers.ts";

const mocks = vi.hoisted(() => ({
  buildHostedEmailCapture: vi.fn(),
  buildHostedLinqCapture: vi.fn(),
  buildHostedTelegramCapture: vi.fn(),
  handleHostedShareAcceptedDispatch: vi.fn(),
  hydrateHostedExecutionDefaultTarget: vi.fn(async (value) => value),
  prepareHostedDispatchContext: vi.fn(),
  queueAssistantFirstContactWelcome: vi.fn(),
  withHostedInboxPipeline: vi.fn(),
}));

vi.mock("../src/hosted-runtime/context.ts", () => ({
  hydrateHostedExecutionDefaultTarget: mocks.hydrateHostedExecutionDefaultTarget,
  prepareHostedDispatchContext: mocks.prepareHostedDispatchContext,
}));

vi.mock("@murphai/assistant-engine", () => ({
  queueAssistantFirstContactWelcome: mocks.queueAssistantFirstContactWelcome,
}));

vi.mock("../src/hosted-runtime/events/email.ts", () => ({
  buildHostedEmailCapture: mocks.buildHostedEmailCapture,
}));

vi.mock("../src/hosted-runtime/events/linq.ts", () => ({
  buildHostedLinqCapture: mocks.buildHostedLinqCapture,
}));

vi.mock("../src/hosted-runtime/events/share.ts", () => ({
  handleHostedShareAcceptedDispatch: mocks.handleHostedShareAcceptedDispatch,
}));

vi.mock("../src/hosted-runtime/events/telegram.ts", () => ({
  buildHostedTelegramCapture: mocks.buildHostedTelegramCapture,
}));

vi.mock("../src/hosted-runtime/events/inbox-pipeline.ts", () => ({
  withHostedInboxPipeline: mocks.withHostedInboxPipeline,
}));

import { executeHostedDispatchEvent } from "../src/hosted-runtime/events.ts";

const executionContext = {
  hosted: {
    memberId: "member_123",
    userEnvKeys: [],
  },
} as const;

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
    resolvedConfig: createHostedRuntimeResolvedConfig(),
    userEnv: { ...userEnv },
  } as const;
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.prepareHostedDispatchContext.mockResolvedValue(null);
  mocks.hydrateHostedExecutionDefaultTarget.mockImplementation(async (value) => value);
  mocks.handleHostedShareAcceptedDispatch.mockResolvedValue({
    shareImportResult: null,
    shareImportTitle: null,
  });
  mocks.withHostedInboxPipeline.mockImplementation(async (_vaultRoot, callback) => callback({
    processCapture: vi.fn(async () => {}),
  }));
});

describe("executeHostedDispatchEvent", () => {
  it("queues the welcome message for activation first contact and returns noop dispatch metrics", async () => {
    const bootstrapResult = {
      assistantConfigStatus: "saved",
      assistantConfigured: true,
      assistantProvider: "openai-compatible" as const,
      assistantSeeded: false,
      emailAutoReplyEnabled: true,
      linqAutoReplyEnabled: true,
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
      memberChannels: {
        email: true,
        linq: true,
        telegram: true,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    const runtime = createRuntime();
    const result = await executeHostedDispatchEvent({
      dispatch,
      executionContext,
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
      runtime.resolvedConfig,
    );
    expect(mocks.queueAssistantFirstContactWelcome).toHaveBeenCalledWith({
      actorId: null,
      channel: "linq",
      executionContext,
      identityId: "hbidx:phone:v1:test",
      threadId: "thread_123",
      threadIsDirect: true,
      vault: "/tmp/assistant-runtime-events",
    });
    assert.deepEqual(result, {
      bootstrapResult,
      maintenanceRequired: true,
      shareImportResult: null,
      shareImportTitle: null,
    });
  });

  it("rehydrates execution context after bootstrap before queuing first contact", async () => {
    const hydratedExecutionContext = {
      hosted: {
        defaultTarget: {
          adapter: "openai-compatible" as const,
          apiKeyEnv: "OPENAI_API_KEY",
          endpoint: "https://gateway.example.test/v1",
          headers: null,
          model: "gpt-4.1-mini",
          presetId: null,
          providerName: "Hosted Gateway",
          reasoningEffort: null,
          webSearch: null,
        },
        memberId: "member_123",
        userEnvKeys: [],
      },
    };
    mocks.hydrateHostedExecutionDefaultTarget.mockResolvedValue(hydratedExecutionContext);

    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "evt_member_activated_rehydrate",
      firstContact: {
        channel: "linq",
        identityId: "hbidx:phone:v1:test",
        threadId: "thread_123",
        threadIsDirect: true,
      },
      memberId: "member_123",
      memberChannels: {
        email: true,
        linq: true,
        telegram: true,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    await executeHostedDispatchEvent({
      dispatch,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.hydrateHostedExecutionDefaultTarget).toHaveBeenCalledWith(
      executionContext,
    );
    expect(mocks.queueAssistantFirstContactWelcome).toHaveBeenCalledWith({
      actorId: null,
      channel: "linq",
      executionContext: hydratedExecutionContext,
      identityId: "hbidx:phone:v1:test",
      threadId: "thread_123",
      threadIsDirect: true,
      vault: "/tmp/assistant-runtime-events",
    });
  });

  it("passes Linq home-thread materialization first-contact data through unchanged", async () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "evt_member_activated_materialize_linq_home",
      firstContact: {
        channel: "linq",
        fromPhoneNumber: "+15550001111",
        identityId: "hbidx:phone:v1:test",
        kind: "linq-materialize-home-thread",
        toPhoneNumber: "+15550002222",
      },
      memberId: "member_123",
      memberChannels: {
        email: true,
        linq: true,
        telegram: true,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    await executeHostedDispatchEvent({
      dispatch,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.queueAssistantFirstContactWelcome).toHaveBeenCalledWith({
      channel: "linq",
      executionContext,
      fromPhoneNumber: "+15550001111",
      identityId: "hbidx:phone:v1:test",
      kind: "linq-materialize-home-thread",
      toPhoneNumber: "+15550002222",
      vault: "/tmp/assistant-runtime-events",
    });
  });

  it("routes Linq, Telegram, and email events to their hosted ingestion helpers", async () => {
    const runtime = createRuntime({
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
    });
    const vaultRoot = "/tmp/assistant-runtime-events";
    const processCapture = vi.fn(async () => {});
    mocks.withHostedInboxPipeline.mockImplementation(async (_vaultRoot, callback) => callback({
      processCapture,
    }));

    const linqDispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: "evt_linq",
      linqEvent: {
        event_type: "message.received",
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      phoneLookupKey: "15551234567",
      userId: "member_123",
    });
    const linqResult = await executeHostedDispatchEvent({
      dispatch: linqDispatch,
      executionContext,
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
      executionContext,
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
      executionContext,
      runtime,
      runtimeEnv: {
        HOSTED_EMAIL_DOMAIN: "mail.example.test",
      },
      vaultRoot,
    });

    expect(mocks.buildHostedLinqCapture).toHaveBeenCalledWith(linqDispatch);
    expect(mocks.buildHostedTelegramCapture).toHaveBeenCalledWith(telegramDispatch);
    expect(mocks.buildHostedEmailCapture).toHaveBeenCalledWith(
      emailDispatch,
      runtime.platform.effectsPort,
    );
    expect(processCapture).toHaveBeenCalledTimes(3);
    assert.deepEqual(linqResult, {
      bootstrapResult: null,
      maintenanceRequired: false,
      shareImportResult: null,
      shareImportTitle: null,
    });
  });

  it("treats explicit member channel sync events as no-op dispatch handlers", async () => {
    const dispatch = buildHostedExecutionMemberChannelsUpdatedDispatch({
      eventId: "evt_member_channels_updated",
      memberChannels: {
        email: true,
        linq: false,
        telegram: true,
      },
      memberId: "member_123",
      occurredAt: "2026-04-08T00:03:00.000Z",
    });

    const result = await executeHostedDispatchEvent({
      dispatch,
      executionContext,
      runtime: createRuntime(),
      runtimeEnv: {},
      vaultRoot: "/tmp/assistant-runtime-events",
    });

    expect(mocks.queueAssistantFirstContactWelcome).not.toHaveBeenCalled();
    assert.deepEqual(result, {
      bootstrapResult: null,
      maintenanceRequired: true,
      shareImportResult: null,
      shareImportTitle: null,
    });
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
        executionContext,
        runtime: createRuntime(),
        runtimeEnv: {},
        vaultRoot: "/tmp/assistant-runtime-events",
      }),
    ).rejects.toThrow(
      "Hosted share accepted dispatch requires a hydrated runner sharePack.",
    );
    expect(mocks.handleHostedShareAcceptedDispatch).not.toHaveBeenCalled();
  });

});
