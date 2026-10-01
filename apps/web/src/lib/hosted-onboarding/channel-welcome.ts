import type { PrismaClient } from "@prisma/client";
import {
  buildHostedMemberChannelWelcomeDeliveryIdentity,
  buildHostedMemberSignupWelcomeNotificationWake,
} from "@murphai/hosted-execution";
import { unwrapHostedDomainRootForWeb } from "../hosted-crypto/domain-root-store";
import {
  runWithHostedDomainRootProviderCallsDisabled,
  runWithHostedDomainRootUnwrapCache,
} from "../hosted-crypto/domain-root-unwrap-cache";
import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { renderUserFacingMessage } from "../hosted-messages/user-facing-messages";
import { readHostedMemberSnapshot, type HostedMemberSnapshot } from "./hosted-member-store";
import { resolveHostedMemberActivationLinqRoute } from "./linq-home-routing";
import { readActiveHostedMemberAccess } from "./member-access";
import { resolveHostedMemberAssistantNotificationRoute, resolveHostedMemberMessagingState } from "./messaging-state";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS, lockHostedMemberRow, type HostedOnboardingReadClient } from "./shared";

type WelcomeChannel = "email" | "linq";

// Connections share activation's mailbox/outbox key. Runtime chooses the greeting
// from conversation evidence when it executes, including inputs arriving meanwhile.
export async function ensureHostedMemberChannelWelcome(input: {
  channel: WelcomeChannel;
  memberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  const mailboxItemId = await runWithHostedDomainRootUnwrapCache(async () => {
    const member = await readHostedMemberSnapshot(input);
    if (!eligible(member, input.channel) || !await readActiveHostedMemberAccess(input)) return null;
    if (await alreadyQueued(member, input.channel, input.prisma)) return null;

    const writeDomains = input.channel === "linq"
      ? ["control", "ingress"] as const : ["ingress"] as const;
    for (const domain of writeDomains) {
      const root = await unwrapHostedDomainRootForWeb({
        domain, prisma: input.prisma, userId: input.memberId,
      });
      root.rootKey.fill(0);
    }

    return input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      await lockHostedMemberRow(tx, input.memberId);
      const current = await readHostedMemberSnapshot({ memberId: input.memberId, prisma: tx });
      if (!eligible(current, input.channel)
        || !await readActiveHostedMemberAccess({ memberId: input.memberId, prisma: tx })
        || await alreadyQueued(current, input.channel, tx)) return null;

      const route = input.channel === "linq"
        ? (await resolveHostedMemberActivationLinqRoute({ allowNoAssignableLine: true, member: current, prisma: tx })).welcomeRoute
        : currentRoute(current, "email");
      if (!route?.identityId || (route.channel !== "email" && route.channel !== "linq")) return null;
      const deliveryIdentity = buildHostedMemberChannelWelcomeDeliveryIdentity({
        memberId: input.memberId, channel: route.channel, destinationLookupKey: route.identityId,
      });
      const text = renderUserFacingMessage({
        context: {}, key: "assistant.signup_welcome", seed: `signup-welcome:${input.memberId}`,
      }).text;
      const appended = await appendHostedMailboxEnvelopeTx({
        envelope: buildHostedMemberSignupWelcomeNotificationWake({
          deliveryIdentity, memberId: input.memberId, occurredAt: new Date().toISOString(), route, text,
        }),
        tx,
      });
      return appended.item.id;
    }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  });

  if (mailboxItemId) {
    try {
      await signalHostedMailboxAppendRuntime({ expectedUserId: input.memberId, mailboxItemId, prisma: input.prisma });
    } catch {
      // The durable mailbox sweep recovers failed runtime signals.
    }
  }
}

function eligible(member: HostedMemberSnapshot | null, channel: WelcomeChannel): member is HostedMemberSnapshot {
  if (!member || member.core.suspendedAt) return false;
  if (channel === "email") return Boolean(member.emailAuthorization?.verifiedEmail);
  return Boolean(member.identity?.phoneNumber && member.identity.phoneNumberVerifiedAt
    && !member.routing?.linqChatId && !member.routing?.pendingLinqChatId);
}

function currentRoute(member: HostedMemberSnapshot, channel: WelcomeChannel) {
  const email = member.emailAuthorization?.verifiedEmail;
  return resolveHostedMemberAssistantNotificationRoute({
    ...(channel === "linq" ? { channel } : {}),
    emailAddress: email?.address, emailLookupKey: email?.lookupKey,
    linqChatId: null, linqRecipientPhone: channel === "linq" ? member.routing?.linqRecipientPhone : null,
    memberId: member.core.id, memberPhoneNumber: member.identity?.phoneNumber,
    messaging: resolveHostedMemberMessagingState(channel === "email"
      ? { identity: null, routing: null }
      : { identity: member.identity, routing: member.routing }),
  });
}

async function alreadyQueued(member: HostedMemberSnapshot, channel: WelcomeChannel, prisma: HostedOnboardingReadClient) {
  const route = currentRoute(member, channel);
  if (!route?.identityId) return false;
  const key = buildHostedMemberChannelWelcomeDeliveryIdentity({
    memberId: member.core.id, channel, destinationLookupKey: route.identityId,
  });
  return Boolean(await prisma.hostedMailboxItem.findUnique({
    where: { userId_dedupeKey: { userId: member.core.id, dedupeKey: `assistant.notification.requested:${key}` } },
    select: { id: true },
  }));
}
