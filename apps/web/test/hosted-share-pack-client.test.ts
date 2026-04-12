import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedModules = vi.hoisted(() => {
  const requestJson = vi.fn(async () => null);

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

const { requireHostedSharePackClient } = await import("../src/lib/hosted-share/pack-client");

describe("requireHostedSharePackClient", () => {
  beforeEach(() => {
    mockedModules.createHostedExecutionVercelOidcBearerTokenProvider.mockReset().mockReturnValue(async () => "token_123");
    mockedModules.createHostedExecutionWebJsonRequester.mockReset().mockReturnValue({
      requestJson: mockedModules.requestJson,
    });
    mockedModules.readHostedExecutionControlBaseUrl.mockReset().mockReturnValue("https://control.example.test");
    mockedModules.requestJson.mockReset().mockResolvedValue(null);
  });

  it("treats delete as idempotent when the share pack is already gone", async () => {
    const client = requireHostedSharePackClient();

    await client.deleteSharePack("owner_123", "share_123");

    expect(mockedModules.requestJson).toHaveBeenCalledWith({
      allowNotFound: true,
      body: undefined,
      label: "delete share pack",
      method: "DELETE",
      parse: expect.any(Function),
      path: "/internal/users/owner_123/shares/share_123/pack",
    });
  });
});
