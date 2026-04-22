import { afterEach, expect, it, vi } from "vitest";

import type { HostedLocalDevConfig } from "../../../../scripts/dev-hosted-local/types.ts";

const hostedLocalDevConfig: HostedLocalDevConfig = {
  skipPrismaMigrate: true,
  skipStripeListen: true,
  skipWeb: false,
  skipVercelPull: true,
  webHost: "127.0.0.1",
  webPort: 3000,
  workerHost: "127.0.0.1",
  workerPersistDir: ".wrangler/state/dev-root",
  workerPort: 8787,
  workerProtocol: "http",
};

const stopHostedLocalDevStack = vi.fn(async () => {});
const startHostedLocalDevStack = vi.fn(async () => ({
  config: hostedLocalDevConfig,
  oidcIdentity: {
    environment: "development" as const,
    projectName: "murph",
    teamSlug: "local",
  },
  oidcToken: "oidc-token",
  processes: {
    cloudflare: null,
    web: null,
  },
  ready: Promise.resolve(),
  stop: stopHostedLocalDevStack,
  stderrTail: () => "",
  stdoutTail: () => "",
  waitForExit: vi.fn(),
  webBaseUrl: "http://127.0.0.1:3000",
  workerBaseUrl: "http://127.0.0.1:8787",
}));

vi.mock("../../../../scripts/dev-hosted-local/config.ts", () => ({
  resolveHostedLocalDevConfig: vi.fn(() => hostedLocalDevConfig),
}));

vi.mock("../../../../scripts/dev-hosted-local/stack.ts", () => ({
  startHostedLocalDevStack,
}));

afterEach(() => {
  vi.clearAllMocks();
});

it("passes the harness process pid to hosted web dev for orphan cleanup", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");

  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
  });

  await harness.stop();

  expect(startHostedLocalDevStack).toHaveBeenCalledWith({
    env: expect.objectContaining({
      MURPH_HOSTED_WEB_DEV_OWNER_PID: String(process.pid),
      NEXT_DIST_DIR_MODE: "smoke",
      NEXT_DIST_DIR_SUFFIX: expect.stringMatching(/^e2e-[a-f0-9-]+$/),
    }),
    pipeOutput: false,
  });
});
