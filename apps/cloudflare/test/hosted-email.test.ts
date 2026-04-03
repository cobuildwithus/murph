import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedEmailThreadTarget,
  parseHostedEmailThreadTarget,
} from "@murphai/runtime-state";

import { writeEncryptedR2Json } from "../src/crypto.ts";
import type { HostedEmailConfig } from "../src/hosted-email/config.ts";
import {
  createHostedEmailUserAddress,
  reconcileHostedEmailVerifiedSenderRoute,
  resolveHostedEmailIngressRoute,
  resolveHostedEmailInboundRoute,
} from "../src/hosted-email/routes.ts";
import { sendHostedEmailMessage } from "../src/hosted-email/transport.ts";

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

class MemoryBucket {
  readonly objects = new Map<string, string>();

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const value = this.objects.get(key);
    if (value === undefined) {
      return null;
    }

    return {
      async arrayBuffer() {
        return new TextEncoder().encode(value).buffer;
      },
    };
  }

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hosted email routing and transport", () => {
  it("falls back to the signed route header and returns the matched self address", async () => {
    const bucket = new MemoryBucket();
    const replyAddress = await createHostedEmailUserAddress({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      userId: "user_123",
    });

    const route = await resolveHostedEmailInboundRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      routeHeader: replyAddress,
      to: "unknown@mail.example.test",
    });

    expect(route).toMatchObject({
      identityId: "assistant@mail.example.test",
      kind: "user",
      routeAddress: replyAddress,
      target: null,
      userId: "user_123",
    });
  });

  it("routes direct mail to the fixed public sender through the synced verified owner index", async () => {
    const bucket = new MemoryBucket();
    await reconcileHostedEmailVerifiedSenderRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      nextVerifiedEmailAddress: "owner@example.com",
      previousVerifiedEmailAddress: null,
      userId: "user_123",
    });

    const route = await resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: "Owner <owner@example.com>",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
    });

    expect(route).toMatchObject({
      identityId: TEST_CONFIG.fromAddress,
      kind: "user",
      routeAddress: TEST_CONFIG.fromAddress,
      target: null,
      userId: "user_123",
    });
  });

  it("ignores X-Murph-Route overrides when mail is addressed to the fixed public sender", async () => {
    const bucket = new MemoryBucket();
    await reconcileHostedEmailVerifiedSenderRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      nextVerifiedEmailAddress: "owner@example.com",
      previousVerifiedEmailAddress: null,
      userId: "user_123",
    });
    const unrelatedAlias = await createHostedEmailUserAddress({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      userId: "user_456",
    });

    const route = await resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "owner@example.com",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      routeHeader: unrelatedAlias,
      to: TEST_CONFIG.fromAddress!,
    });

    expect(route).toMatchObject({
      routeAddress: TEST_CONFIG.fromAddress,
      userId: "user_123",
    });
  });

  it("moves the public sender route when the verified owner address changes and rejects conflicts", async () => {
    const bucket = new MemoryBucket();
    await reconcileHostedEmailVerifiedSenderRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      nextVerifiedEmailAddress: "old-owner@example.com",
      previousVerifiedEmailAddress: null,
      userId: "user_123",
    });
    await reconcileHostedEmailVerifiedSenderRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      nextVerifiedEmailAddress: "new-owner@example.com",
      previousVerifiedEmailAddress: "old-owner@example.com",
      userId: "user_123",
    });

    await expect(resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: "old-owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "old-owner@example.com",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
    })).resolves.toBeNull();
    await expect(resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: "new-owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "new-owner@example.com",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
    })).resolves.toMatchObject({
      userId: "user_123",
    });

    await expect(reconcileHostedEmailVerifiedSenderRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      nextVerifiedEmailAddress: "new-owner@example.com",
      previousVerifiedEmailAddress: null,
      userId: "user_456",
    })).rejects.toThrow("Hosted verified email sender route is already assigned to a different user.");
  });

  it("keeps the previous public sender route when a move conflicts", async () => {
    const bucket = new MemoryBucket();
    await reconcileHostedEmailVerifiedSenderRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      nextVerifiedEmailAddress: "old-owner@example.com",
      previousVerifiedEmailAddress: null,
      userId: "user_123",
    });
    await reconcileHostedEmailVerifiedSenderRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      nextVerifiedEmailAddress: "new-owner@example.com",
      previousVerifiedEmailAddress: null,
      userId: "user_456",
    });

    await expect(reconcileHostedEmailVerifiedSenderRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      nextVerifiedEmailAddress: "new-owner@example.com",
      previousVerifiedEmailAddress: "old-owner@example.com",
      userId: "user_123",
    })).rejects.toThrow("Hosted verified email sender route is already assigned to a different user.");

    await expect(resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: "old-owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "old-owner@example.com",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
    })).resolves.toMatchObject({
      userId: "user_123",
    });
  });

  it("keeps resolving legacy per-thread aliases during the transition", async () => {
    const bucket = new MemoryBucket();
    const threadTarget = createHostedEmailThreadTarget({
      cc: ["teammate@example.com"],
      lastMessageId: "<message-1@example.test>",
      references: ["<message-0@example.test>"],
      replyAliasAddress: "assistant+legacy@mail.example.test",
      replyKey: "legacyreplykey123",
      subject: "Status update",
      to: ["owner@example.com"],
    });
    const replyKey = "legacyreplykey123";

    await writeEncryptedR2Json({
      bucket,
      cryptoKey: TEST_KEY,
      key: `transient/hosted-email/threads/${replyKey}.json`,
      keyId: TEST_KEY_ID,
      value: {
        identityId: TEST_CONFIG.fromAddress,
        replyKey,
        schema: "murph.hosted-email-thread-route.v1",
        target: threadTarget,
        updatedAt: "2026-04-03T00:00:00.000Z",
        userId: "user_123",
      },
    });

    const legacyAddress = `${TEST_CONFIG.localPart}+${await createRouteToken({
      key: replyKey,
      scope: "thread",
      secret: TEST_CONFIG.signingSecret,
    })}@${TEST_CONFIG.domain}`;
    const route = await resolveHostedEmailInboundRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: legacyAddress,
    });

    expect(route).toMatchObject({
      identityId: "assistant@mail.example.test",
      kind: "thread",
      routeAddress: legacyAddress,
      userId: "user_123",
    });
    expect(route?.target).toEqual(threadTarget);
  });

  it("sends with one stable per-user reply alias and does not persist new thread routes", async () => {
    const bucket = new MemoryBucket();
    const stableReplyAddress = await createHostedEmailUserAddress({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      userId: "user_123",
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        from: string;
        mime_message: string;
        recipients: string[];
      };

      expect(body.from).toBe(TEST_CONFIG.fromAddress);
      expect(body.mime_message).toContain(`Reply-To: ${stableReplyAddress}`);
      expect(body.mime_message).toContain(`X-Murph-Route: ${stableReplyAddress}`);
      expect(body.recipients).toEqual(["owner@example.com"]);

      return new Response(JSON.stringify({ success: true }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstSend = await sendHostedEmailMessage({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      request: {
        identityId: TEST_CONFIG.fromAddress,
        message: "First reply",
        target: "owner@example.com",
        targetKind: "explicit",
      },
      userId: "user_123",
    });
    const secondSend = await sendHostedEmailMessage({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      request: {
        identityId: TEST_CONFIG.fromAddress,
        message: "Follow-up reply",
        target: firstSend.target,
        targetKind: "thread",
      },
      userId: "user_123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstTarget = parseHostedEmailThreadTarget(firstSend.target);
    const secondTarget = parseHostedEmailThreadTarget(secondSend.target);
    expect(firstTarget).not.toBeNull();
    expect(secondTarget).not.toBeNull();
    expect(firstTarget?.replyAliasAddress).toBe(stableReplyAddress);
    expect(firstTarget?.replyKey).toBeNull();
    expect(secondTarget?.replyAliasAddress).toBe(stableReplyAddress);
    expect(secondTarget?.replyKey).toBeNull();
    expect([...bucket.objects.keys()].every((key) => !key.startsWith("transient/hosted-email/threads/")))
      .toBe(true);
  });
});

async function createRouteToken(input: {
  key: string;
  scope: "thread" | "user";
  secret: string;
}): Promise<string> {
  const scopeCode = input.scope === "thread" ? "t" : "u";
  const signature = await createRouteSignature({
    payload: `${scopeCode}:${input.key}`,
    secret: input.secret,
  });
  return `${scopeCode}-${input.key}-${signature}`;
}

async function createRouteSignature(input: {
  payload: string;
  secret: string;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.secret),
    {
      hash: "SHA-256",
      name: "HMAC",
    },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input.payload)),
  );

  return [...signature.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
