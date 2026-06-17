import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  signalHostedMailboxAppendRuntime: vi.fn(),
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
});
