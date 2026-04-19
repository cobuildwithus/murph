import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BufferedNamedChildProcess,
  HostedLocalChildProcess,
  HostedLocalDevConfig,
} from "./types.ts";

const defaultConfig: HostedLocalDevConfig = {
  skipPrismaMigrate: false,
  skipWeb: false,
  skipVercelPull: false,
  webHost: "127.0.0.1",
  webPort: 3000,
  workerHost: "127.0.0.1",
  workerPersistDir: ".wrangler/state/dev-root",
  workerPort: 8787,
  workerProtocol: "http",
};

const runCommand = vi.fn(async () => {});
const spawnChildProcess = vi.fn<
  (
    name: "cloudflare" | "web",
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    input?: {
      pipeOutput?: boolean;
      stderrTarget?: NodeJS.WriteStream;
      stdoutTarget?: NodeJS.WriteStream;
    },
  ) => BufferedNamedChildProcess
>();
const terminateChildProcessAndWait = vi.fn(async () => {});
const waitForHealthyHttpEndpoint = vi.fn(async () => {});
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
  terminateChildProcessAndWait,
  waitForFirstChildExit: vi.fn(),
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
  name: "cloudflare" | "web";
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
    const sawVercelSetup = (runCommand.mock.calls as unknown[][])
      .some((call) => call[0] === "vercel");
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
});
