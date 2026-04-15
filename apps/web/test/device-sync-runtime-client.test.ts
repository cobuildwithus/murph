import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedModules = vi.hoisted(() => {
  const requestJson = vi.fn<(input: unknown) => Promise<unknown | null>>(async () => null);

  return {
    createHostedExecutionVercelOidcBearerTokenProvider: vi.fn(() => async () => "token_123"),
    createHostedExecutionWebJsonRequester: vi.fn(() => ({ requestJson })),
    readHostedExecutionControlBaseUrl: vi.fn<() => string | null>(() => "https://control.example.test"),
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

const { readHostedDeviceSyncRuntimeClientIfConfigured } = await import("../src/lib/device-sync/runtime-client");

describe("readHostedDeviceSyncRuntimeClientIfConfigured", () => {
  beforeEach(() => {
    mockedModules.createHostedExecutionVercelOidcBearerTokenProvider.mockReset().mockReturnValue(async () => "token_123");
    mockedModules.createHostedExecutionWebJsonRequester.mockReset().mockReturnValue({
      requestJson: mockedModules.requestJson,
    });
    mockedModules.readHostedExecutionControlBaseUrl.mockReset().mockReturnValue("https://control.example.test");
    mockedModules.requestJson.mockReset().mockResolvedValue({
      appliedAt: "2026-04-15T00:00:00.000Z",
      updates: [],
      userId: "owner_123",
    });
  });

  it("returns null when the hosted execution control plane is not configured", () => {
    mockedModules.readHostedExecutionControlBaseUrl.mockReturnValue(null);

    expect(readHostedDeviceSyncRuntimeClientIfConfigured()).toBeNull();
    expect(mockedModules.createHostedExecutionWebJsonRequester).not.toHaveBeenCalled();
  });

  it("posts device-sync runtime projection updates through the hosted execution control plane", async () => {
    const client = readHostedDeviceSyncRuntimeClientIfConfigured();

    expect(client).not.toBeNull();

    await client?.applyDeviceSyncRuntimeUpdates("owner_123", {
      occurredAt: "2026-04-15T01:02:03.000Z",
      updates: [
        {
          connectionId: "conn_123",
          localState: {
            lastWebhookAt: "2026-04-15T01:02:03.000Z",
          },
        },
      ],
    });

    expect(mockedModules.requestJson).toHaveBeenCalledWith({
      body: JSON.stringify({
        occurredAt: "2026-04-15T01:02:03.000Z",
        updates: [
          {
            connectionId: "conn_123",
            localState: {
              lastWebhookAt: "2026-04-15T01:02:03.000Z",
            },
          },
        ],
        userId: "owner_123",
      }),
      boundUserId: "owner_123",
      label: "device-sync runtime projection apply",
      method: "POST",
      parse: expect.any(Function),
      path: "/internal/users/owner_123/device-sync/runtime",
    });
  });
});
