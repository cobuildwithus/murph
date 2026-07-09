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
  handleTelegramSendRoute,
} from "../src/worker/route-handlers/telegram-send.ts";

function createRouteContext(body: unknown): Parameters<typeof handleTelegramSendRoute>[0] {
  const request = new Request("https://runner.example.test/internal/users/member_123/telegram/send", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  return {
    env: {
      TELEGRAM_BOT_TOKEN: "telegram-token",
    },
    request,
    url: new URL(request.url),
  } as never;
}

describe("worker Telegram send route", () => {
  beforeEach(() => {
    mocks.emitHostedExecutionStructuredLog.mockReset();
    mocks.sendHostedProviderTelegramMessage.mockReset();
  });

  it("delegates valid Telegram sends to the Worker-owned provider effect", async () => {
    mocks.sendHostedProviderTelegramMessage.mockResolvedValueOnce({
      providerMessageId: "7001",
      target: "telegram_thread:runtime-denied",
      targetKind: "thread",
    });

    const response = await handleTelegramSendRoute(createRouteContext({
      idempotencyKey: "ai-usage-gate:member_123:2026-05",
      message: "Usage limit reached.",
      replyToMessageId: "7000",
      target: "telegram_thread:runtime-denied",
    }), "member_123");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      providerMessageId: "7001",
      status: "sent",
      target: "telegram_thread:runtime-denied",
      targetKind: "thread",
    });
    expect(mocks.sendHostedProviderTelegramMessage).toHaveBeenCalledWith(
      {
        idempotencyKey: "ai-usage-gate:member_123:2026-05",
        message: "Usage limit reached.",
        replyToMessageId: "7000",
        target: "telegram_thread:runtime-denied",
      },
      expect.objectContaining({
        env: expect.objectContaining({
          TELEGRAM_BOT_TOKEN: "telegram-token",
        }),
        fetchImplementation: expect.any(Function),
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

    const response = await handleTelegramSendRoute(createRouteContext({
      message: "Usage limit reached.",
      target: "telegram_thread:runtime-denied",
    }), "member_123");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      failureCode: "ASSISTANT_TELEGRAM_RATE_LIMITED",
      failureReason: "Too Many Requests",
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
          routeName: "telegram-send",
        }),
        message: "Hosted worker Telegram send route returned a provider failure.",
      }),
    );
  });

  it("does not mark ambiguous Telegram provider failures retryable", async () => {
    const failure = Object.assign(new Error("request outcome is ambiguous"), {
      code: "ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS",
      deliveryMayHaveSucceeded: true,
    });
    mocks.sendHostedProviderTelegramMessage.mockRejectedValueOnce(failure);

    const response = await handleTelegramSendRoute(createRouteContext({
      message: "Usage limit reached.",
      target: "telegram_thread:runtime-denied",
    }), "member_123");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      failureCode: "ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS",
      failureReason: "request outcome is ambiguous",
      retryable: false,
      status: "failed",
    });
  });

  it("rejects malformed Telegram send bodies", async () => {
    const response = await handleTelegramSendRoute(createRouteContext({
      target: "telegram_thread:runtime-denied",
    }), "member_123");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_request",
      error: "Malformed Telegram send request.",
    });
    expect(mocks.sendHostedProviderTelegramMessage).not.toHaveBeenCalled();
  });
});
