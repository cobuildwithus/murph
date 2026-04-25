import { describe, expect, it, beforeEach, vi } from "vitest";

import { encodeHostedIngressStoredPayload } from "@/src/lib/hosted-ingress/payload";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { buildHostedMemberRoutingPrivateColumns } from "@/src/lib/hosted-onboarding/member-private-codecs";

const mocks = vi.hoisted(() => ({
  finishHostedOnboardingTiming: vi.fn(),
  sendHostedLinqTypingPing: vi.fn(),
  sendHostedLinqTypingStop: vi.fn(),
  startHostedOnboardingTiming: vi.fn((step: string, baseDetails: Record<string, unknown> = {}) => ({
    baseDetails,
    startedAtMs: 0,
    step,
  })),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({
  sendHostedLinqTypingPing: mocks.sendHostedLinqTypingPing,
  sendHostedLinqTypingStop: mocks.sendHostedLinqTypingStop,
}));

vi.mock("@/src/lib/hosted-onboarding/logging", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/logging")>(
    "@/src/lib/hosted-onboarding/logging",
  );

  return {
    ...actual,
    finishHostedOnboardingTiming: mocks.finishHostedOnboardingTiming,
    startHostedOnboardingTiming: mocks.startHostedOnboardingTiming,
  };
});

import {
  parseHostedLinqTypingDiagnosticRequest,
  prepareHostedLinqTypingDiagnostic,
  runHostedLinqTypingDiagnosticBurst,
  type HostedLinqTypingDiagnosticPlan,
} from "@/src/lib/hosted-onboarding/linq-typing-diagnostic";

describe("hosted Linq typing diagnostic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC = "1";
    process.env.LINQ_API_TOKEN = "test_linq_token";
    mocks.sendHostedLinqTypingPing.mockResolvedValue({
      ok: true,
      status: 204,
    });
    mocks.sendHostedLinqTypingStop.mockResolvedValue({
      ok: true,
      status: 204,
    });
  });

  it("prepares a diagnostic from the latest encrypted Linq ingress without exposing the chat id in the public target", async () => {
    const encodedPayload = encodeHostedIngressStoredPayload({
      userId: "member_123",
      value: {
        eventId: "evt_123",
        kind: "conversation.message",
        message: {
          channel: "linq",
          linqMessage: {
            chatId: "chat_123",
          },
        },
        occurredAt: "2026-04-25T10:00:00.000Z",
        userId: "member_123",
      },
    });
    const prisma = {
      hostedIngressEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            createdAt: new Date("2026-04-25T10:00:00.000Z"),
            payload: null,
            payloadInlineCiphertext: encodedPayload.payloadInlineCiphertext,
            userId: "member_123",
          },
        ]),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_123",
          telegramUserLookupKey: null,
          ...buildHostedMemberRoutingPrivateColumns({
            linqChatId: "chat_123",
            linqRecipientPhone: null,
            memberId: "member_123",
            pendingLinqChatId: null,
            pendingLinqRecipientPhone: null,
            telegramThreadId: null,
            telegramUserId: null,
          }),
        }),
      },
    };
    const request = parseHostedLinqTypingDiagnosticRequest({
      delaysMs: [0],
      mode: "inline",
      timeoutMs: 100,
    });

    const plan = await prepareHostedLinqTypingDiagnostic({
      prisma,
      request,
    });

    expect(plan.chatId).toBe("chat_123");
    expect(plan.target).toMatchObject({
      chatIdPresent: true,
      latestIngressMatched: true,
      routedChatIdPresent: true,
      routedChatMatched: true,
      source: "latest-linq-ingress",
    });
    expect(JSON.stringify(plan.target)).not.toContain("chat_123");
  });

  it("runs start and optional stop attempts while returning only sanitized attempt metadata", async () => {
    const target = {
      chatIdPresent: true,
      ingressAgeMs: 0,
      latestIngressMatched: true,
      routedChatIdPresent: true,
      routedChatMatched: true,
      source: "latest-linq-ingress",
    } satisfies HostedLinqTypingDiagnosticPlan["target"];
    const plan: HostedLinqTypingDiagnosticPlan = {
      chatId: "chat_123",
      delaysMs: [0],
      stop: true,
      stopDelayMs: 0,
      target,
      timeoutMs: 100,
    };

    const result = await runHostedLinqTypingDiagnosticBurst({
      plan,
    });

    expect(result.ok).toBe(true);
    expect(mocks.sendHostedLinqTypingPing).toHaveBeenCalledWith({
      chatId: "chat_123",
      signal: undefined,
      timeoutMs: 100,
    });
    expect(mocks.sendHostedLinqTypingStop).toHaveBeenCalledWith({
      chatId: "chat_123",
      signal: undefined,
      timeoutMs: 100,
    });
    expect(result.attempts).toEqual([
      expect.objectContaining({
        attempt: 1,
        httpStatus: 204,
        ok: true,
        operation: "start",
      }),
      expect.objectContaining({
        attempt: 2,
        httpStatus: 204,
        ok: true,
        operation: "stop",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("chat_123");
  });

  it("rejects the diagnostic when the production flag is disabled", async () => {
    process.env.HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC = "0";
    const request = parseHostedLinqTypingDiagnosticRequest({
      delaysMs: [0],
      timeoutMs: 100,
    });

    await expect(prepareHostedLinqTypingDiagnostic({
      prisma: {
        hostedIngressEvent: {
          findMany: vi.fn(),
        },
        hostedMemberRouting: {
          findUnique: vi.fn(),
        },
      },
      request,
    })).rejects.toMatchObject(
      hostedOnboardingError({
        code: "HOSTED_LINQ_TYPING_DIAGNOSTIC_DISABLED",
        httpStatus: 403,
        message: "Hosted Linq typing diagnostic is disabled.",
      }),
    );
  });
});
