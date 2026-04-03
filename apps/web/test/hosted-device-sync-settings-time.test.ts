import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatAbsoluteTime,
  formatRelativeTime,
} from "@/src/components/settings/hosted-device-sync-settings-time";

describe("hosted device sync time helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns just now for timestamps within one minute", () => {
    expect(formatRelativeTime("2026-04-03T12:00:30.000Z")).toBe("just now");
    expect(formatRelativeTime("2026-04-03T11:59:31.000Z")).toBe("just now");
  });

  it("falls back to relative minute formatting beyond one minute", () => {
    expect(formatRelativeTime("2026-04-03T12:02:00.000Z")).toBe("in 2 minutes");
    expect(formatRelativeTime("2026-04-03T11:58:00.000Z")).toBe("2 minutes ago");
  });

  it("handles invalid absolute and relative timestamps defensively", () => {
    expect(formatRelativeTime("not-a-date")).toBe("Unknown");
    expect(formatAbsoluteTime("not-a-date")).toBe("not-a-date");
  });
});
