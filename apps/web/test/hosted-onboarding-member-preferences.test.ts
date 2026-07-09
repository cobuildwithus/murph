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
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: {
        id: "mailbox_item_123",
      },
    });

    await expect(upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        tone: "casual",
        voice: "warm",
      },
      prisma,
      sourceType: "settings.assistant-style",
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
      memberId: "member_123",
      occurredAt: "2026-07-08T12:01:00.000Z",
      preferences: {
        tone: "casual",
      },
      prisma,
      sourceType: "settings.assistant-style",
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
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: {
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
      sourceType: "settings.assistant-style",
    });
    await upsertHostedMemberAssistantPreferencesTx({
      memberId: "member_123",
      occurredAt: "2026-07-08T12:00:00.000Z",
      preferences: {
        voice: "deep-calm",
      },
      prisma,
      sourceType: "settings.assistant-style",
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

  it("emits the full current preference snapshot when one preference changes", async () => {
    const member = {
      assistantTone: "casual" as string | null,
      assistantVoice: "warm" as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      item: {
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
      sourceType: "settings.assistant-style",
    })).resolves.toMatchObject({
      assistantTone: "casual",
      assistantVoice: "deep-calm",
      updated: true,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        kind: "member.preferences.updated",
        preferences: {
          tone: "casual",
          voice: "deep-calm",
        },
      }),
      tx: prisma,
    });
  });

  it("fails retryably when the preference wake identity conflicts", async () => {
    const member = {
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
      sourceType: "settings.assistant-style",
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
  assistantTone: string | null;
  assistantVoice: string | null;
  id: string;
}): Prisma.TransactionClient {
  return {
    hostedMember: {
      findUnique: vi.fn(async () => ({ ...member })),
      update: vi.fn(async (input: {
        data: {
          assistantTone?: string;
          assistantVoice?: string;
        };
      }) => {
        if (input.data.assistantTone !== undefined) {
          member.assistantTone = input.data.assistantTone;
        }
        if (input.data.assistantVoice !== undefined) {
          member.assistantVoice = input.data.assistantVoice;
        }
        return {
          assistantTone: member.assistantTone,
          assistantVoice: member.assistantVoice,
        };
      }),
    },
  } as unknown as Prisma.TransactionClient;
}
