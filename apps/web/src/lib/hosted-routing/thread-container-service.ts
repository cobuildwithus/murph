import "server-only";

import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  buildHostedExecutionMemberActivatedWake,
  type HostedExecutionMemberChannels,
} from "@murphai/hosted-execution";
import { getHostedCryptoDomainForLane } from "@murphai/runtime-state";

import {
  prepareHostedCryptoDomainRootCandidates,
  prewarmPreparedHostedCryptoDomainRootForWeb,
  provisionPreparedHostedCryptoDomainRootsTx,
  type PreparedHostedCryptoDomainRootCandidates,
  unwrapHostedDomainRootForWeb,
} from "../hosted-crypto/domain-root-store";
import {
  appendHostedMailboxEnvelopeTx,
} from "../hosted-mailbox/store";
import {
  createHostedExternalThreadIdentityLookupKey,
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedExternalThreadLookupKey,
  createHostedExternalThreadLookupKeyReadCandidates,
  normalizeHostedOpaqueInput,
} from "../hosted-onboarding/contact-privacy";
import {
  readHostedRuntimeAiAccessDecision,
} from "../hosted-onboarding/member-access";
import {
  hostedOnboardingError,
} from "../hosted-onboarding/errors";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import {
  demoteHostedMemberLinqGroupChatBindingsTx,
} from "../hosted-onboarding/hosted-member-routing-store";
import {
  createHostedMember,
  readHostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import {
  generateHostedMemberId,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import {
  buildHostedThreadDeliveryRoute,
  HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
  isHostedThreadDeliveryRouteChannel,
  openHostedThreadDeliveryRoute,
  projectHostedThreadDeliveryRouteAccountLookupKey,
  sealHostedThreadDeliveryRoute,
  serializeHostedThreadDeliveryRouteV1,
  type HostedThreadDeliveryRouteChannel,
  type HostedThreadDeliveryRouteV1,
} from "./thread-delivery-route";
import type {
  HostedThreadRouteSnapshot,
} from "./thread-route-store";

export const HOSTED_THREAD_CONTAINER_DEFAULT_MONTHLY_USAGE_LIMIT_USD_MICROS =
  7_500_000n;

export interface HostedThreadContainerRouteEnsureResult {
  activationEventId: string | null;
  activationMailboxItemId: string | null;
  containerMemberId: string;
  created: boolean;
  demotedMailboxConsumedAt: Date | null;
}

export interface HostedThreadContainerDeliveryRouteRefreshResult {
  deliveryRoute: HostedThreadDeliveryRouteV1 | null;
  demotedMailboxConsumedAt: Date | null;
}

export interface PreparedHostedThreadContainerDeliveryRoute {
  containerMemberId: string;
  deliveryRoute: HostedThreadDeliveryRouteV1;
  deliveryRouteEncrypted: string;
}

export interface PreparedHostedThreadContainerCreation
  extends PreparedHostedThreadContainerDeliveryRoute {
  cryptoDomainRoots: PreparedHostedCryptoDomainRootCandidates;
}

/**
 * Builds every variable crypto input for a possible synthetic container before
 * its transaction opens. Preparation is speculative and never grants route or
 * owner authority; the transaction repeats those checks and the unique
 * external-thread identity decides a creation race.
 */
export async function prepareHostedThreadContainerCreation(input: {
  accountLookupKey: string | null | undefined;
  channel: HostedThreadDeliveryRouteChannel;
  containerMemberId?: string | null;
  prisma: PrismaClient;
  threadId: string | number;
}): Promise<PreparedHostedThreadContainerCreation> {
  const containerMemberId =
    normalizeHostedThreadContainerMemberId(input.containerMemberId)
    ?? generateHostedMemberId();
  const cryptoDomainRoots = await prepareHostedCryptoDomainRootCandidates({
    prisma: input.prisma,
    userId: containerMemberId,
  });
  const preparedDeliveryRoute =
    await prepareHostedThreadContainerDeliveryRoute({
      accountLookupKey: input.accountLookupKey,
      channel: input.channel,
      containerMemberId,
      preparedCryptoDomainRoots: cryptoDomainRoots,
      prisma: input.prisma,
      threadId: input.threadId,
    });
  await prewarmPreparedHostedCryptoDomainRootForWeb({
    domain: getHostedCryptoDomainForLane("mailbox-payload"),
    prepared: cryptoDomainRoots,
    userId: containerMemberId,
  });
  return {
    ...preparedDeliveryRoute,
    cryptoDomainRoots,
  };
}

/**
 * Seals replacement route material before `BEGIN`. For an existing container,
 * the retained prewarm also makes any in-transaction validation local AES
 * work. A new container supplies its not-yet-inserted prepared roots instead.
 */
export async function prepareHostedThreadContainerDeliveryRoute(input: {
  accountLookupKey: string | null | undefined;
  channel: HostedThreadDeliveryRouteChannel;
  containerMemberId: string;
  preparedCryptoDomainRoots?: PreparedHostedCryptoDomainRootCandidates;
  prisma: PrismaClient;
  threadId: string | number;
}): Promise<PreparedHostedThreadContainerDeliveryRoute> {
  const containerMemberId = normalizeHostedThreadContainerMemberId(
    input.containerMemberId,
  );
  if (!containerMemberId) {
    throw new TypeError("Hosted thread delivery-route preparation requires a container member id.");
  }
  const controlDomain = getHostedCryptoDomainForLane(
    "hosted-member-private-field",
  );
  if (input.preparedCryptoDomainRoots) {
    await prewarmPreparedHostedCryptoDomainRootForWeb({
      domain: controlDomain,
      prepared: input.preparedCryptoDomainRoots,
      userId: containerMemberId,
    });
  } else {
    const root = await unwrapHostedDomainRootForWeb({
      domain: controlDomain,
      prisma: input.prisma,
      retainFailureInScopedCache: true,
      userId: containerMemberId,
    });
    root.rootKey.fill(0);
  }
  const deliveryRoute = buildHostedThreadDeliveryRoute(input);
  const deliveryRouteEncrypted = await sealHostedThreadDeliveryRoute({
    containerMemberId,
    prisma: input.prisma,
    route: deliveryRoute,
  });
  return {
    containerMemberId,
    deliveryRoute,
    deliveryRouteEncrypted,
  };
}

/**
 * Repairs delivery material only when the current provider account proves it
 * owns the existing account-scoped route. Owning ingress opens and validates
 * non-empty material before deciding that no write is needed. A different
 * delivering Linq line may still use the account-independent thread identity,
 * but it must never rewrite the route's canonical account identity. Valid
 * ciphertext also recovers that identity for cross-line session binding.
 */
export async function refreshHostedThreadContainerDeliveryRouteTx(input: {
  accountLookupKey: string | null | undefined;
  accountLookupKeys?: readonly (string | null | undefined)[];
  mailboxDedupeKey?: string | null;
  preparedDeliveryRoute: PreparedHostedThreadContainerDeliveryRoute;
  prisma: Prisma.TransactionClient;
  route: HostedThreadRouteSnapshot;
  threadId: string | number;
}): Promise<HostedThreadContainerDeliveryRouteRefreshResult> {
  const state = input.route.deliveryRouteState;
  if (!state || !isHostedThreadDeliveryRouteChannel(input.route.channel)) {
    throw new TypeError(
      "Hosted thread delivery route refresh requires a canonical route snapshot.",
    );
  }

  const threadId = normalizeHostedOpaqueInput(input.threadId);
  const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
    channel: input.route.channel,
    threadId,
  });
  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: input.route.channel,
      threadId,
    });
  if (!threadId || !threadIdentityLookupKey || threadIdentityLookupKeys.length === 0) {
    throw new TypeError(
      "Hosted thread delivery route refresh requires a non-empty thread identity.",
    );
  }
  const deliveryRoute = buildHostedThreadDeliveryRoute({
    accountLookupKey: input.accountLookupKey,
    channel: input.route.channel,
    threadId,
  });
  assertPreparedHostedThreadDeliveryRoute({
    containerMemberId: input.route.containerMemberId,
    deliveryRoute,
    prepared: input.preparedDeliveryRoute,
  });

  await acquireHostedThreadContainerRouteWriteLockTx({
    channel: input.route.channel,
    prisma: input.prisma,
    threadId,
  });
  const rows = await input.prisma.hostedThreadRoute.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      containerMemberId: true,
      deliveryRouteEncrypted: true,
      threadIdentityLookupKey: true,
      threadLookupKey: true,
    },
    where: {
      channel: input.route.channel,
      threadIdentityLookupKey: {
        in: threadIdentityLookupKeys,
      },
    },
  });
  if (rows.length !== 1) {
    throw hostedOnboardingError({
      code: rows.length === 0
        ? "HOSTED_THREAD_ROUTE_REQUIRED"
        : "HOSTED_THREAD_ROUTE_IDENTITY_LOOKUP_AMBIGUOUS",
      details: {
        channel: input.route.channel,
        matchCount: rows.length,
      },
      httpStatus: rows.length === 0 ? 409 : 500,
      message: rows.length === 0
        ? "The external thread route no longer exists."
        : "External thread identity lookup matched multiple route rows.",
      retryable: true,
    });
  }

  const row = rows[0]!;
  if (row.containerMemberId !== input.route.containerMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
      httpStatus: 409,
      message: "This external thread is already routed to another container.",
      retryable: false,
    });
  }

  const demotion = input.route.channel === "linq"
    ? await demoteHostedMemberLinqGroupChatBindingsTx({
        linqChatId: threadId,
        ...(input.mailboxDedupeKey
          ? { mailboxDedupeKey: input.mailboxDedupeKey }
          : {}),
        prisma: input.prisma,
      })
    : { mailboxConsumedAt: null };

  const accountLookupKeys = normalizeHostedThreadAccountLookupKeys([
    ...(input.accountLookupKeys ?? []),
    input.accountLookupKey,
  ]);
  const currentAccountOwnsStoredRoute = accountLookupKeys.some((accountLookupKey) =>
    createHostedExternalThreadLookupKeyReadCandidates({
      accountLookupKey,
      channel: input.route.channel,
      threadId,
    }).includes(row.threadLookupKey)
  );

  if (!currentAccountOwnsStoredRoute) {
    const deliveryRoute = await tryOpenHostedThreadContainerDeliveryRoute({
      channel: input.route.channel,
      containerMemberId: input.route.containerMemberId,
      deliveryRouteEncrypted: row.deliveryRouteEncrypted,
      prisma: input.prisma,
      threadId,
      threadIdentityLookupKey: row.threadIdentityLookupKey,
      threadLookupKey: row.threadLookupKey,
    });
    return {
      deliveryRoute,
      demotedMailboxConsumedAt: demotion.mailboxConsumedAt,
    };
  }

  const threadLookupKey = createHostedExternalThreadLookupKey({
    accountLookupKey: input.accountLookupKey,
    channel: input.route.channel,
    threadId,
  });
  if (!threadLookupKey) {
    throw new TypeError(
      "Hosted thread delivery route refresh requires an account lookup key.",
    );
  }

  const authorityChanged =
    row.threadIdentityLookupKey !== threadIdentityLookupKey
    || row.threadLookupKey !== threadLookupKey;
  const existingDeliveryRoute = authorityChanged
    ? null
    : await tryOpenHostedThreadContainerDeliveryRoute({
        channel: input.route.channel,
        containerMemberId: input.route.containerMemberId,
        deliveryRouteEncrypted: row.deliveryRouteEncrypted,
        prisma: input.prisma,
        threadId,
        threadIdentityLookupKey: row.threadIdentityLookupKey,
        threadLookupKey: row.threadLookupKey,
      });
  if (authorityChanged || !existingDeliveryRoute) {
    await updateHostedThreadRouteRowTx({
      accountLookupKey:
        projectHostedThreadDeliveryRouteAccountLookupKey(deliveryRoute),
      authorityChanged,
      channel: input.route.channel,
      deliveryRouteEncrypted:
        input.preparedDeliveryRoute.deliveryRouteEncrypted,
      previousThreadIdentityLookupKey: row.threadIdentityLookupKey,
      prisma: input.prisma,
      threadIdentityLookupKey,
      threadLookupKey,
    });
  }

  return {
    deliveryRoute,
    demotedMailboxConsumedAt: demotion.mailboxConsumedAt,
  };
}

