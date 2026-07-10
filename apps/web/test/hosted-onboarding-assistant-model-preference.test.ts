import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUniqueHostedMember: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  updateHostedMember: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  lockHostedMemberRow: mocks.lockHostedMemberRow,
}));

import {
  isHostedMemberSolModelEligible,
  readHostedMemberAssistantModelPreference,
  updateHostedMemberAssistantModelPreferenceTx,
} from "@/src/lib/hosted-onboarding/assistant-model-preference";

describe("hosted member assistant model preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.updateHostedMember.mockResolvedValue({});
  });

  it("limits Sol eligibility to unsuspended active paid Edge owners", () => {
    const eligible = {
      billingStatus: HostedBillingStatus.active,
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_edge_monthly",
      isThreadContainerMember: false,
      suspendedAt: null,
    };

    expect(isHostedMemberSolModelEligible(eligible)).toBe(true);
    expect(isHostedMemberSolModelEligible({
      ...eligible,
      billingStatus: HostedBillingStatus.not_started,
    })).toBe(false);
    expect(isHostedMemberSolModelEligible({
      ...eligible,
      currentBillingPhase: "trial",
    })).toBe(false);
    expect(isHostedMemberSolModelEligible({
      ...eligible,
      currentBillingPlanCode: "launch_monthly",
    })).toBe(false);
    expect(isHostedMemberSolModelEligible({
      ...eligible,
      isThreadContainerMember: true,
    })).toBe(false);
    expect(isHostedMemberSolModelEligible({
      ...eligible,
      suspendedAt: new Date("2026-07-09T00:00:00.000Z"),
    })).toBe(false);
  });

  it("resolves an eligible stored Sol preference to the runtime override", async () => {
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: "gpt-5.6-sol",
    }));

    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_edge",
      prisma: createReadClient(),
    })).resolves.toEqual({
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      solAvailable: true,
    });
  });

  it("falls back to Terra for stale, missing, and ineligible preferences", async () => {
    const prisma = createReadClient();
    mocks.findUniqueHostedMember
      .mockResolvedValueOnce(buildMemberState({
        assistantModelPreference: "retired-model",
      }))
      .mockResolvedValueOnce(buildMemberState({
        assistantModelPreference: "gpt-5.6-sol",
        billingStatus: HostedBillingStatus.not_started,
      }))
      .mockResolvedValueOnce(null);

    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_stale",
      prisma,
    })).resolves.toEqual({
      model: "gpt-5.6-terra",
      solAvailable: true,
    });
    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_family_sponsored",
      prisma,
    })).resolves.toEqual({
      model: "gpt-5.6-terra",
      solAvailable: false,
    });
    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_missing",
      prisma,
    })).resolves.toEqual({
      model: "gpt-5.6-terra",
      solAvailable: false,
    });
  });

  it("preserves stored Sol intent through ineligibility and restores it on reactivation", async () => {
    const prisma = createReadClient();
    let currentBillingPlanCode = "launch_monthly";
    mocks.findUniqueHostedMember.mockImplementation(() => Promise.resolve(
      buildMemberState({
        assistantModelPreference: "gpt-5.6-sol",
        currentBillingPlanCode,
      }),
    ));

    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_edge",
      prisma,
    })).resolves.toEqual({
      model: "gpt-5.6-terra",
      solAvailable: false,
    });
    expect(mocks.updateHostedMember).not.toHaveBeenCalled();

    currentBillingPlanCode = "launch_edge_monthly";

    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_edge",
      prisma,
    })).resolves.toEqual({
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      solAvailable: true,
    });
    expect(mocks.updateHostedMember).not.toHaveBeenCalled();
  });

  it("locks and stores only the Sol override for an eligible member", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
    }));

    await expect(updateHostedMemberAssistantModelPreferenceTx({
      memberId: "member_edge",
      model: "gpt-5.6-sol",
      prisma: tx,
    })).resolves.toEqual({
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      solAvailable: true,
      updated: true,
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(tx, "member_edge");
    expect(mocks.updateHostedMember).toHaveBeenCalledWith({
      data: {
        assistantModelPreference: "gpt-5.6-sol",
      },
      where: {
        id: "member_edge",
      },
    });
  });

  it("rejects Sol with a stable Edge entitlement error", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
      billingStatus: HostedBillingStatus.not_started,
    }));

    await expect(updateHostedMemberAssistantModelPreferenceTx({
      memberId: "member_family_sponsored",
      model: "gpt-5.6-sol",
      prisma: tx,
    })).rejects.toMatchObject({
      code: "ASSISTANT_MODEL_SOL_REQUIRES_EDGE",
      httpStatus: 403,
      message: "GPT-5.6 Sol requires an active paid Edge plan.",
    });
    expect(mocks.updateHostedMember).not.toHaveBeenCalled();
  });

  it("clears stale preferences when Terra is selected regardless of eligibility", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: "retired-model",
      billingStatus: HostedBillingStatus.not_started,
    }));

    await expect(updateHostedMemberAssistantModelPreferenceTx({
      memberId: "member_stale",
      model: "gpt-5.6-terra",
      prisma: tx,
    })).resolves.toEqual({
      model: "gpt-5.6-terra",
      solAvailable: false,
      updated: true,
    });
    expect(mocks.updateHostedMember).toHaveBeenCalledWith({
      data: {
        assistantModelPreference: null,
      },
      where: {
        id: "member_stale",
      },
    });
  });

  it("is idempotent when the canonical stored preference already matches", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember
      .mockResolvedValueOnce(buildMemberState({
        assistantModelPreference: "gpt-5.6-sol",
      }))
      .mockResolvedValueOnce(buildMemberState({
        assistantModelPreference: null,
      }));

    await expect(updateHostedMemberAssistantModelPreferenceTx({
      memberId: "member_edge",
      model: "gpt-5.6-sol",
      prisma: tx,
    })).resolves.toMatchObject({
      model: "gpt-5.6-sol",
      updated: false,
    });
    await expect(updateHostedMemberAssistantModelPreferenceTx({
      memberId: "member_terra",
      model: "gpt-5.6-terra",
      prisma: tx,
    })).resolves.toMatchObject({
      model: "gpt-5.6-terra",
      updated: false,
    });
    expect(mocks.updateHostedMember).not.toHaveBeenCalled();
  });
});

