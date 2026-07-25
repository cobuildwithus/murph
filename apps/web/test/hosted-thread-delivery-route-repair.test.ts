import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
} from "../src/lib/hosted-onboarding/contact-privacy";
import {
  resolveHostedAssistantNotificationDestination,
} from "../src/lib/hosted-routing/assistant-notification-destination";
import {
  refreshHostedThreadContainerDeliveryRouteTx,
} from "../src/lib/hosted-routing/thread-container-service";
import {
  buildHostedThreadDeliveryRoute,
  HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
  openHostedThreadDeliveryRoute,
  sealHostedThreadDeliveryRoute,
  type HostedThreadDeliveryRouteChannel,
  type HostedThreadDeliveryRouteV1,
} from "../src/lib/hosted-routing/thread-delivery-route";

const repairMocks = vi.hoisted(() => ({
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  demoteHostedMemberLinqGroupChatBindingsTx: vi.fn(),
}));

vi.mock("../src/lib/hosted-routing/thread-route-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lib/hosted-routing/thread-route-store")
  >();
  return {
    ...actual,
    assertHostedThreadRouteEgressAuthority:
      repairMocks.assertHostedThreadRouteEgressAuthority,
  };
});

vi.mock(
  "../src/lib/hosted-onboarding/hosted-member-routing-store",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../src/lib/hosted-onboarding/hosted-member-routing-store")
    >();
    return {
      ...actual,
      demoteHostedMemberLinqGroupChatBindingsTx:
        repairMocks.demoteHostedMemberLinqGroupChatBindingsTx,
    };
  },
);

const CORRUPT_ROUTE_FIXTURES = [
  {
    accountLookupKey: "linq-owner-account",
    channel: "linq",
    containerMemberId: "linq-container",
    threadId: "linq-group-thread",
  },
  {
    accountLookupKey: HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
    channel: "telegram",
    containerMemberId: "telegram-container",
    threadId: "-1001234567890",
  },
] as const;

describe("hosted thread delivery-route repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repairMocks.assertHostedThreadRouteEgressAuthority.mockResolvedValue(
      undefined,
    );
    repairMocks.demoteHostedMemberLinqGroupChatBindingsTx.mockResolvedValue({
      mailboxConsumedAt: null,
    });
  });

  it.each(CORRUPT_ROUTE_FIXTURES)(
    "repairs non-empty corrupt $channel owner material and restores detached delivery",
    async (fixture) => {
      const expectedRoute = buildHostedThreadDeliveryRoute(fixture);
      const harness = createRepairHarness({
        channel: fixture.channel,
        containerMemberId: fixture.containerMemberId,
        deliveryRouteEncrypted: "corrupt-delivery-route",
        pendingGroupReactionContextEncrypted:
          "same-authority-reaction-context",
        ...requireRouteLookupKeys(fixture),
      });

      await expect(refreshHostedThreadContainerDeliveryRouteTx({
        accountLookupKey: fixture.accountLookupKey,
        ...(fixture.channel === "linq"
          ? { accountLookupKeys: [fixture.accountLookupKey] }
          : {}),
        prisma: harness.prisma as never,
        route: buildRouteSnapshot(harness.readRow()) as never,
        threadId: fixture.threadId,
      })).resolves.toMatchObject({
        deliveryRoute: expectedRoute,
      });

      expect(harness.update).toHaveBeenCalledTimes(1);
      await expectRepairedRoute({
        expectedRoute,
        harness,
      });
    },
  );

  it("repairs valid ciphertext whose embedded Linq authority does not match the row", async () => {
    const expectedRoute = buildHostedThreadDeliveryRoute({
      accountLookupKey: "linq-owner-account",
      channel: "linq",
      threadId: "linq-group-thread",
    });
    // Narrow the channel union by control flow rather than a cast: only the
    // Linq variant carries accountLookupKey, and this case is Linq-specific.
    if (expectedRoute.channel !== "linq") {
      throw new TypeError("Expected a Linq delivery route fixture.");
    }
    const mismatchedCiphertext = await sealHostedThreadDeliveryRoute({
      containerMemberId: "linq-container",
      route: buildHostedThreadDeliveryRoute({
        accountLookupKey: "linq-different-account",
        channel: "linq",
        threadId: "different-group-thread",
      }),
    });
    const harness = createRepairHarness({
      channel: expectedRoute.channel,
      containerMemberId: "linq-container",
      deliveryRouteEncrypted: mismatchedCiphertext,
      pendingGroupReactionContextEncrypted:
        "same-authority-reaction-context",
      ...requireRouteLookupKeys({
        accountLookupKey: expectedRoute.accountLookupKey,
        channel: expectedRoute.channel,
        threadId: expectedRoute.threadId,
      }),
    });

    await expect(refreshHostedThreadContainerDeliveryRouteTx({
      accountLookupKey: expectedRoute.accountLookupKey,
      accountLookupKeys: [expectedRoute.accountLookupKey],
      prisma: harness.prisma as never,
      route: buildRouteSnapshot(harness.readRow()) as never,
      threadId: expectedRoute.threadId,
    })).resolves.toMatchObject({
      deliveryRoute: expectedRoute,
    });

    expect(harness.readRow().deliveryRouteEncrypted).not.toBe(
      mismatchedCiphertext,
    );
    await expectRepairedRoute({
      expectedRoute,
      harness,
    });
  });
});

