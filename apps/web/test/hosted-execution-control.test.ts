import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCloudflareHostedControlClient: vi.fn(),
  createHostedExecutionVercelOidcBearerTokenProvider: vi.fn(),
  readHostedExecutionControlBaseUrl: vi.fn(),
  tokenProvider: vi.fn(),
}));

vi.mock("@murphai/cloudflare-hosted-control/client", () => ({
  createCloudflareHostedControlClient: mocks.createCloudflareHostedControlClient,
}));

vi.mock("@/src/lib/hosted-execution/environment", () => ({
  readHostedExecutionControlBaseUrl: mocks.readHostedExecutionControlBaseUrl,
}));

vi.mock("@/src/lib/hosted-execution/auth-adapter", () => ({
  createHostedExecutionVercelOidcBearerTokenProvider:
    mocks.createHostedExecutionVercelOidcBearerTokenProvider,
}));

describe("hosted verified email sync helper", () => {
  const getUserEnvStatus = vi.fn();
  const updateUserEnv = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.readHostedExecutionControlBaseUrl.mockReturnValue("https://dispatch.example.test");
    mocks.createHostedExecutionVercelOidcBearerTokenProvider.mockReturnValue(mocks.tokenProvider);
    mocks.createCloudflareHostedControlClient.mockReturnValue({
      getUserEnvStatus,
      updateUserEnv,
    });
    getUserEnvStatus.mockResolvedValue({
      configuredUserEnvKeys: [],
      userId: "member_123",
    });
    updateUserEnv.mockResolvedValue({});
  });

  it("stores the verified email in hosted user env without relying on a blind hosted run", async () => {
    const { syncHostedVerifiedEmailToHostedExecution } = await import(
      "@/src/lib/hosted-execution/control"
    );

    await expect(
      syncHostedVerifiedEmailToHostedExecution({
        emailAddress: "user@example.com",
        userId: "member_123",
        verifiedAt: "2026-03-27T08:30:00.000Z",
      }),
    ).resolves.toEqual({
      emailAddress: "user@example.com",
      verifiedAt: "2026-03-27T08:30:00.000Z",
    });
    expect(mocks.createCloudflareHostedControlClient).toHaveBeenCalledWith({
      baseUrl: "https://dispatch.example.test",
      getBearerToken: mocks.tokenProvider,
    });
    expect(updateUserEnv).toHaveBeenCalledWith("member_123", {
      env: {
        HOSTED_USER_VERIFIED_EMAIL: "user@example.com",
        HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT: "2026-03-27T08:30:00.000Z",
      },
      mode: "merge",
    });
    expect(updateUserEnv).toHaveBeenCalledTimes(1);
  });

  it("reads whether the hosted verified email env is already configured", async () => {
    getUserEnvStatus.mockResolvedValue({
      configuredUserEnvKeys: [
        "HOSTED_USER_VERIFIED_EMAIL",
        "HOSTED_USER_VERIFIED_EMAIL_VERIFIED_AT",
      ],
      userId: "member_123",
    });

    const { hasHostedVerifiedEmailUserEnv } = await import(
      "@/src/lib/hosted-execution/control"
    );

    await expect(hasHostedVerifiedEmailUserEnv("member_123")).resolves.toBe(true);
    expect(getUserEnvStatus).toHaveBeenCalledWith("member_123");
  });

  it("treats hosted verified email env lookups as best effort", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    getUserEnvStatus.mockRejectedValue(new Error("worker unavailable"));

    const { hasHostedVerifiedEmailUserEnv } = await import(
      "@/src/lib/hosted-execution/control"
    );

    await expect(hasHostedVerifiedEmailUserEnv("member_123")).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "Hosted verified email status lookup failed.",
      "worker unavailable",
    );
  });

  it("fails fast when hosted execution control is not configured", async () => {
    mocks.readHostedExecutionControlBaseUrl.mockReturnValue(null);

    const { syncHostedVerifiedEmailToHostedExecution } = await import(
      "@/src/lib/hosted-execution/control"
    );

    await expect(
      syncHostedVerifiedEmailToHostedExecution({
        emailAddress: "user@example.com",
        userId: "member_123",
        verifiedAt: "2026-03-27T08:30:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
      httpStatus: 500,
    });
    expect(mocks.createCloudflareHostedControlClient).not.toHaveBeenCalled();
  });
});
