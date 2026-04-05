import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedExecutionVercelOidcValidationEnvironment,
  readBearerAuthorizationToken,
  readHostedExecutionVercelOidcValidationEnvironment,
  verifyHostedExecutionVercelOidcBearerToken,
  verifyHostedExecutionVercelOidcRequest,
} from "@murphai/hosted-execution";

const TEST_TEAM_SLUG = "murph-team";
const TEST_PROJECT_NAME = "murph-web";
const TEST_VALIDATION = createHostedExecutionVercelOidcValidationEnvironment({
  environment: "production",
  projectName: TEST_PROJECT_NAME,
  teamSlug: TEST_TEAM_SLUG,
});
const TEST_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const TEST_PUBLIC_JWK = {
  ...(createPublicKey(TEST_PRIVATE_KEY).export({ format: "jwk" }) as JsonWebKey),
  alg: "RS256",
  kid: "test-kid",
  use: "sig",
};

describe("vercel oidc helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads bearer authorization tokens", () => {
    expect(readBearerAuthorizationToken("Bearer token-123")).toBe("token-123");
    expect(readBearerAuthorizationToken("  Bearer token-123  ")).toBe("token-123");
    expect(readBearerAuthorizationToken("Basic token-123")).toBeNull();
    expect(readBearerAuthorizationToken(null)).toBeNull();
  });

  it("reads the hosted execution Vercel OIDC validation environment", () => {
    expect(readHostedExecutionVercelOidcValidationEnvironment({
      HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: TEST_PROJECT_NAME,
      HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: TEST_TEAM_SLUG,
    })).toEqual(TEST_VALIDATION);
  });

  it("verifies a valid bearer token against the configured Vercel workload identity", async () => {
    installOidcJwksFetch();

    await expect(
      verifyHostedExecutionVercelOidcBearerToken({
        token: createOidcToken(),
        validation: TEST_VALIDATION,
      }),
    ).resolves.toMatchObject({
      aud: TEST_VALIDATION.audience,
      iss: TEST_VALIDATION.issuer,
      sub: TEST_VALIDATION.subject,
    });
  });

  it("rejects bearer tokens with the wrong subject", async () => {
    installOidcJwksFetch();

    await expect(
      verifyHostedExecutionVercelOidcBearerToken({
        token: createOidcToken({
          sub: `owner:${TEST_TEAM_SLUG}:project:wrong-project:environment:production`,
        }),
        validation: TEST_VALIDATION,
      }),
    ).resolves.toBeNull();
  });

  it("verifies request authorization headers end to end", async () => {
    installOidcJwksFetch();

    await expect(
      verifyHostedExecutionVercelOidcRequest({
        request: new Request("https://worker.example.test/internal/dispatch", {
          headers: {
            authorization: `Bearer ${createOidcToken()}`,
          },
          method: "POST",
        }),
        validation: TEST_VALIDATION,
      }),
    ).resolves.toMatchObject({
      sub: TEST_VALIDATION.subject,
    });
  });
});

function installOidcJwksFetch(): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== TEST_VALIDATION.jwksUrl) {
      throw new Error(`Unexpected fetch during OIDC verification: ${String(input)}`);
    }

    return new Response(JSON.stringify({ keys: [TEST_PUBLIC_JWK] }), {
      headers: {
        "content-type": "application/json",
      },
      status: 200,
    });
  }));
}

function createOidcToken(
  overrides: Partial<{
    aud: string;
    exp: number;
    iat: number;
    iss: string;
    sub: string;
  }> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    kid: "test-kid",
    typ: "JWT",
  };
  const payload = {
    aud: TEST_VALIDATION.audience,
    exp: now + 300,
    iat: now,
    iss: TEST_VALIDATION.issuer,
    sub: TEST_VALIDATION.subject,
    ...overrides,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), TEST_PRIVATE_KEY);

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}
