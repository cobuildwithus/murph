import type { Agent, buildConnector } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn<buildConnector.connector>(),
  agentOptions: null as Agent.Options | null,
  createCloudflareHostedControlClient: vi.fn(),
  createHostedExecutionVercelOidcBearerTokenProvider: vi.fn(),
  readHostedExecutionControlBaseUrl: vi.fn(),
  readHostedExecutionControlEnvironment: vi.fn(),
  tokenProvider: vi.fn(),
}));

vi.mock("undici", () => ({
  buildConnector: () => mocks.connect,
  Agent: class {
    constructor(options: Agent.Options) { mocks.agentOptions = options; }
  },
}));

afterEach(() => vi.restoreAllMocks());

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
  it("reports slow connection setup without logging targets or changing completion", async () => {
    await import("@/src/lib/hosted-execution/control");
    const connect = mocks.agentOptions?.connect;
    if (typeof connect !== "function") throw new Error("Expected the native connector wrapper.");
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(700);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const failure = new Error("private-host-detail");
    mocks.connect.mockImplementationOnce((_options, callback) => callback(failure, null));
    const callback = vi.fn();
    connect({ hostname: "private.example.test", protocol: "https:", port: "443" }, callback);
    expect(callback).toHaveBeenCalledWith(failure, null);
    expect(log).toHaveBeenCalledWith("Hosted control connection timing.", {
      event: "hosted-control.connect.timing", elapsedMs: 700, encrypted: true, completed: false,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("preserves native failure completion when the optional logger throws", async () => {
    await import("@/src/lib/hosted-execution/control");
    const connect = mocks.agentOptions?.connect;
    if (typeof connect !== "function") throw new Error("Expected the native connector wrapper.");
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("logger failure"); });
    const failure = new Error("connection failed");
    mocks.connect.mockImplementationOnce((_options, callback) => callback(failure, null));
    const callback = vi.fn();
    expect(() => connect({ hostname: "example.test", protocol: "https:", port: "443" }, callback)).not.toThrow();
    expect(callback).toHaveBeenCalledWith(failure, null);
  });

});
