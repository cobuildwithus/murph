import { HostedBillingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUniqueHostedMember: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  lockHostedMemberSponsoredAccessRows: vi.fn(),
  updateHostedMember: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  lockHostedMemberRow: mocks.lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows: mocks.lockHostedMemberSponsoredAccessRows,
}));

import {
  isHostedMemberSolModelEligible,
  readHostedMemberAssistantModelPreference,
  updateHostedMemberAssistantConfigurationTx,
  updateHostedMemberAssistantModelPreferenceTx,
} from "@/src/lib/hosted-onboarding/assistant-model-preference";

describe("hosted member assistant model preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.lockHostedMemberSponsoredAccessRows.mockResolvedValue(undefined);
    mocks.updateHostedMember.mockResolvedValue({});
  });

  it.each([false, true])("derives the first-day expiry only for personal signup (group=%s)", async (group) => {
    mocks.findUniqueHostedMember.mockResolvedValue({
      ...buildMemberState({ assistantModelPreference: null,
        ...(group ? { threadContainerMemberId: "group_test" } : {}) }),
      createdAt: new Date("2026-09-23T23:30:00Z"),
    });
    const result = await readHostedMemberAssistantModelPreference({
      memberId: "member_test", prisma: createReadClient(),
    });
    expect(result.hostedAssistantPriorityUntil).toBe(group ? undefined : "2026-09-24T23:30:00.000Z");
    expect(mocks.findUniqueHostedMember).toHaveBeenCalledTimes(1);
    expect(mocks.findUniqueHostedMember).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ createdAt: true }),
    }));
  });

  it.each([false, true])("retires stored Terra selections for personal and group conversations (group=%s)", async (group) => {
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: "gpt-5.6-terra",
      ...(group ? { threadContainerMemberId: "member_group_chat" } : {}),
    }));
    const result = await readHostedMemberAssistantModelPreference({ memberId: "member_migration", prisma: createReadClient() });
    expect(result).toMatchObject({ model: "gpt-6.1-sol", hostedAssistantModelOverride: "gpt-6.1-sol" });
    expect(result.availableModels).not.toContain("gpt-5.6-terra");
    expect(mocks.updateHostedMember).not.toHaveBeenCalled();
  });

  it.each(["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna"] as const)("saves and reads back %s on Pulse without premium access", async (model) => {
    let member = buildMemberState({
      assistantModelPreference: "gpt-6.1-sol",
      currentBillingPlanCode: "launch_monthly",
    });
    mocks.findUniqueHostedMember.mockImplementation(async () => member);
    mocks.updateHostedMember.mockImplementation(async ({ data }) => {
      member = { ...member, ...data };
      return member;
    });
    const updated = await updateHostedMemberAssistantModelPreferenceTx({
      memberId: "member_pulse",
      model,
      prisma: createTransactionClient(),
    });
    expect(updated).toMatchObject({ model, hostedAssistantModelOverride: model, effectiveModelUpdated: model !== "gpt-6.1-sol" });
    expect(member.assistantModelPreference).toBe(model === "gpt-6.1-sol" ? null : model);
    const readback = await readHostedMemberAssistantModelPreference({ memberId: "member_pulse", prisma: createReadClient() });
    expect(readback.model).toBe(model);
    expect(readback.availableModels).toEqual(expect.arrayContaining(["gpt-6.1-sol", "gpt-6-luna"]));
  });

  it("limits Sol eligibility to direct premium or active Family premium members", () => {
    const eligible = {
      accountGroupMemberships: [],
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

    const familyEdgeMembership = {
      group: {
        billingStatus: HostedBillingStatus.active,
        suspendedAt: null,
      },
      planCode: "edge",
      status: "active",
    };
    const familyEdge = {
      ...eligible,
      accountGroupMemberships: [familyEdgeMembership],
      billingStatus: HostedBillingStatus.not_started,
      currentBillingPhase: null,
      currentBillingPlanCode: null,
    };
    expect(isHostedMemberSolModelEligible(familyEdge)).toBe(true);
    expect(isHostedMemberSolModelEligible({
      ...familyEdge,
      accountGroupMemberships: [{
        ...familyEdgeMembership,
        planCode: "max",
      }],
    })).toBe(true);
    expect(isHostedMemberSolModelEligible({
      ...familyEdge,
      accountGroupMemberships: [{
        ...familyEdgeMembership,
        planCode: "pulse",
      }],
    })).toBe(false);
    expect(isHostedMemberSolModelEligible({
      ...familyEdge,
      accountGroupMemberships: [{
        ...familyEdgeMembership,
        status: "removed",
      }],
    })).toBe(false);
    expect(isHostedMemberSolModelEligible({
      ...familyEdge,
      accountGroupMemberships: [{
        ...familyEdgeMembership,
        group: {
          billingStatus: HostedBillingStatus.unpaid,
          suspendedAt: null,
        },
      }],
    })).toBe(false);
    expect(isHostedMemberSolModelEligible({
      ...familyEdge,
      accountGroupMemberships: [{
        ...familyEdgeMembership,
        group: {
          billingStatus: HostedBillingStatus.active,
          suspendedAt: new Date("2026-07-15T00:00:00.000Z"),
        },
      }],
    })).toBe(false);
  });

  it.each([
    { currentBillingPlanCode: "launch_edge_monthly" },
    { currentBillingPlanCode: "launch_monthly", familyPlanCode: "edge", familyBillingStatus: HostedBillingStatus.active },
    { currentBillingPlanCode: "launch_max_monthly" },
    { currentBillingPlanCode: "launch_monthly", familyPlanCode: "max", familyBillingStatus: HostedBillingStatus.active },
  ])("allows individual and Family Edge/Max to save Astra for the next query: %j", async (plan) => {
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
      ...plan,
    }));
    const result = await updateHostedMemberAssistantModelPreferenceTx({
      memberId: "member_max",
      model: "gpt-6-astra",
      prisma: createTransactionClient(),
    });
    expect(result).toMatchObject({ model: "gpt-6-astra", hostedAssistantModelOverride: "gpt-6-astra", updated: true });
    expect(result.availableModels).toContain("gpt-6-astra");
    expect(mocks.updateHostedMember).toHaveBeenCalledWith(expect.objectContaining({
      data: { assistantModelPreference: "gpt-6-astra" },
    }));
  });

  it.each([
    { currentBillingPlanCode: "launch_monthly" },
    { currentBillingPlanCode: "launch_monthly", familyPlanCode: "pulse", familyBillingStatus: HostedBillingStatus.active },
    { currentBillingPlanCode: "launch_edge_monthly", currentBillingPhase: "trial" },
    { currentBillingPlanCode: "launch_monthly", familyPlanCode: "edge", familyBillingStatus: HostedBillingStatus.unpaid },
    { currentBillingPlanCode: "launch_monthly", familyPlanCode: "edge", familyBillingStatus: HostedBillingStatus.active, familyMembershipStatus: "inactive" },
    { currentBillingPlanCode: "launch_monthly", familyPlanCode: "edge", familyBillingStatus: HostedBillingStatus.active, familySuspendedAt: new Date("2026-09-01T00:00:00Z") },
    { currentBillingPlanCode: "launch_max_monthly", currentBillingPhase: "trial" },
    { currentBillingPlanCode: "launch_monthly", familyPlanCode: "max", familyBillingStatus: HostedBillingStatus.active, familyMembershipStatus: "inactive" },
    { currentBillingPlanCode: "launch_monthly", familyPlanCode: "max", familyBillingStatus: HostedBillingStatus.active, familySuspendedAt: new Date("2026-09-01T00:00:00Z") },
  ])("denies Astra outside active paid Edge/Max and retains a dormant preference: %j", async (plan) => {
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({ assistantModelPreference: "gpt-6-astra", ...plan }));
    const result = await readHostedMemberAssistantModelPreference({ memberId: "member_other", prisma: createReadClient() });
    expect(result.model).toBe("gpt-6.1-sol");
    expect(result.availableModels).not.toContain("gpt-6-astra");
    await expect(updateHostedMemberAssistantModelPreferenceTx({ memberId: "member_other", model: "gpt-6-astra", prisma: createTransactionClient() }))
      .rejects.toMatchObject({ code: "ASSISTANT_MODEL_ASTRA_REQUIRES_EDGE" });
    expect(mocks.updateHostedMember).not.toHaveBeenCalled();
  });

  it("reactivates stored Astra after Max access returns and excludes group rooms", async () => {
    const member = buildMemberState({ assistantModelPreference: "gpt-6-astra", currentBillingPlanCode: "launch_max_monthly" });
    mocks.findUniqueHostedMember.mockResolvedValue(member);
    expect((await readHostedMemberAssistantModelPreference({ memberId: "member_max", prisma: createReadClient() })).model).toBe("gpt-6-astra");
    mocks.findUniqueHostedMember.mockResolvedValue({ ...member, threadContainer: { memberId: "room" } });
    const room = await readHostedMemberAssistantModelPreference({ memberId: "room", prisma: createReadClient() });
    expect(room.availableModels).not.toContain("gpt-6-astra");
    expect(room.model).not.toBe("gpt-6-astra");
  });

  it("keeps Astra from Max to Edge, falls back on Pulse, and restores it on Edge", async () => {
    for (const [plan, model] of [
      ["launch_max_monthly", "gpt-6-astra"],
      ["launch_edge_monthly", "gpt-6-astra"],
      ["launch_monthly", "gpt-6.1-sol"],
      ["launch_edge_monthly", "gpt-6-astra"],
    ]) {
      mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
        assistantModelPreference: "gpt-6-astra", currentBillingPlanCode: plan,
      }));
      const result = await readHostedMemberAssistantModelPreference({ memberId: "member_premium", prisma: createReadClient() });
      expect(result.model).toBe(model);
    }
    expect(mocks.updateHostedMember).not.toHaveBeenCalled();
  });

  it("resolves an eligible stored Sol preference to the runtime override", async () => {
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: "gpt-5.6-sol",
    }));

    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_edge",
      prisma: createReadClient(),
    })).resolves.toMatchObject({
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      reasoningEffort: "low",
      solAvailable: true,
    });
  });

  it("resolves an active Family Edge member's stored Sol preference to the runtime override", async () => {
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: "gpt-5.6-sol",
      billingStatus: HostedBillingStatus.not_started,
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      familyBillingStatus: HostedBillingStatus.active,
      familyPlanCode: "edge",
    }));

    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_family_edge",
      prisma: createReadClient(),
    })).resolves.toMatchObject({
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      reasoningEffort: "low",
      solAvailable: true,
    });
  });

  it("resolves Luna and explicit reasoning as next-turn runtime overrides", async () => {
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: "gpt-5.6-luna",
      assistantReasoningEffortPreference: "high",
    }));

    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_edge",
      prisma: createReadClient(),
    })).resolves.toEqual({
      availableModels: [
        "gpt-6.1-sol",
        "gpt-6-sol",
        "gpt-6-luna",
        "gpt-5.6-luna",
        "gpt-5.6-sol",
        "gpt-6-astra",
      ],
      availableReasoningEfforts: ["low", "medium", "high", "xhigh"],
      configurationAvailable: true,
      dormantSolPreference: false,
      hostedAssistantModelOverride: "gpt-5.6-luna",
      hostedAssistantReasoningEffortOverride: "high",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      solAvailable: true,
    });
  });

  it("defaults synthetic thread-container runtimes to Sol with room model controls", async () => {
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
      billingStatus: HostedBillingStatus.not_started,
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      threadContainerMemberId: "member_group_chat",
    }));

    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_group_chat",
      prisma: createReadClient(),
    })).resolves.toEqual({
      availableModels: [
        "gpt-6.1-sol",
        "gpt-6-sol",
        "gpt-6-luna",
        "gpt-5.6-luna",
        "gpt-5.6-sol",
      ],
      availableReasoningEfforts: ["low"],
      configurationAvailable: true,
      dormantSolPreference: false,
      hostedAssistantModelOverride: "gpt-6.1-sol",
      model: "gpt-6.1-sol",
      reasoningEffort: "low",
      solAvailable: true,
    });
  });

  it("stores an explicit GPT-6 Luna override for a synthetic thread-container", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
      billingStatus: HostedBillingStatus.not_started,
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      threadContainerMemberId: "member_group_chat",
    }));

    const result = await updateHostedMemberAssistantConfigurationTx({
      memberId: "member_group_chat",
      model: "gpt-6-luna",
      prisma: tx,
    });

    expect(result).toMatchObject({
      effectiveModelUpdated: true,
      model: "gpt-6-luna",
      solAvailable: true,
      updated: true,
    });
    expect(result.hostedAssistantModelOverride).toBe("gpt-6-luna");
    expect(mocks.updateHostedMember).toHaveBeenCalledWith({
      data: {
        assistantModelPreference: "gpt-6-luna",
      },
      where: {
        id: "member_group_chat",
      },
    });
  });

  it("restores the derived Sol default by clearing the group room override", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: "gpt-6-luna",
      billingStatus: HostedBillingStatus.not_started,
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      threadContainerMemberId: "member_group_chat",
    }));

    await expect(updateHostedMemberAssistantConfigurationTx({
      memberId: "member_group_chat",
      model: "gpt-6.1-sol",
      prisma: tx,
    })).resolves.toMatchObject({
      effectiveModelUpdated: true,
      hostedAssistantModelOverride: "gpt-6.1-sol",
      model: "gpt-6.1-sol",
      updated: true,
    });
    expect(mocks.updateHostedMember).toHaveBeenCalledWith({
      data: {
        assistantModelPreference: null,
      },
      where: {
        id: "member_group_chat",
      },
    });
  });

  it("keeps reasoning controls personal for a synthetic thread-container", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
      billingStatus: HostedBillingStatus.not_started,
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      threadContainerMemberId: "member_group_chat",
    }));

    for (const update of [
      { reasoningEffort: "high" as const },
    ]) {
      await expect(updateHostedMemberAssistantConfigurationTx({
        memberId: "member_group_chat",
        prisma: tx,
        ...update,
      })).rejects.toMatchObject({
        code: "ASSISTANT_CONFIGURATION_PERSONAL_CHAT_REQUIRED",
        httpStatus: 403,
      });
    }

    expect(mocks.updateHostedMember).not.toHaveBeenCalled();
  });

  it("falls back to GPT-6 Sol for stale, missing, and ineligible preferences", async () => {
    const prisma = createReadClient();
    mocks.findUniqueHostedMember
      .mockResolvedValueOnce(buildMemberState({
        assistantModelPreference: "retired-model",
      }))
      .mockResolvedValueOnce(buildMemberState({
        assistantModelPreference: "gpt-5.6-sol",
        billingStatus: HostedBillingStatus.not_started,
        currentBillingPhase: null,
        currentBillingPlanCode: null,
        familyBillingStatus: HostedBillingStatus.active,
        familyPlanCode: "pulse",
      }))
      .mockResolvedValueOnce(null);

    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_stale",
      prisma,
    })).resolves.toMatchObject({
      dormantSolPreference: false,
      model: "gpt-6.1-sol",
      reasoningEffort: "low",
      solAvailable: true,
    });
    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_family_sponsored",
      prisma,
    })).resolves.toMatchObject({
      dormantSolPreference: true,
      model: "gpt-6.1-sol",
      reasoningEffort: "low",
      solAvailable: false,
    });
    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_missing",
      prisma,
    })).resolves.toMatchObject({
      configurationAvailable: false,
      dormantSolPreference: false,
      model: "gpt-6.1-sol",
      reasoningEffort: "low",
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
    })).resolves.toMatchObject({
      dormantSolPreference: true,
      model: "gpt-6.1-sol",
      reasoningEffort: "low",
      solAvailable: false,
    });
    expect(mocks.updateHostedMember).not.toHaveBeenCalled();

    currentBillingPlanCode = "launch_edge_monthly";

    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_edge",
      prisma,
    })).resolves.toMatchObject({
      dormantSolPreference: false,
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      reasoningEffort: "low",
      solAvailable: true,
    });
    expect(mocks.updateHostedMember).not.toHaveBeenCalled();
  });

  it("updates reasoning without erasing dormant Sol intent on Pulse", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: "gpt-5.6-sol",
      currentBillingPlanCode: "launch_monthly",
    }));

    await expect(updateHostedMemberAssistantConfigurationTx({
      memberId: "member_pulse",
      prisma: tx,
      reasoningEffort: "high",
    })).resolves.toMatchObject({
      dormantSolPreference: true,
      hostedAssistantReasoningEffortOverride: "high",
      model: "gpt-6.1-sol",
      reasoningEffort: "high",
      solAvailable: false,
      updated: true,
    });
    expect(mocks.updateHostedMember).toHaveBeenCalledWith({
      data: {
        assistantReasoningEffortPreference: "high",
      },
      where: {
        id: "member_pulse",
      },
    });
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
    })).resolves.toMatchObject({
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      reasoningEffort: "low",
      solAvailable: true,
      effectiveModelUpdated: true,
      updated: true,
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(tx, "member_edge");
    expect(mocks.lockHostedMemberSponsoredAccessRows).toHaveBeenCalledWith(
      tx,
      "member_edge",
    );
    expect(mocks.updateHostedMember).toHaveBeenCalledWith({
      data: {
        assistantModelPreference: "gpt-5.6-sol",
      },
      where: {
        id: "member_edge",
      },
    });
  });

  it("locks current sponsorship and saves Sol for an active Family Edge member", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
      billingStatus: HostedBillingStatus.not_started,
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      familyBillingStatus: HostedBillingStatus.active,
      familyPlanCode: "edge",
    }));

    await expect(updateHostedMemberAssistantModelPreferenceTx({
      memberId: "member_family_edge",
      model: "gpt-5.6-sol",
      prisma: tx,
    })).resolves.toMatchObject({
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      solAvailable: true,
      effectiveModelUpdated: true,
      updated: true,
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(tx, "member_family_edge");
    expect(mocks.lockHostedMemberSponsoredAccessRows).toHaveBeenCalledWith(
      tx,
      "member_family_edge",
    );
    expect(mocks.lockHostedMemberRow.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0]!);
    expect(mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.findUniqueHostedMember.mock.invocationCallOrder[0]!);
    expect(mocks.updateHostedMember).toHaveBeenCalledWith({
      data: {
        assistantModelPreference: "gpt-5.6-sol",
      },
      where: {
        id: "member_family_edge",
      },
    });
  });

  it("stores Luna and reasoning together while keeping low as the reasoning default", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
    }));

    await expect(updateHostedMemberAssistantConfigurationTx({
      memberId: "member_edge",
      model: "gpt-5.6-luna",
      prisma: tx,
      reasoningEffort: "high",
    })).resolves.toMatchObject({
      hostedAssistantModelOverride: "gpt-5.6-luna",
      hostedAssistantReasoningEffortOverride: "high",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      updated: true,
    });
    expect(mocks.updateHostedMember).toHaveBeenCalledWith({
      data: {
        assistantModelPreference: "gpt-5.6-luna",
        assistantReasoningEffortPreference: "high",
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
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      familyBillingStatus: HostedBillingStatus.active,
      familyPlanCode: "pulse",
    }));

    await expect(updateHostedMemberAssistantModelPreferenceTx({
      memberId: "member_family_sponsored",
      model: "gpt-5.6-sol",
      prisma: tx,
    })).rejects.toMatchObject({
      code: "ASSISTANT_MODEL_SOL_REQUIRES_EDGE",
      httpStatus: 403,
      message: "GPT-5.6 Sol requires an active paid Edge or Max plan.",
    });
    expect(mocks.updateHostedMember).not.toHaveBeenCalled();
  });

  it("stores an explicit preference when GPT-6 Sol is selected on an active Pulse plan", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: "retired-model",
      currentBillingPlanCode: "launch_monthly",
    }));

    await expect(updateHostedMemberAssistantModelPreferenceTx({
      memberId: "member_stale",
      model: "gpt-6.1-sol",
      prisma: tx,
    })).resolves.toMatchObject({
      dormantSolPreference: false,
      model: "gpt-6.1-sol",
      reasoningEffort: "low",
      solAvailable: false,
      effectiveModelUpdated: false,
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
      memberId: "member_sol",
      model: "gpt-6.1-sol",
      prisma: tx,
    })).resolves.toMatchObject({
      model: "gpt-6.1-sol",
      updated: false,
    });
    expect(mocks.updateHostedMember).not.toHaveBeenCalled();
  });

});

function buildMemberState(input: {
  assistantModelPreference: string | null;
  assistantReasoningEffortPreference?: string | null;
  billingStatus?: HostedBillingStatus;
  currentBillingPhase?: string | null;
  currentBillingPlanCode?: string | null;
  familyBillingStatus?: HostedBillingStatus | null;
  familyMembershipStatus?: string;
  familyPlanCode?: string;
  familySuspendedAt?: Date | null;
  suspendedAt?: Date | null;
  threadContainerMemberId?: string | null;
}) {
  return {
    accountGroupMemberships: input.familyBillingStatus === undefined
      ? []
      : [{
          group: {
            billingStatus: input.familyBillingStatus,
            suspendedAt: input.familySuspendedAt ?? null,
          },
          planCode: input.familyPlanCode ?? "pulse",
          status: input.familyMembershipStatus ?? "active",
        }],
    assistantModelPreference: input.assistantModelPreference,
    assistantReasoningEffortPreference:
      input.assistantReasoningEffortPreference ?? null,
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
