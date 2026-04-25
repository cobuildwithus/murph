import {
  HostedBillingStatus,
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
  findHostedIngressByEventId,
  materializeHostedIngressEnvelopeTx,
} from "../hosted-ingress/lifecycle";
import {
  deriveHostedEntitlement,
  isHostedAccessBlockedBillingStatus,
} from "./entitlement";
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
import { lockHostedMemberRow } from "./shared";

export type HostedMemberActivationResult = {
  activated: boolean;
  hostedExecutionEventId: string | null;
  memberId: string;
};

type HostedMemberActivationSnapshot = HostedMemberSnapshot & {
  core: HostedMemberActivationCoreState;
};

export async function activateHostedMemberForPositiveSourceTx(input: {
  dispatchContext: HostedStripeDispatchContext;
  emailLinked?: boolean;
  memberId: string;
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
  memberId: string;
  prisma: Prisma.TransactionClient;
  skipIfBillingAlreadyActive?: boolean;
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
  const existingWakeEventId = await findHostedIngressByEventId({
    eventId: activationEventId,
    tx: input.prisma,
    userId: currentMember.core.id,
  });

  if (
    input.skipIfBillingAlreadyActive
    && currentMember.core.billingStatus === HostedBillingStatus.active
  ) {
    if (existingWakeEventId) {
      if (currentMember.core.pendingActivationTimeZone) {
        await clearHostedMemberPendingActivationTimeZone({
          memberId: currentMember.core.id,
          prisma: input.prisma,
        });
      }

      return {
        activated: false,
        hostedExecutionEventId: existingWakeEventId,
        memberId: currentMember.core.id,
      };
    }
  }

  if (currentMember.core.billingStatus !== HostedBillingStatus.active) {
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

  const linqRoute = await resolveHostedMemberActivationWelcomeLinqRoute({
    member: currentMember,
    prisma: input.prisma,
  });
  const activationWake = buildHostedMemberActivationWakeForMember({
    emailLinked: input.emailLinked ?? resolveHostedMemberActivationEmailLinked(currentMember),
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
  telegramThreadId: string | null;
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
        telegramThreadId: input.telegramThreadId,
        telegramUserId: input.telegramUserId,
      },
    }),
  });
}

async function resolveHostedMemberActivationWelcomeLinqRoute(input: {
  member: HostedMemberActivationSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<{ welcomeRoute: HostedExecutionAssistantNotificationRoute | null }> {
  if (!input.member.identity?.phoneNumber) {
    return {
      welcomeRoute: buildHostedMemberActivationWelcomeRoute({
        linqChatId: input.member.routing?.linqChatId ?? null,
        linqRecipientPhone: input.member.routing?.linqRecipientPhone ?? null,
        memberPhoneNumber: input.member.identity?.phoneNumber ?? null,
        phoneLookupKey: input.member.identity?.phoneLookupKey ?? null,
        telegramThreadId: input.member.routing?.telegramThreadId ?? null,
        telegramUserId: input.member.routing?.telegramUserId ?? null,
      }),
    };
  }

  return resolveHostedMemberActivationLinqRoute(input);
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

  if (!currentMember || isHostedAccessBlockedBillingStatus(currentMember.core.billingStatus)) {
    return null;
  }

  const entitlement = deriveHostedEntitlement({
    billingStatus: HostedBillingStatus.active,
    suspendedAt: currentMember.core.suspendedAt,
  });

  return entitlement.activationReady ? currentMember : null;
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
  member: HostedMemberActivationSnapshot;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
}): HostedIngressEnvelope {
  return buildHostedMemberActivationWake({
    emailLinked: input.emailLinked,
    memberId: input.member.core.id,
    memberPhoneNumber: input.member.identity?.phoneNumber ?? null,
    phoneLookupKey: input.member.identity?.phoneLookupKey ?? null,
    telegramThreadId: input.member.routing?.telegramThreadId ?? null,
    telegramUserId: input.member.routing?.telegramUserId ?? null,
    occurredAt: input.occurredAt,
    sourceEventId: input.sourceEventId,
    sourceType: input.sourceType,
    timeZone: input.member.core.pendingActivationTimeZone,
  });
}

function buildHostedMemberActivationWake(input: {
  emailLinked?: boolean;
  memberId: string;
  memberPhoneNumber?: string | null;
  phoneLookupKey?: string | null;
  telegramThreadId?: string | null;
  telegramUserId?: string | null;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
  timeZone?: string | null;
}): HostedIngressEnvelope {
  return buildHostedExecutionMemberActivatedWake({
    eventId: buildHostedMemberActivationEventId(input),
    memberChannels: resolveHostedMemberChannels({
      emailLinked: input.emailLinked ?? false,
      identity: {
        phoneLookupKey: input.phoneLookupKey ?? null,
      },
      routing: {
        telegramThreadId: input.telegramThreadId ?? null,
        telegramUserId: input.telegramUserId ?? null,
      },
    }),
    memberId: input.memberId,
    occurredAt: input.occurredAt,
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
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
    "Prepare the first in-chat onboarding reply.",
    "Use this user-facing reply only:",
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
