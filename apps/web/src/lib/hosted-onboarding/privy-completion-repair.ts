import "server-only";

import { HostedBillingStatus } from "@prisma/client";

import { completeHostedPrivyVerification } from "./authentication-service";
import { readHostedMemberOwnsSubscription } from "./hosted-member-billing-store";
import { syncHostedMemberTelegramRoutingBinding } from "./hosted-member-routing-store";
import { deriveHostedPostVerificationStage } from "./lifecycle";

export type HostedPrivyVerificationCompleter = typeof completeHostedPrivyVerification;

export type HostedPrivyCompletionRepairDependencies = {
  readHostedMemberOwnsSubscription: typeof readHostedMemberOwnsSubscription;
  syncHostedMemberTelegramRoutingBinding: typeof syncHostedMemberTelegramRoutingBinding;
};

const defaultDependencies: HostedPrivyCompletionRepairDependencies = {
  readHostedMemberOwnsSubscription,
  syncHostedMemberTelegramRoutingBinding,
};

/**
 * Keeps completion strict at the two seams where the base flow deliberately
 * loses information: best-effort secondary Telegram binding and ambiguous
 * `incomplete` billing. It composes around the existing completion transaction
 * instead of growing another onboarding state machine.
 */
export function withHostedPrivyCompletionRepairs(
  complete: HostedPrivyVerificationCompleter,
  dependencies: HostedPrivyCompletionRepairDependencies = defaultDependencies,
): HostedPrivyVerificationCompleter {
  return async (input) => {
    const result = await complete(input);
    const telegramUserId = input.identity.telegram?.telegramUserId ?? null;

    // Phone/email may be the chosen auth method while Telegram is another
    // verified Privy identity. The base service syncs that identity best effort;
    // repeat the idempotent write here so a real cross-account conflict reaches
    // the user as the existing explicit 409 instead of becoming future silence.
    if (telegramUserId && input.authMethod !== "telegram") {
      await dependencies.syncHostedMemberTelegramRoutingBinding({
        memberId: result.memberId,
        ...(input.prisma ? { prisma: input.prisma } : {}),
        telegramUserId,
      });
    }

    if (
      result.stage !== "checkout"
      || result.member.billingStatus !== HostedBillingStatus.incomplete
      || !await dependencies.readHostedMemberOwnsSubscription({
        billingStatus: result.member.billingStatus,
        memberId: result.memberId,
        ...(input.prisma ? { prisma: input.prisma } : {}),
      })
    ) {
      return result;
    }

    return {
      ...result,
      stage: deriveHostedPostVerificationStage({
        activationPending: false,
        billingStatus: result.member.billingStatus,
        hasExistingSubscription: true,
        sponsoredAccessActive: false,
        suspendedAt: result.member.suspendedAt,
      }),
    };
  };
}

export const completeHostedPrivyVerificationWithRepairs =
  withHostedPrivyCompletionRepairs(completeHostedPrivyVerification);
