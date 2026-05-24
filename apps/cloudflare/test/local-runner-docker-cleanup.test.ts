import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("local runner Docker cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes only the transient final runner image tag", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const child = new EventEmitter();
      setImmediate(() => child.emit("close", 0));
      return child as ReturnType<typeof spawn>;
    });

    const { removeHostedRunnerFinalImageBestEffort } =
      await import("../scripts/local-runner-docker-cleanup.ts");

    await expect(removeHostedRunnerFinalImageBestEffort()).resolves.toBeUndefined();

    expect(spawn).toHaveBeenCalledWith(
      "docker",
      ["image", "rm", "-f", "murph-cloudflare-runner"],
      expect.objectContaining({ stdio: "ignore" }),
    );
  });

  it("keeps cleanup best-effort when Docker is unavailable", async () => {
    vi.mocked(spawn).mockImplementationOnce(() => {
      const child = new EventEmitter();
      setImmediate(() => child.emit("error", new Error("docker unavailable")));
      return child as ReturnType<typeof spawn>;
    });

    const { removeHostedRunnerFinalImageBestEffort } =
      await import("../scripts/local-runner-docker-cleanup.ts");

    await expect(removeHostedRunnerFinalImageBestEffort()).resolves.toBeUndefined();
  });

  it("bounds cleanup time when Docker hangs", async () => {
    vi.useFakeTimers();
    const kill = vi.fn((_signal?: NodeJS.Signals | number) => true);
    vi.mocked(spawn).mockImplementationOnce(() => {
      const child = new EventEmitter() as ReturnType<typeof spawn>;
      child.kill = kill;
      return child;
    });

    const { removeHostedRunnerFinalImageBestEffort } =
      await import("../scripts/local-runner-docker-cleanup.ts");

    const cleanup = removeHostedRunnerFinalImageBestEffort();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(cleanup).resolves.toBeUndefined();
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });
});
