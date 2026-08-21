import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertActiveHostedThreadRouteContainerAccess: vi.fn(),
  lockHostedMemberRoutingStateTx: vi.fn(),
  lockHostedMemberVerifiedEmailRecordTx: vi.fn(),
  projectHostedMemberRoutingState: vi.fn(),
  projectHostedMemberVerifiedEmailRecord: vi.fn(),
  readHostedMemberRoutingRecord: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  readHostedMemberVerifiedEmailRecord: vi.fn(),
  readHostedMemberVerifiedEmailSnapshots: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >(),
  lockHostedMemberVerifiedEmailRecordTx:
    mocks.lockHostedMemberVerifiedEmailRecordTx,
  projectHostedMemberVerifiedEmailRecord:
    mocks.projectHostedMemberVerifiedEmailRecord,
  readHostedMemberVerifiedEmailRecord:
    mocks.readHostedMemberVerifiedEmailRecord,
  readHostedMemberVerifiedEmailSnapshots:
    mocks.readHostedMemberVerifiedEmailSnapshots,
}));

vi.mock(
  "@/src/lib/hosted-onboarding/hosted-member-routing-store",
  async (importOriginal) => ({
    ...await importOriginal<
      typeof import("@/src/lib/hosted-onboarding/hosted-member-routing-store")
    >(),
    lockHostedMemberRoutingStateTx: mocks.lockHostedMemberRoutingStateTx,
    projectHostedMemberRoutingState: mocks.projectHostedMemberRoutingState,
    readHostedMemberRoutingRecord: mocks.readHostedMemberRoutingRecord,
    readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
  }),
);

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertActiveHostedThreadRouteContainerAccess:
    mocks.assertActiveHostedThreadRouteContainerAccess,
}));

import {
  assertPreparedHostedMemberDirectRouteTx,
  prepareCurrentHostedMemberDirectRoute,
  readCurrentHostedMemberDirectRoute,
  readCurrentHostedMemberVerifiedEmailAddress,
} from "@/src/lib/hosted-routing/member-direct-route";
import type { HostedMemberVerifiedEmailRecord } from "@/src/lib/hosted-onboarding/hosted-member-store";
import type { HostedMemberRoutingRecord } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";

const prisma = {} as Parameters<
  typeof readCurrentHostedMemberDirectRoute
>[0]["prisma"];
const transactionPrisma = {} as Parameters<
  typeof assertPreparedHostedMemberDirectRouteTx
>[0]["prisma"];

function routingRecord(
  overrides: Partial<HostedMemberRoutingRecord> = {},
): HostedMemberRoutingRecord {
  return {
    linqChatIdEncrypted: null,
    linqChatLookupKey: null,
    linqHomeLineAssignedAt: null,
    linqParticipantContactKind: null,
    linqParticipantContactLookupKey: null,
    linqRecipientPhoneEncrypted: null,
    linqRecipientPhoneLookupKey: null,
    memberId: "member_123",
    pendingLinqChatIdEncrypted: null,
    pendingLinqChatLookupKey: null,
    pendingLinqParticipantContactEncrypted: null,
    pendingLinqParticipantContactKind: null,
    pendingLinqParticipantContactLookupKey: null,
    pendingLinqParticipantContactObservedAt: null,
    pendingLinqRecipientPhoneEncrypted: null,
    pendingLinqRecipientPhoneLookupKey: null,
    replyAliasLookupKey: null,
    telegramUserIdEncrypted: null,
    telegramUserLookupKey: null,
    ...overrides,
  };
}

function verifiedEmailRecord(): HostedMemberVerifiedEmailRecord {
  return {
    memberId: "member_123",
    verifiedEmailAddressEncrypted: "encrypted-email",
    verifiedEmailLookupKey: "email-lookup",
    verifiedEmailVerifiedAt: new Date("2026-08-20T12:00:00.000Z"),
  };
}

