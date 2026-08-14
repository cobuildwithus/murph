import {
  HostedBillingStatus,
  type Prisma,
} from "@prisma/client";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionMemberActivatedWake,
  type HostedExecutionMemberActivationSignupWelcome,
  type HostedExecutionMemberActivatedWake,
  type HostedExecutionAssistantNotificationRoute,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";

import {
  provisionHostedCryptoDomainRootsForUserTx,
  provisionPreparedHostedCryptoDomainRootsTx,
  readUserIdsWithActiveHostedCryptoDomainRootsTx,
  type PreparedHostedCryptoDomainRootCandidates,
  unwrapHostedDomainRootForWeb,
} from "../hosted-crypto/domain-root-store";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import {
  appendHostedMailboxEnvelopeTx,
  readHostedMailboxItemByDedupeKey,
  readHostedMailboxUserIdsByKind,
} from "../hosted-mailbox/store";
import { renderUserFacingMessage } from "../hosted-messages/user-facing-messages";
import {
  isHostedAccessBlockedBillingStatus,
  isHostedMemberSuspended,
} from "./entitlement";
import { readActiveHostedMemberAccess } from "./member-access";
import {
  clearHostedMemberPendingActivationTimeZone,
  composeHostedMemberSnapshot,
  type HostedMemberActivationCoreState,
  type HostedMemberSnapshot,
  readHostedMemberActivationCoreState,
  readHostedMemberEmailAuthorization,
  updateHostedMemberCoreState,
} from "./hosted-member-store";
import { readHostedMemberIdentity } from "./hosted-member-identity-store";
import { readHostedMemberRoutingState } from "./hosted-member-routing-store";
import { resolveHostedMemberActivationLinqRoute } from "./linq-home-routing";
import {
  resolveHostedMemberAssistantNotificationRoute,
  resolveHostedMemberChannels,
  resolveHostedMemberMessagingState,
} from "./messaging-state";
import {
  type HostedStripeDispatchContext,
} from "./stripe-dispatch";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import {
  type HostedOnboardingReadClient,
  lockHostedMemberRow,
} from "./shared";

export type HostedMemberActivationResult = {
  activated: boolean;
  hostedExecutionEventId: string | null;
  hostedExecutionMailboxItemId?: string | null;
  memberId: string;
};

type HostedMemberActivationSnapshot = HostedMemberSnapshot & {
  core: HostedMemberActivationCoreState;
};

export async function readHostedMemberActivationProofMemberIds(input: {
  memberIds: readonly string[];
  prisma: HostedOnboardingReadClient;
}): Promise<ReadonlySet<string>> {
  const memberIds = [...new Set(input.memberIds)];
  if (memberIds.length === 0) {
    return new Set();
  }

  const mailboxMemberIds = await readHostedMailboxUserIdsByKind({
    kind: "member.activated",
    prisma: input.prisma,
    userIds: memberIds,
  });
  const unresolvedMemberIds = memberIds.filter(
    (memberId) => !mailboxMemberIds.has(memberId),
  );
  if (unresolvedMemberIds.length === 0) {
    return mailboxMemberIds;
  }

  const cryptoMemberIds = await readUserIdsWithActiveHostedCryptoDomainRootsTx({
    tx: input.prisma,
    userIds: unresolvedMemberIds,
  });
  return new Set([...mailboxMemberIds, ...cryptoMemberIds]);
}

