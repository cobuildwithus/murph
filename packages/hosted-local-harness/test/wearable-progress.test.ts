import { afterEach, describe, expect, it, vi } from "vitest";

import {
  forwardWearableStage,
  startWearableHostProgress,
  writeWearableStage,
} from "../src/wearable-progress.ts";

afterEach(() => {
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
    ]) forwardWearableStage(line);
    expect(write).not.toHaveBeenCalled();
    forwardWearableStage(message);
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
});
