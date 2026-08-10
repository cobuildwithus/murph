import "server-only";

import { Prisma } from "@prisma/client";

import type {
  HostedExecutionConversationMessageChannel,
  HostedExecutionExternalThreadRouteAuthority,
  HostedExecutionLinqExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import {
  HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_ITEM_MAX_CHARS,
  HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_ITEMS,
} from "@murphai/hosted-execution/contracts";

import {
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedExternalThreadLookupKeyReadCandidates,
  isHostedExternalThreadChannel,
} from "../hosted-onboarding/contact-privacy";
import {
  type HostedMemberPersonAccessState,
  hostedMemberPersonAccessSelect,
  readActiveHostedMemberAccess,
} from "../hosted-onboarding/member-access";
import {
  hostedOnboardingError,
} from "../hosted-onboarding/errors";
import type {
  HostedMemberCoreState,
} from "../hosted-onboarding/hosted-member-store";
import type {
  HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";
import {
  acquireHostedLinqChatOwnershipLockTx,
} from "./linq-chat-ownership-lock";
import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
} from "../hosted-crypto/secure-box";

const HOSTED_LINQ_GROUP_REACTION_CONTEXT_FIELD =
  "pending-group-reaction-context";
const HOSTED_LINQ_GROUP_REACTION_CRYPTO_TIMEOUT_MS = 500;

interface HostedLinqThreadRoutePendingContext {
  groupParticipantAdded: boolean;
  groupReactionContext: string | null;
}

export type HostedThreadRouteChannel = Extract<
  HostedExecutionConversationMessageChannel,
  "email" | "linq" | "telegram"
>;

export type HostedThreadRouteOwnerState = HostedMemberCoreState & HostedMemberPersonAccessState;

export interface HostedThreadRouteSnapshot {
  accountLookupKey?: string;
  channel: HostedThreadRouteChannel;
  container: HostedMemberCoreState;
  containerMemberId: string;
  /**
   * Present on snapshots read from the canonical route store. It remains
   * optional so narrow in-memory route projections used by non-routing callers
   * do not become a second source of truth.
   */
  deliveryRouteState?: {
    deliveryRouteEncrypted: string | null;
    deliveryRouteEncryptedPresent: boolean;
    threadIdentityLookupKey: string;
    threadLookupKey: string;
  };
  owner: HostedThreadRouteOwnerState;
}

export type HostedThreadRouteEgressAuthority = HostedExecutionExternalThreadRouteAuthority;
export type HostedLinqThreadRouteEgressAuthority =
  HostedExecutionLinqExternalThreadRouteAuthority;

export async function readHostedThreadRouteByThreadIdentity(input: {
  channel: HostedThreadRouteChannel;
  prisma: HostedOnboardingReadClient;
  threadId: string | number | null | undefined;
}): Promise<HostedThreadRouteSnapshot | null> {
  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: input.channel,
      threadId: input.threadId,
    });

  if (threadIdentityLookupKeys.length === 0) {
    return null;
  }

  const rows = await input.prisma.hostedThreadRoute.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      accountLookupKey: true,
      channel: true,
      container: {
        select: {
          member: {
            select: {
              billingStatus: true,
              createdAt: true,
              id: true,
              suspendedAt: true,
              updatedAt: true,
            },
          },
          owner: {
            select: {
              ...hostedMemberPersonAccessSelect,
              createdAt: true,
              id: true,
              updatedAt: true,
            },
          },
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

  if (rows.length === 0) {
    return null;
  }

  const distinctContainerIds = new Set(rows.map((row) => row.containerMemberId));
  if (distinctContainerIds.size > 1) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_IDENTITY_LOOKUP_AMBIGUOUS",
      details: {
        channel: input.channel,
        matchCount: rows.length,
      },
      httpStatus: 500,
      message: "External thread identity lookup matched multiple containers.",
      retryable: true,
    });
  }

  const row = rows[0]!;
  if (!isHostedExternalThreadChannel(row.channel)) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_CHANNEL_INVALID",
      httpStatus: 500,
      message: "External thread route has an unsupported channel.",
      retryable: false,
    });
  }

  const deliveryRouteState =
    typeof row.threadIdentityLookupKey === "string"
    && typeof row.threadLookupKey === "string"
    && (
      typeof row.deliveryRouteEncrypted === "string"
      || row.deliveryRouteEncrypted === null
    )
      ? {
          deliveryRouteEncrypted: row.deliveryRouteEncrypted,
          deliveryRouteEncryptedPresent:
            typeof row.deliveryRouteEncrypted === "string"
            && row.deliveryRouteEncrypted.length > 0,
          threadIdentityLookupKey: row.threadIdentityLookupKey,
          threadLookupKey: row.threadLookupKey,
        }
      : null;

  return {
    ...(row.accountLookupKey ? { accountLookupKey: row.accountLookupKey } : {}),
    channel: row.channel,
    container: row.container.member,
    containerMemberId: row.containerMemberId,
    ...(deliveryRouteState ? { deliveryRouteState } : {}),
    owner: row.container.owner,
  };
}

