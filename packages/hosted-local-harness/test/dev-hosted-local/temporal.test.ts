import net, { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BufferedNamedChildProcess,
  HostedLocalChildProcess,
  HostedLocalChildProcessName,
  HostedLocalDevConfig,
} from "../../src/dev-hosted-local/types.ts";

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
type SpawnSync = (
  command: string,
  args?: readonly string[],
  options?: unknown,
) => {
  error?: Error;
  status: number | null;
};
type RunCommand = (
  command: string,
  args: string[],
  input: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    name: "setup";
    signal?: AbortSignal;
  },
) => Promise<void>;

const spawnSyncMock = vi.hoisted(() =>
  vi.fn<SpawnSync>(() => ({
    error: undefined,
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
const runCommandMock = vi.hoisted(() =>
  vi.fn<RunCommand>(async () => {}),
);

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

vi.mock("../../src/dev-hosted-local/runtime.ts", () => ({
  runCommand: runCommandMock,
  spawnChildProcess: spawnChildProcessMock,
  terminateChildProcessAndWait: terminateChildProcessAndWaitMock,
  throwIfAbortSignalAborted: vi.fn((signal?: AbortSignal) => {
    if (signal?.aborted) {
      const error = new Error("Hosted-local startup was interrupted.");
      error.name = "AbortError";
      throw error;
    }
  }),
}));

const baseConfig: HostedLocalDevConfig = {
  databaseUrlOverride: null,
  forceResetLocalDatabase: false,
  forceResetLocalTemporal: false,
  linqWebhookPublicUrl: null,
  linqWebhookRegistrationCachePath: ".tmp/linq-webhook-registration.json",
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
    vi.unstubAllEnvs();
    spawnSyncMock.mockReset();
    spawnSyncMock.mockImplementation(() => ({
      error: undefined,
      status: 0,
    }));
    spawnChildProcessMock.mockReset();
    spawnChildProcessMock.mockImplementation((
      name: HostedLocalChildProcessName,
    ) => createBufferedChild({
      exitCode: null,
      name,
      pid: 100,
    }));
    runCommandMock.mockReset();
    runCommandMock.mockImplementation(async () => {});
    vi.resetModules();
  });

  it("injects web and worker Temporal env for managed local orchestration", async () => {
    const { buildHostedLocalTemporalRuntimeEnv } = await import("../../src/dev-hosted-local/temporal.ts");

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

  it("injects non-TLS local Temporal env for auto mode", async () => {
    const { buildHostedLocalTemporalRuntimeEnv } = await import("../../src/dev-hosted-local/temporal.ts");

    const env = buildHostedLocalTemporalRuntimeEnv({
      config: {
        ...baseConfig,
        temporal: {
          host: "127.0.0.1",
          mode: "auto",
          namespace: "hosted-auto",
          port: 7243,
          taskQueue: "hosted-auto-queue",
        },
      },
      env: {
        TEMPORAL_API_KEY: "remote-secret",
      },
    });

    expect(env).toMatchObject({
      HOSTED_TEMPORAL_ADDRESS: "127.0.0.1:7243",
      HOSTED_TEMPORAL_NAMESPACE: "hosted-auto",
      HOSTED_TEMPORAL_TASK_QUEUE: "hosted-auto-queue",
      HOSTED_TEMPORAL_TLS_ENABLED: "false",
      TEMPORAL_ADDRESS: "127.0.0.1:7243",
      TEMPORAL_NAMESPACE: "hosted-auto",
      TEMPORAL_TASK_QUEUE: "hosted-auto-queue",
      TEMPORAL_TLS_ENABLED: "false",
    });
    expect(env.TEMPORAL_API_KEY).toBeUndefined();
  });

  it("preserves caller-supplied external Temporal addresses without forcing TLS off", async () => {
    const { buildHostedLocalTemporalRuntimeEnv } = await import("../../src/dev-hosted-local/temporal.ts");

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

  it("starts an external-mode worker without mutating the external Temporal schedule by default", async () => {
    const { startHostedLocalTemporalRuntime } = await import("../../src/dev-hosted-local/temporal.ts");

    const runtime = await startHostedLocalTemporalRuntime({
      cloudflareHostedControlBaseUrl: "http://0.0.0.0:8787",
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
        HOSTED_TEMPORAL_API_KEY: "remote-secret",
        HOSTED_TEMPORAL_TLS_ENABLED: "true",
      },
      hostedWebBaseUrl: "http://localhost:3000",
    });

    expect(runtime?.serverProcess).toBeNull();
    expect(runCommandMock).not.toHaveBeenCalled();
    expect(spawnChildProcessMock).toHaveBeenCalledWith(
      "temporal-worker",
      "pnpm",
      ["--dir", "packages/hosted-orchestrator-temporal", "temporal:worker"],
      expect.objectContaining({
        CLOUDFLARE_HOSTED_CONTROL_BASE_URL: "http://127.0.0.1:8787",
        HOSTED_TEMPORAL_ADDRESS: "temporal.example.test:7233",
        HOSTED_TEMPORAL_API_KEY: "remote-secret",
        HOSTED_TEMPORAL_NAMESPACE: "hosted-external",
        HOSTED_TEMPORAL_TASK_QUEUE: "hosted-external-queue",
        HOSTED_TEMPORAL_TLS_ENABLED: "true",
        HOSTED_WEB_BASE_URL: "http://localhost:3000",
        TEMPORAL_ADDRESS: "temporal.example.test:7233",
        TEMPORAL_NAMESPACE: "hosted-external",
        TEMPORAL_TASK_QUEUE: "hosted-external-queue",
      }),
      expect.any(Object),
    );

    await runtime?.stop();
    expect(terminateChildProcessAndWaitMock).toHaveBeenCalledTimes(1);
  });

  it("ensures the schedule before starting an opted-in external-mode worker with the worker env", async () => {
    const { startHostedLocalTemporalRuntime } = await import("../../src/dev-hosted-local/temporal.ts");

    const runtime = await startHostedLocalTemporalRuntime({
      cloudflareHostedControlBaseUrl: "http://0.0.0.0:8787",
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
        HOSTED_TEMPORAL_API_KEY: "remote-secret",
        HOSTED_TEMPORAL_TLS_ENABLED: "true",
        MURPH_DEV_TEMPORAL_ALLOW_EXTERNAL_SCHEDULE_ENSURE: "1",
      },
      hostedWebBaseUrl: "http://localhost:3000",
    });

    expect(runtime?.serverProcess).toBeNull();
    expect(runCommandMock).toHaveBeenCalledWith(
      "pnpm",
      [
        "--dir",
        "packages/hosted-orchestrator-temporal",
        "temporal:ensure-device-sync-reconciler-schedule",
      ],
      expect.objectContaining({
        env: expect.objectContaining({
          CLOUDFLARE_HOSTED_CONTROL_BASE_URL: "http://127.0.0.1:8787",
          HOSTED_TEMPORAL_ADDRESS: "temporal.example.test:7233",
          HOSTED_TEMPORAL_API_KEY: "remote-secret",
          HOSTED_TEMPORAL_NAMESPACE: "hosted-external",
          HOSTED_TEMPORAL_TASK_QUEUE: "hosted-external-queue",
          HOSTED_TEMPORAL_TLS_ENABLED: "true",
          HOSTED_WEB_BASE_URL: "http://localhost:3000",
          MURPH_DEV_TEMPORAL_ALLOW_EXTERNAL_SCHEDULE_ENSURE: "1",
          TEMPORAL_ADDRESS: "temporal.example.test:7233",
          TEMPORAL_NAMESPACE: "hosted-external",
          TEMPORAL_TASK_QUEUE: "hosted-external-queue",
        }),
        name: "setup",
      }),
    );
    expect(spawnChildProcessMock).toHaveBeenCalledWith(
      "temporal-worker",
      "pnpm",
      ["--dir", "packages/hosted-orchestrator-temporal", "temporal:worker"],
      expect.objectContaining({
        CLOUDFLARE_HOSTED_CONTROL_BASE_URL: "http://127.0.0.1:8787",
        HOSTED_TEMPORAL_ADDRESS: "temporal.example.test:7233",
        HOSTED_TEMPORAL_API_KEY: "remote-secret",
        HOSTED_TEMPORAL_NAMESPACE: "hosted-external",
        HOSTED_TEMPORAL_TASK_QUEUE: "hosted-external-queue",
        HOSTED_TEMPORAL_TLS_ENABLED: "true",
        HOSTED_WEB_BASE_URL: "http://localhost:3000",
        MURPH_DEV_TEMPORAL_ALLOW_EXTERNAL_SCHEDULE_ENSURE: "1",
        TEMPORAL_ADDRESS: "temporal.example.test:7233",
        TEMPORAL_NAMESPACE: "hosted-external",
        TEMPORAL_TASK_QUEUE: "hosted-external-queue",
      }),
      expect.any(Object),
    );
    expectScheduleEnsureBeforeWorker();

    await runtime?.stop();
    expect(terminateChildProcessAndWaitMock).toHaveBeenCalledTimes(1);
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
    const { startHostedLocalTemporalRuntime } = await import("../../src/dev-hosted-local/temporal.ts");

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
      expect(runCommandMock).toHaveBeenCalledWith(
        "pnpm",
        [
          "--dir",
          "packages/hosted-orchestrator-temporal",
          "temporal:ensure-device-sync-reconciler-schedule",
        ],
        expect.objectContaining({
          cwd: expect.any(String),
          env: expect.objectContaining({
            CLOUDFLARE_HOSTED_CONTROL_BASE_URL: "http://127.0.0.1:8787",
            HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "local-callback-private",
            HOSTED_WEB_BASE_URL: "http://localhost:3000",
            TEMPORAL_ADDRESS: `127.0.0.1:${port}`,
            TEMPORAL_NAMESPACE: "hosted-managed",
            TEMPORAL_TASK_QUEUE: "hosted-managed-queue",
          }),
          name: "setup",
          signal: undefined,
        }),
      );
      expect(spawnChildProcessMock).toHaveBeenCalledWith(
        "temporal-server",
        "bash",
        ["scripts/temporal-dev-server.sh"],
        expect.objectContaining({
          TEMPORAL_DEV_IP: "127.0.0.1",
          TEMPORAL_DEV_PORT: String(port),
          TEMPORAL_NAMESPACE: "hosted-managed",
        }),
        expect.any(Object),
      );
      expect(serverCall?.[3]).not.toHaveProperty("TEMPORAL_DEV_HEADLESS");
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
      expectScheduleEnsureBeforeWorker();

      await runtime?.stop();
      expect(terminateChildProcessAndWaitMock).toHaveBeenCalledTimes(2);
    } finally {
      await closeServer(server);
    }
  });

  it("stops managed Temporal if the schedule ensure command fails before worker startup", async () => {
    const port = await reserveLocalTcpPort();
    const server = net.createServer();
    runCommandMock.mockRejectedValueOnce(new Error("schedule ensure failed"));
    spawnChildProcessMock.mockImplementation((name) => {
      if (name === "temporal-server") {
        server.listen(port, "127.0.0.1");
      }

      return createBufferedChild({
        exitCode: null,
        name,
        pid: name === "temporal-server" ? 211 : 212,
      });
    });
    const { startHostedLocalTemporalRuntime } = await import("../../src/dev-hosted-local/temporal.ts");

    try {
      await expect(startHostedLocalTemporalRuntime({
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
        env: {},
        hostedWebBaseUrl: "http://localhost:3000",
      })).rejects.toThrow("schedule ensure failed");

      expect(spawnChildProcessMock.mock.calls.some(([name]) => name === "temporal-worker"))
        .toBe(false);
      expect(terminateChildProcessAndWaitMock).toHaveBeenCalledTimes(1);
    } finally {
      await closeServer(server);
    }
  });

  it("reuses a healthy local Temporal listener in auto mode", async () => {
    const port = await reserveLocalTcpPort();
    const server = net.createServer();
    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    const { startHostedLocalTemporalRuntime } = await import("../../src/dev-hosted-local/temporal.ts");

    try {
      const runtime = await startHostedLocalTemporalRuntime({
        cloudflareHostedControlBaseUrl: "http://127.0.0.1:8787",
        config: {
          ...baseConfig,
          temporal: {
            host: "127.0.0.1",
            mode: "auto",
            namespace: "hosted-auto",
            port,
            taskQueue: "hosted-auto-queue",
          },
        },
        env: {},
        hostedWebBaseUrl: "http://localhost:3000",
      });

      expect(runtime?.serverProcess).toBeNull();
      expect(runtime?.address).toBe(`127.0.0.1:${port}`);
      expect(spawnChildProcessMock).not.toHaveBeenCalledWith(
        "temporal-server",
        expect.any(String),
        expect.any(Array),
        expect.any(Object),
        expect.any(Object),
      );
      expect(spawnChildProcessMock).toHaveBeenCalledWith(
        "temporal-worker",
        "pnpm",
        ["--dir", "packages/hosted-orchestrator-temporal", "temporal:worker"],
        expect.objectContaining({
          HOSTED_TEMPORAL_TLS_ENABLED: "false",
          TEMPORAL_ADDRESS: `127.0.0.1:${port}`,
          TEMPORAL_NAMESPACE: "hosted-auto",
          TEMPORAL_TASK_QUEUE: "hosted-auto-queue",
          TEMPORAL_TLS_ENABLED: "false",
        }),
        expect.any(Object),
      );
      expect(runCommandMock).toHaveBeenCalledWith(
        "pnpm",
        [
          "--dir",
          "packages/hosted-orchestrator-temporal",
          "temporal:ensure-device-sync-reconciler-schedule",
        ],
        expect.objectContaining({
          env: expect.objectContaining({
            HOSTED_TEMPORAL_TLS_ENABLED: "false",
            TEMPORAL_ADDRESS: `127.0.0.1:${port}`,
            TEMPORAL_NAMESPACE: "hosted-auto",
            TEMPORAL_TASK_QUEUE: "hosted-auto-queue",
            TEMPORAL_TLS_ENABLED: "false",
          }),
          name: "setup",
        }),
      );
      expectScheduleEnsureBeforeWorker();
      for (const [, , options] of spawnSyncMock.mock.calls) {
        const env = (options as { env?: NodeJS.ProcessEnv } | undefined)?.env;
        expect(env).toMatchObject({
          HOSTED_TEMPORAL_TLS_ENABLED: "false",
          TEMPORAL_TLS_ENABLED: "false",
        });
      }
      expect(spawnSyncMock).toHaveBeenCalledWith("temporal", ["--version"], {
        env: expect.any(Object),
        stdio: "ignore",
      });
      expect(spawnSyncMock).toHaveBeenCalledWith("temporal", [
        "operator",
        "cluster",
        "health",
        "--address",
        `127.0.0.1:${port}`,
        "--tls=false",
      ], {
        env: expect.any(Object),
        stdio: "ignore",
      });
      expect(spawnSyncMock).toHaveBeenCalledWith("temporal", [
        "operator",
        "namespace",
        "describe",
        "--namespace",
        "hosted-auto",
        "--address",
        `127.0.0.1:${port}`,
        "--tls=false",
      ], {
        env: expect.any(Object),
        stdio: "ignore",
      });
      expect(writes.join("")).toContain(`Reusing existing local Temporal at 127.0.0.1:${port}`);

      await runtime?.stop();
      expect(terminateChildProcessAndWaitMock).toHaveBeenCalledTimes(1);
    } finally {
      process.stdout.write = originalWrite;
      await closeServer(server);
    }
  });

  it("rejects a non-Temporal listener in auto mode", async () => {
    const port = await reserveLocalTcpPort();
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    spawnSyncMock.mockImplementation((_command, args) => {
      if (args?.includes("health")) {
        return {
          error: undefined,
          status: 1,
        };
      }

      return {
        error: undefined,
        status: 0,
      };
    });
    const { startHostedLocalTemporalRuntime } = await import("../../src/dev-hosted-local/temporal.ts");

    try {
      await expect(startHostedLocalTemporalRuntime({
        cloudflareHostedControlBaseUrl: "http://127.0.0.1:8787",
        config: {
          ...baseConfig,
          temporal: {
            host: "127.0.0.1",
            mode: "auto",
            namespace: "default",
            port,
            taskQueue: "murph-hosted-runtime",
          },
        },
        env: {},
        hostedWebBaseUrl: "http://localhost:3000",
      })).rejects.toThrow(
        `Local Temporal port is in use at 127.0.0.1:${port}, but it did not pass a Temporal health probe.`,
      );
      expect(spawnChildProcessMock).not.toHaveBeenCalled();
    } finally {
      await closeServer(server);
    }
  });

  it("scrubs remote Temporal env from local auto mode probes", async () => {
    vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", "temporal.example.test:7233");
    vi.stubEnv("HOSTED_TEMPORAL_API_KEY", "hosted-remote-secret");
    vi.stubEnv("HOSTED_TEMPORAL_CLIENT_CERT_PEM", "hosted-client-cert");
    vi.stubEnv("HOSTED_TEMPORAL_TLS_ENABLED", "true");
    vi.stubEnv("TEMPORAL_ADDRESS", "legacy-temporal.example.test:7233");
    vi.stubEnv("TEMPORAL_API_KEY", "legacy-remote-secret");
    vi.stubEnv("TEMPORAL_CLIENT_KEY_PEM", "legacy-client-key");
    vi.stubEnv("TEMPORAL_NAMESPACE", "remote-namespace");
    vi.stubEnv("TEMPORAL_TLS_ENABLED", "true");
    const port = await reserveLocalTcpPort();
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    const { startHostedLocalTemporalRuntime } = await import("../../src/dev-hosted-local/temporal.ts");

    try {
      const runtime = await startHostedLocalTemporalRuntime({
        cloudflareHostedControlBaseUrl: "http://127.0.0.1:8787",
        config: {
          ...baseConfig,
          temporal: {
            host: "127.0.0.1",
            mode: "auto",
            namespace: "default",
            port,
            taskQueue: "murph-hosted-runtime",
          },
        },
        env: {},
        hostedWebBaseUrl: "http://localhost:3000",
      });

      const probeCalls = spawnSyncMock.mock.calls.filter(([, args]) =>
        args?.includes("health") || args?.includes("describe")
      );
      expect(probeCalls).toHaveLength(2);
      for (const [, , options] of probeCalls) {
        const env = (options as { env?: NodeJS.ProcessEnv } | undefined)?.env;
        expect(env).toMatchObject({
          HOSTED_TEMPORAL_TLS_ENABLED: "false",
          TEMPORAL_TLS_ENABLED: "false",
        });
        expect(env).not.toHaveProperty("HOSTED_TEMPORAL_ADDRESS");
        expect(env).not.toHaveProperty("HOSTED_TEMPORAL_API_KEY");
        expect(env).not.toHaveProperty("HOSTED_TEMPORAL_CLIENT_CERT_PEM");
        expect(env).not.toHaveProperty("TEMPORAL_ADDRESS");
        expect(env).not.toHaveProperty("TEMPORAL_API_KEY");
        expect(env).not.toHaveProperty("TEMPORAL_CLIENT_KEY_PEM");
        expect(env).not.toHaveProperty("TEMPORAL_NAMESPACE");
      }

      await runtime?.stop();
    } finally {
      await closeServer(server);
    }
  });

  it("passes the explicit managed-server headless escape hatch through", async () => {
    const port = await reserveLocalTcpPort();
    const server = net.createServer();
    spawnChildProcessMock.mockImplementation((name) => {
      if (name === "temporal-server") {
        server.listen(port, "127.0.0.1");
      }

      return createBufferedChild({
        exitCode: null,
        name,
        pid: name === "temporal-server" ? 211 : 212,
      });
    });
    const { startHostedLocalTemporalRuntime } = await import("../../src/dev-hosted-local/temporal.ts");

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
          TEMPORAL_DEV_HEADLESS: "1",
        },
        hostedWebBaseUrl: "http://localhost:3000",
      });

      const serverCall = spawnChildProcessMock.mock.calls.find(([name]) => name === "temporal-server");
      expect(serverCall?.[3]).toMatchObject({
        TEMPORAL_DEV_HEADLESS: "1",
      });

      await runtime?.stop();
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
    const { startHostedLocalTemporalRuntime } = await import("../../src/dev-hosted-local/temporal.ts");

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
    const { startHostedLocalTemporalRuntime } = await import("../../src/dev-hosted-local/temporal.ts");

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
    })).rejects.toThrow("Temporal CLI is required for auto/managed hosted-local Temporal.");
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

function expectScheduleEnsureBeforeWorker(): void {
  const ensureCallOrder = runCommandMock.mock.invocationCallOrder[0];
  const workerCallIndex = spawnChildProcessMock.mock.calls
    .findIndex(([name]) => name === "temporal-worker");

  expect(workerCallIndex).toBeGreaterThanOrEqual(0);
  const workerCallOrder = spawnChildProcessMock.mock.invocationCallOrder[workerCallIndex];
  expect(ensureCallOrder).toBeDefined();
  expect(workerCallOrder).toBeDefined();
  expect(Number(ensureCallOrder)).toBeLessThan(Number(workerCallOrder));
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
