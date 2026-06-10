import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
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
  HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
  HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
} from "@murphai/hosted-execution/hosted-email";
import {
  createHostedEmailThreadTarget,
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
} from "@murphai/runtime-state";
import { EmailMessage } from "cloudflare:email";

import type { HostedEmailConfig } from "../src/hosted-email/config.ts";
import {
  readHostedEmailMessageBytes,
  readHostedEmailRawMessage,
  writeHostedEmailRawMessage,
} from "../src/hosted-email.ts";
import {
  createHostedEmailUserAddress,
  HostedEmailIngressRouteResolutionError,
  resolveHostedEmailIngressRoute,
  resolveHostedEmailInboundRoute,
} from "../src/hosted-email/routes.ts";
import { shouldRejectHostedEmailIngressFailure } from "../src/hosted-email/ingress-policy.ts";
import { sendHostedEmailMessage } from "../src/hosted-email/transport.ts";

import { MemoryEncryptedR2Bucket } from "./test-helpers.js";

const webControlPlane = vi.hoisted(() => ({
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
}));

vi.mock("../src/web-control-plane.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/web-control-plane.ts")>(
    "../src/web-control-plane.ts",
  );

  return {
    ...actual,
    fetchHostedExecutionWebControlPlaneResponse: webControlPlane.fetchHostedExecutionWebControlPlaneResponse,
  };
});

