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

describe("hosted execution control client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readHostedExecutionControlBaseUrl.mockReturnValue("https://dispatch.example.test");
    mocks.createHostedExecutionVercelOidcBearerTokenProvider.mockReturnValue(mocks.tokenProvider);
    mocks.createCloudflareHostedControlClient.mockReturnValue({
      getEventStatus: vi.fn(),
      getStatus: vi.fn(),
      run: vi.fn(),
    });
  });

  it("creates the narrowed control client when configured", async () => {
    const { readHostedExecutionControlClientIfConfigured } = await import(
      "@/src/lib/hosted-execution/control"
    );

    const client = readHostedExecutionControlClientIfConfigured();

    expect(client).not.toBeNull();
    expect(mocks.createCloudflareHostedControlClient).toHaveBeenCalledWith({
      baseUrl: "https://dispatch.example.test",
      getBearerToken: mocks.tokenProvider,
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

  it("fails fast when a required client is requested without configuration", async () => {
    mocks.readHostedExecutionControlBaseUrl.mockReturnValue(null);

    const { requireHostedExecutionControlClient } = await import(
      "@/src/lib/hosted-execution/control"
    );

    try {
      requireHostedExecutionControlClient();
      throw new Error("Expected hosted execution control to require configuration.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
        httpStatus: 500,
      });
    }
  });
});
