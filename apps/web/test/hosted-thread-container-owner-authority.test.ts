import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demoteHostedMemberLinqGroupChatBindingsTx: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedRuntimeAiAccessDecision: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  demoteHostedMemberLinqGroupChatBindingsTx:
    mocks.demoteHostedMemberLinqGroupChatBindingsTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/hosted-member-store")
  >();
  return {
    ...actual,
    readHostedMemberCoreState: mocks.readHostedMemberCoreState,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({
  readHostedRuntimeAiAccessDecision: mocks.readHostedRuntimeAiAccessDecision,
}));

import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  ensureHostedLinqThreadContainerRouteFromParticipantAddTx,
  ensureHostedThreadContainerRouteTx,
} from "@/src/lib/hosted-routing/thread-container-service";

const ACCOUNT_LOOKUP_KEY = "account-lookup-key";
const CHAT_ID = "chat-existing-friends";
const CONTAINER_MEMBER_ID = "member-group-runtime";
const CURRENT_OWNER_MEMBER_ID = "member-first-speaker";
const ADDER_MEMBER_ID = "member-adder";
const OCCURRED_AT = new Date("2026-07-29T05:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.demoteHostedMemberLinqGroupChatBindingsTx.mockResolvedValue({
    mailboxConsumedAt: null,
  });
  mocks.readHostedMemberCoreState.mockResolvedValue({
    billingStatus: "active",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    id: ADDER_MEMBER_ID,
    suspendedAt: null,
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  });
  mocks.readHostedRuntimeAiAccessDecision.mockResolvedValue({ allowed: true });
});

describe("Linq participant-add owner authority", () => {
  it("corrects a first-speaker route through the existing canonical owner field", async () => {
    const prisma = buildPrisma();

    await expect(
      ensureHostedLinqThreadContainerRouteFromParticipantAddTx({
        accountLookupKey: ACCOUNT_LOOKUP_KEY,
        occurredAt: OCCURRED_AT,
        ownerMemberId: ADDER_MEMBER_ID,
        prisma: prisma as never,
        threadId: CHAT_ID,
      }),
    ).resolves.toMatchObject({
      containerMemberId: CONTAINER_MEMBER_ID,
      created: false,
    });

    expect(prisma.hostedThreadContainer.updateMany).toHaveBeenCalledWith({
      data: {
        ownerMemberId: ADDER_MEMBER_ID,
      },
      where: {
        memberId: CONTAINER_MEMBER_ID,
        ownerMemberId: CURRENT_OWNER_MEMBER_ID,
      },
    });
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.demoteHostedMemberLinqGroupChatBindingsTx.mock
        .invocationCallOrder[0]!,
    );
  });

  it("keeps ordinary route ensures unable to replace an owner", async () => {
    const prisma = buildPrisma();

    await expect(ensureHostedThreadContainerRouteTx({
      accountLookupKey: ACCOUNT_LOOKUP_KEY,
      channel: "linq",
      occurredAt: OCCURRED_AT,
      ownerMemberId: ADDER_MEMBER_ID,
      prisma: prisma as never,
      threadId: CHAT_ID,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
      retryable: false,
    });

    expect(prisma.hostedThreadContainer.updateMany).not.toHaveBeenCalled();
  });

  it("does not correct a route owned by a different Linq account", async () => {
    const prisma = buildPrisma({ routeAccountLookupKey: "different-account" });

    await expect(
      ensureHostedLinqThreadContainerRouteFromParticipantAddTx({
        accountLookupKey: ACCOUNT_LOOKUP_KEY,
        occurredAt: OCCURRED_AT,
        ownerMemberId: ADDER_MEMBER_ID,
        prisma: prisma as never,
        threadId: CHAT_ID,
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
    });

    expect(prisma.hostedThreadContainer.updateMany).not.toHaveBeenCalled();
  });
});

function buildPrisma(input: {
  routeAccountLookupKey?: string;
} = {}) {
  const routeAccountLookupKey =
    input.routeAccountLookupKey ?? ACCOUNT_LOOKUP_KEY;
  const threadIdentityLookupKey =
    createHostedExternalThreadIdentityLookupKey({
      channel: "linq",
      threadId: CHAT_ID,
    });
  const threadLookupKey = createHostedExternalThreadLookupKey({
    accountLookupKey: routeAccountLookupKey,
    channel: "linq",
    threadId: CHAT_ID,
  });
  if (!threadIdentityLookupKey || !threadLookupKey) {
    throw new Error("Expected test route lookup keys.");
  }

  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
    hostedThreadContainer: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hostedThreadRoute: {
      findMany: vi.fn().mockResolvedValue([
        {
          container: {
            ownerMemberId: CURRENT_OWNER_MEMBER_ID,
          },
          containerMemberId: CONTAINER_MEMBER_ID,
          deliveryRouteEncrypted: "encrypted-delivery-route",
          threadIdentityLookupKey,
          threadLookupKey,
        },
      ]),
    },
  };
}
