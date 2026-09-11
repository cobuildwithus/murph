import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  countHostedLocalRuntimeAdmissionWindow,
} from "./hosted-local-runtime-admission-window.js";

const nowMs = Date.parse("2026-09-01T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(nowMs);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("hosted local runtime admission window", () => {
  it.each(["started", "replaced"] as const)("counts the exact helper-%s owner once over its full window", async (action) => {
    const initial = admissionLog("initial-owner", 0, "hosted-local-wake:fixture");
    const settled = vi.fn();
    const result = countHostedLocalRuntimeAdmissionWindow(windowInput({
      acceptedWake: { action, runtimeAttemptId: "initial-owner" },
      readStdout: () => [
        "unstructured startup output",
        admissionLog("setup-owner", -500),
        initial,
        initial,
      ].join("\n"),
    })).then((count) => {
      settled();
      return count;
    });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(1);
  });

  it.each(["workflow-attempt", "hosted-local-wake:fixture"])(
    "counts a second fresh owner even when its caller is %s",
    async (orchestrationAttemptId) => {
      let stdout = admissionLog("initial-owner", 0, "hosted-local-wake:fixture");
      const result = countHostedLocalRuntimeAdmissionWindow(windowInput({
        readStdout: () => stdout,
      }));

      await vi.advanceTimersByTimeAsync(29_000);
      // The bounded stdout tail can drop the initial admission while polling.
      stdout = admissionLog("replacement-owner", 29_000, orchestrationAttemptId);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(result).resolves.toBe(2);
    },
  );

  it("observes a woken owner for thirty new seconds despite its older start", async () => {
    const settled = vi.fn();
    const result = countHostedLocalRuntimeAdmissionWindow(windowInput({
      acceptedWake: { action: "woken", runtimeAttemptId: "initial-owner" },
      notBefore: new Date(nowMs - 180_000),
      readStdout: () => [
        admissionLog("initial-owner", -120_000),
        admissionLog("setup-owner", -60_000),
      ].join("\n"),
    })).then((count) => {
      settled();
      return count;
    });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(1);
  });

  it("counts replacement of a woken owner without requiring its old start log", async () => {
    let stdout = "";
    const result = countHostedLocalRuntimeAdmissionWindow(windowInput({
      acceptedWake: { action: "woken", runtimeAttemptId: "initial-owner" },
      readStdout: () => stdout,
    }));

    await vi.advanceTimersByTimeAsync(10_000);
    stdout = admissionLog("replacement-owner", 10_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(result).resolves.toBe(2);
  });

  it("does not substitute another start for a missing accepted owner's log", async () => {
    const result = countHostedLocalRuntimeAdmissionWindow(windowInput({
      readStdout: () => admissionLog("unrelated-owner", 0),
      timeoutMs: 1_000,
    }));
    const rejection = expect(result).rejects.toThrow(
      "Timed out observing the first runtime admission window.",
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
  });

  it("requires the entire observation window before the reminder deadline", async () => {
    await expect(countHostedLocalRuntimeAdmissionWindow(windowInput({
      acceptedWake: { action: "woken", runtimeAttemptId: "initial-owner" },
      beforeAt: new Date(nowMs + 29_999).toISOString(),
      readStdout: () => admissionLog("initial-owner", -120_000),
    }))).rejects.toThrow(
      "The reminder deadline does not leave one full runtime admission window.",
    );
  });
});

function windowInput(
  overrides: Partial<Parameters<typeof countHostedLocalRuntimeAdmissionWindow>[0]> = {},
): Parameters<typeof countHostedLocalRuntimeAdmissionWindow>[0] {
  return {
    acceptedWake: { action: "started", runtimeAttemptId: "initial-owner" },
    beforeAt: new Date(nowMs + 60_000).toISOString(),
    buildFailureMessage: async (lines) => lines.join("\n"),
    notBefore: new Date(nowMs - 1_000),
    readStdout: () => "",
    timeoutMs: 240_000,
    wakeAcceptedAt: new Date(nowMs),
    windowMs: 30_000,
    ...overrides,
  };
}

function admissionLog(
  workspaceAttemptId: string,
  offsetMs: number,
  orchestrationAttemptId = "workflow-attempt",
): string {
  return JSON.stringify({
    component: "hosted.runner",
    details: {
      orchestrationAttemptId,
      runtimeProcessingAction: "started",
      workspaceAttemptId,
    },
    phase: "runtime.starting",
    time: new Date(nowMs + offsetMs).toISOString(),
    userId: null,
    userIdPresent: true,
  });
}
