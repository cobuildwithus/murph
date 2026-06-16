import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  checkHostedAiUsageGate: vi.fn(),
  readHostedAiUsageGate: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  checkHostedAiUsageGate: mocks.checkHostedAiUsageGate,
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

import {
  hostedRuntimeMailboxEntryNeedsAiUsageGate,
  resolveHostedRuntimeAiUsageGate,
} from "@/src/lib/hosted-orchestration/runtime-usage-decision";

describe("resolveHostedRuntimeAiUsageGate", () => {
  beforeEach(() => {
    mocks.checkHostedAiUsageGate.mockReset();
    mocks.readHostedAiUsageGate.mockReset();
    mocks.resolveHostedAiUsageGate.mockReset();
  });

  it("keeps read_first mode on the check gate", async () => {
    mocks.checkHostedAiUsageGate.mockResolvedValue({ allowed: true });

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "read_first",
      userId: "member_123",
    })).resolves.toEqual({ status: "allowed" });

    expect(mocks.checkHostedAiUsageGate).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("maps a denied check decision to denied", async () => {
    const decision = buildDeniedUsageGateDecision();
    mocks.checkHostedAiUsageGate.mockResolvedValue(decision);

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "read_first",
      userId: "member_123",
    })).resolves.toEqual({
      decision,
      status: "denied",
    });
  });

  it("keeps read_only mode on the pure read gate", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue({ allowed: true });

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "read_only",
      userId: "member_123",
    })).resolves.toEqual({ status: "allowed" });

    expect(mocks.readHostedAiUsageGate).toHaveBeenCalledTimes(1);
    expect(mocks.checkHostedAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("keeps mutating mode on the authoritative resolve gate", async () => {
    const decision = buildDeniedUsageGateDecision();
    mocks.resolveHostedAiUsageGate.mockResolvedValue(decision);

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "mutating",
      userId: "member_123",
    })).resolves.toEqual({
      decision,
      status: "denied",
    });

    expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledTimes(1);
    expect(mocks.checkHostedAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.readHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("maps gate failures to unavailable with a bounded retry time", async () => {
    mocks.checkHostedAiUsageGate.mockRejectedValue(new Error("db down"));

    const now = new Date("2026-06-12T12:00:00.000Z");
    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "read_first",
      now,
      userId: "member_123",
    })).resolves.toEqual({
      retryAt: "2026-06-12T12:00:30.000Z",
      status: "unavailable",
    });
  });
});

function buildDeniedUsageGateDecision() {
  return {
    allowed: false,
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: "member_123",
    periodEnd: new Date("2026-07-01T00:00:00.000Z"),
    periodStart: new Date("2026-06-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-07-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_001n,
    userNotice: {
      code: "edge_usage_limit_reached",
      message: "You hit your monthly Murph AI limit.",
    },
  };
}

describe("hostedRuntimeMailboxEntryNeedsAiUsageGate", () => {
  it("gates conversation-lane items and manual runs only", () => {
    expect(hostedRuntimeMailboxEntryNeedsAiUsageGate({
      kind: "conversation.message",
      lane: "conversation",
    })).toBe(true);
    expect(hostedRuntimeMailboxEntryNeedsAiUsageGate({
      kind: "runtime.manual-requested",
      lane: "system",
    })).toBe(true);
    expect(hostedRuntimeMailboxEntryNeedsAiUsageGate({
      kind: "runtime.browser-vault-refresh-requested",
      lane: "system",
    })).toBe(false);
    expect(hostedRuntimeMailboxEntryNeedsAiUsageGate({
      kind: "device-sync.wake",
      lane: "device-sync",
    })).toBe(false);
  });
});
