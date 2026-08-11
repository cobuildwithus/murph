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
  type PreparedHostedThreadContainerCreation,
  type PreparedHostedThreadContainerDeliveryRoute,
  type HostedThreadContainerRouteEnsureResult,
} from "../hosted-routing/thread-container-service";
import { normalizeNullableString } from "../primitives";
import {
  claimHostedPendingGroupSetupForParticipantsTx,
  consumeHostedPendingGroupSetupClaimTx,
  type HostedPreparedPendingGroupSetupPackage,
  type HostedPendingGroupSetupClaimReason,
  type HostedPendingGroupSetupClaimResult,
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
      kind: "ensured";
      ownerMemberId: string;
      ownerResolution: HostedPreparedLinqThreadOwnerResolution;
      pendingSetupApplied: boolean;
      pendingSetupResolution: HostedPendingGroupSetupClaimReason;
    };

/**
 * Composes the existing canonical thread-container, style preference, room
 * model activation, and usage-referral owners around one optional
 * roster-matched setup claim.
 * Provider adapters remain responsible only for proving the current roster and
 * current sender member; this service never accepts raw handles.
 */
export async function ensureHostedPreparedLinqThreadContainerRouteTx(input: {
  accountLookupKey: string;
  accountLookupKeys?: readonly string[];
  fallbackOwnerMemberId?: string | null;
  linqService: string | null;
  mailboxDedupeKey: string;
  occurredAt: Date;
  participantMemberIds: readonly string[];
  preparedPendingGroupSetup?: HostedPreparedPendingGroupSetupPackage;
  preparedCreation?: PreparedHostedThreadContainerCreation;
  preparedDeliveryRoute?: PreparedHostedThreadContainerDeliveryRoute;
  recoveredRecipientPhoneLookupKey: string;
  incomingRecipientPhoneLookupKeys: readonly string[];
  recipientPhoneLookupKeys: readonly string[];
  requiredPendingSetupCandidateId?: string | null;
  senderMemberId?: string | null;
  threadId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedPreparedLinqThreadContainerResult> {
  const pendingSetupClaim = await claimHostedPendingGroupSetupForParticipantsTx({
    incomingRecipientPhoneLookupKeys: input.incomingRecipientPhoneLookupKeys,
    occurredAt: input.occurredAt,
    participantMemberIds: input.participantMemberIds,
    prepared: input.preparedPendingGroupSetup,
    recipientPhoneLookupKeys: input.recipientPhoneLookupKeys,
    recoveredRecipientPhoneLookupKey:
      input.recoveredRecipientPhoneLookupKey,
    requiredCandidateId: input.requiredPendingSetupCandidateId,
    senderMemberId: input.senderMemberId,
    threadId: input.threadId,
    tx: input.tx,
  });
  const requiredPendingSetupCandidateId = normalizeNullableString(
    input.requiredPendingSetupCandidateId,
  );
  if (
    pendingSetupClaim.kind === "none"
    && (
      pendingSetupClaim.reason === "recipient_line_unmanaged"
      || (
        requiredPendingSetupCandidateId !== null
        && pendingSetupClaim.reason !== "invalid_payload"
      )
    )
  ) {
    return {
      kind: "owner_unavailable",
      pendingSetupResolution: pendingSetupClaim.reason,
    };
  }
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

  const initialGroupRoomModelMarkdown = pendingSetupClaim.kind === "claimed"
    ? buildInitialHostedGroupRoomModelMarkdown(
        pendingSetupClaim.setup.setup.roomContextMarkdown,
      )
    : null;
  const ensure = await ensureHostedThreadContainerRouteTx({
    accountLookupKey: input.accountLookupKey,
    ...(input.accountLookupKeys
      ? { accountLookupKeys: input.accountLookupKeys }
      : {}),
    channel: "linq",
    ...(initialGroupRoomModelMarkdown
      ? { initialGroupRoomModelMarkdown }
      : {}),
    mailboxDedupeKey: input.mailboxDedupeKey,
    occurredAt: input.occurredAt,
    ownerMemberId,
    ...(input.preparedCreation
      ? { preparedCreation: input.preparedCreation }
      : {}),
    ...(input.preparedDeliveryRoute
      ? { preparedDeliveryRoute: input.preparedDeliveryRoute }
      : {}),
    prisma: input.tx,
    threadId: input.threadId,
  });

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
      targetChannel: "linq",
      targetLinqService: input.linqService,
      targetContainerMemberId: ensure.containerMemberId,
      tx: input.tx,
    });
  }
  if (
    pendingSetupApplied
    && !(await consumeHostedPendingGroupSetupClaimTx({
      id: pendingSetupClaim.setup.id,
      ownerMemberId: pendingSetupClaim.setup.ownerMemberId,
      tx: input.tx,
    }))
  ) {
    throw new Error("Locked pending group setup could not be consumed.");
  }

  return {
    ensure,
    kind: "ensured",
    ownerMemberId,
    ownerResolution: pendingSetupClaim.kind === "claimed"
      ? pendingSetupClaim.reason === "only_candidate"
        ? "pending_only_candidate"
        : "pending_sender_wins_conflict"
      : "fallback_sender",
    pendingSetupApplied,
    pendingSetupResolution: pendingSetupClaim.reason,
  };
}

function buildInitialHostedGroupRoomModelMarkdown(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value);
  return normalized ? `## Explicit setup\n\n${normalized}` : null;
}
