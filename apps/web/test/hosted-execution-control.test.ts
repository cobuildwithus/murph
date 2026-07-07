import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCloudflareHostedControlClient: vi.fn(),
  createHostedExecutionVercelOidcBearerTokenProvider: vi.fn(),
  readHostedExecutionControlBaseUrl: vi.fn(),
  readHostedExecutionControlEnvironment: vi.fn(),
  tokenProvider: vi.fn(),
}));

vi.mock("@murphai/cloudflare-hosted-control/client", () => ({
  createCloudflareHostedControlClient: mocks.createCloudflareHostedControlClient,
}));

vi.mock("@/src/lib/hosted-execution/environment", () => ({
  readHostedExecutionControlBaseUrl: mocks.readHostedExecutionControlBaseUrl,
  readHostedExecutionControlEnvironment: mocks.readHostedExecutionControlEnvironment,
}));

vi.mock("@/src/lib/hosted-execution/auth-adapter", () => ({
  createHostedExecutionVercelOidcBearerTokenProvider:
    mocks.createHostedExecutionVercelOidcBearerTokenProvider,
}));

describe("hosted execution control client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedExecutionControlBaseUrl.mockReturnValue("https://dispatch.example.test");
    mocks.readHostedExecutionControlEnvironment.mockReturnValue({
      controlBaseUrl: "https://dispatch.example.test",
      controlTimeoutMs: 30_000,
    });
    mocks.createHostedExecutionVercelOidcBearerTokenProvider.mockReturnValue(mocks.tokenProvider);
    mocks.createCloudflareHostedControlClient.mockReturnValue({
      deleteUserData: vi.fn(),
      getRunnerStatus: vi.fn(),
    });
  });

  it("creates the narrowed control client when configured", async () => {
    const { readHostedExecutionControlClientIfConfigured } = await import(
      "@/src/lib/hosted-execution/control"
    );

    const client = readHostedExecutionControlClientIfConfigured();

    expect(client).not.toBeNull();
    expect(mocks.createCloudflareHostedControlClient).toHaveBeenCalledWith({
      allowHttpLocalhost: true,
      baseUrl: "https://dispatch.example.test",
      fetchImpl: expect.any(Function),
      getBearerToken: mocks.tokenProvider,
      timeoutMs: 30_000,
    });
  });

  it("returns null when hosted execution control is not configured", async () => {
    mocks.readHostedExecutionControlBaseUrl.mockReturnValue(null);

    const { readHostedExecutionControlClientIfConfigured } = await import(
      "@/src/lib/hosted-execution/control"
    );

    expect(readHostedExecutionControlClientIfConfigured()).toBeNull();
    expect(mocks.createCloudflareHostedControlClient).not.toHaveBeenCalled();
  });
});
