import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = { kind: "connection" };
const connect = vi.fn(async (options: unknown) => connection);
const clientConstructor = vi.fn(function Client(this: { options?: unknown }, options: unknown) {
  this.options = options;
});

vi.mock("@temporalio/client", () => ({
  Client: clientConstructor,
  Connection: {
    connect,
  },
}));

describe("createHostedRuntimeTemporalClient", () => {
  beforeEach(() => {
    connect.mockClear();
    clientConstructor.mockClear();
  });

  it("creates a Temporal client with explicit connection options", async () => {
    const {
      createHostedRuntimeTemporalClient,
    } = await import("../src/client/temporal-client.js");

    const client = await createHostedRuntimeTemporalClient({
      address: "temporal.example.test:7233",
      namespace: "hosted-local",
      tls: true,
    });

    expect(connect).toHaveBeenCalledWith({
      address: "temporal.example.test:7233",
      tls: true,
    });
    expect(clientConstructor).toHaveBeenCalledWith({
      connection,
      namespace: "hosted-local",
    });
    expect(client).toBeInstanceOf(clientConstructor);
  });

  it("uses an injected connection without opening a new one", async () => {
    const {
      createHostedRuntimeTemporalClient,
    } = await import("../src/client/temporal-client.js");
    const injectedConnection = { kind: "injected" };

    await createHostedRuntimeTemporalClient({
      connection: injectedConnection as never,
      namespace: "hosted-local",
    });

    expect(connect).not.toHaveBeenCalled();
    expect(clientConstructor).toHaveBeenCalledWith({
      connection: injectedConnection,
      namespace: "hosted-local",
    });
  });

  it("creates a Temporal client from explicit env names", async () => {
    const {
      createHostedRuntimeTemporalClientFromEnv,
    } = await import("../src/client/temporal-client.js");

    await createHostedRuntimeTemporalClientFromEnv({
      TEMPORAL_ADDRESS: "temporal.example.test:7233",
      TEMPORAL_NAMESPACE: "hosted-local",
      TEMPORAL_TLS_ENABLED: "false",
    });

    expect(connect).toHaveBeenCalledWith({
      address: "temporal.example.test:7233",
      tls: false,
    });
    expect(clientConstructor).toHaveBeenCalledWith({
      connection,
      namespace: "hosted-local",
    });
  });
});
