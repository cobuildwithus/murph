import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedAiUsageAllowDecision: vi.fn(),
  nudgeHostedRunnerUserBestEffortResult: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-execution/usage-gate-allow-decision", () => ({
  createHostedAiUsageAllowDecision: mocks.createHostedAiUsageAllowDecision,
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

import {
  nudgeHostedAssistantRunnerUserBestEffortResult,
} from "@/src/lib/hosted-runner/assistant-nudge";

describe("hosted assistant runner nudge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveHostedAiUsageGate.mockResolvedValue({
      allowed: true,
    });
    mocks.createHostedAiUsageAllowDecision.mockResolvedValue({
      allowed: true,
      signature: {
        alg: "HMAC-SHA256",
        keyId: "test",
        signature: "sig",
      },
    });
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue({
      accepted: true,
      alarmScheduled: false,
      alreadyRunning: false,
      configured: true,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
  });

  it("passes an allow decision to regular assistant runner nudges", async () => {
    await expect(nudgeHostedAssistantRunnerUserBestEffortResult({
      context: "webhook:telegram:direct",
      timeoutMs: 5000,
      userId: "member_123",
    })).resolves.toMatchObject({
      accepted: true,
      usageGateDenied: false,
    });

    expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
      memberId: "member_123",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      aiUsageAllowDecision: expect.objectContaining({
        allowed: true,
      }),
      context: "webhook:telegram:direct",
      timeoutMs: 5000,
      userId: "member_123",
    });
  });

  it("does not nudge the regular runner when assistant usage is denied", async () => {
    mocks.resolveHostedAiUsageGate.mockResolvedValueOnce({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
    });

    await expect(nudgeHostedAssistantRunnerUserBestEffortResult({
      context: "webhook:telegram:direct",
      timeoutMs: 5000,
      userId: "member_capped",
    })).resolves.toMatchObject({
      accepted: false,
      errorCode: "AI_USAGE_GATE_DENIED",
      usageGateDenied: true,
    });

    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
  });
});