export async function ensureHostedThreadContainerRouteTx(input: {
  accountLookupKey: string | null | undefined;
  accountLookupKeys?: readonly (string | null | undefined)[];
  channel: HostedThreadDeliveryRouteChannel;
  containerMemberId?: string | null;
  initialGroupRoomModelMarkdown?: string | null;
  mailboxDedupeKey?: string | null;
  monthlyUsageLimitUsdMicros?: bigint | null;
  occurredAt: Date;
  ownerMemberId: string;
  preparedCreation?: PreparedHostedThreadContainerCreation;
  preparedDeliveryRoute?: PreparedHostedThreadContainerDeliveryRoute;
  prisma: Prisma.TransactionClient;
  threadId: string | number;
}): Promise<HostedThreadContainerRouteEnsureResult> {
  await lockHostedMemberRow(input.prisma, input.ownerMemberId);
  const owner = await readHostedMemberCoreState({
    memberId: input.ownerMemberId,
    prisma: input.prisma,
  });

  if (!owner) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_CONTAINER_OWNER_ACTIVE_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "An active hosted member is required to own a thread container.",
      retryable: false,
    });
  }
  assertHostedMemberNotSuspended(owner);
  if (!(await readHostedRuntimeAiAccessDecision({
    memberId: input.ownerMemberId,
    prisma: input.prisma,
  })).allowed) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_CONTAINER_OWNER_ACTIVE_ACCESS_REQUIRED",
      httpStatus: 403,
      message: "An active hosted member is required to own a thread container.",
      retryable: false,
    });
  }
  const ownerThreadContainer = await input.prisma.hostedThreadContainer.findUnique({
    select: {
      memberId: true,
    },
    where: {
      memberId: input.ownerMemberId,
    },
  });

  if (ownerThreadContainer) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_CONTAINER_OWNER_MUST_NOT_BE_CONTAINER",
      httpStatus: 403,
      message: "Thread-container members cannot own thread containers.",
      retryable: false,
    });
  }

  const threadLookupKey = createHostedExternalThreadLookupKey({
    accountLookupKey: input.accountLookupKey,
    channel: input.channel,
    threadId: input.threadId,
  });
  if (!threadLookupKey) {
    throw new TypeError(
      "Hosted thread route requires an account lookup key, supported channel, and non-empty thread id.",
    );
  }
  const threadIdentityLookupKey = createHostedExternalThreadIdentityLookupKey({
    channel: input.channel,
    threadId: input.threadId,
  });
  if (!threadIdentityLookupKey) {
    throw new TypeError(
      "Hosted thread route requires a supported channel and non-empty thread id.",
    );
  }
  const deliveryRoute = buildHostedThreadDeliveryRoute({
    accountLookupKey: input.accountLookupKey,
    channel: input.channel,
    threadId: input.threadId,
  });

  const explicitContainerMemberId =
    normalizeHostedThreadContainerMemberId(input.containerMemberId);
  if (
    explicitContainerMemberId
    && input.preparedCreation
    && explicitContainerMemberId !== input.preparedCreation.containerMemberId
  ) {
    throw new TypeError(
      "Hosted thread container id does not match its prepared creation.",
    );
  }
  // A prepared creation is speculative until the unique external-thread
  // identity is inserted. If another creator wins between preparation and
  // BEGIN, its container is authoritative; only an explicitly requested
  // container id may reject that existing binding.
  const requestedContainerMemberId = explicitContainerMemberId;
  const accountLookupKeys = normalizeHostedThreadAccountLookupKeys([
    ...(input.accountLookupKeys ?? []),
    input.accountLookupKey,
  ]);
  const threadLookupKeys = normalizeHostedThreadLookupKeys([
    threadLookupKey,
    ...accountLookupKeys.flatMap((accountLookupKey) =>
      createHostedExternalThreadLookupKeyReadCandidates({
        accountLookupKey,
        channel: input.channel,
        threadId: input.threadId,
      })
    ),
  ]);
  const threadIdentityLookupKeys = normalizeHostedThreadLookupKeys([
    threadIdentityLookupKey,
    ...createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: input.channel,
      threadId: input.threadId,
    }),
  ]);
  const readExistingRows = () =>
    input.prisma.hostedThreadRoute.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        container: {
          select: {
            ownerMemberId: true,
          },
        },
        containerMemberId: true,
        deliveryRouteEncrypted: true,
        threadIdentityLookupKey: true,
        threadLookupKey: true,
      },
      where: {
        channel: input.channel,
        threadIdentityLookupKey: {
          in: threadIdentityLookupKeys,
        },
      },
    });
  let existingRows = await readExistingRows();

  if (existingRows.length > 0) {
    // Existing-row refresh still serializes route rekeys and repair. The
    // absent-row creation path deliberately skips this advisory lock and lets
    // the unique external-thread identity choose the winner.
    await acquireHostedThreadContainerRouteWriteLockTx({
      channel: input.channel,
      prisma: input.prisma,
      threadId: input.threadId,
    });
    existingRows = await readExistingRows();
    if (existingRows.length === 0) {
      throw hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_WRITE_CONFLICT",
        httpStatus: 409,
        message: "This external thread route changed concurrently.",
        retryable: true,
      });
    }
    const distinctContainerIds = new Set(existingRows.map((row) => row.containerMemberId));
    const authorityMatched = existingRows.some((row) =>
      threadLookupKeys.includes(row.threadLookupKey)
    );
    const existing = existingRows[0]!;
    if (
      distinctContainerIds.size > 1
      ||
      !authorityMatched
      ||
      existing.container.ownerMemberId !== input.ownerMemberId
      || (
        requestedContainerMemberId !== null
        && existing.containerMemberId !== requestedContainerMemberId
      )
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_ALREADY_BOUND",
        httpStatus: 409,
        message: "This external thread is already routed to another container.",
        retryable: false,
      });
    }

    const demotion = input.channel === "linq"
      ? await demoteHostedMemberLinqGroupChatBindingsTx({
          linqChatId: String(input.threadId),
          ...(input.mailboxDedupeKey
            ? { mailboxDedupeKey: input.mailboxDedupeKey }
            : {}),
          prisma: input.prisma,
        })
      : { mailboxConsumedAt: null };

    // Linq operations that need both locks take chat ownership during demotion
    // before updating the route row. Consume and usage dispatch use this order.
    const currentIdentityRow = existingRows.find((row) =>
      row.threadIdentityLookupKey === threadIdentityLookupKey
    ) ?? existing;
    const authorityChanged =
      currentIdentityRow.threadIdentityLookupKey !== threadIdentityLookupKey
      || currentIdentityRow.threadLookupKey !== threadLookupKey;
    if (authorityChanged || !currentIdentityRow.deliveryRouteEncrypted) {
      if (!input.preparedDeliveryRoute) {
        throw hostedOnboardingError({
          code: "HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED",
          httpStatus: 503,
          message: "Hosted thread delivery-route preparation is required.",
          retryable: true,
        });
      }
      assertPreparedHostedThreadDeliveryRoute({
        containerMemberId: existing.containerMemberId,
        deliveryRoute,
        prepared: input.preparedDeliveryRoute,
      });
      await updateHostedThreadRouteRowTx({
        accountLookupKey:
          projectHostedThreadDeliveryRouteAccountLookupKey(deliveryRoute),
        authorityChanged,
        channel: input.channel,
        deliveryRouteEncrypted:
          input.preparedDeliveryRoute.deliveryRouteEncrypted,
        prisma: input.prisma,
        previousThreadIdentityLookupKey: currentIdentityRow.threadIdentityLookupKey,
        threadIdentityLookupKey,
        threadLookupKey,
      });
    }

    return {
      activationEventId: null,
      activationMailboxItemId: null,
      containerMemberId: existing.containerMemberId,
      created: false,
      demotedMailboxConsumedAt: demotion.mailboxConsumedAt,
    };
  }

  // The route owner is the durable group boundary. For a new Linq route, the
  // chat lock and unresolved provider-start fence serialize the ownership
  // transition against the old personal runtime's exact provider boundary.
  const demotion = input.channel === "linq"
    ? await demoteHostedMemberLinqGroupChatBindingsTx({
        enforceProviderDispatchFence: true,
        linqChatId: String(input.threadId),
        ...(input.mailboxDedupeKey
          ? { mailboxDedupeKey: input.mailboxDedupeKey }
          : {}),
        prisma: input.prisma,
      })
    : { mailboxConsumedAt: null };

  const preparedCreation = input.preparedCreation;
  if (!preparedCreation) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
      httpStatus: 503,
      message: "Hosted thread-container preparation is required.",
      retryable: true,
    });
  }
  assertPreparedHostedThreadDeliveryRoute({
    containerMemberId: preparedCreation.containerMemberId,
    deliveryRoute,
    prepared: preparedCreation,
  });
  const containerMemberId = preparedCreation.containerMemberId;
  const monthlyUsageLimitUsdMicros = normalizeHostedThreadContainerUsageLimit(
    input.monthlyUsageLimitUsdMicros,
  );

  // Thread-container members are synthetic: they have no Stripe relationship
  // of their own, so their billing status stays truthful (`not_started`) and
  // access is always derived from the owner through `member-access.ts`.
  await createHostedMember({
    billingStatus: HostedBillingStatus.not_started,
    memberId: containerMemberId,
    prisma: input.prisma,
  });

  await provisionPreparedHostedCryptoDomainRootsTx({
    prepared: preparedCreation.cryptoDomainRoots,
    reason: "hosted-thread-container.ensure-route",
    tx: input.prisma,
    userId: containerMemberId,
  });

  await input.prisma.hostedThreadContainer.create({
    data: {
      memberId: containerMemberId,
      monthlyUsageLimitUsdMicros,
      ownerMemberId: input.ownerMemberId,
    },
  });

  await createHostedThreadRouteRowTx({
    accountLookupKey:
      projectHostedThreadDeliveryRouteAccountLookupKey(deliveryRoute),
    channel: input.channel,
    containerMemberId,
    deliveryRouteEncrypted: preparedCreation.deliveryRouteEncrypted,
    prisma: input.prisma,
    threadIdentityLookupKey,
    threadLookupKey,
  });

  const activationWake = buildHostedExecutionMemberActivatedWake({
    eventId: buildHostedThreadContainerActivationEventId({
      channel: input.channel,
      threadLookupKey,
    }),
    memberChannels: resolveHostedThreadContainerMemberChannels(input.channel),
    memberId: containerMemberId,
    occurredAt: input.occurredAt.toISOString(),
    ...(input.initialGroupRoomModelMarkdown
      ? { initialGroupRoomModelMarkdown: input.initialGroupRoomModelMarkdown }
      : {}),
    signupWelcome: null,
  });
  const appended = await appendHostedMailboxEnvelopeTx({
    envelope: activationWake,
    tx: input.prisma,
  });

  return {
    activationEventId: appended.item.dedupeKey,
    activationMailboxItemId: appended.item.id,
    containerMemberId,
    created: true,
    demotedMailboxConsumedAt: demotion.mailboxConsumedAt,
  };
}

