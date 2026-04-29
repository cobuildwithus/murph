import { afterEach, describe, expect, it, vi } from "vitest";

const ready = vi.fn(async () => {});
const stop = vi.fn(async () => {});
const waitForExit = vi.fn(async () => ({
  child: {
    exitCode: 0,
  },
  name: "cloudflare" as const,
}));
const startHostedLocalDevStack = vi.fn(async () => ({
  ready: ready(),
  stop,
  waitForExit,
  webBaseUrl: "http://localhost:3000",
  workerBaseUrl: "http://127.0.0.1:8787",
}));

vi.mock("./stack.ts", () => ({
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

    const { main } = await import("./main.ts");

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
});
