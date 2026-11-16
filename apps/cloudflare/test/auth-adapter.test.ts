import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedExecutionVercelOidcValidationEnvironment,
  readBearerAuthorizationToken,
  readHostedExecutionVercelOidcValidationEnvironment,
  verifyHostedExecutionVercelOidcBearerToken,
  verifyHostedExecutionVercelOidcRequest,
} from "../src/auth-adapter.js";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { authorizeRoute } from "../src/worker/auth.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

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

describe("cloudflare hosted execution auth adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads bearer authorization tokens", () => {
    expect(readBearerAuthorizationToken("Bearer token-123")).toBe("token-123");
    expect(readBearerAuthorizationToken("  Bearer token-123  ")).toBe("token-123");
    expect(readBearerAuthorizationToken("Basic token-123")).toBeNull();
    expect(readBearerAuthorizationToken(null)).toBeNull();
  });

  it("reads the Vercel OIDC validation environment from worker env vars", () => {
    expect(readHostedExecutionVercelOidcValidationEnvironment({
      HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: TEST_PROJECT_NAME,
      HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: TEST_TEAM_SLUG,
    })).toEqual(TEST_VALIDATION);
  });

  it("accepts a development-only JWKS URL override for local verification", () => {
    expect(readHostedExecutionVercelOidcValidationEnvironment({
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
      HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
      HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: TEST_PROJECT_NAME,
      HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: TEST_TEAM_SLUG,
    })).toEqual({
      ...createHostedExecutionVercelOidcValidationEnvironment({
        environment: "development",
        projectName: TEST_PROJECT_NAME,
        teamSlug: TEST_TEAM_SLUG,
      }),
      jwksUrl: "http://127.0.0.1:4010/.well-known/jwks",
    });
  });

  it("accepts a bracketed IPv6 loopback JWKS URL override in development", () => {
    expect(readHostedExecutionVercelOidcValidationEnvironment({
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
      HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://[::1]:4010/.well-known/jwks",
      HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: TEST_PROJECT_NAME,
      HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: TEST_TEAM_SLUG,
    })).toEqual({
      ...createHostedExecutionVercelOidcValidationEnvironment({
        environment: "development",
        projectName: TEST_PROJECT_NAME,
        teamSlug: TEST_TEAM_SLUG,
      }),
      jwksUrl: "http://[::1]:4010/.well-known/jwks",
    });
  });

  it("rejects JWKS URL overrides outside development", () => {
    expect(() =>
      readHostedExecutionVercelOidcValidationEnvironment({
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "production",
        HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
        HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: TEST_PROJECT_NAME,
        HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: TEST_TEAM_SLUG,
      })
    ).toThrow("HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL is only supported");
  });

  it("rejects non-local development JWKS URL overrides", () => {
    expect(() =>
      readHostedExecutionVercelOidcValidationEnvironment({
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
        HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "https://example.com/.well-known/jwks",
        HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: TEST_PROJECT_NAME,
        HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: TEST_TEAM_SLUG,
      })
    ).toThrow("HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL must use a local loopback or bridge hostname");
  });

  it("verifies a valid bearer token against the configured Vercel workload identity", async () => {
    installOidcJwksFetch();

    await expect(
      verifyHostedExecutionVercelOidcBearerToken({
        token: createOidcToken(),
        validation: TEST_VALIDATION,
      }),
    ).resolves.toMatchObject({
      claims: {
        aud: TEST_VALIDATION.audience,
        iss: TEST_VALIDATION.issuer,
        sub: TEST_VALIDATION.subject,
      },
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
    ).resolves.toMatchObject({ failure: "ERR_JWT_CLAIM_VALIDATION_FAILED:sub" });
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
      claims: { sub: TEST_VALIDATION.subject },
    });
  });

  it.each([
    ["ERR_JWT_EXPIRED:exp", { exp: 1 }],
    ["ERR_JWT_CLAIM_VALIDATION_FAILED:nbf", { nbf: 9_999_999_999 }],
    ["ERR_JWT_CLAIM_VALIDATION_FAILED:iss", { iss: "https://wrong-issuer.example.test" }],
    ["ERR_JWT_CLAIM_VALIDATION_FAILED:aud", { aud: "wrong-audience" }],
  ])("reports %s with the signed token's age", async (failure, overrides) => {
    installOidcJwksFetch();
    const issuedAt = Math.floor(Date.now() / 1000) - 600;
    const result = await verifyHostedExecutionVercelOidcBearerToken({
      token: createOidcToken({ iat: issuedAt, ...overrides }),
      validation: TEST_VALIDATION,
    });

    expect(result).toEqual({ failure, issuedSecondsAgo: expect.any(Number) });
    expect("issuedSecondsAgo" in result && result.issuedSecondsAgo).toBeGreaterThanOrEqual(600);
  });

  it.each([
    ["missing_token", ""],
    ["ERR_JWS_INVALID", "not-a-jwt"],
  ])("reports %s for an unusable token", async (failure, token) => {
    await expect(verifyHostedExecutionVercelOidcBearerToken({ token, validation: TEST_VALIDATION }))
      .resolves.toEqual({ failure });
  });

  it("reports a bad signature without reading its claims", async () => {
    installOidcJwksFetch();
    const token = createOidcToken({ exp: 1 }).split(".");
    token[2] = Buffer.alloc(256).toString("base64url");

    await expect(verifyHostedExecutionVercelOidcBearerToken({
      token: token.join("."),
      validation: TEST_VALIDATION,
    })).resolves.toEqual({ failure: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED" });
  });

  it.each([
    ["TypeError", () => { throw new TypeError("private network detail"); }],
    ["ERR_JOSE_GENERIC", () => new Response("private upstream detail", { status: 503 })],
    ["ERR_JWKS_NO_MATCHING_KEY", () => Response.json({ keys: [] })],
  ] as const)("reports key-set failure %s without its message", async (failure, respond) => {
    vi.stubGlobal("fetch", vi.fn(async () => respond()));

    await expect(verifyHostedExecutionVercelOidcBearerToken({
      token: createOidcToken(),
      validation: { ...TEST_VALIDATION, jwksUrl: `https://jwks.example.test/${failure}` },
    })).resolves.toEqual({ failure });
  });

  it("logs why the worker rejected an internal hand-off, without the token", async () => {
    installOidcJwksFetch();
    vi.stubEnv("MURPH_HOSTED_EXECUTION_STDIO_LOGS", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = Math.floor(Date.now() / 1000);
    const token = createOidcToken({ exp: now - 120, iat: now - 3_720 });

    const response = await authorizeRoute("vercel-oidc", {
      environment: {
        ...readHostedExecutionEnvironment(createHostedExecutionTestEnv()),
        vercelOidcValidation: TEST_VALIDATION,
      },
      request: new Request("https://worker.example.test/internal/device-webhooks/enqueue", {
        headers: { authorization: `Bearer ${token}` },
        method: "POST",
      }),
    }, "device-webhook-enqueue");

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(warn).toHaveBeenCalledOnce();
    const log = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(log.details).toMatchObject({
      reason: "vercel-oidc-verification-failed",
      routeName: "device-webhook-enqueue",
      verificationFailure: "ERR_JWT_EXPIRED:exp",
    });
    expect(Number(log.details.issuedSecondsAgo)).toBeGreaterThanOrEqual(3_720);
    expect(JSON.stringify(log)).not.toContain(token);
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
    nbf: number;
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
