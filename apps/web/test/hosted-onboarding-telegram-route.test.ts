import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  handleHostedOnboardingTelegramWebhook: vi.fn(),
  handleHostedTelegramGroupReactionWebhook: vi.fn(),
  sendHostedTelegramTextMessage: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");

  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock("@/src/lib/hosted-onboarding/webhook-service", () => ({
  handleHostedOnboardingTelegramWebhook: mocks.handleHostedOnboardingTelegramWebhook,
}));

vi.mock("@/src/lib/hosted-onboarding/telegram-group-reactions", () => ({
  handleHostedTelegramGroupReactionWebhook:
    mocks.handleHostedTelegramGroupReactionWebhook,
}));

vi.mock("@/src/lib/hosted-onboarding/telegram-client", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/telegram-client")>(
    "@/src/lib/hosted-onboarding/telegram-client",
  );

  return {
    ...actual,
    sendHostedTelegramTextMessage: mocks.sendHostedTelegramTextMessage,
  };
});

type HostedOnboardingTelegramRouteModule = typeof import("../app/api/hosted-onboarding/telegram/webhook/route");

let hostedOnboardingTelegramRoute: HostedOnboardingTelegramRouteModule;

describe("hosted onboarding Telegram webhook route", () => {
  beforeAll(async () => {
    hostedOnboardingTelegramRoute = await import("../app/api/hosted-onboarding/telegram/webhook/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "telegram-secret");
    mocks.after.mockImplementation((callback: () => void) => callback());
    mocks.handleHostedOnboardingTelegramWebhook.mockResolvedValue({
      ok: true,
    });
    mocks.handleHostedTelegramGroupReactionWebhook.mockResolvedValue(null);
    mocks.sendHostedTelegramTextMessage.mockResolvedValue(undefined);
  });

  it("does not expose a public GET health handler", () => {
    expect(hostedOnboardingTelegramRoute).not.toHaveProperty("GET");
  });

  it("forwards ordinary updates into the hosted Telegram message service", async () => {
    const rawBody = JSON.stringify({ ok: true });
    const request = new Request("https://join.example.test/api/hosted-onboarding/telegram/webhook", {
      method: "POST",
      body: rawBody,
      headers: {
        "x-telegram-bot-api-secret-token": "telegram-secret",
      },
    });

    const response = await hostedOnboardingTelegramRoute.POST(request);

    expect(response.status).toBe(202);
    expect(mocks.handleHostedTelegramGroupReactionWebhook).toHaveBeenCalledWith({
      rawBody,
      scheduleAfterResponse: expect.any(Function),
      signal: request.signal,
    });
    expect(mocks.handleHostedOnboardingTelegramWebhook).toHaveBeenCalledWith({
      rawBody,
      scheduleAfterResponse: expect.any(Function),
      secretToken: "telegram-secret",
      signal: request.signal,
    });
  });

  it("handles reaction updates durably without passing them through reply planning", async () => {
    const rawBody = JSON.stringify({
      message_reaction: {
        chat: { id: -100123, type: "group" },
        date: 1_785_000_000,
        message_id: 17,
        new_reaction: [{ emoji: "😂", type: "emoji" }],
        old_reaction: [],
      },
      update_id: 123,
    });
    mocks.handleHostedTelegramGroupReactionWebhook.mockResolvedValueOnce({
      ok: true,
      reason: "durable-telegram-group-reaction",
    });
    const request = new Request("https://join.example.test/api/hosted-onboarding/telegram/webhook", {
      method: "POST",
      body: rawBody,
      headers: {
        "x-telegram-bot-api-secret-token": "telegram-secret",
      },
    });

    const response = await hostedOnboardingTelegramRoute.POST(request);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      reason: "durable-telegram-group-reaction",
    });
    expect(mocks.handleHostedTelegramGroupReactionWebhook).toHaveBeenCalledWith({
      rawBody,
      scheduleAfterResponse: expect.any(Function),
      signal: request.signal,
    });
    expect(mocks.handleHostedOnboardingTelegramWebhook).not.toHaveBeenCalled();
  });

  it("maps visible Telegram provider refusal through the public route", async () => {
    mocks.handleHostedOnboardingTelegramWebhook.mockResolvedValueOnce({
      ignored: true,
      ok: true,
      reason: "ambiguous-telegram-binding",
    });
    mocks.sendHostedTelegramTextMessage.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_TELEGRAM_API_REQUEST_FAILED",
      httpStatus: 502,
      message: "Telegram sendMessage failed.",
      retryable: true,
    }));
    const rawBody = JSON.stringify({
      message: {
        chat: {
          first_name: "Alice",
          id: 42,
          type: "private",
        },
        date: 1_785_000_000,
        from: {
          first_name: "Alice",
          id: 42,
          is_bot: false,
        },
        message_id: 17,
        text: "hello",
      },
      update_id: 123,
    });

    const response = await hostedOnboardingTelegramRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/telegram/webhook", {
        body: rawBody,
        headers: {
          "x-telegram-bot-api-secret-token": "telegram-secret",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_TELEGRAM_API_REQUEST_FAILED",
        message: "Telegram sendMessage failed.",
        retryable: true,
      },
    });
    expect(mocks.sendHostedTelegramTextMessage).toHaveBeenCalledWith({
      message: "This Telegram account isn't linked cleanly. Reconnect Telegram in Murph Settings or contact support.",
      replyToMessageId: 17,
      signal: expect.any(AbortSignal),
      target: expect.objectContaining({ chatId: "42" }),
    });
  });

  it("replies to a Family draft conflict in the initiating Telegram message", async () => {
    mocks.handleHostedOnboardingTelegramWebhook.mockResolvedValueOnce({
      ignored: true,
      ok: true,
      reason: "family-invite-draft-recovery-required",
    });
    const rawBody = JSON.stringify({
      message: {
        chat: {
          id: 42,
          type: "private",
        },
        date: 1_785_000_000,
        from: {
          first_name: "Invitee",
          id: 42,
          is_bot: false,
        },
        message_id: 18,
        text: "/start family_route_recovery",
      },
      update_id: 124,
    });

    const response = await hostedOnboardingTelegramRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/telegram/webhook", {
        body: rawBody,
        headers: {
          "x-telegram-bot-api-secret-token": "telegram-secret",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "visible-secondary-reply:family-invite-draft-recovery-required",
    });
    expect(mocks.sendHostedTelegramTextMessage).toHaveBeenCalledWith({
      message: expect.stringContaining(
        "familyInviteReturn=%2Ffamily%2Faccept%2Froute_recovery",
      ),
      replyToMessageId: 18,
      signal: expect.any(AbortSignal),
      target: expect.objectContaining({ chatId: "42" }),
    });
  });

  it("rejects invalid Telegram secrets before reading the request body", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const body = new ReadableStream<Uint8Array>({
        pull() {
          throw new Error("Telegram webhook body was read before secret validation.");
        },
      });
      const request = new Request("https://join.example.test/api/hosted-onboarding/telegram/webhook", {
        body,
        duplex: "half",
        headers: {
          "x-telegram-bot-api-secret-token": "wrong-secret",
        },
        method: "POST",
      } as RequestInit & { duplex: "half" });

      const response = await hostedOnboardingTelegramRoute.POST(request);

      expect(response.status).toBe(401);
      expect(mocks.handleHostedTelegramGroupReactionWebhook).not.toHaveBeenCalled();
      expect(mocks.handleHostedOnboardingTelegramWebhook).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "TELEGRAM_WEBHOOK_SECRET_INVALID",
          message: "Invalid Telegram webhook secret.",
          retryable: false,
        },
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("wrong-secret");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects oversized Telegram webhook bodies before calling either service", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const request = new Request("https://join.example.test/api/hosted-onboarding/telegram/webhook", {
        body: "{}",
        headers: {
          "content-length": String(256 * 1024 + 1),
          "x-telegram-bot-api-secret-token": "telegram-secret",
        },
        method: "POST",
      });

      const response = await hostedOnboardingTelegramRoute.POST(request);

      expect(response.status).toBe(413);
      expect(mocks.handleHostedTelegramGroupReactionWebhook).not.toHaveBeenCalled();
      expect(mocks.handleHostedOnboardingTelegramWebhook).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "TELEGRAM_WEBHOOK_BODY_TOO_LARGE",
          message: "Telegram webhook body is too large.",
          retryable: false,
        },
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("{}");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("maps in-progress receipt retries to a retryable 503 response", async () => {
    mocks.handleHostedOnboardingTelegramWebhook.mockRejectedValue(
      hostedOnboardingError({
        code: "WEBHOOK_RECEIPT_IN_PROGRESS",
        httpStatus: 503,
        message: "Hosted webhook receipt is already being processed.",
        retryable: true,
      }),
    );

    const response = await hostedOnboardingTelegramRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/telegram/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
        headers: {
          "x-telegram-bot-api-secret-token": "telegram-secret",
        },
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WEBHOOK_RECEIPT_IN_PROGRESS",
        message: "Hosted webhook receipt is already being processed.",
        retryable: true,
      },
    });
  });
});
