import "server-only";

import type { Prisma } from "@prisma/client";

import {
  bindArmedHostedUsageReferralToNewContainerTx,
} from "../hosted-growth/usage-referral";
import {
  upsertHostedMemberAssistantPreferencesTx,
} from "../hosted-onboarding/member-preferences";
import {
  ensureHostedThreadContainerRouteTx,
  type HostedThreadContainerRouteEnsureResult,
} from "../hosted-routing/thread-container-service";
import { normalizeNullableString } from "../primitives";
import {
  claimHostedPendingGroupSetupForParticipantsTx,
  restoreHostedPendingGroupSetupClaimTx,
  type HostedPendingGroupSetupClaimReason,
  type HostedPendingGroupSetupClaimResult,
  type HostedPendingGroupSetupSnapshot,
} from "./pending-group-setup";

export type HostedPreparedLinqThreadOwnerResolution =
  | "fallback_sender"
  | "pending_only_candidate"
  | "pending_sender_wins_conflict";

export type HostedPreparedLinqThreadContainerResult =
  | {
      kind: "owner_unavailable";
      pendingSetupResolution: Extract<
        HostedPendingGroupSetupClaimResult,
        { kind: "none" }
      >["reason"];
    }
  | {
      ensure: HostedThreadContainerRouteEnsureResult;
      initialRoomContextMarkdown: string | null;
      kind: "ensured";
      ownerMemberId: string;
      ownerResolution: HostedPreparedLinqThreadOwnerResolution;
      pendingSetup: HostedPendingGroupSetupSnapshot | null;
      pendingSetupApplied: boolean;
      pendingSetupResolution: HostedPendingGroupSetupClaimReason;
    };

/**
 * Composes the existing canonical thread-container owner, style preference, and
 * usage-referral primitives around one optional roster-matched setup claim.
 * Provider adapters remain responsible only for proving the current roster and
 * current sender member; this service never accepts raw handles.
 */
export async function ensureHostedPreparedLinqThreadContainerRouteTx(input: {
  accountLookupKey: string;
  accountLookupKeys?: readonly string[];
  fallbackOwnerMemberId?: string | null;
  mailboxDedupeKey: string;
  occurredAt: Date;
  participantMemberIds: readonly string[];
  recipientPhoneLookupKey: string;
  senderMemberId?: string | null;
  threadId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedPreparedLinqThreadContainerResult> {
  const pendingSetupClaim = await claimHostedPendingGroupSetupForParticipantsTx({
    participantMemberIds: input.participantMemberIds,
    recipientPhoneLookupKey: input.recipientPhoneLookupKey,
    senderMemberId: input.senderMemberId,
    tx: input.tx,
  });
  const fallbackOwnerMemberId = normalizeNullableString(
    input.fallbackOwnerMemberId,
  );
  const ownerMemberId = pendingSetupClaim.kind === "claimed"
    ? pendingSetupClaim.setup.ownerMemberId
    : fallbackOwnerMemberId;
  if (!ownerMemberId) {
    if (pendingSetupClaim.kind !== "none") {
      throw new TypeError(
        "Claimed pending group setup must provide an owner member id.",
      );
    }
    return {
      kind: "owner_unavailable",
      pendingSetupResolution: pendingSetupClaim.reason,
    };
  }

  let ensure: HostedThreadContainerRouteEnsureResult;
  try {
    ensure = await ensureHostedThreadContainerRouteTx({
      accountLookupKey: input.accountLookupKey,
      ...(input.accountLookupKeys
        ? { accountLookupKeys: input.accountLookupKeys }
        : {}),
      channel: "linq",
      mailboxDedupeKey: input.mailboxDedupeKey,
      occurredAt: input.occurredAt,
      ownerMemberId,
      prisma: input.tx,
      threadId: input.threadId,
    });
  } catch (error) {
    // Some callers intentionally recover from known route-admission failures
    // inside the surrounding transaction. Restore the one-shot setup before
    // rethrowing so that recovery cannot silently consume an unrelated intent.
    if (pendingSetupClaim.kind === "claimed") {
      await restoreHostedPendingGroupSetupClaimTx({
        claimToken: pendingSetupClaim.claimToken,
        tx: input.tx,
      });
    }
    throw error;
  }

  // This service is intended for the unbound-thread admission path, but a
  // concurrent first message can commit the same route first. Preserve the
  // still-unconsumed "next group" intent when this transaction only converges
  // on that existing route.
  if (!ensure.created && pendingSetupClaim.kind === "claimed") {
    await restoreHostedPendingGroupSetupClaimTx({
      claimToken: pendingSetupClaim.claimToken,
      tx: input.tx,
    });
  }

  const pendingSetupApplied =
    ensure.created && pendingSetupClaim.kind === "claimed";
  if (pendingSetupApplied) {
    const style = pendingSetupClaim.setup.setup.style;
    if (style) {
      await upsertHostedMemberAssistantPreferencesTx({
        memberId: ensure.containerMemberId,
        occurredAt: input.occurredAt.toISOString(),
        preferences: style,
        prisma: input.tx,
      });
    }
  }

  if (ensure.created) {
    await bindArmedHostedUsageReferralToNewContainerTx({
      occurredAt: input.occurredAt,
      ownerMemberId,
      targetContainerMemberId: ensure.containerMemberId,
      tx: input.tx,
    });
  }

  return {
    ensure,
    initialRoomContextMarkdown: pendingSetupApplied
      ? pendingSetupClaim.setup.setup.roomContextMarkdown ?? null
      : null,
    kind: "ensured",
    ownerMemberId,
    ownerResolution: pendingSetupClaim.kind === "claimed"
      ? pendingSetupClaim.reason === "only_candidate"
        ? "pending_only_candidate"
        : "pending_sender_wins_conflict"
      : "fallback_sender",
    pendingSetup: pendingSetupClaim.kind === "claimed"
      ? pendingSetupClaim.setup
      : null,
    pendingSetupApplied,
    pendingSetupResolution: pendingSetupClaim.reason,
  };
}
