import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BufferedNamedChildProcess,
  HostedLocalChildProcess,
  HostedLocalDevConfig,
} from "./types.ts";

class CapturingWritable extends Writable {
  readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

const defaultConfig: HostedLocalDevConfig = {
  skipPrismaMigrate: false,
  skipStripeListen: true,
  skipWeb: false,
  skipVercelPull: false,
  webHost: "127.0.0.1",
  webPort: 3000,
  workerHost: "127.0.0.1",
  workerPersistDir: ".wrangler/state/dev-root",
  workerPort: 8787,
  workerProtocol: "http",
};

const runCommand = vi.fn<(
  command: string,
  args: string[],
  input: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    name: "setup";
  },
) => Promise<void>>(async () => {});
let nextChildPid = 100;
const spawnChildProcess = vi.fn<
  (
    name: "cloudflare" | "stripe" | "web",
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    input?: {
      pipeOutput?: boolean;
      stderrTarget?: NodeJS.WritableStream;
      stdoutTarget?: NodeJS.WritableStream;
    },
  ) => BufferedNamedChildProcess
>((name) =>
  createBufferedChild({
    exitCode: null,
    name,
    pid: nextChildPid++,
  }),
);
class StripeCliMissingError extends Error {
  constructor() {
    super("stripe CLI executable was not found on PATH");
    this.name = "StripeCliMissingError";
  }
}
const spawnStripeListenerWithSecretCapture = vi.fn<
  (input: {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    pipeOutput?: boolean;
    stderrTarget?: NodeJS.WritableStream;
    stdoutTarget?: NodeJS.WritableStream;
    timeoutMs: number;
  }) => Promise<{ child: BufferedNamedChildProcess; secret: string }>
