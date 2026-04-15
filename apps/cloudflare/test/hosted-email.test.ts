import { afterEach, describe, expect, it, vi } from "vitest";

import { parseHostedEmailThreadTarget } from "@murphai/runtime-state";

import type { HostedEmailConfig } from "../src/hosted-email/config.ts";
import {
  readHostedEmailMessageBytes,
  readHostedEmailRawMessage,
  writeHostedEmailRawMessage,
} from "../src/hosted-email.ts";
import {
  createHostedEmailUserAddress,
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
  apiBaseUrl: "https://api.cloudflare.com/client/v4",
  cloudflareAccountId: "acct_123",
  cloudflareApiToken: "token_123",
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

    await expect(resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      result: {
        delivered: ["owner@example.com"],
      },
      success: true,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await sendHostedEmailMessage({
      bucket,
      config: TEST_CONFIG,
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acct_123/email/sending/send_raw",
      expect.objectContaining({
        body: expect.stringContaining(threadTarget?.replyAliasAddress ?? ""),
        method: "POST",
      }),
    );
  });
});
