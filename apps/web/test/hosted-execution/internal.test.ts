import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
  encodeHostedExecutionSignedRequestPayload,
} from "@murphai/hosted-execution";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HostedOnboardingError } from "../../src/lib/hosted-onboarding/errors";
import {
  requireHostedCloudflareCallbackRequest,
} from "../../src/lib/hosted-execution/cloudflare-callback-auth";
import type { HostedCallbackRequestNonceStore } from "../../src/lib/hosted-execution/internal-request-nonces";
import { requireVercelCronRequest } from "../../src/lib/hosted-execution/vercel-cron";

const FIXED_TIMESTAMP = "2026-04-05T00:00:00.000Z";
const FIXED_NOW_MS = Date.parse(FIXED_TIMESTAMP);

class MemoryNonceStore implements HostedCallbackRequestNonceStore {
  readonly entries = new Set<string>();

  async consumeHostedCallbackRequestNonce(input: {
    expiresAt: string;
    method: string;
    nonceHash: string;
    now: string;
    path: string;
    search: string;
    userId: string;
  }): Promise<boolean> {
    void input.expiresAt;
    void input.now;

    const compositeKey = [
      input.userId,
      input.method,
      input.path,
      input.search,
      input.nonceHash,
    ].join("|");

    if (this.entries.has(compositeKey)) {
      return false;
    }

    this.entries.add(compositeKey);
    return true;
  }
}

describe("requireVercelCronRequest", () => {
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret";
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
      return;
    }

    process.env.CRON_SECRET = originalCronSecret;
  });

  it("accepts a matching Vercel cron bearer token", () => {
    expect(() =>
      requireVercelCronRequest(new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron", {
        headers: {
          authorization: "Bearer cron-secret",
        },
      })),
    ).not.toThrow();
  });

  it("rejects an invalid Vercel cron bearer token", () => {
    const invoke = () =>
      requireVercelCronRequest(new Request("https://join.example.test/api/internal/hosted-execution/outbox/cron", {
        headers: {
          authorization: "Bearer wrong-secret",
        },
      }));

    expect(invoke).toThrow();
    try {
      invoke();
    } catch (error) {
      expect(error).toMatchObject({
        code: "VERCEL_CRON_UNAUTHORIZED",
        httpStatus: 401,
      } satisfies Partial<HostedOnboardingError>);
    }
  });
});

describe("requireHostedCloudflareCallbackRequest", () => {
  const originalKeyId = process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID;
  const originalPublicJwk = process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK;
  const originalPublicKeyring = process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON;
  let currentPrivateJwkJson = "";

  beforeEach(async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["sign", "verify"],
    );
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

    process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID = "v1";
    process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK = JSON.stringify(publicJwk);
    process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON = JSON.stringify({
      v1: publicJwk,
    });

    currentPrivateJwkJson = JSON.stringify(privateJwk);
  });

  afterEach(() => {
    if (originalKeyId === undefined) {
      delete process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID;
    } else {
      process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID = originalKeyId;
    }

    if (originalPublicJwk === undefined) {
      delete process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK;
    } else {
      process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK = originalPublicJwk;
    }

    if (originalPublicKeyring === undefined) {
      delete process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON;
    } else {
      process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON = originalPublicKeyring;
    }
  });
  it("accepts a correctly signed Cloudflare callback and rejects its replay", async () => {
    const nonceStore = new MemoryNonceStore();
    const request = await createSignedCallbackRequest({
      body: JSON.stringify({ eventId: "evt_123", shareId: "share_123" }),
      nonce: "0123456789abcdef0123456789abcdef",
      path: "/api/internal/hosted-execution/share-import/complete",
      privateJwkJson: currentPrivateJwkJson,
      search: "?attempt=1",
      userId: "member_123",
    });

    await expect(
      requireHostedCloudflareCallbackRequest(request, {
        nonceStore,
        nowMs: FIXED_NOW_MS,
      }),
    ).resolves.toBe("member_123");

    const replayedRequest = await createSignedCallbackRequest({
      body: JSON.stringify({ eventId: "evt_123", shareId: "share_123" }),
      nonce: "0123456789abcdef0123456789abcdef",
      path: "/api/internal/hosted-execution/share-import/complete",
      privateJwkJson: currentPrivateJwkJson,
      search: "?attempt=1",
      userId: "member_123",
    });

    await expect(
      requireHostedCloudflareCallbackRequest(replayedRequest, {
        nonceStore,
        nowMs: FIXED_NOW_MS,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_CLOUDFLARE_CALLBACK_REPLAYED",
      httpStatus: 401,
    } satisfies Partial<HostedOnboardingError>);
  });

  it("rejects requests whose bound user header was changed after signing", async () => {
    const request = await createSignedCallbackRequest({
      body: "",
      nonce: "abcdef0123456789abcdef0123456789",
      path: "/api/internal/device-sync/providers/whoop/connect-link",
      privateJwkJson: currentPrivateJwkJson,
      userId: "member_123",
    });
    const headers = new Headers(request.headers);
    headers.set(HOSTED_EXECUTION_USER_ID_HEADER, "member_999");

    await expect(
      requireHostedCloudflareCallbackRequest(new Request(request, { headers }), {
        nonceStore: new MemoryNonceStore(),
        nowMs: FIXED_NOW_MS,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      httpStatus: 401,
    } satisfies Partial<HostedOnboardingError>);
  });
});

async function createSignedCallbackRequest(input: {
  body: string;
  nonce: string;
  path: string;
  privateJwkJson: string;
  search?: string;
  userId: string;
}): Promise<Request> {
  const headers = await createHostedCloudflareCallbackHeaders({
    keyId: "v1",
    method: "POST",
    nonce: input.nonce,
    path: input.path,
    payload: input.body,
    privateKeyJwkJson: input.privateJwkJson,
    search: input.search ?? "",
    timestamp: FIXED_TIMESTAMP,
    userId: input.userId,
  });
  const requestUrl = new URL(`https://join.example.test${input.path}`);

  if (input.search) {
    requestUrl.search = input.search;
  }

  return new Request(requestUrl.toString(), {
    body: input.body,
    headers: {
      ...headers,
      "content-type": "application/json; charset=utf-8",
      [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
    },
    method: "POST",
  });
}

async function createHostedCloudflareCallbackHeaders(input: {
  keyId: string;
  method: string;
  nonce: string;
  path: string;
  payload: string;
  privateKeyJwkJson: string;
  search: string;
  timestamp: string;
  userId: string;
}): Promise<Record<string, string>> {
  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(input.privateKeyJwkJson) as JsonWebKey,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256",
    },
    key,
    encodeHostedExecutionSignedRequestPayload({
      method: input.method,
      nonce: input.nonce,
      path: input.path,
      payload: input.payload,
      search: input.search,
      timestamp: input.timestamp,
      userId: input.userId,
    }),
  );

  return {
    [HOSTED_EXECUTION_NONCE_HEADER]: input.nonce,
    [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: input.keyId,
    [HOSTED_EXECUTION_SIGNATURE_HEADER]: Buffer.from(signature)
      .toString("base64")
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_")
      .replace(/=+$/u, ""),
    [HOSTED_EXECUTION_TIMESTAMP_HEADER]: input.timestamp,
  };
}
