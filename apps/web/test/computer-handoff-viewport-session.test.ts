import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createComputerUseService: vi.fn(),
  getPrisma: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: vi.fn((task: () => Promise<void>) => {
    void task();
  }),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/computer-use/service", () => ({
  createComputerUseService: mocks.createComputerUseService,
}));

describe("computer handoff viewport session hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores only newer viewport observations", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mocks.getPrisma.mockReturnValue({
      hostedWebSession: {
        updateMany,
      },
    });
    const {
      saveHostedWebSessionComputerHandoffViewportSize,
    } = await import("@/src/lib/computer-use/handoff-viewport-session");
    const now = new Date("2026-06-29T12:00:03.000Z");
    const observedAt = new Date("2026-06-29T12:00:02.000Z");

    await expect(saveHostedWebSessionComputerHandoffViewportSize({
      memberId: "member_123",
      now,
      observedAt,
      sessionId: "hws_test",
      size: { height: 844, width: 390 },
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { gt: now },
        id: "hws_test",
        memberId: "member_123",
        OR: [
          { computerHandoffViewportObservedAt: null },
          { computerHandoffViewportObservedAt: { lt: observedAt } },
        ],
        revokedAt: null,
      },
      data: {
        computerHandoffViewportHeight: 844,
        computerHandoffViewportObservedAt: observedAt,
        computerHandoffViewportWidth: 392,
        updatedAt: now,
      },
    });
  });

  it("reports stale viewport observations as not saved", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    mocks.getPrisma.mockReturnValue({
      hostedWebSession: {
        updateMany,
      },
    });
    const {
      saveHostedWebSessionComputerHandoffViewportSize,
    } = await import("@/src/lib/computer-use/handoff-viewport-session");

    await expect(saveHostedWebSessionComputerHandoffViewportSize({
      memberId: "member_123",
      observedAt: new Date("2026-06-29T12:00:02.000Z"),
      sessionId: "hws_test",
      size: { height: 844, width: 390 },
    })).resolves.toBe(false);
  });

  it("corrects a stale cached apply when a newer measurement lands during Kernel resize", async () => {
    const ensureHandoffViewport = vi.fn(async () => undefined);
    mocks.createComputerUseService.mockReturnValue({ ensureHandoffViewport });
    const staleObservedAt = new Date("2026-06-29T12:00:00.000Z");
    const measuredObservedAt = new Date("2026-06-29T12:00:01.000Z");
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        computerHandoffViewportHeight: 900,
        computerHandoffViewportObservedAt: staleObservedAt,
        computerHandoffViewportWidth: 1440,
      })
      .mockResolvedValueOnce({
        computerHandoffViewportHeight: 844,
        computerHandoffViewportObservedAt: measuredObservedAt,
        computerHandoffViewportWidth: 390,
      });
    mocks.getPrisma.mockReturnValue({
      hostedWebSession: {
        findFirst,
      },
    });
    const {
      applyHostedWebSessionComputerHandoffViewport,
    } = await import("@/src/lib/computer-use/handoff-viewport-session");

    await applyHostedWebSessionComputerHandoffViewport({
      memberId: "member_123",
      sessionId: "hws_test",
      token: "handoff-token",
    });

    expect(ensureHandoffViewport).toHaveBeenCalledTimes(2);
    expect(ensureHandoffViewport).toHaveBeenNthCalledWith(1, {
      memberId: "member_123",
      token: "handoff-token",
      viewport: { height: 900, refresh_rate: 25, width: 1440 },
    });
    expect(ensureHandoffViewport).toHaveBeenNthCalledWith(2, {
      memberId: "member_123",
      token: "handoff-token",
      viewport: { height: 844, refresh_rate: 60, width: 392 },
    });
  });

  it("logs background apply failures with sanitized structured error details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ensureHandoffViewport = vi.fn(async () => {
      throw new Error(
        "operator message failed for member_sensitive and user@example.test",
      );
    });
    mocks.createComputerUseService.mockReturnValue({ ensureHandoffViewport });
    mocks.getPrisma.mockReturnValue({
      hostedWebSession: {
        findFirst: vi.fn(async () => ({
          computerHandoffViewportHeight: 844,
          computerHandoffViewportObservedAt: new Date("2026-06-29T12:00:00.000Z"),
          computerHandoffViewportWidth: 390,
        })),
      },
    });
    const {
      scheduleHostedWebSessionComputerHandoffViewportApply,
    } = await import("@/src/lib/computer-use/handoff-viewport-session");

    scheduleHostedWebSessionComputerHandoffViewportApply({
      memberId: "member_123",
      reason: "measured",
      sessionId: "hws_test",
      token: "handoff-token",
    });
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });

    expect(warn).toHaveBeenCalledWith(
      "[computer-handoff] measured viewport resize failed",
      expect.objectContaining({
        errorCode: "HOSTED_COMPUTER_HANDOFF_VIEWPORT_RESIZE_FAILED",
        errorMessage:
          "operator message failed for member_<redacted-id> and [redacted-email]",
        errorType: "Error",
      }),
    );
    const loggedDetails = warn.mock.calls[0]?.[1];
    expect(loggedDetails).not.toBeInstanceOf(Error);
    expect(JSON.stringify(loggedDetails)).not.toContain("member_sensitive");
    expect(JSON.stringify(loggedDetails)).not.toContain("user@example.test");
    warn.mockRestore();
  });
});
