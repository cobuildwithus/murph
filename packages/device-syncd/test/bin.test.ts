import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

test("device-syncd bin boots the service and shuts it down on SIGINT", async () => {
  const signalHandlers = new Map<string | symbol, () => void>();
  const service = {
    start: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
  };
  const server = {
    close: vi.fn(async () => {}),
  };

  const onceSpy = vi.spyOn(process, "once").mockImplementation(((event, listener) => {
    signalHandlers.set(event, listener as () => void);
    return process;
  }) as typeof process.once);
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    return code as never;
  }) as typeof process.exit);

  vi.doMock("../src/config.ts", () => ({
    loadDeviceSyncEnvironment: vi.fn(() => ({
      service: { vaultRoot: "/tmp/device-syncd-vault" },
      http: { host: "127.0.0.1", port: 43110 },
    })),
  }));
  vi.doMock("../src/service.ts", () => ({
    createDeviceSyncService: vi.fn(() => service),
  }));
  vi.doMock("../src/http.ts", () => ({
    startDeviceSyncHttpServer: vi.fn(async () => server),
  }));
  vi.doMock("../src/errors.ts", () => ({
    formatDeviceSyncStartupError: vi.fn((error: unknown) => String(error)),
  }));

  await import("../src/bin.ts");
  await flushMicrotasks();

  assert.equal(service.start.mock.calls.length, 1);
  assert.equal(onceSpy.mock.calls.length, 2);
  assert.equal(typeof signalHandlers.get("SIGINT"), "function");
  assert.equal(typeof signalHandlers.get("SIGTERM"), "function");

  signalHandlers.get("SIGINT")?.();
  await flushMicrotasks();

  assert.equal(service.stop.mock.calls.length, 1);
  assert.equal(server.close.mock.calls.length, 1);
  assert.equal(service.close.mock.calls.length, 1);
  assert.deepEqual(exitSpy.mock.calls, [[0]]);
});

test("device-syncd bin shuts down on SIGTERM", async () => {
  const signalHandlers = new Map<string | symbol, () => void>();
  const service = {
    start: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
  };
  const server = {
    close: vi.fn(async () => {}),
  };

  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    return code as never;
  }) as typeof process.exit);
  vi.spyOn(process, "once").mockImplementation(((event, listener) => {
    signalHandlers.set(event, listener as () => void);
    return process;
  }) as typeof process.once);

  vi.doMock("../src/config.ts", () => ({
    loadDeviceSyncEnvironment: vi.fn(() => ({
      service: { vaultRoot: "/tmp/device-syncd-vault" },
      http: { host: "127.0.0.1", port: 43111 },
    })),
  }));
  vi.doMock("../src/service.ts", () => ({
    createDeviceSyncService: vi.fn(() => service),
  }));
  vi.doMock("../src/http.ts", () => ({
    startDeviceSyncHttpServer: vi.fn(async () => server),
  }));
  vi.doMock("../src/errors.ts", () => ({
    formatDeviceSyncStartupError: vi.fn((error: unknown) => String(error)),
  }));

  await import("../src/bin.ts");
  await flushMicrotasks();

  signalHandlers.get("SIGTERM")?.();
  await flushMicrotasks();

  assert.equal(service.stop.mock.calls.length, 1);
  assert.equal(server.close.mock.calls.length, 1);
  assert.equal(service.close.mock.calls.length, 1);
  assert.deepEqual(exitSpy.mock.calls, [[0]]);
});

test("device-syncd bin formats startup failures and sets process exit code", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;

  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  vi.doMock("../src/config.ts", () => ({
    loadDeviceSyncEnvironment: vi.fn(() => {
      throw new Error("startup failed");
    }),
  }));
  vi.doMock("../src/service.ts", () => ({
    createDeviceSyncService: vi.fn(),
  }));
  vi.doMock("../src/http.ts", () => ({
    startDeviceSyncHttpServer: vi.fn(),
  }));
  vi.doMock("../src/errors.ts", () => ({
    formatDeviceSyncStartupError: vi.fn((error: unknown) =>
      error instanceof Error ? `formatted: ${error.message}` : "formatted",
    ),
  }));

  try {
    await import("../src/bin.ts");
    await flushMicrotasks();

    assert.deepEqual(consoleErrorSpy.mock.calls, [["formatted: startup failed"]]);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});
