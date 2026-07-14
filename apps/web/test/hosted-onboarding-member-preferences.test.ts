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
      assistantDetail: null as number | null,
      assistantHumor: null as number | null,
      assistantPush: null as number | null,
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
      mailboxPayloadMode: "sparse_delta",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        tone: "casual",
        voice: "warm",
      },
      prisma,
    })).resolves.toMatchObject({
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
          tone: "casual",
          voice: "warm",
        },
        userId: "member_123",
      }),
      tx: prisma,
    });

    mocks.appendHostedMailboxEnvelopeTx.mockClear();
    await expect(upsertHostedMemberAssistantPreferencesTx({
      mailboxPayloadMode: "sparse_delta",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:01:00.000Z",
      preferences: {
        tone: "casual",
      },
      prisma,
    })).resolves.toMatchObject({
      assistantTone: "casual",
      assistantVoice: "warm",
      dispatch: null,
      updated: false,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("uses a durable unique wake identity for same-millisecond preference writes", async () => {
    const member = {
      assistantDetail: null as number | null,
      assistantHumor: null as number | null,
      assistantPush: null as number | null,
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
      mailboxPayloadMode: "sparse_delta",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        voice: "warm",
      },
      prisma,
    });
    await upsertHostedMemberAssistantPreferencesTx({
      mailboxPayloadMode: "sparse_delta",
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
      assistantDetail: null as number | null,
      assistantHumor: null as number | null,
      assistantPush: null as number | null,
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
      mailboxPayloadMode: "sparse_delta",
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

  it("emits only the preference changed by the request", async () => {
    const member = {
      assistantDetail: 5 as number | null,
      assistantHumor: 3 as number | null,
      assistantPush: 3 as number | null,
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
      mailboxPayloadMode: "sparse_delta",
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

  it("emits a complete tone and voice snapshot for the gate-off legacy consumer", async () => {
    const member = {
      assistantDetail: 5 as number | null,
      assistantHumor: 3 as number | null,
      assistantPush: 3 as number | null,
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

    await upsertHostedMemberAssistantPreferencesTx({
      mailboxPayloadMode: "legacy_snapshot",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        voice: "deep-calm",
      },
      prisma,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        preferences: {
          tone: "casual",
          voice: "deep-calm",
        },
      }),
      tx: prisma,
    });
  });

  it("persists sparse personality intent and preserves sibling values", async () => {
    const member = {
      assistantDetail: 8 as number | null,
      assistantHumor: 3 as number | null,
      assistantPush: 6 as number | null,
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
      mailboxPayloadMode: "sparse_delta",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        personality: {
          humor: 7,
        },
      },
      prisma,
    })).resolves.toMatchObject({
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
      assistantPush: 6,
    });
    expect(prisma.hostedMember.update).toHaveBeenCalledTimes(1);
    expect(prisma.hostedMember.update).toHaveBeenCalledWith({
      data: {
        assistantHumor: 7,
      },
      select: {
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
      mailboxPayloadMode: "sparse_delta",
      memberId: "member_123",
      occurredAt: "2026-07-08T12:01:00.000Z",
      preferences: {
        personality: {
          humor: 7,
        },
      },
      prisma,
    })).resolves.toMatchObject({
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

  it("fails retryably when the preference wake identity conflicts", async () => {
    const member = {
      assistantDetail: null as number | null,
      assistantHumor: null as number | null,
      assistantPush: null as number | null,
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
      mailboxPayloadMode: "sparse_delta",
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
  assistantDetail: number | null;
  assistantHumor: number | null;
  assistantPush: number | null;
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
          assistantDetail?: number;
          assistantHumor?: number;
          assistantPush?: number;
          assistantTone?: string;
          assistantToneCausalSeq?: bigint;
          assistantVoice?: string;
          assistantVoiceCausalSeq?: bigint;
        };
      }) => {
        if (input.data.assistantDetail !== undefined) {
          member.assistantDetail = input.data.assistantDetail;
        }
        if (input.data.assistantHumor !== undefined) {
          member.assistantHumor = input.data.assistantHumor;
        }
        if (input.data.assistantPush !== undefined) {
          member.assistantPush = input.data.assistantPush;
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
