import {
  HostedBillingStatus,
  HostedRevnetIssuanceStatus,
  type Prisma,
} from "@prisma/client";
import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionMemberActivatedWake,
  type HostedExecutionAssistantNotificationRoute,
  type HostedIngressEnvelope,
} from "@murphai/hosted-execution";

import {
  findHostedIngressByEventIdTx,
  materializeHostedIngressEnvelopeTx,
} from "../hosted-ingress/lifecycle";
import {
  deriveHostedEntitlement,
  isHostedAccessBlockedBillingStatus,
} from "./entitlement";
import {
  type HostedMemberBillingSnapshot,
  type HostedMemberSnapshot,
  readHostedMemberSnapshot,
  updateHostedMemberCoreState,
} from "./hosted-member-store";
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
import { lockHostedMemberRow } from "./shared";

export type HostedMemberActivationResult = {
  activated: boolean;
  hostedExecutionEventId: string | null;
  memberId: string;
};

export async function activateHostedMemberFromConfirmedRevnetIssuanceTx(input: {
  emailLinked?: boolean;
  member: HostedMemberSnapshot;
  occurredAt: string;
  prisma: Prisma.TransactionClient;
  sourceEventId: string;
  sourceType: string;
}): Promise<HostedMemberActivationResult> {
  const timing = startHostedOnboardingTiming(
    "hosted-onboarding.member-activation.revnet-confirmed",
    {
      sourceType: input.sourceType,
    },
  );

  try {
    const activated = await tryActivateHostedMemberIfStillAllowedTx({
      member: input.member,
      prisma: input.prisma,
      revnetIssuanceStatus: HostedRevnetIssuanceStatus.confirmed,
      revnetRequired: true,
    });

    if (!activated) {
      finishHostedOnboardingTiming(timing, "completed", {
        activated: false,
      });
      return {
        activated: false,
        hostedExecutionEventId: null,
        memberId: input.member.core.id,
      };
    }

    const linqRoute = await resolveHostedMemberActivationWelcomeLinqRoute({
      member: input.member,
      prisma: input.prisma,
    });
    const activationWake = buildHostedMemberActivationWakeForMember({
      emailLinked: input.emailLinked ?? false,
      member: input.member,
      occurredAt: input.occurredAt,
      sourceEventId: input.sourceEventId,
      sourceType: input.sourceType,
    });
    const welcomeWake = buildHostedMemberSignupWelcomeNotificationWake({
      activationWake,
      occurredAt: input.occurredAt,
      route: linqRoute.welcomeRoute,
    });
    const appendedWake = await materializeHostedMemberActivationWakesTx({
      activationWake,
      prisma: input.prisma,
      welcomeWake,
    });

    finishHostedOnboardingTiming(timing, "completed", {
      activated: true,
      dispatchScheduled: true,
    });

    return {
      activated: true,
      hostedExecutionEventId: appendedWake.eventId,
      memberId: input.member.core.id,
    };
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
}

export async function activateHostedMemberForPositiveSourceTx(input: {
  dispatchContext: HostedStripeDispatchContext;
  emailLinked?: boolean;
  member: Pick<HostedMemberBillingSnapshot, "core">;
  prisma: Prisma.TransactionClient;
  skipIfBillingAlreadyActive?: boolean;
}): Promise<HostedMemberActivationResult> {
  const timing = startHostedOnboardingTiming(
    "hosted-onboarding.member-activation.positive-source",
    {
      sourceType: input.dispatchContext.sourceType,
    },
  );

  try {
    const result = await activateHostedMemberForPositiveSourceTxInner(input);

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

async function activateHostedMemberForPositiveSourceTxInner(input: {
  dispatchContext: HostedStripeDispatchContext;
  emailLinked?: boolean;
  member: Pick<HostedMemberBillingSnapshot, "core">;
  prisma: Prisma.TransactionClient;
  skipIfBillingAlreadyActive?: boolean;
}): Promise<HostedMemberActivationResult> {
  await lockHostedMemberRow(input.prisma, input.member.core.id);

  const currentMember = await readHostedMemberSnapshot({
    memberId: input.member.core.id,
    prisma: input.prisma,
  });

  if (!currentMember || isHostedAccessBlockedBillingStatus(currentMember.core.billingStatus)) {
    return buildHostedInactiveMemberActivationResult(input.member.core.id);
  }

  const activationEventId = buildHostedMemberActivationEventId({
    memberId: currentMember.core.id,
    sourceEventId: input.dispatchContext.sourceEventId,
    sourceType: input.dispatchContext.sourceType,
  });
  const existingWakeEventId = await findHostedIngressByEventIdTx({
    eventId: activationEventId,
    tx: input.prisma,
    userId: currentMember.core.id,
  });

  if (
    input.skipIfBillingAlreadyActive
    && currentMember.core.billingStatus === HostedBillingStatus.active
  ) {
    if (existingWakeEventId) {
      return {
        activated: false,
        hostedExecutionEventId: existingWakeEventId,
        memberId: currentMember.core.id,
      };
    }
  }

  const entitlement = deriveHostedEntitlement({
    billingStatus: HostedBillingStatus.active,
    suspendedAt: currentMember.core.suspendedAt,
  });

  if (!entitlement.activationReady) {
    return buildHostedInactiveMemberActivationResult(currentMember.core.id);
  }

  if (currentMember.core.billingStatus !== HostedBillingStatus.active) {
    await updateHostedMemberCoreState({
      billingStatus: HostedBillingStatus.active,
      memberId: currentMember.core.id,
      prisma: input.prisma,
    });
  }

  const linqRoute = await resolveHostedMemberActivationWelcomeLinqRoute({
    member: currentMember,
    prisma: input.prisma,
  });
  const activationWake = buildHostedMemberActivationWakeForMember({
    emailLinked: input.emailLinked ?? false,
    member: currentMember,
    occurredAt: input.dispatchContext.occurredAt,
    sourceEventId: input.dispatchContext.sourceEventId,
    sourceType: input.dispatchContext.sourceType,
  });
  const welcomeWake = buildHostedMemberSignupWelcomeNotificationWake({
    activationWake,
    occurredAt: input.dispatchContext.occurredAt,
    route: linqRoute.welcomeRoute,
  });
  const appendedWake = await materializeHostedMemberActivationWakesTx({
    activationWake,
    prisma: input.prisma,
    welcomeWake,
  });

  return {
    activated: true,
    hostedExecutionEventId: appendedWake.eventId,
    memberId: currentMember.core.id,
  };
}

export function buildHostedMemberActivationWelcomeRoute(input: {
  linqChatId: string | null;
  linqRecipientPhone?: string | null;
  memberPhoneNumber?: string | null;
  phoneLookupKey: string | null;
  telegramUserId: string | null;
}): HostedExecutionAssistantNotificationRoute | null {
  return resolveHostedMemberAssistantNotificationRoute({
    linqChatId: input.linqChatId,
    linqRecipientPhone: input.linqRecipientPhone ?? null,
    memberPhoneNumber: input.memberPhoneNumber ?? null,
    messaging: resolveHostedMemberMessagingState({
      identity: {
        phoneLookupKey: input.phoneLookupKey,
      },
      routing: {
        telegramUserId: input.telegramUserId,
      },
    }),
  });
}

async function resolveHostedMemberActivationWelcomeLinqRoute(input: {
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<{ welcomeRoute: HostedExecutionAssistantNotificationRoute | null }> {
  if (!input.member.identity?.phoneNumber) {
    return {
      welcomeRoute: buildHostedMemberActivationWelcomeRoute({
        linqChatId: input.member.routing?.linqChatId ?? null,
        linqRecipientPhone: input.member.routing?.linqRecipientPhone ?? null,
        memberPhoneNumber: input.member.identity?.phoneNumber ?? null,
        phoneLookupKey: input.member.identity?.phoneLookupKey ?? null,
        telegramUserId: input.member.routing?.telegramUserId ?? null,
      }),
    };
  }

  return resolveHostedMemberActivationLinqRoute(input);
}

async function tryActivateHostedMemberIfStillAllowedTx(input: {
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
  revnetIssuanceStatus?: HostedRevnetIssuanceStatus | null;
  revnetRequired?: boolean;
}): Promise<boolean> {
  await lockHostedMemberRow(input.prisma, input.member.core.id);

  const currentMember = await readHostedMemberSnapshot({
    memberId: input.member.core.id,
    prisma: input.prisma,
  });

  if (!currentMember || isHostedAccessBlockedBillingStatus(currentMember.core.billingStatus)) {
    return false;
  }

  const entitlement = deriveHostedEntitlement({
    billingStatus: HostedBillingStatus.active,
    revnetIssuanceStatus: input.revnetIssuanceStatus,
    revnetRequired: input.revnetRequired,
    suspendedAt: currentMember.core.suspendedAt,
  });

  if (!entitlement.activationReady) {
    return false;
  }

  await updateHostedMemberCoreState({
    billingStatus: HostedBillingStatus.active,
    memberId: currentMember.core.id,
    prisma: input.prisma,
  });

  return true;
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
  activationWake: HostedIngressEnvelope;
  prisma: Prisma.TransactionClient;
  welcomeWake: HostedIngressEnvelope | null;
}): Promise<{ eventId: string }> {
  const appendedWake = await materializeHostedIngressEnvelopeTx({
    wake: input.activationWake,
    tx: input.prisma,
  });

  if (input.welcomeWake) {
    await materializeHostedIngressEnvelopeTx({
      wake: input.welcomeWake,
      tx: input.prisma,
    });
  }

  return appendedWake;
}

function buildHostedMemberActivationWakeForMember(input: {
  emailLinked: boolean;
  member: HostedMemberSnapshot;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
}): HostedIngressEnvelope {
  return buildHostedMemberActivationWake({
    emailLinked: input.emailLinked,
    memberId: input.member.core.id,
    memberPhoneNumber: input.member.identity?.phoneNumber ?? null,
    phoneLookupKey: input.member.identity?.phoneLookupKey ?? null,
    telegramUserId: input.member.routing?.telegramUserId ?? null,
    occurredAt: input.occurredAt,
    sourceEventId: input.sourceEventId,
    sourceType: input.sourceType,
  });
}

function buildHostedMemberActivationWake(input: {
  emailLinked?: boolean;
  memberId: string;
  memberPhoneNumber?: string | null;
  phoneLookupKey?: string | null;
  telegramUserId?: string | null;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
}): HostedIngressEnvelope {
  return buildHostedExecutionMemberActivatedWake({
    eventId: buildHostedMemberActivationEventId(input),
    memberChannels: resolveHostedMemberChannels({
      emailLinked: input.emailLinked ?? false,
      identity: {
        phoneLookupKey: input.phoneLookupKey ?? null,
      },
      routing: {
        telegramUserId: input.telegramUserId ?? null,
      },
    }),
    memberId: input.memberId,
    occurredAt: input.occurredAt,
  });
}

function buildHostedMemberSignupWelcomeNotificationWake(input: {
  activationWake: HostedIngressEnvelope;
  occurredAt: string;
  route: HostedExecutionAssistantNotificationRoute | null;
}): HostedIngressEnvelope | null {
  if (!input.route) {
    return null;
  }

  return buildHostedExecutionAssistantNotificationRequestedWake({
    eventId: buildHostedMemberSignupWelcomeNotificationEventId(input.activationWake),
    memberId: input.activationWake.userId,
    notification: {
      deliveryDedupeToken: `signup-welcome:${input.activationWake.userId}`,
      deliveryDispatchMode: "queue-only",
      deliveryIdempotencyKey: `signup-welcome:${input.activationWake.userId}`,
      firstContact: {
        markSeenOnDeliveryAccepted: true,
      },
      instructions: buildHostedMemberSignupWelcomeInstructions(),
      responsePolicy: {
        kind: "require_send_exact_text",
        text: MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
      },
      route: input.route,
    },
    occurredAt: input.occurredAt,
  });
}

function buildHostedMemberSignupWelcomeInstructions(): string {
  return [
    "A new user has completed signup for Murph.",
    "Send exactly this message and nothing else:",
    MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
  ].join("\n\n");
}

function buildHostedMemberSignupWelcomeNotificationEventId(
  activationWake: HostedIngressEnvelope,
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