>();
const terminateChildProcessAndWait = vi.fn(async () => {});
const waitForHealthyHttpEndpoint = vi.fn(async () => {});
const waitForFirstChildExit = vi.fn<(
  children: readonly BufferedNamedChildProcess[],
) => Promise<BufferedNamedChildProcess>>(() => new Promise(() => {}));
const cleanupHostedRunnerContainers = vi.fn(async () => {});
const collectDockerDevDiagnostics = vi.fn(async () => "Docker diagnostics:\n- docker version: ok");
const spawnSync = vi.fn(() => ({
  error: undefined,
  status: 0,
  stdout: "",
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  mkdtemp: vi.fn(async () => "/tmp/murph-dev-env-test"),
  rename: vi.fn(async () => {}),
  rm: vi.fn(async () => {}),
  symlink: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

vi.mock("node:child_process", () => ({
  spawnSync,
}));

vi.mock("./config.ts", () => ({
  resolveHostedLocalDevConfig: vi.fn(() => defaultConfig),
}));

vi.mock("./environment.ts", () => ({
  buildHostedLocalDevOverrides: vi.fn(() => ({
    HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
  })),
  buildWranglerEnvFileText: vi.fn(() => 'HOSTED_WEB_BASE_URL="http://127.0.0.1:3000"'),
  buildWranglerLocalDevConfig: vi.fn(() => ({ name: "murph-hosted" })),
  buildWranglerVarArgs: vi.fn(() => ["--var", "HOSTED_WEB_BASE_URL:http://127.0.0.1:3000"]),
  normalizeLocalDatabaseUrl: vi.fn((value: string | undefined) => value ?? "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync"),
  shouldSyncLocalDatabaseSchema: vi.fn(() => true),
  readOptionalSimpleEnvFile: vi.fn(async () => ({
    HOSTED_ASSISTANT_PROVIDER: "venice",
  })),
  readSimpleEnvFile: vi.fn(async () => ({})),
  requireEnvValue: vi.fn(),
  resolveCloudflareLocalEnv: vi.fn(async (input: { overrides?: Record<string, string | undefined> }) => ({
    HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL:
      input.overrides?.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL
      ?? "http://127.0.0.1:8787",
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
  })),
  warnForMissingEnv: vi.fn(),
}));

vi.mock("./runtime.ts", () => ({
  assertHostedWebDevServerAvailable: vi.fn(async () => {}),
  assertPortAvailable: vi.fn(async () => {}),
  cleanupHostedRunnerContainers,
  collectDockerDevDiagnostics,
  runCommand,
  spawnChildProcess,
  spawnStripeListenerWithSecretCapture,
  StripeCliMissingError,
  terminateChildProcessAndWait,
  waitForFirstChildExit,
  waitForHealthyHttpEndpoint,
}));

vi.mock("./vercel.ts", () => ({
  ensureVercelLinkExists: vi.fn(async () => {}),
  parseHostedExecutionOidcIdentity: vi.fn(() => ({
    environment: "development",
    projectName: "murph",
    teamSlug: "cobuildwithus",
  })),
  resolveVercelOidcToken: vi.fn(async () => "oidc-token"),
}));

function createBufferedChild(input: {
  exitCode: number | null;
  name: "cloudflare" | "stripe" | "web";
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

describe("hosted local dev stack", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("starts Cloudflare through the prepared app-owned dev entrypoint", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 101 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 102 }));

    const { startHostedLocalDevStack } = await import("./stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      [
        "--dir",
        "apps/cloudflare",
        "worker:dev:prepared",
        "--",
        "--ip",
        "127.0.0.1",
        "--port",
        "8787",
        "--config",
        "/tmp/murph-dev-env-test/cloudflare-worker.local-dev.generated.json",
        "--local-protocol",
        "http",
        "--persist-to",
        ".wrangler/state/dev-root",
        "--env-file",
        "/tmp/murph-dev-env-test/cloudflare-worker.env",
        "--var",
        "HOSTED_WEB_BASE_URL:http://127.0.0.1:3000",
      ],
      expect.objectContaining({
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://host.docker.internal:8787",
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
        HOSTED_ASSISTANT_PROVIDER: "venice",
        TSX_TSCONFIG_PATH: expect.stringMatching(/tsconfig\.base\.json$/),
        VERCEL_OIDC_TOKEN: "oidc-token",
      }),
      expect.any(Object),
    );
    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "prisma:generate"],
      expect.any(Object),
    );
    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "exec", "prisma", "db", "push", "--accept-data-loss"],
      expect.any(Object),
    );
    expect(cleanupHostedRunnerContainers).toHaveBeenCalledTimes(2);
    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(2);
    expect(waitForHealthyHttpEndpoint).toHaveBeenCalledTimes(2);
    expect(waitForHealthyHttpEndpoint).toHaveBeenNthCalledWith(1, {
      host: "127.0.0.1",
      label: "cloudflare",
      path: "/health",
      port: 8787,
      protocol: "http",
    });
    expect(waitForHealthyHttpEndpoint).toHaveBeenNthCalledWith(2, {
      host: "127.0.0.1",
      label: "web",
      path: "/api/internal/health",
      port: 3000,
      protocol: "http",
    });
  });

  it("uses prisma migrate deploy for non-local databases instead of forcing db push", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 111 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 112 }));

    const environmentModule = await import("./environment.ts");
    vi.mocked(environmentModule.shouldSyncLocalDatabaseSchema).mockReturnValueOnce(false);

    const { startHostedLocalDevStack } = await import("./stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "prisma:migrate:deploy"],
      expect.any(Object),
    );
    expect(runCommand).not.toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "exec", "prisma", "db", "push", "--accept-data-loss"],
      expect.any(Object),
    );
  });

  it("uses the Docker bridge gateway as the worker bridge host on Linux", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 151 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 152 }));
    spawnSync.mockReturnValueOnce({
      error: undefined,
      status: 0,
      stdout: "172.17.0.1\n",
    });
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    const { startHostedLocalDevStack } = await import("./stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnSync).toHaveBeenCalledWith(
      "docker",
      [
        "network",
        "inspect",
        "bridge",
        "--format",
        "{{range .IPAM.Config}}{{.Gateway}}{{end}}",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.any(Array),
      expect.objectContaining({
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://172.17.0.1:8787",
      }),
      expect.any(Object),
    );
    platformSpy.mockRestore();
  });

  it("fails closed on Linux when the worker bridge host cannot be resolved", async () => {
    spawnSync.mockReturnValueOnce({
      error: undefined,
      status: 1,
      stdout: "",
    });
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    const { startHostedLocalDevStack } = await import("./stack.ts");

    await expect(startHostedLocalDevStack({
      env: process.env,
    })).rejects.toThrow(
      "Hosted local dev on Linux could not resolve a container-reachable worker host.",
    );
    expect(spawnChildProcess).not.toHaveBeenCalled();
    platformSpy.mockRestore();
  });

  it("can start only the worker lane for focused hosted runtime debugging", async () => {
    const configModule = await import("./config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      skipWeb: true,
    });
    spawnChildProcess.mockReturnValueOnce(
      createBufferedChild({ exitCode: null, name: "cloudflare", pid: 401 }),
    );

    const { startHostedLocalDevStack } = await import("./stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnChildProcess).toHaveBeenCalledTimes(1);
    expect(waitForHealthyHttpEndpoint).toHaveBeenCalledTimes(1);
    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(1);
    expect(stack.webBaseUrl).toBeNull();
  });

  it("fails fast and cleans up when a dev child exits before readiness", async () => {
    const cloudflareChild = createBufferedChild({
      exitCode: 1,
      name: "cloudflare",
      pid: 501,
    });
    spawnChildProcess
      .mockReturnValueOnce(cloudflareChild)
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 502 }));
    waitForHealthyHttpEndpoint.mockImplementationOnce(() => new Promise(() => {}));
    waitForFirstChildExit.mockResolvedValueOnce(cloudflareChild);

    const { startHostedLocalDevStack } = await import("./stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });

    await expect(stack.ready).rejects.toThrow(
      "cloudflare dev process exited before the hosted local stack became healthy.",
    );
    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(2);
    expect(cleanupHostedRunnerContainers).toHaveBeenCalledWith(
      expect.objectContaining({
        ignoreErrors: true,
      }),
    );
  });

  it("skips Vercel link and env pull when the caller already provides a Vercel OIDC token", async () => {
    const configModule = await import("./config.ts");
    const vercelModule = await import("./vercel.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      skipPrismaMigrate: true,
      skipWeb: true,
    });
    spawnChildProcess.mockReturnValueOnce(
      createBufferedChild({ exitCode: null, name: "cloudflare", pid: 451 }),
    );
    vi.stubEnv("VERCEL_OIDC_TOKEN", "provided-oidc-token");

    const { startHostedLocalDevStack } = await import("./stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(vi.mocked(vercelModule.ensureVercelLinkExists)).not.toHaveBeenCalled();
    const sawVercelSetup = runCommand.mock.calls
      .some(([command]) => command === "vercel");
    expect(sawVercelSetup).toBe(false);
  });

  it("reuses a caller-provided temp dir for generated local worker inputs", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 201 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 202 }));
    vi.stubEnv("MURPH_DEV_TEMP_DIR", ".tmp/local-dev-debug");

    const { startHostedLocalDevStack } = await import("./stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.arrayContaining([
        "--env-file",
        expect.stringContaining(".tmp/local-dev-debug/cloudflare-worker.env"),
      ]),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("rejects temp dir overrides outside the repo-local .tmp subtree", async () => {
    vi.stubEnv("MURPH_DEV_TEMP_DIR", "../unsafe-temp-dir");

    const { startHostedLocalDevStack } = await import("./stack.ts");

    await expect(startHostedLocalDevStack({
      env: process.env,
    })).rejects.toThrow(
      "MURPH_DEV_TEMP_DIR must resolve inside the repo-local .tmp directory.",
    );
  });

  it("lets explicit shell env override pulled Vercel env for hosted worker config", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 301 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 302 }));

    vi.stubEnv("HOSTED_ASSISTANT_PROVIDER", "openai");
    vi.stubEnv("HOSTED_ASSISTANT_MODEL", "gpt-4.1-mini");

    const environmentModule = await import("./environment.ts");

    vi.mocked(environmentModule.readSimpleEnvFile).mockResolvedValueOnce({
      HOSTED_ASSISTANT_MODEL: "stale-pulled-model",
      HOSTED_ASSISTANT_PROVIDER: "venice",
    });

    const { startHostedLocalDevStack } = await import("./stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.any(Array),
      expect.objectContaining({
        HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
        HOSTED_ASSISTANT_PROVIDER: "openai",
      }),
      expect.any(Object),
    );
  });

  it("passes optional Wrangler debug flags through to the Cloudflare dev worker", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 401 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 402 }));
    vi.stubEnv("MURPH_DEV_CF_WRANGLER_LOG_LEVEL", "debug");

    const { startHostedLocalDevStack } = await import("./stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.arrayContaining([
        "--log-level",
        "debug",
        "--show-interactive-dev-session=false",
      ]),
      expect.any(Object),
      expect.any(Object),
    );
  });

  describe("stripe webhook listener", () => {
    async function withListenerConfig(
      overrides: Partial<HostedLocalDevConfig>,
      run: () => Promise<void>,
    ): Promise<void> {
      const configModule = await import("./config.ts");
      vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
        ...defaultConfig,
        skipStripeListen: false,
        ...overrides,
      });
      await run();
    }

    it("warns and continues without the listener when the Stripe CLI is missing", async () => {
      const stderrTarget = new CapturingWritable();
      spawnStripeListenerWithSecretCapture.mockRejectedValueOnce(
        new StripeCliMissingError(),
      );

      await withListenerConfig({}, async () => {
        const { startHostedLocalDevStack } = await import("./stack.ts");

        const stack = await startHostedLocalDevStack({
          env: process.env,
          stderrTarget,
        });
        await stack.ready;
        await stack.stop();

        expect(spawnStripeListenerWithSecretCapture).toHaveBeenCalledTimes(1);
        const writes = stderrTarget.text();
        expect(writes).toContain("Stripe CLI not found on PATH");
        expect(writes).toContain("brew install stripe/stripe-cli/stripe");
        expect(writes).toContain("MURPH_DEV_SKIP_STRIPE_LISTEN=1");
        expect(stack.processes.stripe).toBeNull();
      });
    });

    it("captures the listener's whsec and injects it into the web child env", async () => {
      const stderrTarget = new CapturingWritable();
      const listenerChild = createBufferedChild({
        exitCode: null,
        name: "stripe",
        pid: 911,
      });
      spawnStripeListenerWithSecretCapture.mockResolvedValueOnce({
        child: listenerChild,
        secret: "whsec_captured_abc123",
      });

      await withListenerConfig({}, async () => {
        const { startHostedLocalDevStack } = await import("./stack.ts");

        const stack = await startHostedLocalDevStack({
          env: process.env,
          stderrTarget,
        });
        await stack.ready;
        await stack.stop();

        expect(spawnStripeListenerWithSecretCapture).toHaveBeenCalledWith(
          expect.objectContaining({
            args: [
              "listen",
              "--forward-to",
              "http://127.0.0.1:3000/api/hosted-onboarding/stripe/webhook",
            ],
            command: "stripe",
            timeoutMs: 15_000,
          }),
        );
        expect(spawnChildProcess).toHaveBeenCalledWith(
          "web",
          "pnpm",
          expect.any(Array),
          expect.objectContaining({
            STRIPE_WEBHOOK_SECRET: "whsec_captured_abc123",
          }),
          expect.any(Object),
        );
        expect(stack.processes.stripe).toBe(listenerChild);
      });
    });

    it("preserves a shell-provided STRIPE_WEBHOOK_SECRET over the captured value", async () => {
      const stderrTarget = new CapturingWritable();
      spawnStripeListenerWithSecretCapture.mockResolvedValueOnce({
        child: createBufferedChild({ exitCode: null, name: "stripe", pid: 912 }),
        secret: "whsec_captured_zzz",
      });
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_shell_override");

      await withListenerConfig({}, async () => {
        const { startHostedLocalDevStack } = await import("./stack.ts");

        const stack = await startHostedLocalDevStack({
          env: process.env,
          stderrTarget,
        });
        await stack.ready;
        await stack.stop();

        expect(spawnChildProcess).toHaveBeenCalledWith(
          "web",
          "pnpm",
          expect.any(Array),
          expect.objectContaining({
            STRIPE_WEBHOOK_SECRET: "whsec_shell_override",
          }),
          expect.any(Object),
        );
        expect(stderrTarget.text()).toContain("does not match the listener");
      });
    });

    it("discards a pulled-only STRIPE_WEBHOOK_SECRET in favor of the captured value", async () => {
      const stderrTarget = new CapturingWritable();
      spawnStripeListenerWithSecretCapture.mockResolvedValueOnce({
        child: createBufferedChild({ exitCode: null, name: "stripe", pid: 913 }),
        secret: "whsec_captured_fresh",
      });
      const environmentModule = await import("./environment.ts");
      vi.mocked(environmentModule.readSimpleEnvFile).mockResolvedValueOnce({
        STRIPE_WEBHOOK_SECRET: "whsec_stale_from_vercel",
      });

      await withListenerConfig({}, async () => {
        const { startHostedLocalDevStack } = await import("./stack.ts");

        const stack = await startHostedLocalDevStack({
          env: process.env,
          stderrTarget,
        });
        await stack.ready;
        await stack.stop();

        expect(spawnChildProcess).toHaveBeenCalledWith(
          "web",
          "pnpm",
          expect.any(Array),
          expect.objectContaining({
            STRIPE_WEBHOOK_SECRET: "whsec_captured_fresh",
          }),
          expect.any(Object),
        );
      });
    });

    it("skips the listener when MURPH_DEV_SKIP_WEB=1 is set", async () => {
      await withListenerConfig({ skipWeb: true }, async () => {
        const { startHostedLocalDevStack } = await import("./stack.ts");

        const stack = await startHostedLocalDevStack({
          env: process.env,
        });
        await stack.ready;
        await stack.stop();

        expect(spawnStripeListenerWithSecretCapture).not.toHaveBeenCalled();
        expect(stack.processes.stripe).toBeNull();
      });
    });

    it("skips the listener when MURPH_DEV_SKIP_STRIPE_LISTEN=1 is set", async () => {
      // default config already has skipStripeListen: true
      const { startHostedLocalDevStack } = await import("./stack.ts");

      const stack = await startHostedLocalDevStack({
        env: process.env,
      });
      await stack.ready;
      await stack.stop();

      expect(spawnStripeListenerWithSecretCapture).not.toHaveBeenCalled();
      expect(stack.processes.stripe).toBeNull();
    });

    it("does not participate in waitForFirstChildExit when the listener dies after ready", async () => {
      const stderrTarget = new CapturingWritable();
      const listenerChild = createBufferedChild({
        exitCode: null,
        name: "stripe",
        pid: 914,
      });
      let recordedExitHandler:
        | ((code: number | null, signal: NodeJS.Signals | null) => void)
        | null = null;
      const onceMock = vi.mocked(listenerChild.child.once);
      onceMock.mockImplementation(
        function (this: typeof listenerChild.child, event, handler) {
          if (event === "exit") {
            recordedExitHandler = handler;
          }
          return this;
        },
      );
      spawnStripeListenerWithSecretCapture.mockResolvedValueOnce({
        child: listenerChild,
        secret: "whsec_captured_post_ready",
      });

      await withListenerConfig({}, async () => {
        const { startHostedLocalDevStack } = await import("./stack.ts");

        const stack = await startHostedLocalDevStack({
          env: process.env,
          stderrTarget,
        });
        await stack.ready;

        expect(waitForFirstChildExit).toHaveBeenCalledTimes(1);
        const firstCallArgs = waitForFirstChildExit.mock.calls[0];
        const watchedChildren = firstCallArgs?.[0] ?? [];
        expect(
          watchedChildren.some(
            (entry: BufferedNamedChildProcess) => entry.name === "stripe",
          ),
        ).toBe(false);

        // Simulate post-ready listener exit
        recordedExitHandler?.(1, "SIGTERM");
        const writes = stderrTarget.text();
        expect(writes).toContain("listener exited");
        expect(writes).toContain("Restart `pnpm dev`");

        await stack.stop();
      });
    });
  });
});
