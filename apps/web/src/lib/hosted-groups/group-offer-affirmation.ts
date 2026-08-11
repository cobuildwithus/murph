import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import {
  createHostedPostCommitDeadline,
  readHostedPostCommitRemainingMs,
  waitForHostedPostCommitOperation,
} from "../hosted-onboarding/bounded-post-commit";
import { signalHostedRuntimeWakeRuntime } from "../hosted-orchestration/signal-runtime";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import {
  materializePendingHostedGroupJoinConfirmationsBestEffort,
  signalHostedGroupJoinConfirmationRuntimeBestEffort,
} from "./group-join-confirmation";
import { acceptHostedGroupDisclosurePermissionReactionTx } from "./group-disclosure-store";
import { acceptHostedGroupJoinOfferTx } from "./group-store";
import type { HostedGroupOfferChannel } from "./offer-message-binding";

export type HostedGroupOfferAffirmationSkipReason =
  | "disclosure_grant_limit_reached"
  | "launch_consent_missing"
  | "no_offer_match"
  | "not_a_member"
  | "offer_revoked";

export type HostedGroupOfferAffirmationResult =
  | { status: "accepted"; kind: "disclosure" | "join" }
  | { status: "ignored"; reason: HostedGroupOfferAffirmationSkipReason };

/**
 * Which card the affirmation is allowed to satisfy, in attempt order.
 *
 * A Linq like is ambiguous: the same gesture accepts a join offer or a
 * disclosure request, so it tries disclosure first and falls through when the
 * message is not one. A Telegram button names its own card, so it declares the
 * single kind it may accept and can never cross over to the other.
 */
export type HostedGroupOfferAffirmationKind = "disclosure" | "join";

/**
 * The one place a chat affirmation becomes a durable group grant. Provider
 * adapters classify the gesture and resolve the actor; this owns matching the
 * offer, running the existing acceptance transactions, and the post-commit work
 * that must happen identically on every channel.
 */
