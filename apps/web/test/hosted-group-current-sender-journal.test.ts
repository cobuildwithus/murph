import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  readAuthority: vi.fn(),
  resolveDestination: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeWithIdentityTx: mocks.append,
}));
vi.mock("@/src/lib/hosted-groups/group-current-sender-assistant-ask", () => ({
  readHostedGroupCurrentSenderAuthorityTx: mocks.readAuthority,
}));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  resolveHostedAssistantNotificationDestination: mocks.resolveDestination,
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => testPrisma }));

import {
  recordHostedGroupCurrentSenderJournalFact,
  setHostedGroupCurrentSenderJournalCapture,
} from "@/src/lib/hosted-groups/group-current-sender-journal";

const GROUP_RUNTIME_MEMBER_ID = "member_group_runtime";
const MEMBER_ID = "member_current_sender";
const INPUT_ID = `ain_${"a".repeat(32)}`;
const NOW = new Date("2026-08-31T18:00:00.000Z");

const fakeTx = {
  hostedGroup: { findUnique: vi.fn() },
  hostedGroupMember: { findFirst: vi.fn(), updateMany: vi.fn() },
  hostedMember: { update: vi.fn(), updateMany: vi.fn() },
};

function asTransactionClient(value: typeof fakeTx): Prisma.TransactionClient {
  // This focused unit fixture provides only the methods used by this owner.
  // @ts-expect-error -- deliberate narrow Prisma transaction test double.
  return value;
}

const testPrisma = {
  $transaction: async <T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> => run(asTransactionClient(fakeTx)),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readAuthority.mockResolvedValue({
    groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
    messageText: "I worked in the yard for two hours.",
    occurredAt: NOW.toISOString(),
    sourceChannel: "linq",
    targetMemberId: MEMBER_ID,
  });
  mocks.resolveDestination.mockResolvedValue({
    conversationShape: "direct-member",
    externalThreadRouteAuthority: null,
    route: {
      actorId: null,
      channel: "linq",
      delivery: { kind: "thread", target: "private-thread" },
      identityId: "identity-private",
      threadId: "private-thread",
      threadIsDirect: true,
    },
  });
  mocks.append.mockImplementation(
    async (input: { envelope: { eventId: string }; itemId: string }) => ({
      dedupeConflict: false,
      item: { id: input.itemId },
    }),
  );
  fakeTx.hostedMember.update.mockResolvedValue({ id: MEMBER_ID });
  fakeTx.hostedMember.updateMany.mockResolvedValue({ count: 1 });
  fakeTx.hostedGroup.findUnique.mockResolvedValue({ id: "group-1" });
  fakeTx.hostedGroupMember.updateMany.mockResolvedValue({ count: 1 });
});

describe("hosted current-sender group Journal capture", () => {
  it("asks one private global consent question for the first clear fact", async () => {
    setCaptureState(null, null, null);

    await expect(recordFact("high")).resolves.toMatchObject({
      mailboxWake: { expectedUserId: MEMBER_ID },
      result: { status: "handled" },
    });
    expect(mocks.append).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          kind: "assistant.notification.requested",
          userId: MEMBER_ID,
        }),
      }),
    );
    expect(fakeTx.hostedMember.update).toHaveBeenCalledWith({
      data: { groupJournalCaptureConsentRequestedAt: NOW },
      where: { id: MEMBER_ID },
    });
    expect(mocks.readAuthority).toHaveBeenCalledWith({
      expectedGroupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
      now: NOW,
      origin: origin(),
      tx: asTransactionClient(fakeTx),
    });
  });

  it("does not ask a private clarification before Journal consent", async () => {
    setCaptureState(null, null, null);

    await expect(recordFact("medium")).resolves.toEqual({
      mailboxWake: null,
      result: { status: "handled" },
    });
    expect(mocks.append).not.toHaveBeenCalled();
    expect(fakeTx.hostedMember.update).not.toHaveBeenCalled();
  });

  it("does not retain later facts while the consent choice is pending", async () => {
    setCaptureState(null, NOW, null);

    await expect(recordFact("high")).resolves.toEqual({
      mailboxWake: null,
      result: { status: "handled" },
    });
    expect(mocks.append).not.toHaveBeenCalled();
    expect(fakeTx.hostedMember.update).not.toHaveBeenCalled();
  });

  it("does not write or ask when current-sender authority is unavailable", async () => {
    mocks.readAuthority.mockResolvedValue(null);

    await expect(recordFact("high")).resolves.toEqual({
      mailboxWake: null,
      result: {
        status: "unavailable",
        unavailableReason: "current_sender_unavailable",
      },
    });
    expect(mocks.append).not.toHaveBeenCalled();
    expect(fakeTx.hostedMember.update).not.toHaveBeenCalled();
  });

  it("saves a later clear fact to the private mailbox after consent", async () => {
    setCaptureState(true, NOW, null);

    await expect(recordFact("high")).resolves.toMatchObject({
      result: { status: "handled" },
    });
    expect(mocks.append).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          journalFact: expect.objectContaining({ title: "Yard work" }),
          kind: "journal.group-fact.recorded",
          userId: MEMBER_ID,
        }),
      }),
    );
  });

  it("asks privately for medium confidence and stays silent when disabled", async () => {
    setCaptureState(true, NOW, null);
    await recordFact("medium");
    expect(mocks.append).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          kind: "assistant.notification.requested",
        }),
      }),
    );

    vi.clearAllMocks();
    mocks.readAuthority.mockResolvedValue({
      occurredAt: NOW.toISOString(),
      sourceChannel: "linq",
      targetMemberId: MEMBER_ID,
    });
    setCaptureState(false, NOW, null);
    await expect(recordFact("high")).resolves.toEqual({
      mailboxWake: null,
      result: { status: "handled" },
    });
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("stores a current-sender opt-out for only this group", async () => {
    await expect(
      setHostedGroupCurrentSenderJournalCapture({
        enabled: false,
        groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
        now: NOW,
        origin: origin(),
        prisma: testPrisma,
        scope: "group",
      }),
    ).resolves.toMatchObject({ result: { status: "handled" } });
    expect(fakeTx.hostedGroupMember.updateMany).toHaveBeenCalledWith({
      data: { journalCaptureDisabledAt: NOW },
      where: { groupId: "group-1", memberId: MEMBER_ID },
    });
  });
});

function setCaptureState(
  enabled: boolean | null,
  requestedAt: Date | null,
  disabledAt: Date | null,
): void {
  fakeTx.hostedGroupMember.findFirst.mockResolvedValue({
    journalCaptureDisabledAt: disabledAt,
    member: {
      groupJournalCaptureConsentRequestedAt: requestedAt,
      groupJournalCaptureEnabled: enabled,
    },
  });
}

function recordFact(confidence: "high" | "medium") {
  return recordHostedGroupCurrentSenderJournalFact({
    confidence,
    groupRuntimeMemberId: GROUP_RUNTIME_MEMBER_ID,
    journalFact: {
      date: "2026-08-31",
      factIndex: 1,
      note: "Worked in the yard for two hours.",
      noteType: "journal-factor",
      title: "Yard work",
    },
    now: NOW,
    origin: origin(),
    prisma: testPrisma,
    privateQuestion: "Can I save this in your private Journal?",
  });
}

function origin() {
  return {
    assistantInputId: INPUT_ID,
    kind: "accepted_input" as const,
    sessionId: "session-group",
  };
}
