import { describe, expect, it, vi } from "vitest";
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
  upsertHostedMemberAssistantPreferencesTx,
} from "@/src/lib/hosted-onboarding/member-preferences";

describe("hosted member assistant preferences", () => {
  it("updates changed preferences and appends a member preferences wake", async () => {
    const member = {
      assistantTone: null as string | null,
      assistantVoice: null as string | null,
      id: "member_123",
    };
    const prisma = createPreferencesPrismaDouble(member);
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
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
      envelope: {
        eventId: "member.preferences.updated:settings.assistant-style:member_123:2026-07-08T12:00:00.000Z",
        kind: "member.preferences.updated",
        occurredAt: "2026-07-08T12:00:00.000Z",
        preferences: {
          tone: "casual",
          voice: "warm",
        },
        userId: "member_123",
      },
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
