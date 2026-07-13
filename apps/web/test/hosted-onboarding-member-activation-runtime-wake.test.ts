import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  materializePendingHostedGroupJoinConfirmationsBestEffort: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({
  materializePendingHostedGroupJoinConfirmationsBestEffort:
    mocks.materializePendingHostedGroupJoinConfirmationsBestEffort,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

import {
  signalHostedMemberActivationRuntimeWakeBestEffortResult,
} from "@/src/lib/hosted-onboarding/member-activation-runtime-wake";

describe("signalHostedMemberActivationRuntimeWakeBestEffortResult", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("logs failed wake signals with a code and redacted safe message", async () => {
    const prisma = {} as never;
    const signalError = new Error("failed member_123 with Bearer abc.def.ghi");
    signalError.name = "TemporalSignalError";
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(signalError);

    await expect(signalHostedMemberActivationRuntimeWakeBestEffortResult({
      hostedExecutionEventId: "evt_member_activation",
      mailboxItemId: "mailbox_123",
      memberId: "member_123",
      prisma,
      source: "test",
    })).resolves.toEqual({
      accepted: false,
      configured: true,
      errorCode: "TemporalSignalError",
      mailboxItemIdPresent: true,
      signalAccepted: null,
      workflowIdPresent: null,
    });

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_123",
      prisma,
    });
    expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
    expect(mocks.signalHostedMailboxAppendRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mock.invocationCallOrder[0],
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Hosted member activation mailbox wake signal failed.",
      expect.objectContaining({
        errorCode: "TemporalSignalError",
        errorMessage: "failed member_<redacted-id> with Bearer [redacted]",
        errorType: "Error",
      }),
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("abc.def.ghi");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("failed member_123");
  });

  it("contains a mailbox lookup failure inside the best-effort boundary", async () => {
    const prisma = {
      hostedMailboxItem: {
        findFirst: vi.fn().mockRejectedValueOnce(new Error("database unavailable")),
      },
    };

    await expect(signalHostedMemberActivationRuntimeWakeBestEffortResult({
      hostedExecutionEventId: "evt_member_activation",
      memberId: "member_123",
      prisma: prisma as never,
      source: "test",
      timeoutMs: 5_000,
    })).resolves.toMatchObject({
      accepted: false,
      configured: true,
      mailboxItemIdPresent: false,
      signalAccepted: null,
    });

    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
      timeoutMs: expect.any(Number),
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Hosted member activation mailbox wake signal failed.",
      expect.objectContaining({
        errorMessage: "database unavailable",
      }),
    );
  });

  it("caps a Temporal signal that never settles", async () => {
    vi.useFakeTimers();
    try {
      mocks.signalHostedMailboxAppendRuntime.mockReturnValueOnce(new Promise(() => {}));
      const resultPromise = signalHostedMemberActivationRuntimeWakeBestEffortResult({
        hostedExecutionEventId: "evt_member_activation",
        mailboxItemId: "mailbox_123",
        memberId: "member_123",
        prisma: {} as never,
        source: "test",
        timeoutMs: 5_000,
      });

      await vi.advanceTimersByTimeAsync(5_000);

      await expect(resultPromise).resolves.toMatchObject({
        accepted: false,
        errorCode: "TimeoutError",
        mailboxItemIdPresent: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps confirmation reconciliation inside the activation deadline", async () => {
    vi.useFakeTimers();
    try {
      mocks.signalHostedMailboxAppendRuntime.mockReturnValueOnce(new Promise(() => {}));
      mocks.materializePendingHostedGroupJoinConfirmationsBestEffort.mockImplementationOnce(
        async (input: { timeoutMs: number }) => {
          await new Promise<void>((resolve) => setTimeout(resolve, input.timeoutMs));
        },
      );
      const resultPromise = signalHostedMemberActivationRuntimeWakeBestEffortResult({
        hostedExecutionEventId: "evt_member_activation",
        mailboxItemId: "mailbox_123",
        memberId: "member_123",
        prisma: {} as never,
        source: "test",
        timeoutMs: 5_000,
      });

      await vi.advanceTimersByTimeAsync(5_001);

      await expect(resultPromise).resolves.toMatchObject({
        accepted: false,
        errorCode: "TimeoutError",
      });
      expect(mocks.materializePendingHostedGroupJoinConfirmationsBestEffort)
        .toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 1 }));
    } finally {
      vi.useRealTimers();
    }
  });
});
