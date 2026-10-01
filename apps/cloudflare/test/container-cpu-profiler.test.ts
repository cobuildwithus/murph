import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), emit: vi.fn(),
}));
vi.mock("node:inspector/promises", () => ({
  Session: class { post = mocks.post; connect = mocks.connect; disconnect = mocks.disconnect; },
}));
import { startHostedContainerCpuProfiler } from "../src/container-cpu-profiler.ts";

let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.post.mockResolvedValue({ profile: { nodes: [], samples: [], startTime: 0, endTime: 10_000_000 } });
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); });

describe("container CPU profiler lifecycle", () => {
  it("starts sampling, rotates serially, and disconnects once on shutdown", async () => {
    stop = await startHostedContainerCpuProfiler({ emit: mocks.emit });
    expect(mocks.post.mock.calls.slice(0, 3)).toEqual([
      ["Profiler.enable"], ["Profiler.setSamplingInterval", { interval: 10_000 }], ["Profiler.start"],
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.post.mock.calls.map(([method]) => method)).toEqual([
      "Profiler.enable", "Profiler.setSamplingInterval", "Profiler.start", "Profiler.stop", "Profiler.start",
    ]);
    stop(); stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(5);
  });

  it("fails open without raw inspector errors", async () => {
    mocks.post.mockRejectedValueOnce(new Error("private diagnostic payload"));
    stop = await startHostedContainerCpuProfiler({ emit: mocks.emit });
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ lifecycleStage: "entrypoint-cpu-profiler-unavailable" }) }));
    expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain("private");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it("stops after a rotation failure and never queues overlapping profiles", async () => {
    stop = await startHostedContainerCpuProfiler({ emit: mocks.emit });
    let rejectStop: ((error: Error) => void) | undefined;
    mocks.post.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStop = reject; }));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(mocks.post).toHaveBeenCalledTimes(4);
    rejectStop?.(new Error("private"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.emit.mock.calls)).not.toContain("private");
  });

  it("does not publish or restart a profile returned after shutdown", async () => {
    stop = await startHostedContainerCpuProfiler({ emit: mocks.emit });
    let finish: ((value: object) => void) | undefined;
    mocks.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(10_000);
    stop();
    finish?.({ profile: { nodes: [] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.post).toHaveBeenCalledTimes(4);
    expect(mocks.emit).toHaveBeenCalledTimes(1);
  });
});