export function requiresHostedThreadDeliveryRouteRefresh(input: {
  accountLookupKey: string | null | undefined;
  route: HostedThreadRouteSnapshot;
  threadId: string | number | null | undefined;
}): boolean {
  // Ciphertext presence and matching blinded lookup keys cannot prove that the
  // encrypted material opens or still describes this route. Every canonical
  // snapshot must reach the owner-aware refresh boundary, which validates
  // before deciding to write.
  return input.route.deliveryRouteState !== undefined;
}

export async function lockHostedThreadRouteByThreadIdentityTx(input: {
  authority: HostedThreadRouteEgressAuthority;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: input.authority.channel,
      threadId: input.authority.threadId,
    });
  if (threadIdentityLookupKeys.length === 0) {
    return;
  }

  await input.prisma.$queryRaw`
    SELECT 1
    FROM "hosted_thread_route"
    WHERE "channel" = ${input.authority.channel}
      AND "thread_identity_lookup_key" IN (${Prisma.join(threadIdentityLookupKeys)})
    FOR UPDATE
  `;
}

export async function markHostedLinqThreadRouteParticipantAdditionPendingTx(input: {
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
  threadId: string;
}): Promise<void> {
  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: "linq",
      threadId: input.threadId,
    });
  if (threadIdentityLookupKeys.length === 0) {
    return;
  }

  await input.prisma.hostedThreadRoute.updateMany({
    data: {
      pendingParticipantAddition: true,
    },
    where: {
      channel: "linq",
      containerMemberId: input.containerMemberId,
      threadIdentityLookupKey: {
        in: threadIdentityLookupKeys,
      },
    },
  });
}

export async function consumeHostedLinqThreadRouteParticipantAdditionPendingTx(input: {
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
  threadId: string;
}): Promise<boolean> {
  // Linq operations that need both locks always take chat ownership before the
  // route row. Mailbox append and usage-limit dispatch use the same order.
  await acquireHostedLinqChatOwnershipLockTx({
    chatId: input.threadId,
    tx: input.prisma,
  });
  await lockHostedThreadRouteByThreadIdentityTx({
    authority: {
      channel: "linq",
      containerMemberId: input.containerMemberId,
      threadId: input.threadId,
    },
    prisma: input.prisma,
  });

  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: "linq",
      threadId: input.threadId,
    });
  if (threadIdentityLookupKeys.length === 0) {
    return false;
  }

  const result = await input.prisma.hostedThreadRoute.updateMany({
    data: {
      pendingParticipantAddition: false,
    },
    where: {
      channel: "linq",
      containerMemberId: input.containerMemberId,
      pendingParticipantAddition: true,
      threadIdentityLookupKey: {
        in: threadIdentityLookupKeys,
      },
    },
  });
  return result.count > 0;
}

