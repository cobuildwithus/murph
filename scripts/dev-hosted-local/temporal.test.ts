import net, { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BufferedNamedChildProcess,
  HostedLocalChildProcess,
  HostedLocalChildProcessName,
  HostedLocalDevConfig,
} from "./types.ts";

type SpawnChildProcess = (
  name: HostedLocalChildProcessName,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: {
    pipeOutput?: boolean;
    stderrTarget?: NodeJS.WritableStream;
    stdoutTarget?: NodeJS.WritableStream;
  },
) => BufferedNamedChildProcess;

const spawnSyncMock = vi.hoisted(() =>
  vi.fn<() => {
    error: Error | undefined;
    status: number | null;
  }>(() => ({
    error: undefined as Error | undefined,
    status: 0,
  })),
);
const spawnChildProcessMock = vi.hoisted(() =>
  vi.fn<SpawnChildProcess>((
    name: HostedLocalChildProcessName,
  ) => createBufferedChild({
    exitCode: null,
    name,
    pid: 100,
  })),
);
const terminateChildProcessAndWaitMock = vi.hoisted(() =>
  vi.fn(async () => {}),
);

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

vi.mock("./runtime.ts", () => ({
  spawnChildProcess: spawnChildProcessMock,
  terminateChildProcessAndWait: terminateChildProcessAndWaitMock,
}));

const baseConfig: HostedLocalDevConfig = {
  databaseUrlOverride: null,
  forceResetLocalDatabase: false,
  linqWebhookPublicUrl: null,
  linqWebhookTunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
  linqWebhookTunnelMode: "disabled",
  linqWebhookTunnelName: "dev",
  skipHealthCommonsWatch: true,
  skipLinqWebhookRegister: true,
  skipPrismaMigrate: false,
  skipRunnerSmoke: false,
  skipStripeListen: true,
  skipVercelPull: true,
  skipWeb: false,
  temporal: {
    host: "127.0.0.1",
    mode: "disabled",
    namespace: "default",
    port: 7233,
    taskQueue: "murph-hosted-runtime",
  },
  useVercelDatabaseUrl: false,
  webHost: "localhost",
  webPort: 3000,
  workerHost: "127.0.0.1",
  workerPersistDir: ".wrangler/state/dev-root",
  workerPort: 8787,
  workerProtocol: "http",
};

