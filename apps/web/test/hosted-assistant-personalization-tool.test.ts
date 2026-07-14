import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedMemberAssistantPersonalizationEligible: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMemberAssistantModelPreference: vi.fn(),
  readHostedMemberAssistantPreferences: vi.fn(),
  scheduleMailboxWake: vi.fn(),
  transaction: vi.fn(),
  upsertHostedMemberAssistantPreferencesTx: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-onboarding/assistant-model-preference", () => ({
  assertHostedMemberAssistantPersonalizationEligible:
    mocks.assertHostedMemberAssistantPersonalizationEligible,
  readHostedMemberAssistantModelPreference:
    mocks.readHostedMemberAssistantModelPreference,
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

  it("rejects updates inside the transaction when canonical hosted access is inactive", async () => {
    const accessError = hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Hosted access is required.",
    });
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValue(accessError);

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { preferenceCausalSeq: "41" },
      memberId: "member_personalization_inactive",
      request: { action: "update", tone: "casual" },
    })).rejects.toBe(accessError);
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: "member_personalization_inactive",
      prisma: { tx: true },
    });
    expect(mocks.assertHostedMemberAssistantPersonalizationEligible).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(mocks.scheduleMailboxWake).not.toHaveBeenCalled();
  });

  it("saves a style-only update while reading the effective model from its canonical owner", async () => {
    vi.stubEnv("MURPH_ASSISTANT_PERSONALITY_CAUSAL_WRITES_ENABLED", "0");

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { preferenceCausalSeq: "42" },
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
        solAvailable: false,
        status: "saved",
        tone: "casual",
        voice: "warm",
      },
    });
    expect(mocks.readHostedMemberAssistantModelPreference).toHaveBeenCalledWith({
      memberId: "member_personalization_1",
      prisma: { tx: true },
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxPayloadMode: "legacy_snapshot",
        causalOrigin: "turn",
        memberId: "member_personalization_1",
        preferenceCausalSeq: "42",
        preferences: { voice: "warm" },
        prisma: { tx: true },
      }),
    );
    expect(mocks.scheduleMailboxWake).toHaveBeenCalledWith({
      expectedUserId: "member_personalization_1",
      mailboxItemId: "mailbox_preferences_1",
    });
  });

  it("returns truthful effective values for an idempotent no-op", async () => {
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      assistantTone: "formal",
      assistantVoice: "warm",
      dispatch: null,
      updated: false,
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { preferenceCausalSeq: "43" },
      memberId: "member_personalization_1",
      request: {
        action: "update",
        tone: "formal",
      },
      scheduleMailboxWake: mocks.scheduleMailboxWake,
    })).resolves.toMatchObject({
      result: {
        model: "gpt-5.6-terra",
        modelChangeAppliesNextRun: false,
        modelUpdated: false,
        solAvailable: false,
        status: "unchanged",
        tone: "formal",
        voice: "warm",
      },
    });
    expect(mocks.scheduleMailboxWake).not.toHaveBeenCalled();
  });
});
