import "server-only";

import type { PrismaClient } from "@prisma/client";

import {
  getHostedLinqChatSummary,
  type HostedLinqChatHandleSummary,
  type HostedLinqChatSummary,
} from "../hosted-onboarding/linq-client";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";
import { normalizeNullableString } from "../primitives";
import { lookupHostedGroupParticipantMemberByHandle } from "./participant-member";
import { HOSTED_PENDING_GROUP_SETUP_MAX_PARTICIPANT_MEMBERS } from "./pending-group-setup";

export const HOSTED_PENDING_GROUP_SETUP_ROSTER_TIMEOUT_MS = 1_500;

export type HostedPendingGroupSetupRosterEvidence =
  | { memberIds: readonly string[]; status: "available" }
  | { memberIds: readonly []; status: "unavailable" };

interface HostedPendingGroupSetupRosterDependencies {
  getChatSummary?: typeof getHostedLinqChatSummary;
  lookupMember?: typeof lookupHostedGroupParticipantMemberByHandle;
}

/**
 * Reads one bounded canonical Linq roster before route admission. Raw handles
 * stay request-local; only resolved member ids cross into the route transaction.
 * Optional roster failure preserves the existing authenticated-sender fallback.
 */
export async function resolveHostedPendingGroupSetupRosterEvidence(input: {
  chatId: string;
  prisma: PrismaClient;
  signal?: AbortSignal;
}, dependencies: HostedPendingGroupSetupRosterDependencies = {}): Promise<HostedPendingGroupSetupRosterEvidence> {
  const chatId = normalizeNullableString(input.chatId);
  if (!chatId) {
    return unavailableRosterEvidence();
  }

  let summary: HostedLinqChatSummary;
  try {
    summary = await (dependencies.getChatSummary ?? getHostedLinqChatSummary)({
      chatId,
      ...(input.signal ? { signal: input.signal } : {}),
      timeoutMs: HOSTED_PENDING_GROUP_SETUP_ROSTER_TIMEOUT_MS,
    });
  } catch (error) {
    if (input.signal?.aborted) {
      throw error;
    }
    return unavailableRosterEvidence();
  }
  if (summary.isGroup !== true) {
    return unavailableRosterEvidence();
  }

  const handles = normalizeHostedPendingGroupSetupRosterHandles(summary.handles);
  if (handles === null) {
    return unavailableRosterEvidence();
  }

  try {
    const lookupMember = dependencies.lookupMember
      ?? lookupHostedGroupParticipantMemberByHandle;
    const lookups = await Promise.all(handles.map((handle) => lookupMember({
      handle,
      prisma: input.prisma as HostedOnboardingReadClient,
    })));
    return {
      memberIds: [...new Set(lookups.flatMap((lookup) =>
        lookup?.core.id ? [lookup.core.id] : []
      ))],
      status: "available",
    };
  } catch (error) {
    if (input.signal?.aborted) {
      throw error;
    }
    return unavailableRosterEvidence();
  }
}

export function normalizeHostedPendingGroupSetupRosterHandles(
  handles: readonly HostedLinqChatHandleSummary[],
): string[] | null {
  const active = [...new Set(handles.flatMap((entry) => {
    const handle = normalizeNullableString(entry.handle);
    const status = normalizeNullableString(entry.status)?.toLowerCase();
    return !handle || entry.isMe || status === "left" || status === "removed"
      ? []
      : [handle];
  }))];
  return active.length <= HOSTED_PENDING_GROUP_SETUP_MAX_PARTICIPANT_MEMBERS
    ? active
    : null;
}

function unavailableRosterEvidence(): HostedPendingGroupSetupRosterEvidence {
  return { memberIds: [], status: "unavailable" };
}