export async function acceptHostedGroupOfferAffirmation(input: {
  affirmationEventId: string;
  /**
   * Runs the optional post-commit tail (join-confirmation recovery and
   * projection wake) after the caller has already acknowledged the member.
   * Telegram passes this so a tapped button is never held behind work that does
   * not decide whether the grant committed.
   */
  deferPostCommit?: (run: () => Promise<void>) => void;
  /**
   * Revalidates, inside the grant transaction, that the provider identity that
   * tapped still maps to the member being granted. Resolving the binding before
   * the transaction is not enough: a concurrent relink can move that identity to
   * another member while this callback waits on the member-row lock, exactly the
   * race the inbound Telegram message path already guards.
   */
  assertActorStillBound?: (tx: Prisma.TransactionClient) => Promise<void>;
  /**
   * Lets a provider adapter record terminal handling atomically with the grant
   * it owns. Linq uses this for exact provider-event replay protection.
   */
  onAcceptedTx?: (tx: Prisma.TransactionClient) => Promise<void>;
  channel: HostedGroupOfferChannel;
  kinds: readonly HostedGroupOfferAffirmationKind[];
  memberId: string;
  messageLookupKeyReadCandidates: readonly string[];
  now: Date;
  prisma: PrismaClient;
  signal?: AbortSignal;
  threadIdentityLookupKeyReadCandidates: readonly string[];
}): Promise<HostedGroupOfferAffirmationResult> {
  if (input.kinds.includes("disclosure")) {
    let disclosureResult: Awaited<
      ReturnType<typeof acceptHostedGroupDisclosurePermissionReactionTx>
    >;
    try {
      disclosureResult = await input.prisma.$transaction(async (tx) => {
        await input.assertActorStillBound?.(tx);
        const accepted =
          await acceptHostedGroupDisclosurePermissionReactionTx({
            channel: input.channel,
            memberId: input.memberId,
            messageLookupKeyReadCandidates:
              input.messageLookupKeyReadCandidates,
            now: input.now,
            reactionEventId: input.affirmationEventId,
            threadIdentityLookupKeyReadCandidates:
              input.threadIdentityLookupKeyReadCandidates,
            tx,
          });
        if (accepted.kind === "accepted") {
          await input.onAcceptedTx?.(tx);
        }
        return accepted;
      }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
    } catch (error) {
      // Same normalization the join branch uses. Without it an authority
      // change throws out of the webhook, so the tap is never answered and the
      // route never returns its terminal response.
      const reason = readHostedGroupOfferAffirmationSkipReason(error);
      if (!reason) {
        throw error;
      }
      return { status: "ignored", reason };
    }
    if (disclosureResult.kind === "accepted") {
      return { status: "accepted", kind: "disclosure" };
    }
    if (disclosureResult.kind === "not_group_member") {
      return { status: "ignored", reason: "not_a_member" };
    }
    if (disclosureResult.kind === "wrong_thread") {
      return { status: "ignored", reason: "no_offer_match" };
    }
    if (disclosureResult.kind === "limit_reached") {
      return { status: "ignored", reason: "disclosure_grant_limit_reached" };
    }
    if (!input.kinds.includes("join")) {
      return { status: "ignored", reason: "no_offer_match" };
    }
  }
  if (!input.kinds.includes("join")) {
    return { status: "ignored", reason: "no_offer_match" };
  }

  let result: Awaited<ReturnType<typeof acceptHostedGroupJoinOfferTx>>;
  try {
    result = await input.prisma.$transaction(async (tx) => {
      await input.assertActorStillBound?.(tx);
      const accepted = await acceptHostedGroupJoinOfferTx({
        channel: input.channel,
        confirmationPublicBaseUrl: resolveHostedPublicBaseUrl(),
        memberId: input.memberId,
        messageLookupKeyReadCandidates: input.messageLookupKeyReadCandidates,
        now: input.now,
        threadIdentityLookupKeyReadCandidates:
          input.threadIdentityLookupKeyReadCandidates,
        tx,
      });
      await input.onAcceptedTx?.(tx);
      return accepted;
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  } catch (error) {
    const reason = readHostedGroupOfferAffirmationSkipReason(error);
    if (!reason) {
      throw error;
    }
    return { status: "ignored", reason };
  }

  const runPostCommitTail = async (): Promise<void> => {
    const postCommitDeadlineMs = createHostedPostCommitDeadline(undefined);
    const projectionWake = result.grantedVaultShareProjectionKinds.length > 0
      ? runHostedGroupOfferAffirmationPostCommitBestEffort({
          deadlineMs: postCommitDeadlineMs,
          operation: (abortSignal) =>
            signalHostedRuntimeWakeRuntime({
              abortSignal,
              userId: input.memberId,
            }),
          signal: input.signal,
        })
      : null;
    if (result.joinConfirmationSignal) {
      await signalHostedGroupJoinConfirmationRuntimeBestEffort({
        ...result.joinConfirmationSignal,
        prisma: input.prisma,
        ...(input.signal ? { signal: input.signal } : {}),
        timeoutMs: readHostedPostCommitRemainingMs(postCommitDeadlineMs),
      });
    }
    await materializePendingHostedGroupJoinConfirmationsBestEffort({
      memberId: input.memberId,
      membershipId: result.membershipId,
      prisma: input.prisma,
      ...(input.signal ? { signal: input.signal } : {}),
      timeoutMs: readHostedPostCommitRemainingMs(postCommitDeadlineMs),
    });
    await projectionWake;
  };

  if (input.deferPostCommit) {
    input.deferPostCommit(runPostCommitTail);
  } else {
    await runPostCommitTail();
  }
  return { status: "accepted", kind: "join" };
}

async function runHostedGroupOfferAffirmationPostCommitBestEffort(input: {
  deadlineMs: number;
  operation: (signal: AbortSignal) => Promise<unknown>;
  signal?: AbortSignal;
}): Promise<void> {
  try {
    await waitForHostedPostCommitOperation({
      deadlineMs: input.deadlineMs,
      operation: input.operation,
      signal: input.signal,
    });
  } catch {
    // The durable join, grants, and mailbox items remain available for a later wake.
  }
}

function readHostedGroupOfferAffirmationSkipReason(
  error: unknown,
): HostedGroupOfferAffirmationSkipReason | null {
  if (!isHostedOnboardingError(error)) {
    return null;
  }
  if (error.code === "HOSTED_CONSENT_REQUIRED") {
    return "launch_consent_missing";
  }
  if (error.code === "HOSTED_GROUP_JOIN_OFFER_REVOKED") {
    return "offer_revoked";
  }
  if (
    error.code === "HOSTED_GROUP_JOIN_OFFER_NOT_FOUND"
    || error.code === "HOSTED_GROUP_NOT_ACTIVE"
    || error.code === "HOSTED_GROUP_RUNTIME_UNSUPPORTED"
  ) {
    return "no_offer_match";
  }
  return null;
}