describe("current hosted member direct route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertActiveHostedThreadRouteContainerAccess.mockResolvedValue(undefined);
    mocks.projectHostedMemberRoutingState.mockResolvedValue(null);
    mocks.projectHostedMemberVerifiedEmailRecord.mockResolvedValue({
      memberId: "member_123",
      verifiedEmail: null,
    });
    mocks.readHostedMemberRoutingRecord.mockResolvedValue(null);
    mocks.readHostedMemberVerifiedEmailRecord.mockResolvedValue(null);
    mocks.readHostedMemberVerifiedEmailSnapshots.mockResolvedValue([]);
  });

  it("prepares the exact raw messaging-route owner state outside the transaction", async () => {
    const preparedRoutingRecord = routingRecord({ replyAliasLookupKey: "route-a" });
    mocks.readHostedMemberRoutingRecord.mockResolvedValue(preparedRoutingRecord);
    mocks.projectHostedMemberRoutingState.mockResolvedValue({
      linqChatId: "linq_home_123",
      telegramThreadId: null,
    });

    await expect(prepareCurrentHostedMemberDirectRoute({
      memberId: "member_123",
      prisma,
    })).resolves.toEqual({
      directRoute: { channel: "linq", threadId: "linq_home_123" },
      memberId: "member_123",
      routingRecord: preparedRoutingRecord,
      verifiedEmailRecord: null,
    });
    expect(mocks.readHostedMemberVerifiedEmailRecord).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedThreadRouteContainerAccess).toHaveBeenCalledWith({
      containerMemberId: "member_123",
      prisma,
    });
  });

  it.each([
    ["removed", null],
    ["changed", routingRecord({ replyAliasLookupKey: "route-b" })],
  ])("rejects a messaging route that is %s under its final row lock", async (
    _label,
    currentRoutingRecord,
  ) => {
    const prepared = {
      directRoute: { channel: "linq" as const, threadId: "linq_home_123" },
      memberId: "member_123",
      routingRecord: routingRecord({ replyAliasLookupKey: "route-a" }),
      verifiedEmailRecord: null,
    };
    mocks.readHostedMemberRoutingRecord.mockResolvedValue(currentRoutingRecord);

    await expect(assertPreparedHostedMemberDirectRouteTx({
      message: "Connect a current private route.",
      prepared,
      prisma: transactionPrisma,
    })).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_DIRECT_ROUTE_REQUIRED",
      httpStatus: 409,
    });
    expect(mocks.lockHostedMemberRoutingStateTx).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma,
    });
    expect(mocks.lockHostedMemberVerifiedEmailRecordTx).not.toHaveBeenCalled();
  });

  it("locks and compares verified-email state before accepting a prepared email route", async () => {
    const prepared = {
      directRoute: {
        channel: "email" as const,
        deliveryTarget: "member@example.test",
      },
      memberId: "member_123",
      routingRecord: null,
      verifiedEmailRecord: verifiedEmailRecord(),
    };

    await expect(assertPreparedHostedMemberDirectRouteTx({
      message: "Connect a current private route.",
      prepared,
      prisma: transactionPrisma,
    })).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_DIRECT_ROUTE_REQUIRED",
      httpStatus: 409,
    });
    expect(
      mocks.lockHostedMemberVerifiedEmailRecordTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.lockHostedMemberRoutingStateTx.mock.invocationCallOrder[0]
        ?? Number.MAX_SAFE_INTEGER,
    );
    expect(mocks.readHostedMemberVerifiedEmailRecord).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: transactionPrisma,
    });
  });

  it("rechecks canonical container access after the prepared route owner rows match", async () => {
    const preparedRoutingRecord = routingRecord();
    mocks.readHostedMemberRoutingRecord.mockResolvedValue(preparedRoutingRecord);
    await expect(assertPreparedHostedMemberDirectRouteTx({
      message: "Connect a current private route.",
      prepared: {
        directRoute: { channel: "linq", threadId: "linq_home_123" },
        memberId: "member_123",
        routingRecord: preparedRoutingRecord,
        verifiedEmailRecord: null,
      },
      prisma: transactionPrisma,
    })).resolves.toBeUndefined();

    expect(mocks.assertActiveHostedThreadRouteContainerAccess).toHaveBeenCalledWith({
      containerMemberId: "member_123",
      prisma: transactionPrisma,
    });
  });

  it("prefers the current Linq home route and verifies active access", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: " linq_home_123 ",
      telegramThreadId: "telegram_home_123",
    });

    await expect(readCurrentHostedMemberDirectRoute({
      memberId: "member_123",
      prisma,
    })).resolves.toEqual({ channel: "linq", threadId: "linq_home_123" });
    expect(mocks.readHostedMemberVerifiedEmailSnapshots).not.toHaveBeenCalled();
    expect(mocks.assertActiveHostedThreadRouteContainerAccess).toHaveBeenCalledWith({
      containerMemberId: "member_123",
      prisma,
    });
  });

  it("falls back to Telegram and fails closed on revoked access", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      telegramThreadId: "telegram_home_123",
    });
    mocks.assertActiveHostedThreadRouteContainerAccess.mockRejectedValue(
      new Error("access revoked"),
    );

    await expect(readCurrentHostedMemberDirectRoute({
      memberId: "member_123",
      prisma,
    })).rejects.toThrow("access revoked");
  });

  it("falls back to the member's verified email and verifies active access", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: null,
      telegramThreadId: null,
    });
    mocks.readHostedMemberVerifiedEmailSnapshots.mockResolvedValue([{
      memberId: "member_123",
      verifiedEmail: {
        address: " member@example.test ",
        lookupKey: "hbidx:email:v1:member",
        verifiedAt: new Date("2026-07-23T12:00:00.000Z"),
      },
    }]);

    await expect(readCurrentHostedMemberDirectRoute({
      memberId: "member_123",
      prisma,
    })).resolves.toEqual({
      channel: "email",
      deliveryTarget: "member@example.test",
    });
    expect(mocks.assertActiveHostedThreadRouteContainerAccess).toHaveBeenCalledWith({
      containerMemberId: "member_123",
      prisma,
    });
  });

  it("returns no route without performing an access assertion", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      linqChatId: " ",
      telegramThreadId: null,
    });

    await expect(readCurrentHostedMemberDirectRoute({
      memberId: "member_123",
      prisma,
    })).resolves.toBeNull();
    expect(mocks.assertActiveHostedThreadRouteContainerAccess).not.toHaveBeenCalled();
  });

  it("re-resolves the current verified email and enforces active access", async () => {
    mocks.readHostedMemberVerifiedEmailSnapshots.mockResolvedValue([{
      memberId: "member_123",
      verifiedEmail: {
        address: " current@example.test ",
        lookupKey: "hbidx:email:v1:current",
        verifiedAt: new Date("2026-07-23T12:00:00.000Z"),
      },
    }]);

    await expect(readCurrentHostedMemberVerifiedEmailAddress({
      memberId: "member_123",
      prisma,
    })).resolves.toBe("current@example.test");
    expect(mocks.assertActiveHostedThreadRouteContainerAccess).toHaveBeenCalledWith({
      containerMemberId: "member_123",
      prisma,
    });
  });
});
