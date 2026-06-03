import { Writable } from "node:stream";

import { beforeEach, describe, expect, test, vi } from "vitest";

const runForegroundCommand = vi.hoisted(() => vi.fn(async () => undefined));
const runHostedLocalE2eSuite = vi.hoisted(() =>
  vi.fn(async () => ({ terminationSignal: null as NodeJS.Signals | null })),
);
const startHostedLocalDevStack = vi.hoisted(() => vi.fn());
const terminateKnownHostedLocalProcessResidue = vi.hoisted(() => vi.fn());
const cleanupHostedRunnerContainers = vi.hoisted(() => vi.fn(async () => {}));
const resolveHostedLocalDevConfig = vi.hoisted(() =>
  vi.fn(() => ({
    linqWebhookTunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
    linqWebhookTunnelMode: "auto",
    linqWebhookTunnelName: "dev",
    skipHealthCommonsWatch: false,
    skipWeb: false,
    temporal: {
      host: "127.0.0.1",
      mode: "managed",
      namespace: "default",
      port: 7233,
      taskQueue: "murph-hosted-runtime",
    },
    webHost: "localhost",
    webPort: 3000,
    workerHost: "127.0.0.1",
    workerPort: 8787,
  })),
);
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

vi.mock("../src/process.ts", () => ({
  runDoctorCommand: vi.fn(),
  runForegroundCommand,
}));

vi.mock("../src/dev-hosted-local/stack.ts", () => ({
  startHostedLocalDevStack,
  terminateKnownHostedLocalProcessResidue,
}));

vi.mock("../src/dev-hosted-local/runtime.ts", () => ({
  cleanupHostedRunnerContainers,
}));

vi.mock("../src/dev-hosted-local/config.ts", () => ({
  resolveHostedLocalDevConfig,
}));

vi.mock("../src/e2e.ts", async (importActual) => {
  const actual = await importActual<typeof import("../src/e2e.ts")>();
  return {
    ...actual,
    runHostedLocalE2eSuite,
  };
});

vi.mock("../src/state.ts", () => ({
  applyHostedLocalStateEnv: ({ env }: { env: NodeJS.ProcessEnv }) => ({
    ...env,
    MURPH_HOSTED_LOCAL_STATE_PATH: ".artifacts/hosted-local/test/state.json",
  }),
  createHostedLocalHarnessState,
  updateHostedLocalHarnessState,
}));

