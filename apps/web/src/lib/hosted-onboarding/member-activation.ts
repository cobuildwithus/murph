import {
  HostedBillingStatus,
  HostedRevnetIssuanceStatus,
  type Prisma,
} from "@prisma/client";
import {
  buildHostedExecutionMemberActivatedWake,
  type HostedExecutionMemberActivatedEvent,
  type HostedExecutionWake,
} from "@murphai/hosted-execution";

import {
  appendHostedExecutionWakeTx,
  findHostedExecutionWakeByEventIdTx,
} from "../hosted-execution/dispatch-lifecycle";
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
  resolveHostedMemberFirstContactTarget,
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

    const linqRoute = await resolveHostedMemberActivationFirstContactLinqRoute({
      member: input.member,
      prisma: input.prisma,
    });
    const wake = buildHostedMemberActivationWakeForMember({
      emailLinked: input.emailLinked ?? false,
      firstContact: linqRoute.firstContact,
      member: input.member,
      occurredAt: input.occurredAt,
      sourceEventId: input.sourceEventId,
      sourceType: input.sourceType,
    });
    const appendedWake = await appendHostedExecutionWakeTx({
      wake,
      sourceId: input.sourceEventId,
      sourceType: "hosted_revnet_issuance",
      tx: input.prisma,
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
  const existingDispatchEventId = await findHostedExecutionWakeByEventIdTx({
    eventId: activationEventId,
    tx: input.prisma,
  });

  if (
    input.skipIfBillingAlreadyActive &&
    currentMember.core.billingStatus === HostedBillingStatus.active
  ) {
    if (existingDispatchEventId) {
      return {
        activated: false,
        hostedExecutionEventId: existingDispatchEventId,
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

  const linqRoute = await resolveHostedMemberActivationFirstContactLinqRoute({
    member: currentMember,
    prisma: input.prisma,
  });
  const wake = buildHostedMemberActivationWakeForMember({
    emailLinked: input.emailLinked ?? false,
    firstContact: linqRoute.firstContact,
    member: currentMember,
    occurredAt: input.dispatchContext.occurredAt,
    sourceEventId: input.dispatchContext.sourceEventId,
    sourceType: input.dispatchContext.sourceType,
  });
  const appendedWake = await appendHostedExecutionWakeTx({
    wake,
    sourceId: `stripe:${input.dispatchContext.sourceEventId}`,
    sourceType: "hosted_stripe_event",
    tx: input.prisma,
  });

  return {
    activated: true,
    hostedExecutionEventId: appendedWake.eventId,
    memberId: currentMember.core.id,
  };
}

export function buildHostedMemberActivationFirstContact(input: {
  linqChatId: string | null;
  linqRecipientPhone?: string | null;
  memberPhoneNumber?: string | null;
  phoneLookupKey: string | null;
  telegramUserId: string | null;
}): HostedExecutionMemberActivatedEvent["firstContact"] {
  return resolveHostedMemberFirstContactTarget({
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

async function resolveHostedMemberActivationFirstContactLinqRoute(input: {
  member: HostedMemberSnapshot;
  prisma: Prisma.TransactionClient;
}): Promise<{ firstContact: HostedExecutionMemberActivatedEvent["firstContact"] }> {
  if (!input.member.identity?.phoneNumber) {
    return {
      firstContact: buildHostedMemberActivationFirstContact({
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

function buildHostedMemberActivationWakeForMember(input: {
  emailLinked: boolean;
  firstContact: HostedExecutionMemberActivatedEvent["firstContact"];
  member: HostedMemberSnapshot;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
}): HostedExecutionWake {
  return buildHostedMemberActivationWake({
    emailLinked: input.emailLinked,
    firstContact: input.firstContact,
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
  firstContact?: HostedExecutionMemberActivatedEvent["firstContact"];
  linqChatId?: string | null;
  linqRecipientPhone?: string | null;
  memberId: string;
  memberPhoneNumber?: string | null;
  phoneLookupKey?: string | null;
  telegramUserId?: string | null;
  occurredAt: string;
  sourceEventId: string;
  sourceType: string;
}): HostedExecutionWake {
  return buildHostedExecutionMemberActivatedWake({
    eventId: buildHostedMemberActivationEventId(input),
    firstContact: (input.firstContact ?? buildHostedMemberActivationFirstContact({
      linqChatId: input.linqChatId ?? null,
      linqRecipientPhone: input.linqRecipientPhone ?? null,
      memberPhoneNumber: input.memberPhoneNumber ?? null,
      phoneLookupKey: input.phoneLookupKey ?? null,
      telegramUserId: input.telegramUserId ?? null,
    })),
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

export function buildHostedMemberActivationEventId(input: {
  memberId: string;
  sourceEventId: string;
  sourceType: string;
}): string {
  return `member.activated:${input.sourceType}:${input.memberId}:${input.sourceEventId}`;
}
