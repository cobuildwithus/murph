import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  lockHostedMemberRow: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberSnapshot: vi.fn(),
  appendHostedMailboxEnvelopeTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
    readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
    readHostedMemberSnapshot: mocks.readHostedMemberSnapshot,
  };
});

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
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
  enqueueHostedMemberChannelsUpdatedTx,
  resolveHostedMemberEmailLinked,
} from "@/src/lib/hosted-onboarding/member-channel-sync";

describe("hosted onboarding member channel sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.readHostedMemberSnapshot.mockResolvedValue(makeMemberSnapshot());
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: {
        createdAt: "2026-04-15T00:00:00.000Z",
        dedupeKey: "member.channels.updated:settings.phone.sync:member_123:2026-04-15T00:00:00.000Z",
        expiresAt: null,
        id: "mailbox_member_channels_1",
        kind: "member.channels.updated",
        lane: "system",
        laneSeq: "1",
        occurredAt: "2026-04-15T00:00:00.000Z",
        payloadBytes: 256,
        payloadInlineCiphertext: "cipher_member_channels_1",
        payloadRef: null,
        payloadSchema: "murph.hosted-mailbox-item.v1",
        updatedAt: "2026-04-15T00:00:00.000Z",
        userId: "member_123",
      },
    });
  });

  it("treats a verified Privy email as authoritative without consulting canonical email authorization", async () => {
    await expect(
      resolveHostedMemberEmailLinked({
        linkedAccounts: [
          {
            address: "user@example.com",
            latest_verified_at: 1743064200,
            type: "email",
          },
        ],
        memberId: "member_123",
      }),
    ).resolves.toBe(true);

    expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
  });

  it("falls back to the canonical hosted member email authorization slice when the session has no verified email", async () => {
    const tx = {
      label: "email-link-tx",
    };
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "user@example.com",
        lookupKey: "email:user@example.com",
        verifiedAt: new Date("2026-04-12T00:00:00.000Z"),
      },
    });

    await expect(
      resolveHostedMemberEmailLinked({
        linkedAccounts: [],
        memberId: "member_123",
        prisma: tx as never,
      }),
    ).resolves.toBe(true);

    expect(mocks.readHostedMemberEmailAuthorization).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: tx,
    });
  });

  it("returns false when neither the session nor the canonical email authorization slice has a verified email", async () => {
    await expect(
      resolveHostedMemberEmailLinked({
        linkedAccounts: [],
        memberId: "member_123",
      }),
    ).resolves.toBe(false);

    expect(mocks.readHostedMemberEmailAuthorization).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: expect.anything(),
    });
  });

  it("appends exactly one occurrence-scoped system mailbox item with the resolved channel snapshot", async () => {
    const tx = {
      label: "test-prisma-tx",
    };

    await expect(
      enqueueHostedMemberChannelsUpdatedTx({
        emailLinked: true,
        memberId: "member_123",
        occurredAt: "2026-04-15T00:00:00.000Z",
        prisma: tx as never,
        sourceType: "settings.phone.sync",
      }),
    ).resolves.toEqual({
      mailboxItemId: "mailbox_member_channels_1",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: {
        eventId: "member.channels.updated:settings.phone.sync:member_123:2026-04-15T00:00:00.000Z",
        kind: "member.channels.updated",
        memberChannels: {
          email: true,
          linq: true,
          telegram: true,
        },
        occurredAt: "2026-04-15T00:00:00.000Z",
        userId: "member_123",
      },
      tx,
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(tx, "member_123");
  });

  it("derives active channel snapshots under the caller transaction lock", async () => {
    const tx = {
      label: "test-prisma-tx",
    };
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue({
      directPublicSender: null,
      memberId: "member_123",
      verifiedEmail: {
        address: "user@example.test",
        lookupKey: "email:user@example.test",
        verifiedAt: new Date("2026-04-12T00:00:00.000Z"),
      },
    });

    await expect(
      enqueueHostedMemberChannelsUpdatedForActiveMemberTx({
        linkedAccounts: [],
        memberId: "member_123",
        occurredAt: "2026-04-15T00:00:00.000Z",
        prisma: tx as never,
        sourceType: "settings.phone.sync",
      }),
    ).resolves.toEqual({
      mailboxItemId: "mailbox_member_channels_1",
    });

    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(tx, "member_123");
    expect(mocks.readHostedMemberEmailAuthorization).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: tx,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        memberChannels: {
          email: true,
          linq: true,
          telegram: true,
        },
      }),
      tx,
    });
  });

  it("skips active channel dispatch when the current locked member is not active", async () => {
    const tx = {
      label: "test-prisma-tx",
    };
    mocks.readHostedMemberSnapshot.mockResolvedValue({
      ...makeMemberSnapshot(),
      core: {
        ...makeMemberSnapshot().core,
        billingStatus: "incomplete",
      },
    });

    await expect(
      enqueueHostedMemberChannelsUpdatedForActiveMemberTx({
        linkedAccounts: [
          {
            address: "user@example.test",
            latest_verified_at: 1743064200,
            type: "email",
          },
        ],
        memberId: "member_123",
        occurredAt: "2026-04-15T00:00:00.000Z",
        prisma: tx as never,
        sourceType: "settings.phone.sync",
      }),
    ).resolves.toBeNull();

    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(tx, "member_123");
    expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("keeps the returned producer envelope stable when the mailbox append is a duplicate", async () => {
    const tx = {
      label: "test-prisma-tx",
    };
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: true,
      duplicate: true,
      inserted: false,
      item: {
        createdAt: "2026-04-15T00:00:00.000Z",
        dedupeKey: "member.channels.updated:settings.phone.sync:member_123:2026-04-15T00:00:00.000Z",
        expiresAt: null,
        id: "mailbox_member_channels_1",
        kind: "member.channels.updated",
        lane: "system",
        laneSeq: "1",
        occurredAt: "2026-04-15T00:00:00.000Z",
        payloadBytes: 128,
        payloadInlineCiphertext: "cipher_first_member_channels_1",
        payloadRef: null,
        payloadSchema: "murph.hosted-mailbox-item.v1",
        updatedAt: "2026-04-15T00:00:00.000Z",
        userId: "member_123",
      },
    });

    await expect(
      enqueueHostedMemberChannelsUpdatedTx({
        emailLinked: true,
        memberId: "member_123",
        occurredAt: "2026-04-15T00:00:00.000Z",
        prisma: tx as never,
        sourceType: "settings.phone.sync",
      }),
    ).resolves.toEqual({
      mailboxItemId: "mailbox_member_channels_1",
    });

    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: expect.objectContaining({
        eventId: "member.channels.updated:settings.phone.sync:member_123:2026-04-15T00:00:00.000Z",
        kind: "member.channels.updated",
        memberChannels: {
          email: true,
          linq: true,
          telegram: true,
        },
      }),
      tx,
    });
  });

  it("does not reintroduce old run-control terms in the migrated producer path", () => {
    const source = readFileSync(
      new URL("../src/lib/hosted-onboarding/member-channel-sync.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/\b(?:HostedRun|hostedRun|finalizeRequired|source_cursor|turn-input)\b/u);
    expect(source).not.toMatch(/\badopt(?:ed|ion)?\b/u);
  });
});

function makeMemberSnapshot(): HostedMemberSnapshot {
  return {
    billingRef: null,
    core: {
      billingStatus: "active",
      createdAt: new Date("2026-04-12T00:00:00.000Z"),
      id: "member_123",
      suspendedAt: null,
      updatedAt: new Date("2026-04-12T00:00:00.000Z"),
    },
    identity: {
      maskedPhoneNumberHint: "*** 0001",
      memberId: "member_123",
      phoneLookupKey: "hbidx:phone:v1:lookup",
      phoneNumber: "+15550100001",
      phoneNumberVerifiedAt: new Date("2026-04-12T00:00:00.000Z"),
      signupPhoneCodeSendAttemptId: null,
      signupPhoneCodeSendAttemptStartedAt: null,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      privyUserId: null,
      walletAddress: null,
      walletChainType: null,
      walletCreatedAt: null,
      walletProvider: null,
    },
    routing: {
      linqChatId: null,
      linqRecipientPhone: null,
      memberId: "member_123",
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: "telegram_user_123:business:biz-42:dm-topic:9",
      telegramUserId: "telegram_user_123",
      telegramUserLookupKey: "telegram_lookup_123",
    },
  };
}
