import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedMemberAssistantPersonalizationEligible: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMemberAssistantModelPreference: vi.fn(),
  readHostedMemberAssistantPreferences: vi.fn(),
  scheduleMailboxWake: vi.fn(),
  transaction: vi.fn(),
  updateHostedMemberAssistantModelPreferenceTx: vi.fn(),
  upsertHostedMemberAssistantPreferencesTx: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-onboarding/assistant-model-preference", () => ({
  assertHostedMemberAssistantPersonalizationEligible:
    mocks.assertHostedMemberAssistantPersonalizationEligible,
  readHostedMemberAssistantModelPreference:
    mocks.readHostedMemberAssistantModelPreference,
  updateHostedMemberAssistantModelPreferenceTx:
    mocks.updateHostedMemberAssistantModelPreferenceTx,
}));
vi.mock("@/src/lib/hosted-onboarding/member-preferences", () => ({
  readHostedMemberAssistantPreferences: mocks.readHostedMemberAssistantPreferences,
  upsertHostedMemberAssistantPreferencesTx:
    mocks.upsertHostedMemberAssistantPreferencesTx,
}));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  assertActiveHostedMemberAccessAllowed: mocks.assertActiveHostedMemberAccessAllowed,
}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  handleHostedRuntimeAssistantPersonalizationTool,
} from "@/src/lib/hosted-execution/assistant-personalization-tool";

