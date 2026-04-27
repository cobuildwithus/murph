import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createInboxBackedAssistantTurnInputPort: vi.fn(),
  emitHostedExecutionStructuredLog: vi.fn(),
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

import type {
  AssistantTurnInputRefreshResult,
  AssistantTurnInputPort,
} from "@murphai/assistant-engine";
import {
  createAssistantTurnBeforeDeliveryHook,
  isAssistantTurnRevisionRequiredError,
} from "@murphai/assistant-engine";
import type {
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";

import {
  createHostedAssistantTurnInputPort,
} from "../src/hosted-runtime/turn-input.ts";
import type {
  HostedRuntimeBeforeDeliveryMailboxRefresh,
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
}): AssistantTurnInputPort | undefined {
  const inboxServices = {} as InboxServicesInput;
  mocks.createInboxBackedAssistantTurnInputPort.mockReturnValueOnce(input.basePort);

  return createHostedAssistantTurnInputPort({
    inboxServices,
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
      },
      platformEnv: {},
    },
    vaultRoot: "/tmp/vault-root",
    wake: TIMER_WAKE,
  });
}

describe("createHostedAssistantTurnInputPort", () => {
  it("returns undefined when the hosted platform has no mailbox refresh port", () => {
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
    const port = createPort({
      basePort,
      beforeDeliveryRefresh,
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
