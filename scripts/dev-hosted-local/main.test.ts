import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostedLocalDevConfig, NamedChildProcess } from "./types.ts";

const defaultConfig: HostedLocalDevConfig = {
  skipPrismaMigrate: false,
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
const terminateChildProcess = vi.fn();
const waitForFirstChildExit = vi.fn<() => Promise<NamedChildProcess>>();
const waitForHealthyHttpEndpoint = vi.fn(async () => {});

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async () => "/tmp/murph-dev-env-test"),
  rm: vi.fn(async () => {}),
}));

vi.mock("./config.ts", () => ({
  resolveHostedLocalDevConfig: vi.fn(() => defaultConfig),
}));

vi.mock("./environment.ts", () => ({
  buildHostedLocalDevOverrides: vi.fn(() => ({
    HOSTED_WEB_BASE_URL: "http://127.0.0.1:3000",
  })),
  buildWranglerVarArgs: vi.fn(() => ["--var", "HOSTED_WEB_BASE_URL:http://127.0.0.1:3000"]),
  readSimpleEnvFile: vi.fn(async () => ({})),
  requireEnvValue: vi.fn(),
  resolveCloudflareLocalEnv: vi.fn(async () => ({
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
  })),
  warnForMissingEnv: vi.fn(),
}));

vi.mock("./runtime.ts", () => ({
  assertHostedWebDevServerAvailable: vi.fn(async () => {}),
  assertPortAvailable: vi.fn(async () => {}),
  runCommand,
  spawnChildProcess,
  terminateChildProcess,
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
  });

  it("starts Cloudflare through the prepared app-owned dev entrypoint", async () => {
    const cloudflareChild = {
      child: {
        exitCode: null,
        pid: 101,
      },
      name: "cloudflare" as const,
    } satisfies NamedChildProcess;
    const webChild = {
      child: {
        exitCode: 0,
        pid: 102,
      },
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
        "--local-protocol",
        "http",
        "--persist-to",
        ".wrangler/state/dev-root",
        "--var",
        "HOSTED_WEB_BASE_URL:http://127.0.0.1:3000",
      ],
      expect.objectContaining({
        HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
        VERCEL_OIDC_TOKEN: "oidc-token",
      }),
    );
    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "prisma:generate"],
      expect.any(Object),
    );
    expect(terminateChildProcess).toHaveBeenCalledTimes(2);
    expect(waitForHealthyHttpEndpoint).toHaveBeenCalledTimes(2);
  });
});
