import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCloudflareHostedControlClient: vi.fn(),
  createHostedExecutionVercelOidcBearerTokenProvider: vi.fn(),
  readHostedExecutionControlBaseUrl: vi.fn(),
  tokenProvider: vi.fn(),
}));

vi.mock("@murphai/cloudflare-hosted-control", () => ({
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
  const run = vi.fn();
  const updateUserEnv = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedExecutionControlBaseUrl.mockReturnValue("https://dispatch.example.test");
    mocks.createHostedExecutionVercelOidcBearerTokenProvider.mockReturnValue(mocks.tokenProvider);
    mocks.createCloudflareHostedControlClient.mockReturnValue({
      run,
      updateUserEnv,
    });
    run.mockResolvedValue({});
    updateUserEnv.mockResolvedValue({});
  });

  it("stores the verified email in hosted user env and triggers a hosted run", async () => {
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
      runTriggered: true,
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
    expect(run).toHaveBeenCalledWith("member_123");
    expect(updateUserEnv.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
  });

  it("keeps the verified email saved even when the best-effort hosted run trigger fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    run.mockRejectedValue(new Error("worker unavailable"));

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
      runTriggered: false,
      verifiedAt: "2026-03-27T08:30:00.000Z",
    });
    expect(updateUserEnv).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      "Hosted verified email sync saved user env but could not trigger a hosted run for member_123.",
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
