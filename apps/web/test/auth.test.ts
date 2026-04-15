import { DeviceSyncError } from "@murphai/device-syncd/public-ingress";
import { describe, expect, it } from "vitest";

import {
  assertBrowserMutationOrigin,
  createHostedUserAssertionSignature,
  encodeHostedUserAssertion,
  requireAuthenticatedHostedUser,
  type HostedBrowserAssertionNonceStore,
  type HostedUserAssertionClaims,
} from "@/src/lib/device-sync/auth";
import type { HostedDeviceSyncEnvironment } from "@/src/lib/device-sync/env";

const NOW = new Date("2026-03-25T12:00:00.000Z");

const BASE_ENVIRONMENT: HostedDeviceSyncEnvironment = {
  allowedMutationOrigins: [],
  allowedReturnOrigins: [],
  encryptionKey: Buffer.alloc(32, 0),
  encryptionKeysByVersion: { v1: Buffer.alloc(32, 0) },
  encryptionKeyVersion: "v1",
  isProduction: false,
  ouraWebhookVerificationToken: null,
  publicBaseUrl: "https://control.example.test/api/device-sync",
  trustedUserAssertionHeader: "x-hosted-user-assertion",
  trustedUserSignatureHeader: "x-hosted-user-signature",
  trustedUserSigningSecret: "test-signing-secret",
  devUserEmail: "dev@example.com",
  devUserId: "dev-user",
  devUserName: "Dev User",
  providers: {
    garmin: null,
    whoop: null,
    oura: null,
  },
};

describe("requireAuthenticatedHostedUser", () => {
  it("accepts a fresh signed hosted user assertion and consumes its nonce", async () => {
    const nonceStore = createNonceStore();
    const request = createSignedRequest({
      url: "https://control.example.test/api/device-sync/agents/pair",
      method: "POST",
      origin: "https://operator.example.test",
      nonce: "nonce-accepted-123456",
    });

    await expect(
      requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT, {
        nonceStore,
        now: NOW,
      }),
    ).resolves.toEqual({
      id: "user-123",
      email: "person@example.com",
      name: "Person",
      source: "trusted-header",
    });
  });

  it("rejects forged hosted user assertions instead of falling back to the development user", async () => {
    const claims = createClaims({
      url: "https://control.example.test/api/device-sync/agents/pair",
      method: "POST",
      origin: "https://operator.example.test",
      nonce: "nonce-forged-123456",
    });
    const signedAssertion = encodeHostedUserAssertion(claims);
    const forgedAssertion = encodeHostedUserAssertion({
      ...claims,
      email: "attacker@example.com",
    });
    const request = createRequestWithAssertion({
      url: "https://control.example.test/api/device-sync/agents/pair",
      method: "POST",
      origin: "https://operator.example.test",
      assertion: forgedAssertion,
      signature: createHostedUserAssertionSignature(
        signedAssertion,
        BASE_ENVIRONMENT.trustedUserSigningSecret ?? "",
      ),
    });

    await expectDeviceSyncError(
      () =>
        requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT, {
          nonceStore: createNonceStore(),
          now: NOW,
        }),
      "AUTH_HEADER_INVALID",
      401,
    );
  });

  it("rejects expired hosted user assertions", async () => {
    const request = createSignedRequest({
      url: "https://control.example.test/api/device-sync/agents/pair",
      method: "POST",
      origin: "https://operator.example.test",
      nonce: "nonce-expired-123456",
      iat: toEpochSeconds("2026-03-25T11:40:00.000Z"),
      exp: toEpochSeconds("2026-03-25T11:45:00.000Z"),
    });

    await expectDeviceSyncError(
      () =>
        requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT, {
          nonceStore: createNonceStore(),
          now: NOW,
        }),
      "AUTH_ASSERTION_STALE",
      401,
    );
  });

  it("rejects assertions whose signed path does not match the request path", async () => {
    const request = createSignedRequest({
      url: "https://control.example.test/api/device-sync/agents/pair",
      method: "POST",
      origin: "https://operator.example.test",
      path: "/api/device-sync/agents",
      nonce: "nonce-path-123456",
    });

    await expectDeviceSyncError(
      () =>
        requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT, {
          nonceStore: createNonceStore(),
          now: NOW,
        }),
      "AUTH_HEADER_INVALID",
      401,
    );
  });

  it("rejects replayed assertions even when the user tuple is unchanged", async () => {
    const nonceStore = createNonceStore();
    const request = createSignedRequest({
      url: "https://control.example.test/api/device-sync/agents/pair",
      method: "POST",
      origin: "https://operator.example.test",
      nonce: "nonce-replay-123456",
    });

    await expect(
      requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT, {
        nonceStore,
        now: NOW,
      }),
    ).resolves.toMatchObject({
      id: "user-123",
    });

    await expectDeviceSyncError(
      () =>
        requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT, {
          nonceStore,
          now: NOW,
        }),
      "AUTH_ASSERTION_REPLAYED",
      401,
    );
  });

  it("falls back to the development user when trusted headers are absent", async () => {
    const request = new Request("https://example.test/device-sync");

    await expect(
      requireAuthenticatedHostedUser(request, BASE_ENVIRONMENT, {
        nonceStore: createNonceStore(),
        now: NOW,
      }),
    ).resolves.toEqual({
      id: "dev-user",
      email: "dev@example.com",
      name: "Dev User",
      source: "development-fallback",
    });
  });
});