import { runHostedLocalCli } from "../src/cli.ts";

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
    runHostedLocalE2eSuite.mockResolvedValue({ terminationSignal: null });
    startHostedLocalDevStack.mockResolvedValue(createHostedLocalStack());
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

  test("marks interrupted hosted-local e2e runs as stopped", async () => {
    runHostedLocalE2eSuite.mockResolvedValueOnce({ terminationSignal: "SIGINT" });
    const output = createBufferedStdout();

    await runHostedLocalCli(["e2e", "linq-webhook", "--no-bundle"], {
      env: {},
      stdout: output.stdout,
    });

    expect(runHostedLocalE2eSuite).toHaveBeenCalledWith(expect.objectContaining({
      prepareRunnerBundle: false,
      scenario: "linq-webhook",
    }));
    expect(updateHostedLocalHarnessState).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "running" }),
      { status: "stopped" },
    );
    expect(output.text()).toContain(
      "Hosted-local E2E stopped (SIGINT): .artifacts/hosted-local/test/state.json",
    );
    expect(output.text()).not.toContain("Hosted-local E2E complete");
  });

  test("aborts startup and stops the stack when hosted-local up is interrupted before the stack returns", async () => {
    let resolveStart!: (stack: ReturnType<typeof createHostedLocalStack>) => void;
    let startupSignal: AbortSignal | undefined;
    startHostedLocalDevStack.mockImplementationOnce(async (input: { abortSignal?: AbortSignal }) => {
      startupSignal = input.abortSignal;
      return await new Promise<ReturnType<typeof createHostedLocalStack>>((resolve) => {
        resolveStart = resolve;
      });
    });
    const signalHandlers = new Map<string, () => void>();
    const originalProcessOn = process.on.bind(process);
    const onSpy = vi.spyOn(process, "on").mockImplementation((
      (event: string | symbol, listener: (...args: unknown[]) => void) => {
        if (event === "SIGINT" || event === "SIGTERM") {
          signalHandlers.set(event, () => listener(event));
          return process;
        }

        return originalProcessOn(event, listener);
      }
    ) as typeof process.on);
    const offSpy = vi.spyOn(process, "off").mockImplementation((
      (_event: string | symbol, _listener: (...args: unknown[]) => void) => process
    ) as typeof process.off);
    const output = createBufferedStdout();
    const stack = createHostedLocalStack();

    try {
      const runPromise = runHostedLocalCli(["up"], {
        env: {},
        stderr: output.stdout,
        stdout: output.stdout,
      });
      await vi.waitFor(() => {
        expect(startHostedLocalDevStack).toHaveBeenCalledTimes(1);
      });

      signalHandlers.get("SIGINT")?.();
      signalHandlers.get("SIGTERM")?.();
      await Promise.resolve();

      expect(startupSignal?.aborted).toBe(true);
      expect(terminateKnownHostedLocalProcessResidue).not.toHaveBeenCalled();
      expect(cleanupHostedRunnerContainers).not.toHaveBeenCalled();

      resolveStart(stack);
      await runPromise;

      expect(output.text().match(/Stopping hosted-local harness/g)?.length).toBe(1);
      expect(stack.kill).toHaveBeenCalledWith("SIGINT");
      expect(stack.kill).toHaveBeenCalledTimes(1);
      expect(stack.stop).toHaveBeenCalledWith("SIGINT");
      expect(stack.stop).toHaveBeenCalledTimes(1);
      expect(updateHostedLocalHarnessState).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "starting" }),
        { status: "stopped" },
      );
      expect(offSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith("exit", expect.any(Function));
      expect(output.text()).toContain("Stopping hosted-local harness (SIGINT).");
    } finally {
      onSpy.mockRestore();
      offSpy.mockRestore();
    }
  });

  test("does not publish ready state when termination arrives while readiness is pending", async () => {
    let resolveReady!: () => void;
    const stack = createHostedLocalStack({
      ready: new Promise<void>((resolve) => {
        resolveReady = resolve;
      }),
    });
    startHostedLocalDevStack.mockResolvedValueOnce(stack);
    const signalHandlers = new Map<string, () => void>();
    const originalProcessOn = process.on.bind(process);
    const onSpy = vi.spyOn(process, "on").mockImplementation((
      (event: string | symbol, listener: (...args: unknown[]) => void) => {
        if (event === "SIGINT" || event === "SIGTERM") {
          signalHandlers.set(event, () => listener(event));
          return process;
        }

        return originalProcessOn(event, listener);
      }
    ) as typeof process.on);
    const offSpy = vi.spyOn(process, "off").mockImplementation((
      (_event: string | symbol, _listener: (...args: unknown[]) => void) => process
    ) as typeof process.off);
    const output = createBufferedStdout();

    try {
      const runPromise = runHostedLocalCli(["up"], {
        env: {},
        stderr: output.stdout,
        stdout: output.stdout,
      });
      await vi.waitFor(() => {
        expect(startHostedLocalDevStack).toHaveBeenCalledTimes(1);
      });

      signalHandlers.get("SIGTERM")?.();
      resolveReady();
      await runPromise;

      expect(stack.kill).toHaveBeenCalledWith("SIGTERM");
      expect(stack.stop).toHaveBeenCalledWith("SIGTERM");
      expect(updateHostedLocalHarnessState).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "starting" }),
        { status: "stopped" },
      );
      expect(output.text()).not.toContain("Hosted-local harness is ready.");
      expect(offSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith("exit", expect.any(Function));
    } finally {
      onSpy.mockRestore();
      offSpy.mockRestore();
    }
  });
});

function createHostedLocalStack(input: { ready?: Promise<void> } = {}) {
  return {
    kill: vi.fn(),
    ready: input.ready ?? Promise.resolve(),
    stop: vi.fn(async () => {}),
    waitForExit: vi.fn(async () => ({
      child: {
        exitCode: 0,
      },
      name: "cloudflare" as const,
    })),
    webBaseUrl: "http://localhost:3000",
    workerBaseUrl: "http://127.0.0.1:8787",
  };
}
