import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedLocalChildProcess,
  HostedLocalDevConfig,
  NamedChildProcess,
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
const spawnChildProcess = vi.fn<(name: "cloudflare" | "web", command: string, args: string[], env: NodeJS.ProcessEnv) => NamedChildProcess>();
const terminateChildProcessAndWait = vi.fn(async () => {});
const waitForFirstChildExit = vi.fn<() => Promise<NamedChildProcess>>();
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
    HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "local-loopback-token",
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

describe("hosted local dev main", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("starts Cloudflare through the prepared app-owned dev entrypoint", async () => {
    const createChild = (input: {
      exitCode: number | null;
      pid: number;
    }): HostedLocalChildProcess => ({
      exitCode: input.exitCode,
      kill: vi.fn(() => true),
      once: vi.fn(function once(this: HostedLocalChildProcess) {
        return this;
      }),
      pid: input.pid,
    });
    const cloudflareChild = {
      child: createChild({ exitCode: null, pid: 101 }),
      name: "cloudflare" as const,
    } satisfies NamedChildProcess;
    const webChild = {
      child: createChild({ exitCode: 0, pid: 102 }),
      name: "web" as const,
    } satisfies NamedChildProcess;

    spawnChildProcess
      .mockReturnValueOnce(cloudflareChild)
      .mockReturnValueOnce(webChild);
    waitForFirstChildExit.mockResolvedValue(webChild);

    const { main } = await import("./main.ts");

    await main();

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
        HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "local-loopback-token",
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
        HOSTED_ASSISTANT_PROVIDER: "venice",
        TSX_TSCONFIG_PATH: expect.stringMatching(/tsconfig\.base\.json$/),
        VERCEL_OIDC_TOKEN: "oidc-token",
      }),
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
  });

  it("uses the Docker bridge gateway as the worker bridge host on Linux", async () => {
    const createChild = (input: {
      exitCode: number | null;
      pid: number;
    }): HostedLocalChildProcess => ({
      exitCode: input.exitCode,
      kill: vi.fn(() => true),
      once: vi.fn(function once(this: HostedLocalChildProcess) {
        return this;
      }),
      pid: input.pid,
    });
    const cloudflareChild = {
      child: createChild({ exitCode: null, pid: 151 }),
      name: "cloudflare" as const,
    } satisfies NamedChildProcess;
    const webChild = {
      child: createChild({ exitCode: 0, pid: 152 }),
      name: "web" as const,
    } satisfies NamedChildProcess;

    spawnChildProcess
      .mockReturnValueOnce(cloudflareChild)
      .mockReturnValueOnce(webChild);
    waitForFirstChildExit.mockResolvedValue(webChild);
    spawnSync.mockReturnValueOnce({
      error: undefined,
      status: 0,
      stdout: "172.17.0.1\n",
    });
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    const { main } = await import("./main.ts");

    await main();

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
        HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "local-loopback-token",
      }),
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

    const { main } = await import("./main.ts");

    await expect(main()).rejects.toThrow(
      "Hosted local dev on Linux could not resolve a container-reachable worker host.",
    );
    expect(spawnChildProcess).not.toHaveBeenCalled();
    platformSpy.mockRestore();
  });

  it("can start only the worker lane for focused hosted runtime debugging", async () => {
    const createChild = (input: {
      exitCode: number | null;
      pid: number;
    }): HostedLocalChildProcess => ({
      exitCode: input.exitCode,
      kill: vi.fn(() => true),
      once: vi.fn(function once(this: HostedLocalChildProcess) {
        return this;
      }),
      pid: input.pid,
    });
    const cloudflareChild = {
      child: createChild({ exitCode: 0, pid: 401 }),
      name: "cloudflare" as const,
    } satisfies NamedChildProcess;

    const configModule = await import("./config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      skipWeb: true,
    });
    spawnChildProcess.mockReturnValueOnce(cloudflareChild);
    waitForFirstChildExit.mockResolvedValue(cloudflareChild);

    const { main } = await import("./main.ts");

    await main();

    expect(spawnChildProcess).toHaveBeenCalledTimes(1);
    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.any(Array),
      expect.any(Object),
    );
    expect(waitForHealthyHttpEndpoint).toHaveBeenCalledTimes(1);
    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(1);
  });

  it("skips Vercel link and env pull when the caller already provides a Vercel OIDC token", async () => {
    const createChild = (input: {
      exitCode: number | null;
      pid: number;
    }): HostedLocalChildProcess => ({
      exitCode: input.exitCode,
      kill: vi.fn(() => true),
      once: vi.fn(function once(this: HostedLocalChildProcess) {
        return this;
      }),
      pid: input.pid,
    });
    const cloudflareChild = {
      child: createChild({ exitCode: 0, pid: 451 }),
      name: "cloudflare" as const,
    } satisfies NamedChildProcess;

    const configModule = await import("./config.ts");
    const vercelModule = await import("./vercel.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      skipPrismaMigrate: true,
      skipWeb: true,
    });
    spawnChildProcess.mockReturnValueOnce(cloudflareChild);
    waitForFirstChildExit.mockResolvedValue(cloudflareChild);
    vi.stubEnv("VERCEL_OIDC_TOKEN", "provided-oidc-token");

    const { main } = await import("./main.ts");

    await main();

    expect(vi.mocked(vercelModule.ensureVercelLinkExists)).not.toHaveBeenCalled();
    const sawVercelSetup = (runCommand.mock.calls as unknown[][])
      .some((call) => call[0] === "vercel");
    expect(sawVercelSetup).toBe(false);
  });

  it("emits the structured ready token when the caller requests it", async () => {
    const createChild = (input: {
      exitCode: number | null;
      pid: number;
    }): HostedLocalChildProcess => ({
      exitCode: input.exitCode,
      kill: vi.fn(() => true),
      once: vi.fn(function once(this: HostedLocalChildProcess) {
        return this;
      }),
      pid: input.pid,
    });
    const cloudflareChild = {
      child: createChild({ exitCode: null, pid: 501 }),
      name: "cloudflare" as const,
    } satisfies NamedChildProcess;
    const webChild = {
      child: createChild({ exitCode: 0, pid: 502 }),
      name: "web" as const,
    } satisfies NamedChildProcess;
    const readyToken = "token-ready-for-tests";
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    spawnChildProcess
      .mockReturnValueOnce(cloudflareChild)
      .mockReturnValueOnce(webChild);
    waitForFirstChildExit.mockResolvedValue(webChild);
    vi.stubEnv("MURPH_DEV_READY_TOKEN", readyToken);

    const { main } = await import("./main.ts");

    await main();

    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining(`__MURPH_HOSTED_LOCAL_READY__ ${readyToken}`),
    );
    stdoutWrite.mockRestore();
  });

  it("reuses a caller-provided temp dir for generated local worker inputs", async () => {
    const createChild = (input: {
      exitCode: number | null;
      pid: number;
    }): HostedLocalChildProcess => ({
      exitCode: input.exitCode,
      kill: vi.fn(() => true),
      once: vi.fn(function once(this: HostedLocalChildProcess) {
        return this;
      }),
      pid: input.pid,
    });
    const cloudflareChild = {
      child: createChild({ exitCode: null, pid: 201 }),
      name: "cloudflare" as const,
    } satisfies NamedChildProcess;
    const webChild = {
      child: createChild({ exitCode: 0, pid: 202 }),
      name: "web" as const,
    } satisfies NamedChildProcess;

    spawnChildProcess
      .mockReturnValueOnce(cloudflareChild)
      .mockReturnValueOnce(webChild);
    waitForFirstChildExit.mockResolvedValue(webChild);
    vi.stubEnv("MURPH_DEV_TEMP_DIR", ".tmp/local-dev-debug");

    const { main } = await import("./main.ts");

    await main();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.arrayContaining([
        "--env-file",
        expect.stringContaining(".tmp/local-dev-debug/cloudflare-worker.env"),
      ]),
      expect.any(Object),
    );
  });

  it("rejects temp dir overrides outside the repo-local .tmp subtree", async () => {
    vi.stubEnv("MURPH_DEV_TEMP_DIR", "../unsafe-temp-dir");

    const { main } = await import("./main.ts");

    await expect(main()).rejects.toThrow(
      "MURPH_DEV_TEMP_DIR must resolve inside the repo-local .tmp directory.",
    );
  });

  it("lets explicit shell env override pulled Vercel env for hosted worker config", async () => {
    const createChild = (input: {
      exitCode: number | null;
      pid: number;
    }): HostedLocalChildProcess => ({
      exitCode: input.exitCode,
      kill: vi.fn(() => true),
      once: vi.fn(function once(this: HostedLocalChildProcess) {
        return this;
      }),
      pid: input.pid,
    });
    const cloudflareChild = {
      child: createChild({ exitCode: null, pid: 301 }),
      name: "cloudflare" as const,
    } satisfies NamedChildProcess;
    const webChild = {
      child: createChild({ exitCode: 0, pid: 302 }),
      name: "web" as const,
    } satisfies NamedChildProcess;

    spawnChildProcess
      .mockReturnValueOnce(cloudflareChild)
      .mockReturnValueOnce(webChild);
    waitForFirstChildExit.mockResolvedValue(webChild);

    vi.stubEnv("HOSTED_ASSISTANT_PROVIDER", "openai");
    vi.stubEnv("HOSTED_ASSISTANT_MODEL", "gpt-4.1-mini");

    const environmentModule = await import("./environment.ts");

    vi.mocked(environmentModule.readSimpleEnvFile).mockResolvedValueOnce({
      HOSTED_ASSISTANT_MODEL: "stale-pulled-model",
      HOSTED_ASSISTANT_PROVIDER: "venice",
    });

    const { main } = await import("./main.ts");

    await main();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.any(Array),
      expect.objectContaining({
        HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
        HOSTED_ASSISTANT_PROVIDER: "openai",
      }),
    );
  });

  it("passes optional Wrangler debug flags through to the Cloudflare dev worker", async () => {
    const createChild = (input: {
      exitCode: number | null;
      pid: number;
    }): HostedLocalChildProcess => ({
      exitCode: input.exitCode,
      kill: vi.fn(() => true),
      once: vi.fn(function once(this: HostedLocalChildProcess) {
        return this;
      }),
      pid: input.pid,
    });
    const cloudflareChild = {
      child: createChild({ exitCode: null, pid: 401 }),
      name: "cloudflare" as const,
    } satisfies NamedChildProcess;
    const webChild = {
      child: createChild({ exitCode: 0, pid: 402 }),
      name: "web" as const,
    } satisfies NamedChildProcess;

    spawnChildProcess
      .mockReturnValueOnce(cloudflareChild)
      .mockReturnValueOnce(webChild);
    waitForFirstChildExit.mockResolvedValue(webChild);
    vi.stubEnv("MURPH_DEV_CF_WRANGLER_LOG_LEVEL", "debug");

    const { main } = await import("./main.ts");

    await main();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.arrayContaining([
        "--log-level",
        "debug",
        "--show-interactive-dev-session=false",
      ]),
      expect.any(Object),
    );
  });
});
