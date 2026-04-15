import { Buffer } from "node:buffer";

import {
  encodeHostedExecutionSignedRequestPayload,
} from "@murphai/hosted-execution/auth";
import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID,
} from "@murphai/hosted-execution/hosted-email";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberIdByAuthorizedDirectPublicSenderAddress: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/hosted-onboarding/hosted-member-store")>(
    "../src/lib/hosted-onboarding/hosted-member-store",
  );

  return {
    ...actual,
    readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
    readHostedMemberIdByAuthorizedDirectPublicSenderAddress:
      mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress,
  };
});

type AuthorizationRouteModule = typeof import(
  "../app/api/internal/hosted-execution/email/authorization/route"
);
type PublicRouteModule = typeof import(
  "../app/api/internal/hosted-execution/email/public-route/route"
);

type MockPrismaClient = ReturnType<typeof createPrismaMock>;

let authorizationRoute: AuthorizationRouteModule;
let publicRoute: PublicRouteModule;
let currentPrivateJwkJson = "";
let prismaClient: MockPrismaClient;

const originalKeyId = process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID;
const originalPublicJwk = process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK;
const originalPublicKeyring = process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON;

describe("hosted execution email callback routes", () => {
  beforeAll(async () => {
    authorizationRoute = await import(
      "../app/api/internal/hosted-execution/email/authorization/route"
    );
    publicRoute = await import(
      "../app/api/internal/hosted-execution/email/public-route/route"
    );
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaClient = createPrismaMock();
    mocks.getPrisma.mockReturnValue(prismaClient);
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress.mockResolvedValue(null);

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
    restoreEnv("HOSTED_WEB_CALLBACK_SIGNING_KEY_ID", originalKeyId);
    restoreEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK", originalPublicJwk);
    restoreEnv(
      "HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON",
      originalPublicKeyring,
    );
  });

  it("accepts a signed alias-authorization callback for the bound member and returns authorized true", async () => {
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "owner@example.com",
        lookupKey: "lookup_owner",
        verifiedAt: new Date("2026-04-15T12:00:00.000Z"),
      },
    });

    const response = await authorizationRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        envelopeFrom: "owner@example.com",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Owner <owner@example.com>",
      }),
      path: "/api/internal/hosted-execution/email/authorization",
      privateJwkJson: currentPrivateJwkJson,
      userId: "member_123",
    }));

    expect(response.status).toBe(200);
    expect(mocks.readHostedMemberEmailAuthorization).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prismaClient,
    });
    await expect(response.json()).resolves.toEqual({
      authorized: true,
    });
  });

  it("returns authorized false for a signed alias-authorization callback whose sender does not match the canonical verified email", async () => {
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "owner@example.com",
        lookupKey: "lookup_owner",
        verifiedAt: new Date("2026-04-15T12:00:00.000Z"),
      },
    });

    const response = await authorizationRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        envelopeFrom: "attacker@example.com",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Attacker <attacker@example.com>",
      }),
      path: "/api/internal/hosted-execution/email/authorization",
      privateJwkJson: currentPrivateJwkJson,
      userId: "member_123",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authorized: false,
    });
  });

  it("rejects alias-authorization callbacks whose bound member header was changed after signing", async () => {
    const signedRequest = await createSignedCallbackRequest({
      body: JSON.stringify({
        envelopeFrom: "owner@example.com",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Owner <owner@example.com>",
      }),
      path: "/api/internal/hosted-execution/email/authorization",
      privateJwkJson: currentPrivateJwkJson,
      userId: "member_123",
    });
    const tamperedHeaders = new Headers(signedRequest.headers);
    tamperedHeaders.set(HOSTED_EXECUTION_USER_ID_HEADER, "member_999");

    const response = await authorizationRoute.POST(new Request(signedRequest, {
      headers: tamperedHeaders,
    }));

    expect(response.status).toBe(401);
    expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
        message: "Unauthorized hosted Cloudflare callback.",
        retryable: false,
      },
    });
  });

  it("accepts a signed direct-public-sender callback only for the fixed service principal", async () => {
    mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress.mockResolvedValue("member_456");

    const response = await publicRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        envelopeFrom: "owner@example.com",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Owner <owner@example.com>",
      }),
      path: "/api/internal/hosted-execution/email/public-route",
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress).toHaveBeenCalledWith({
      address: "owner@example.com",
      prisma: prismaClient,
    });
    await expect(response.json()).resolves.toEqual({
      userId: "member_456",
    });
  });

  it("rejects direct-public-sender callbacks from any non-service-principal binding", async () => {
    const response = await publicRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        envelopeFrom: "owner@example.com",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Owner <owner@example.com>",
      }),
      path: "/api/internal/hosted-execution/email/public-route",
      privateJwkJson: currentPrivateJwkJson,
      userId: "member_123",
    }));

    expect(response.status).toBe(401);
    expect(mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
        message: "Hosted Cloudflare callback is not authorized.",
        retryable: false,
      },
    });
  });
});

function createPrismaMock() {
  const consumedNonces = new Set<string>();
  const tx = {
    hostedWebInternalRequestNonce: {
      create: vi.fn(async (input: {
        data: {
          method: string;
          nonceHash: string;
          path: string;
          search: string;
          userId: string;
        };
      }) => {
        const key = [
          input.data.userId,
          input.data.method,
          input.data.path,
          input.data.search,
          input.data.nonceHash,
        ].join("|");

        if (consumedNonces.has(key)) {
          throw new Error("Nonce already consumed in test.");
        }

        consumedNonces.add(key);
        return input.data;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  return {
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx)
    ),
  };
}

async function createSignedCallbackRequest(input: {
  body: string;
  path: string;
  privateJwkJson: string;
  userId: string;
}): Promise<Request> {
  const headers = await createHostedCloudflareCallbackHeaders({
    keyId: "v1",
    method: "POST",
    nonce: crypto.randomUUID().replace(/-/gu, ""),
    path: input.path,
    payload: input.body,
    privateKeyJwkJson: input.privateJwkJson,
    search: "",
    timestamp: new Date().toISOString(),
    userId: input.userId,
  });

  return new Request(`https://join.example.test${input.path}`, {
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
    [HOSTED_EXECUTION_SIGNATURE_HEADER]: encodeBase64Url(new Uint8Array(signature)),
    [HOSTED_EXECUTION_TIMESTAMP_HEADER]: input.timestamp,
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
