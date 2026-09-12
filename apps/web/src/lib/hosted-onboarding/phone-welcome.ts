import type { PrismaClient } from "@prisma/client";
import {
  buildHostedMemberPhoneWelcomeDeliveryIdentity,
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
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS, lockHostedMemberRow } from "./shared";

// Phone connection is another welcome destination, not another activation.
// The existing mailbox, outbox, and provider keys own retries and deduplication.
export async function ensureHostedMemberPhoneWelcome(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  const mailboxItemId = await runWithHostedDomainRootUnwrapCache(async () => {
    const member = await readHostedMemberSnapshot(input);
    if (!needsPhoneWelcome(member) || !await readActiveHostedMemberAccess(input)) {
      return null;
    }

    // Prepare the existing encryption roots before taking routing/member locks.
    const root = await unwrapHostedDomainRootForWeb({
      domain: "ingress",
      prisma: input.prisma,
      userId: input.memberId,
    });
    root.rootKey.fill(0);

    return input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      await lockHostedMemberRow(tx, input.memberId);
      const current = await readHostedMemberSnapshot({ memberId: input.memberId, prisma: tx });
      if (
        !needsPhoneWelcome(current)
        || !await readActiveHostedMemberAccess({ memberId: input.memberId, prisma: tx })
      ) {
        return null;
      }

      const { welcomeRoute } = await resolveHostedMemberActivationLinqRoute({
        allowNoAssignableLine: true,
        member: current,
        prisma: tx,
      });
      if (!welcomeRoute) return null;

      const deliveryIdentity = buildHostedMemberPhoneWelcomeDeliveryIdentity(input.memberId);
      const text = renderUserFacingMessage({
        context: {},
        key: "assistant.signup_welcome",
        seed: `signup-welcome:${input.memberId}`,
      }).text;
      const appended = await appendHostedMailboxEnvelopeTx({
        envelope: buildHostedMemberSignupWelcomeNotificationWake({
          deliveryIdentity,
          memberId: input.memberId,
          occurredAt: new Date().toISOString(),
          route: welcomeRoute,
          text,
        }),
        tx,
      });
      return appended.item.id;
    }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  });

  if (mailboxItemId) {
    try {
      await signalHostedMailboxAppendRuntime({
        expectedUserId: input.memberId,
        mailboxItemId,
        prisma: input.prisma,
      });
    } catch {
      // The durable mailbox sweep owns recovery after a failed wake signal.
    }
  }
}

function needsPhoneWelcome(member: HostedMemberSnapshot | null): member is HostedMemberSnapshot {
  return Boolean(
    member
    && !member.core.suspendedAt
    && member.identity?.phoneNumber
    && member.identity.phoneNumberVerifiedAt
    && !member.routing?.linqChatId
    && !member.routing?.pendingLinqChatId
    && !member.routing?.linqRecipientPhone
  );
}