function buildMemberState(input: {
  assistantModelPreference: string | null;
  billingStatus?: HostedBillingStatus;
  currentBillingPhase?: string | null;
  currentBillingPlanCode?: string | null;
  suspendedAt?: Date | null;
  threadContainerMemberId?: string | null;
}) {
  return {
    assistantModelPreference: input.assistantModelPreference,
    billingRef: {
      currentBillingPhase: input.currentBillingPhase === undefined
        ? "paid"
        : input.currentBillingPhase,
      currentBillingPlanCode: input.currentBillingPlanCode === undefined
        ? "launch_edge_monthly"
        : input.currentBillingPlanCode,
    },
    billingStatus: input.billingStatus ?? HostedBillingStatus.active,
    suspendedAt: input.suspendedAt ?? null,
    threadContainer: input.threadContainerMemberId
      ? { memberId: input.threadContainerMemberId }
      : null,
  };
}

function createReadClient(): Parameters<
  typeof readHostedMemberAssistantModelPreference
>[0]["prisma"] {
  return {
    hostedMember: {
      findUnique: mocks.findUniqueHostedMember,
    },
  };
}

function createTransactionClient(): Parameters<
  typeof updateHostedMemberAssistantModelPreferenceTx
>[0]["prisma"] {
  return {
    $queryRaw: vi.fn(),
    hostedMember: {
      findUnique: mocks.findUniqueHostedMember,
      update: mocks.updateHostedMember,
    },
  };
}
