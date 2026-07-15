import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertActiveHostedMemberAccessAllowed: vi.fn(),
  assertHostedMemberAssistantPersonalizationEligible: vi.fn(),
  getPrisma: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  lockHostedMemberSponsoredAccessRows: vi.fn(),
  readHostedMemberAssistantModelPreference: vi.fn(),
  readHostedMemberAssistantPreferences: vi.fn(),
  readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx: vi.fn(),
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
vi.mock("@/src/lib/hosted-onboarding/shared", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >();
  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
    lockHostedMemberSponsoredAccessRows: mocks.lockHostedMemberSponsoredAccessRows,
  };
});
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx:
    mocks.readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx,
}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  handleHostedRuntimeAssistantPersonalizationTool,
  resolveHostedRuntimeAssistantPreferenceCausalSeq,
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
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.lockHostedMemberSponsoredAccessRows.mockResolvedValue(undefined);
    mocks.readHostedMemberAssistantPreferences.mockResolvedValue({
      tone: "formal",
      voice: "warm",
    });
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValue({
      model: "gpt-5.6-terra",
      solAvailable: false,
    });
    mocks.readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx.mockResolvedValue("42");
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

  it("resolves a member-bound causal sequence under the canonical access locks", async () => {
    await expect(resolveHostedRuntimeAssistantPreferenceCausalSeq({
      authority: { assistantInputId: "ain_66666666666666666666666666666666" },
      memberId: "member_personalization_1",
    })).resolves.toEqual({
      action: "resolve_preference_causal_seq",
      result: { causalSeq: "42" },
    });

    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(
      { tx: true },
      "member_personalization_1",
    );
    expect(mocks.lockHostedMemberSponsoredAccessRows).toHaveBeenCalledWith(
      { tx: true },
      "member_personalization_1",
    );
    expect(mocks.lockHostedMemberRow.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0]!,
    );
    expect(
      mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.assertActiveHostedMemberAccessAllowed.mock.invocationCallOrder[0]!,
    );
    expect(
      mocks.assertActiveHostedMemberAccessAllowed.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.assertHostedMemberAssistantPersonalizationEligible
        .mock.invocationCallOrder[0]!,
    );
    expect(
      mocks.readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx,
    ).toHaveBeenCalledWith({
      assistantInputId: "ain_66666666666666666666666666666666",
      memberId: "member_personalization_1",
      prisma: { tx: true },
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(mocks.scheduleMailboxWake).not.toHaveBeenCalled();
  });

  it("rejects causal-sequence resolution without canonical mailbox authority", async () => {
    mocks.readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx
      .mockResolvedValue(null);

    await expect(resolveHostedRuntimeAssistantPreferenceCausalSeq({
      authority: { assistantInputId: "ain_77777777777777777777777777777777" },
      memberId: "member_personalization_1",
    })).rejects.toThrow("input authority is invalid");

    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(mocks.scheduleMailboxWake).not.toHaveBeenCalled();
  });

  it("rejects updates inside the transaction when canonical hosted access is inactive", async () => {
    const accessError = hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Hosted access is required.",
    });
    mocks.assertActiveHostedMemberAccessAllowed.mockRejectedValue(accessError);

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_11111111111111111111111111111111" },
      memberId: "member_personalization_inactive",
      request: { action: "update", tone: "casual" },
    })).rejects.toBe(accessError);
    expect(mocks.assertActiveHostedMemberAccessAllowed).toHaveBeenCalledWith({
      memberId: "member_personalization_inactive",
      prisma: { tx: true },
    });
    expect(mocks.assertHostedMemberAssistantPersonalizationEligible).not.toHaveBeenCalled();
    expect(
      mocks.readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx,
    ).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(mocks.scheduleMailboxWake).not.toHaveBeenCalled();
  });

  it("locks every active-access owner before rechecking update eligibility", async () => {
    await handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_55555555555555555555555555555555" },
      memberId: "member_personalization_1",
      request: { action: "update", tone: "casual" },
    });

    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(
      { tx: true },
      "member_personalization_1",
    );
    expect(mocks.lockHostedMemberSponsoredAccessRows).toHaveBeenCalledWith(
      { tx: true },
      "member_personalization_1",
    );
    expect(mocks.lockHostedMemberRow.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0]!,
    );
    expect(
      mocks.lockHostedMemberSponsoredAccessRows.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.assertActiveHostedMemberAccessAllowed.mock.invocationCallOrder[0]!,
    );
    expect(
      mocks.assertActiveHostedMemberAccessAllowed.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.assertHostedMemberAssistantPersonalizationEligible.mock.invocationCallOrder[0]!,
    );
  });

  it("rejects updates without assistant input authority", async () => {
    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_1",
      request: { action: "update", tone: "casual" },
    })).rejects.toThrow("requires assistant input authority");

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(
      mocks.readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx,
    ).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
  });

  it("saves a style-only update while reading the effective model from its canonical owner", async () => {
    vi.stubEnv("MURPH_ASSISTANT_PERSONALITY_CAUSAL_WRITES_ENABLED", "0");

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_22222222222222222222222222222222" },
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
    expect(
      mocks.readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx,
    ).toHaveBeenCalledWith({
      assistantInputId: "ain_22222222222222222222222222222222",
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

  it("returns unchanged while dispatching a same-value causal barrier", async () => {
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      assistantTone: "formal",
      assistantVoice: "warm",
      dispatch: { mailboxItemId: "mailbox_preferences_barrier" },
      updated: false,
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_33333333333333333333333333333333" },
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
    expect(mocks.scheduleMailboxWake).toHaveBeenCalledWith({
      expectedUserId: "member_personalization_1",
      mailboxItemId: "mailbox_preferences_barrier",
    });
  });

  it("rejects an assistant input that has no canonical mailbox authority", async () => {
    mocks.readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx.mockResolvedValue(null);

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_44444444444444444444444444444444" },
      memberId: "member_personalization_1",
      request: { action: "update", tone: "casual" },
    })).rejects.toThrow("input authority is invalid");

    expect(
      mocks.readHostedMailboxPreferenceCausalSeqByAssistantInputIdTx,
    ).toHaveBeenCalledWith({
      assistantInputId: "ain_44444444444444444444444444444444",
      memberId: "member_personalization_1",
      prisma: { tx: true },
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(mocks.scheduleMailboxWake).not.toHaveBeenCalled();
  });
});