export async function hasHostedMemberActivationProof(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<boolean> {
  const activatedMemberIds = await readHostedMemberActivationProofMemberIds({
    memberIds: [input.memberId],
    prisma: input.prisma,
  });
  return activatedMemberIds.has(input.memberId);
}

export async function activateHostedMemberForPositiveSourceTx(input: {
  allowSignupWelcomeWithoutAssignableLinqLine?: boolean;
  dispatchContext: HostedStripeDispatchContext;
  emailLinked?: boolean;
  memberId: string;
  preparedCryptoDomainRoots?: PreparedHostedCryptoDomainRootCandidates;
  prisma: Prisma.TransactionClient;
  skipIfBillingAlreadyActive?: boolean;
  skipIfPreviouslyActivated?: boolean;
  suppressSignupWelcome?: boolean;
}): Promise<HostedMemberActivationResult> {
  const timing = startHostedOnboardingTiming(
    "hosted-onboarding.member-activation.positive-source",
    {
      sourceType: input.dispatchContext.sourceType,
    },
  );

  try {
    const result = await runWithHostedDomainRootUnwrapCache(() =>
      activateHostedMemberForPositiveSourceTxInner({
        ...input,
        allowLegacyCryptoPreparation: false,
      })
    );

    finishHostedOnboardingTiming(timing, "completed", {
      activated: result.activated,
      existingDispatch: !result.activated && Boolean(result.hostedExecutionEventId),
    });

    return result;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
}

export async function activateHostedMemberForFamilySponsorshipTx(input: {
  memberId: string;
  occurredAt: Date;
  preparedCryptoDomainRoots?: PreparedHostedCryptoDomainRootCandidates;
  prisma: Prisma.TransactionClient;
  sourceEventId: string;
}): Promise<HostedMemberActivationResult> {
  return runWithHostedDomainRootUnwrapCache(() =>
    activateHostedMemberForPositiveSourceTxInner({
      allowLegacyCryptoPreparation: !input.preparedCryptoDomainRoots,
      dispatchContext: {
        eventCreatedAt: input.occurredAt,
        occurredAt: input.occurredAt.toISOString(),
        sourceEventId: input.sourceEventId,
        sourceType: "hosted.family.sponsorship",
      },
      memberId: input.memberId,
      preparedCryptoDomainRoots: input.preparedCryptoDomainRoots,
      preserveBillingStatus: true,
      prisma: input.prisma,
      skipIfPreviouslyActivated: true,
      welcomeMessage: renderUserFacingMessage({
        context: {},
        key: "assistant.family_welcome",
        seed: input.memberId,
      }).text,
    })
  );
}

async function activateHostedMemberForPositiveSourceTxInner(input: {
  allowLegacyCryptoPreparation: boolean;
  allowSignupWelcomeWithoutAssignableLinqLine?: boolean;
  dispatchContext: HostedStripeDispatchContext;
  emailLinked?: boolean;
  memberId: string;
  preparedCryptoDomainRoots?: PreparedHostedCryptoDomainRootCandidates;
  preserveBillingStatus?: boolean;
  prisma: Prisma.TransactionClient;
  skipIfBillingAlreadyActive?: boolean;
  skipIfPreviouslyActivated?: boolean;
  suppressSignupWelcome?: boolean;
  welcomeMessage?: string;
}): Promise<HostedMemberActivationResult> {
  const currentMember = await readActivationReadyHostedMemberTx({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (!currentMember) {
    return buildHostedInactiveMemberActivationResult(input.memberId);
  }

  const activationEventId = buildHostedMemberActivationEventId({
    memberId: currentMember.core.id,
    sourceEventId: input.dispatchContext.sourceEventId,
    sourceType: input.dispatchContext.sourceType,
  });
  const existingWake = await readHostedMailboxItemByDedupeKey({
    dedupeKey: activationEventId,
    prisma: input.prisma,
    userId: currentMember.core.id,
  });

  if (
    input.skipIfBillingAlreadyActive
    && currentMember.core.billingStatus === HostedBillingStatus.active
  ) {
    await clearHostedMemberPendingActivationTimeZoneIfPresentTx({
      member: currentMember,
      prisma: input.prisma,
    });

    if (existingWake) {
      return {
        activated: false,
        hostedExecutionEventId: existingWake.dedupeKey,
        ...(!existingWake.consumedAt
          ? { hostedExecutionMailboxItemId: existingWake.id }
          : {}),
        memberId: currentMember.core.id,
      };
    }

    return {
      activated: false,
      hostedExecutionEventId: null,
      memberId: currentMember.core.id,
    };
  }

  if (input.skipIfPreviouslyActivated) {
    const previouslyActivated = Boolean(existingWake)
      || await hasHostedMemberActivationProof({
        memberId: currentMember.core.id,
        prisma: input.prisma,
      });

    if (previouslyActivated) {
      await clearHostedMemberPendingActivationTimeZoneIfPresentTx({
        member: currentMember,
        prisma: input.prisma,
      });

      return {
        activated: false,
        hostedExecutionEventId: existingWake?.dedupeKey ?? null,
        ...(existingWake && !existingWake.consumedAt
          ? { hostedExecutionMailboxItemId: existingWake.id }
          : {}),
        memberId: currentMember.core.id,
      };
    }
  }

  if (
    !input.preserveBillingStatus &&
    currentMember.core.billingStatus !== HostedBillingStatus.active
  ) {
    await updateHostedMemberCoreState({
      billingStatus: HostedBillingStatus.active,
      memberId: currentMember.core.id,
      prisma: input.prisma,
    });
  }

  if (currentMember.core.pendingActivationTimeZone) {
    await clearHostedMemberPendingActivationTimeZone({
      memberId: currentMember.core.id,
      prisma: input.prisma,
    });
  }

  if (
    input.preparedCryptoDomainRoots
    || !input.allowLegacyCryptoPreparation
  ) {
    await provisionPreparedHostedCryptoDomainRootsTx({
      prepared: input.preparedCryptoDomainRoots ?? new Map(),
      reason: "hosted-member.activation",
      tx: input.prisma,
      userId: currentMember.core.id,
    });
  } else {
    // Inbound family acceptance can create the member id inside its owning
    // webhook transaction. Preserve that product-critical path through the
    // explicit legacy bridge until its owner can preallocate and prepare the id.
    await provisionHostedCryptoDomainRootsForUserTx({
      reason: "hosted-member.activation",
      tx: input.prisma,
      userId: currentMember.core.id,
    });
  }
  await prewarmHostedMemberActivationWriteDomainRoots({
    memberId: currentMember.core.id,
    prisma: input.prisma,
  });

  const signupWelcomeRoute = input.suppressSignupWelcome
    ? null
    : (await resolveHostedMemberActivationWelcomeLinqRoute({
        ...(input.allowSignupWelcomeWithoutAssignableLinqLine
          ? { allowNoAssignableLine: true }
          : {}),
        member: currentMember,
        prisma: input.prisma,
      })).welcomeRoute;
  const activationWake = buildHostedMemberActivationWakeForMember({
    emailLinked: input.emailLinked ?? resolveHostedMemberActivationEmailLinked(currentMember),
    member: currentMember,
    occurredAt: input.dispatchContext.occurredAt,
    sourceEventId: input.dispatchContext.sourceEventId,
    sourceType: input.dispatchContext.sourceType,
    signupWelcomeRoute,
    welcomeMessage: input.welcomeMessage,
  });
  const legacyWelcomeWake = buildHostedMemberSignupWelcomeNotificationWake({
    activationWake,
    occurredAt: input.dispatchContext.occurredAt,
  });
  const appendedWake = await materializeHostedMemberActivationWakesTx({
    prisma: input.prisma,
    activationWake,
    legacyWelcomeWake,
  });

  return {
    activated: true,
    hostedExecutionEventId: appendedWake.eventId,
    ...(appendedWake.mailboxItemId
      ? { hostedExecutionMailboxItemId: appendedWake.mailboxItemId }
      : {}),
    memberId: currentMember.core.id,
  };
}

async function prewarmHostedMemberActivationWriteDomainRoots(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const outcomes = await Promise.allSettled(
    (["control", "ingress"] as const).map(async (domain) => {
      const root = await unwrapHostedDomainRootForWeb({
        domain,
        prisma: input.prisma,
        userId: input.memberId,
      });
      root.rootKey.fill(0);
    }),
  );
  const failure = outcomes.find(
    (outcome): outcome is PromiseRejectedResult =>
      outcome.status === "rejected",
  );
  if (failure) {
    throw failure.reason;
  }
}

export function buildHostedMemberActivationWelcomeRoute(input: {
  linqChatId: string | null;
  linqContactLookupKey?: string | null;
  linqRecipientPhone?: string | null;
  memberId: string;
  memberPhoneNumber?: string | null;
  phoneLookupKey: string | null;
  pendingLinqChatId?: string | null;
  pendingLinqParticipantContact?: {
    lookupKey?: string | null;
  } | null;
  telegramThreadId: string | null;
  telegramUserId: string | null;
}): HostedExecutionAssistantNotificationRoute | null {
  return resolveHostedMemberAssistantNotificationRoute({
    linqChatId: input.linqChatId,
    linqContactLookupKey: input.linqContactLookupKey,
    linqRecipientPhone: input.linqRecipientPhone ?? null,
    memberId: input.memberId,
    memberPhoneNumber: input.memberPhoneNumber ?? null,
    messaging: resolveHostedMemberMessagingState({
      identity: {
        phoneLookupKey: input.phoneLookupKey,
      },
      routing: {
        linqChatId: input.linqChatId,
        pendingLinqChatId: input.pendingLinqChatId ?? null,
        pendingLinqParticipantContact: input.pendingLinqParticipantContact ?? null,
        telegramThreadId: input.telegramThreadId,
        telegramUserId: input.telegramUserId,
      },
    }),
  });
}

async function resolveHostedMemberActivationWelcomeLinqRoute(input: {
  allowNoAssignableLine?: boolean;
  member: HostedMemberActivationSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<{ welcomeRoute: HostedExecutionAssistantNotificationRoute | null }> {
  const linqContactLookupKey =
    input.member.identity?.phoneLookupKey
    ?? input.member.routing?.pendingLinqParticipantContact?.lookupKey
    ?? input.member.emailAuthorization?.verifiedEmail?.lookupKey
    ?? null;
  const hasReusableLinqThread = Boolean(
    input.member.routing?.linqChatId
    || input.member.routing?.pendingLinqChatId,
  );

  if (
    !input.member.identity?.phoneNumber
    && (
      !linqContactLookupKey
      || !hasReusableLinqThread
    )
  ) {
    return {
      welcomeRoute: buildHostedMemberActivationWelcomeRoute({
        linqChatId: input.member.routing?.linqChatId ?? null,
        linqContactLookupKey,
        linqRecipientPhone: input.member.routing?.linqRecipientPhone ?? null,
        memberId: input.member.core.id,
        memberPhoneNumber: input.member.identity?.phoneNumber ?? null,
        phoneLookupKey: input.member.identity?.phoneLookupKey ?? null,
        pendingLinqChatId: input.member.routing?.pendingLinqChatId ?? null,
        pendingLinqParticipantContact:
          input.member.routing?.pendingLinqParticipantContact ?? null,
        telegramThreadId: input.member.routing?.telegramThreadId ?? null,
        telegramUserId: input.member.routing?.telegramUserId ?? null,
      }),
    };
  }

  return resolveHostedMemberActivationLinqRoute({
    ...(input.allowNoAssignableLine
      ? { allowNoAssignableLine: true }
      : {}),
    member: input.member,
    prisma: input.prisma,
  });
}

async function readActivationReadyHostedMemberTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberActivationSnapshot | null> {
  await lockHostedMemberRow(input.prisma, input.memberId);

  const currentMember = await readHostedMemberActivationSnapshotTx({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (!currentMember || isHostedMemberSuspended(currentMember.core.suspendedAt)) {
    return null;
  }

  // A hard-blocked own billing status (canceled/paused/unpaid) only bars
  // activation when no sponsorship covers the member; a family-sponsored
  // member with a stale own status is still activation-ready.
  if (
    isHostedAccessBlockedBillingStatus(currentMember.core.billingStatus)
    && !(await readActiveHostedMemberAccess({
      memberId: input.memberId,
      prisma: input.prisma,
    }))
  ) {
    return null;
  }

  return currentMember;
}

async function readHostedMemberActivationSnapshotTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedMemberActivationSnapshot | null> {
  const core = await readHostedMemberActivationCoreState({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  if (!core) {
    return null;
  }

  const identity = await readHostedMemberIdentity({
    memberId: core.id,
    prisma: input.prisma,
  });
  const routing = await readHostedMemberRoutingState({
    memberId: core.id,
    prisma: input.prisma,
  });
  const emailAuthorization = await readHostedMemberEmailAuthorization({
    memberId: core.id,
    prisma: input.prisma,
  });

  const snapshot = composeHostedMemberSnapshot(core, {
    billingRef: null,
    emailAuthorization,
    identity,
    routing,
  });

  return {
    ...snapshot,
    core,
  };
}

async function clearHostedMemberPendingActivationTimeZoneIfPresentTx(input: {
  member: HostedMemberActivationSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  if (!input.member.core.pendingActivationTimeZone) {
    return;
  }

  await clearHostedMemberPendingActivationTimeZone({
    memberId: input.member.core.id,
    prisma: input.prisma,
  });
}

function resolveHostedMemberActivationEmailLinked(
  member: Pick<HostedMemberSnapshot, "emailAuthorization">,
): boolean {
  return Boolean(member.emailAuthorization?.verifiedEmail);
}

function buildHostedInactiveMemberActivationResult(
  memberId: string,
): HostedMemberActivationResult {
  return {
    activated: false,
    hostedExecutionEventId: null,
    memberId,
  };
}

async function materializeHostedMemberActivationWakesTx(input: {
  activationWake: HostedExecutionMemberActivatedWake;
  legacyWelcomeWake: HostedExecutionWake | null;
  prisma: Prisma.TransactionClient;
}): Promise<{ eventId: string; mailboxItemId: string }> {
  const appendedWake = await appendHostedMailboxEnvelopeTx({
    envelope: input.activationWake,
    tx: input.prisma,
  });

  if (input.legacyWelcomeWake) {
    await appendHostedMailboxEnvelopeTx({
      envelope: input.legacyWelcomeWake,
      tx: input.prisma,
    });
  }

  return {
    eventId: appendedWake.item.dedupeKey,
    mailboxItemId: appendedWake.item.id,
  };
}

function buildHostedMemberActivationWakeForMember(input: {
  emailLinked: boolean;
  member: HostedMemberActivationSnapshot;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
  signupWelcomeRoute: HostedExecutionAssistantNotificationRoute | null;
  welcomeMessage?: string;
}): HostedExecutionMemberActivatedWake {
  return buildHostedMemberActivationWake({
    emailLinked: input.emailLinked,
    memberId: input.member.core.id,
    memberPhoneNumber: input.member.identity?.phoneNumber ?? null,
    phoneLookupKey: input.member.identity?.phoneLookupKey ?? null,
    linqChatId: input.member.routing?.linqChatId ?? null,
    pendingLinqChatId: input.member.routing?.pendingLinqChatId ?? null,
    pendingLinqParticipantContact:
      input.member.routing?.pendingLinqParticipantContact ?? null,
    telegramThreadId: input.member.routing?.telegramThreadId ?? null,
    telegramUserId: input.member.routing?.telegramUserId ?? null,
    occurredAt: input.occurredAt,
    sourceEventId: input.sourceEventId,
    sourceType: input.sourceType,
    signupWelcomeRoute: input.signupWelcomeRoute,
    timeZone: input.member.core.pendingActivationTimeZone,
    welcomeMessage: input.welcomeMessage,
  });
}

function buildHostedMemberActivationWake(input: {
  emailLinked?: boolean;
  memberId: string;
  memberPhoneNumber?: string | null;
  phoneLookupKey?: string | null;
  linqChatId?: string | null;
  pendingLinqChatId?: string | null;
  pendingLinqParticipantContact?: {
    lookupKey?: string | null;
  } | null;
  telegramThreadId?: string | null;
  telegramUserId?: string | null;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
  signupWelcomeRoute?: HostedExecutionAssistantNotificationRoute | null;
  timeZone?: string | null;
  welcomeMessage?: string;
}): HostedExecutionMemberActivatedWake {
  return buildHostedExecutionMemberActivatedWake({
    eventId: buildHostedMemberActivationEventId(input),
    memberChannels: resolveHostedMemberChannels({
      emailLinked: input.emailLinked ?? false,
      identity: {
        phoneLookupKey: input.phoneLookupKey ?? null,
      },
      routing: {
        linqChatId: input.linqChatId ?? null,
        pendingLinqChatId: input.pendingLinqChatId ?? null,
        pendingLinqParticipantContact: input.pendingLinqParticipantContact ?? null,
        telegramThreadId: input.telegramThreadId ?? null,
        telegramUserId: input.telegramUserId ?? null,
      },
    }),
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    signupWelcome: buildHostedMemberSignupWelcomePayload({
      route: input.signupWelcomeRoute ?? null,
      welcomeMessage: input.welcomeMessage ?? null,
      seed: buildHostedMemberSignupWelcomeMessageSeed(input),
    }),
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
  });
}

function buildHostedMemberSignupWelcomePayload(input: {
  route: HostedExecutionAssistantNotificationRoute | null;
  welcomeMessage: string | null;
  seed: string;
}): HostedExecutionMemberActivationSignupWelcome | null {
  if (!input.route) {
    return null;
  }

  return {
    route: input.route,
    text: input.welcomeMessage ?? renderUserFacingMessage({
      context: {},
      key: "assistant.signup_welcome",
      seed: input.seed,
    }).text,
  };
}

function buildHostedMemberSignupWelcomeMessageSeed(input: {
  memberId: string;
}): string {
  return buildHostedMemberSignupWelcomeDeliveryIdentity(input.memberId);
}

function buildHostedMemberSignupWelcomeNotificationWake(input: {
  activationWake: HostedExecutionMemberActivatedWake;
  occurredAt: string;
}): HostedExecutionWake | null {
  const signupWelcome = input.activationWake.signupWelcome;
  if (!signupWelcome) {
    return null;
  }
  const deliveryIdentity = buildHostedMemberSignupWelcomeDeliveryIdentity(input.activationWake.userId);

  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: buildHostedMemberSignupWelcomeNotificationEventId(input.activationWake),
    memberId: input.activationWake.userId,
    notification: {
      deliveryDedupeToken: deliveryIdentity,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: deliveryIdentity,
      firstContact: {
        markSeenOnDeliveryAccepted: true,
      },
      instructions: buildHostedMemberSignupWelcomeInstructions(signupWelcome.text),
      responsePolicy: {
        kind: "require_send_exact_text",
        text: signupWelcome.text,
      },
      route: signupWelcome.route,
    },
    occurredAt: input.occurredAt,
  });
}

function buildHostedMemberSignupWelcomeDeliveryIdentity(memberId: string): string {
  return `signup-welcome:${memberId}`;
}

function buildHostedMemberSignupWelcomeInstructions(text: string): string {
  return [
    "Prepare the first in-chat onboarding reply.",
    "Use this user-facing reply only:",
    text,
  ].join("\n\n");
}

function buildHostedMemberSignupWelcomeNotificationEventId(
  activationWake: HostedExecutionMemberActivatedWake,
): string {
  return `assistant.notification.requested:signup-welcome:${activationWake.userId}:${activationWake.eventId}`;
}

export function buildHostedMemberActivationEventId(input: {
  memberId: string;
  sourceEventId: string;
  sourceType: string;
}): string {
  return `member.activated:${input.sourceType}:${input.memberId}:${input.sourceEventId}`;
}