const TEST_CONFIG: HostedEmailConfig = {
  defaultSubject: "Murph update",
  domain: "mail.example.test",
  fromAddress: "assistant@mail.example.test",
  localPart: "assistant",
  signingSecret: "super-secret-signing-key",
};
const TEST_KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
const TEST_KEY_ID = "v1";
const TEST_CALLBACK_SIGNING = {
  keyId: "v1",
  privateKeyJwkJson: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"x\",\"y\":\"y\",\"d\":\"d\"}",
};
const AUTHENTICATED_SENDER = {
  dkimAligned: false,
  dmarcPass: true,
  spfAligned: false,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hosted email routing and transport", () => {
  beforeEach(() => {
    mocks.emitHostedExecutionStructuredLog.mockReset();
  });

  afterEach(() => {
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockReset();
  });

  it("creates one stable reply alias per user and resolves inbound alias mail through it", async () => {
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ userId: "user_123" }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      }));

    const firstAddress = await createHostedEmailUserAddress({
      config: TEST_CONFIG,
      userId: "user_123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    });
    const secondAddress = await createHostedEmailUserAddress({
      config: TEST_CONFIG,
      userId: "user_123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    });

    expect(secondAddress).toBe(firstAddress);
    await expect(resolveHostedEmailInboundRoute({
      config: TEST_CONFIG,
      authenticatedSender: AUTHENTICATED_SENDER,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      to: firstAddress,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).resolves.toMatchObject({
      identityId: TEST_CONFIG.fromAddress,
      routeAddress: firstAddress,
      userId: "user_123",
    });
  });

  it("logs route registration transport failures before surfacing them", async () => {
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockRejectedValue(
      new Error("callback unavailable"),
    );

    await expect(createHostedEmailUserAddress({
      config: TEST_CONFIG,
      userId: "user_123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).rejects.toThrow(/route registration failed/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          operation: "register-reply-alias",
          path: HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
          userId: "user_123",
          webControlOrigin: "https://web.example.test",
        },
        level: "warn",
        message: "Hosted email route registration request failed.",
        phase: "outbox",
        userId: "user_123",
      }),
    );
  });

  it("logs route registration non-OK responses before surfacing them", async () => {
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      "registration rejected",
      {
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
        status: 502,
      },
    ));

    await expect(createHostedEmailUserAddress({
      config: TEST_CONFIG,
      userId: "user_123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).rejects.toThrow(/HTTP 502/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          operation: "register-reply-alias",
          path: HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
          responseStatus: 502,
          userId: "user_123",
          webControlOrigin: "https://web.example.test",
        },
        level: "warn",
        message: "Hosted email route registration response returned non-OK.",
        phase: "outbox",
        userId: "user_123",
      }),
    );
  });

  it("keeps public-sender misses non-routable and avoids reject-on-miss for them", async () => {
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({
        userId: null,
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await expect(resolveHostedEmailIngressRoute({
      config: TEST_CONFIG,
      authenticatedSender: AUTHENTICATED_SENDER,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      to: TEST_CONFIG.fromAddress!,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).resolves.toBeNull();

    expect(shouldRejectHostedEmailIngressFailure({
      config: TEST_CONFIG,
      to: TEST_CONFIG.fromAddress,
    })).toBe(false);
    expect(shouldRejectHostedEmailIngressFailure({
      config: TEST_CONFIG,
      to: "unknown@mail.example.test",
    })).toBe(true);
  });

  it("resolves public-sender ingress through the web-owned sender-authorization callback", async () => {
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({
        userId: "user_123",
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await expect(resolveHostedEmailIngressRoute({
      config: TEST_CONFIG,
      authenticatedSender: AUTHENTICATED_SENDER,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      to: TEST_CONFIG.fromAddress!,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).resolves.toMatchObject({
      authorization: "direct-public-sender",
      identityId: TEST_CONFIG.fromAddress,
      routeAddress: TEST_CONFIG.fromAddress,
      userId: "user_123",
    });
  });

  it("surfaces public-sender callback transport failures instead of treating them as clean misses", async () => {
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockRejectedValue(
      new Error("callback unavailable"),
    );

    await expect(resolveHostedEmailIngressRoute({
      config: TEST_CONFIG,
      authenticatedSender: AUTHENTICATED_SENDER,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      to: TEST_CONFIG.fromAddress!,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).rejects.toThrow(HostedEmailIngressRouteResolutionError);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          hasEnvelopeFrom: true,
          hasHeaderFrom: true,
          operation: "resolve-route-user-id",
          path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
          webControlOrigin: "https://web.example.test",
        },
        level: "warn",
        message: "Hosted email route resolution request failed.",
        phase: "outbox",
        userId: null,
      }),
    );
  });

  it("surfaces public-sender callback config failures instead of treating them as clean misses", async () => {
    await expect(resolveHostedEmailIngressRoute({
      config: TEST_CONFIG,
      authenticatedSender: AUTHENTICATED_SENDER,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      to: TEST_CONFIG.fromAddress!,
    })).rejects.toThrow(/route resolution callback is not configured/u);
  });

  it("surfaces public-sender callback HTTP failures instead of treating them as clean misses", async () => {
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(null, {
      status: 503,
    }));

    await expect(resolveHostedEmailIngressRoute({
      config: TEST_CONFIG,
      authenticatedSender: AUTHENTICATED_SENDER,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      to: TEST_CONFIG.fromAddress!,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).rejects.toThrow(/HTTP 503/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          hasEnvelopeFrom: true,
          hasHeaderFrom: true,
          operation: "resolve-route-user-id",
          path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
          responseStatus: 503,
          webControlOrigin: "https://web.example.test",
        },
        level: "warn",
        message: "Hosted email route resolution response returned non-OK.",
        phase: "outbox",
        userId: null,
      }),
    );
  });

  it("surfaces malformed public-sender callback payloads instead of treating them as clean misses", async () => {
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({}),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await expect(resolveHostedEmailIngressRoute({
      config: TEST_CONFIG,
      authenticatedSender: AUTHENTICATED_SENDER,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      to: TEST_CONFIG.fromAddress!,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).rejects.toThrow(/invalid json|must be present/u);
  });

  it("uses deterministic opaque ids for identical hosted raw-email retries", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const plaintext = new TextEncoder().encode("From: owner@example.com\r\n\r\nhello");

    const firstKey = await writeHostedEmailRawMessage({
      bucket,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      plaintext,
      userId: "user_123",
    });
    const secondKey = await writeHostedEmailRawMessage({
      bucket,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      plaintext,
      userId: "user_123",
    });

    expect(firstKey).toMatch(/^[0-9a-f]{40}$/u);
    expect(secondKey).toBe(firstKey);
    await expect(readHostedEmailRawMessage({
      bucket,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      rawMessageKey: firstKey,
      userId: "user_123",
    })).resolves.toEqual(plaintext);
  });

  it("fails closed when hosted raw-email inputs exceed the configured size bound", async () => {
    await expect(readHostedEmailMessageBytes("abcdef", {
      maxBytes: 5,
    })).rejects.toThrow(/maximum accepted size/u);

    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abc"));
        controller.enqueue(new TextEncoder().encode("def"));
        controller.close();
      },
    });

    await expect(readHostedEmailMessageBytes(oversizedStream, {
      maxBytes: 5,
    })).rejects.toThrow(/maximum accepted size/u);
  });

  it("sends outbound mail with the stable per-user reply alias and returns a thread target", async () => {
    const emailBinding = {
      send: vi.fn(async (_message: unknown) => undefined),
    };
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({ ok: true }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    const response = await sendHostedEmailMessage({
      config: TEST_CONFIG,
      emailBinding,
      request: {
        message: "hello from murph",
        target: "owner@example.com",
        targetKind: "explicit",
      },
      userId: "user_123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    });

    const threadTarget = parseHostedEmailThreadTarget(response.target);
    expect(threadTarget).not.toBeNull();

    expect(emailBinding.send).toHaveBeenCalledTimes(1);
    const sentMessage = emailBinding.send.mock.calls[0]?.[0];
    expect(sentMessage).toBeInstanceOf(EmailMessage);
    expect(sentMessage).toMatchObject({
      from: "assistant@mail.example.test",
      to: "owner@example.com",
    });
    expect((sentMessage as { raw: string }).raw).toContain("Reply-To: ");
    expect((sentMessage as { raw: string }).raw).toMatch(/Reply-To: assistant\+[A-Za-z0-9-]+@mail\.example\.test/u);
  });

  it("rejects thread subject overrides on the hosted email bridge", async () => {
    const threadTarget = serializeHostedEmailThreadTarget(createHostedEmailThreadTarget({
      cc: [],
      lastMessageId: "<thread@example.test>",
      references: ["<thread@example.test>"],
      subject: "Existing subject",
      to: ["owner@example.com"],
    }));

    await expect(sendHostedEmailMessage({
      config: TEST_CONFIG,
      emailBinding: {
        send: vi.fn(async (_message: unknown) => undefined),
      },
      request: {
        message: "hello from murph",
        subject: "Should be rejected",
        target: threadTarget,
        targetKind: "thread",
      },
      userId: "user_123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).rejects.toThrow(/preserves the existing subject/u);
  });

  it("collapses thread-target sends to the primary recipient while preserving reply headers", async () => {
    const emailBinding = {
      send: vi.fn(async (_message: unknown) => undefined),
    };
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({ ok: true }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    const initial = await sendHostedEmailMessage({
      config: TEST_CONFIG,
      emailBinding,
      request: {
        message: "first note",
        target: "owner@example.com",
        targetKind: "explicit",
      },
      userId: "user_123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    });
    const initialThreadTarget = parseHostedEmailThreadTarget(initial.target);
    expect(initialThreadTarget).not.toBeNull();

    const threadedTarget = serializeHostedEmailThreadTarget(createHostedEmailThreadTarget({
      cc: ["carol@example.com"],
      lastMessageId: initialThreadTarget?.lastMessageId ?? "<prev@example.test>",
      references: [initialThreadTarget?.lastMessageId ?? "<prev@example.test>"],
      subject: initialThreadTarget?.subject ?? "Murph update",
      to: ["owner@example.com", "bob@example.com"],
    }));

    const followUp = await sendHostedEmailMessage({
      config: TEST_CONFIG,
      emailBinding,
      request: {
        message: "follow up",
        target: threadedTarget,
        targetKind: "thread",
      },
      userId: "user_123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    });

    expect(emailBinding.send).toHaveBeenCalledTimes(2);
    const followUpMessage = emailBinding.send.mock.calls[1]?.[0] as {
      raw: string;
      to: string;
    };
    expect(followUpMessage.to).toBe("owner@example.com");
    expect(followUpMessage.raw).toMatch(/Reply-To: assistant\+[A-Za-z0-9-]+@mail\.example\.test/u);
    expect(followUpMessage.raw).toContain("In-Reply-To: ");
    expect(followUpMessage.raw).toContain("References: ");
    expect(followUpMessage.raw).not.toContain("Cc:");

    const collapsedThreadTarget = parseHostedEmailThreadTarget(followUp.target);
    expect(collapsedThreadTarget?.to).toEqual(["owner@example.com"]);
    expect(collapsedThreadTarget?.cc).toEqual([]);
  });

  it("uses idempotency keys for stable message ids and explicit email reply parents", async () => {
    const emailBinding = {
      send: vi.fn(async (_message: unknown) => undefined),
    };
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({ ok: true }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));
    const threadedTarget = serializeHostedEmailThreadTarget(createHostedEmailThreadTarget({
      cc: [],
      lastMessageId: "<thread-last@example.test>",
      references: ["<thread-root@example.test>", "<thread-last@example.test>"],
      subject: "Existing subject",
      to: ["owner@example.com"],
    }));

    const first = await sendHostedEmailMessage({
      config: TEST_CONFIG,
      emailBinding,
      request: {
        idempotencyKey: "assistant-outbox:intent_email_123",
        message: "follow up",
        replyToMessageId: "<explicit-parent@example.test>",
        target: threadedTarget,
        targetKind: "thread",
      },
      userId: "user_123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    });
    const second = await sendHostedEmailMessage({
      config: TEST_CONFIG,
      emailBinding,
      request: {
        idempotencyKey: "assistant-outbox:intent_email_123",
        message: "follow up",
        replyToMessageId: "<explicit-parent@example.test>",
        target: threadedTarget,
        targetKind: "thread",
      },
      userId: "user_123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    });

    const firstMessage = emailBinding.send.mock.calls[0]?.[0] as { raw: string };
    const secondMessage = emailBinding.send.mock.calls[1]?.[0] as { raw: string };
    const firstMessageId = firstMessage.raw.match(/^Message-ID: (.+)$/mu)?.[1];
    const secondMessageId = secondMessage.raw.match(/^Message-ID: (.+)$/mu)?.[1];

    expect(firstMessageId).toBeDefined();
    expect(firstMessageId).toBe(secondMessageId);
    expect(parseHostedEmailThreadTarget(first.target)?.lastMessageId).toBe(firstMessageId);
    expect(parseHostedEmailThreadTarget(second.target)?.lastMessageId).toBe(firstMessageId);
    expect(firstMessage.raw).toContain("In-Reply-To: <explicit-parent@example.test>");
    expect(firstMessage.raw).toContain(
      "References: <thread-root@example.test> <thread-last@example.test> <explicit-parent@example.test>",
    );
  });

  it("redacts the primary recipient when the native binding send fails", async () => {
    const primaryRecipient = ["owner", "example.com"].join("@");
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({ ok: true }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await expect(sendHostedEmailMessage({
      config: TEST_CONFIG,
      emailBinding: {
        send: vi.fn(async (_message: unknown) => {
          throw new Error(`binding unavailable for ${primaryRecipient}`);
        }),
      },
      request: {
        message: "hello from murph",
        target: primaryRecipient,
        targetKind: "explicit",
      },
      userId: "user_123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).rejects.toThrow(
      /Hosted email send failed\. binding unavailable for \[redacted-email\]/u,
    );

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          fromAddressPresent: true,
          recipientPresent: true,
        },
        level: "warn",
        message: "Hosted email send failed.",
        phase: "outbox",
        userId: null,
      }),
    );
    expect(JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls)).not.toContain(
      primaryRecipient,
    );
  });

  it("redacts the collapsed primary recipient when a threaded binding send fails", async () => {
    const primaryRecipient = ["owner", "example.com"].join("@");
    const initialThreadTarget = createHostedEmailThreadTarget({
      cc: ["carol@example.com"],
      lastMessageId: "<prev@example.test>",
      references: ["<older@example.test>"],
      subject: "Murph update",
      to: [primaryRecipient, "bob@example.com"],
    });
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({ ok: true }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    await expect(sendHostedEmailMessage({
      config: TEST_CONFIG,
      emailBinding: {
        send: vi.fn(async (_message: unknown) => {
          throw new Error("binding unavailable");
        }),
      },
      request: {
        message: "follow up",
        target: serializeHostedEmailThreadTarget(initialThreadTarget),
        targetKind: "thread",
      },
      userId: "user_123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).rejects.toThrow(/Hosted email send failed\. binding unavailable/u);

    expect(mocks.emitHostedExecutionStructuredLog).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "assistant-delivery",
        details: {
          fromAddressPresent: true,
          recipientPresent: true,
        },
        level: "warn",
        message: "Hosted email send failed.",
        phase: "outbox",
        userId: null,
      }),
    );
    expect(JSON.stringify(mocks.emitHostedExecutionStructuredLog.mock.calls)).not.toContain(
      primaryRecipient,
    );
  });
});
