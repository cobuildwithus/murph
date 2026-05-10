import { Writable } from "node:stream";

import { beforeEach, describe, expect, test, vi } from "vitest";

const runForegroundCommand = vi.hoisted(() => vi.fn(async () => undefined));
const createHostedLocalHarnessState = vi.hoisted(() =>
  vi.fn(async () => ({
    statePath: ".artifacts/hosted-local/test/state.json",
    status: "running",
  })),
);
const updateHostedLocalHarnessState = vi.hoisted(() =>
  vi.fn(async (state: Record<string, unknown>, patch: Record<string, unknown>) => ({
    ...state,
    ...patch,
  })),
);

vi.mock("../packages/hosted-local-harness/src/process.ts", () => ({
  runDoctorCommand: vi.fn(),
  runForegroundCommand,
}));

vi.mock("../packages/hosted-local-harness/src/state.ts", () => ({
  applyHostedLocalStateEnv: ({ env }: { env: NodeJS.ProcessEnv }) => ({
    ...env,
    MURPH_HOSTED_LOCAL_STATE_PATH: ".artifacts/hosted-local/test/state.json",
  }),
  createHostedLocalHarnessState,
  updateHostedLocalHarnessState,
}));

import { runHostedLocalCli } from "../packages/hosted-local-harness/src/cli.ts";

function createBufferedStdout(): { stdout: Writable; text: () => string } {
  const chunks: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });

  return {
    stdout,
    text: () => chunks.join(""),
  };
}

describe("hosted-local run CLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("passes child command flags after the separator through unchanged", async () => {
    const output = createBufferedStdout();

    await runHostedLocalCli(
      [
        "run",
        "--profile",
        "worker-only",
        "--",
        "node",
        "child.js",
        "--profile",
        "child",
        "--help",
      ],
      {
        env: {},
        stdout: output.stdout,
      },
    );

    expect(runForegroundCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["child.js", "--profile", "child", "--help"],
        command: "node",
        env: expect.objectContaining({
          MURPH_HOSTED_LOCAL_PROFILE: "worker-only",
        }),
      }),
    );
    expect(output.text()).toContain("Hosted-local command complete: .artifacts/hosted-local/test/state.json");
  });
});