interface MutableHostedThreadRouteRow {
  channel: HostedThreadDeliveryRouteChannel;
  containerMemberId: string;
  deliveryRouteEncrypted: string | null;
  pendingGroupReactionContextEncrypted: string | null;
  threadIdentityLookupKey: string;
  threadLookupKey: string;
}

function createRepairHarness(input: MutableHostedThreadRouteRow) {
  const row = { ...input };
  const update = vi.fn(async ({
    data,
  }: {
    data: {
      deliveryRouteEncrypted: string;
      pendingGroupReactionContextEncrypted?: string | null;
      threadIdentityLookupKey: string;
      threadLookupKey: string;
    };
  }) => {
    row.deliveryRouteEncrypted = data.deliveryRouteEncrypted;
    row.threadIdentityLookupKey = data.threadIdentityLookupKey;
    row.threadLookupKey = data.threadLookupKey;
    if (Object.hasOwn(data, "pendingGroupReactionContextEncrypted")) {
      row.pendingGroupReactionContextEncrypted =
        data.pendingGroupReactionContextEncrypted ?? null;
    }
    return row;
  });
  const prisma = {
    // The refresh path takes the container route advisory lock before writing,
    // so the fake must answer $executeRaw the way the sibling route fakes do.
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => []),
    hostedThreadContainer: {
      findUnique: vi.fn(async ({
        where,
      }: {
        where: { memberId: string };
      }) => where.memberId === row.containerMemberId
        ? { memberId: row.containerMemberId }
        : null),
    },
    hostedThreadRoute: {
      findMany: vi.fn(async () => [row]),
      update,
    },
  };

  return {
    prisma,
    readRow: () => row,
    update,
  };
}

function buildRouteSnapshot(row: MutableHostedThreadRouteRow) {
  return {
    channel: row.channel,
    containerMemberId: row.containerMemberId,
    deliveryRouteState: {
      deliveryRouteEncryptedPresent:
        typeof row.deliveryRouteEncrypted === "string"
        && row.deliveryRouteEncrypted.length > 0,
      threadIdentityLookupKey: row.threadIdentityLookupKey,
      threadLookupKey: row.threadLookupKey,
    },
  };
}

function requireRouteLookupKeys(input: {
  accountLookupKey: string;
  channel: HostedThreadDeliveryRouteChannel;
  threadId: string;
}) {
  const threadIdentityLookupKey =
    createHostedExternalThreadIdentityLookupKey({
      channel: input.channel,
      threadId: input.threadId,
    });
  const threadLookupKey = createHostedExternalThreadLookupKey({
    accountLookupKey: input.accountLookupKey,
    channel: input.channel,
    threadId: input.threadId,
  });
  if (!threadIdentityLookupKey || !threadLookupKey) {
    throw new Error("Expected hosted thread route lookup keys.");
  }
  return {
    threadIdentityLookupKey,
    threadLookupKey,
  };
}

async function expectRepairedRoute(input: {
  expectedRoute: HostedThreadDeliveryRouteV1;
  harness: ReturnType<typeof createRepairHarness>;
}): Promise<void> {
  const row = input.harness.readRow();
  await expect(openHostedThreadDeliveryRoute({
    channel: row.channel,
    containerMemberId: row.containerMemberId,
    encrypted: row.deliveryRouteEncrypted,
    prisma: input.harness.prisma as never,
  })).resolves.toEqual(input.expectedRoute);
  expect(row.pendingGroupReactionContextEncrypted).toBe(
    "same-authority-reaction-context",
  );

  await expect(resolveHostedAssistantNotificationDestination({
    memberId: row.containerMemberId,
    prisma: input.harness.prisma as never,
  })).resolves.toMatchObject({
    conversationShape: "thread-container",
    externalThreadRouteAuthority: {
      ...(input.expectedRoute.channel === "linq"
        ? { accountLookupKey: input.expectedRoute.accountLookupKey }
        : {}),
      channel: input.expectedRoute.channel,
      containerMemberId: row.containerMemberId,
      threadId: input.expectedRoute.threadId,
    },
    route: {
      actorId: null,
      channel: input.expectedRoute.channel,
      delivery: {
        kind: "thread",
        target: input.expectedRoute.threadId,
      },
      threadIsDirect: false,
    },
  });
}
