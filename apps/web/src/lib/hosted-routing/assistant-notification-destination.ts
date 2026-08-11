import "server-only";

import type {
  HostedExecutionAssistantNotificationRoute,
  HostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import {
  createHostedAssistantConversationIdentifierBlind,
  hashHostedAssistantConversationIdentifier,
} from "@murphai/hosted-execution/assistant-identifiers";

import {
  createHostedExternalThreadIdentityLookupKeyReadCandidates,
  createHostedExternalThreadLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  readHostedMemberAssistantNotificationState,
} from "../hosted-onboarding/hosted-member-store";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberMessagingState,
} from "../hosted-onboarding/messaging-state";
import type {
  HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import {
  HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY,
  isHostedThreadDeliveryRouteChannel,
  openHostedThreadDeliveryRoute,
  type HostedThreadDeliveryRouteV1,
} from "./thread-delivery-route";
import {
  assertHostedThreadRouteEgressAuthority,
} from "./thread-route-store";

export type HostedAssistantNotificationConversationShape =
  | "direct-member"
  | "thread-container";

export interface HostedAssistantNotificationDestination {
  conversationShape: HostedAssistantNotificationConversationShape;
  externalThreadRouteAuthority: HostedExecutionExternalThreadRouteAuthority | null;
  route: HostedExecutionAssistantNotificationRoute;
}

export interface HostedAssistantNotificationBoundDestination {
  externalThreadRouteAuthority: HostedExecutionExternalThreadRouteAuthority | null;
  route: HostedExecutionAssistantNotificationRoute;
}

export async function resolveHostedAssistantNotificationDestination(input: {
  directChannel?: "linq" | "telegram";
  memberId: string;
  prisma?: HostedOnboardingReadClient;
  signal?: AbortSignal;
}): Promise<HostedAssistantNotificationDestination | null> {
  const prisma = input.prisma ?? getPrisma();
  const container = await prisma.hostedThreadContainer.findUnique({
    select: {
      memberId: true,
    },
    where: {
      memberId: input.memberId,
    },
  });

  // Container-shaped runtimes never fall back to their owner or to an
  // accidental member-routing row. Missing or invalid group route material is
  // an addressability failure for this conversation and must fail closed.
  if (container) {
    return await resolveHostedThreadContainerNotificationDestination({
      containerMemberId: container.memberId,
      prisma,
      signal: input.signal,
    });
  }

  const member = await readHostedMemberAssistantNotificationState({
    memberId: input.memberId,
    prisma,
  });
  if (!member) {
    return null;
  }

  const messaging = resolveHostedMemberMessagingState({
    identity: member.identity,
    routing: member.routing,
  });
  const route = resolveHostedMemberAssistantNotificationRoute({
    ...(input.directChannel ? { channel: input.directChannel } : {}),
    linqChatId: member.routing?.linqChatId ?? member.routing?.pendingLinqChatId ?? null,
    linqContactLookupKey: member.routing?.pendingLinqParticipantContact?.lookupKey ?? null,
    linqRecipientPhone:
      member.routing?.linqRecipientPhone
      ?? member.routing?.pendingLinqRecipientPhone
      ?? null,
    memberId: input.memberId,
    memberPhoneNumber: member.identity?.phoneNumber ?? null,
    messaging,
  });
  return route
    ? {
        conversationShape: "direct-member",
        externalThreadRouteAuthority: null,
        route,
      }
    : null;
}

export async function requireHostedAssistantNotificationDestination(input: {
  memberId: string;
  prisma?: HostedOnboardingReadClient;
  signal?: AbortSignal;
}): Promise<HostedAssistantNotificationDestination> {
  const destination = await resolveHostedAssistantNotificationDestination(input);
  if (destination) {
    return destination;
  }

  throw hostedOnboardingError({
    code: "HOSTED_ASSISTANT_NOTIFICATION_ROUTE_REQUIRED",
    httpStatus: 409,
    message: "Hosted assistant delivery requires a durable notification route.",
    retryable: true,
  });
}

export async function assertHostedAssistantNotificationRouteAuthority(input: {
  authority: HostedExecutionExternalThreadRouteAuthority;
  prisma?: HostedOnboardingReadClient;
  signal?: AbortSignal;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();
  const container = await prisma.hostedThreadContainer.findUnique({
    select: { memberId: true },
    where: { memberId: input.authority.containerMemberId },
  });
  if (container) {
    await assertHostedThreadRouteEgressAuthority({
      authority: input.authority,
      prisma,
    });
    return;
  }
  await assertHostedDirectAssistantNotificationRouteAuthority({
    authority: input.authority,
    prisma,
    signal: input.signal,
  });
}

export async function assertHostedDirectAssistantNotificationRouteAuthority(
  input: {
    authority: HostedExecutionExternalThreadRouteAuthority;
    prisma?: HostedOnboardingReadClient;
    requireThreadDelivery?: boolean;
    signal?: AbortSignal;
  },
): Promise<void> {
  if (
    input.authority.channel !== "linq"
    && input.authority.channel !== "telegram"
  ) {
    throw hostedNotificationRouteAuthorityError();
  }

  const destination = await resolveHostedAssistantNotificationDestination({
    directChannel: input.authority.channel,
    memberId: input.authority.containerMemberId,
    prisma: input.prisma,
    signal: input.signal,
  });
  if (
    destination?.conversationShape === "direct-member"
    && destination.externalThreadRouteAuthority === null
    && destination.route.channel === input.authority.channel
    && destination.route.threadIsDirect === true
    && (
      input.requireThreadDelivery !== true
      || destination.route.delivery.kind === "thread"
    )
    && destination.route.delivery.target === input.authority.threadId
  ) {
    return;
  }
  throw hostedNotificationRouteAuthorityError();
}

function hostedNotificationRouteAuthorityError() {
  return hostedOnboardingError({
    code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    httpStatus: 403,
    message: "Hosted notification route is no longer authorized.",
    retryable: false,
  });
}

export function isHostedThreadContainerNotificationDestination(
  destination: HostedAssistantNotificationDestination,
): boolean {
  if (destination.conversationShape === "thread-container") {
    if (
      destination.externalThreadRouteAuthority === null
      || destination.route.threadIsDirect !== false
    ) {
      throw new Error(
        "Hosted thread-container notification destination is inconsistent.",
      );
    }
    return true;
  }

  if (
    destination.externalThreadRouteAuthority !== null
    || destination.route.threadIsDirect !== true
  ) {
    throw new Error("Hosted direct notification destination is inconsistent.");
  }
  return false;
}

export function bindHostedAssistantNotificationDestination(input: {
  destination: HostedAssistantNotificationDestination;
  memberId: string;
}): HostedAssistantNotificationBoundDestination {
  const { destination, memberId } = input;
  const route = destination.route;

  if (isHostedThreadContainerNotificationDestination(destination)) {
    const authority = destination.externalThreadRouteAuthority;
    if (
      authority === null
      || authority.containerMemberId !== memberId
      || authority.channel !== route.channel
      || route.delivery.kind !== "thread"
      || authority.threadId !== route.delivery.target
    ) {
      throw new Error(
        "Hosted thread-container notification destination is inconsistent.",
      );
    }
    return {
      externalThreadRouteAuthority: authority,
      route,
    };
  }

  if (route.delivery.kind === "explicit") {
    throw new Error("Hosted direct notification destination is inconsistent.");
  }
  if (
    (route.channel !== "linq" && route.channel !== "telegram")
    || route.delivery.kind !== "thread"
  ) {
    return {
      externalThreadRouteAuthority: null,
      route,
    };
  }

  return {
    externalThreadRouteAuthority: {
      channel: route.channel,
      containerMemberId: memberId,
      threadId: route.delivery.target,
    },
    route: route.channel === "linq"
      ? {
          ...route,
          delivery: {
            ...route.delivery,
            kind: "explicit",
          },
        }
      : route,
  };
}

async function resolveHostedThreadContainerNotificationDestination(input: {
  containerMemberId: string;
  prisma: HostedOnboardingReadClient;
  signal?: AbortSignal;
}): Promise<HostedAssistantNotificationDestination> {
  const rows = await input.prisma.hostedThreadRoute.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      channel: true,
      containerMemberId: true,
      deliveryRouteEncrypted: true,
      threadIdentityLookupKey: true,
      threadLookupKey: true,
    },
    where: {
      containerMemberId: input.containerMemberId,
    },
  });

  if (rows.length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_NOTIFICATION_ROUTE_REQUIRED",
      httpStatus: 409,
      message: "Hosted thread delivery requires one durable route.",
      retryable: true,
    });
  }
  if (rows.length !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_NOTIFICATION_ROUTE_AMBIGUOUS",
      details: {
        matchCount: rows.length,
      },
      httpStatus: 500,
      message: "Hosted thread delivery route ownership is ambiguous.",
      retryable: false,
    });
  }

  const row = rows[0]!;
  if (!isHostedThreadDeliveryRouteChannel(row.channel)) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_NOTIFICATION_ROUTE_INVALID",
      httpStatus: 409,
      message: "Hosted thread delivery route material is unavailable or invalid.",
      retryable: true,
    });
  }
  let deliveryRoute: HostedThreadDeliveryRouteV1;
  try {
    deliveryRoute = await openHostedThreadDeliveryRoute({
      channel: row.channel,
      containerMemberId: input.containerMemberId,
      encrypted: row.deliveryRouteEncrypted,
      prisma: input.prisma,
      signal: input.signal,
    });
  } catch (cause) {
    throw hostedOnboardingError({
      cause,
      code: "HOSTED_THREAD_NOTIFICATION_ROUTE_INVALID",
      httpStatus: 409,
      message: "Hosted thread delivery route material is unavailable or invalid.",
      retryable: true,
    });
  }

  assertHostedThreadDeliveryRouteMatchesRow({
    containerMemberId: input.containerMemberId,
    deliveryRoute,
    row,
  });

  const externalThreadRouteAuthority: HostedExecutionExternalThreadRouteAuthority = {
    ...(deliveryRoute.channel === "linq"
      ? { accountLookupKey: deliveryRoute.accountLookupKey }
      : {}),
    channel: deliveryRoute.channel,
    containerMemberId: input.containerMemberId,
    threadId: deliveryRoute.threadId,
  };
  // Re-read the route by its blinded thread identity so a concurrent removal
  // or rebind cannot turn decrypted historical material into fresh authority.
  await assertHostedThreadRouteEgressAuthority({
    authority: externalThreadRouteAuthority,
    prisma: input.prisma,
  });

  const identifierSecret = deliveryRoute.channel === "linq"
    ? deliveryRoute.accountLookupKey
    : deliveryRoute.threadId;
  const identifierBlind = createHostedAssistantConversationIdentifierBlind({
    secret: identifierSecret,
    userId: input.containerMemberId,
  });
  const identitySource = deliveryRoute.channel === "linq"
    ? deliveryRoute.accountLookupKey
    : HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY;
  const route: HostedExecutionAssistantNotificationRoute = {
    actorId: null,
    channel: deliveryRoute.channel,
    delivery: {
      kind: "thread",
      target: deliveryRoute.threadId,
    },
    identityId: hashHostedAssistantConversationIdentifier(
      identifierBlind,
      identitySource,
    ),
    threadId: hashHostedAssistantConversationIdentifier(
      identifierBlind,
      deliveryRoute.threadId,
    ),
    threadIsDirect: false,
  };

  return {
    conversationShape: "thread-container",
    externalThreadRouteAuthority,
    route,
  };
}

