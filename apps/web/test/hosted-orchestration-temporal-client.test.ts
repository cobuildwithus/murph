import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  HOSTED_USER_RUNTIME_TASK_QUEUE,
} from "@murphai/hosted-execution";

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
    connection,
  };
});

vi.mock("@temporalio/client", () => ({
  Client: mocks.clientConstructor,
  Connection: {
    connect: mocks.connect,
  },
}));

describe("hosted web Temporal signal client", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    mocks.connect.mockClear();
    mocks.clientConstructor.mockClear();
  });

  it("keeps Temporal signaling disabled when no address is configured", async () => {
    const temporalClient = await importTemporalClientModule();

    expect(temporalClient.readHostedRuntimeTemporalEnvironment(buildProcessEnv())).toEqual({
      address: null,
      apiKey: null,
      namespace: "default",
      taskQueue: HOSTED_USER_RUNTIME_TASK_QUEUE,
      tls: false,
    });

    await expect(
      temporalClient.readHostedRuntimeTemporalSignalClientIfConfigured(),
    ).resolves.toBeNull();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("prefers hosted Temporal env names and enables TLS for API-key auth", async () => {
    vi.stubEnv("TEMPORAL_ADDRESS", "legacy-temporal.example.test:7233");
    vi.stubEnv("TEMPORAL_API_KEY", "legacy-temporal-api-key");
    vi.stubEnv("TEMPORAL_NAMESPACE", "legacy-namespace");
    vi.stubEnv("TEMPORAL_TASK_QUEUE", "legacy-task-queue");
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "hosted-temporal.example.test:7233");
    vi.stubEnv("HOSTED_TEMPORAL_API_KEY", "hosted-temporal-api-key");
    vi.stubEnv("HOSTED_TEMPORAL_NAMESPACE", "hosted-namespace");
    vi.stubEnv("HOSTED_TEMPORAL_TASK_QUEUE", "hosted-task-queue");
    const temporalClient = await importTemporalClientModule();

    expect(temporalClient.readHostedRuntimeTemporalEnvironment()).toEqual({
      address: "hosted-temporal.example.test:7233",
      apiKey: "hosted-temporal-api-key",
      namespace: "hosted-namespace",
      taskQueue: "hosted-task-queue",
      tls: true,
    });

    const client = await temporalClient.readHostedRuntimeTemporalSignalClientIfConfigured();

    expect(mocks.connect).toHaveBeenCalledWith({
      address: "hosted-temporal.example.test:7233",
      apiKey: "hosted-temporal-api-key",
      tls: true,
    });
    expect(mocks.clientConstructor).toHaveBeenCalledWith({
      connection: mocks.connection,
      namespace: "hosted-namespace",
    });
    expect(client).toBeInstanceOf(mocks.clientConstructor);
  });

  it("passes Temporal TLS material into the signal client connection", async () => {
    const clientCert = "-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----";
    const clientKey = "-----BEGIN PRIVATE KEY-----\nCLIENT\n-----END PRIVATE KEY-----";
    const rootCa = "-----BEGIN CERTIFICATE-----\nROOT\n-----END CERTIFICATE-----";
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "hosted-temporal.example.test:7233");
    vi.stubEnv("HOSTED_TEMPORAL_CLIENT_CERT_PEM", clientCert);
    vi.stubEnv("HOSTED_TEMPORAL_CLIENT_KEY_PEM", clientKey);
    vi.stubEnv(
      "HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_BASE64",
      Buffer.from(rootCa).toString("base64"),
    );
    vi.stubEnv("HOSTED_TEMPORAL_TLS_SERVER_NAME_OVERRIDE", "temporal.example.test");
    const temporalClient = await importTemporalClientModule();

    expect(temporalClient.readHostedRuntimeTemporalEnvironment()).toEqual({
      address: "hosted-temporal.example.test:7233",
      apiKey: null,
      namespace: "default",
      taskQueue: HOSTED_USER_RUNTIME_TASK_QUEUE,
      tls: {
        clientCertPair: {
          crt: Buffer.from(clientCert, "utf8"),
          key: Buffer.from(clientKey, "utf8"),
        },
        serverNameOverride: "temporal.example.test",
        serverRootCACertificate: Buffer.from(rootCa, "utf8"),
      },
    });

    await temporalClient.readHostedRuntimeTemporalSignalClientIfConfigured();

    expect(mocks.connect).toHaveBeenCalledWith({
      address: "hosted-temporal.example.test:7233",
      tls: {
        clientCertPair: {
          crt: Buffer.from(clientCert, "utf8"),
          key: Buffer.from(clientKey, "utf8"),
        },
        serverNameOverride: "temporal.example.test",
        serverRootCACertificate: Buffer.from(rootCa, "utf8"),
      },
    });
  });

  it("uses unprefixed Temporal env names as compatibility fallback", async () => {
    const temporalClient = await importTemporalClientModule();

    expect(temporalClient.readHostedRuntimeTemporalEnvironment(buildProcessEnv({
      TEMPORAL_ADDRESS: "temporal.example.test:7233",
      TEMPORAL_API_KEY: "temporal-api-key",
      TEMPORAL_NAMESPACE: "hosted-local",
      TEMPORAL_TASK_QUEUE: "hosted-runtime-local",
      TEMPORAL_TLS_ENABLED: "true",
    }))).toEqual({
      address: "temporal.example.test:7233",
      apiKey: "temporal-api-key",
      namespace: "hosted-local",
      taskQueue: "hosted-runtime-local",
      tls: true,
    });
  });

  it("caches the configured signal client", async () => {
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "hosted-temporal.example.test:7233");
    vi.stubEnv("HOSTED_TEMPORAL_NAMESPACE", "hosted-namespace");
    const temporalClient = await importTemporalClientModule();

    const firstClient = await temporalClient.readHostedRuntimeTemporalSignalClientIfConfigured();
    const cachedClient = await temporalClient.readHostedRuntimeTemporalSignalClientIfConfigured();

    expect(cachedClient).toBe(firstClient);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledWith({
      address: "hosted-temporal.example.test:7233",
      tls: false,
    });
  });

  it("builds uncached explicit clients from an environment source", async () => {
    const temporalClient = await importTemporalClientModule();
    const environment = buildProcessEnv({
      HOSTED_TEMPORAL_ADDRESS: "hosted-temporal.example.test:7233",
      HOSTED_TEMPORAL_NAMESPACE: "hosted-namespace",
    });

    const firstClient = await temporalClient.createHostedRuntimeTemporalSignalClient(environment);
    const secondClient = await temporalClient.createHostedRuntimeTemporalSignalClient(environment);

    expect(secondClient).not.toBe(firstClient);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it("rejects API-key credentials when TLS is explicitly disabled", async () => {
    const temporalClient = await importTemporalClientModule();

    expect(() => temporalClient.readHostedRuntimeTemporalEnvironment(buildProcessEnv({
      HOSTED_TEMPORAL_API_KEY: "hosted-temporal-api-key",
      HOSTED_TEMPORAL_TLS_ENABLED: "false",
    }))).toThrow(
      "HOSTED_TEMPORAL_TLS_ENABLED cannot be false when Temporal credentials or TLS material are configured.",
    );
  });

  it("rejects partial or ambiguous Temporal TLS material", async () => {
    const temporalClient = await importTemporalClientModule();

    expect(() => temporalClient.readHostedRuntimeTemporalEnvironment(buildProcessEnv({
      HOSTED_TEMPORAL_CLIENT_CERT_PEM: "cert",
    }))).toThrow(
      "TEMPORAL_CLIENT_CERT and TEMPORAL_CLIENT_KEY must be configured together.",
    );

    expect(() => temporalClient.readHostedRuntimeTemporalEnvironment(buildProcessEnv({
      HOSTED_TEMPORAL_CLIENT_CERT_BASE64: Buffer.from("cert").toString("base64"),
      HOSTED_TEMPORAL_CLIENT_CERT_PEM: "cert",
      HOSTED_TEMPORAL_CLIENT_KEY_PEM: "key",
    }))).toThrow(
      "TEMPORAL_CLIENT_CERT_PEM and TEMPORAL_CLIENT_CERT_BASE64 are mutually exclusive.",
    );
  });

  it("rejects ambiguous TLS values", async () => {
    const temporalClient = await importTemporalClientModule();

    expect(() => temporalClient.readHostedRuntimeTemporalEnvironment(buildProcessEnv({
      HOSTED_TEMPORAL_TLS_ENABLED: "sometimes",
    }))).toThrow("HOSTED_TEMPORAL_TLS_ENABLED must be true or false.");
  });

  it("includes shared hosted runtime workflow options", async () => {
    const temporalClient = await importTemporalClientModule();

    expect(temporalClient.readHostedRuntimeTemporalWorkflowOptions(buildProcessEnv({
      HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS: "12000",
    }))).toEqual({
      ensureRuntimeProcessingStartToCloseTimeoutMs: 17_000,
      prewarmTaskQueue: "murph-hosted-runtime-prewarm",
      readRuntimeReconciliationFactsStartToCloseTimeoutMs: 10_000,
    });
  });
});

function buildProcessEnv(
  entries: Record<string, string> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...entries,
  };
}

async function importTemporalClientModule() {
  return await import("@/src/lib/hosted-orchestration/temporal-client");
}
