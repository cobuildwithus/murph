import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedRuntimeAiAccessDecision: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readHostedRuntimeAiAccessDecision: mocks.readHostedRuntimeAiAccessDecision,
}));

import {
  hostedRuntimeMailboxEntryNeedsAiUsageGate,
  resolveHostedRuntimeAiUsageGate,
} from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import {
  hostedMailboxItemsRequireAiUsageAccess,
} from "@/src/lib/hosted-mailbox/ai-usage-gate";

describe("resolveHostedRuntimeAiUsageGate", () => {
  beforeEach(() => {
    mocks.readHostedRuntimeAiAccessDecision.mockReset();
  });

  it.each(["mutating", "read_first", "read_only"] as const)(
    "uses the write-free access owner in %s mode",
    async (mode) => {
      mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({ allowed: true });

      await expect(resolveHostedRuntimeAiUsageGate({
        mode,
        now: "2026-06-12T12:00:00.000Z",
        userId: "member_123",
      })).resolves.toEqual({ status: "allowed" });

      expect(mocks.readHostedRuntimeAiAccessDecision).toHaveBeenCalledWith({
        memberId: "member_123",
        now: new Date("2026-06-12T12:00:00.000Z"),
        prisma: undefined,
      });
    },
  );

  it("does not import or consult monthly allowance bookkeeping", async () => {
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({ allowed: true });

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "read_first",
      userId: "member_123",
    })).resolves.toEqual({ status: "allowed" });
  });

  it("keeps inactive hosted access denied", async () => {
    const decision = buildHostedAccessInactiveUsageGateDecision();
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue(decision);

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "mutating",
      userId: "member_123",
    })).resolves.toEqual({
      decision,
      status: "denied",
    });
  });

  it("keeps trial-expired pending-billing access denied", async () => {
    const decision = buildTrialExpiredPendingBillingUsageGateDecision();
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue(decision);

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "mutating",
      userId: "member_123",
    })).resolves.toEqual({
      decision,
      status: "denied",
    });
  });
});

function buildHostedAccessInactiveUsageGateDecision() {
  return {
    allowed: false,
    reason: "hosted_access_inactive",
    retryAfter: new Date("2026-06-12T12:05:00.000Z"),
    userNotice: null,
  };
}

function buildTrialExpiredPendingBillingUsageGateDecision() {
  return {
    allowed: false,
    reason: "trial_expired_pending_billing",
    retryAfter: new Date("2026-06-12T12:15:00.000Z"),
    userNotice: {
      code: "trial_conversion_pending",
      message: "Your Murph trial needs billing before I can keep going.",
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
      kind: "runtime.maintenance-requested",
      lane: "system",
    })).toBe(false);
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

describe("hostedMailboxItemsRequireAiUsageAccess", () => {
  it("gates conversation rows only above both imported and consumed floors", () => {
    expect(hostedMailboxItemsRequireAiUsageAccess({
      consumedSeqByLane: [{ consumedSeq: "13", lane: "conversation" }],
      items: [
        buildHostedMailboxAiUsageGateItem({ laneSeq: "14" }),
        buildHostedMailboxAiUsageGateItem({
          kind: "runtime.browser-vault-refresh-requested",
          lane: "system",
          laneSeq: "2",
        }),
      ],
      lanes: [{ importedSeq: "14", lane: "conversation" }],
    })).toBe(false);

    expect(hostedMailboxItemsRequireAiUsageAccess({
      consumedSeqByLane: [{ consumedSeq: "13", lane: "conversation" }],
      items: [buildHostedMailboxAiUsageGateItem({ laneSeq: "15" })],
      lanes: [{ importedSeq: "14", lane: "conversation" }],
    })).toBe(true);

    expect(hostedMailboxItemsRequireAiUsageAccess({
      consumedSeqByLane: [{ consumedSeq: "14", lane: "conversation" }],
      items: [buildHostedMailboxAiUsageGateItem({ laneSeq: "14" })],
      lanes: [{ importedSeq: "0", lane: "conversation" }],
    })).toBe(false);

    expect(hostedMailboxItemsRequireAiUsageAccess({
      consumedSeqByLane: [{ consumedSeq: "13", lane: "conversation" }],
      items: [buildHostedMailboxAiUsageGateItem({
        consumedAt: "2026-04-26T00:00:04.000Z",
        laneSeq: "15",
      })],
      lanes: [{ importedSeq: "14", lane: "conversation" }],
    })).toBe(false);
  });

  it("does not gate fresh conversation tombstones without payload handles", () => {
    expect(hostedMailboxItemsRequireAiUsageAccess({
      consumedSeqByLane: [{ consumedSeq: "13", lane: "conversation" }],
      items: [
        buildHostedMailboxAiUsageGateItem({
          laneSeq: "14",
          payloadInlineCiphertext: null,
          payloadRef: null,
        }),
      ],
      lanes: [{ importedSeq: "13", lane: "conversation" }],
    })).toBe(false);

    expect(hostedMailboxItemsRequireAiUsageAccess({
      consumedSeqByLane: [{ consumedSeq: "13", lane: "conversation" }],
      items: [
        buildHostedMailboxAiUsageGateItem({
          laneSeq: "14",
          payloadInlineCiphertext: "",
          payloadRef: "  ",
        }),
      ],
      lanes: [{ importedSeq: "13", lane: "conversation" }],
    })).toBe(false);
  });

  it("keeps manual system work gated and other system work ungated", () => {
    expect(hostedMailboxItemsRequireAiUsageAccess({
      consumedSeqByLane: [],
      items: [buildHostedMailboxAiUsageGateItem({
        kind: "runtime.manual-requested",
        lane: "system",
        laneSeq: "1",
      })],
      lanes: [],
    })).toBe(true);

    expect(hostedMailboxItemsRequireAiUsageAccess({
      consumedSeqByLane: [],
      items: [buildHostedMailboxAiUsageGateItem({
        kind: "runtime.maintenance-requested",
        lane: "system",
        laneSeq: "1",
      })],
      lanes: [],
    })).toBe(false);
  });
});

function buildHostedMailboxAiUsageGateItem(input: {
  consumedAt?: string | null;
  kind?: string;
  lane?: string;
  laneSeq: string;
  payloadInlineCiphertext?: string | null;
  payloadRef?: string | null;
}): {
  consumedAt: string | null;
  kind: string;
  lane: string;
  laneSeq: string;
  payloadInlineCiphertext: string | null;
  payloadRef: string | null;
} {
  return {
    consumedAt: input.consumedAt ?? null,
    kind: input.kind ?? "conversation.message",
    lane: input.lane ?? "conversation",
    laneSeq: input.laneSeq,
    payloadInlineCiphertext: input.payloadInlineCiphertext === undefined
      ? "cipher_inline"
      : input.payloadInlineCiphertext,
    payloadRef: input.payloadRef === undefined ? null : input.payloadRef,
  };
}
