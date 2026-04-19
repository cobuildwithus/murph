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

vi.mock("@/src/lib/hosted-wake/lifecycle", () => ({
  readHostedWakeTarget: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/logging", () => ({
  formatHostedExecutionSafeLogError: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }),
}));

import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { readHostedWakeTarget } from "@/src/lib/hosted-wake/lifecycle";
import { handoffHostedExecutionWakeBestEffort } from "@/src/lib/hosted-wake/control";
import { maybeHandoffHostedExecutionWebhookWake } from "@/src/lib/hosted-onboarding/webhook-service-wake";

describe("handoffHostedExecutionWakeBestEffort", () => {
  beforeEach(() => {
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReset();
    vi.mocked(readHostedWakeTarget).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("swallows lookup failures because the handoff is best-effort", async () => {
    vi.mocked(readHostedWakeTarget).mockRejectedValue(new Error("lookup failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      handoffHostedExecutionWakeBestEffort({
        eventId: "member.activated:test-event",
        userId: "user-123",
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted wake handoff failed.",
      expect.objectContaining({ message: "lookup failed" }),
    );
  });

  it("nudges the scheduled wake target through the deferred callback when present", async () => {
    const wakeUser = vi.fn().mockResolvedValue({
      committedSeq: "42",
      requestedTargetSeq: "42",
      targetReached: true,
    });
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      getStatus: vi.fn(),
      wakeUser,
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);
    vi.mocked(readHostedWakeTarget).mockResolvedValue({
      eventId: "member.activated:test-event",
      seq: "42",
      userId: "user-123",
    });

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
    expect(readHostedWakeTarget).toHaveBeenCalledWith({
      eventId: "member.activated:test-event",
      prisma: expect.anything(),
      userId: "user-123",
    });
    expect(wakeUser).toHaveBeenCalledWith("user-123", {
      targetSeqHint: "42",
    });
  });

  it("treats an incomplete 200 wake response as inline failure and schedules deferred drain", async () => {
    const wakeUser = vi.fn()
      .mockResolvedValueOnce({
        committedSeq: "41",
        requestedTargetSeq: "42",
        targetReached: false,
      })
      .mockResolvedValueOnce({
        committedSeq: "42",
        requestedTargetSeq: "42",
        targetReached: true,
      });
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      getStatus: vi.fn(),
      wakeUser,
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);
    vi.mocked(readHostedWakeTarget).mockResolvedValue({
      eventId: "evt_inline_gap",
      seq: "42",
      userId: "user-123",
    });

    const deferred: Array<() => Promise<void>> = [];
    const prisma = {} as Parameters<typeof maybeHandoffHostedExecutionWebhookWake>[0]["prisma"];

    await maybeHandoffHostedExecutionWebhookWake({
      defer: async (drain) => {
        deferred.push(drain);
      },
      eventId: "evt_inline_gap",
      maxInlineDrainMs: 25,
      prisma,
      response: {
        ok: true,
        reason: "wake-appended-active-member",
      },
      source: "linq",
      userId: "user-123",
    });

    expect(wakeUser).toHaveBeenCalledTimes(1);
    expect(wakeUser).toHaveBeenNthCalledWith(1, "user-123", {
      targetSeqHint: "42",
    });
    expect(deferred).toHaveLength(1);

    await deferred[0]?.();

    expect(wakeUser).toHaveBeenCalledTimes(2);
    expect(wakeUser).toHaveBeenNthCalledWith(2, "user-123", {
      targetSeqHint: "42",
    });
  });
});
