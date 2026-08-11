import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadLookupKey,
} from "../src/lib/hosted-onboarding/contact-privacy";
import {
  resolveHostedAssistantNotificationDestination,
} from "../src/lib/hosted-routing/assistant-notification-destination";
import {
  prepareHostedThreadContainerDeliveryRoute,
  refreshHostedThreadContainerDeliveryRouteTx,
} from "../src/lib/hosted-routing/thread-container-service";
import {
  buildHostedThreadDeliveryRoute,
  HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
  openHostedThreadDeliveryRoute,
  projectHostedThreadDeliveryRouteAccountLookupKey,
  sealHostedThreadDeliveryRoute,
  type HostedThreadDeliveryRouteChannel,
  type HostedThreadDeliveryRouteV1,
} from "../src/lib/hosted-routing/thread-delivery-route";
import {
  setHostedSecureBoxStringTestCodecForTests,
} from "../src/lib/hosted-crypto/secure-box";

const repairMocks = vi.hoisted(() => ({
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  demoteHostedMemberLinqGroupChatBindingsTx: vi.fn(),
}));
const rootMocks = vi.hoisted(() => ({
  unwrapActive: vi.fn(),
  unwrapByRootKeyId: vi.fn(),
}));

vi.mock("../src/lib/hosted-crypto/domain-root-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/lib/hosted-crypto/domain-root-store")
  >();
  return {
    ...actual,
    unwrapHostedDomainRootForWeb: rootMocks.unwrapActive,
    unwrapHostedDomainRootForWebByRootKeyId: rootMocks.unwrapByRootKeyId,
  };
});

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
    rootMocks.unwrapActive.mockReset();
    rootMocks.unwrapByRootKeyId.mockReset();
  });

  it.each(CORRUPT_ROUTE_FIXTURES)(
    "repairs non-empty corrupt $channel owner material and restores detached delivery",
    async (fixture) => {
      const expectedRoute = buildHostedThreadDeliveryRoute(fixture);
      const harness = createRepairHarness({
        accountLookupKey: null,
        channel: fixture.channel,
        containerMemberId: fixture.containerMemberId,
        deliveryRouteEncrypted: "corrupt-delivery-route",
        pendingGroupReactionContextEncrypted:
          "same-authority-reaction-context",
        ...requireRouteLookupKeys(fixture),
      });
      const preparedDeliveryRoute = await prepareDeliveryRoute({
        containerMemberId: fixture.containerMemberId,
        observedDeliveryRouteEncrypted: harness.readRow().deliveryRouteEncrypted,
        prisma: harness.prisma,
        route: expectedRoute,
      });

      await expect(refreshHostedThreadContainerDeliveryRouteTx({
        accountLookupKey: fixture.accountLookupKey,
        ...(fixture.channel === "linq"
          ? { accountLookupKeys: [fixture.accountLookupKey] }
          : {}),
        preparedDeliveryRoute,
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
      accountLookupKey: null,
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
    const preparedDeliveryRoute = await prepareDeliveryRoute({
      containerMemberId: "linq-container",
      observedDeliveryRouteEncrypted: harness.readRow().deliveryRouteEncrypted,
      prisma: harness.prisma,
      route: expectedRoute,
    });

    await expect(refreshHostedThreadContainerDeliveryRouteTx({
      accountLookupKey: expectedRoute.accountLookupKey,
      accountLookupKeys: [expectedRoute.accountLookupKey],
      preparedDeliveryRoute,
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

  it.each(CORRUPT_ROUTE_FIXTURES)(
    "prewarms a decrypt-only $channel route root before the route lock",
    async (fixture) => {
      const rootKeys = new Map([
        ["root-control-c1", new Uint8Array(32).fill(1)],
        ["root-control-c2", new Uint8Array(32).fill(2)],
      ]);
      const warmedRootKeyIds = new Set<string>();
      const kmsMisses: Array<{ rootKeyId: string; transactionOpen: boolean }> = [];
      let activeRootKeyId = "root-control-c1";
      let transactionOpen = false;
      const unwrap = (rootKeyId: string) => {
        const rootKey = rootKeys.get(rootKeyId);
        if (!rootKey) {
          throw new Error("Expected a configured test control root.");
        }
        if (!warmedRootKeyIds.has(rootKeyId)) {
          warmedRootKeyIds.add(rootKeyId);
          kmsMisses.push({ rootKeyId, transactionOpen });
        }
        return {
          envelope: { rootKeyId },
          rootKey: rootKey.slice(),
        };
      };
      rootMocks.unwrapActive.mockImplementation(async () =>
        unwrap(activeRootKeyId)
      );
      rootMocks.unwrapByRootKeyId.mockImplementation(async ({ rootKeyId }) =>
        unwrap(rootKeyId)
      );
      setHostedSecureBoxStringTestCodecForTests(null);
      try {
        const route = buildHostedThreadDeliveryRoute(fixture);
        const storedCiphertext = await sealHostedThreadDeliveryRoute({
          containerMemberId: fixture.containerMemberId,
          route,
        });
        activeRootKeyId = "root-control-c2";
        warmedRootKeyIds.clear();
        kmsMisses.length = 0;

        const harness = createRepairHarness({
          accountLookupKey: fixture.accountLookupKey,
          channel: fixture.channel,
          containerMemberId: fixture.containerMemberId,
          deliveryRouteEncrypted: storedCiphertext,
          pendingGroupReactionContextEncrypted: null,
          ...requireRouteLookupKeys(fixture),
        });
        harness.prisma.$executeRaw.mockImplementation(async () => {
          transactionOpen = true;
          return 0;
        });
        const preparedDeliveryRoute =
          await prepareHostedThreadContainerDeliveryRoute({
            accountLookupKey: fixture.accountLookupKey,
            channel: fixture.channel,
            containerMemberId: fixture.containerMemberId,
            observedDeliveryRouteEncrypted: storedCiphertext,
            prisma: harness.prisma as never,
            threadId: fixture.threadId,
          });
        await expect(refreshHostedThreadContainerDeliveryRouteTx({
          accountLookupKey: fixture.accountLookupKey,
          ...(fixture.channel === "linq"
            ? { accountLookupKeys: [fixture.accountLookupKey] }
            : {}),
          preparedDeliveryRoute,
          prisma: harness.prisma as never,
          route: buildRouteSnapshot(harness.readRow()) as never,
          threadId: fixture.threadId,
        })).resolves.toMatchObject({ deliveryRoute: route });

        expect(kmsMisses).toEqual([
          { rootKeyId: "root-control-c2", transactionOpen: false },
          { rootKeyId: "root-control-c1", transactionOpen: false },
        ]);
        expect(rootMocks.unwrapByRootKeyId).toHaveBeenCalledWith(
          expect.objectContaining({ rootKeyId: "root-control-c1" }),
        );
      } finally {
        restoreHostedSecureBoxTestCodec();
      }
    },
  );

  it("does not request a second root prewarm when stored material uses the active root", async () => {
    const fixture = CORRUPT_ROUTE_FIXTURES[0];
    const rootKeyMaterial = new Uint8Array(32).fill(3);
    rootMocks.unwrapActive.mockImplementation(async () => ({
      envelope: { rootKeyId: "root-control-active" },
      rootKey: rootKeyMaterial.slice(),
    }));
    rootMocks.unwrapByRootKeyId.mockImplementation(async () => ({
      envelope: { rootKeyId: "root-control-active" },
      rootKey: rootKeyMaterial.slice(),
    }));
    setHostedSecureBoxStringTestCodecForTests(null);
    try {
      const storedCiphertext = await sealHostedThreadDeliveryRoute({
        containerMemberId: fixture.containerMemberId,
        route: buildHostedThreadDeliveryRoute(fixture),
      });
      vi.clearAllMocks();
      rootMocks.unwrapActive.mockImplementation(async () => ({
        envelope: { rootKeyId: "root-control-active" },
        rootKey: rootKeyMaterial.slice(),
      }));

      await expect(prepareHostedThreadContainerDeliveryRoute({
        accountLookupKey: fixture.accountLookupKey,
        channel: fixture.channel,
        containerMemberId: fixture.containerMemberId,
        observedDeliveryRouteEncrypted: storedCiphertext,
        prisma: createRepairHarness({
          accountLookupKey: fixture.accountLookupKey,
          channel: fixture.channel,
          containerMemberId: fixture.containerMemberId,
          deliveryRouteEncrypted: storedCiphertext,
          pendingGroupReactionContextEncrypted: null,
          ...requireRouteLookupKeys(fixture),
        }).prisma as never,
        threadId: fixture.threadId,
      })).resolves.toMatchObject({ observedDeliveryRouteEncrypted: storedCiphertext });

      // This focused unit has no request-scoped root cache, so sealing calls
      // the active-root helper again. The important branch proof is that
      // preparation does not separately request that same id as historical.
      expect(rootMocks.unwrapActive).toHaveBeenCalledTimes(2);
      expect(rootMocks.unwrapByRootKeyId).not.toHaveBeenCalled();
    } finally {
      restoreHostedSecureBoxTestCodec();
    }
  });

  it("requests fresh preparation before demotion when ciphertext changes under the lock", async () => {
    const fixture = CORRUPT_ROUTE_FIXTURES[0];
    const observedCiphertext = "observed-route-ciphertext";
    const harness = createRepairHarness({
      accountLookupKey: fixture.accountLookupKey,
      channel: fixture.channel,
      containerMemberId: fixture.containerMemberId,
      deliveryRouteEncrypted: observedCiphertext,
      pendingGroupReactionContextEncrypted: "pending-reaction",
      ...requireRouteLookupKeys(fixture),
    });
    harness.prisma.$executeRaw.mockImplementation(async () => {
      harness.setDeliveryRouteEncrypted("winning-route-ciphertext");
      return 0;
    });
    const preparedDeliveryRoute = await prepareDeliveryRoute({
      containerMemberId: fixture.containerMemberId,
      observedDeliveryRouteEncrypted: observedCiphertext,
      prisma: harness.prisma,
      route: buildHostedThreadDeliveryRoute(fixture),
    });

    await expect(refreshHostedThreadContainerDeliveryRouteTx({
      accountLookupKey: fixture.accountLookupKey,
      accountLookupKeys: [fixture.accountLookupKey],
      preparedDeliveryRoute,
      prisma: harness.prisma as never,
      route: buildRouteSnapshot({
        ...harness.readRow(),
        deliveryRouteEncrypted: observedCiphertext,
      }) as never,
      threadId: fixture.threadId,
    })).rejects.toMatchObject({
      code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
      retryable: true,
    });

    expect(
      repairMocks.demoteHostedMemberLinqGroupChatBindingsTx,
    ).not.toHaveBeenCalled();
    expect(harness.update).not.toHaveBeenCalled();
  });
});

async function prepareDeliveryRoute(input: {
  containerMemberId: string;
  observedDeliveryRouteEncrypted: string | null;
  prisma: ReturnType<typeof createRepairHarness>["prisma"];
  route: HostedThreadDeliveryRouteV1;
}) {
  return {
    containerMemberId: input.containerMemberId,
    deliveryRoute: input.route,
    deliveryRouteEncrypted: await sealHostedThreadDeliveryRoute({
      containerMemberId: input.containerMemberId,
      prisma: input.prisma as never,
      route: input.route,
    }),
    observedDeliveryRouteEncrypted: input.observedDeliveryRouteEncrypted,
  };
}

interface MutableHostedThreadRouteRow {
  accountLookupKey: string | null;
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
      accountLookupKey: string;
      deliveryRouteEncrypted: string;
      pendingGroupReactionContextEncrypted?: string | null;
      threadIdentityLookupKey: string;
      threadLookupKey: string;
    };
  }) => {
    row.accountLookupKey = data.accountLookupKey;
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
    setDeliveryRouteEncrypted(value: string | null) {
      row.deliveryRouteEncrypted = value;
    },
    update,
  };
}

function buildRouteSnapshot(row: MutableHostedThreadRouteRow) {
  return {
    channel: row.channel,
    containerMemberId: row.containerMemberId,
    deliveryRouteState: {
      deliveryRouteEncrypted: row.deliveryRouteEncrypted,
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
  expect(row.accountLookupKey).toBe(
    projectHostedThreadDeliveryRouteAccountLookupKey(input.expectedRoute),
  );
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

function restoreHostedSecureBoxTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const decoded = JSON.parse(
        Buffer.from(
          input.value.replace(/^hsb-test:/u, ""),
          "base64url",
        ).toString("utf8"),
      ) as {
        lane?: string;
        scope?: string;
        userId?: string;
        value?: string;
      };
      if (
        decoded.lane !== input.lane
        || decoded.scope !== input.scope
        || decoded.userId !== input.userId
        || typeof decoded.value !== "string"
      ) {
        throw new Error("Hosted secure-box test codec metadata mismatch.");
      }
      return decoded.value;
    },
    encrypt(input) {
      return `hsb-test:${Buffer.from(JSON.stringify({
        lane: input.lane,
        scope: input.scope,
        userId: input.userId,
        value: input.value,
      }), "utf8").toString("base64url")}`;
    },
  });
}
