import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  checkHostedAiUsageGate: vi.fn(),
  readHostedAiUsageGate: vi.fn(),
  readHostedRuntimeAiAccessDecision: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  checkHostedAiUsageGate: mocks.checkHostedAiUsageGate,
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readHostedRuntimeAiAccessDecision: mocks.readHostedRuntimeAiAccessDecision,
}));

import {
  resolveHostedRuntimeAiUsageGate,
} from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import {
  hostedMailboxItemsRequireAiUsageAccess,
} from "@/src/lib/hosted-mailbox/ai-usage-gate";

describe("resolveHostedRuntimeAiUsageGate", () => {
  beforeEach(() => {
    mocks.checkHostedAiUsageGate.mockReset();
    mocks.readHostedAiUsageGate.mockReset();
    mocks.resolveHostedAiUsageGate.mockReset();
    mocks.readHostedRuntimeAiAccessDecision.mockReset();
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({ allowed: true });
  });

  it.each([
    ["mutating", "resolveHostedAiUsageGate"],
    ["read_first", "checkHostedAiUsageGate"],
    ["read_only", "readHostedAiUsageGate"],
  ] as const)(
    "routes %s mode to %s",
    async (mode, owner) => {
      mocks[owner].mockResolvedValue(buildAllowedUsageGateDecision({
        remainingUsdMicros: 8_000_000n,
      }));

      await expect(resolveHostedRuntimeAiUsageGate({
        mode,
        now: "2026-06-12T12:00:00.000Z",
        userId: "member_123",
      })).resolves.toEqual({ status: "allowed" });

      expect(mocks[owner]).toHaveBeenCalledWith({
        memberId: "member_123",
        now: new Date("2026-06-12T12:00:00.000Z"),
        prisma: undefined,
      });
      expect(mocks[owner]).toHaveBeenCalledTimes(1);
      for (const [otherOwner, otherMock] of [
        ["checkHostedAiUsageGate", mocks.checkHostedAiUsageGate],
        ["readHostedAiUsageGate", mocks.readHostedAiUsageGate],
        ["resolveHostedAiUsageGate", mocks.resolveHostedAiUsageGate],
      ] as const) {
        if (otherOwner !== owner) {
          expect(otherMock).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each([
    ["personal", "direct_paid_member_plan"],
    ["group", "thread_container"],
  ] as const)("marks allowed %s usage low at the shared threshold", async (
    _label,
    allowanceSource,
  ) => {
    mocks.checkHostedAiUsageGate.mockResolvedValue(buildAllowedUsageGateDecision({
      allowanceSource,
      remainingUsdMicros: 2_000_000n,
    }));

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "read_first",
      userId: "member_123",
    })).resolves.toEqual({
      status: "allowed",
      usageRunningLow: true,
    });
  });

  it("does not mark capacity low above the threshold", async () => {
    mocks.readHostedAiUsageGate.mockResolvedValue(buildAllowedUsageGateDecision({
      remainingUsdMicros: 2_000_001n,
    }));

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "read_only",
      userId: "member_123",
    })).resolves.toEqual({ status: "allowed" });
  });

  it.each([
    [900_000n, true],
    [900_001n, false],
  ] as const)(
    "derives the Starter low-usage boundary from its grant at %s micros",
    async (remainingUsdMicros, expectedLow) => {
      mocks.readHostedAiUsageGate.mockResolvedValue(
        buildAllowedUsageGateDecision({
          allowanceSource: "direct_starter",
          limitUsdMicros: 0n,
          remainingUsdMicros,
        }),
      );

      await expect(resolveHostedRuntimeAiUsageGate({
        mode: "read_only",
        userId: "member_123",
      })).resolves.toEqual({
        status: "allowed",
        ...(expectedLow ? { usageRunningLow: true } : {}),
      });
    },
  );

  it("returns the canonical denial after included and purchased usage are exhausted", async () => {
    const decision = buildMonthlyUsageExhaustedGateDecision();
    mocks.resolveHostedAiUsageGate.mockResolvedValue(decision);

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "mutating",
      userId: "member_123",
    })).resolves.toEqual({
      decision,
      status: "denied",
    });
  });

  it("denies queued AI work after explicit consent withdrawal without spending usage", async () => {
    mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({
      allowed: false,
      reason: "health_data_consent_withdrawn",
      retryAfter: new Date("2026-07-01T00:00:00.000Z"),
      userNotice: null,
    });

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "mutating",
      userId: "member_123",
    })).resolves.toEqual({
      status: "health_data_consent_withdrawn",
    });

    expect(mocks.checkHostedAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.readHostedAiUsageGate).not.toHaveBeenCalled();
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("preserves usage-gate failures for the caller", async () => {
    const error = new Error("usage gate unavailable");
    mocks.checkHostedAiUsageGate.mockRejectedValue(error);

    await expect(resolveHostedRuntimeAiUsageGate({
      mode: "read_first",
      userId: "member_123",
    })).rejects.toBe(error);
  });
});

function buildMonthlyUsageExhaustedGateDecision() {
  return {
    allowed: false,
    allowanceSource: "direct_paid_member_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros: 10_000_000n,
    memberId: "member_123",
    periodEnd: new Date("2026-07-01T00:00:00.000Z"),
    periodStart: new Date("2026-06-01T00:00:00.000Z"),
    reason: "ai_usage_limit_exceeded",
    remainingUsdMicros: 0n,
    retryAfter: new Date("2026-07-01T00:00:00.000Z"),
    spentUsdMicros: 10_000_000n,
    usageCreditBalanceUsdMicros: 0n,
    usageCreditLedgerVersion: 3n,
    userNotice: {
      code: "pulse_upgrade_edge",
      message: "You've used this month's Murph allowance. Add usage to keep going.",
    },
  };
}

function buildAllowedUsageGateDecision(input: {
  allowanceSource?:
    | "direct_paid_member_plan"
    | "direct_starter"
    | "thread_container";
  limitUsdMicros?: bigint;
  remainingUsdMicros: bigint;
}) {
  const limitUsdMicros = input.limitUsdMicros ?? 10_000_000n;
  return {
    allowed: true,
    allowanceSource: input.allowanceSource ?? "direct_paid_member_plan",
    billingPlanCode: "launch_monthly",
    limitUsdMicros,
    memberId: "member_123",
    periodEnd: new Date("2026-07-01T00:00:00.000Z"),
    periodStart: new Date("2026-06-01T00:00:00.000Z"),
    remainingUsdMicros: input.remainingUsdMicros,
    spentUsdMicros: input.allowanceSource === "direct_starter"
      ? 4_500_000n - input.remainingUsdMicros
      : limitUsdMicros - input.remainingUsdMicros,
    usageCreditBalanceUsdMicros: input.allowanceSource === "direct_starter"
      ? input.remainingUsdMicros
      : 0n,
    usageCreditLedgerVersion: 0n,
  };
}

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

  it("does not gate deterministic system work", () => {
    expect(hostedMailboxItemsRequireAiUsageAccess({
      consumedSeqByLane: [],
      items: [buildHostedMailboxAiUsageGateItem({
        kind: "runtime.manual-requested",
        lane: "system",
        laneSeq: "1",
      })],
      lanes: [],
    })).toBe(false);

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
