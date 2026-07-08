import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVercelOidcToken: vi.fn(),
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: mocks.getVercelOidcToken,
}));

describe("hosted execution web auth adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("memoizes a valid Vercel OIDC token across provider closures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    const token = createTestJwt({ exp: epochSeconds("2026-07-06T12:10:00.000Z") });
    mocks.getVercelOidcToken.mockResolvedValue(` ${token} `);

    const { createHostedExecutionVercelOidcBearerTokenProvider } = await import(
      "@/src/lib/hosted-execution/auth-adapter"
    );
    const getBearerToken = createHostedExecutionVercelOidcBearerTokenProvider();
    const getBearerTokenFromNextClosure = createHostedExecutionVercelOidcBearerTokenProvider();

    await expect(getBearerToken()).resolves.toBe(token);
    await expect(getBearerToken()).resolves.toBe(token);
    await expect(getBearerTokenFromNextClosure()).resolves.toBe(token);
    expect(mocks.getVercelOidcToken).toHaveBeenCalledTimes(1);
  });

  it("refreshes the cached Vercel OIDC token before the expiry safety margin", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    const firstToken = createTestJwt({ exp: epochSeconds("2026-07-06T12:02:00.000Z") });
    const refreshedToken = createTestJwt({ exp: epochSeconds("2026-07-06T12:12:00.000Z") });
    mocks.getVercelOidcToken
      .mockResolvedValueOnce(firstToken)
      .mockResolvedValueOnce(refreshedToken);

    const { createHostedExecutionVercelOidcBearerTokenProvider } = await import(
      "@/src/lib/hosted-execution/auth-adapter"
    );
    const getBearerToken = createHostedExecutionVercelOidcBearerTokenProvider();

    await expect(getBearerToken()).resolves.toBe(firstToken);
    vi.setSystemTime(new Date("2026-07-06T12:01:01.000Z"));
    await expect(getBearerToken()).resolves.toBe(refreshedToken);
    expect(mocks.getVercelOidcToken).toHaveBeenCalledTimes(2);
  });

  it("refreshes an expired cached Vercel OIDC token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    const firstToken = createTestJwt({ exp: epochSeconds("2026-07-06T12:05:00.000Z") });
    const refreshedToken = createTestJwt({ exp: epochSeconds("2026-07-06T12:20:00.000Z") });
    mocks.getVercelOidcToken
      .mockResolvedValueOnce(firstToken)
      .mockResolvedValueOnce(refreshedToken);

    const { createHostedExecutionVercelOidcBearerTokenProvider } = await import(
      "@/src/lib/hosted-execution/auth-adapter"
    );
    const getBearerToken = createHostedExecutionVercelOidcBearerTokenProvider();

    await expect(getBearerToken()).resolves.toBe(firstToken);
    vi.setSystemTime(new Date("2026-07-06T12:05:01.000Z"));
    await expect(getBearerToken()).resolves.toBe(refreshedToken);
    expect(mocks.getVercelOidcToken).toHaveBeenCalledTimes(2);
  });

  it("does not cache a malformed fresh Vercel OIDC token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    const refreshedToken = createTestJwt({ exp: epochSeconds("2026-07-06T12:10:00.000Z") });
    mocks.getVercelOidcToken
      .mockResolvedValueOnce("not-a-jwt")
      .mockResolvedValueOnce(refreshedToken);

    const { createHostedExecutionVercelOidcBearerTokenProvider } = await import(
      "@/src/lib/hosted-execution/auth-adapter"
    );
    const getBearerToken = createHostedExecutionVercelOidcBearerTokenProvider();

    await expect(getBearerToken()).resolves.toBe("not-a-jwt");
    await expect(getBearerToken()).resolves.toBe(refreshedToken);
    expect(mocks.getVercelOidcToken).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Vercel OIDC is unavailable", async () => {
    mocks.getVercelOidcToken.mockResolvedValue("   ");

    const { createHostedExecutionVercelOidcBearerTokenProvider } = await import(
      "@/src/lib/hosted-execution/auth-adapter"
    );

    await expect(createHostedExecutionVercelOidcBearerTokenProvider()()).rejects.toMatchObject({
      code: "HOSTED_EXECUTION_VERCEL_OIDC_TOKEN_REQUIRED",
      httpStatus: 500,
    });
  });
});

function epochSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

function createTestJwt(payload: { exp: number }): string {
  return [
    base64UrlJson({ alg: "RS256", typ: "JWT" }),
    base64UrlJson(payload),
    "signature",
  ].join(".");
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
