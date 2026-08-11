import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedLinqRouteEgressAuthority: vi.fn(),
  findUniqueHostedThreadContainer: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMemberAssistantModelPreference: vi.fn(),
  readHostedMemberAssistantPreferences: vi.fn(),
  readHostedMailboxConversationWakeByAssistantInputId: vi.fn(),
  readHostedMailboxConversationInputAuthorityByAssistantInputIdTx: vi.fn(),
  requireHostedRuntimeActiveAccess: vi.fn(),
  requireHostedRuntimeActiveAccessForUpdateTx: vi.fn(),
  scheduleMailboxWake: vi.fn(),
  transaction: vi.fn(),
  upsertHostedMemberAssistantPreferencesTx: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/src/lib/hosted-onboarding/assistant-model-preference", () => ({
  readHostedMemberAssistantModelPreference:
    mocks.readHostedMemberAssistantModelPreference,
}));
vi.mock("@/src/lib/hosted-onboarding/member-preferences", () => ({
  readHostedMemberAssistantPreferences: mocks.readHostedMemberAssistantPreferences,
  upsertHostedMemberAssistantPreferencesTx:
    mocks.upsertHostedMemberAssistantPreferencesTx,
}));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  requireHostedRuntimeActiveAccess: mocks.requireHostedRuntimeActiveAccess,
  requireHostedRuntimeActiveAccessForUpdateTx:
    mocks.requireHostedRuntimeActiveAccessForUpdateTx,
}));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxConversationWakeByAssistantInputId:
    mocks.readHostedMailboxConversationWakeByAssistantInputId,
  readHostedMailboxConversationInputAuthorityByAssistantInputIdTx:
    mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
}));
vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedLinqRouteEgressAuthority: mocks.assertHostedLinqRouteEgressAuthority,
}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  handleHostedRuntimeAssistantPersonalizationTool,
} from "@/src/lib/hosted-execution/assistant-personalization-tool";

