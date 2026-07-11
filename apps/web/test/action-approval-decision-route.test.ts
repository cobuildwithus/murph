import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  buildHostedActionApprovalBinding: vi.fn(),
  decideHostedActionApprovalTx: vi.fn(),
  getPrisma: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  requireHostedActionApprovalId: vi.fn(),
  requirePendingHostedActionApproval: vi.fn(),
  resolveHostedMurphContactOption: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  transaction: vi.fn(),
  verifySensitiveActionChallenge: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/components/murph/hosted-murph-contact-action", () => ({
  resolveHostedMurphContactOption: mocks.resolveHostedMurphContactOption,
}));

vi.mock("@/src/lib/action-approvals", () => ({
  buildHostedActionApprovalBinding: mocks.buildHostedActionApprovalBinding,
  decideHostedActionApprovalTx: mocks.decideHostedActionApprovalTx,
  requireHostedActionApprovalId: mocks.requireHostedActionApprovalId,
  requirePendingHostedActionApproval: mocks.requirePendingHostedActionApproval,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/sensitive-actions/server", () => ({
  verifySensitiveActionChallenge: mocks.verifySensitiveActionChallenge,
}));

type ActionApprovalDecisionRouteModule =
  typeof import("../app/api/action-approvals/[approvalId]/decision/route");

const NOW = new Date("2026-07-10T18:00:00.000Z");
const APPROVAL_ID = `haa_${"a".repeat(32)}`;
const PENDING_APPROVAL = {
  actionHash: "b".repeat(64),
  actionId: `vault-file-send:${"c".repeat(64)}`,
  approvalId: APPROVAL_ID,
  bindingHash: "d".repeat(64),
  expiresAt: new Date("2026-07-10T18:15:00.000Z"),
  presentation: {
    body: "Send the requested archive to this conversation.",
    title: "Send a file?",
  },
  returnContactKind: "text" as const,
  tokenHash: "e".repeat(64),
};

let route: ActionApprovalDecisionRouteModule;

describe("hosted action approval decision route", () => {
  beforeAll(async () => {
    route = await import("../app/api/action-approvals/[approvalId]/decision/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.buildHostedActionApprovalBinding.mockReturnValue("f".repeat(64));
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_action_decision" },
      privyUserId: "privy_action_decision",
      sessionId: "session_action_decision",
    });
    mocks.requireHostedActionApprovalId.mockReturnValue(APPROVAL_ID);
    mocks.requirePendingHostedActionApproval.mockResolvedValue(PENDING_APPROVAL);
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback({ tx: true }),
    );
    mocks.getPrisma.mockReturnValue({
      $transaction: mocks.transaction,
    });
    mocks.verifySensitiveActionChallenge.mockResolvedValue({
      bindingHash: "f".repeat(64),
      expiresAt: new Date("2026-07-10T18:15:00.000Z"),
      kind: "assistant.action.approve",
      memberId: "member_action_decision",
      tokenHash: "1".repeat(64),
    });
    mocks.resolveHostedMurphContactOption.mockResolvedValue({
      href: "sms:+15550000000",
      kind: "text",
      label: "Text Murph",
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_action_decision",
    });
    mocks.decideHostedActionApprovalTx.mockImplementation(async (input: {
      decision: "approved" | "denied";
    }) => ({
      approval: {
        approvalId: APPROVAL_ID,
        expiresAt: input.decision === "approved"
          ? "2026-07-10T18:15:00.000Z"
          : PENDING_APPROVAL.expiresAt.toISOString(),
        presentation: PENDING_APPROVAL.presentation,
        returnContactKind: "text",
        status: input.decision,
      },
      runtimeResume: {
        lane: "system",
        laneSeq: "7",
        mailboxItemId: "mailbox_approval_outcome",
        userId: "member_action_decision",
      },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits approval work before signaling its mailbox pointer and returns a bare thread link", async () => {
    const response = await route.POST(
      jsonRequest({
        authorization: {
          signature: `0x${"2".repeat(130)}`,
          token: "sac_synthetic",
        },
        decision: "approved",
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      approvalId: APPROVAL_ID,
      expiresAt: "2026-07-10T18:15:00.000Z",
      presentation: PENDING_APPROVAL.presentation,
      redirectTo: "sms:+15550000000",
      returnContactKind: "text",
      status: "approved",
    });
    expect(mocks.decideHostedActionApprovalTx).toHaveBeenCalledWith({
      approval: PENDING_APPROVAL,
      challenge: expect.objectContaining({
        kind: "assistant.action.approve",
        memberId: "member_action_decision",
      }),
      decision: "approved",
      memberId: "member_action_decision",
      now: NOW,
      tx: { tx: true },
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_action_decision",
      knownCheckpoint: {
        lane: "system",
        laneSeq: "7",
        userId: "member_action_decision",
      },
      mailboxItemId: "mailbox_approval_outcome",
    });
    expect(mocks.resolveHostedMurphContactOption).toHaveBeenCalledWith({
      message: null,
      preferredKind: "text",
    });
    expect(
      mocks.decideHostedActionApprovalTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.signalHostedMailboxAppendRuntime.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("uses the same durable continuation for denial", async () => {
    const response = await route.POST(
      jsonRequest({ decision: "denied" }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      redirectTo: "sms:+15550000000",
      status: "denied",
    }));
    expect(mocks.verifySensitiveActionChallenge).not.toHaveBeenCalled();
    expect(mocks.decideHostedActionApprovalTx).toHaveBeenCalledWith({
      approval: PENDING_APPROVAL,
      decision: "denied",
      memberId: "member_action_decision",
      now: NOW,
      tx: { tx: true },
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });

  it("keeps the committed mailbox outcome successful when the latency signal is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(
      new Error(
        "Temporal signal unavailable for hosted-user-runtime:user_private member_private",
      ),
    );

    try {
      const response = await route.POST(
        jsonRequest({ decision: "denied" }),
        routeContext(),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        status: "denied",
      }));
      expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "Hosted action approval mailbox wake signal failed after decision commit.",
        {
          errorCode: "HOSTED_ACTION_APPROVAL_TEMPORAL_SIGNAL_FAILED",
          errorMessage:
            "Temporal signal unavailable for hosted-user-runtime:<redacted-id> member_<redacted-id>",
          errorType: "Error",
          mailboxItemIdPresent: true,
        },
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps a committed decision successful when optional contact resolution fails", async () => {
    mocks.resolveHostedMurphContactOption.mockRejectedValueOnce(
      new Error("Contact resolution unavailable"),
    );

    const response = await route.POST(
      jsonRequest({ decision: "denied" }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      redirectTo: null,
      status: "denied",
    }));
    expect(mocks.decideHostedActionApprovalTx).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request(
    `https://withmurph.example/api/action-approvals/${APPROVAL_ID}/decision`,
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

function routeContext() {
  return {
    params: Promise.resolve({ approvalId: APPROVAL_ID }),
  };
}
