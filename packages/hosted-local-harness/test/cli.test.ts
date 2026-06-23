import { Writable } from "node:stream";

import { beforeEach, describe, expect, test, vi } from "vitest";

const runDoctorCommand = vi.hoisted(() =>
  vi.fn((command: string, args: readonly string[]) => ({
    command: [command, ...args].join(" "),
    ok: true,
    stderr: "",
    stdout: "",
  })),
);
const runForegroundCommand = vi.hoisted(() => vi.fn(async () => undefined));
const runHostedLocalE2eSuite = vi.hoisted(() =>
  vi.fn(async () => ({ terminationSignal: null as NodeJS.Signals | null })),
);
const startHostedLocalDevStack = vi.hoisted(() => vi.fn());
const terminateKnownHostedLocalProcessResidue = vi.hoisted(() => vi.fn());
const cleanupHostedRunnerContainers = vi.hoisted(() => vi.fn(async () => {}));
const ensureHostedLocalWorktreeDatabase = vi.hoisted(() =>
  vi.fn(async () => ({ created: false })),
);
const formatHostedLocalWorktreeEnv = vi.hoisted(() =>
  vi.fn(() => "export MURPH_DEV_DATABASE_URL='[redacted]'\n"),
);
const removeCreatedHostedLocalWorktreeDatabaseIfUnpaired = vi.hoisted(() =>
  vi.fn(async () => ({ removed: false, unpaired: false })),
);
const resolveHostedLocalWorktreeConfig = vi.hoisted(() =>
  vi.fn(async () => createHostedLocalWorktreeConfig()),
);
const resolveHostedLocalDevConfig = vi.hoisted(() =>
  vi.fn(() => ({
    linqWebhookTunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
    linqWebhookRegistrationCachePath: ".tmp/linq-webhook-registration.json",
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
    workerPersistDir: ".wrangler/state/dev-root",
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
  runDoctorCommand,
  runForegroundCommand,
}));

vi.mock("../src/dev-hosted-local/stack.ts", () => ({
  startHostedLocalDevStack,
  terminateKnownHostedLocalProcessResidue,
}));

vi.mock("../src/dev-hosted-local/runtime.ts", () => ({
  cleanupHostedRunnerContainers,
}));

vi.mock("../src/dev-hosted-local/worktree.ts", () => ({
  ensureHostedLocalWorktreeDatabase,
  formatHostedLocalWorktreeEnv,
  removeCreatedHostedLocalWorktreeDatabaseIfUnpaired,
  resolveHostedLocalWorktreeConfig,
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
    ensureHostedLocalWorktreeDatabase.mockResolvedValue({ created: false });
    removeCreatedHostedLocalWorktreeDatabaseIfUnpaired.mockResolvedValue({
      removed: false,
      unpaired: false,
    });
    resolveHostedLocalWorktreeConfig.mockResolvedValue(createHostedLocalWorktreeConfig());
    formatHostedLocalWorktreeEnv.mockReturnValue("export MURPH_DEV_DATABASE_URL='[redacted]'\n");
    runDoctorCommand.mockImplementation((command: string, args: readonly string[]) => ({
      command: [command, ...args].join(" "),
      ok: true,
      stderr: "",
      stdout: "",
    }));
  });

  test("prints top-level command help and profiles", async () => {
    const output = createBufferedStdout();

    await runHostedLocalCli([], {
      env: {},
      stdout: output.stdout,
    });
    await runHostedLocalCli(["profiles"], {
      env: {},
      stdout: output.stdout,
    });

    expect(output.text()).toContain("Run the local hosted Murph harness.");
    expect(output.text()).toContain("hosted-local worktree up <slug>");
    expect(output.text()).toContain("worktree");
    expect(output.text()).toContain("secondary git worktree");
  });

  test("prints command-specific help without resolving runtime state", async () => {
    const output = createBufferedStdout();

    await runHostedLocalCli(["up", "--help"], {
      env: {},
      stdout: output.stdout,
    });
    await runHostedLocalCli(["run", "--help"], {
      env: {},
      stdout: output.stdout,
    });
    await runHostedLocalCli(["doctor", "--help"], {
      env: {},
      stdout: output.stdout,
    });
    await runHostedLocalCli(["e2e", "--help"], {
      env: {},
      stdout: output.stdout,
    });

    expect(output.text()).toContain("Usage: hosted-local up");
    expect(output.text()).toContain("Usage: hosted-local run");
    expect(output.text()).toContain("Usage: hosted-local doctor");
    expect(output.text()).toContain("Usage: hosted-local e2e");
    expect(createHostedLocalHarnessState).not.toHaveBeenCalled();
    expect(startHostedLocalDevStack).not.toHaveBeenCalled();
  });

  test("prints worktree help without resolving config", async () => {
    const output = createBufferedStdout();

    await runHostedLocalCli(["worktree"], {
      env: {},
      stdout: output.stdout,
    });
    await runHostedLocalCli(["worktree", "up", "--help"], {
      env: {},
      stdout: output.stdout,
    });

    expect(output.text()).toContain("hosted-local worktree up <slug>");
    expect(output.text()).toContain("Slugs must use lowercase letters");
    expect(resolveHostedLocalWorktreeConfig).not.toHaveBeenCalled();
  });

  test("prints the derived worktree env without starting the stack", async () => {
    const output = createBufferedStdout();

    await runHostedLocalCli(["worktree", "env", "feature-a"], {
      env: {},
      stdout: output.stdout,
    });

    expect(resolveHostedLocalWorktreeConfig).toHaveBeenCalledWith({
      env: {},
      probePorts: false,
      slug: "feature-a",
    });
    expect(formatHostedLocalWorktreeEnv).toHaveBeenCalledWith(createHostedLocalWorktreeConfig());
    expect(output.text()).toContain("MURPH_DEV_DATABASE_URL='[redacted]'");
    expect(startHostedLocalDevStack).not.toHaveBeenCalled();
  });

  test("runs doctor with deterministic worktree env and no persisted lifecycle state", async () => {
    const output = createBufferedStdout();

    await runHostedLocalCli(["worktree", "doctor", "feature-a", "--json"], {
      env: {},
      stdout: output.stdout,
    });

    expect(resolveHostedLocalWorktreeConfig).toHaveBeenCalledWith({
      env: {},
      probePorts: false,
      slug: "feature-a",
    });
    expect(runDoctorCommand).toHaveBeenCalledWith("node", ["--version"]);
    expect(runDoctorCommand).toHaveBeenCalledWith("pnpm", ["--version"]);
    expect(runDoctorCommand).toHaveBeenCalledWith("docker", ["info"]);
    expect(runDoctorCommand).toHaveBeenCalledWith("createdb", ["--version"]);
    expect(output.text()).toContain('"name": "worktree"');
    expect(startHostedLocalDevStack).not.toHaveBeenCalled();
  });

  test("prepares worktree resources before delegating worktree up to the normal stack", async () => {
    const output = createBufferedStdout();

    await runHostedLocalCli(["worktree", "up", "feature-a"], {
      env: {},
      stdout: output.stdout,
    });

    expect(resolveHostedLocalWorktreeConfig).toHaveBeenCalledWith({
      env: {},
      slug: "feature-a",
    });
    expect(ensureHostedLocalWorktreeDatabase).toHaveBeenCalledWith(
      createHostedLocalWorktreeConfig(),
    );
    expect(startHostedLocalDevStack).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        MURPH_DEV_WEB_PORT: "3101",
        MURPH_HOSTED_LOCAL_PROFILE: "worktree",
      }),
    }));
    expect(removeCreatedHostedLocalWorktreeDatabaseIfUnpaired).not.toHaveBeenCalled();
  });

  test("removes a newly created unpaired worktree database when stack startup fails", async () => {
    ensureHostedLocalWorktreeDatabase.mockResolvedValueOnce({ created: true });
    removeCreatedHostedLocalWorktreeDatabaseIfUnpaired.mockResolvedValueOnce({
      removed: true,
      unpaired: true,
    });
    startHostedLocalDevStack.mockRejectedValueOnce(new Error("startup failed"));
    const output = createBufferedStdout();

    await expect(
      runHostedLocalCli(["worktree", "up", "feature-a"], {
        env: {},
        stderr: output.stdout,
        stdout: output.stdout,
      }),
    ).rejects.toThrow("startup failed");

    expect(removeCreatedHostedLocalWorktreeDatabaseIfUnpaired).toHaveBeenCalledWith(
      createHostedLocalWorktreeConfig(),
    );
    expect(output.text()).not.toContain("left in place");
  });

  test("checks a newly created worktree database pairing after worktree up returns", async () => {
    ensureHostedLocalWorktreeDatabase.mockResolvedValueOnce({ created: true });
    removeCreatedHostedLocalWorktreeDatabaseIfUnpaired.mockResolvedValueOnce({
      removed: false,
      unpaired: false,
    });
    const output = createBufferedStdout();

    await runHostedLocalCli(["worktree", "up", "feature-a"], {
      env: {},
      stderr: output.stdout,
      stdout: output.stdout,
    });

    expect(removeCreatedHostedLocalWorktreeDatabaseIfUnpaired).toHaveBeenCalledWith(
      createHostedLocalWorktreeConfig(),
    );
    expect(output.text()).not.toContain("left in place");
  });

  test("keeps an existing worktree database when stack startup fails", async () => {
    ensureHostedLocalWorktreeDatabase.mockResolvedValueOnce({ created: false });
    startHostedLocalDevStack.mockRejectedValueOnce(new Error("startup failed"));
    const output = createBufferedStdout();

    await expect(
      runHostedLocalCli(["worktree", "up", "feature-a"], {
        env: {},
        stderr: output.stdout,
        stdout: output.stdout,
      }),
    ).rejects.toThrow("startup failed");

    expect(removeCreatedHostedLocalWorktreeDatabaseIfUnpaired).not.toHaveBeenCalled();
    expect(output.text()).not.toContain("left in place");
  });

  test("rejects worktree down because it has no ownership-aware lifecycle", async () => {
    const output = createBufferedStdout();

    await expect(
      runHostedLocalCli(["worktree", "down", "feature-a"], {
        env: {},
        stdout: output.stdout,
      }),
    ).rejects.toThrow("Unknown hosted-local worktree command: down");

    expect(output.text()).toBe("");
  });

  test("rejects unknown worktree subcommands after printing no secrets", async () => {
    const output = createBufferedStdout();

    await expect(
      runHostedLocalCli(["worktree", "status", "feature-a"], {
        env: {},
        stdout: output.stdout,
      }),
    ).rejects.toThrow("Unknown hosted-local worktree command: status");

    expect(output.text()).toBe("");
    expect(resolveHostedLocalWorktreeConfig).not.toHaveBeenCalled();
    expect(formatHostedLocalWorktreeEnv).not.toHaveBeenCalled();
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

function createHostedLocalWorktreeConfig() {
  return {
    buildId: "worktree-feature-a",
    databaseName: "murph_dev_feature_a",
    databaseUrl: "postgresql://postgres@127.0.0.1:5432/murph_dev_feature_a",
    env: {
      MURPH_DEV_WEB_PORT: "3101",
      MURPH_HOSTED_LOCAL_PROFILE: "worktree",
    },
    paths: {},
    ports: {
      minio: 9101,
      temporal: 7301,
      web: 3101,
      worker: 8801,
    },
    profileName: "worktree",
    slug: "feature-a",
    urls: {
      webBaseUrl: "http://127.0.0.1:3101",
      workerBaseUrl: "http://127.0.0.1:8801",
    },
  };
}