describe("hosted assistant personalization tool owner adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MURPH_ASSISTANT_PERSONALITY_CAUSAL_WRITES_ENABLED", "1");
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback({ tx: true }),
    );
    mocks.getPrisma.mockReturnValue({ $transaction: mocks.transaction });
    mocks.assertActiveHostedMemberAccessAllowed.mockResolvedValue(undefined);
    mocks.assertHostedMemberAssistantPersonalizationEligible.mockResolvedValue(undefined);
    mocks.readHostedMemberAssistantPreferences.mockResolvedValue({
      tone: "formal",
      voice: "warm",
    });
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValue({
      model: "gpt-5.6-terra",
      solAvailable: false,
    });
    mocks.updateHostedMemberAssistantModelPreferenceTx.mockResolvedValue({
      hostedAssistantModelOverride: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      solAvailable: true,
      effectiveModelUpdated: true,
      updated: true,
    });
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      assistantTone: "casual",
      assistantVoice: "warm",
      dispatch: { mailboxItemId: "mailbox_preferences_1" },
      updated: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the effective hosted snapshot without opening a mutation transaction", async () => {
    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_1",
      request: { action: "read" },
    })).resolves.toEqual({
      action: "read",
      result: {
        model: "gpt-5.6-terra",
        solAvailable: false,
        tone: "formal",
        voice: "warm",
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: "member_personalization_1",
      prisma: { $transaction: mocks.transaction },
    });
    expect(mocks.assertHostedMemberAssistantPersonalizationEligible).toHaveBeenCalledWith({
      memberId: "member_personalization_1",
      prisma: { $transaction: mocks.transaction },
    });
  });

  it("rejects reads when canonical hosted access is inactive", async () => {
    const accessError = hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Hosted access is required.",
    });
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValue(accessError);

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_inactive",
      request: { action: "read" },
    })).rejects.toBe(accessError);
    expect(mocks.assertHostedMemberAssistantPersonalizationEligible).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberAssistantPreferences).not.toHaveBeenCalled();
  });

  it("projects canonical defaults without persisting unset style storage", async () => {
    mocks.readHostedMemberAssistantPreferences.mockResolvedValue({
      tone: null,
      voice: null,
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_1",
      request: { action: "read" },
    })).resolves.toEqual({
      action: "read",
      result: {
        model: "gpt-5.6-terra",
        solAvailable: false,
        tone: "formal",
        voice: "upbeat",
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
  });

  it("projects canonical defaults after a model-only update without persisting style", async () => {
    mocks.readHostedMemberAssistantPreferences.mockResolvedValue({
      tone: null,
      voice: null,
    });
    mocks.updateHostedMemberAssistantModelPreferenceTx.mockResolvedValue({
      model: "gpt-5.6-terra",
      solAvailable: false,
      effectiveModelUpdated: false,
      updated: false,
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_1",
      request: {
        action: "update",
        model: "gpt-5.6-terra",
      },
    })).resolves.toEqual({
      action: "update",
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        rejectionReason: null,
        solAvailable: false,
        status: "unchanged",
        styleUpdated: false,
        tone: "formal",
        updated: false,
        voice: "upbeat",
      },
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
  });

  it("rejects updates inside the transaction when canonical hosted access is inactive", async () => {
    const accessError = hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Hosted access is required.",
    });
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValue(accessError);

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_inactive",
      request: { action: "update", tone: "casual" },
    })).rejects.toBe(accessError);
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: "member_personalization_inactive",
      prisma: { tx: true },
    });
    expect(mocks.assertHostedMemberAssistantPersonalizationEligible).not.toHaveBeenCalled();
    expect(mocks.updateHostedMemberAssistantModelPreferenceTx).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(mocks.scheduleMailboxWake).not.toHaveBeenCalled();
  });

  it("saves a style-only update while reading the effective model from its canonical owner", async () => {
    vi.stubEnv("MURPH_ASSISTANT_PERSONALITY_CAUSAL_WRITES_ENABLED", "0");

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_1",
      request: {
        action: "update",
        voice: "warm",
      },
      scheduleMailboxWake: mocks.scheduleMailboxWake,
    })).resolves.toEqual({
      action: "update",
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        rejectionReason: null,
        solAvailable: false,
        status: "saved",
        styleUpdated: true,
        tone: "casual",
        updated: true,
        voice: "warm",
      },
    });
    expect(mocks.updateHostedMemberAssistantModelPreferenceTx).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberAssistantModelPreference).toHaveBeenCalledWith({
      memberId: "member_personalization_1",
      prisma: { tx: true },
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxPayloadMode: "legacy_snapshot",
        memberId: "member_personalization_1",
        preferences: { voice: "warm" },
        prisma: { tx: true },
      }),
    );
    expect(mocks.scheduleMailboxWake).toHaveBeenCalledWith({
      expectedUserId: "member_personalization_1",
      mailboxItemId: "mailbox_preferences_1",
    });
  });

  it("saves a dormant preference clear without claiming an effective model transition", async () => {
    mocks.updateHostedMemberAssistantModelPreferenceTx.mockResolvedValue({
      model: "gpt-5.6-terra",
      solAvailable: false,
      effectiveModelUpdated: false,
      updated: true,
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_1",
      request: {
        action: "update",
        model: "gpt-5.6-terra",
      },
    })).resolves.toMatchObject({
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        status: "saved",
        updated: true,
      },
    });
  });

  it("atomically saves combined changes and reports next-run model semantics", async () => {
    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_1",
      request: {
        action: "update",
        model: "gpt-5.6-sol",
        tone: "casual",
      },
      scheduleMailboxWake: mocks.scheduleMailboxWake,
    })).resolves.toEqual({
      action: "update",
      result: {
        model: "gpt-5.6-sol",
        modelChangeAppliesNextRun: true,
        modelUpdated: true,
        rejectionReason: null,
        solAvailable: true,
        status: "saved",
        styleUpdated: true,
        tone: "casual",
        updated: true,
        voice: "warm",
      },
    });
    expect(mocks.updateHostedMemberAssistantModelPreferenceTx).toHaveBeenCalledWith({
      memberId: "member_personalization_1",
      model: "gpt-5.6-sol",
      prisma: { tx: true },
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxPayloadMode: "sparse_delta",
        memberId: "member_personalization_1",
        preferences: { tone: "casual" },
        prisma: { tx: true },
      }),
    );
    expect(
      mocks.updateHostedMemberAssistantModelPreferenceTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.upsertHostedMemberAssistantPreferencesTx.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.scheduleMailboxWake).toHaveBeenCalledWith({
      expectedUserId: "member_personalization_1",
      mailboxItemId: "mailbox_preferences_1",
    });
  });

  it("returns truthful effective values for an idempotent no-op", async () => {
    mocks.updateHostedMemberAssistantModelPreferenceTx.mockResolvedValue({
      model: "gpt-5.6-terra",
      solAvailable: true,
      effectiveModelUpdated: false,
      updated: false,
    });
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      assistantTone: "formal",
      assistantVoice: "warm",
      dispatch: null,
      updated: false,
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_1",
      request: {
        action: "update",
        model: "gpt-5.6-terra",
        tone: "formal",
      },
      scheduleMailboxWake: mocks.scheduleMailboxWake,
    })).resolves.toMatchObject({
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        solAvailable: true,
        status: "unchanged",
        styleUpdated: false,
        tone: "formal",
        updated: false,
        voice: "warm",
      },
    });
    expect(mocks.scheduleMailboxWake).not.toHaveBeenCalled();
  });

  it("rejects ineligible Sol before applying style or appending its mailbox event", async () => {
    mocks.updateHostedMemberAssistantModelPreferenceTx.mockRejectedValue(
      hostedOnboardingError({
        code: "ASSISTANT_MODEL_SOL_REQUIRES_EDGE",
        httpStatus: 403,
        message: "GPT-5.6 Sol requires an active paid Edge plan.",
      }),
    );

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_1",
      request: {
        action: "update",
        model: "gpt-5.6-sol",
        tone: "casual",
      },
      scheduleMailboxWake: mocks.scheduleMailboxWake,
    })).resolves.toEqual({
      action: "update",
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        rejectionReason: "sol_requires_edge",
        solAvailable: false,
        status: "rejected",
        styleUpdated: false,
        tone: "formal",
        updated: false,
        voice: "warm",
      },
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(mocks.scheduleMailboxWake).not.toHaveBeenCalled();
  });
});
