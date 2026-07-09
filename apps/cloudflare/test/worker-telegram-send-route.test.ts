import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCloudflareHostedControlTelegramUsageLimitNoticeAuthorityBody,
  signCloudflareHostedControlTelegramUsageLimitNoticeAuthority,
} from "@murphai/cloudflare-hosted-control/client";

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
  handleTelegramUsageLimitNoticeRoute,
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
      HOSTED_TELEGRAM_USAGE_LIMIT_NOTICE_AUTHORITY_SECRET: "authority-secret",
      TELEGRAM_BOT_TOKEN: "telegram-token",
    },
    request,
    url: new URL(request.url),
  } as never;
}

describe("worker Telegram send route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"));
    mocks.emitHostedExecutionStructuredLog.mockReset();
    mocks.sendHostedProviderTelegramMessage.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delegates valid Telegram sends to the Worker-owned provider effect", async () => {
    mocks.sendHostedProviderTelegramMessage.mockResolvedValueOnce({
      providerMessageId: "7001",
      target: "telegram_thread:runtime-denied",
      targetKind: "thread",
    });

    const response = await handleTelegramUsageLimitNoticeRoute(createRouteContext({
      authority: await createTelegramUsageLimitNoticeAuthority(),
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

    const response = await handleTelegramUsageLimitNoticeRoute(createRouteContext({
      authority: await createTelegramUsageLimitNoticeAuthority(),
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

    const response = await handleTelegramUsageLimitNoticeRoute(createRouteContext({
      authority: await createTelegramUsageLimitNoticeAuthority(),
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

  it("rejects tampered Telegram usage-limit notice authority before provider egress", async () => {
    const authority = await createTelegramUsageLimitNoticeAuthority();
    const response = await handleTelegramUsageLimitNoticeRoute(createRouteContext({
      authority: {
        ...authority,
        target: "telegram_thread:other",
      },
    }), "member_123");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "authority_invalid",
      error: "Telegram usage-limit notice authority is invalid.",
    });
    expect(mocks.sendHostedProviderTelegramMessage).not.toHaveBeenCalled();
  });

  it("fails closed when Telegram usage-limit authority verification is unavailable", async () => {
    const context = createRouteContext({
      authority: await createTelegramUsageLimitNoticeAuthority(),
    });
    context.env.HOSTED_TELEGRAM_USAGE_LIMIT_NOTICE_AUTHORITY_SECRET = undefined;

    const response = await handleTelegramUsageLimitNoticeRoute(context, "member_123");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "authority_unavailable",
      error: "Telegram usage-limit notice authority verification is unavailable.",
    });
    expect(mocks.sendHostedProviderTelegramMessage).not.toHaveBeenCalled();
  });
});

async function createTelegramUsageLimitNoticeAuthority() {
  return await signCloudflareHostedControlTelegramUsageLimitNoticeAuthority({
    body: buildCloudflareHostedControlTelegramUsageLimitNoticeAuthorityBody({
      expiresAt: "2026-05-20T12:15:00.000Z",
      idempotencyKey: "ai-usage-gate:member_123:2026-05",
      issuedAt: "2026-05-20T12:00:00.000Z",
      message: "Usage limit reached.",
      noticeCode: "edge_usage_limit_reached",
      periodStart: "2026-05-01T00:00:00.000Z",
      replyToMessageId: "7000",
      sourceEventId: "telegram_event_runtime_denied",
      target: "telegram_thread:runtime-denied",
      userId: "member_123",
    }),
    secret: "authority-secret",
  });
}