export async function consumeHostedLinqThreadRoutePendingContextTx(input: {
  accountLookupKey: string;
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
  threadId: string;
}): Promise<HostedLinqThreadRoutePendingContext> {
  const route = await lockAndReadHostedLinqThreadRoutePendingContextRowTx(input);
  if (!route) {
    return emptyHostedLinqThreadRoutePendingContext();
  }
  const reactionAccountMatches = doesHostedLinqRouteMatchAccount({
    accountLookupKey: input.accountLookupKey,
    route,
    threadId: input.threadId,
  });
  const groupReactionContexts = reactionAccountMatches
    ? await openHostedLinqGroupReactionContextBestEffort({
        route,
        signal: AbortSignal.timeout(HOSTED_LINQ_GROUP_REACTION_CRYPTO_TIMEOUT_MS),
        tx: input.prisma,
      })
    : null;
  const groupReactionContext = groupReactionContexts?.join("\n") ?? null;
  const result = await input.prisma.hostedThreadRoute.updateMany({
    data: {
      ...(reactionAccountMatches
        ? { pendingGroupReactionContextEncrypted: null }
        : {}),
      pendingParticipantAddition: false,
    },
    where: {
      channel: "linq",
      containerMemberId: input.containerMemberId,
      threadIdentityLookupKey: route.threadIdentityLookupKey,
      threadLookupKey: route.threadLookupKey,
    },
  });
  return result.count === 1
    ? {
        groupParticipantAdded: route.pendingParticipantAddition === true,
        groupReactionContext,
      }
    : emptyHostedLinqThreadRoutePendingContext();
}

export async function appendHostedLinqThreadRouteReactionContextTx(input: {
  accountLookupKey: string;
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
  text: string;
  threadId: string;
}): Promise<"appended" | "route_unavailable"> {
  return appendHostedLinqThreadRouteGroupEventContextTx(input);
}

export async function appendHostedLinqThreadRouteParticipantContextTx(input: {
  containerMemberId: string;
  excludedAccountLookupKeys: readonly string[];
  prisma: Prisma.TransactionClient;
  text: string;
  threadId: string;
}): Promise<"appended" | "route_unavailable"> {
  return appendHostedLinqThreadRouteGroupEventContextTx(input);
}

async function appendHostedLinqThreadRouteGroupEventContextTx(input: {
  accountLookupKey?: string;
  containerMemberId: string;
  excludedAccountLookupKeys?: readonly string[];
  prisma: Prisma.TransactionClient;
  text: string;
  threadId: string;
}): Promise<"appended" | "route_unavailable"> {
  const route = await lockAndReadHostedLinqThreadRoutePendingContextRowTx(input);
  if (
    !route
    || (
      input.accountLookupKey !== undefined
      && !doesHostedLinqRouteMatchAccount({
        accountLookupKey: input.accountLookupKey,
        route,
        threadId: input.threadId,
      })
    )
    || input.excludedAccountLookupKeys?.some((accountLookupKey) =>
      doesHostedLinqRouteMatchAccount({
        accountLookupKey,
        route,
        threadId: input.threadId,
      })
    ) === true
    || !(await readActiveHostedMemberAccess({
      memberId: route.containerMemberId,
      prisma: input.prisma,
    }))
  ) {
    return "route_unavailable";
  }
  const signal = AbortSignal.timeout(HOSTED_LINQ_GROUP_REACTION_CRYPTO_TIMEOUT_MS);
  const current = await openHostedLinqGroupReactionContext({
    route,
    signal,
    tx: input.prisma,
  });
  const items = [
    ...(current ?? []),
    requireHostedLinqGroupReactionContextText(input.text),
  ].slice(-HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_ITEMS);
  const encrypted = await sealHostedLinqGroupReactionContext({
    items,
    route,
    signal,
    tx: input.prisma,
  });
  const updated = await input.prisma.hostedThreadRoute.updateMany({
    data: {
      pendingGroupReactionContextEncrypted: encrypted,
    },
    where: {
      channel: "linq",
      containerMemberId: input.containerMemberId,
      threadIdentityLookupKey: route.threadIdentityLookupKey,
      threadLookupKey: route.threadLookupKey,
    },
  });
  return updated.count === 1 ? "appended" : "route_unavailable";
}

