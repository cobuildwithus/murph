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

vi.mock("@/src/lib/hosted-execution/dispatch-lifecycle", () => ({
  readHostedExecutionScheduledDispatchTarget: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/logging", () => ({
  formatHostedExecutionSafeLogError: (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
  }),
}));

import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { readHostedExecutionScheduledDispatchTarget } from "@/src/lib/hosted-execution/dispatch-lifecycle";
import { handoffHostedExecutionScheduledEventBestEffort } from "@/src/lib/hosted-wake/control";

describe("handoffHostedExecutionScheduledEventBestEffort", () => {
  beforeEach(() => {
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReset();
    vi.mocked(readHostedExecutionScheduledDispatchTarget).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("swallows lookup failures because the handoff is best-effort", async () => {
    vi.mocked(readHostedExecutionScheduledDispatchTarget).mockRejectedValue(new Error("lookup failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      handoffHostedExecutionScheduledEventBestEffort({
        eventId: "member.activated:test-event",
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted wake handoff failed.",
      expect.objectContaining({ message: "lookup failed" }),
    );
  });

  it("nudges the scheduled wake target through the deferred callback when present", async () => {
    const wakeUser = vi.fn().mockResolvedValue({});
    vi.mocked(readHostedExecutionControlClientIfConfigured).mockReturnValue({
      createBrowserVaultSession: vi.fn(),
      getStatus: vi.fn(),
      wakeUser,
    } as ReturnType<typeof readHostedExecutionControlClientIfConfigured>);
    vi.mocked(readHostedExecutionScheduledDispatchTarget).mockResolvedValue({
      eventId: "member.activated:test-event",
      route: "wake",
      seq: "42",
      userId: "user-123",
    });

    const defer = vi.fn(async (run: () => Promise<void>) => {
      await run();
    });

    await handoffHostedExecutionScheduledEventBestEffort({
      context: "member-activation",
      defer,
      eventId: "member.activated:test-event",
      timeoutMs: 25,
    });

    expect(defer).toHaveBeenCalledTimes(1);
    expect(wakeUser).toHaveBeenCalledWith("user-123", {
      targetSeqHint: "42",
    });
  });
});
