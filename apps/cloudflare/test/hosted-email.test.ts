import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedEmailThreadTarget,
  parseHostedEmailThreadTarget,
} from "@murphai/runtime-state";

import {
  buildHostedStorageAad,
  deriveHostedStorageOpaqueId,
} from "../src/crypto-context.ts";
import { readEncryptedR2Json, writeEncryptedR2Json } from "../src/crypto.ts";
import type { HostedEmailConfig } from "../src/hosted-email/config.ts";
import {
  createHostedEmailUserAddress,
  reconcileHostedEmailVerifiedSenderRoute,
  resolveHostedEmailIngressRoute,
  resolveHostedEmailInboundRoute,
} from "../src/hosted-email/routes.ts";
import { shouldRejectHostedEmailIngressFailure } from "../src/hosted-email/ingress-policy.ts";
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
const ROTATED_IDENTITY_CONFIG: HostedEmailConfig = {
  ...TEST_CONFIG,
  fromAddress: "murph@mail.example.test",
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
  it("falls back to the signed route header and resolves the current sender identity", async () => {
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
      config: ROTATED_IDENTITY_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      routeHeader: replyAddress,
      to: "unknown@mail.example.test",
    });

    expect(route).toMatchObject({
      identityId: "murph@mail.example.test",
      kind: "user",
      routeAddress: replyAddress,
      target: null,
      userId: "user_123",
    });
  });

  it("does not rewrite the stable user alias route when the same user address is recreated", async () => {
    const bucket = new MemoryBucket();
    const putSpy = vi.spyOn(bucket, "put");

    const firstAddress = await createHostedEmailUserAddress({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      userId: "user_123",
    });
    const objectSnapshot = new Map(bucket.objects);
    const secondAddress = await createHostedEmailUserAddress({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      userId: "user_123",
    });

    expect(firstAddress).toBe(secondAddress);
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(bucket.objects).toEqual(objectSnapshot);
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

  it("stores only a sender hash in new verified-owner index records", async () => {
    const bucket = new MemoryBucket();
    const verifiedEmailAddress = "owner@example.com";

    await reconcileHostedEmailVerifiedSenderRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      nextVerifiedEmailAddress: verifiedEmailAddress,
      previousVerifiedEmailAddress: null,
      userId: "user_123",
    });

    const storedRecord = await readStoredVerifiedSenderRoute({
      bucket,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      secret: TEST_CONFIG.signingSecret!,
      verifiedEmailAddress,
    });

    expect(storedRecord).toMatchObject({
      identityId: TEST_CONFIG.fromAddress,
      schema: "murph.hosted-email-verified-sender-route.v2",
      senderHash: await deriveVerifiedSenderHash(TEST_CONFIG.signingSecret!, verifiedEmailAddress),
      senderKey: await deriveVerifiedSenderKey(TEST_CONFIG.signingSecret!, verifiedEmailAddress),
      userId: "user_123",
    });
    expect(storedRecord).not.toHaveProperty("verifiedEmailAddress");
  });

  it("resolves direct-public routes only when the envelope sender matches the single From header", async () => {
    const bucket = new MemoryBucket();
    const verifiedEmailAddress = "owner@example.com";

    await reconcileHostedEmailVerifiedSenderRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      nextVerifiedEmailAddress: verifiedEmailAddress,
      previousVerifiedEmailAddress: null,
      userId: "user_123",
    });

    await expect(resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: verifiedEmailAddress,
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
    })).resolves.toMatchObject({
      identityId: TEST_CONFIG.fromAddress,
      kind: "user",
      routeAddress: TEST_CONFIG.fromAddress,
      userId: "user_123",
    });

    await expect(resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: verifiedEmailAddress,
      hasRepeatedHeaderFrom: false,
      headerFrom: null,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
    })).resolves.toBeNull();

    await expect(resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: null,
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
    })).resolves.toBeNull();

    await expect(resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: verifiedEmailAddress,
      hasRepeatedHeaderFrom: false,
      headerFrom: "Attacker <attacker@example.com>",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
    })).resolves.toBeNull();
  });

  it("keeps reading legacy verified-owner records during the hash-only cutover", async () => {
    const bucket = new MemoryBucket();
    const verifiedEmailAddress = "owner@example.com";
    const senderKey = await deriveVerifiedSenderKey(TEST_CONFIG.signingSecret!, verifiedEmailAddress);
    const objectKey = await deriveVerifiedSenderRouteObjectKey(TEST_KEY, senderKey);

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        key: objectKey,
        purpose: "email-route",
        routeKind: "verified-sender",
        senderKey,
      }),
      bucket,
      cryptoKey: TEST_KEY,
      key: objectKey,
      keyId: TEST_KEY_ID,
      scope: "email-route",
      value: {
        identityId: TEST_CONFIG.fromAddress,
        schema: "murph.hosted-email-verified-sender-route.v1",
        senderKey,
        updatedAt: "2026-04-03T00:00:00.000Z",
        userId: "legacy-user",
        verifiedEmailAddress,
      },
    });

    await expect(resolveHostedEmailIngressRoute({
      bucket,
      config: TEST_CONFIG,
      envelopeFrom: verifiedEmailAddress,
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: TEST_CONFIG.fromAddress!,
    })).resolves.toMatchObject({
      userId: "legacy-user",
    });
  });

  it("rejects non-public alias misses but sink-accepts public mailbox misses", () => {
    expect(shouldRejectHostedEmailIngressFailure({
      config: TEST_CONFIG,
      to: TEST_CONFIG.fromAddress,
    })).toBe(false);
    expect(shouldRejectHostedEmailIngressFailure({
      config: TEST_CONFIG,
      to: `assistant+u-route@${TEST_CONFIG.domain}`,
    })).toBe(true);
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

  it("does not rewrite the verified-owner route when the verified sender sync is a no-op", async () => {
    const bucket = new MemoryBucket();
    const putSpy = vi.spyOn(bucket, "put");

    await reconcileHostedEmailVerifiedSenderRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      nextVerifiedEmailAddress: "owner@example.com",
      previousVerifiedEmailAddress: null,
      userId: "user_123",
    });
    const objectSnapshot = new Map(bucket.objects);
    await reconcileHostedEmailVerifiedSenderRoute({
      bucket,
      config: TEST_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      nextVerifiedEmailAddress: "owner@example.com",
      previousVerifiedEmailAddress: "owner@example.com",
      userId: "user_123",
    });

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(bucket.objects).toEqual(objectSnapshot);
  });

  it("cleans up the previous verified-owner route when a move is retried after the destination was already written", async () => {
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

  it("keeps resolving legacy per-thread aliases during the transition with the current sender identity", async () => {
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
    const routeSegment = await deriveHostedStorageOpaqueId({
      length: 40,
      rootKey: TEST_KEY,
      scope: "email-route",
      value: `thread:${replyKey}`,
    });
    const objectKey = `transient/hosted-email/threads/${routeSegment}.json`;

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        key: objectKey,
        purpose: "email-route",
        replyKey,
        routeKind: "thread",
      }),
      bucket,
      cryptoKey: TEST_KEY,
      key: objectKey,
      keyId: TEST_KEY_ID,
      scope: "email-route",
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
      config: ROTATED_IDENTITY_CONFIG,
      key: TEST_KEY,
      keyId: TEST_KEY_ID,
      to: legacyAddress,
    });

    expect(route).toMatchObject({
      identityId: "murph@mail.example.test",
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

async function readStoredVerifiedSenderRoute(input: {
  bucket: MemoryBucket;
  key: Uint8Array;
  keyId: string;
  secret: string;
  verifiedEmailAddress: string;
}): Promise<Record<string, unknown>> {
  const senderKey = await deriveVerifiedSenderKey(input.secret, input.verifiedEmailAddress);
  const objectKey = await deriveVerifiedSenderRouteObjectKey(input.key, senderKey);
  const record = await readEncryptedR2Json({
    aad: buildHostedStorageAad({
      key: objectKey,
      purpose: "email-route",
      routeKind: "verified-sender",
      senderKey,
    }),
    bucket: input.bucket,
    cryptoKey: input.key,
    expectedKeyId: input.keyId,
    key: objectKey,
    parse(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Stored verified sender route must be an object.");
      }

      return value as Record<string, unknown>;
    },
    scope: "email-route",
  });

  if (!record) {
    throw new Error("Expected a stored verified sender route.");
  }

  return record;
}

async function deriveVerifiedSenderRouteObjectKey(rootKey: Uint8Array, senderKey: string): Promise<string> {
  const routeSegment = await deriveHostedStorageOpaqueId({
    length: 40,
    rootKey,
    scope: "email-route",
    value: `verified-sender:${senderKey}`,
  });

  return `hosted-email/verified-senders/${routeSegment}.json`;
}

async function deriveVerifiedSenderKey(secret: string, verifiedEmailAddress: string): Promise<string> {
  return (await createRouteHash(`verified-sender:${verifiedEmailAddress}`, secret)).slice(0, 16);
}

async function deriveVerifiedSenderHash(secret: string, verifiedEmailAddress: string): Promise<string> {
  return createRouteHash(`verified-owner:${verifiedEmailAddress}`, secret);
}

async function createRouteHash(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      hash: "SHA-256",
      name: "HMAC",
    },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );

  return [...signature]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
