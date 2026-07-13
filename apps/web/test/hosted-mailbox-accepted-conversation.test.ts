import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendHostedMailboxEnvelopeTx: vi.fn(),
  preserveHostedAcceptedConversationAllowancePeriodTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
  resolveHostedMailboxLaneForKind: (kind: string) =>
    kind === "conversation.message" ? "conversation" : "system",
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  preserveHostedAcceptedConversationAllowancePeriodTx:
    mocks.preserveHostedAcceptedConversationAllowancePeriodTx,
}));

import {
  appendHostedAcceptedConversationEnvelopeTx,
} from "@/src/lib/hosted-mailbox/accepted-conversation";

describe("appendHostedAcceptedConversationEnvelopeTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preserveHostedAcceptedConversationAllowancePeriodTx.mockResolvedValue(
      new Date("2026-07-01T00:00:00.000Z"),
    );
  });

  it("preserves the allowance period in the same transaction as a new conversation row", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      hostedMailboxItem: {
        findUnique: vi.fn(async () => ({ acceptedAllowancePeriodStart: null })),
        updateMany,
      },
    };
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      duplicate: false,
      inserted: true,
      item: {
        createdAt: "2026-07-12T18:00:00.000Z",
        id: "mailbox_accepted_1",
      },
    });
    const envelope = {
      eventId: "conversation:accepted:1",
      kind: "conversation.message" as const,
      occurredAt: "2026-07-12T18:00:00.000Z",
      userId: "member_accepted_1",
    };

    await appendHostedAcceptedConversationEnvelopeTx({
      envelope: envelope as never,
      tx: tx as never,
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope,
      tx,
    });
    expect(mocks.preserveHostedAcceptedConversationAllowancePeriodTx).toHaveBeenCalledWith({
      acceptedAt: "2026-07-12T18:00:00.000Z",
      allowUniqueExistingPeriod: false,
      memberId: "member_accepted_1",
      tx,
    });
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        acceptedAllowancePeriodStart: new Date("2026-07-01T00:00:00.000Z"),
      },
      where: {
        acceptedAllowancePeriodStart: null,
        id: "mailbox_accepted_1",
        kind: "conversation.message",
        userId: "member_accepted_1",
      },
    });
    expect(
      mocks.appendHostedMailboxEnvelopeTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.preserveHostedAcceptedConversationAllowancePeriodTx.mock.invocationCallOrder[0],
    );
  });

  it("reuses an exact period binding for a duplicate row", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      duplicate: true,
      inserted: false,
      item: {
        createdAt: "2026-07-12T18:00:00.000Z",
        id: "mailbox_accepted_duplicate",
      },
    });
    const updateMany = vi.fn();
    const tx = {
      hostedMailboxItem: {
        findUnique: vi.fn(async () => ({
          acceptedAllowancePeriodStart: new Date("2026-07-01T00:00:00.000Z"),
        })),
        updateMany,
      },
    };

    await appendHostedAcceptedConversationEnvelopeTx({
      envelope: {
        eventId: "conversation:accepted:duplicate",
        kind: "conversation.message",
        occurredAt: "2026-07-12T18:00:00.000Z",
        userId: "member_accepted_1",
      } as never,
      tx: tx as never,
    });

    expect(mocks.preserveHostedAcceptedConversationAllowancePeriodTx).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("repairs a legacy duplicate whose exact period binding is null", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      duplicate: true,
      inserted: false,
      item: {
        createdAt: "2026-07-12T18:00:00.000Z",
        id: "mailbox_accepted_legacy_duplicate",
      },
    });
    const tx = {
      hostedMailboxItem: {
        findUnique: vi.fn(async () => ({ acceptedAllowancePeriodStart: null })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };

    await appendHostedAcceptedConversationEnvelopeTx({
      envelope: {
        eventId: "conversation:accepted:legacy-duplicate",
        kind: "conversation.message",
        occurredAt: "2026-07-12T18:00:00.000Z",
        userId: "member_accepted_1",
      } as never,
      tx: tx as never,
    });

    expect(mocks.preserveHostedAcceptedConversationAllowancePeriodTx).toHaveBeenCalledWith({
      acceptedAt: "2026-07-12T18:00:00.000Z",
      allowUniqueExistingPeriod: true,
      memberId: "member_accepted_1",
      tx,
    });
  });

  it("propagates period-preservation failure so the enclosing transaction can roll back", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      duplicate: false,
      inserted: true,
      item: {
        createdAt: "2026-07-12T18:00:00.000Z",
        id: "mailbox_accepted_rollback",
      },
    });
    mocks.preserveHostedAcceptedConversationAllowancePeriodTx.mockRejectedValue(
      new Error("synthetic allowance period failure"),
    );

    await expect(appendHostedAcceptedConversationEnvelopeTx({
      envelope: {
        eventId: "conversation:accepted:rollback",
        kind: "conversation.message",
        occurredAt: "2026-07-12T18:00:00.000Z",
        userId: "member_accepted_1",
      } as never,
      tx: {
        hostedMailboxItem: {
          findUnique: vi.fn(async () => ({ acceptedAllowancePeriodStart: null })),
          updateMany: vi.fn(),
        },
      } as never,
    })).rejects.toThrow("synthetic allowance period failure");
  });

  it("fails closed when it cannot bind the exact accepted conversation row", async () => {
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      duplicate: false,
      inserted: true,
      item: {
        createdAt: "2026-07-12T18:00:00.000Z",
        id: "mailbox_accepted_unbound",
      },
    });

    await expect(appendHostedAcceptedConversationEnvelopeTx({
      envelope: {
        eventId: "conversation:accepted:unbound",
        kind: "conversation.message",
        occurredAt: "2026-07-12T18:00:00.000Z",
        userId: "member_accepted_1",
      } as never,
      tx: {
        hostedMailboxItem: {
          findUnique: vi.fn(async () => ({ acceptedAllowancePeriodStart: null })),
          updateMany: vi.fn(async () => ({ count: 0 })),
        },
      } as never,
    })).rejects.toThrow("allowance period binding failed");
  });

  it("rejects non-conversation envelopes before append", async () => {
    await expect(appendHostedAcceptedConversationEnvelopeTx({
      envelope: {
        eventId: "member.activated:1",
        kind: "member.activated",
        occurredAt: "2026-07-12T18:00:00.000Z",
        userId: "member_accepted_1",
      } as never,
      tx: {} as never,
    })).rejects.toThrow("requires a conversation envelope");

    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });
});
