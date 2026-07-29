import "server-only";

import type {
  HostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution";
import {
  HOSTED_PHONE_CALL_INBOUND_MAILBOX_ITEM_IDS_MAX,
} from "@murphai/hosted-execution/phone-calls";

import {
  resolveHostedGroupMessageSenderMemberId,
} from "../hosted-groups/group-message-sender";
import { readHostedMailboxWakeByItemId } from "../hosted-mailbox/store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { hasHostedMemberActivationProof } from "../hosted-onboarding/member-activation";
import type { HostedOnboardingReadClient } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";

export async function assertHostedGroupPhoneCallRequesterHasOwnMurph(input: {
  inboundMailboxItemIds: readonly string[];
  prisma?: HostedOnboardingReadClient;
  routeAuthority: HostedExecutionExternalThreadRouteAuthority;
  signal?: AbortSignal;
}): Promise<void> {
  const mailboxItemIds = normalizeHostedGroupPhoneCallMailboxItemIds(
    input.inboundMailboxItemIds,
  );
  if (mailboxItemIds.length === 0) {
    throwHostedGroupPhoneCallRequesterProvenanceRequired();
  }

  const prisma = input.prisma ?? getPrisma();
  let requesterMemberId: string | null = null;

  for (const mailboxItemId of mailboxItemIds) {
    input.signal?.throwIfAborted();
    const wake = await readHostedMailboxWakeByItemId({
      mailboxItemId,
      prisma,
    });
    const memberId = wake
      ? await resolveHostedGroupMessageSenderMemberId({
          prisma,
          routeAuthority: input.routeAuthority,
          wake,
        })
      : null;
    if (
      !memberId
      || (requesterMemberId !== null && requesterMemberId !== memberId)
    ) {
      throwHostedGroupPhoneCallRequesterProvenanceRequired();
    }
    requesterMemberId = memberId;
  }

  input.signal?.throwIfAborted();
  if (!requesterMemberId) {
    throwHostedGroupPhoneCallRequesterProvenanceRequired();
  }
  if (
    !await hasHostedMemberActivationProof({
      memberId: requesterMemberId,
      prisma,
    })
  ) {
    throwHostedGroupPhoneCallRequesterActivationRequired();
  }
}

function throwHostedGroupPhoneCallRequesterProvenanceRequired(): never {
  throw hostedOnboardingError({
    code: "HOSTED_GROUP_PHONE_CALL_REQUESTER_PROVENANCE_REQUIRED",
    httpStatus: 403,
    message:
      "Group phone calls require one trusted requesting participant.",
    retryable: false,
  });
}

function normalizeHostedGroupPhoneCallMailboxItemIds(
  values: readonly string[],
): string[] {
  if (
    values.length === 0
    || values.length > HOSTED_PHONE_CALL_INBOUND_MAILBOX_ITEM_IDS_MAX
  ) {
    return [];
  }

  const normalized = new Set<string>();
  for (const value of values) {
    const mailboxItemId = typeof value === "string" ? value.trim() : "";
    if (!mailboxItemId || mailboxItemId.length > 200) {
      return [];
    }
    normalized.add(mailboxItemId);
  }
  return [...normalized];
}

function throwHostedGroupPhoneCallRequesterActivationRequired(): never {
  throw hostedOnboardingError({
    code: "HOSTED_GROUP_PHONE_CALL_REQUESTER_ACTIVATION_REQUIRED",
    httpStatus: 403,
    message:
      "Group phone calls require the requesting participant to have an activated Murph.",
    retryable: false,
  });
}
