import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  enqueueHostedExecutionOutbox: vi.fn(),
  hasHostedVerifiedEmailUserEnv: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  readHostedMemberSnapshot: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  hasHostedVerifiedEmailUserEnv: mocks.hasHostedVerifiedEmailUserEnv,
}));

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >("@/src/lib/hosted-onboarding/hosted-member-store");

  return {
    ...actual,
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
  enqueueHostedMemberChannelsUpdatedTx,
  resolveHostedMemberEmailLinked,
} from "@/src/lib/hosted-onboarding/member-channel-sync";

describe("hosted onboarding member channel sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasHostedVerifiedEmailUserEnv.mockResolvedValue(false);
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.readHostedMemberSnapshot.mockResolvedValue(makeMemberSnapshot());
  });

  it("treats a verified Privy email as authoritative without consulting hosted env status", async () => {
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
        onUnconfirmed: "retry",
      }),
    ).resolves.toBe(true);

    expect(mocks.hasHostedVerifiedEmailUserEnv).not.toHaveBeenCalled();
  });

  it("falls back to hosted verified-email env state when the current session has no verified email yet", async () => {
    mocks.hasHostedVerifiedEmailUserEnv.mockResolvedValue(true);

    await expect(
      resolveHostedMemberEmailLinked({
        linkedAccounts: [],
        memberId: "member_123",
        onUnconfirmed: "retry",
      }),
    ).resolves.toBe(true);

    expect(mocks.hasHostedVerifiedEmailUserEnv).toHaveBeenCalledWith("member_123");
  });

  it("fails with a retryable conflict when hosted email status cannot be confirmed", async () => {
    mocks.hasHostedVerifiedEmailUserEnv.mockResolvedValue(null);

    await expect(
      resolveHostedMemberEmailLinked({
        linkedAccounts: [],
        memberId: "member_123",
        onUnconfirmed: "retry",
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_EMAIL_SYNC_STATUS_UNAVAILABLE",
      httpStatus: 409,
      retryable: true,
    });
  });

  it("treats activation email as disabled when hosted email status is temporarily unavailable", async () => {
    mocks.hasHostedVerifiedEmailUserEnv.mockResolvedValue(null);

    await expect(
      resolveHostedMemberEmailLinked({
        linkedAccounts: [],
        memberId: "member_123",
        onUnconfirmed: "disable",
      }),
    ).resolves.toBe(false);

    expect(mocks.hasHostedVerifiedEmailUserEnv).toHaveBeenCalledWith("member_123");
  });

  it("treats a verified Privy email as authoritative during activation without consulting hosted env status", async () => {
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
        onUnconfirmed: "disable",
      }),
    ).resolves.toBe(true);

    expect(mocks.hasHostedVerifiedEmailUserEnv).not.toHaveBeenCalled();
  });

  it("enqueues an occurrence-scoped member.channels.updated dispatch with the resolved channel snapshot", async () => {
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
      event: {
        kind: "member.channels.updated",
        memberChannels: {
          email: true,
          linq: true,
          telegram: true,
        },
        userId: "member_123",
      },
      eventId: "member.channels.updated:settings.phone.sync:member_123:2026-04-15T00:00:00.000Z",
      occurredAt: "2026-04-15T00:00:00.000Z",
    });

    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith({
      dispatch: {
        event: {
          kind: "member.channels.updated",
          memberChannels: {
            email: true,
            linq: true,
            telegram: true,
          },
          userId: "member_123",
        },
        eventId: "member.channels.updated:settings.phone.sync:member_123:2026-04-15T00:00:00.000Z",
        occurredAt: "2026-04-15T00:00:00.000Z",
      },
      sourceId: "member.channels.updated:settings.phone.sync:member_123:2026-04-15T00:00:00.000Z",
      sourceType: "settings.phone.sync",
      tx,
    });
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(tx, "member_123");
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
      pendingLinqRecipientPhone: null,
      telegramUserId: "telegram_user_123",
      telegramUserLookupKey: "telegram_lookup_123",
    },
  };
}
