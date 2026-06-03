import { afterEach, describe, expect, it, vi } from "vitest";

const ready = vi.fn(async () => {});
const stop = vi.fn(async () => {});
const kill = vi.fn(() => {});
const waitForExit = vi.fn(async () => ({
  child: {
    exitCode: 0,
  },
  name: "cloudflare" as const,
}));
const startHostedLocalDevStack = vi.fn(async () => ({
  kill,
  ready: ready(),
  stop,
  waitForExit,
  webBaseUrl: "http://localhost:3000",
  workerBaseUrl: "http://127.0.0.1:8787",
}));

vi.mock("../../src/dev-hosted-local/stack.ts", () => ({
  startHostedLocalDevStack,
}));

describe("hosted local dev main", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps the root entrypoint behavior and emits the requested ready token", async () => {
    vi.stubEnv("MURPH_DEV_READY_TOKEN", "token-ready-for-tests");
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const { main } = await import("../../src/dev-hosted-local/main.ts");

    await main();

    expect(startHostedLocalDevStack).toHaveBeenCalledWith({
      env: process.env,
    });
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining("Local hosted dev is ready."),
    );
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining("__MURPH_HOSTED_LOCAL_READY__ token-ready-for-tests"),
    );
    expect(waitForExit).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith("SIGTERM");
    stdoutWrite.mockRestore();
  });

  it("waits for signal-triggered cleanup when startup readiness aborts", async () => {
    let rejectReady!: (error: Error) => void;
    let resolveStop!: () => void;
    const readyPromise = new Promise<void>((_resolve, reject) => {
      rejectReady = reject;
    });
    const stopPromise = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    const signalHandlers = new Map<string, () => void>();
    const originalProcessOnce = process.once.bind(process);
    const onceSpy = vi.spyOn(process, "once").mockImplementation((
      (event: string | symbol, listener: (...args: unknown[]) => void) => {
        if (event === "SIGINT" || event === "SIGTERM") {
          signalHandlers.set(event, () => listener(event));
          return process;
        }

        return originalProcessOnce(event, listener);
      }
    ) as typeof process.once);
    const offSpy = vi.spyOn(process, "off").mockImplementation((
      (_event: string | symbol, _listener: (...args: unknown[]) => void) => process
    ) as typeof process.off);
    ready.mockImplementationOnce(async () => await readyPromise);
    stop.mockImplementationOnce(async () => await stopPromise);
    waitForExit.mockImplementationOnce(async () => new Promise(() => {}));

    try {
      const { main } = await import("../../src/dev-hosted-local/main.ts");

      let settled = false;
      const mainPromise = main().then(() => {
        settled = true;
      });
      await Promise.resolve();
      signalHandlers.get("SIGINT")?.();
      rejectReady(new Error("startup aborted after signal"));
      await Promise.resolve();

      expect(stop).toHaveBeenCalledWith("SIGINT");
      expect(kill).toHaveBeenCalledWith("SIGINT");
      expect(settled).toBe(false);

      resolveStop();
      await mainPromise;

      expect(settled).toBe(true);
      expect(offSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith("exit", expect.any(Function));
    } finally {
      onceSpy.mockRestore();
      offSpy.mockRestore();
    }
  });
});
