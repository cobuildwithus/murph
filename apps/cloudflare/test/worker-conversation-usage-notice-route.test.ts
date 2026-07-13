import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
} from "@murphai/runtime-state";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
  providerFetch: vi.fn(),
  sendHostedEmailMessage: vi.fn(),
  sendHostedProviderWhatsAppMessage: vi.fn(),
}));

vi.mock("../src/web-control-plane.ts", () => ({
  fetchHostedExecutionWebControlPlaneResponse:
    mocks.fetchHostedExecutionWebControlPlaneResponse,
}));

vi.mock("../src/worker-fetch.ts", () => ({
  normalizeCloudflareWorkerFetch: () => mocks.providerFetch,
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
    "https://runner.example.test/internal/users/member_123/conversation/usage-notice-v2",
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
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    mocks.providerFetch.mockReset();
    mocks.providerFetch.mockResolvedValue(new Response(null, { status: 200 }));
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
    mocks.sendHostedProviderWhatsAppMessage.mockImplementationOnce(async (
      _request: unknown,
      dependencies: { fetchImplementation: typeof fetch },
    ) => {
      await dependencies.fetchImplementation("https://provider.example.test/send");
      return {
        providerMessageId: "wamid.outbound",
        target: "15550100001",
      };
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
        providerDispatchAttempt: createProviderDispatchAttempt(),
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
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledOnce();
    expect(mocks.providerFetch).toHaveBeenCalledOnce();
  });

  it("treats revoked provider-entry authority as a definite non-retryable stop", async () => {
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValueOnce(
      new Response(null, { status: 410 }),
    );
    mocks.sendHostedProviderWhatsAppMessage.mockImplementationOnce(async (
      _request: unknown,
      dependencies: { fetchImplementation: typeof fetch },
    ) => {
      await dependencies.fetchImplementation("https://provider.example.test/send");
      throw new Error("Provider fetch should not return after a revoked fence.");
    });

    const response = await handleConversationUsageNoticeRoute(
      createRouteContext(createWhatsAppRequest()),
      "member_123",
    );

    await expect(response.json()).resolves.toEqual({
      deliveryMayHaveSucceeded: false,
      failureCode: "HOSTED_USAGE_NOTICE_PROVIDER_AUTHORITY_SUPERSEDED",
      retryable: false,
      status: "failed",
    });
    expect(mocks.providerFetch).not.toHaveBeenCalled();
  });

  it("delegates email replies to the existing hosted email adapter", async () => {
    mocks.sendHostedEmailMessage.mockImplementationOnce(async (input: {
      onProviderDispatchEntered?: () => Promise<void> | void;
    }) => {
      await input.onProviderDispatchEntered?.();
      return {
        delivery: {
          failedCount: 0,
          sentCount: 1,
          skippedCount: 0,
          status: "sent",
        },
        target: "thread-1",
      };
    });

    const response = await handleConversationUsageNoticeRoute(
      createRouteContext({
        channel: "email",
        message: "Usage limit reached.",
        providerDispatchAttempt: createProviderDispatchAttempt(),
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

  it("rejects aggregate group-email usage notices before provider entry", async () => {
    const response = await handleConversationUsageNoticeRoute(
      createRouteContext({
        channel: "email",
        message: "Usage limit reached.",
        providerDispatchAttempt: createProviderDispatchAttempt(),
        replyToMessageId: "email-message-1",
        subject: null,
        target: serializeHostedEmailThreadTarget(
          createHostedEmailThreadTarget({
            groupId: "group-1",
            lastMessageId: "email-message-1",
            targetKind: "group",
          }),
        ),
        targetKind: "thread",
      }),
      "member_123",
    );

    await expect(response.json()).resolves.toEqual({
      deliveryMayHaveSucceeded: false,
      failureCode: "HOSTED_EMAIL_USAGE_NOTICE_GROUP_TARGET_UNSUPPORTED",
      retryable: false,
      status: "failed",
    });
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
    expect(mocks.sendHostedEmailMessage).not.toHaveBeenCalled();
  });

  it("keeps missing email delivery configuration retryable before provider dispatch", async () => {
    const response = await handleConversationUsageNoticeRoute(
      createRouteContext({
        channel: "email",
        message: "Usage limit reached.",
        providerDispatchAttempt: createProviderDispatchAttempt(),
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
      deliveryMayHaveSucceeded: false,
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
      deliveryMayHaveSucceeded: false,
      failureCode: "ASSISTANT_WHATSAPP_UNAVAILABLE",
      retryable: true,
      status: "failed",
    });
    expect(JSON.stringify(payload)).not.toContain("secret provider detail");
  });

  it.each([
    "ASSISTANT_WHATSAPP_ACCESS_TOKEN_REQUIRED",
    "ASSISTANT_WHATSAPP_PHONE_NUMBER_ID_REQUIRED",
  ])("keeps definite pre-provider WhatsApp configuration failures retryable", async (
    code,
  ) => {
    mocks.sendHostedProviderWhatsAppMessage.mockRejectedValueOnce(
      Object.assign(new Error("provider configuration missing"), { code }),
    );

    const response = await handleConversationUsageNoticeRoute(
      createRouteContext(createWhatsAppRequest()),
      "member_123",
    );

    await expect(response.json()).resolves.toEqual({
      deliveryMayHaveSucceeded: false,
      failureCode: code,
      retryable: true,
      status: "failed",
    });
  });

  it("consumes the WhatsApp owner's retryable HTTP disposition", async () => {
    mocks.sendHostedProviderWhatsAppMessage.mockRejectedValueOnce(
      Object.assign(new Error("provider unavailable"), {
        code: "ASSISTANT_WHATSAPP_REQUEST_FAILED",
        context: {
          failureStage: "http",
          retryable: true,
          status: 503,
        },
      }),
    );

    const response = await handleConversationUsageNoticeRoute(
      createRouteContext(createWhatsAppRequest()),
      "member_123",
    );

    await expect(response.json()).resolves.toEqual({
      deliveryMayHaveSucceeded: false,
      failureCode: "ASSISTANT_WHATSAPP_REQUEST_FAILED",
      retryable: true,
      status: "failed",
    });
  });

  it("keeps WhatsApp response-loss uncertainty non-retryable", async () => {
    mocks.sendHostedProviderWhatsAppMessage.mockRejectedValueOnce(
      Object.assign(new Error("provider response unavailable"), {
        code: "ASSISTANT_WHATSAPP_REQUEST_FAILED",
        context: {
          failureStage: "transport",
          retryable: true,
        },
      }),
    );

    const response = await handleConversationUsageNoticeRoute(
      createRouteContext(createWhatsAppRequest()),
      "member_123",
    );

    await expect(response.json()).resolves.toEqual({
      deliveryMayHaveSucceeded: true,
      failureCode: "ASSISTANT_WHATSAPP_REQUEST_FAILED",
      retryable: false,
      status: "failed",
    });
  });

  it.each(["timeout", "HTTP 503"])(
    "keeps email alias-registration %s failures retryable before binding dispatch",
    async (detail) => {
      mocks.sendHostedEmailMessage.mockRejectedValueOnce(
        new Error(`alias registration ${detail}`),
      );

      const response = await handleConversationUsageNoticeRoute(
        createRouteContext({
          channel: "email",
          message: "Usage limit reached.",
          providerDispatchAttempt: createProviderDispatchAttempt(),
          replyToMessageId: "email-message-1",
          subject: null,
          target: "thread-1",
          targetKind: "thread",
        }),
        "member_123",
      );

      await expect(response.json()).resolves.toEqual({
        deliveryMayHaveSucceeded: false,
        failureCode: "Error",
        retryable: true,
        status: "failed",
      });
    },
  );

  it("keeps email response-loss uncertainty non-retryable after binding dispatch", async () => {
    mocks.sendHostedEmailMessage.mockImplementationOnce(async (input: {
      onProviderDispatchEntered?: () => Promise<void> | void;
    }) => {
      await input.onProviderDispatchEntered?.();
      throw new Error("binding response unavailable");
    });

    const response = await handleConversationUsageNoticeRoute(
      createRouteContext({
        channel: "email",
        message: "Usage limit reached.",
        providerDispatchAttempt: createProviderDispatchAttempt(),
        replyToMessageId: "email-message-1",
        subject: null,
        target: "thread-1",
        targetKind: "thread",
      }),
      "member_123",
    );

    await expect(response.json()).resolves.toEqual({
      deliveryMayHaveSucceeded: true,
      failureCode: "Error",
      retryable: false,
      status: "failed",
    });
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
    providerDispatchAttempt: createProviderDispatchAttempt(),
    replyToMessageId: "wamid.inbound",
    target: "15550100001",
  };
}

function createProviderDispatchAttempt() {
  return {
    attemptedAt: "2026-07-13T12:00:00.000Z",
    sourceEventId: "conversation-event-1",
  };
}
