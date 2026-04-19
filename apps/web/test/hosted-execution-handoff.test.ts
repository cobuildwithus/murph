import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/logging", () => ({
  formatHostedExecutionSafeLogError: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }),
}));

import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { handoffHostedExecutionWakeBestEffort } from "@/src/lib/hosted-wake/control";
import { maybeHandoffHostedExecutionWebhookWake } from "@/src/lib/hosted-onboarding/webhook-service-wake";

describe("handoffHostedExecutionWakeBestEffort", () => {
  beforeEach(() => {
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("swallows nudge failures because the handoff is best-effort", async () => {
    const nudgeUserRunner = vi.fn().mockRejectedValue(new Error("nudge failed"));
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      getStatus: vi.fn(),
      nudgeUserRunner,
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      handoffHostedExecutionWakeBestEffort({
        eventId: "member.activated:test-event",
        userId: "user-123",
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted wake handoff failed.",
      expect.objectContaining({ message: "nudge failed" }),
    );
  });

  it("nudges the user through the deferred callback when present", async () => {
    const nudgeUserRunner = vi.fn().mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
    });
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      getStatus: vi.fn(),
      nudgeUserRunner,
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);

    const defer = vi.fn(async (run: () => Promise<void>) => {
      await run();
    });

    await handoffHostedExecutionWakeBestEffort({
      context: "member-activation",
      defer,
      eventId: "member.activated:test-event",
      timeoutMs: 25,
      userId: "user-123",
    });

    expect(defer).toHaveBeenCalledTimes(1);
    expect(nudgeUserRunner).toHaveBeenCalledWith("user-123");
  });

  it("schedules a deferred webhook nudge without an inline drain wait contract", async () => {
    const nudgeUserRunner = vi.fn().mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
    });
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      getStatus: vi.fn(),
      nudgeUserRunner,
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);

    const deferred: Array<() => Promise<void>> = [];

    await maybeHandoffHostedExecutionWebhookWake({
      defer: async (drain) => {
        deferred.push(drain);
      },
      eventId: "evt_inline_gap",
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      source: "linq",
      userId: "user-123",
    });

    expect(nudgeUserRunner).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(1);

    await deferred[0]?.();

    expect(nudgeUserRunner).toHaveBeenCalledTimes(1);
    expect(nudgeUserRunner).toHaveBeenCalledWith("user-123");
  });
});