describe("assertBrowserMutationOrigin", () => {
  it("fails closed when a browser mutation request omits the Origin header", async () => {
    await expectDeviceSyncError(
      async () =>
        assertBrowserMutationOrigin(
          new Request("https://control.example.test/api/device-sync/agents/pair", {
            method: "POST",
          }),
          BASE_ENVIRONMENT,
        ),
      "CSRF_ORIGIN_REQUIRED",
      403,
    );
  });

  it("rejects cross-origin POST attempts even when the origin is only allowed as a redirect return origin", async () => {
    await expectDeviceSyncError(
      async () =>
        assertBrowserMutationOrigin(
          new Request("https://control.example.test/api/device-sync/agents/pair", {
            method: "POST",
            headers: {
              origin: "https://return.example.test",
            },
          }),
          {
            ...BASE_ENVIRONMENT,
            allowedReturnOrigins: ["https://return.example.test"],
          },
        ),
      "CSRF_ORIGIN_INVALID",
      403,
    );
  });

  it("allows configured cross-origin POST requests only from the mutation-origin allowlist", () => {
    expect(() =>
      assertBrowserMutationOrigin(
        new Request("https://control.example.test/api/device-sync/agents/pair", {
          method: "POST",
          headers: {
            origin: "https://operator.example.test",
          },
        }),
        {
          ...BASE_ENVIRONMENT,
          allowedMutationOrigins: ["https://operator.example.test"],
          allowedReturnOrigins: ["https://return.example.test"],
        },
      ),
    ).not.toThrow();
  });

  it("rejects request-host origins when a canonical public origin is configured", async () => {
    await expectDeviceSyncError(
      async () =>
        assertBrowserMutationOrigin(
          new Request("https://preview.example.test/api/device-sync/agents/pair", {
            method: "POST",
            headers: {
              origin: "https://preview.example.test",
            },
          }),
          BASE_ENVIRONMENT,
        ),
      "CSRF_ORIGIN_INVALID",
      403,
    );
  });
});

function createSignedRequest(input: {
  url: string;
  method?: string;
  origin?: string | null;
  path?: string;
  nonce: string;
  iat?: number;
  exp?: number;
  aud?: string;
}) {
  const claims = createClaims(input);
  const assertion = encodeHostedUserAssertion(claims);

  return createRequestWithAssertion({
    url: input.url,
    method: input.method,
    origin: input.origin,
    assertion,
    signature: createHostedUserAssertionSignature(assertion, BASE_ENVIRONMENT.trustedUserSigningSecret ?? ""),
  });
}

function createClaims(input: {
  url: string;
  method?: string;
  origin?: string | null;
  path?: string;
  nonce: string;
  iat?: number;
  exp?: number;
  aud?: string;
}): HostedUserAssertionClaims {
  const url = new URL(input.url);
  const method = (input.method ?? "GET").toUpperCase();
  const iat = input.iat ?? toEpochSeconds("2026-03-25T11:58:00.000Z");
  const exp = input.exp ?? toEpochSeconds("2026-03-25T12:03:00.000Z");

  return {
    id: "user-123",
    email: "person@example.com",
    name: "Person",
    aud: input.aud ?? url.origin,
    method,
    path: input.path ?? url.pathname,
    origin: input.origin ?? null,
    nonce: input.nonce,
    iat,
    exp,
  };
}

function createRequestWithAssertion(input: {
  url: string;
  method?: string;
  origin?: string | null;
  assertion: string;
  signature: string;
}) {
  return new Request(input.url, {
    method: input.method ?? "GET",
    headers: {
      ...(input.origin
        ? {
            origin: input.origin,
          }
        : {}),
      "x-hosted-user-assertion": input.assertion,
      "x-hosted-user-signature": input.signature,
    },
  });
}

function createNonceStore(): HostedBrowserAssertionNonceStore {
  const consumed = new Set<string>();

  return {
    async consumeBrowserAssertionNonce({ nonceHash }) {
      if (consumed.has(nonceHash)) {
        return false;
      }

      consumed.add(nonceHash);
      return true;
    },
  };
}

function toEpochSeconds(value: string): number {
  return Math.floor(Date.parse(value) / 1000);
}

async function expectDeviceSyncError(
  action: () => Promise<unknown>,
  expectedCode: string,
  expectedStatus: number,
) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(DeviceSyncError);
    expect(error).toMatchObject({
      code: expectedCode,
      httpStatus: expectedStatus,
    });
    return;
  }

  throw new Error(`Expected DeviceSyncError ${expectedCode}.`);
}
