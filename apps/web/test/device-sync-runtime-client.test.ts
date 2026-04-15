import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedModules = vi.hoisted(() => {
  const requestJson = vi.fn<(input: unknown) => Promise<unknown | null>>(async () => null);

  return {
    createHostedExecutionVercelOidcBearerTokenProvider: vi.fn(() => async () => "token_123"),
    createHostedExecutionWebJsonRequester: vi.fn(() => ({ requestJson })),
    readHostedExecutionControlBaseUrl: vi.fn(() => "https://control.example.test"),
    requestJson,
  };
});

vi.mock("@/src/lib/hosted-execution/auth-adapter", () => ({
  createHostedExecutionVercelOidcBearerTokenProvider:
    mockedModules.createHostedExecutionVercelOidcBearerTokenProvider,
}));

vi.mock("@/src/lib/hosted-execution/environment", () => ({
  readHostedExecutionControlBaseUrl: mockedModules.readHostedExecutionControlBaseUrl,
}));

vi.mock("@/src/lib/hosted-execution/request-client", () => ({
  createHostedExecutionWebJsonRequester: mockedModules.createHostedExecutionWebJsonRequester,
}));

const { requireHostedDeviceSyncRuntimeClient } = await import("../src/lib/device-sync/runtime-client");

describe("requireHostedDeviceSyncRuntimeClient", () => {
  beforeEach(() => {
    mockedModules.createHostedExecutionVercelOidcBearerTokenProvider.mockReset().mockReturnValue(async () => "token_123");
    mockedModules.createHostedExecutionWebJsonRequester.mockReset().mockReturnValue({
      requestJson: mockedModules.requestJson,
    });
    mockedModules.readHostedExecutionControlBaseUrl.mockReset().mockReturnValue("https://control.example.test");
    mockedModules.requestJson.mockReset().mockResolvedValue({
      connections: [],
      generatedAt: "2026-04-15T00:00:00.000Z",
      userId: "owner_123",
    });
  });

  it("requests secret-bearing snapshots only when includeSecrets is explicitly enabled", async () => {
    const client = requireHostedDeviceSyncRuntimeClient();

    await client.getDeviceSyncRuntimeSnapshot("owner_123", {
      connectionId: "conn_123",
      includeSecrets: true,
      provider: "oura",
    });

    expect(mockedModules.requestJson).toHaveBeenCalledWith({
      boundUserId: "owner_123",
      label: "device-sync runtime snapshot",
      method: "GET",
      parse: expect.any(Function),
      path: "/internal/users/owner_123/device-sync/runtime",
      search: "connectionId=conn_123&provider=oura&includeSecrets=true",
    });
  });
});
