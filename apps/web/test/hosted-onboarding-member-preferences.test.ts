import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  lockHostedMemberRow: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/shared")
  >("@/src/lib/hosted-onboarding/shared");

  return {
    ...actual,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
  };
});

import {
  buildHostedMemberPreferencesUpdatedEventId,
  upsertHostedMemberAssistantPreferencesTx,
} from "@/src/lib/hosted-onboarding/member-preferences";

describe("hosted member assistant preferences", () => {
  beforeEach(() => {
    mocks.appendHostedMailboxEnvelopeTx.mockReset();
    mocks.lockHostedMemberRow.mockReset();
  });

  it("updates changed preferences and appends a member preferences wake", async () => {
    const member = {
      assistantPersona: null as string | null,
      assistantPersonaCausalSeq: null as bigint | null,
      assistantDetail: null as number | null,
      assistantDetailCausalSeq: null as bigint | null,
      assistantHumor: null as number | null,
      assistantHumorCausalSeq: null as bigint | null,
      assistantPush: null as number | null,
      assistantPushCausalSeq: null as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: {
        causalSeq: 1n,
        id: "mailbox_item_123",
      },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        persona: "navy-seal",
        tone: "casual",
        voice: "warm",
      },
      prisma,
    })).resolves.toMatchObject({
      assistantPersona: "navy-seal",
      assistantTone: "casual",
      assistantVoice: "warm",
      dispatch: {
        mailboxItemId: "mailbox_item_123",
      },
      updated: true,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: expect.stringMatching(
          /^member\.preferences\.updated:member_123:[0-9a-f-]{36}$/u,
        ),
        kind: "member.preferences.updated",
        occurredAt: "2026-07-08T12:00:00.000Z",
        preferences: {
          persona: "navy-seal",
          tone: "casual",
          voice: "warm",
        },
        requestedFields: ["persona", "tone", "voice"],
        userId: "member_123",
      }),
      tx: prisma,
    });

    mocks.appendHostedMailboxEnvelopeTx.mockClear();
    await expect(upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:01:00.000Z",
      preferences: {
        tone: "casual",
      },
      prisma,
    })).resolves.toMatchObject({
      assistantPersona: "navy-seal",
      assistantTone: "casual",
      assistantVoice: "warm",
      dispatch: {
        mailboxItemId: "mailbox_item_123",
      },
      updated: false,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        preferences: { tone: "casual" },
      }),
      tx: prisma,
    });
  });

  it("uses a durable unique wake identity for same-millisecond preference writes", async () => {
    const member = {
      assistantPersona: null as string | null,
      assistantPersonaCausalSeq: null as bigint | null,
      assistantDetail: null as number | null,
      assistantDetailCausalSeq: null as bigint | null,
      assistantHumor: null as number | null,
      assistantHumorCausalSeq: null as bigint | null,
      assistantPush: null as number | null,
      assistantPushCausalSeq: null as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: {
        causalSeq: 1n,
        id: "mailbox_item_123",
      },
    });

    await upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        voice: "warm",
      },
      prisma,
    });
    await upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        voice: "deep-calm",
      },
      prisma,
    });

    const firstEnvelope =
      mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    const secondEnvelope =
      mocks.appendHostedMailboxEnvelopeTx.mock.calls[1]?.[0]?.envelope;

    expect(firstEnvelope.eventId).toMatch(
      /^member\.preferences\.updated:member_123:[0-9a-f-]{36}$/u,
    );
    expect(secondEnvelope.eventId).toMatch(
      /^member\.preferences\.updated:member_123:[0-9a-f-]{36}$/u,
    );
    expect(secondEnvelope.eventId).not.toBe(firstEnvelope.eventId);
    expect(secondEnvelope.preferences).toEqual({
      voice: "deep-calm",
    });
    expect(member.assistantVoice).toBe("deep-calm");
  });

  it("stale conversation intent no-ops field-locally behind newer Settings state", async () => {
    const member = {
      assistantPersona: null as string | null,
      assistantPersonaCausalSeq: null as bigint | null,
      assistantDetail: null as number | null,
      assistantDetailCausalSeq: null as bigint | null,
      assistantHumor: null as number | null,
      assistantHumorCausalSeq: null as bigint | null,
      assistantPush: null as number | null,
      assistantPushCausalSeq: null as bigint | null,
      assistantTone: "formal" as string | null,
      assistantToneCausalSeq: 101n as bigint | null,
      assistantVoice: "warm" as string | null,
      assistantVoiceCausalSeq: 99n as bigint | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: { causalSeq: 102n, id: "mailbox_item_123" },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferenceCausalSeq: "100",
      preferences: { tone: "casual", voice: "deep-calm" },
      prisma,
    })).resolves.toMatchObject({
      assistantTone: "formal",
      assistantVoice: "deep-calm",
      updated: true,
    });

    expect(member).toMatchObject({
      assistantTone: "formal",
      assistantToneCausalSeq: 101n,
      assistantVoice: "deep-calm",
      assistantVoiceCausalSeq: 100n,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        causalOrigin: "turn",
        preferenceCausalSeq: "100",
        preferences: { voice: "deep-calm" },
      }),
      tx: prisma,
    });
  });

  it("uses a same-value Settings save as a causal barrier", async () => {
    const member = {
      assistantPersona: null as string | null,
      assistantPersonaCausalSeq: null as bigint | null,
      assistantDetail: null as number | null,
      assistantDetailCausalSeq: null as bigint | null,
      assistantHumor: null as number | null,
      assistantHumorCausalSeq: null as bigint | null,
      assistantPush: null as number | null,
      assistantPushCausalSeq: null as bigint | null,
      assistantTone: "formal" as string | null,
      assistantToneCausalSeq: 10n as bigint | null,
      assistantVoice: "warm" as string | null,
      assistantVoiceCausalSeq: 10n as bigint | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: { causalSeq: 20n, id: "mailbox_settings_barrier" },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: { tone: "formal" },
      prisma,
    })).resolves.toMatchObject({
      dispatch: { mailboxItemId: "mailbox_settings_barrier" },
      updated: false,
    });
    expect(member).toMatchObject({
      assistantTone: "formal",
      assistantToneCausalSeq: 20n,
    });

    mocks.appendHostedMailboxEnvelopeTx.mockClear();
    await expect(upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:01:00.000Z",
      preferenceCausalSeq: "15",
      preferences: { tone: "casual" },
      prisma,
    })).resolves.toMatchObject({
      assistantTone: "formal",
      dispatch: null,
      updated: false,
    });
    expect(member.assistantToneCausalSeq).toBe(20n);
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("uses a same-value Settings personality save as a per-dial causal barrier", async () => {
    const member = {
      assistantDetail: 4 as number | null,
      assistantDetailCausalSeq: 10n as bigint | null,
      assistantHumor: 6 as number | null,
      assistantHumorCausalSeq: 10n as bigint | null,
      assistantPush: 5 as number | null,
      assistantPushCausalSeq: 10n as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: { causalSeq: 20n, id: "mailbox_settings_personality_barrier" },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: { personality: { humor: 6 } },
      prisma,
    })).resolves.toMatchObject({
      appliedFields: ["humor"],
      assistantPersonality: { humor: 6 },
      dispatch: { mailboxItemId: "mailbox_settings_personality_barrier" },
      updated: false,
    });
    expect(member).toMatchObject({
      assistantHumor: 6,
      assistantHumorCausalSeq: 20n,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        preferences: { personality: { humor: 6 } },
      }),
      tx: prisma,
    });

    mocks.appendHostedMailboxEnvelopeTx.mockClear();
    await expect(upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:01:00.000Z",
      preferenceCausalSeq: "15",
      preferences: { personality: { humor: 2 } },
      prisma,
    })).resolves.toMatchObject({
      appliedFields: [],
      assistantPersonality: { humor: 6 },
      dispatch: null,
      updated: false,
    });
    expect(member).toMatchObject({
      assistantHumor: 6,
      assistantHumorCausalSeq: 20n,
    });
    expect(prisma.hostedMember.update).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("emits only the preference changed by the request", async () => {
    const member = {
      assistantDetail: 5 as number | null,
      assistantDetailCausalSeq: null as bigint | null,
      assistantHumor: 3 as number | null,
      assistantHumorCausalSeq: null as bigint | null,
      assistantPush: 3 as number | null,
      assistantPushCausalSeq: null as bigint | null,
      assistantTone: "casual" as string | null,
      assistantVoice: "warm" as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: {
        causalSeq: 1n,
        id: "mailbox_item_123",
      },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        voice: "deep-calm",
      },
      prisma,
    })).resolves.toMatchObject({
      assistantTone: "casual",
      assistantVoice: "deep-calm",
      updated: true,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "member.preferences.updated",
        preferences: {
          voice: "deep-calm",
        },
      }),
      tx: prisma,
    });
  });

  it("persists sparse personality intent and preserves sibling values", async () => {
    const member = {
      assistantDetail: 8 as number | null,
      assistantDetailCausalSeq: null as bigint | null,
      assistantHumor: 3 as number | null,
      assistantHumorCausalSeq: null as bigint | null,
      assistantPush: 6 as number | null,
      assistantPushCausalSeq: null as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: {
        causalSeq: 1n,
        id: "mailbox_item_123",
      },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        personality: {
          humor: 7,
        },
      },
      prisma,
    })).resolves.toMatchObject({
      appliedFields: ["humor"],
      assistantPersonality: {
        detail: 8,
        humor: 7,
        push: 6,
      },
      dispatch: {
        mailboxItemId: "mailbox_item_123",
      },
      updated: true,
    });

    expect(member).toMatchObject({
      assistantDetail: 8,
      assistantHumor: 7,
      assistantHumorCausalSeq: 1n,
      assistantPush: 6,
    });
    expect(prisma.hostedMember.update).toHaveBeenCalledTimes(1);
    expect(prisma.hostedMember.update).toHaveBeenCalledWith({
      data: {
        assistantHumor: 7,
        assistantHumorCausalSeq: 1n,
      },
      select: {
        assistantPersona: true,
        assistantDetail: true,
        assistantHumor: true,
        assistantPush: true,
        assistantTone: true,
        assistantVoice: true,
      },
      where: {
        id: "member_123",
      },
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "member.preferences.updated",
        preferences: {
          personality: {
            humor: 7,
          },
        },
      }),
      tx: prisma,
    });

    mocks.appendHostedMailboxEnvelopeTx.mockClear();
    await expect(upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:01:00.000Z",
      preferences: {
        personality: {
          humor: 7,
        },
      },
      prisma,
    })).resolves.toMatchObject({
      appliedFields: ["humor"],
      assistantPersonality: {
        detail: 8,
        humor: 7,
        push: 6,
      },
      dispatch: {
        mailboxItemId: "mailbox_item_123",
      },
      updated: false,
    });
    expect(prisma.hostedMember.update).toHaveBeenCalledTimes(2);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "member.preferences.updated",
        preferences: {
          personality: {
            humor: 7,
          },
        },
      }),
      tx: prisma,
    });
  });

  it.each([
    {
      appliedField: "humor",
      expectedData: {
        assistantHumor: 7,
        assistantHumorCausalSeq: 11n,
      },
      expectedPersonality: {
        detail: 4,
        humor: 7,
        push: 5,
      },
      personality: { humor: 7 },
    },
    {
      appliedField: "push",
      expectedData: {
        assistantPush: 8,
        assistantPushCausalSeq: 11n,
      },
      expectedPersonality: {
        detail: 4,
        humor: 3,
        push: 8,
      },
      personality: { push: 8 },
    },
    {
      appliedField: "detail",
      expectedData: {
        assistantDetail: 9,
        assistantDetailCausalSeq: 11n,
      },
      expectedPersonality: {
        detail: 9,
        humor: 3,
        push: 5,
      },
      personality: { detail: 9 },
    },
  ])("projects a causally ordered $appliedField conversation update", async ({
    appliedField,
    expectedData,
    expectedPersonality,
    personality,
  }) => {
    const member = {
      assistantDetail: 4 as number | null,
      assistantDetailCausalSeq: 10n as bigint | null,
      assistantHumor: 3 as number | null,
      assistantHumorCausalSeq: 10n as bigint | null,
      assistantPush: 5 as number | null,
      assistantPushCausalSeq: 10n as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: {
        causalSeq: 12n,
        id: "mailbox_personality_update",
      },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:02:00.000Z",
      preferenceCausalSeq: "11",
      preferences: { personality },
      prisma,
    })).resolves.toMatchObject({
      appliedFields: [appliedField],
      assistantPersonality: expectedPersonality,
      dispatch: { mailboxItemId: "mailbox_personality_update" },
      updated: true,
    });
    expect(member).toMatchObject(expectedData);
    expect(prisma.hostedMember.update).toHaveBeenCalledWith({
      data: expectedData,
      select: {
        assistantPersona: true,
        assistantDetail: true,
        assistantHumor: true,
        assistantPush: true,
        assistantTone: true,
        assistantVoice: true,
      },
      where: { id: "member_123" },
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        causalOrigin: "turn",
        preferenceCausalSeq: "11",
        preferences: { personality },
      }),
      tx: prisma,
    });
  });

  it("projects a nullable personality reset with its causal watermark", async () => {
    const member = {
      assistantDetail: 4 as number | null,
      assistantDetailCausalSeq: 15n as bigint | null,
      assistantHumor: 7 as number | null,
      assistantHumorCausalSeq: 15n as bigint | null,
      assistantPush: 8 as number | null,
      assistantPushCausalSeq: 15n as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: { causalSeq: 17n, id: "mailbox_personality_reset" },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:03:00.000Z",
      preferenceCausalSeq: "16",
      preferences: { personality: { push: null } },
      prisma,
    })).resolves.toMatchObject({
      appliedFields: ["push"],
      assistantPersonality: {
        detail: 4,
        humor: 7,
        push: null,
      },
      dispatch: { mailboxItemId: "mailbox_personality_reset" },
      updated: true,
    });
    expect(member).toMatchObject({
      assistantPush: null,
      assistantPushCausalSeq: 16n,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        preferences: { personality: { push: null } },
      }),
      tx: prisma,
    });
  });

  it("treats a newer conversation sequence as saved when a null watermark hides historical divergence", async () => {
    const member = {
      assistantPersona: null as string | null,
      assistantPersonaCausalSeq: null as bigint | null,
      assistantDetail: null as number | null,
      assistantDetailCausalSeq: null as bigint | null,
      assistantHumor: null as number | null,
      assistantHumorCausalSeq: null as bigint | null,
      assistantPush: null as number | null,
      assistantPushCausalSeq: null as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: { causalSeq: 71n, id: "mailbox_historical_reset" },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:04:00.000Z",
      preferenceCausalSeq: "70",
      preferences: { personality: { humor: null } },
      prisma,
    })).resolves.toMatchObject({
      appliedFields: ["humor"],
      assistantPersonality: {
        detail: null,
        humor: null,
        push: null,
      },
      dispatch: { mailboxItemId: "mailbox_historical_reset" },
      updated: false,
    });
    expect(member.assistantHumorCausalSeq).toBe(70n);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        preferences: { personality: { humor: null } },
      }),
      tx: prisma,
    });
  });

  it("keeps a newer Settings personality save ahead of a delayed conversation write", async () => {
    const member = {
      assistantDetail: 4 as number | null,
      assistantDetailCausalSeq: 10n as bigint | null,
      assistantHumor: 5 as number | null,
      assistantHumorCausalSeq: 10n as bigint | null,
      assistantPush: 6 as number | null,
      assistantPushCausalSeq: 10n as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: { causalSeq: 40n, id: "mailbox_settings_personality" },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:05:00.000Z",
      preferences: { personality: { humor: 9 } },
      prisma,
    })).resolves.toMatchObject({
      appliedFields: ["humor"],
      assistantPersonality: { humor: 9 },
      updated: true,
    });
    expect(member.assistantHumorCausalSeq).toBe(40n);

    mocks.appendHostedMailboxEnvelopeTx.mockClear();
    await expect(upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:06:00.000Z",
      preferenceCausalSeq: "35",
      preferences: { personality: { humor: 2 } },
      prisma,
    })).resolves.toMatchObject({
      appliedFields: [],
      assistantPersonality: { humor: 9 },
      dispatch: null,
      updated: false,
    });
    expect(member).toMatchObject({
      assistantHumor: 9,
      assistantHumorCausalSeq: 40n,
    });
    expect(prisma.hostedMember.update).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("applies mixed personality intent field-locally when one dial is stale", async () => {
    const member = {
      assistantDetail: 6 as number | null,
      assistantDetailCausalSeq: 50n as bigint | null,
      assistantHumor: 8 as number | null,
      assistantHumorCausalSeq: 50n as bigint | null,
      assistantPush: 4 as number | null,
      assistantPushCausalSeq: 30n as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: { causalSeq: 51n, id: "mailbox_mixed_personality" },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:07:00.000Z",
      preferenceCausalSeq: "40",
      preferences: {
        personality: {
          detail: null,
          humor: 2,
          push: 7,
        },
      },
      prisma,
    })).resolves.toMatchObject({
      appliedFields: ["push"],
      assistantPersonality: {
        detail: 6,
        humor: 8,
        push: 7,
      },
      updated: true,
    });
    expect(member).toMatchObject({
      assistantDetail: 6,
      assistantDetailCausalSeq: 50n,
      assistantHumor: 8,
      assistantHumorCausalSeq: 50n,
      assistantPush: 7,
      assistantPushCausalSeq: 40n,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        preferences: { personality: { push: 7 } },
      }),
      tx: prisma,
    });
  });

  it("deduplicates an exact same-sequence same-value personality retry", async () => {
    const member = {
      assistantDetail: 4 as number | null,
      assistantDetailCausalSeq: 44n as bigint | null,
      assistantHumor: 6 as number | null,
      assistantHumorCausalSeq: 44n as bigint | null,
      assistantPush: 5 as number | null,
      assistantPushCausalSeq: 44n as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);

    await expect(upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:08:00.000Z",
      preferenceCausalSeq: "44",
      preferences: { personality: { humor: 6 } },
      prisma,
    })).resolves.toMatchObject({
      appliedFields: [],
      assistantPersonality: {
        detail: 4,
        humor: 6,
        push: 5,
      },
      dispatch: null,
      updated: false,
    });
    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("applies a later same-sequence personality command when its value differs", async () => {
    const member = {
      assistantDetail: 4 as number | null,
      assistantDetailCausalSeq: 60n as bigint | null,
      assistantHumor: 6 as number | null,
      assistantHumorCausalSeq: 60n as bigint | null,
      assistantPush: 5 as number | null,
      assistantPushCausalSeq: 60n as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx
      .mockResolvedValueOnce({
        dedupeConflict: false,
        item: { causalSeq: 61n, id: "mailbox_detail_first" },
      })
      .mockResolvedValueOnce({
        dedupeConflict: false,
        item: { causalSeq: 62n, id: "mailbox_detail_second" },
      });

    await upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:09:00.000Z",
      preferenceCausalSeq: "61",
      preferences: { personality: { detail: 7 } },
      prisma,
    });
    await expect(upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:09:01.000Z",
      preferenceCausalSeq: "61",
      preferences: { personality: { detail: 9 } },
      prisma,
    })).resolves.toMatchObject({
      appliedFields: ["detail"],
      assistantPersonality: { detail: 9 },
      dispatch: { mailboxItemId: "mailbox_detail_second" },
      updated: true,
    });
    expect(member).toMatchObject({
      assistantDetail: 9,
      assistantDetailCausalSeq: 61n,
    });
    expect(prisma.hostedMember.update).toHaveBeenCalledTimes(2);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(2);
  });

  it("leaves personality value and watermark unchanged when the wake conflicts", async () => {
    const member = {
      assistantDetail: 4 as number | null,
      assistantDetailCausalSeq: 30n as bigint | null,
      assistantHumor: 6 as number | null,
      assistantHumorCausalSeq: 30n as bigint | null,
      assistantPush: 5 as number | null,
      assistantPushCausalSeq: 30n as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: true,
      item: { id: "mailbox_item_existing" },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      causalOrigin: "turn",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:10:00.000Z",
      preferenceCausalSeq: "31",
      preferences: { personality: { detail: 9 } },
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_PREFERENCES_WAKE_DEDUPE_CONFLICT",
      retryable: true,
    });
    expect(member).toMatchObject({
      assistantDetail: 4,
      assistantDetailCausalSeq: 30n,
    });
    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
  });

  it("fails retryably when the preference wake identity conflicts", async () => {
    const member = {
      assistantPersona: null as string | null,
      assistantPersonaCausalSeq: null as bigint | null,
      assistantDetail: null as number | null,
      assistantDetailCausalSeq: null as bigint | null,
      assistantHumor: null as number | null,
      assistantHumorCausalSeq: null as bigint | null,
      assistantPush: null as number | null,
      assistantPushCausalSeq: null as bigint | null,
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: true,
      item: {
        id: "mailbox_item_existing",
      },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        tone: "casual",
      },
      prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_MEMBER_PREFERENCES_WAKE_DEDUPE_CONFLICT",
      retryable: true,
    });
  });

  it("builds member preference event ids from a per-write update id", () => {
    expect(buildHostedMemberPreferencesUpdatedEventId({
      memberId: "member_123",
      updateId: "update_a",
    })).toBe("member.preferences.updated:member_123:update_a");
    expect(buildHostedMemberPreferencesUpdatedEventId({
      memberId: "member_123",
      updateId: "update_b",
    })).toBe("member.preferences.updated:member_123:update_b");
  });
});

