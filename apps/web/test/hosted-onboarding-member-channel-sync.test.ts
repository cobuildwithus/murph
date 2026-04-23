import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostedMemberSnapshot } from "@/src/lib/hosted-onboarding/hosted-member-store";

const mocks = vi.hoisted(() => ({
  lockHostedMemberRow: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberSnapshot: vi.fn(),
  materializeHostedIngressEnvelopeTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-ingress/lifecycle", () => ({
  materializeHostedIngressEnvelopeTx: mocks.materializeHostedIngressEnvelopeTx,
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
  enqueueHostedMemberChannelsUpdatedTx,
  resolveHostedMemberEmailLinked,
} from "@/src/lib/hosted-onboarding/member-channel-sync";

describe("hosted onboarding member channel sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockHostedMemberRow.mockResolvedValue(undefined);
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.readHostedMemberSnapshot.mockResolvedValue(makeMemberSnapshot());
    mocks.materializeHostedIngressEnvelopeTx.mockResolvedValue({
      eventId: "member.channels.updated:settings.phone.sync:member_123:2026-04-15T00:00:00.000Z",
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
      }),
    ).resolves.toBe(true);

    expect(mocks.readHostedMemberEmailAuthorization).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: expect.anything(),
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

  it("schedules an occurrence-scoped member.channels.updated dispatch with the resolved channel snapshot", async () => {
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
      eventId: "member.channels.updated:settings.phone.sync:member_123:2026-04-15T00:00:00.000Z",
      kind: "member.channels.updated",
      memberChannels: {
        email: true,
        linq: true,
        telegram: true,
      },
      occurredAt: "2026-04-15T00:00:00.000Z",
      userId: "member_123",
    });

    expect(mocks.materializeHostedIngressEnvelopeTx).toHaveBeenCalledWith({
      wake: {
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

  it("accepts a canonical wake append result without changing the returned dispatch", async () => {
    const tx = {
      label: "test-prisma-tx",
    };
    mocks.materializeHostedIngressEnvelopeTx.mockResolvedValue({
      eventId: "member.channels.updated:settings.phone.sync:member_123:2026-04-15T00:00:00.000Z",
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
      eventId: "member.channels.updated:settings.phone.sync:member_123:2026-04-15T00:00:00.000Z",
      kind: "member.channels.updated",
      memberChannels: {
        email: true,
        linq: true,
        telegram: true,
      },
      occurredAt: "2026-04-15T00:00:00.000Z",
      userId: "member_123",
    });

    expect(mocks.materializeHostedIngressEnvelopeTx).toHaveBeenCalledWith({
      wake: expect.objectContaining({
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
      telegramThreadId: "telegram_user_123:business:biz-42:dm-topic:9",
      telegramUserId: "telegram_user_123",
      telegramUserLookupKey: "telegram_lookup_123",
    },
  };
}
