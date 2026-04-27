import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createInboxBackedAssistantTurnInputPort: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
  ingestHostedConversationMessageWake: vi.fn(),
}));

vi.mock("@murphai/assistant-engine", async () => {
  const actual = await vi.importActual<typeof import("@murphai/assistant-engine")>(
    "@murphai/assistant-engine",
  );
  return {
    ...actual,
    createInboxBackedAssistantTurnInputPort:
      mocks.createInboxBackedAssistantTurnInputPort,
  };
});

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
  AssistantTurnInputRefreshResult,
  AssistantTurnInputPort,
} from "@murphai/assistant-engine";
import {
  createAssistantTurnBeforeDeliveryHook,
  isAssistantTurnRevisionRequiredError,
} from "@murphai/assistant-engine";
import type {
  HostedRuntimeDrainEvent,
  HostedRunEventResult,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";

import {
  createHostedAssistantTurnInputPort,
} from "../src/hosted-runtime/turn-input.ts";
import type {
  HostedRuntimeBeforeDeliveryMailboxRefresh,
  HostedRuntimeTurnInputPort,
} from "../src/hosted-runtime/platform.ts";

type InboxServicesInput = Parameters<
  typeof import("@murphai/assistant-engine").createInboxBackedAssistantTurnInputPort
>[0]["inboxServices"];
type AssistantInboxCaptureSummary = Awaited<
  ReturnType<AssistantTurnInputPort["listNewConversationCaptures"]>
>["captures"][number];

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

function createCaptureSummary(
  overrides: Partial<Omit<AssistantInboxCaptureSummary, "createdAt">> & {
    createdAt?: string | null;
  } = {},
): AssistantInboxCaptureSummary {
  return {
    accountId: overrides.accountId ?? "acct_1",
    actorId: overrides.actorId ?? "actor_1",
    actorIsSelf: overrides.actorIsSelf ?? false,
    actorName: overrides.actorName ?? "Sender",
    attachmentCount: overrides.attachmentCount ?? 0,
    captureId: overrides.captureId ?? "cap_late",
    createdAt:
      "createdAt" in overrides
        ? overrides.createdAt ?? undefined
        : "2026-04-23T00:00:03.000Z",
    envelopePath: overrides.envelopePath ?? "captures/cap_late.json",
    eventId: overrides.eventId ?? "evt_late",
    externalId: overrides.externalId ?? "ext_late",
    occurredAt: overrides.occurredAt ?? "2026-04-23T00:00:02.000Z",
    promotions: overrides.promotions ?? [],
    receivedAt: overrides.receivedAt ?? "2026-04-23T00:00:02.500Z",
    source: overrides.source ?? "telegram",
    text: overrides.text ?? "late same-conversation note",
    threadId: overrides.threadId ?? "telegram:123",
    threadIsDirect: overrides.threadIsDirect ?? true,
    threadTitle: overrides.threadTitle ?? null,
  };
}

function createPort(input: {
  basePort: AssistantTurnInputPort;
  beforeDeliveryRefresh?: HostedRuntimeBeforeDeliveryMailboxRefresh;
  hostedRefresh?: HostedRuntimeTurnInputPort["refresh"];
  onImportedEvent?: (result: HostedRunEventResult) => void;
}): AssistantTurnInputPort | undefined {
  const inboxServices = {} as InboxServicesInput;
  mocks.createInboxBackedAssistantTurnInputPort.mockReturnValueOnce(input.basePort);

  return createHostedAssistantTurnInputPort({
    inboxServices,
    ...(input.onImportedEvent ? { onImportedEvent: input.onImportedEvent } : {}),
    requestId: "req_turn_input",
    runtime: {
      forwardedEnv: {},
      platform: {
        artifactStore: {
          get: vi.fn(async () => null),
          put: vi.fn(async () => undefined),
        },
        effectsPort: {
          readRawEmailMessage: vi.fn(async () => null),
          sendEmail: vi.fn(async () => undefined),
        },
        ...(input.beforeDeliveryRefresh
          ? { refreshMailboxBeforeDelivery: input.beforeDeliveryRefresh }
          : {}),
        ...(input.hostedRefresh
          ? {
              turnInputPort: {
                refresh: input.hostedRefresh,
              },
            }
          : {}),
      },
      platformEnv: {},
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
          forwardedEnv: {},
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
          platformEnv: {},
        },
        vaultRoot: "/tmp/vault-root",
        wake: TIMER_WAKE,
      }),
    ).toBeUndefined();

    expect(mocks.createInboxBackedAssistantTurnInputPort).not.toHaveBeenCalled();
  });

  it("runs the hosted mailbox refresh before delivery and leaves revision to the local hook", async () => {
    const events: string[] = [];
    const lateCapture = createCaptureSummary();
    const baseRefresh = vi.fn<AssistantTurnInputPort["refresh"]>(async (input) => {
      events.push(`base:${input.phase}`);
      return {
        progressed: false,
        reason: "no_new_input",
      };
    });
    const baseListNewConversationCaptures = vi.fn<
      AssistantTurnInputPort["listNewConversationCaptures"]
    >(async (query) => {
      events.push("list");
      return {
        captures: events.includes("mailbox") ? [lateCapture] : [],
        nextCursor: events.includes("mailbox")
          ? {
              captureId: lateCapture.captureId,
              createdAt: lateCapture.createdAt ?? null,
              occurredAt: lateCapture.occurredAt,
            }
          : query.afterCursor,
      };
    });
    const basePort: AssistantTurnInputPort = {
      refresh: baseRefresh,
      listNewConversationCaptures: baseListNewConversationCaptures,
    };
    const beforeDeliveryRefresh = vi.fn<HostedRuntimeBeforeDeliveryMailboxRefresh>(
      async () => {
        events.push("mailbox");
        return {
          progressed: true,
          reason: "ingested_input",
        };
      },
    );
    const legacyHostedRefresh = vi.fn<HostedRuntimeTurnInputPort["refresh"]>();
    const port = createPort({
      basePort,
      beforeDeliveryRefresh,
      hostedRefresh: legacyHostedRefresh,
    });
    expect(port).toBeDefined();

    const hook = createAssistantTurnBeforeDeliveryHook({
      afterCursor: {
        captureId: "cap_previous",
        createdAt: "2026-04-23T00:00:01.000Z",
        occurredAt: "2026-04-23T00:00:00.000Z",
      },
      conversation: {
        accountId: lateCapture.accountId,
        actorId: lateCapture.actorId,
        actorIsSelf: lateCapture.actorIsSelf,
        source: lateCapture.source,
        threadId: lateCapture.threadId,
        threadIsDirect: lateCapture.threadIsDirect,
      },
      knownCaptureIds: ["cap_previous"],
      port: port!,
    });

    let caught: unknown;
    try {
      await hook({
        response: "draft",
        sessionId: "sess_hosted",
        turnId: "turn_hosted",
        vault: "/tmp/vault-root",
      });
    } catch (error) {
      caught = error;
    }

    expect(isAssistantTurnRevisionRequiredError(caught)).toBe(true);
    if (!isAssistantTurnRevisionRequiredError(caught)) {
      throw new Error("expected AssistantTurnRevisionRequiredError");
    }
    expect(caught.captures).toEqual([lateCapture]);
    expect(caught.nextCursor).toEqual({
      captureId: lateCapture.captureId,
      createdAt: lateCapture.createdAt ?? null,
      occurredAt: lateCapture.occurredAt,
    });
    expect(events).toEqual(["mailbox", "base:before_delivery", "list"]);
    expect(beforeDeliveryRefresh).toHaveBeenCalledWith({
      requestId: "req_turn_input",
    });
    expect(legacyHostedRefresh).not.toHaveBeenCalled();
  });

  it("returns mailbox refresh progress when no late same-conversation captures appear", async () => {
    const basePort: AssistantTurnInputPort = {
      refresh: vi.fn<AssistantTurnInputPort["refresh"]>(async () => ({
        progressed: false,
        reason: "no_new_input",
      })),
      listNewConversationCaptures: vi.fn<
        AssistantTurnInputPort["listNewConversationCaptures"]
      >(async (query) => ({
        captures: [],
        nextCursor: query.afterCursor,
      })),
    };
    const beforeDeliveryResult: AssistantTurnInputRefreshResult = {
      progressed: true,
      reason: "ingested_input",
    };
    const beforeDeliveryRefresh = vi.fn<HostedRuntimeBeforeDeliveryMailboxRefresh>(
      async () => beforeDeliveryResult,
    );
    const port = createPort({
      basePort,
      beforeDeliveryRefresh,
    });

    await expect(port?.refresh({ phase: "before_delivery" })).resolves.toEqual(
      beforeDeliveryResult,
    );
    expect(beforeDeliveryRefresh).toHaveBeenCalledWith({
      requestId: "req_turn_input",
    });
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
      })
      .mockResolvedValueOnce({
        events: [],
      });

    const importedEvents: HostedRunEventResult[] = [];
    const port = createPort({
      basePort,
      hostedRefresh,
      onImportedEvent(result) {
        importedEvents.push(result);
      },
    });
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
      progressed: false,
      reason: "no_new_input",
    });
    await expect(port?.refresh({ phase: "after_tool_result" })).resolves.toEqual({
      progressed: false,
      reason: "source_unavailable",
    });
    await expect(port?.refresh({ phase: "before_provider" })).resolves.toEqual({
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
      afterSeq: "12",
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
    expect(hostedRefresh).toHaveBeenNthCalledWith(5, {
      afterSeq: "14",
      phase: "before_provider",
      requestId: "req_turn_input",
    });
    expect(mocks.ingestHostedConversationMessageWake).toHaveBeenCalledTimes(2);
    expect(importedEvents).toEqual([
      {
        ingressEventId: "ingress_first",
        state: "completed",
      },
      {
        ingressEventId: "ingress_second",
        state: "completed",
      },
    ]);
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
    expect(baseRefresh).toHaveBeenCalledTimes(5);
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
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith({
      component: "runtime",
      details: {
        requestId: "req_turn_input",
      },
      error: hostedError,
      level: "warn",
      message: "Hosted assistant turn-input refresh failed before delivery.",
      phase: "wake.running",
      wake: TIMER_WAKE,
    });
    expect(mocks.ingestHostedConversationMessageWake).not.toHaveBeenCalled();
    expect(baseRefresh).not.toHaveBeenCalled();
    expect(baseListNewConversationCaptures).not.toHaveBeenCalled();
  });

  it("logs and rethrows when hosted mailbox refresh fails before delivery", async () => {
    vi.clearAllMocks();

    const baseRefresh = vi.fn<AssistantTurnInputPort["refresh"]>();
    const baseListNewConversationCaptures = vi.fn<
      AssistantTurnInputPort["listNewConversationCaptures"]
    >();
    const basePort: AssistantTurnInputPort = {
      refresh: baseRefresh,
      listNewConversationCaptures: baseListNewConversationCaptures,
    };
    const hostedError = new Error("hosted mailbox refresh failed");
    const beforeDeliveryRefresh = vi
      .fn<HostedRuntimeBeforeDeliveryMailboxRefresh>()
      .mockRejectedValueOnce(hostedError);

    const port = createPort({ basePort, beforeDeliveryRefresh });
    expect(port).toBeDefined();

    await expect(port?.refresh({ phase: "before_delivery" })).rejects.toThrow(
      "hosted mailbox refresh failed",
    );

    expect(beforeDeliveryRefresh).toHaveBeenCalledWith({
      requestId: "req_turn_input",
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledTimes(1);
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith({
      component: "runtime",
      details: {
        requestId: "req_turn_input",
      },
      error: hostedError,
      level: "warn",
      message: "Hosted assistant mailbox refresh failed before delivery.",
      phase: "wake.running",
      wake: TIMER_WAKE,
    });
    expect(baseRefresh).not.toHaveBeenCalled();
    expect(baseListNewConversationCaptures).not.toHaveBeenCalled();
  });
});
