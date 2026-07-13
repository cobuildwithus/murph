import { afterEach, describe, expect, test, vi } from "vitest";

const createHostedLocalHarnessState = vi.hoisted(() =>
  vi.fn(async (input: { env: NodeJS.ProcessEnv }) => ({
    ...input,
    statePath: ".artifacts/hosted-local/test/state.json",
    status: "starting",
  })),
);
const updateHostedLocalHarnessState = vi.hoisted(() =>
  vi.fn(async (state: Record<string, unknown>, patch: Record<string, unknown>) => ({
    ...state,
    ...patch,
  })),
);
const applyHostedLocalStateEnv = vi.hoisted(() =>
  vi.fn(({ env }: { env: NodeJS.ProcessEnv }) => ({
    ...env,
    MURPH_HOSTED_LOCAL_STATE_PATH: ".artifacts/hosted-local/test/state.json",
  })),
);
const startHostedLocalDevStack = vi.hoisted(() =>
  vi.fn(async () => ({
    ready: new Promise<void>(() => {}),
    stop: vi.fn(async () => {}),
    webBaseUrl: "http://127.0.0.1:3000",
    workerBaseUrl: "http://127.0.0.1:8787",
  })),
);

vi.mock("../src/state.ts", () => ({
  applyHostedLocalStateEnv,
  createHostedLocalHarnessState,
  updateHostedLocalHarnessState,
}));

vi.mock("../src/dev-hosted-local/stack.ts", () => ({
  startHostedLocalDevStack,
}));

import { startHostedLocalHarness } from "../src/harness.ts";

describe("hosted-local programmatic harness authority", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  test("scrubs inherited web session authority before profile, state, and stack setup", async () => {
    const authority = "web-session-authority";
    vi.stubEnv("HOSTED_APP_SESSION_HMAC_KEY", authority);

    const harness = await startHostedLocalHarness({
      env: {
        HOSTED_APP_SESSION_HMAC_KEY: authority,
        MURPH_HOSTED_LOCAL_PROFILE: "worker-only",
      },
    });

    expect(process.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    expect(harness.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    expect(createHostedLocalHarnessState.mock.calls[0]?.[0].env)
      .not.toHaveProperty("HOSTED_APP_SESSION_HMAC_KEY");
    expect(applyHostedLocalStateEnv.mock.calls[0]?.[0].env)
      .not.toHaveProperty("HOSTED_APP_SESSION_HMAC_KEY");
    expect(startHostedLocalDevStack.mock.calls[0]?.[0].env)
      .not.toHaveProperty("HOSTED_APP_SESSION_HMAC_KEY");
  });
});