async function lockAndReadHostedLinqThreadRoutePendingContextRowTx(input: {
  accountLookupKey?: string;
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
  threadId: string;
}) {
  // Linq operations that need both locks always take chat ownership before the
  // route row. Mailbox append and usage-limit dispatch use the same order.
  await acquireHostedLinqChatOwnershipLockTx({
    chatId: input.threadId,
    tx: input.prisma,
  });
  await lockHostedThreadRouteByThreadIdentityTx({
    authority: {
      accountLookupKey: input.accountLookupKey,
      channel: "linq",
      containerMemberId: input.containerMemberId,
      threadId: input.threadId,
    },
    prisma: input.prisma,
  });
  return readHostedLinqThreadRoutePendingContextRowTx(input);
}

function emptyHostedLinqThreadRoutePendingContext(): HostedLinqThreadRoutePendingContext {
  return {
    groupParticipantAdded: false,
    groupReactionContext: null,
  };
}

async function readHostedLinqThreadRoutePendingContextRowTx(input: {
  containerMemberId: string;
  prisma: Prisma.TransactionClient;
  threadId: string;
}) {
  const threadIdentityLookupKeys =
    createHostedExternalThreadIdentityLookupKeyReadCandidates({
      channel: "linq",
      threadId: input.threadId,
    });
  if (threadIdentityLookupKeys.length === 0) {
    return null;
  }
  return input.prisma.hostedThreadRoute.findFirst({
    select: {
      containerMemberId: true,
      pendingGroupReactionContextEncrypted: true,
      pendingParticipantAddition: true,
      threadIdentityLookupKey: true,
      threadLookupKey: true,
    },
    where: {
      channel: "linq",
      containerMemberId: input.containerMemberId,
      threadIdentityLookupKey: { in: threadIdentityLookupKeys },
    },
  });
}

function doesHostedLinqRouteMatchAccount(input: {
  accountLookupKey: string;
  route: NonNullable<Awaited<ReturnType<typeof readHostedLinqThreadRoutePendingContextRowTx>>>;
  threadId: string;
}): boolean {
  return createHostedExternalThreadLookupKeyReadCandidates({
    accountLookupKey: input.accountLookupKey,
    channel: "linq",
    threadId: input.threadId,
  }).includes(input.route.threadLookupKey);
}

async function openHostedLinqGroupReactionContextBestEffort(input: {
  route: NonNullable<Awaited<ReturnType<typeof readHostedLinqThreadRoutePendingContextRowTx>>>;
  signal: AbortSignal;
  tx: Prisma.TransactionClient;
}): Promise<string[] | null> {
  try {
    return await openHostedLinqGroupReactionContext(input);
  } catch {
    // This is optional, lossy context. Corrupt or unavailable ciphertext must
    // never block the ordinary inbound message that consumes the route hint.
    return null;
  }
}

async function openHostedLinqGroupReactionContext(input: {
  route: NonNullable<Awaited<ReturnType<typeof readHostedLinqThreadRoutePendingContextRowTx>>>;
  signal: AbortSignal;
  tx: Prisma.TransactionClient;
}): Promise<string[] | null> {
  const serialized = await openHostedUserSecureBoxString({
    aad: buildHostedLinqGroupReactionContextAad(input.route.threadLookupKey),
    lane: "hosted-member-private-field",
    prisma: input.tx,
    scope: `hosted-thread-route:${HOSTED_LINQ_GROUP_REACTION_CONTEXT_FIELD}:v1`,
    signal: input.signal,
    userId: input.route.containerMemberId,
    value: input.route.pendingGroupReactionContextEncrypted,
  });
  if (!serialized) {
    return null;
  }
  return parseHostedLinqGroupReactionContextItems(serialized);
}