function createPreferencesPrismaDouble(member: {
  assistantPersona?: string | null;
  assistantPersonaCausalSeq?: bigint | null;
  assistantDetail: number | null;
  assistantDetailCausalSeq: bigint | null;
  assistantHumor: number | null;
  assistantHumorCausalSeq: bigint | null;
  assistantPush: number | null;
  assistantPushCausalSeq: bigint | null;
  assistantTone: string | null;
  assistantToneCausalSeq?: bigint | null;
  assistantVoice: string | null;
  assistantVoiceCausalSeq?: bigint | null;
  id: string;
}): Prisma.TransactionClient {
  return {
    hostedMember: {
      findUnique: vi.fn(async () => ({ ...member })),
      update: vi.fn(async (input: {
        data: {
          assistantPersona?: string;
          assistantPersonaCausalSeq?: bigint;
          assistantDetail?: number | null;
          assistantDetailCausalSeq?: bigint;
          assistantHumor?: number | null;
          assistantHumorCausalSeq?: bigint;
          assistantPush?: number | null;
          assistantPushCausalSeq?: bigint;
          assistantTone?: string;
          assistantToneCausalSeq?: bigint;
          assistantVoice?: string;
          assistantVoiceCausalSeq?: bigint;
        };
      }) => {
        if (input.data.assistantPersona !== undefined) {
          member.assistantPersona = input.data.assistantPersona;
        }
        if (input.data.assistantPersonaCausalSeq !== undefined) {
          member.assistantPersonaCausalSeq =
            input.data.assistantPersonaCausalSeq;
        }
        if (input.data.assistantDetail !== undefined) {
          member.assistantDetail = input.data.assistantDetail;
        }
        if (input.data.assistantDetailCausalSeq !== undefined) {
          member.assistantDetailCausalSeq = input.data.assistantDetailCausalSeq;
        }
        if (input.data.assistantHumor !== undefined) {
          member.assistantHumor = input.data.assistantHumor;
        }
        if (input.data.assistantHumorCausalSeq !== undefined) {
          member.assistantHumorCausalSeq = input.data.assistantHumorCausalSeq;
        }
        if (input.data.assistantPush !== undefined) {
          member.assistantPush = input.data.assistantPush;
        }
        if (input.data.assistantPushCausalSeq !== undefined) {
          member.assistantPushCausalSeq = input.data.assistantPushCausalSeq;
        }
        if (input.data.assistantTone !== undefined) {
          member.assistantTone = input.data.assistantTone;
        }
        if (input.data.assistantToneCausalSeq !== undefined) {
          member.assistantToneCausalSeq = input.data.assistantToneCausalSeq;
        }
        if (input.data.assistantVoice !== undefined) {
          member.assistantVoice = input.data.assistantVoice;
        }
        if (input.data.assistantVoiceCausalSeq !== undefined) {
          member.assistantVoiceCausalSeq = input.data.assistantVoiceCausalSeq;
        }
        return {
          assistantPersona: member.assistantPersona,
          assistantDetail: member.assistantDetail,
          assistantHumor: member.assistantHumor,
          assistantPush: member.assistantPush,
          assistantTone: member.assistantTone,
          assistantVoice: member.assistantVoice,
        };
      }),
    },
  } as unknown as Prisma.TransactionClient;
}