function assertHostedThreadDeliveryRouteMatchesRow(input: {
  containerMemberId: string;
  deliveryRoute: HostedThreadDeliveryRouteV1;
  row: {
    channel: string;
    containerMemberId: string;
    threadIdentityLookupKey: string;
    threadLookupKey: string;
  };
}): void {
  const accountLookupKey = input.deliveryRoute.channel === "linq"
    ? input.deliveryRoute.accountLookupKey
    : HOSTED_TELEGRAM_THREAD_ACCOUNT_LOOKUP_KEY;
  const identityLookupKeys = createHostedExternalThreadIdentityLookupKeyReadCandidates({
    channel: input.deliveryRoute.channel,
    threadId: input.deliveryRoute.threadId,
  });
  const authorityLookupKeys = createHostedExternalThreadLookupKeyReadCandidates({
    accountLookupKey,
    channel: input.deliveryRoute.channel,
    threadId: input.deliveryRoute.threadId,
  });

  if (
    input.row.containerMemberId !== input.containerMemberId
    || input.row.channel !== input.deliveryRoute.channel
    || !identityLookupKeys.includes(input.row.threadIdentityLookupKey)
    || !authorityLookupKeys.includes(input.row.threadLookupKey)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_NOTIFICATION_ROUTE_MISMATCH",
      httpStatus: 409,
      message: "Hosted thread delivery route material does not match route authority.",
      retryable: true,
    });
  }
}