async function tryOpenHostedThreadContainerDeliveryRoute(input: {
  channel: HostedThreadDeliveryRouteChannel;
  containerMemberId: string;
  deliveryRouteEncrypted: string | null;
  prisma: Prisma.TransactionClient;
  threadId: string;
  threadIdentityLookupKey: string;
  threadLookupKey: string;
}): Promise<HostedThreadDeliveryRouteV1 | null> {
  if (!input.deliveryRouteEncrypted) {
    return null;
  }

  let deliveryRoute: HostedThreadDeliveryRouteV1;
  try {
    deliveryRoute = await openHostedThreadDeliveryRoute({
      channel: input.channel,
      containerMemberId: input.containerMemberId,
      encrypted: input.deliveryRouteEncrypted,
      prisma: input.prisma,
    });
  } catch {
    // Corrupt detached-delivery material must not take ordinary inbound reply
    // routing down. The detached resolver still fails closed until a trusted
    // inbound on the owning account repairs this row.
    return null;
  }

  const accountLookupKey = deliveryRoute.channel === "linq"
    ? deliveryRoute.accountLookupKey
    : HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY;
  const matchesStoredAuthority =
    deliveryRoute.threadId === input.threadId
    && createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: deliveryRoute.channel,
      threadId: deliveryRoute.threadId,
    }).includes(input.threadIdentityLookupKey)
    && createHostedExternalThreadLookupKeyReadCandidates({
      accountLookupKey,
      channel: deliveryRoute.channel,
      threadId: deliveryRoute.threadId,
    }).includes(input.threadLookupKey);

  return matchesStoredAuthority ? deliveryRoute : null;
}