describe("hosted assistant personalization tool owner adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const tx = {
      hostedThreadContainer: {
        findUnique: mocks.findUniqueHostedThreadContainer,
      },
      tx: true,
    };
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
    );
    mocks.getPrisma.mockReturnValue({
      $transaction: mocks.transaction,
      hostedThreadContainer: tx.hostedThreadContainer,
    });
    mocks.assertHostedLinqRouteEgressAuthority.mockResolvedValue({
      containerMemberId: "member_group_runtime",
    });
    mocks.findUniqueHostedThreadContainer.mockResolvedValue(null);
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue({
      eventId: "evt_direct_style",
      kind: "conversation.message",
      message: {
        channel: "telegram",
        telegramMessage: {
          messageId: "telegram_direct_style",
          schema: "murph.hosted-telegram-message.v1",
          threadId: "telegram_direct_thread",
        },
      },
      occurredAt: "2026-07-16T00:00:00.000Z",
      userId: "member_personalization_1",
    });
    mocks.requireHostedRuntimeActiveAccess.mockResolvedValue(undefined);
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(undefined);
    mocks.readHostedMemberAssistantPreferences.mockResolvedValue({
      personality: {
        detail: null,
        humor: null,
        push: null,
        unhinged: null,
      },
      tone: "formal",
      voice: "warm",
    });
    mocks.readHostedMemberAssistantModelPreference.mockResolvedValue({
      model: "gpt-5.6-terra",
      solAvailable: false,
    });
    mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx.mockResolvedValue({
      causalSeq: "42",
      occurredAt: "2026-07-16T00:00:00.000Z",
    });
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      appliedFields: ["voice"],
      assistantPersonality: {
        detail: null,
        humor: null,
        push: null,
        unhinged: null,
      },
      assistantTone: "casual",
      assistantVoice: "warm",
      dispatch: { mailboxItemId: "mailbox_preferences_1" },
      updated: true,
    });
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
    expect(mocks.requireHostedRuntimeActiveAccess).toHaveBeenCalledWith(
      "member_personalization_1",
      {
        prisma: expect.objectContaining({ $transaction: mocks.transaction }),
      },
    );
  });

  it("rejects reads when canonical hosted access is inactive", async () => {
    const accessError = hostedOnboardingError({
      code: "HOSTED_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "Hosted access is required.",
    });
    mocks.requireHostedRuntimeActiveAccess.mockRejectedValue(accessError);

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_inactive",
      request: { action: "read" },
    })).rejects.toBe(accessError);
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
    mocks.requireHostedRuntimeActiveAccessForUpdateTx.mockRejectedValue(accessError);

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_11111111111111111111111111111111" },
      memberId: "member_personalization_inactive",
      request: { action: "update", tone: "casual" },
    })).rejects.toBe(accessError);
    expect(mocks.requireHostedRuntimeActiveAccessForUpdateTx).toHaveBeenCalledWith(
      "member_personalization_inactive",
      { prisma: expect.objectContaining({ tx: true }) },
    );
    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(mocks.scheduleMailboxWake).not.toHaveBeenCalled();
  });

  it("applies an exact scheduled update without fabricating message authority", async () => {
    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: {
        automationId: "automation_daily_style",
        occurrenceAt: "2026-08-06T14:30:00.000Z",
      },
      memberId: "member_personalization_1",
      request: { action: "update", tone: "casual" },
      scheduleMailboxWake: mocks.scheduleMailboxWake,
    })).resolves.toMatchObject({
      action: "update",
      result: { status: "saved" },
    });

    expect(mocks.requireHostedRuntimeActiveAccessForUpdateTx)
      .toHaveBeenCalledWith(
        "member_personalization_1",
        { prisma: expect.objectContaining({ tx: true }) },
      );
    expect(mocks.readHostedMailboxConversationWakeByAssistantInputId)
      .not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx)
      .not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith({
      causalOrigin: "turn",
      memberId: "member_personalization_1",
      occurredAt: "2026-08-06T14:30:00.000Z",
      preferences: { tone: "casual" },
      prisma: expect.objectContaining({ tx: true }),
      updateId: buildScheduledPreferenceUpdateId("tone-voice", ["tone"]),
    });
  });

  it("uses an independent stable identity for scheduled personality updates", async () => {
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      appliedFields: ["humor"],
      assistantPersona: null,
      assistantPersonality: {
        detail: null,
        humor: 8,
        push: null,
        unhinged: null,
      },
      assistantTone: "formal",
      assistantVoice: "warm",
      dispatch: { mailboxItemId: "mailbox_scheduled_personality" },
      updated: true,
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: {
        automationId: "automation_daily_style",
        occurrenceAt: "2026-08-06T14:30:00.000Z",
      },
      memberId: "member_personalization_1",
      request: {
        action: "update_personality",
        personality: { humor: 8 },
      },
      scheduleMailboxWake: mocks.scheduleMailboxWake,
    })).resolves.toMatchObject({
      action: "update_personality",
      result: { outcomes: { humor: "saved" } },
    });

    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith({
      causalOrigin: "turn",
      memberId: "member_personalization_1",
      occurredAt: "2026-08-06T14:30:00.000Z",
      preferences: { personality: { humor: 8 } },
      prisma: expect.objectContaining({ tx: true }),
      updateId: buildScheduledPreferenceUpdateId("personality", ["humor"]),
    });
    expect(mocks.scheduleMailboxWake).toHaveBeenCalledWith({
      expectedUserId: "member_personalization_1",
      mailboxItemId: "mailbox_scheduled_personality",
    });
  });

  it("scopes scheduled personality identities to the requested dials", async () => {
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      appliedFields: [],
      assistantPersona: null,
      assistantPersonality: {
        detail: null,
        humor: null,
        push: null,
        unhinged: null,
      },
      assistantTone: "formal",
      assistantVoice: "warm",
      dispatch: null,
      updated: false,
    });
    const authority = {
      automationId: "automation_daily_style",
      occurrenceAt: "2026-08-06T14:30:00.000Z",
    };

    await handleHostedRuntimeAssistantPersonalizationTool({
      authority,
      memberId: "member_personalization_1",
      request: {
        action: "update_personality",
        personality: { humor: 8 },
      },
    });
    await handleHostedRuntimeAssistantPersonalizationTool({
      authority,
      memberId: "member_personalization_1",
      request: {
        action: "update_personality",
        personality: { push: 8 },
      },
    });

    const firstUpdateId = mocks.upsertHostedMemberAssistantPreferencesTx
      .mock.calls[0]?.[0]?.updateId;
    const secondUpdateId = mocks.upsertHostedMemberAssistantPreferencesTx
      .mock.calls[1]?.[0]?.updateId;
    expect(firstUpdateId).toBe(
      buildScheduledPreferenceUpdateId("personality", ["humor"]),
    );
    expect(secondUpdateId).toBe(
      buildScheduledPreferenceUpdateId("personality", ["push"]),
    );
    expect(secondUpdateId).not.toBe(firstUpdateId);
  });

  it("checks runtime access before resolving causal input authority", async () => {
    await handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_55555555555555555555555555555555" },
      memberId: "member_personalization_1",
      request: { action: "update", tone: "casual" },
    });

    expect(
      mocks.requireHostedRuntimeActiveAccessForUpdateTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx
        .mock.invocationCallOrder[0]!,
    );
  });

  it("scopes accepted-turn retry identity to the provider tool call", async () => {
    const assistantInputId = "ain_55555555555555555555555555555555";
    await handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId, toolCallId: "call_style_one" },
      memberId: "member_personalization_1",
      request: { action: "update_personality", personality: { humor: 7 } },
    });
    await handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId, toolCallId: "call_style_two" },
      memberId: "member_personalization_1",
      request: { action: "update_personality", personality: { humor: 9 } },
    });

    const firstUpdateId = mocks.upsertHostedMemberAssistantPreferencesTx
      .mock.calls[0]?.[0]?.updateId;
    const secondUpdateId = mocks.upsertHostedMemberAssistantPreferencesTx
      .mock.calls[1]?.[0]?.updateId;
    expect(mocks.upsertHostedMemberAssistantPreferencesTx)
      .toHaveBeenNthCalledWith(1, expect.objectContaining({
        preferenceCausalSeq: "42",
      }));
    expect(mocks.upsertHostedMemberAssistantPreferencesTx)
      .toHaveBeenNthCalledWith(2, expect.objectContaining({
        preferenceCausalSeq: "42",
      }));
    expect(firstUpdateId).toBe(buildAcceptedPreferenceUpdateId({
      assistantInputId,
      operation: "personality",
      requestedFields: ["humor"],
      toolCallId: "call_style_one",
    }));
    expect(secondUpdateId).toBe(buildAcceptedPreferenceUpdateId({
      assistantInputId,
      operation: "personality",
      requestedFields: ["humor"],
      toolCallId: "call_style_two",
    }));
    expect(secondUpdateId).not.toBe(firstUpdateId);
  });

  it("keeps a group style update bound to the synthetic room runtime", async () => {
    const routeAuthority = {
      channel: "linq",
      containerMemberId: "member_group_runtime",
      threadId: "linq_group_chat",
    } as const;
    mocks.findUniqueHostedThreadContainer.mockResolvedValue({
      memberId: "member_group_runtime",
    });
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue({
      eventId: "evt_group_style",
      kind: "conversation.message",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "linq_group_chat",
          threadIsDirect: false,
        },
        routeAuthority,
      },
      occurredAt: "2026-07-16T00:00:00.000Z",
      userId: "member_group_runtime",
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_66666666666666666666666666666666" },
      memberId: "member_group_runtime",
      request: { action: "update", tone: "casual", voice: "warm" },
      scheduleMailboxWake: mocks.scheduleMailboxWake,
    })).resolves.toMatchObject({
      action: "update",
      result: { status: "saved" },
    });

    expect(mocks.readHostedMailboxConversationWakeByAssistantInputId).toHaveBeenCalledWith({
      assistantInputId: "ain_66666666666666666666666666666666",
      memberId: "member_group_runtime",
      prisma: expect.objectContaining({ tx: true }),
    });
    expect(mocks.assertHostedLinqRouteEgressAuthority).toHaveBeenCalledWith({
      authority: routeAuthority,
      prisma: expect.objectContaining({ tx: true }),
    });
    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).toHaveBeenCalledWith({
      assistantInputId: "ain_66666666666666666666666666666666",
      memberId: "member_group_runtime",
      prisma: expect.objectContaining({ tx: true }),
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_group_runtime",
        preferences: { tone: "casual", voice: "warm" },
      }),
    );
    expect(mocks.scheduleMailboxWake).toHaveBeenCalledWith({
      expectedUserId: "member_group_runtime",
      mailboxItemId: "mailbox_preferences_1",
    });
  });

  it("writes all personality dials only to the synthetic room runtime", async () => {
    const routeAuthority = {
      channel: "linq",
      containerMemberId: "member_group_runtime",
      threadId: "linq_group_chat",
    } as const;
    mocks.findUniqueHostedThreadContainer.mockResolvedValue({
      memberId: "member_group_runtime",
    });
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(
      buildLinqStyleWake({ routeAuthority }),
    );
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      appliedFields: ["detail", "humor", "push", "unhinged"],
      assistantPersonality: {
        detail: 7,
        humor: 10,
        push: 8,
        unhinged: 9,
      },
      assistantTone: "formal",
      assistantVoice: "upbeat",
      dispatch: { mailboxItemId: "mailbox_group_personality" },
      updated: true,
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_67676767676767676767676767676767" },
      memberId: "member_group_runtime",
      request: {
        action: "update_personality",
        personality: {
          detail: 7,
          humor: 10,
          push: 8,
          unhinged: 9,
        },
      },
      scheduleMailboxWake: mocks.scheduleMailboxWake,
    })).resolves.toEqual({
      action: "update_personality",
      result: {
        outcomes: {
          detail: "saved",
          humor: "saved",
          push: "saved",
          unhinged: "saved",
        },
        settings: {
          detail: { source: "custom", value: 7 },
          humor: { source: "custom", value: 10 },
          push: { source: "custom", value: 8 },
          unhinged: { source: "custom", value: 9 },
        },
      },
    });

    expect(mocks.assertHostedLinqRouteEgressAuthority).toHaveBeenCalledWith({
      authority: routeAuthority,
      prisma: expect.objectContaining({ tx: true }),
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith({
      causalOrigin: "turn",
      memberId: "member_group_runtime",
      occurredAt: expect.any(String),
      preferenceCausalSeq: "42",
      preferences: {
        personality: {
          detail: 7,
          humor: 10,
          push: 8,
          unhinged: 9,
        },
      },
      prisma: expect.objectContaining({ tx: true }),
      updateId: buildAcceptedPreferenceUpdateId({
        assistantInputId: "ain_67676767676767676767676767676767",
        operation: "personality",
        requestedFields: ["detail", "humor", "push", "unhinged"],
      }),
    });
    expect(mocks.scheduleMailboxWake).toHaveBeenCalledWith({
      expectedUserId: "member_group_runtime",
      mailboxItemId: "mailbox_group_personality",
    });
  });

  it.each([
    {
      label: "a missing accepted wake",
      wake: null,
    },
    {
      label: "a direct Linq wake",
      wake: buildLinqStyleWake({ threadIsDirect: true }),
    },
    {
      label: "missing route authority",
      wake: buildLinqStyleWake({ routeAuthority: null }),
    },
    {
      label: "route authority for another container",
      wake: buildLinqStyleWake({
        routeAuthority: {
          channel: "linq",
          containerMemberId: "member_other_group_runtime",
          threadId: "linq_group_chat",
        },
      }),
    },
    {
      label: "route authority for another chat",
      wake: buildLinqStyleWake({
        routeAuthority: {
          channel: "linq",
          containerMemberId: "member_group_runtime",
          threadId: "linq_other_group_chat",
        },
      }),
    },
  ])("rejects a synthetic room update with $label", async ({ wake }) => {
    mocks.findUniqueHostedThreadContainer.mockResolvedValue({
      memberId: "member_group_runtime",
    });
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(wake);

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_68686868686868686868686868686868" },
      memberId: "member_group_runtime",
      request: { action: "update", tone: "casual" },
    })).rejects.toThrow("input authority is invalid");

    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "the current route assertion fails",
      prepareRoute: () => {
        mocks.assertHostedLinqRouteEgressAuthority.mockRejectedValue(
          new Error("route authority is stale"),
        );
      },
    },
    {
      label: "the current route resolves to another container",
      prepareRoute: () => {
        mocks.assertHostedLinqRouteEgressAuthority.mockResolvedValue({
          containerMemberId: "member_other_group_runtime",
        });
      },
    },
  ])("rejects a synthetic room update when $label", async ({ prepareRoute }) => {
    mocks.findUniqueHostedThreadContainer.mockResolvedValue({
      memberId: "member_group_runtime",
    });
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(
      buildLinqStyleWake(),
    );
    prepareRoute();

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_69696969696969696969696969696969" },
      memberId: "member_group_runtime",
      request: { action: "update", tone: "casual" },
    })).rejects.toThrow();

    expect(mocks.assertHostedLinqRouteEgressAuthority).toHaveBeenCalledOnce();
    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
  });

  it("rejects a group style update whose accepted input came from group email", async () => {
    mocks.findUniqueHostedThreadContainer.mockResolvedValue({
      memberId: "member_group_runtime",
    });
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue({
      eventId: "evt_group_email_style",
      kind: "conversation.message",
      message: {
        channel: "email",
        identityId: null,
        rawMessageKey: "email-group-style",
        threadIsDirect: false,
      },
      occurredAt: "2026-07-16T00:00:00.000Z",
      userId: "member_group_runtime",
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_77777777777777777777777777777777" },
      memberId: "member_group_runtime",
      request: { action: "update_personality", personality: { humor: 10 } },
    })).rejects.toThrow("input authority is invalid");

    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
  });

  it("never lets a non-direct Linq input mutate a person runtime", async () => {
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue({
      eventId: "evt_person_bound_group_style",
      kind: "conversation.message",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "linq_group_chat",
          threadIsDirect: false,
        },
        routeAuthority: {
          channel: "linq",
          containerMemberId: "member_personalization_1",
          threadId: "linq_group_chat",
        },
      },
      occurredAt: "2026-07-16T00:00:00.000Z",
      userId: "member_personalization_1",
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_78787878787878787878787878787878" },
      memberId: "member_personalization_1",
      request: { action: "update", tone: "casual" },
    })).rejects.toThrow("input authority is invalid");

    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
  });

  it("never lets a group-email input mutate a person runtime", async () => {
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue({
      eventId: "evt_person_bound_group_email_style",
      kind: "conversation.message",
      message: {
        assistantStyleSettingsAuthorized: true,
        channel: "email",
        identityId: null,
        rawMessageKey: "email-person-bound-group-style",
        threadIsDirect: false,
      },
      occurredAt: "2026-07-16T00:00:00.000Z",
      userId: "member_personalization_1",
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_79797979797979797979797979797979" },
      memberId: "member_personalization_1",
      request: { action: "update", voice: "warm" },
    })).rejects.toThrow("input authority is invalid");

    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "direct Linq",
      wake: buildLinqStyleWake({
        routeAuthority: null,
        threadIsDirect: true,
        userId: "member_personalization_1",
      }),
    },
    {
      label: "authorized direct email",
      wake: {
        eventId: "evt_direct_email_style",
        kind: "conversation.message",
        message: {
          assistantStyleSettingsAuthorized: true,
          channel: "email",
          identityId: null,
          rawMessageKey: "email-direct-style",
          threadIsDirect: true,
        },
        occurredAt: "2026-07-16T00:00:00.000Z",
        userId: "member_personalization_1",
      },
    },
  ])("preserves $label style updates for a person runtime", async ({ wake }) => {
    mocks.readHostedMailboxConversationWakeByAssistantInputId.mockResolvedValue(wake);

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a" },
      memberId: "member_personalization_1",
      request: { action: "update", tone: "casual" },
    })).resolves.toMatchObject({
      action: "update",
      result: { status: "saved" },
    });

    expect(mocks.assertHostedLinqRouteEgressAuthority).not.toHaveBeenCalled();
    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).toHaveBeenCalledOnce();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "member_personalization_1",
        preferences: { tone: "casual" },
      }),
    );
  });

  it("rejects updates without assistant input authority", async () => {
    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_1",
      request: { action: "update", tone: "casual" },
    })).rejects.toThrow("requires action authority");

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
  });

  it("rejects personality updates without assistant input authority", async () => {
    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      memberId: "member_personalization_1",
      request: {
        action: "update_personality",
        personality: { push: null },
      },
    })).rejects.toThrow("requires action authority");

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
  });

  it("causally projects sparse personality values and reports exact field outcomes", async () => {
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      appliedFields: ["humor"],
      assistantPersonality: {
        detail: 3,
        humor: 8,
        push: null,
        unhinged: null,
      },
      assistantTone: "formal",
      assistantVoice: "warm",
      dispatch: { mailboxItemId: "mailbox_personality_1" },
      updated: true,
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_99999999999999999999999999999999" },
      memberId: "member_personalization_1",
      request: {
        action: "update_personality",
        personality: {
          detail: 9,
          humor: 8,
          push: null,
        },
      },
      scheduleMailboxWake: mocks.scheduleMailboxWake,
    })).resolves.toEqual({
      action: "update_personality",
      result: {
        outcomes: {
          detail: "superseded",
          humor: "saved",
          push: "unchanged",
        },
        settings: {
          detail: { source: "custom", value: 3 },
          humor: { source: "custom", value: 8 },
          push: { source: "default", value: 3 },
          unhinged: { source: "default", value: 0 },
        },
      },
    });

    expect(
      mocks.requireHostedRuntimeActiveAccessForUpdateTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx
        .mock.invocationCallOrder[0]!,
    );
    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).toHaveBeenCalledWith({
      assistantInputId: "ain_99999999999999999999999999999999",
      memberId: "member_personalization_1",
      prisma: expect.objectContaining({ tx: true }),
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith({
      causalOrigin: "turn",
      memberId: "member_personalization_1",
      occurredAt: expect.any(String),
      preferenceCausalSeq: "42",
      preferences: {
        personality: {
          detail: 9,
          humor: 8,
          push: null,
        },
      },
      prisma: expect.objectContaining({ tx: true }),
      updateId: buildAcceptedPreferenceUpdateId({
        assistantInputId: "ain_99999999999999999999999999999999",
        operation: "personality",
        requestedFields: ["detail", "humor", "push"],
      }),
    });
    expect(mocks.scheduleMailboxWake).toHaveBeenCalledWith({
      expectedUserId: "member_personalization_1",
      mailboxItemId: "mailbox_personality_1",
    });
  });

  it("does not schedule a wake when a personality update has no dispatch", async () => {
    mocks.upsertHostedMemberAssistantPreferencesTx.mockResolvedValue({
      appliedFields: [],
      assistantPersonality: {
        detail: null,
        humor: 8,
        push: null,
        unhinged: null,
      },
      assistantTone: "formal",
      assistantVoice: "warm",
      dispatch: null,
      updated: false,
    });

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      memberId: "member_personalization_1",
      request: {
        action: "update_personality",
        personality: { humor: 8 },
      },
      scheduleMailboxWake: mocks.scheduleMailboxWake,
    })).resolves.toEqual({
      action: "update_personality",
      result: {
        outcomes: { humor: "unchanged" },
        settings: {
          detail: { source: "default", value: 5 },
          humor: { source: "custom", value: 8 },
          push: { source: "default", value: 3 },
          unhinged: { source: "default", value: 0 },
        },
      },
    });
    expect(mocks.scheduleMailboxWake).not.toHaveBeenCalled();
  });

  it("saves a style-only update while reading the effective model from its canonical owner", async () => {
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
      prisma: expect.objectContaining({ tx: true }),
    });
    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).toHaveBeenCalledWith({
      assistantInputId: "ain_22222222222222222222222222222222",
      memberId: "member_personalization_1",
      prisma: expect.objectContaining({ tx: true }),
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).toHaveBeenCalledWith(
      expect.objectContaining({
        causalOrigin: "turn",
        memberId: "member_personalization_1",
        preferenceCausalSeq: "42",
        preferences: { voice: "warm" },
        prisma: expect.objectContaining({ tx: true }),
        updateId: buildAcceptedPreferenceUpdateId({
          assistantInputId: "ain_22222222222222222222222222222222",
          operation: "tone-voice",
          requestedFields: ["voice"],
        }),
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
    mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx.mockResolvedValue(null);

    await expect(handleHostedRuntimeAssistantPersonalizationTool({
      authority: { assistantInputId: "ain_44444444444444444444444444444444" },
      memberId: "member_personalization_1",
      request: { action: "update", tone: "casual" },
    })).rejects.toThrow("input authority is invalid");

    expect(
      mocks.readHostedMailboxConversationInputAuthorityByAssistantInputIdTx,
    ).toHaveBeenCalledWith({
      assistantInputId: "ain_44444444444444444444444444444444",
      memberId: "member_personalization_1",
      prisma: expect.objectContaining({ tx: true }),
    });
    expect(mocks.upsertHostedMemberAssistantPreferencesTx).not.toHaveBeenCalled();
    expect(mocks.scheduleMailboxWake).not.toHaveBeenCalled();
  });
});

