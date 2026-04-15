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
  const provisionManagedUserCrypto = vi.fn();
  const updateUserEnv = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.readHostedExecutionControlBaseUrl.mockReturnValue("https://dispatch.example.test");
    mocks.createHostedExecutionVercelOidcBearerTokenProvider.mockReturnValue(mocks.tokenProvider);
    mocks.createCloudflareHostedControlClient.mockReturnValue({
      getUserEnvStatus,
      provisionManagedUserCrypto,
      updateUserEnv,
    });
    getUserEnvStatus.mockResolvedValue({
      configuredUserEnvKeys: [],
      userId: "member_123",
    });
    provisionManagedUserCrypto.mockResolvedValue({});
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

describe("managed user crypto warmup helper", () => {
  const provisionManagedUserCrypto = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.readHostedExecutionControlBaseUrl.mockReturnValue("https://dispatch.example.test");
    mocks.createHostedExecutionVercelOidcBearerTokenProvider.mockReturnValue(mocks.tokenProvider);
    mocks.createCloudflareHostedControlClient.mockReturnValue({
      provisionManagedUserCrypto,
    });
    provisionManagedUserCrypto.mockResolvedValue({});
  });

  it("best-effort pre-provisions the managed user crypto context when control is configured", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const { preProvisionManagedUserCryptoInHostedExecutionBestEffort } = await import(
      "@/src/lib/hosted-execution/control"
    );

    await expect(
      preProvisionManagedUserCryptoInHostedExecutionBestEffort({
        trigger: "privy-complete-checkout",
        userId: "member_123",
      }),
    ).resolves.toBe(true);

    expect(provisionManagedUserCrypto).toHaveBeenCalledWith("member_123");
    expect(consoleInfo).toHaveBeenCalledWith(
      "Hosted onboarding timing.",
      expect.objectContaining({
        outcome: "completed",
        step: "hosted-onboarding.crypto-warmup",
        trigger: "privy-complete-checkout",
      }),
    );
  });

  it("returns false without throwing when hosted execution control is not configured", async () => {
    mocks.readHostedExecutionControlBaseUrl.mockReturnValue(null);

    const { preProvisionManagedUserCryptoInHostedExecutionBestEffort } = await import(
      "@/src/lib/hosted-execution/control"
    );

    await expect(
      preProvisionManagedUserCryptoInHostedExecutionBestEffort({
        trigger: "billing-checkout-route",
        userId: "member_123",
      }),
    ).resolves.toBe(false);

    expect(mocks.createCloudflareHostedControlClient).not.toHaveBeenCalled();
  });

  it("logs a sanitized error and returns false when pre-provisioning fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    provisionManagedUserCrypto.mockRejectedValue(new Error("worker unavailable"));

    const { preProvisionManagedUserCryptoInHostedExecutionBestEffort } = await import(
      "@/src/lib/hosted-execution/control"
    );

    await expect(
      preProvisionManagedUserCryptoInHostedExecutionBestEffort({
        trigger: "billing-checkout-route",
        userId: "member_123",
      }),
    ).resolves.toBe(false);

    expect(consoleError).toHaveBeenCalledWith(
      "Hosted managed user crypto warmup failed during billing-checkout-route.",
      "worker unavailable",
    );
  });

  it("schedules the managed crypto warmup through the provided scheduler when available", async () => {
    const { scheduleManagedUserCryptoWarmupBestEffort } = await import(
      "@/src/lib/hosted-execution/control"
    );
    const schedule = vi.fn((callback: () => Promise<void> | void) => {
      const result = callback();

      if (result && typeof (result as Promise<void>).catch === "function") {
        void (result as Promise<void>).catch(() => {});
      }
    });

    expect(
      scheduleManagedUserCryptoWarmupBestEffort({
        schedule,
        trigger: "privy-complete-checkout",
        userId: "member_123",
      }),
    ).toBe("after");

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(provisionManagedUserCrypto).toHaveBeenCalledWith("member_123");
  });

  it("falls back to inline warmup when the scheduler throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { scheduleManagedUserCryptoWarmupBestEffort } = await import(
      "@/src/lib/hosted-execution/control"
    );
    const schedule = vi.fn(() => {
      throw new TypeError("authorization: Bearer abc.def.ghi user@example.com");
    });

    expect(
      scheduleManagedUserCryptoWarmupBestEffort({
        schedule,
        trigger: "billing-checkout-route",
        userId: "member_123",
      }),
    ).toBe("fallback-inline");

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(provisionManagedUserCrypto).toHaveBeenCalledWith("member_123");
    expect(consoleError).toHaveBeenCalledWith(
      "Hosted managed user crypto warmup scheduling failed during billing-checkout-route. Falling back to inline dispatch.",
      "authorization=Bearer [redacted] [redacted-email]",
    );
  });
});
