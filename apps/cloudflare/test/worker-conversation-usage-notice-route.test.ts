import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
  sendHostedEmailMessage: vi.fn(),
  sendHostedProviderWhatsAppMessage: vi.fn(),
}));

vi.mock("@murphai/assistant-runtime/hosted-provider-effects", () => ({
  sendHostedProviderWhatsAppMessage: mocks.sendHostedProviderWhatsAppMessage,
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

vi.mock("../src/hosted-email.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/hosted-email.ts")>(
    "../src/hosted-email.ts",
  );

  return {
    ...actual,
    sendHostedEmailMessage: mocks.sendHostedEmailMessage,
  };
});

import {
  conversationUsageNoticeRoutes,
} from "../src/worker/route-handlers/conversation-usage-notice.ts";

function createRouteContext(
  body: unknown,
  environmentOverrides: Record<string, unknown> = {},
): Parameters<typeof handleConversationUsageNoticeRoute>[0] {
  const request = new Request(
    "https://runner.example.test/internal/users/member_123/conversation/usage-notice",
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
      HOSTED_EMAIL: {},
      HOSTED_EMAIL_DOMAIN: "example.test",
      HOSTED_EMAIL_SIGNING_SECRET: "test-signing-secret",
      WHATSAPP_ACCESS_TOKEN: "whatsapp-token",
      WHATSAPP_PHONE_NUMBER_ID: "whatsapp-phone-id",
      ...environmentOverrides,
    },
    environment: {
      hostedWebBaseUrl: "https://web.example.test",
      webCallbackSigning: null,
    },
    request,
    url: new URL(request.url),
  } as never;
}

function handleConversationUsageNoticeRoute(
  context: Parameters<(typeof conversationUsageNoticeRoutes)[number]["handle"]>[0],
  encodedUserId: string,
) {
  const route = conversationUsageNoticeRoutes[0];
  if (!route) {
    throw new TypeError("Expected the conversation usage notice route.");
  }
  return route.handle(context, { userId: encodedUserId });
}

describe("worker conversation usage notice route", () => {
  beforeEach(() => {
    mocks.emitHostedExecutionStructuredLog.mockReset();
    mocks.sendHostedEmailMessage.mockReset();
    mocks.sendHostedProviderWhatsAppMessage.mockReset();
  });

  it("requires Vercel OIDC and a bound user before the handler", async () => {
    const route = conversationUsageNoticeRoutes[0];
    if (!route?.beforeMethod) {
      throw new TypeError("Expected the conversation usage notice auth guard.");
    }

    expect(route.authorization).toBe("vercel-oidc");
    expect(route.authorizeBeforeMethod).toBe(true);
    const response = await route.beforeMethod(
      createRouteContext(createWhatsAppRequest()),
      { userId: "member_123" },
    );
    expect(response?.status).toBe(401);
    expect(mocks.sendHostedProviderWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("delegates WhatsApp replies to the Worker-owned provider effect", async () => {
    mocks.sendHostedProviderWhatsAppMessage.mockResolvedValueOnce({
      providerMessageId: "wamid.outbound",
      target: "15550100001",
    });

    const response = await handleConversationUsageNoticeRoute(
      createRouteContext(createWhatsAppRequest()),
      "member_123",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "sent" });
    expect(mocks.sendHostedProviderWhatsAppMessage).toHaveBeenCalledWith(
      {
        channel: "whatsapp",
        message: "Usage limit reached.",
        replyToMessageId: "wamid.inbound",
        target: "15550100001",
      },
      expect.objectContaining({
        env: expect.objectContaining({
          WHATSAPP_ACCESS_TOKEN: "whatsapp-token",
        }),
        fetchImplementation: expect.any(Function),
      }),
    );
  });

  it("delegates email replies to the existing hosted email adapter", async () => {
    mocks.sendHostedEmailMessage.mockResolvedValueOnce({
      delivery: {
        failedCount: 0,
        sentCount: 1,
        skippedCount: 0,
        status: "sent",
      },
      target: "thread-1",
    });

    const response = await handleConversationUsageNoticeRoute(
      createRouteContext({
        channel: "email",
        message: "Usage limit reached.",
        replyToMessageId: "email-message-1",
        subject: null,
        target: "thread-1",
        targetKind: "thread",
      }),
      "member_123",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "sent" });
    expect(mocks.sendHostedEmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          message: "Usage limit reached.",
          replyToMessageId: "email-message-1",
          subject: null,
          target: "thread-1",
          targetKind: "thread",
        },
        userId: "member_123",
      }),
    );
  });

  it("keeps missing email delivery configuration retryable before provider dispatch", async () => {
    const response = await handleConversationUsageNoticeRoute(
      createRouteContext({
        channel: "email",
        message: "Usage limit reached.",
        replyToMessageId: "email-message-1",
        subject: null,
        target: "thread-1",
        targetKind: "thread",
      }, {
        HOSTED_EMAIL: undefined,
        HOSTED_EMAIL_DOMAIN: undefined,
        HOSTED_EMAIL_SIGNING_SECRET: undefined,
      }),
      "member_123",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      failureCode: "ASSISTANT_EMAIL_UNAVAILABLE",
      retryable: true,
      status: "failed",
    });
    expect(mocks.sendHostedEmailMessage).not.toHaveBeenCalled();
  });

  it("returns retryable provider failures without exposing error text", async () => {
    mocks.sendHostedProviderWhatsAppMessage.mockRejectedValueOnce(
      Object.assign(new Error("secret provider detail"), {
        code: "ASSISTANT_WHATSAPP_UNAVAILABLE",
      }),
    );

    const response = await handleConversationUsageNoticeRoute(
      createRouteContext(createWhatsAppRequest()),
      "member_123",
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      failureCode: "ASSISTANT_WHATSAPP_UNAVAILABLE",
      retryable: true,
      status: "failed",
    });
    expect(JSON.stringify(payload)).not.toContain("secret provider detail");
  });

  it("rejects malformed provider request bodies", async () => {
    const response = await handleConversationUsageNoticeRoute(
      createRouteContext({ channel: "whatsapp", target: "15550100001" }),
      "member_123",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_request",
      error: "Malformed conversation usage notice request.",
    });
    expect(mocks.sendHostedProviderWhatsAppMessage).not.toHaveBeenCalled();
  });
});

function createWhatsAppRequest() {
  return {
    channel: "whatsapp",
    message: "Usage limit reached.",
    replyToMessageId: "wamid.inbound",
    target: "15550100001",
  };
}