function buildScheduledPreferenceUpdateId(
  operation: "personality" | "tone-voice",
  requestedFields: string[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      origin: {
        automationId: "automation_daily_style",
        kind: "automation_occurrence",
        occurrenceAt: "2026-08-06T14:30:00.000Z",
      },
      operation,
      requestedFields: [...requestedFields].sort(),
      schema: "murph.assistant-preference-update.v2",
      toolCallId: null,
    }))
    .digest("hex");
}

function buildAcceptedPreferenceUpdateId(input: {
  assistantInputId: string;
  operation: "personality" | "tone-voice";
  requestedFields: string[];
  toolCallId?: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      origin: {
        assistantInputId: input.assistantInputId,
        kind: "accepted_input",
      },
      operation: input.operation,
      requestedFields: [...input.requestedFields].sort(),
      schema: "murph.assistant-preference-update.v2",
      toolCallId: input.toolCallId ?? null,
    }))
    .digest("hex");
}

function buildLinqStyleWake(input: {
  routeAuthority?: {
    channel: "linq";
    containerMemberId: string;
    threadId: string;
  } | null;
  threadIsDirect?: boolean;
  userId?: string;
} = {}) {
  const routeAuthority = input.routeAuthority === undefined
    ? {
        channel: "linq" as const,
        containerMemberId: "member_group_runtime",
        threadId: "linq_group_chat",
      }
    : input.routeAuthority;
  return {
    eventId: "evt_group_style",
    kind: "conversation.message" as const,
    message: {
      channel: "linq" as const,
      linqMessage: {
        chatId: "linq_group_chat",
        threadIsDirect: input.threadIsDirect ?? false,
      },
      ...(routeAuthority === null ? {} : { routeAuthority }),
    },
    occurredAt: "2026-07-16T00:00:00.000Z",
    userId: input.userId ?? "member_group_runtime",
  };
}
