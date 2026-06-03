import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => {
  const connection = { kind: "connection" };
  return {
    clientConstructor: vi.fn(function Client(
      this: { options?: unknown },
      options: unknown,
    ) {
      this.options = options;
    }),
    connect: vi.fn(async () => connection),
  };
});

vi.mock("@temporalio/client", () => ({
  Client: mocks.clientConstructor,
  Connection: {
    connect: mocks.connect,
  },
}));

describe("hosted web Temporal signal client cache", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    mocks.connect.mockClear();
    mocks.clientConstructor.mockClear();
  });

  it("clears a rejected cached connection promise so a later call can retry", async () => {
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "hosted-temporal.example.test:7233");
    mocks.connect.mockRejectedValueOnce(new Error("Temporal unavailable"));
    const temporalClient = await importTemporalClientModule();

    await expect(
      temporalClient.readHostedRuntimeTemporalSignalClientIfConfigured(),
    ).rejects.toThrow("Temporal unavailable");

    const retryClient = await temporalClient.readHostedRuntimeTemporalSignalClientIfConfigured();

    expect(retryClient).toBeInstanceOf(mocks.clientConstructor);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });
});

async function importTemporalClientModule() {
  return await import("@/src/lib/hosted-orchestration/temporal-client");
}
