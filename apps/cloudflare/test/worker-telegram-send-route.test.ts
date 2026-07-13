import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
  sendHostedProviderTelegramMessage: vi.fn(),
}));

vi.mock("@murphai/assistant-runtime/hosted-provider-effects", () => ({
  sendHostedProviderTelegramMessage: mocks.sendHostedProviderTelegramMessage,
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

import {
  telegramUsageLimitNoticeRoutes,
} from "../src/worker/route-handlers/telegram-send.ts";

function createRouteContext(
  body: unknown,
): Parameters<typeof handleTelegramUsageLimitNoticeRoute>[0] {
  const request = new Request(
    "https://runner.example.test/internal/users/member_123/telegram/usage-limit-notice",
    {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
    },
  );
  return {
    env: {
      TELEGRAM_BOT_TOKEN: "telegram-token",
    },
    request,
    url: new URL(request.url),
  } as never;
}

function handleTelegramUsageLimitNoticeRoute(
  context: Parameters<(typeof telegramUsageLimitNoticeRoutes)[number]["handle"]>[0],
  encodedUserId: string,
) {
  const route = telegramUsageLimitNoticeRoutes[0];
  if (!route) {
    throw new TypeError("Expected the Telegram usage-limit notice route.");
  }
  return route.handle(context, { userId: encodedUserId });
}

describe("worker Telegram send route", () => {
  beforeEach(() => {
    mocks.emitHostedExecutionStructuredLog.mockReset();
    mocks.sendHostedProviderTelegramMessage.mockReset();
  });

  it("requires Vercel OIDC and a bound user before the handler", async () => {
    const route = telegramUsageLimitNoticeRoutes[0];
    if (!route?.beforeMethod) {
      throw new TypeError("Expected the Telegram usage-limit notice route auth guard.");
    }

    expect(route.authorization).toBe("vercel-oidc");
    expect(route.authorizeBeforeMethod).toBe(true);
    const response = await route.beforeMethod(
      createRouteContext(createTelegramUsageLimitNoticeRequest()),
      { userId: "member_123" },
    );
    expect(response?.status).toBe(401);
    expect(mocks.sendHostedProviderTelegramMessage).not.toHaveBeenCalled();
  });

  it("delegates valid Telegram sends to the Worker-owned provider effect", async () => {
    mocks.sendHostedProviderTelegramMessage.mockResolvedValueOnce({
      providerMessageId: "7001",
      target: "telegram_thread:runtime-denied",
      targetKind: "thread",
    });

    const response = await handleTelegramUsageLimitNoticeRoute(
      createRouteContext(createTelegramUsageLimitNoticeRequest()),
      "member_123",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "sent",
    });
    expect(mocks.sendHostedProviderTelegramMessage).toHaveBeenCalledWith(
      {
        message: "Usage limit reached.",
        replyToMessageId: "7000",
        target: "telegram_thread:runtime-denied",
      },
      expect.objectContaining({
        env: expect.objectContaining({
          TELEGRAM_BOT_TOKEN: "telegram-token",
        }),
        fetchImplementation: expect.any(Function),
        telegramMaxDeliveryAttempts: 1,
      }),
    );
  });

  it("returns retryable provider failures as failed JSON responses", async () => {
    const failure = Object.assign(new Error("Too Many Requests"), {
      code: "ASSISTANT_TELEGRAM_RATE_LIMITED",
      context: {
        retryAfterSeconds: 42,
        status: 429,
      },
    });
    mocks.sendHostedProviderTelegramMessage.mockRejectedValueOnce(failure);

    const response = await handleTelegramUsageLimitNoticeRoute(
      createRouteContext(createTelegramUsageLimitNoticeRequest()),
      "member_123",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deliveryMayHaveSucceeded: false,
      failureCode: "ASSISTANT_TELEGRAM_RATE_LIMITED",
      retryAfterSeconds: 42,
      retryable: true,
      status: "failed",
    });
    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "worker",
        details: expect.objectContaining({
          failureCode: "ASSISTANT_TELEGRAM_RATE_LIMITED",
          retryAfterSeconds: 42,
          retryable: true,
          routeName: "telegram-usage-limit-notice",
        }),
        message: "Hosted worker Telegram usage-limit notice route returned a provider failure.",
      }),
    );
  });

  it("does not mark ambiguous Telegram provider failures retryable", async () => {
    const failure = Object.assign(new Error("request outcome is ambiguous"), {
      code: "ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS",
      deliveryMayHaveSucceeded: true,
    });
    mocks.sendHostedProviderTelegramMessage.mockRejectedValueOnce(failure);

    const response = await handleTelegramUsageLimitNoticeRoute(
      createRouteContext(createTelegramUsageLimitNoticeRequest()),
      "member_123",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deliveryMayHaveSucceeded: true,
      failureCode: "ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS",
      retryable: false,
      status: "failed",
    });
  });

  it("does not durably retry Telegram 5xx failures", async () => {
    const failure = Object.assign(new Error("Telegram unavailable"), {
      code: "ASSISTANT_TELEGRAM_DELIVERY_FAILED",
      context: {
        assistantDeliveryFailureClass: "transient",
        retryAfterSeconds: 42,
        status: 503,
      },
      retryable: true,
    });
    mocks.sendHostedProviderTelegramMessage.mockRejectedValueOnce(failure);

    const response = await handleTelegramUsageLimitNoticeRoute(
      createRouteContext(createTelegramUsageLimitNoticeRequest()),
      "member_123",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deliveryMayHaveSucceeded: false,
      failureCode: "ASSISTANT_TELEGRAM_DELIVERY_FAILED",
      retryable: false,
      status: "failed",
    });
  });

  it.each([
    "ASSISTANT_TELEGRAM_TOKEN_REQUIRED",
    "ASSISTANT_TELEGRAM_UNAVAILABLE",
  ])("retries the pre-provider Telegram configuration failure %s", async (code) => {
    mocks.sendHostedProviderTelegramMessage.mockRejectedValueOnce(
      Object.assign(new Error("Telegram is not configured"), { code }),
    );

    const response = await handleTelegramUsageLimitNoticeRoute(
      createRouteContext(createTelegramUsageLimitNoticeRequest()),
      "member_123",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deliveryMayHaveSucceeded: false,
      failureCode: code,
      retryable: true,
      status: "failed",
    });
  });

  it("rejects malformed Telegram send bodies", async () => {
    const response = await handleTelegramUsageLimitNoticeRoute(createRouteContext({
      target: "telegram_thread:runtime-denied",
    }), "member_123");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_request",
      error: "Malformed Telegram usage-limit notice request.",
    });
    expect(mocks.sendHostedProviderTelegramMessage).not.toHaveBeenCalled();
  });

});

function createTelegramUsageLimitNoticeRequest() {
  return {
    message: "Usage limit reached.",
    replyToMessageId: "7000",
    target: "telegram_thread:runtime-denied",
  };
}
