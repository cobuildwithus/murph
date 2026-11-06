import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forwardWearableStage,
  startWearableHostProgress,
  writeWearableStage,
  type WearableStage,
} from "../src/wearable-progress.ts";

beforeEach(() => vi.stubEnv("GITHUB_ACTIONS", "false"));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("wearable canary progress", () => {
  it("forwards complete known stages and discards arbitrary child output", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    writeWearableStage("murph_persisted_connect_reload");
    const message = String(write.mock.calls[0]?.[0]).trimEnd();
    write.mockClear();
    for (const line of [
      "browser-canary@example.invalid",
      "MURPH_E2E_WEARABLE_STAGE=private_provider_text",
      message + " private",
      message + "\nprivate",
      "prefix " + message,
      "MURPH_E2E_RESULT={\"private\":true}",
      "MURPH_E2E_GARMIN_CONNECTED=1",
      "",
    ]) expect(forwardWearableStage(line)).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
    expect(forwardWearableStage(message)).toBe("murph_persisted_connect_reload");
    expect(write).toHaveBeenCalledExactlyOnceWith(message + "\n");
  });

  it("reports numeric host measurements immediately and periodically until stopped", () => {
    vi.useFakeTimers();
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stop = startWearableHostProgress();
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(write).toHaveBeenCalledTimes(3);
    for (const [message] of write.mock.calls) {
      const text = String(message);
      expect(text).toMatch(/^MURPH_E2E_WEARABLE_HOST=\{[^\n]+\}\n$/u);
      const measurements = JSON.parse(text.slice("MURPH_E2E_WEARABLE_HOST=".length));
      expect(Object.keys(measurements).sort()).toEqual([
        "availableMiB", "availableParallelism", "freeMiB", "load1", "totalMiB",
      ]);
      for (const value of Object.values(measurements)) {
        expect(typeof value).toBe("number");
        expect(Number.isFinite(value)).toBe(true);
      }
    }
    stop();
    stop();
    vi.advanceTimersByTime(60_000);
    expect(write).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains bounded Actions notices with only validated stages and numeric measurements", () => {
    vi.useFakeTimers();
    vi.stubEnv("GITHUB_ACTIONS", "true");
    vi.spyOn(process, "availableMemory").mockReturnValue(4_096 * 1_048_576);
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    let stage: WearableStage | undefined;
    const stop = startWearableHostProgress(() => stage);
    const notices = () => write.mock.calls.map(([value]) => String(value))
      .filter((value) => value.startsWith("::notice::"))
      .map((value) => JSON.parse(value.slice("::notice::MURPH_E2E_WEARABLE_PROGRESS=".length)));
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).not.toHaveProperty("stage");
    stage = forwardWearableStage("MURPH_E2E_WEARABLE_STAGE=kernel_tunnel_ready") ?? stage;
    stage = forwardWearableStage("MURPH_E2E_WEARABLE_STAGE=private@example.invalid") ?? stage;
    vi.advanceTimersByTime(239_999);
    expect(notices()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(notices()[1]).toMatchObject({ elapsedSeconds: 240, stage: "kernel_tunnel_ready" });
    vi.advanceTimersByTime(40 * 60_000);
    expect(notices()).toHaveLength(10);
    expect(notices().at(-1).elapsedSeconds).toBe(36 * 60);
    for (const notice of notices()) {
      expect(Object.keys(notice).filter((key) => key !== "stage").sort()).toEqual([
        "availableMiB", "availableParallelism", "elapsedSeconds", "freeMiB", "load1", "totalMiB",
      ]);
      for (const [key, value] of Object.entries(notice)) {
        if (key !== "stage") expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect(write.mock.calls.map(String).join("")).not.toContain("private@example.invalid");
    const callsBeforeStop = write.mock.calls.length;
    stop();
    vi.advanceTimersByTime(240_000);
    expect(write).toHaveBeenCalledTimes(callsBeforeStop);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("samples falling available memory sooner while respecting the Actions notice cap", () => {
    vi.useFakeTimers();
    vi.stubEnv("GITHUB_ACTIONS", "true");
    let availableMiB = 8_192;
    vi.spyOn(process, "availableMemory").mockImplementation(() => availableMiB * 1_048_576);
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stop = startWearableHostProgress();
    const notices = () => write.mock.calls.filter(([value]) => String(value).startsWith("::notice::"));
    availableMiB = 4_096;
    vi.advanceTimersByTime(30_000);
    expect(notices()).toHaveLength(1);
    availableMiB = 4_095;
    vi.advanceTimersByTime(30_000);
    expect(notices()).toHaveLength(2);
    for (let index = 0; index < 15; index += 1) {
      availableMiB = Math.floor(availableMiB / 3);
      vi.advanceTimersByTime(30_000);
    }
    vi.advanceTimersByTime(40 * 60_000);
    expect(notices()).toHaveLength(10);
    stop();
  });
});
