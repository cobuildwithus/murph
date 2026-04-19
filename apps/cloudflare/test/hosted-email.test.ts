import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hosted email routing and transport", () => {
  afterEach(() => {
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockReset();
  });

  it("creates one stable reply alias per user and resolves inbound alias mail through it", async () => {
    const bucket = new MemoryEncryptedR2Bucket();

    const firstAddress = await createHostedEmailUserAddress({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      userId: "user_123",
    });
    const secondAddress = await createHostedEmailUserAddress({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      userId: "user_123",
    });

    expect(secondAddress).toBe(firstAddress);
    await expect(resolveHostedEmailInboundRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: firstAddress,
    })).resolves.toMatchObject({
      identityId: TEST_CONFIG.fromAddress,
      routeAddress: firstAddress,
      userId: "user_123",
    });
  });

  it("keeps public-sender misses non-routable and avoids reject-on-miss for them", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
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
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"x\",\"y\":\"y\",\"d\":\"d\"}",
      },
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
    const bucket = new MemoryEncryptedR2Bucket();
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
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"x\",\"y\":\"y\",\"d\":\"d\"}",
      },
      webControlBaseUrl: "https://web.example.test",
    })).resolves.toMatchObject({
      authorization: "direct-public-sender",
      identityId: TEST_CONFIG.fromAddress,
      routeAddress: TEST_CONFIG.fromAddress,
      userId: "user_123",
    });
  });

  it("surfaces public-sender callback transport failures instead of treating them as clean misses", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockRejectedValue(
      new Error("callback unavailable"),
    );

    await expect(resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"x\",\"y\":\"y\",\"d\":\"d\"}",
      },
      webControlBaseUrl: "https://web.example.test",
    })).rejects.toThrow(HostedEmailIngressRouteResolutionError);
  });

  it("surfaces public-sender callback config failures instead of treating them as clean misses", async () => {
    const bucket = new MemoryEncryptedR2Bucket();

    await expect(resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
    })).rejects.toThrow(/authorization callback is not configured/u);
  });

  it("surfaces public-sender callback HTTP failures instead of treating them as clean misses", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(null, {
      status: 503,
    }));

    await expect(resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"x\",\"y\":\"y\",\"d\":\"d\"}",
      },
      webControlBaseUrl: "https://web.example.test",
    })).rejects.toThrow(/HTTP 503/u);
  });

  it("surfaces malformed public-sender callback payloads instead of treating them as clean misses", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
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
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
      webCallbackSigning: {
        keyId: "v1",
        privateKeyJwkJson: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"x\",\"y\":\"y\",\"d\":\"d\"}",
      },
      webControlBaseUrl: "https://web.example.test",
    })).rejects.toThrow(/invalid payload/u);
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
    const bucket = new MemoryEncryptedR2Bucket();
    const emailBinding = {
      send: vi.fn(async (_message: unknown) => undefined),
    };

    const response = await sendHostedEmailMessage({
      bucket,
      config: TEST_CONFIG,
      emailBinding,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      request: {
        identityId: null,
        message: "hello from murph",
        target: "owner@example.com",
        targetKind: "explicit",
      },
      userId: "user_123",
    });

    const threadTarget = parseHostedEmailThreadTarget(response.target);
    expect(threadTarget).not.toBeNull();
    expect(threadTarget?.replyAliasAddress).toMatch(/@mail\.example\.test$/u);

    expect(emailBinding.send).toHaveBeenCalledTimes(1);
    const sentMessage = emailBinding.send.mock.calls[0]?.[0];
    expect(sentMessage).toBeInstanceOf(EmailMessage);
    expect(sentMessage).toMatchObject({
      from: "assistant@mail.example.test",
      to: "owner@example.com",
    });
    expect((sentMessage as { raw: string }).raw).toContain(threadTarget?.replyAliasAddress ?? "");
  });

  it("rejects thread subject overrides on the hosted email bridge", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const threadTarget = serializeHostedEmailThreadTarget(createHostedEmailThreadTarget({
      cc: [],
      lastMessageId: "<thread@example.test>",
      references: ["<thread@example.test>"],
      replyAliasAddress: "reply@mail.example.test",
      subject: "Existing subject",
      to: ["owner@example.com"],
    }));

    await expect(sendHostedEmailMessage({
      bucket,
      config: TEST_CONFIG,
      emailBinding: {
        send: vi.fn(async (_message: unknown) => undefined),
      },
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      request: {
        identityId: null,
        message: "hello from murph",
        subject: "Should be rejected",
        target: threadTarget,
        targetKind: "thread",
      },
      userId: "user_123",
    })).rejects.toThrow(/preserves the existing subject/u);
  });

  it("collapses thread-target sends to the primary recipient while preserving reply headers", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const emailBinding = {
      send: vi.fn(async (_message: unknown) => undefined),
    };

    const initial = await sendHostedEmailMessage({
      bucket,
      config: TEST_CONFIG,
      emailBinding,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      request: {
        identityId: null,
        message: "first note",
        target: "owner@example.com",
        targetKind: "explicit",
      },
      userId: "user_123",
    });
    const initialThreadTarget = parseHostedEmailThreadTarget(initial.target);
    expect(initialThreadTarget).not.toBeNull();

    const threadedTarget = serializeHostedEmailThreadTarget(createHostedEmailThreadTarget({
      cc: ["carol@example.com"],
      lastMessageId: initialThreadTarget?.lastMessageId ?? "<prev@example.test>",
      references: [initialThreadTarget?.lastMessageId ?? "<prev@example.test>"],
      replyAliasAddress: initialThreadTarget?.replyAliasAddress ?? "assistant+reply@mail.example.test",
      subject: initialThreadTarget?.subject ?? "Murph update",
      to: ["owner@example.com", "bob@example.com"],
    }));

    const followUp = await sendHostedEmailMessage({
      bucket,
      config: TEST_CONFIG,
      emailBinding,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      request: {
        identityId: null,
        message: "follow up",
        target: threadedTarget,
        targetKind: "thread",
      },
      userId: "user_123",
    });

    expect(emailBinding.send).toHaveBeenCalledTimes(2);
    const followUpMessage = emailBinding.send.mock.calls[1]?.[0] as {
      raw: string;
      to: string;
    };
    expect(followUpMessage.to).toBe("owner@example.com");
    expect(followUpMessage.raw).toContain(`Reply-To: ${initialThreadTarget?.replyAliasAddress}`);
    expect(followUpMessage.raw).toContain("In-Reply-To: ");
    expect(followUpMessage.raw).toContain("References: ");
    expect(followUpMessage.raw).not.toContain("Cc:");

    const collapsedThreadTarget = parseHostedEmailThreadTarget(followUp.target);
    expect(collapsedThreadTarget?.to).toEqual(["owner@example.com"]);
    expect(collapsedThreadTarget?.cc).toEqual([]);
  });

  it("rejects sender overrides when the caller tries to bypass the configured sender identity", async () => {
    const bucket = new MemoryEncryptedR2Bucket();

    await expect(sendHostedEmailMessage({
      bucket,
      config: TEST_CONFIG,
      emailBinding: {
        send: vi.fn(async (_message: unknown) => undefined),
      },
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      request: {
        identityId: "other-sender@example.com",
        message: "hello from murph",
        target: "owner@example.com",
        targetKind: "explicit",
      },
      userId: "user_123",
    })).rejects.toThrow(/sender identity is config-owned/u);
  });

  it("surfaces the primary recipient when the native binding send fails", async () => {
    const bucket = new MemoryEncryptedR2Bucket();

    await expect(sendHostedEmailMessage({
      bucket,
      config: TEST_CONFIG,
      emailBinding: {
        send: vi.fn(async (_message: unknown) => {
          throw new Error("binding unavailable");
        }),
      },
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      request: {
        identityId: null,
        message: "hello from murph",
        target: "owner@example.com",
        targetKind: "explicit",
      },
      userId: "user_123",
    })).rejects.toThrow(/owner@example\.com: binding unavailable/u);
  });

  it("surfaces the collapsed primary recipient when a threaded binding send fails", async () => {
    const bucket = new MemoryEncryptedR2Bucket();
    const initialThreadTarget = createHostedEmailThreadTarget({
      cc: ["carol@example.com"],
      lastMessageId: "<prev@example.test>",
      references: ["<older@example.test>"],
      replyAliasAddress: "assistant+reply@mail.example.test",
      subject: "Murph update",
      to: ["owner@example.com", "bob@example.com"],
    });

    await expect(sendHostedEmailMessage({
      bucket,
      config: TEST_CONFIG,
      emailBinding: {
        send: vi.fn(async (_message: unknown) => {
          throw new Error("binding unavailable");
        }),
      },
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      request: {
        identityId: null,
        message: "follow up",
        target: serializeHostedEmailThreadTarget(initialThreadTarget),
        targetKind: "thread",
      },
      userId: "user_123",
    })).rejects.toThrow(/owner@example\.com: binding unavailable/u);
  });
});
