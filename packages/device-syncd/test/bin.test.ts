import assert from "node:assert/strict";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import { afterEach, beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const service = {
    start: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
  };
  const server = {
    close: vi.fn(async () => {}),
  };

  return {
    service,
    server,
    loadDeviceSyncEnvironment: vi.fn((_env: NodeJS.ProcessEnv | undefined = process.env) => ({
      service: { vaultRoot: "/tmp/device-syncd-vault" },
      http: { host: "127.0.0.1", port: 43110 },
    })),
    createDeviceSyncService: vi.fn(() => service),
    startDeviceSyncHttpServer: vi.fn(async () => server),
    formatDeviceSyncStartupError: vi.fn((error: unknown) => String(error)),
  };
});

vi.mock("../src/config.ts", () => ({
  loadDeviceSyncEnvironment: mocks.loadDeviceSyncEnvironment,
}));

vi.mock("../src/service.ts", () => ({
  createDeviceSyncService: mocks.createDeviceSyncService,
}));

vi.mock("../src/http.ts", () => ({
  startDeviceSyncHttpServer: mocks.startDeviceSyncHttpServer,
}));

vi.mock("../src/errors.ts", () => ({
  formatDeviceSyncStartupError: mocks.formatDeviceSyncStartupError,
}));

async function loadDeviceSyncBin(): Promise<void> {
  await import("../src/bin.ts");
  await waitForImmediate();
}

async function triggerSignal(signalHandlers: Map<string, () => void>, signal: string): Promise<void> {
  signalHandlers.get(signal)?.();
  await waitForImmediate();
}

function assertShutdown(exitSpy: ReturnType<typeof vi.spyOn>): void {
  assert.equal(mocks.service.stop.mock.calls.length, 1);
  assert.equal(mocks.server.close.mock.calls.length, 1);
  assert.equal(mocks.service.close.mock.calls.length, 1);
  assert.deepEqual(exitSpy.mock.calls, [[0]]);
}

function mockProcessSignals() {
  const signalHandlers = new Map<string, () => void>();
  const onceSpy = vi.spyOn(process, "once").mockImplementation(((event: Parameters<typeof process.once>[0], listener: Parameters<typeof process.once>[1]) => {
    signalHandlers.set(String(event), listener as () => void);
    return process;
  }) as typeof process.once);
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    return code as never;
  }) as typeof process.exit);

  return { exitSpy, onceSpy, signalHandlers };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.loadDeviceSyncEnvironment.mockImplementation(() => ({
    service: { vaultRoot: "/tmp/device-syncd-vault" },
    http: { host: "127.0.0.1", port: 43110 },
  }));
  mocks.createDeviceSyncService.mockImplementation(() => mocks.service);
  mocks.startDeviceSyncHttpServer.mockImplementation(async () => mocks.server);
  mocks.formatDeviceSyncStartupError.mockImplementation((error: unknown) => String(error));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

test("device-syncd bin boots the service and shuts it down on SIGINT", async () => {
  const { exitSpy, onceSpy, signalHandlers } = mockProcessSignals();

  await loadDeviceSyncBin();

  const loadEnvironmentCall = mocks.loadDeviceSyncEnvironment.mock.calls[0];
  assert.ok(loadEnvironmentCall);
  assert.equal(loadEnvironmentCall[0], process.env);
  assert.equal(mocks.service.start.mock.calls.length, 1);
  assert.equal(onceSpy.mock.calls.length, 2);
  assert.equal(typeof signalHandlers.get("SIGINT"), "function");
  assert.equal(typeof signalHandlers.get("SIGTERM"), "function");

  await triggerSignal(signalHandlers, "SIGINT");
  assertShutdown(exitSpy);
});

test("device-syncd bin shuts down on SIGTERM", async () => {
  const { exitSpy, signalHandlers } = mockProcessSignals();

  await loadDeviceSyncBin();

  await triggerSignal(signalHandlers, "SIGTERM");
  assertShutdown(exitSpy);
});

test("device-syncd bin formats startup failures and sets process exit code", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    mocks.loadDeviceSyncEnvironment.mockImplementationOnce(() => {
      throw new Error("startup failed");
    });
    mocks.formatDeviceSyncStartupError.mockImplementationOnce((error: unknown) =>
      error instanceof Error ? `formatted: ${error.message}` : "formatted",
    );

    await loadDeviceSyncBin();

    assert.deepEqual(consoleErrorSpy.mock.calls, [["formatted: startup failed"]]);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("device-syncd bin closes the service when HTTP startup fails", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    mocks.startDeviceSyncHttpServer.mockRejectedValueOnce(new Error("bind failed"));
    mocks.formatDeviceSyncStartupError.mockImplementationOnce((error: unknown) =>
      error instanceof Error ? `formatted: ${error.message}` : "formatted",
    );

    await loadDeviceSyncBin();

    assert.equal(mocks.service.start.mock.calls.length, 0);
    assert.equal(mocks.service.close.mock.calls.length, 1);
    assert.deepEqual(consoleErrorSpy.mock.calls, [["formatted: bind failed"]]);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("device-syncd bin closes the started server when service.start throws", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    mocks.service.start.mockImplementationOnce(() => {
      throw new Error("service start failed");
    });
    mocks.formatDeviceSyncStartupError.mockImplementationOnce((error: unknown) =>
      error instanceof Error ? `formatted: ${error.message}` : "formatted",
    );

    await loadDeviceSyncBin();

    assert.equal(mocks.server.close.mock.calls.length, 1);
    assert.equal(mocks.service.close.mock.calls.length, 1);
    assert.deepEqual(consoleErrorSpy.mock.calls, [["formatted: service start failed"]]);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("device-syncd bin preserves rollback failures when service.start throws after HTTP startup", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    mocks.service.start.mockImplementationOnce(() => {
      throw new Error("service start failed");
    });
    mocks.server.close.mockRejectedValueOnce(new Error("rollback close failed"));
    mocks.formatDeviceSyncStartupError.mockImplementationOnce((error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      return "formatted aggregate";
    });

    await loadDeviceSyncBin();

    const formattedErrorCall = mocks.formatDeviceSyncStartupError.mock.calls[0]?.[0];
    assert.ok(formattedErrorCall instanceof AggregateError);
    assert.deepEqual(
      formattedErrorCall.errors.map((entry: unknown) =>
        entry instanceof Error ? entry.message : String(entry),
      ),
      ["service start failed", "rollback close failed"],
    );
    assert.equal(mocks.server.close.mock.calls.length, 1);
    assert.equal(mocks.service.close.mock.calls.length, 1);
    assert.deepEqual(consoleErrorSpy.mock.calls, [["formatted aggregate"]]);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});