async function createHostedThreadRouteRowTx(input: {
  accountLookupKey: string;
  channel: HostedThreadDeliveryRouteChannel;
  containerMemberId: string;
  deliveryRouteEncrypted: string;
  prisma: Prisma.TransactionClient;
  threadIdentityLookupKey: string;
  threadLookupKey: string;
}): Promise<void> {
  try {
    await input.prisma.hostedThreadRoute.create({
      data: {
        accountLookupKey: input.accountLookupKey,
        channel: input.channel,
        containerMemberId: input.containerMemberId,
        deliveryRouteEncrypted: input.deliveryRouteEncrypted,
        threadIdentityLookupKey: input.threadIdentityLookupKey,
        threadLookupKey: input.threadLookupKey,
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_WRITE_CONFLICT",
        httpStatus: 409,
        message: "This external thread route was created concurrently.",
        retryable: true,
      });
    }

    throw error;
  }
}

async function updateHostedThreadRouteRowTx(input: {
  accountLookupKey: string;
  authorityChanged: boolean;
  channel: HostedThreadDeliveryRouteChannel;
  deliveryRouteEncrypted: string;
  previousThreadIdentityLookupKey: string;
  prisma: Prisma.TransactionClient;
  threadIdentityLookupKey: string;
  threadLookupKey: string;
}): Promise<void> {
  try {
    await input.prisma.hostedThreadRoute.update({
      data: {
        accountLookupKey: input.accountLookupKey,
        // Reaction context is optional and account-bound through the route's
        // lookup key. Drop it when that authority key rotates rather than
        // carrying ciphertext into a different AAD binding.
        ...(input.authorityChanged
          ? { pendingGroupReactionContextEncrypted: null }
          : {}),
        deliveryRouteEncrypted: input.deliveryRouteEncrypted,
        threadIdentityLookupKey: input.threadIdentityLookupKey,
        threadLookupKey: input.threadLookupKey,
      },
      where: {
        channel_threadIdentityLookupKey: {
          channel: input.channel,
          threadIdentityLookupKey: input.previousThreadIdentityLookupKey,
        },
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw hostedOnboardingError({
        code: "HOSTED_THREAD_ROUTE_WRITE_CONFLICT",
        httpStatus: 409,
        message: "This external thread route was updated concurrently.",
        retryable: true,
      });
    }

    throw error;
  }
}

async function acquireHostedThreadContainerRouteWriteLockTx(input: {
  channel: HostedThreadDeliveryRouteChannel;
  prisma: Prisma.TransactionClient;
  threadId: string | number;
}): Promise<void> {
  const threadId = normalizeHostedOpaqueInput(input.threadId);
  if (!threadId) {
    throw new TypeError("Hosted thread route lock requires a non-empty thread id.");
  }

  await input.prisma.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${"hosted-thread-container-route"}),
      hashtext(${`${input.channel}:${threadId}`})
    )
  `;
}

function resolveHostedThreadContainerMemberChannels(
  channel: HostedThreadDeliveryRouteChannel,
): HostedExecutionMemberChannels {
  return {
    email: false,
    linq: channel === "linq",
    telegram: channel === "telegram",
  };
}

function assertPreparedHostedThreadDeliveryRoute(input: {
  containerMemberId: string;
  deliveryRoute: HostedThreadDeliveryRouteV1;
  prepared: PreparedHostedThreadContainerDeliveryRoute;
}): void {
  if (
    input.prepared.containerMemberId !== input.containerMemberId
    || serializeHostedThreadDeliveryRouteV1(input.prepared.deliveryRoute)
      !== serializeHostedThreadDeliveryRouteV1(input.deliveryRoute)
    || input.prepared.deliveryRouteEncrypted.trim().length === 0
  ) {
    throw new TypeError(
      "Prepared hosted thread delivery route does not match its write target.",
    );
  }
}

function buildHostedThreadContainerActivationEventId(input: {
  channel: HostedThreadDeliveryRouteChannel;
  threadLookupKey: string;
}): string {
  return `member.activated:thread-container:${input.channel}:${input.threadLookupKey}`;
}

function normalizeHostedThreadContainerMemberId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeHostedThreadContainerUsageLimit(value: bigint | null | undefined): bigint {
  const limit = value ?? HOSTED_THREAD_CONTAINER_DEFAULT_MONTHLY_USAGE_LIMIT_USD_MICROS;
  if (limit <= 0n) {
    throw new TypeError("Hosted thread container monthly usage limit must be positive.");
  }
  return limit;
}

function normalizeHostedThreadAccountLookupKeys(
  values: readonly (string | null | undefined)[],
): string[] {
  const normalized = values
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0);

  return [...new Set(normalized)];
}

function normalizeHostedThreadLookupKeys(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