describe("hosted-local Temporal lifecycle", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("injects web and worker Temporal env for managed local orchestration", async () => {
    const { buildHostedLocalTemporalRuntimeEnv } = await import("./temporal.ts");

    const env = buildHostedLocalTemporalRuntimeEnv({
      config: {
        ...baseConfig,
        temporal: {
          host: "127.0.0.1",
          mode: "managed",
          namespace: "hosted-test",
          port: 7243,
          taskQueue: "hosted-test-queue",
        },
      },
      env: {},
    });

    expect(env).toMatchObject({
      HOSTED_TEMPORAL_ADDRESS: "127.0.0.1:7243",
      HOSTED_TEMPORAL_NAMESPACE: "hosted-test",
      HOSTED_TEMPORAL_TASK_QUEUE: "hosted-test-queue",
      HOSTED_TEMPORAL_TLS_ENABLED: "false",
      TEMPORAL_ADDRESS: "127.0.0.1:7243",
      TEMPORAL_NAMESPACE: "hosted-test",
      TEMPORAL_TASK_QUEUE: "hosted-test-queue",
      TEMPORAL_TLS_ENABLED: "false",
    });
    expect(env.TEMPORAL_API_KEY).toBeUndefined();
    expect(env.HOSTED_TEMPORAL_API_KEY).toBeUndefined();
  });

  it("preserves caller-supplied external Temporal addresses without forcing TLS off", async () => {
    const { buildHostedLocalTemporalRuntimeEnv } = await import("./temporal.ts");

    expect(buildHostedLocalTemporalRuntimeEnv({
      config: {
        ...baseConfig,
        temporal: {
          host: "127.0.0.1",
          mode: "external",
          namespace: "hosted-external",
          port: 7233,
          taskQueue: "hosted-external-queue",
        },
      },
      env: {
        HOSTED_TEMPORAL_ADDRESS: "temporal.example.test:7233",
      },
    })).toEqual({
      HOSTED_TEMPORAL_ADDRESS: "temporal.example.test:7233",
      HOSTED_TEMPORAL_NAMESPACE: "hosted-external",
      HOSTED_TEMPORAL_TASK_QUEUE: "hosted-external-queue",
      TEMPORAL_ADDRESS: "temporal.example.test:7233",
      TEMPORAL_NAMESPACE: "hosted-external",
      TEMPORAL_TASK_QUEUE: "hosted-external-queue",
    });
  });

  it("starts a managed Temporal server and worker", async () => {
    const port = await reserveLocalTcpPort();
    const server = net.createServer();
    spawnChildProcessMock.mockImplementation((name) => {
      if (name === "temporal-server") {
        server.listen(port, "127.0.0.1");
      }

      return createBufferedChild({
        exitCode: null,
        name,
        pid: name === "temporal-server" ? 201 : 202,
      });
    });
    const { startHostedLocalTemporalRuntime } = await import("./temporal.ts");

    try {
      const runtime = await startHostedLocalTemporalRuntime({
        cloudflareHostedControlBaseUrl: "http://127.0.0.1:8787",
        config: {
          ...baseConfig,
          temporal: {
            host: "127.0.0.1",
            mode: "managed",
            namespace: "hosted-managed",
            port,
            taskQueue: "hosted-managed-queue",
          },
        },
        env: {
          HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "local-callback-private",
        },
        hostedWebBaseUrl: "http://localhost:3000",
      });

      const serverCall = spawnChildProcessMock.mock.calls.find(([name]) => name === "temporal-server");
      expect(serverCall?.[3]).not.toHaveProperty("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK");
      expect(runtime?.address).toBe(`127.0.0.1:${port}`);
      expect(spawnChildProcessMock).toHaveBeenCalledWith(
        "temporal-server",
        "bash",
        ["scripts/temporal-dev-server.sh"],
        expect.objectContaining({
          TEMPORAL_DEV_HEADLESS: "1",
          TEMPORAL_DEV_IP: "127.0.0.1",
          TEMPORAL_DEV_PORT: String(port),
          TEMPORAL_NAMESPACE: "hosted-managed",
        }),
        expect.any(Object),
      );
      expect(spawnChildProcessMock).toHaveBeenCalledWith(
        "temporal-worker",
        "pnpm",
        ["--dir", "packages/hosted-orchestrator-temporal", "temporal:worker"],
        expect.objectContaining({
          CLOUDFLARE_HOSTED_CONTROL_BASE_URL: "http://127.0.0.1:8787",
          HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "local-callback-private",
          HOSTED_WEB_BASE_URL: "http://localhost:3000",
          TEMPORAL_ADDRESS: `127.0.0.1:${port}`,
          TEMPORAL_NAMESPACE: "hosted-managed",
          TEMPORAL_TASK_QUEUE: "hosted-managed-queue",
        }),
        expect.any(Object),
      );

      await runtime?.stop();
      expect(terminateChildProcessAndWaitMock).toHaveBeenCalledTimes(2);
    } finally {
      await closeServer(server);
    }
  });

  it.each([
    {
      bindBaseUrl: "http://0.0.0.0:8787",
      expectedClientBaseUrl: "http://127.0.0.1:8787",
      name: "IPv4",
    },
    {
      bindBaseUrl: "http://[::]:8787",
      expectedClientBaseUrl: "http://[::1]:8787",
      name: "IPv6",
    },
  ])("normalizes $name wildcard Cloudflare control bind hosts for the host-side Temporal worker", async ({
    bindBaseUrl,
    expectedClientBaseUrl,
  }) => {
    const port = await reserveLocalTcpPort();
    const server = net.createServer();
    spawnChildProcessMock.mockImplementation((name) => {
      if (name === "temporal-server") {
        server.listen(port, "127.0.0.1");
      }

      return createBufferedChild({
        exitCode: null,
        name,
        pid: name === "temporal-server" ? 301 : 302,
      });
    });
    const { startHostedLocalTemporalRuntime } = await import("./temporal.ts");

    try {
      const runtime = await startHostedLocalTemporalRuntime({
        cloudflareHostedControlBaseUrl: bindBaseUrl,
        config: {
          ...baseConfig,
          temporal: {
            host: "127.0.0.1",
            mode: "managed",
            namespace: "hosted-managed",
            port,
            taskQueue: "hosted-managed-queue",
          },
        },
        env: {},
        hostedWebBaseUrl: "http://localhost:3000",
      });

      expect(spawnChildProcessMock).toHaveBeenCalledWith(
        "temporal-worker",
        "pnpm",
        ["--dir", "packages/hosted-orchestrator-temporal", "temporal:worker"],
        expect.objectContaining({
          CLOUDFLARE_HOSTED_CONTROL_BASE_URL: expectedClientBaseUrl,
        }),
        expect.any(Object),
      );

      await runtime?.stop();
    } finally {
      await closeServer(server);
    }
  });

  it("fails managed mode fast when the Temporal CLI is missing", async () => {
    spawnSyncMock.mockReturnValueOnce({
      error: new Error("missing"),
      status: null,
    });
    const { startHostedLocalTemporalRuntime } = await import("./temporal.ts");

    await expect(startHostedLocalTemporalRuntime({
      cloudflareHostedControlBaseUrl: "http://127.0.0.1:8787",
      config: {
        ...baseConfig,
        temporal: {
          host: "127.0.0.1",
          mode: "managed",
          namespace: "default",
          port: 7243,
          taskQueue: "murph-hosted-runtime",
        },
      },
      env: {},
      hostedWebBaseUrl: "http://localhost:3000",
    })).rejects.toThrow("Temporal CLI is required for managed hosted-local Temporal.");
  });
});

async function reserveLocalTcpPort(): Promise<number> {
  const server = net.createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  await closeServer(server);

  if (!address || typeof address === "string") {
    throw new Error("Unable to reserve a local TCP port.");
  }

  return (address as AddressInfo).port;
}

async function closeServer(server: net.Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function createBufferedChild(input: {
  exitCode: number | null;
  name: HostedLocalChildProcessName;
  pid: number;
}): BufferedNamedChildProcess {
  const child: HostedLocalChildProcess = {
    exitCode: input.exitCode,
    kill: vi.fn(() => true),
    once: vi.fn(function once(this: HostedLocalChildProcess) {
      return this;
    }),
    pid: input.pid,
    signalCode: null,
  };

  return {
    child,
    name: input.name,
    stderrTail: () => "",
    stderrText: () => "",
    stdoutTail: () => "",
    stdoutText: () => "",
  };
}
