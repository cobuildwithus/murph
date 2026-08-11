import { HostedBillingStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  isHostedVeniceAssistantEnabled,
  isHostedMemberSolModelEligible,
  readHostedMemberAssistantModelPreference,
  resolveAvailableHostedAssistantProvider,
  updateHostedMemberAssistantConfigurationTx,
  updateHostedMemberAssistantModelPreferenceTx,
} from "@/src/lib/hosted-onboarding/assistant-model-preference";

describe("hosted member assistant model preference", () => {
  beforeEach(() => {
    delete process.env.HOSTED_VENICE_ENABLED;
    vi.clearAllMocks();
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.lockHostedMemberSponsoredAccessRows.mockResolvedValue(undefined);
    mocks.updateHostedMember.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.HOSTED_VENICE_ENABLED;
  });

  it("keeps OpenAI as the fail-closed provider until Venice is enabled", () => {
    expect(isHostedVeniceAssistantEnabled({})).toBe(false);
    expect(resolveAvailableHostedAssistantProvider("venice", {})).toBe("openai");
    expect(resolveAvailableHostedAssistantProvider("venice", {
      HOSTED_VENICE_ENABLED: "1",
    })).toBe("venice");
    expect(resolveAvailableHostedAssistantProvider(null, {
      HOSTED_VENICE_ENABLED: "1",
    })).toBe("openai");
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

  it("keeps Terra while resolving Venice as an independent provider override", async () => {
    process.env.HOSTED_VENICE_ENABLED = "1";
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
      assistantProviderPreference: "venice",
    }));

    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_edge",
      prisma: createReadClient(),
    })).resolves.toMatchObject({
      availableProviders: ["openai", "venice"],
      hostedAssistantProviderOverride: "venice",
      model: "gpt-5.6-terra",
      provider: "venice",
      reasoningEffort: "low",
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
        "gpt-5.6-luna",
        "gpt-5.6-terra",
        "gpt-5.6-sol",
      ],
      availableProviders: ["openai"],
      availableReasoningEfforts: ["low", "medium", "high", "xhigh"],
      configurationAvailable: true,
      customInferenceReverificationRequired: false,
      customInferenceSelected: false,
      dormantSolPreference: false,
      hostedAssistantModelOverride: "gpt-5.6-luna",
      hostedAssistantReasoningEffortOverride: "high",
      model: "gpt-5.6-luna",
      provider: "openai",
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
        "gpt-5.6-luna",
        "gpt-5.6-terra",
        "gpt-5.6-sol",
      ],
      availableProviders: ["openai"],
      availableReasoningEfforts: ["low"],
      configurationAvailable: true,
      customInferenceReverificationRequired: false,
      customInferenceSelected: false,
      dormantSolPreference: false,
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      provider: "openai",
      reasoningEffort: "low",
      solAvailable: true,
    });
  });

  it("stores an explicit Terra override for a synthetic thread-container", async () => {
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
      model: "gpt-5.6-terra",
      prisma: tx,
    });

    expect(result).toMatchObject({
      effectiveModelUpdated: true,
      model: "gpt-5.6-terra",
      solAvailable: true,
      updated: true,
    });
    expect(result).not.toHaveProperty("hostedAssistantModelOverride");
    expect(mocks.updateHostedMember).toHaveBeenCalledWith({
      data: {
        assistantModelPreference: "gpt-5.6-terra",
      },
      where: {
        id: "member_group_chat",
      },
    });
  });

  it("restores the derived Sol default by clearing the group room override", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: "gpt-5.6-terra",
      billingStatus: HostedBillingStatus.not_started,
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      threadContainerMemberId: "member_group_chat",
    }));

    await expect(updateHostedMemberAssistantConfigurationTx({
      memberId: "member_group_chat",
      model: "gpt-5.6-sol",
      prisma: tx,
    })).resolves.toMatchObject({
      effectiveModelUpdated: true,
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
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

  it("keeps provider and reasoning controls personal for a synthetic thread-container", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
      billingStatus: HostedBillingStatus.not_started,
      currentBillingPhase: null,
      currentBillingPlanCode: null,
      threadContainerMemberId: "member_group_chat",
    }));

    for (const update of [
      { provider: "venice" as const },
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

  it("falls back to Terra for stale, missing, and ineligible preferences", async () => {
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
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      solAvailable: true,
    });
    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_family_sponsored",
      prisma,
    })).resolves.toMatchObject({
      dormantSolPreference: true,
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
      solAvailable: false,
    });
    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_missing",
      prisma,
    })).resolves.toMatchObject({
      configurationAvailable: false,
      dormantSolPreference: false,
      model: "gpt-5.6-terra",
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
      model: "gpt-5.6-terra",
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
      model: "gpt-5.6-terra",
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

  it("stores Venice independently from the selected product model", async () => {
    process.env.HOSTED_VENICE_ENABLED = "1";
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
      assistantProviderPreference: null,
    }));

    await expect(updateHostedMemberAssistantConfigurationTx({
      memberId: "member_edge",
      prisma: tx,
      provider: "venice",
    })).resolves.toMatchObject({
      effectiveProviderUpdated: true,
      hostedAssistantProviderOverride: "venice",
      model: "gpt-5.6-terra",
      updated: true,
    });
    expect(mocks.updateHostedMember).toHaveBeenCalledWith({
      data: {
        assistantProviderPreference: "venice",
      },
      where: {
        id: "member_edge",
      },
    });
  });

  it("rejects Venice updates while the rollout gate is closed", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
      assistantProviderPreference: null,
    }));

    await expect(updateHostedMemberAssistantConfigurationTx({
      memberId: "member_edge",
      prisma: tx,
      provider: "venice",
    })).rejects.toMatchObject({
      code: "ASSISTANT_PROVIDER_VENICE_UNAVAILABLE",
      httpStatus: 403,
    });
    expect(mocks.updateHostedMember).not.toHaveBeenCalled();
  });

  it("clears the stored provider override when switching back to OpenAI", async () => {
    process.env.HOSTED_VENICE_ENABLED = "1";
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: null,
      assistantProviderPreference: "venice",
    }));

    const result = await updateHostedMemberAssistantConfigurationTx({
      memberId: "member_edge",
      prisma: tx,
      provider: "openai",
    });

    expect(result).toMatchObject({
      effectiveProviderUpdated: true,
      model: "gpt-5.6-terra",
      updated: true,
    });
    expect(result).not.toHaveProperty("hostedAssistantProviderOverride");
    expect(mocks.updateHostedMember).toHaveBeenCalledWith({
      data: {
        assistantProviderPreference: null,
      },
      where: {
        id: "member_edge",
      },
    });
  });

  it("preserves dormant Sol across a provider switch and restores it with Edge", async () => {
    process.env.HOSTED_VENICE_ENABLED = "1";
    const tx = createTransactionClient();
    const prisma = createReadClient();
    let currentBillingPlanCode = "launch_monthly";
    let storedProvider: string | null = null;
    mocks.findUniqueHostedMember.mockImplementation(() => Promise.resolve(
      buildMemberState({
        assistantModelPreference: "gpt-5.6-sol",
        assistantProviderPreference: storedProvider,
        currentBillingPlanCode,
      }),
    ));

    await expect(updateHostedMemberAssistantConfigurationTx({
      memberId: "member_pulse",
      prisma: tx,
      provider: "venice",
    })).resolves.toMatchObject({
      dormantSolPreference: true,
      hostedAssistantProviderOverride: "venice",
      model: "gpt-5.6-terra",
      updated: true,
    });
    expect(mocks.updateHostedMember).toHaveBeenCalledWith({
      data: {
        assistantProviderPreference: "venice",
      },
      where: {
        id: "member_pulse",
      },
    });

    storedProvider = "venice";
    currentBillingPlanCode = "launch_edge_monthly";

    await expect(readHostedMemberAssistantModelPreference({
      memberId: "member_pulse",
      prisma,
    })).resolves.toMatchObject({
      dormantSolPreference: false,
      hostedAssistantModelOverride: "gpt-5.6-sol",
      hostedAssistantProviderOverride: "venice",
      model: "gpt-5.6-sol",
      solAvailable: true,
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
      effectiveProviderUpdated: false,
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

  it("stores Luna and reasoning together while keeping Terra and low as defaults", async () => {
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

  it("clears stale preferences when Terra is selected on an active Pulse plan", async () => {
    const tx = createTransactionClient();
    mocks.findUniqueHostedMember.mockResolvedValue(buildMemberState({
      assistantModelPreference: "retired-model",
      currentBillingPlanCode: "launch_monthly",
    }));

    await expect(updateHostedMemberAssistantModelPreferenceTx({
      memberId: "member_stale",
      model: "gpt-5.6-terra",
      prisma: tx,
    })).resolves.toMatchObject({
      effectiveProviderUpdated: false,
      dormantSolPreference: false,
      model: "gpt-5.6-terra",
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
  assistantProviderPreference?: string | null;
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
    assistantProviderPreference: input.assistantProviderPreference ?? null,
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
