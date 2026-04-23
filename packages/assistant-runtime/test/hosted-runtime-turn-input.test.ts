import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createInboxBackedAssistantTurnInputPort: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  ingestHostedConversationMessageWake: vi.fn(),
}));

vi.mock("@murphai/assistant-engine", () => ({
  createInboxBackedAssistantTurnInputPort:
    mocks.createInboxBackedAssistantTurnInputPort,
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

vi.mock("../src/hosted-runtime/events/conversation.ts", () => ({
  ingestHostedConversationMessageWake: mocks.ingestHostedConversationMessageWake,
}));

import type {
  AssistantTurnConversationCaptureQuery,
  AssistantTurnInputPort,
} from "@murphai/assistant-engine";
import type {
  HostedRuntimeDrainEvent,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";

import {
  createHostedAssistantTurnInputPort,
} from "../src/hosted-runtime/turn-input.ts";
import type {
  HostedRuntimeTurnInputPort,
} from "../src/hosted-runtime/platform.ts";

type InboxServicesInput = Parameters<
  typeof import("@murphai/assistant-engine").createInboxBackedAssistantTurnInputPort
>[0]["inboxServices"];

const TIMER_WAKE = {
  eventId: "evt_timer",
  kind: "runtime.timer",
  occurredAt: "2026-04-23T00:00:00.000Z",
  triggerKind: "runtime_timer",
  userId: "member_123",
} satisfies HostedRuntimeEvent;

function createTelegramWake(eventId: string, text: string): HostedRuntimeEvent {
  return {
    eventId,
    kind: "conversation.message",
    message: {
      channel: "telegram",
      telegramMessage: {
        messageId: eventId,
        schema: "murph.hosted-telegram-message.v1",
        text,
        threadId: "telegram:123",
      },
    },
    occurredAt: "2026-04-23T00:00:01.000Z",
    userId: "member_123",
  };
}

function createDrainEvent(input: {
  ingressEventId: string;
  seq: string;
  wake: HostedRuntimeEvent;
}): HostedRuntimeDrainEvent {
  return {
    ingressEventId: input.ingressEventId,
    seq: input.seq,
    wake: input.wake,
  };
}

function createPort(input: {
  basePort: AssistantTurnInputPort;
  hostedRefresh: HostedRuntimeTurnInputPort["refresh"];
}): AssistantTurnInputPort | undefined {
  const inboxServices = {} as InboxServicesInput;
  mocks.createInboxBackedAssistantTurnInputPort.mockReturnValueOnce(input.basePort);

  return createHostedAssistantTurnInputPort({
    inboxServices,
    requestId: "req_turn_input",
    runtime: {
      platform: {
        artifactStore: {
          get: vi.fn(async () => null),
          put: vi.fn(async () => undefined),
        },
        effectsPort: {
          readRawEmailMessage: vi.fn(async () => null),
          sendEmail: vi.fn(async () => undefined),
        },
        turnInputPort: {
          refresh: input.hostedRefresh,
        },
      },
    },
    vaultRoot: "/tmp/vault-root",
    wake: TIMER_WAKE,
  });
}

describe("createHostedAssistantTurnInputPort", () => {
  it("returns undefined when the hosted platform has no turn-input port", () => {
    const inboxServices = {} as InboxServicesInput;

    expect(
      createHostedAssistantTurnInputPort({
        inboxServices,
        requestId: "req_no_port",
        runtime: {
          platform: {
            artifactStore: {
              get: vi.fn(async () => null),
              put: vi.fn(async () => undefined),
            },
            effectsPort: {
              readRawEmailMessage: vi.fn(async () => null),
              sendEmail: vi.fn(async () => undefined),
            },
            turnInputPort: null,
          },
        },
        vaultRoot: "/tmp/vault-root",
        wake: TIMER_WAKE,
      }),
    ).toBeUndefined();

    expect(mocks.createInboxBackedAssistantTurnInputPort).not.toHaveBeenCalled();
  });

  it("dedupes imported hosted conversation events and delegates base port reads", async () => {
    const baseRefresh = vi
      .fn<AssistantTurnInputPort["refresh"]>()
      .mockResolvedValueOnce({
        progressed: false,
        reason: "no_new_input",
      })
      .mockResolvedValueOnce({
        progressed: true,
        reason: "ingested_input",
      })
      .mockResolvedValueOnce({
        progressed: false,
        reason: "no_new_input",
      })
      .mockResolvedValueOnce({
        progressed: false,
        reason: "source_unavailable",
      });
    const baseListNewConversationCaptures = vi.fn<
      AssistantTurnInputPort["listNewConversationCaptures"]
    >(async (query) => ({
      captures: [],
      nextCursor: query.afterCursor,
    }));
    const basePort: AssistantTurnInputPort = {
      refresh: baseRefresh,
      listNewConversationCaptures: baseListNewConversationCaptures,
    };
    const firstWake = createTelegramWake("evt_first", "First late note");
    const secondWake = createTelegramWake("evt_second", "Second late note");
    const lowerSeqWake = createTelegramWake("evt_lower_seq", "Lower seq replay");
    const hostedRefresh = vi
      .fn<HostedRuntimeTurnInputPort["refresh"]>()
      .mockResolvedValueOnce({
        events: [
          createDrainEvent({
            ingressEventId: "ingress_timer",
            seq: "9",
            wake: TIMER_WAKE,
          }),
          createDrainEvent({
            ingressEventId: "ingress_first",
            seq: "11",
            wake: firstWake,
          }),
          createDrainEvent({
            ingressEventId: "ingress_first",
            seq: "12",
            wake: createTelegramWake("evt_duplicate", "Duplicate note"),
          }),
        ],
      })
      .mockResolvedValueOnce({
        events: [
          createDrainEvent({
            ingressEventId: "ingress_second",
            seq: "13",
            wake: secondWake,
          }),
        ],
      })
      .mockResolvedValueOnce({
        events: [
          createDrainEvent({
            ingressEventId: "ingress_lower_seq",
            seq: "12",
            wake: lowerSeqWake,
          }),
        ],
      })
      .mockResolvedValueOnce({
        events: [
          createDrainEvent({
            ingressEventId: "ingress_timer_only",
            seq: "14",
            wake: TIMER_WAKE,
          }),
        ],
      });

    const port = createPort({ basePort, hostedRefresh });
    expect(port).toBeDefined();

    await expect(port?.refresh({ phase: "before_delivery" })).resolves.toEqual({
      progressed: true,
      reason: "ingested_input",
    });
    await expect(port?.refresh({ phase: "before_provider" })).resolves.toEqual({
      progressed: true,
      reason: "ingested_input",
    });
    await expect(port?.refresh({ phase: "after_provider" })).resolves.toEqual({
      progressed: true,
      reason: "ingested_input",
    });
    await expect(port?.refresh({ phase: "after_tool_result" })).resolves.toEqual({
      progressed: false,
      reason: "source_unavailable",
    });

    const captureQuery: AssistantTurnConversationCaptureQuery = {
      afterCursor: {
        captureId: "capture_previous",
        createdAt: null,
        occurredAt: "2026-04-22T23:59:00.000Z",
      },
      conversation: {
        accountId: null,
        actorId: "member_123",
        actorIsSelf: false,
        source: "telegram",
        threadId: "telegram:123",
        threadIsDirect: true,
      },
    };
    await expect(port?.listNewConversationCaptures(captureQuery)).resolves.toEqual({
      captures: [],
      nextCursor: captureQuery.afterCursor,
    });

    expect(hostedRefresh).toHaveBeenNthCalledWith(1, {
      phase: "before_delivery",
      requestId: "req_turn_input",
    });
    expect(hostedRefresh).toHaveBeenNthCalledWith(2, {
      afterSeq: "11",
      phase: "before_provider",
      requestId: "req_turn_input",
    });
    expect(hostedRefresh).toHaveBeenNthCalledWith(3, {
      afterSeq: "13",
      phase: "after_provider",
      requestId: "req_turn_input",
    });
    expect(hostedRefresh).toHaveBeenNthCalledWith(4, {
      afterSeq: "13",
      phase: "after_tool_result",
      requestId: "req_turn_input",
    });
    expect(mocks.ingestHostedConversationMessageWake).toHaveBeenCalledTimes(3);
    expect(mocks.ingestHostedConversationMessageWake).toHaveBeenNthCalledWith(1, {
      runtime: expect.any(Object),
      vaultRoot: "/tmp/vault-root",
      wake: firstWake,
    });
    expect(mocks.ingestHostedConversationMessageWake).toHaveBeenNthCalledWith(2, {
      runtime: expect.any(Object),
      vaultRoot: "/tmp/vault-root",
      wake: secondWake,
    });
    expect(mocks.ingestHostedConversationMessageWake).toHaveBeenNthCalledWith(3, {
      runtime: expect.any(Object),
      vaultRoot: "/tmp/vault-root",
      wake: lowerSeqWake,
    });
    expect(baseRefresh).toHaveBeenCalledTimes(4);
    expect(baseListNewConversationCaptures).toHaveBeenCalledWith(captureQuery);
  });

  it("logs and rethrows when hosted refresh fails before delivery", async () => {
    vi.clearAllMocks();

    const baseRefresh = vi.fn<AssistantTurnInputPort["refresh"]>();
    const baseListNewConversationCaptures = vi.fn<
      AssistantTurnInputPort["listNewConversationCaptures"]
    >();
    const basePort: AssistantTurnInputPort = {
      refresh: baseRefresh,
      listNewConversationCaptures: baseListNewConversationCaptures,
    };
    const hostedError = new Error("hosted refresh failed");
    const hostedRefresh = vi
      .fn<HostedRuntimeTurnInputPort["refresh"]>()
      .mockRejectedValueOnce(hostedError);

    const port = createPort({ basePort, hostedRefresh });
    expect(port).toBeDefined();

    await expect(port?.refresh({ phase: "before_delivery" })).rejects.toThrow(
      "hosted refresh failed",
    );

    expect(hostedRefresh).toHaveBeenCalledWith({
      phase: "before_delivery",
      requestId: "req_turn_input",
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "runtime",
        details: {
          requestId: "req_turn_input",
        },
        error: hostedError,
        level: "warn",
        message: "Hosted assistant turn-input refresh failed before delivery.",
        phase: "wake.running",
        wake: TIMER_WAKE,
      }),
    );
    expect(mocks.ingestHostedConversationMessageWake).not.toHaveBeenCalled();
    expect(baseRefresh).not.toHaveBeenCalled();
    expect(baseListNewConversationCaptures).not.toHaveBeenCalled();
  });
});
