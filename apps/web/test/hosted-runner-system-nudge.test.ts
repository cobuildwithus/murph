import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findLatestMailboxItem: vi.fn(),
  findWorkspace: vi.fn(),
  getPrisma: vi.fn(),
  nudgeHostedAssistantRunnerUserBestEffortResult: vi.fn(),
  nudgeHostedRunnerUserBestEffortResult: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-runner/assistant-nudge", () => ({
  nudgeHostedAssistantRunnerUserBestEffortResult: mocks.nudgeHostedAssistantRunnerUserBestEffortResult,
}));

vi.mock("@/src/lib/hosted-runner/control", () => ({
  nudgeHostedRunnerUserBestEffortResult: mocks.nudgeHostedRunnerUserBestEffortResult,
}));

import {
  nudgeHostedSystemRunnerUserBestEffortResult,
} from "@/src/lib/hosted-runner/system-nudge";

describe("hosted system runner nudge", () => {
  const consoleWarn = vi.spyOn(console, "warn");

  beforeEach(() => {
    vi.clearAllMocks();
    consoleWarn.mockImplementation(() => undefined);
    mocks.getPrisma.mockReturnValue({
      hostedMailboxItem: {
        findFirst: mocks.findLatestMailboxItem,
      },
      hostedWorkspace: {
        findUnique: mocks.findWorkspace,
      },
    });
    mocks.findLatestMailboxItem.mockResolvedValue(null);
    mocks.findWorkspace.mockResolvedValue(null);
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValue(buildNudgeResult({
      accepted: true,
    }));
    mocks.nudgeHostedAssistantRunnerUserBestEffortResult.mockResolvedValue({
      ...buildNudgeResult({
        accepted: true,
      }),
      usageGateDenied: false,
    });
  });

  it("uses the raw runner nudge when no conversation mailbox lag is present", async () => {
    const result = await nudgeHostedSystemRunnerUserBestEffortResult({
      context: "device-sync.wake:workflow",
      timeoutMs: 5_000,
      userId: "member_system_only",
    });

    expect(mocks.findLatestMailboxItem).toHaveBeenCalledWith({
      orderBy: {
        laneSeq: "desc",
      },
      select: {
        laneSeq: true,
      },
      where: {
        lane: "conversation",
        userId: "member_system_only",
      },
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "device-sync.wake:workflow",
      timeoutMs: 5_000,
      userId: "member_system_only",
    });
    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      accepted: true,
      conversationLagPresent: false,
    });
  });

  it("uses the assistant-gated nudge when conversation mailbox lag is present", async () => {
    mocks.findLatestMailboxItem.mockResolvedValue({
      laneSeq: 4n,
    });
    mocks.findWorkspace.mockResolvedValue({
      redactedStatusJson: {
        hostedMailboxConversationImportedSeq: "1",
      },
    });
    mocks.nudgeHostedAssistantRunnerUserBestEffortResult.mockResolvedValue({
      ...buildNudgeResult({
        accepted: false,
        errorCode: "AI_USAGE_GATE_DENIED",
      }),
      usageGateDenied: true,
    });

    const result = await nudgeHostedSystemRunnerUserBestEffortResult({
      context: "device-sync.wake:workflow",
      timeoutMs: 5_000,
      userId: "member_capped",
    });

    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).toHaveBeenCalledWith({
      context: "device-sync.wake:workflow",
      timeoutMs: 5_000,
      userId: "member_capped",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      accepted: false,
      conversationLagPresent: true,
      errorCode: "AI_USAGE_GATE_DENIED",
      usageGateDenied: true,
    });
  });

  it("fails closed when the conversation lag check fails", async () => {
    mocks.findLatestMailboxItem.mockRejectedValue(new Error("database unavailable"));

    const result = await nudgeHostedSystemRunnerUserBestEffortResult({
      context: "device-sync.wake:workflow",
      timeoutMs: 5_000,
      userId: "member_uncertain",
    });

    expect(mocks.nudgeHostedAssistantRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      accepted: false,
      conversationLagPresent: true,
      errorCode: "CONVERSATION_LAG_CHECK_FAILED",
    });
  });
});

function buildNudgeResult(input: {
  accepted: boolean;
  errorCode?: string | null;
}) {
  return {
    accepted: input.accepted,
    alarmScheduled: input.accepted ? false : null,
    alreadyRunning: input.accepted ? false : null,
    configured: true,
    errorCode: input.errorCode ?? null,
    immediateDriveStarted: input.accepted ? false : null,
    inFlight: input.accepted ? false : null,
    nextAlarmAtPresent: input.accepted ? false : null,
  };
}
