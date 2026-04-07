import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVercelOidcToken: vi.fn(),
}));

vi.mock("@vercel/oidc", () => ({
  getVercelOidcToken: mocks.getVercelOidcToken,
}));

describe("hosted execution web auth adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("memoizes the Vercel OIDC token lookup", async () => {
    mocks.getVercelOidcToken.mockResolvedValue(" token-123 ");

    const { createHostedExecutionVercelOidcBearerTokenProvider } = await import(
      "@/src/lib/hosted-execution/auth-adapter"
    );
    const getBearerToken = createHostedExecutionVercelOidcBearerTokenProvider();

    await expect(getBearerToken()).resolves.toBe("token-123");
    await expect(getBearerToken()).resolves.toBe("token-123");
    expect(mocks.getVercelOidcToken).toHaveBeenCalledTimes(1);
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