async function sealHostedLinqGroupReactionContext(input: {
  items: readonly string[];
  route: NonNullable<Awaited<ReturnType<typeof readHostedLinqThreadRoutePendingContextRowTx>>>;
  signal: AbortSignal;
  tx: Prisma.TransactionClient;
}): Promise<string> {
  const encrypted = await sealHostedUserSecureBoxString({
    aad: buildHostedLinqGroupReactionContextAad(input.route.threadLookupKey),
    lane: "hosted-member-private-field",
    prisma: input.tx,
    scope: `hosted-thread-route:${HOSTED_LINQ_GROUP_REACTION_CONTEXT_FIELD}:v1`,
    signal: input.signal,
    userId: input.route.containerMemberId,
    value: JSON.stringify(input.items),
  });
  if (!encrypted) {
    throw new Error("Hosted Linq group reaction context encryption returned no value.");
  }
  return encrypted;
}

function buildHostedLinqGroupReactionContextAad(threadLookupKey: string) {
  return {
    field: HOSTED_LINQ_GROUP_REACTION_CONTEXT_FIELD,
    purpose: "hosted-thread-route-private-state",
    rowId: threadLookupKey,
    table: "hosted_thread_route",
  } as const;
}

function requireHostedLinqGroupReactionContextText(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !normalized
    || normalized.length > HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_ITEM_MAX_CHARS
  ) {
    throw new TypeError("Hosted Linq group reaction context text is invalid.");
  }
  return normalized;
}

function parseHostedLinqGroupReactionContextItems(value: unknown): string[] {
  const serialized = typeof value === "string" ? value.trim() : "";
  if (!serialized) {
    throw new TypeError("Hosted Linq group reaction context is invalid.");
  }
  if (!serialized.startsWith("[")) {
    return [requireHostedLinqGroupReactionContextText(serialized)];
  }

  const parsed: unknown = JSON.parse(serialized);
  if (
    !Array.isArray(parsed)
    || parsed.length === 0
    || parsed.length > HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_ITEMS
  ) {
    throw new TypeError("Hosted Linq group reaction context is invalid.");
  }
  return parsed.map((item: unknown) =>
    requireHostedLinqGroupReactionContextText(item));
}

export async function hasHostedMemberEstablishedLinqThreadRoute(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  const route = await input.prisma.hostedThreadRoute.findFirst({
    select: {
      containerMemberId: true,
    },
    where: {
      channel: "linq",
      containerMemberId: input.memberId,
    },
  });

  return Boolean(route);
}

export async function assertHostedThreadRouteEgressAuthority(input: {
  authority: HostedThreadRouteEgressAuthority;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedThreadRouteSnapshot> {
  const route = await readHostedThreadRouteByThreadIdentity({
    channel: input.authority.channel,
    prisma: input.prisma,
    threadId: input.authority.threadId,
  });

  if (route && route.containerMemberId === input.authority.containerMemberId) {
    await assertActiveHostedThreadRouteContainerAccess({
      containerMemberId: route.containerMemberId,
      prisma: input.prisma,
    });
    return route;
  }

  throw buildHostedThreadRouteEgressUnauthorizedError();
}

export async function assertActiveHostedThreadRouteContainerAccess(input: {
  containerMemberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<void> {
  if (await readActiveHostedMemberAccess({
    memberId: input.containerMemberId,
    prisma: input.prisma,
  })) {
    return;
  }

  throw buildHostedThreadRouteEgressUnauthorizedError();
}

export async function assertHostedLinqRouteEgressAuthority(input: {
  authority: HostedLinqThreadRouteEgressAuthority;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedThreadRouteSnapshot> {
  return await assertHostedThreadRouteEgressAuthority({
    authority: input.authority,
    prisma: input.prisma,
  });
}

function buildHostedThreadRouteEgressUnauthorizedError() {
  return hostedOnboardingError({
    code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    httpStatus: 403,
    message: "External thread route egress is no longer authorized.",
    retryable: false,
  });
}
