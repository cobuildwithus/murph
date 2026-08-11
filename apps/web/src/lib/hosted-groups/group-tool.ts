import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  HostedExecutionAcceptedGroupMessageParticipant,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_RUNTIME_GROUP_CHAT_ICON_URL_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
  HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_JOIN_OFFER_LEGACY_MESSAGE_TEMPLATE,
  hostedRuntimeLinqProviderErrorMessageForCode,
  isHostedRuntimePrivateImageDeliveryUrl,
  type HostedRuntimeGroupChatParticipant,
  type HostedRuntimeGroupParticipantDisplayName,
  type HostedRuntimeGroupCreateJoinLinkRequest,
  type HostedRuntimeGroupPostJoinOfferRequest,
  type HostedRuntimeGroupToolAction,
  type HostedRuntimeGroupToolLinqThreadContext,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeGroupToolResponse,
  type HostedRuntimeGroupSummary,
  type HostedRuntimeGroupToolSelfOptOutContext,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedVaultShareProjectionKind,
  HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";
import {
  buildHostedVaultShareProjectionScopeKey,
  getHostedVaultShareDailyMetricProjectionSpec,
} from "@murphai/hosted-execution/vault-share";

import {
  readHostedExecutionControlOrigin,
} from "../hosted-execution/environment";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import {
  assertHostedMemberNotSuspended,
} from "../hosted-onboarding/entitlement";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import {
  hasHostedMemberActivationProof,
  readHostedMemberActivationProofMemberIds,
} from "../hosted-onboarding/member-activation";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import {
  getHostedLinqChatHandles,
  getHostedLinqChatSummary,
  type HostedLinqChatHandleSummary,
  sendHostedLinqChatMessage,
  sendHostedLinqReactionBoundChatMessage,
  updateHostedLinqChatAvatar,
  updateHostedLinqChatDisplayName,
} from "../hosted-onboarding/linq-client";
import {
  resolveHostedLinqPersonalizedContactCardDeadlines,
  shareMurphHostedLinqContactCardVcfToChat,
} from "../hosted-onboarding/linq-contact-card-share";
import { createHostedLinqParticipantContactLookupKey } from "../hosted-onboarding/linq-participant-contact";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  sanitizeHostedOnboardingStructuredLogDetails,
  startHostedOnboardingTiming,
  toHostedOnboardingLogIdSuffix,
} from "../hosted-onboarding/logging";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  type HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";
import { getHostedTelegramGroupTitle } from "../hosted-onboarding/telegram-client";
import {
  HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES,
  HOSTED_ADDRESS_BOOK_LOOKUP_TIMEOUT_MS,
  readHostedOwnerAddressBookAdvisoryNames,
  type HostedOwnerAddressBookAdvisoryNamesResult,
} from "../hosted-address-book/projection";
import { signalHostedRuntimeMaintenanceRuntime } from "../hosted-orchestration/signal-runtime";
import {
  resolveHostedAssistantNotificationDestination,
} from "../hosted-routing/assistant-notification-destination";
import { assertHostedLinqRouteEgressAuthority } from "../hosted-routing/thread-route-store";
import {
  assertHostedLinqRecentInboundEngagementForRuntime,
} from "../hosted-onboarding/linq-egress-engagement";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import { handleHostedUsageReferralGroupTool } from "../hosted-growth/usage-referral";
import { issueHostedSignupReferralLink } from "../hosted-growth/signup-referral";
import { getPrisma } from "../prisma";
import { buildHostedGroupJoinUrl } from "./group-links";
import {
  requestHostedGroupAssistantAsk,
  requestHostedGroupMemberAssistantAsk,
} from "./group-assistant-ask";
import {
  requestHostedGroupCurrentSenderAssistantAsk,
  requestHostedGroupCurrentSenderPrivateAssistantAsk,
} from "./group-current-sender-assistant-ask";
import {
  admitHostedGroupDisclosurePermissionAppendTx,
  canonicalizeHostedGroupDisclosurePermissionText,
  createHostedGroupDisclosurePermissionProviderIdempotencyKey,
  readActiveHostedGroupDisclosureGrantsForGroup,
  readActiveHostedGroupDisclosureGrantsForMember,
  recordHostedGroupDisclosurePermissionTx,
  revokeHostedGroupDisclosureGrantForMemberTx,
} from "./group-disclosure-store";
import {
  buildHostedGroupUsageFundingLocatorForRuntimeMember,
  buildHostedGroupUsageFundingUrl,
  readHostedGroupFundingRecoveryStatus,
} from "./group-usage-funding";
import {
  enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort,
} from "./group-newsletter";
import {
  createHostedGroupJoinLinkForOwnedThreadContainerTx,
  leaveHostedGroupMemberTx,
  prepareHostedGroupJoinOfferPostTx,
  readHostedGroupByRuntimeMemberId,
  readHostedGroupIdByRuntimeMemberId,
  readHostedGroupMembershipsForMember,
  readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId,
  readHostedGroupSharedDataByRuntimeMemberId,
  recordHostedGroupJoinOfferTx,
  revokeHostedGroupMemberEmailShareTx,
  type HostedGroupSummary,
  updateHostedGroupDisplayNameByRuntimeMemberIdTx,
} from "./group-store";
import {
  normalizeHostedVaultShareProjectionScopes,
  projectHostedVaultShareProjectionDisplays,
  resolveHostedGroupAccessOfferProjectionScopes,
} from "./join-policy";
import { sha256Hex } from "../primitives";
import {
  lookupHostedGroupParticipantMemberByHandle,
  lookupHostedGroupParticipantMemberByProviderEvidence,
  lookupHostedGroupParticipantMemberIdsByHandles,
} from "./participant-member";
import {
  armHostedPendingGroupSetupTx,
  cancelHostedPendingGroupSetupTx,
  readHostedPendingGroupSetup,
} from "./pending-group-setup";

export const HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX =
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX;

const HOSTED_GROUP_JOIN_OFFER_IDEMPOTENCY_PREFIX = "group-join-offer:v3:";
const HOSTED_GROUP_JOIN_OFFER_IDEMPOTENCY_DIGEST_LENGTH = 40;

export function buildHostedGroupJoinOfferProviderIdempotencyKey(input: {
  groupId: string;
  joinCode: string;
  offerGeneration: string;
  projectionScopes: readonly HostedVaultShareProjectionScope[];
}): string {
  const projectionScopes = normalizeHostedVaultShareProjectionScopes(
    input.projectionScopes,
  );
  const projectionScopeKeys = projectionScopes.map(
    buildHostedVaultShareProjectionScopeKey,
  );
  if (projectionScopeKeys.length !== input.projectionScopes.length) {
    throw new TypeError("Hosted group join-offer idempotency input is invalid.");
  }
  const digest = sha256Hex(JSON.stringify({
    groupId: input.groupId,
    joinCode: input.joinCode,
    offerGeneration: input.offerGeneration,
    projectionScopeKeys,
  }));
  return `${HOSTED_GROUP_JOIN_OFFER_IDEMPOTENCY_PREFIX}${digest.slice(
    0,
    HOSTED_GROUP_JOIN_OFFER_IDEMPOTENCY_DIGEST_LENGTH,
  )}`;
}

export type HostedRuntimeGroupToolAccessClassification =
  | "owner_active"
  | "personal_active"
  | "participant_aware";

export const HOSTED_RUNTIME_GROUP_TOOL_ACCESS_CLASSIFICATION = {
  ask: "personal_active",
  ask_current_sender: "participant_aware",
  message_current_sender: "participant_aware",
  ask_member: "participant_aware",
  arm_usage_referral: "participant_aware",
  cancel_usage_referral: "participant_aware",
  cancel_next_group: "personal_active",
  create_signup_referral_link: "participant_aware",
  create_join_link: "owner_active",
  leave_membership: "participant_aware",
  list_memberships: "personal_active",
  post_disclosure_request: "owner_active",
  post_join_offer: "owner_active",
  prepare_next_group: "personal_active",
  preflight_set_chat_avatar: "owner_active",
  read_chat_name: "participant_aware",
  read_chat_participants: "participant_aware",
  read_current: "participant_aware",
  read_next_group: "personal_active",
  read_participant_display_names: "participant_aware",
  revoke_disclosure_grant: "personal_active",
  read_usage: "participant_aware",
  read_usage_referral: "participant_aware",
  read_shared: "participant_aware",
  revoke_own_email_share: "participant_aware",
  set_chat_avatar: "owner_active",
  share_contact_card: "owner_active",
  update_display_name: "owner_active",
} as const satisfies Record<
  HostedRuntimeGroupToolAction,
  HostedRuntimeGroupToolAccessClassification
>;

export async function handleHostedRuntimeGroupTool(input: {
  memberId: string;
  request: HostedRuntimeGroupToolRequest;
  /**
   * When the web-control request arrived, owned by the route so body reading,
   * signature verification, and nonce consumption are charged to the same
   * budget as the work below. Direct unit callers may omit it.
   */
  requestStartedAtMs?: number;
  scheduleMailboxWake?: (input: {
    expectedUserId: string;
    mailboxItemId: string;
  }) => Promise<void>;
}): Promise<HostedRuntimeGroupToolResponse> {
  if (input.request.action === "ask") {
    const admission = await requestHostedGroupAssistantAsk({
      groupLabel: input.request.groupLabel,
      memberId: input.memberId,
      originAssistantInputId: input.request.originAssistantInputId,
      originSessionId: input.request.originSessionId,
      question: input.request.question,
    });
    if (admission.mailboxWake) {
      await input.scheduleMailboxWake?.(admission.mailboxWake);
    }
    return { action: "ask", result: admission.result };
  }

  if (input.request.action === "ask_current_sender") {
    const admission = await requestHostedGroupCurrentSenderAssistantAsk({
      groupRuntimeMemberId: input.memberId,
      origin: input.request.origin,
    });
    if (admission.mailboxWake) {
      await input.scheduleMailboxWake?.(admission.mailboxWake);
    }
    return { action: "ask_current_sender", result: admission.result };
  }

  if (input.request.action === "message_current_sender") {
    const admission = await requestHostedGroupCurrentSenderPrivateAssistantAsk({
      groupRuntimeMemberId: input.memberId,
      origin: input.request.origin,
    });
    if (admission.mailboxWake) {
      await input.scheduleMailboxWake?.(admission.mailboxWake);
    }
    return { action: "message_current_sender", result: admission.result };
  }

  if (input.request.action === "ask_member") {
    const admission = await requestHostedGroupMemberAssistantAsk({
      grantId: input.request.grantId,
      memberId: input.memberId,
      origin: input.request.origin,
      question: input.request.question,
    });
    if (admission.mailboxWake) {
      await input.scheduleMailboxWake?.(admission.mailboxWake);
    }
    return { action: "ask_member", result: admission.result };
  }

  if (input.request.action === "post_disclosure_request") {
    return handleHostedRuntimeGroupPostDisclosureRequest({
      linqThread: input.request.linqThread ?? null,
      memberId: input.memberId,
      originAssistantInputId: input.request.originAssistantInputId,
      permissionText: input.request.permissionText,
    });
  }

  if (input.request.action === "revoke_disclosure_grant") {
    return handleHostedRuntimeGroupRevokeDisclosureGrant({
      grantId: input.request.grantId,
      memberId: input.memberId,
    });
  }

  if (input.request.action === "list_memberships") {
    return handleHostedRuntimeGroupListMemberships({ memberId: input.memberId });
  }

  if (input.request.action === "leave_membership") {
    return handleHostedRuntimeGroupLeaveMembership({
      memberId: input.memberId,
      membershipId: input.request.membershipId,
    });
  }

  if (input.request.action === "create_signup_referral_link") {
    return handleHostedRuntimeCreateSignupReferralLink({
      memberId: input.memberId,
      participant: input.request.participant ?? null,
    });
  }

  if (input.request.action === "create_join_link") {
    return handleHostedRuntimeGroupCreateJoinLink({
      joinLink: input.request.joinLink ?? null,
      memberId: input.memberId,
    });
  }

  if (input.request.action === "update_display_name") {
    return handleHostedRuntimeGroupUpdateDisplayName({
      linqThread: input.request.linqThread ?? null,
      memberId: input.memberId,
      updateDisplayName: input.request.updateDisplayName,
    });
  }

  if (
    input.request.action === "prepare_next_group"
    || input.request.action === "read_next_group"
    || input.request.action === "cancel_next_group"
  ) {
    return handleHostedRuntimePendingGroupSetup({
      memberId: input.memberId,
      request: input.request,
    });
  }

  if (input.request.action === "read_chat_name") {
    return handleHostedRuntimeGroupReadChatName({
      memberId: input.memberId,
    });
  }

  if (input.request.action === "read_chat_participants") {
    return handleHostedRuntimeGroupReadChatParticipants({
      linqThread: input.request.linqThread ?? null,
      memberId: input.memberId,
    });
  }

  if (input.request.action === "post_join_offer") {
    return handleHostedRuntimeGroupPostJoinOffer({
      joinOffer: input.request.joinOffer ?? null,
      linqThread: input.request.linqThread ?? null,
      memberId: input.memberId,
    });
  }

  if (input.request.action === "set_chat_avatar") {
    return handleHostedRuntimeGroupSetChatAvatar({
      groupChatIconUrl: input.request.groupChatIconUrl,
      linqThread: input.request.linqThread ?? null,
      memberId: input.memberId,
    });
  }

  if (input.request.action === "preflight_set_chat_avatar") {
    return handleHostedRuntimeGroupSetChatAvatarPreflight({
      linqThread: input.request.linqThread ?? null,
      memberId: input.memberId,
    });
  }

  if (input.request.action === "share_contact_card") {
    if (input.request.contactCardImageUrl !== undefined) {
      if (!input.request.directLinqChatId) {
        return {
          action: "share_contact_card",
          result: {
            status: "unavailable",
            unavailableReason: "direct_attachment_route_unavailable",
          },
        };
      }
      return handleHostedRuntimeGroupShareContactCard({
        kind: "personalized",
        contactCardImageUrl: input.request.contactCardImageUrl,
        contactCardShareKey: input.request.contactCardShareKey,
        directLinqChatId: input.request.directLinqChatId,
        memberId: input.memberId,
        ...(input.requestStartedAtMs === undefined
          ? {}
          : { requestStartedAtMs: input.requestStartedAtMs }),
      });
    }
    return handleHostedRuntimeGroupShareContactCard({
      kind: "canonical",
      linqThread: input.request.linqThread ?? null,
      memberId: input.memberId,
    });
  }

  if (input.request.action === "revoke_own_email_share") {
    return handleHostedRuntimeGroupRevokeOwnEmailShare({
      memberId: input.memberId,
      participant: input.request.participant ?? null,
      selfOptOut: input.request.selfOptOut ?? null,
    });
  }

  if (input.request.action === "read_participant_display_names") {
    return handleHostedRuntimeGroupReadParticipantDisplayNames({
      linqSenderHandles: input.request.linqSenderHandles,
      memberId: input.memberId,
    });
  }

  if (input.request.action === "read_shared") {
    try {
      return {
        action: "read_shared",
        result: await readHostedGroupSharedDataByRuntimeMemberId({
          linqSenderHandles: input.request.linqSenderHandles ?? [],
          projectionScopes: input.request.projectionScopes,
          telegramSenderHandles: input.request.telegramSenderHandles ?? [],
          runtimeMemberId: input.memberId,
        }),
      };
    } catch {
      return {
        action: "read_shared",
        result: {
          status: "unavailable",
          unavailableReason: "shared_data_unavailable",
        },
      };
    }
  }

  if (input.request.action === "read_usage") {
    const usage = await readHostedGroupFundingRecoveryStatus({
      runtimeMemberId: input.memberId,
    });
    return {
      action: "read_usage",
      result: usage
        ? {
            status: "ok",
            usage: {
              fundingNeeded: usage.fundingNeeded,
              fundingUrl: usage.fundingUrl,
              includedUsageUsedPercent: usage.includedUsageUsedPercent,
            },
          }
        : {
            status: "unavailable",
            unavailableReason: "group_usage_unavailable",
            usage: null,
          },
    };
  }

  if (
    input.request.action === "arm_usage_referral"
    || input.request.action === "cancel_usage_referral"
    || input.request.action === "read_usage_referral"
  ) {
    return handleHostedUsageReferralGroupTool({
      memberId: input.memberId,
      request: input.request,
    });
  }

  if (!await hasHostedRuntimeActiveAccess(input.memberId)) {
    return {
      action: "read_current",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "runtime_inactive",
      },
    };
  }

  const group = await readHostedGroupByRuntimeMemberId({
    runtimeMemberId: input.memberId,
  });
  const disclosureGrants = group
    ? await readActiveHostedGroupDisclosureGrantsForGroup({
        groupId: group.id,
      })
    : [];

  return {
    action: "read_current",
    result: group
      ? {
          status: "ok",
          group: toHostedRuntimeGroupSummary(group, disclosureGrants),
        }
      : { status: "none", group: null },
  };
}

async function handleHostedRuntimePendingGroupSetup(input: {
  memberId: string;
  request: Extract<
    HostedRuntimeGroupToolRequest,
    {
      action:
        | "cancel_next_group"
        | "prepare_next_group"
        | "read_next_group";
    }
  >;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: input.request.action,
    result: { status: "unavailable", unavailableReason },
  });

  try {
    const access = await readHostedRuntimePersonalActiveAccess(input.memberId);
    if (access.status !== "ok") {
      return unavailable(access.unavailableReason);
    }
    const prisma = access.prisma;

    if (input.request.action === "read_next_group") {
      const setup = await readHostedPendingGroupSetup({
        ownerMemberId: input.memberId,
        prisma,
      });
      return {
        action: input.request.action,
        result: setup
          ? {
              expiresAt: setup.expiresAt.toISOString(),
              setup: setup.setup,
              status: "prepared",
            }
          : { status: "none" },
      };
    }

    if (input.request.action === "cancel_next_group") {
      const canceled = await prisma.$transaction(
        (tx) => cancelHostedPendingGroupSetupTx({
          ownerMemberId: input.memberId,
          tx,
        }),
        HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
      );
      return {
        action: input.request.action,
        result: { status: canceled ? "canceled" : "none" },
      };
    }

    if (input.request.action !== "prepare_next_group") {
      throw new TypeError("Unsupported pending group setup action.");
    }
    const prepareRequest = input.request;
    const setup = await prisma.$transaction(
      (tx) => armHostedPendingGroupSetupTx({
        ownerMemberId: input.memberId,
        setup: prepareRequest.setup ?? {},
        tx,
      }),
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    );
    return {
      action: input.request.action,
      result: {
        expiresAt: setup.expiresAt.toISOString(),
        setup: setup.setup,
        status: "prepared",
      },
    };
  } catch {
    return unavailable("next_group_preparation_unavailable");
  }
}

async function handleHostedRuntimeCreateSignupReferralLink(input: {
  memberId: string;
  participant: HostedExecutionAcceptedGroupMessageParticipant | null;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "create_signup_referral_link",
    result: {
      status: "unavailable",
      unavailableReason,
    },
  });
  const prisma = getPrisma();
  const threadContainer = await prisma.hostedThreadContainer.findUnique({
    select: {
      memberId: true,
    },
    where: {
      memberId: input.memberId,
    },
  });
  let referrerMemberId = input.memberId;

  if (threadContainer) {
    if (!input.participant) {
      return unavailable("requesting_participant_required");
    }
    const participantMember =
      await lookupHostedGroupParticipantMemberByProviderEvidence({
        participant: input.participant,
        prisma,
      });
    if (
      !participantMember
      || !await hasHostedMemberActivationProof({
        memberId: participantMember.core.id,
        prisma,
      })
    ) {
      return unavailable("requesting_participant_unavailable");
    }
    referrerMemberId = participantMember.core.id;
  } else if (input.participant) {
    return unavailable("participant_context_invalid");
  }

  try {
    const link = await issueHostedSignupReferralLink({
      referrerMemberId,
    });
    return {
      action: "create_signup_referral_link",
      result: {
        expiresAt: link.expiresAt.toISOString(),
        signupUrl: link.signupUrl,
        status: "ok",
      },
    };
  } catch (error) {
    if (isHostedOnboardingError(error)) {
      return unavailable("signup_referral_link_unavailable");
    }
    throw error;
  }
}

async function handleHostedRuntimeGroupLeaveMembership(input: {
  memberId: string;
  membershipId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "leave_membership",
    result: { status: "unavailable", unavailableReason },
  });

  const membershipId = input.membershipId.trim();
  if (!membershipId) {
    return unavailable("membership_unavailable");
  }

  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => leaveHostedGroupMemberTx({
    memberId: input.memberId,
    membershipId,
    now: new Date(),
    tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  if (result.kind === "group_not_found") {
    return unavailable(result.kind);
  }
  if (result.kind !== "left") {
    return {
      action: "leave_membership",
      result: { status: result.kind },
    };
  }

  return {
    action: "leave_membership",
    result: { status: "left" },
  };
}

async function handleHostedRuntimeGroupListMemberships(input: {
  memberId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const access = await readHostedRuntimePersonalActiveAccess(input.memberId);
  if (access.status !== "ok") {
    return {
      action: "list_memberships",
      result: {
        memberships: null,
        status: "unavailable",
        unavailableReason: access.unavailableReason,
      },
    };
  }

  const { memberships, truncated } = await readHostedGroupMembershipsForMember({
    memberId: input.memberId,
    prisma: access.prisma,
  });
  let grants: Awaited<ReturnType<typeof readActiveHostedGroupDisclosureGrantsForMember>>;
  try {
    grants = await readActiveHostedGroupDisclosureGrantsForMember({
      memberId: input.memberId,
      prisma: access.prisma,
    });
  } catch {
    return {
      action: "list_memberships",
      result: {
        memberships: null,
        status: "unavailable",
        unavailableReason: "grants_unavailable",
      },
    };
  }
  const publicBaseUrl = resolveHostedPublicBaseUrl();
  return {
    action: "list_memberships",
    result: {
      disclosureGrants: grants.map(({ grantId, groupLabel, permissionText }) => ({
        grantId,
        groupLabel,
        permissionText,
      })),
      memberships: memberships.map(({
        ownerJoinCode,
        runtimeMemberId,
        ...membership
      }) => ({
        ...membership,
        permissionsUrl: ownerJoinCode
          ? buildHostedGroupJoinUrl({ joinCode: ownerJoinCode, publicBaseUrl })
          : null,
        sponsorshipUrl: buildMembershipSponsorshipUrl({
          publicBaseUrl,
          runtimeMemberId,
        }),
      })),
      status: "ok",
      truncated,
    },
  };
}

function buildMembershipSponsorshipUrl(input: {
  publicBaseUrl: string | null;
  runtimeMemberId: string | null;
}): string | null {
  if (!input.runtimeMemberId) {
    return null;
  }
  const locator = buildHostedGroupUsageFundingLocatorForRuntimeMember(
    input.runtimeMemberId,
  );
  return locator
    ? buildHostedGroupUsageFundingUrl({
        joinCode: locator,
        publicBaseUrl: input.publicBaseUrl,
      })
    : null;
}

async function handleHostedRuntimeGroupRevokeDisclosureGrant(input: {
  grantId: string;
  memberId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "revoke_disclosure_grant",
    result: { status: "unavailable", unavailableReason },
  });
  const access = await readHostedRuntimePersonalActiveAccess(input.memberId);
  if (access.status !== "ok") {
    return unavailable(access.unavailableReason);
  }

  const grantId = input.grantId.trim();
  if (!grantId) {
    return unavailable("grant_unavailable");
  }
  let result: Awaited<ReturnType<typeof revokeHostedGroupDisclosureGrantForMemberTx>>;
  try {
    result = await access.prisma.$transaction(async (tx) =>
      revokeHostedGroupDisclosureGrantForMemberTx({
        grantId,
        memberId: input.memberId,
        now: new Date(),
        tx,
      }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  } catch {
    return unavailable("grant_unavailable");
  }

  if (result.kind === "not_found") {
    return unavailable("grant_unavailable");
  }
  return {
    action: "revoke_disclosure_grant",
    result: { status: result.kind },
  };
}

type HostedRuntimePersonalActiveAccess =
  | { status: "ok"; prisma: PrismaClient }
  | { status: "unavailable"; unavailableReason: string };

async function readHostedRuntimePersonalActiveAccess(
  memberId: string,
): Promise<HostedRuntimePersonalActiveAccess> {
  const prisma = getPrisma();
  if (!await hasHostedRuntimeActiveAccess(memberId, { prisma })) {
    return { status: "unavailable", unavailableReason: "runtime_inactive" };
  }
  const threadContainer = await prisma.hostedThreadContainer.findUnique({
    where: { memberId },
    select: { memberId: true },
  });
  return threadContainer
    ? { status: "unavailable", unavailableReason: "personal_runtime_required" }
    : { status: "ok", prisma };
}

function toHostedRuntimeGroupSummary(
  group: HostedGroupSummary,
  disclosureGrants: Awaited<
    ReturnType<typeof readActiveHostedGroupDisclosureGrantsForGroup>
  >,
): HostedRuntimeGroupSummary {
  const disclosureGrantsByMemberId = new Map<
    string,
    typeof disclosureGrants
  >();
  for (const grant of disclosureGrants) {
    disclosureGrantsByMemberId.set(
      grant.memberId,
      [...(disclosureGrantsByMemberId.get(grant.memberId) ?? []), grant],
    );
  }

  return {
    ...group,
    members: group.members.map((member) => ({
      ...member,
      disclosureGrants: (
        disclosureGrantsByMemberId.get(member.memberId) ?? []
      ).map((grant) => ({
        grantId: grant.grantId,
        permissionText: grant.permissionText,
      })),
    })),
  };
}

async function handleHostedRuntimeGroupUpdateDisplayName(input: {
  linqThread: HostedRuntimeGroupToolLinqThreadContext | null;
  memberId: string;
  updateDisplayName: { displayName: string };
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "update_display_name",
    result: { group: null, status: "unavailable", unavailableReason },
  });

  const access = await checkHostedRuntimeGroupLinqChatMutationAccess({
    linqThread: input.linqThread,
    memberId: input.memberId,
  });
  if (access.status !== "ok") {
    return unavailable(access.unavailableReason);
  }

  const displayName = normalizeHostedGroupDisplayName(
    input.updateDisplayName.displayName,
  );
  if (!displayName) {
    return unavailable("display_name_unavailable");
  }

  try {
    await updateHostedLinqChatDisplayName({
      chatId: access.chatId,
      displayName,
    });
  } catch {
    return unavailable("provider_unavailable");
  }

  // The accepted provider request is the rename, authorized by the route and
  // the owner exactly like set_chat_avatar; the provider owns when the upstream
  // title actually changes. The hosted group label is derived metadata that only
  // exists once the group has a hosted record, so observe that record after the
  // provider accepted — a group created while the rename was in flight still
  // gets the label — and keep the write best-effort: a request the provider
  // already took must not be reported as a failed rename. A null group therefore
  // says only that no updated summary came back, whether because there is no
  // record or because the write failed; another rename is the only thing that
  // stores the label afterwards.
  let updated: Awaited<
    ReturnType<typeof updateHostedGroupDisplayNameByRuntimeMemberIdTx>
  > = null;
  try {
    updated = await getPrisma().$transaction(
      async (tx) => {
        return updateHostedGroupDisplayNameByRuntimeMemberIdTx({
          displayName,
          runtimeMemberId: input.memberId,
          tx,
        });
      },
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    );
  } catch {
    // Keep the accepted rename; the label is not worth failing it over.
  }

  return {
    action: "update_display_name",
    result: { group: updated, status: "ok" },
  };
}

type HostedRuntimeGroupOwnerActiveAccess =
  | { status: "ok"; ownerMemberId: string }
  | {
      status: "unavailable";
      unavailableReason:
        | "not_group_runtime"
        | "owner_unavailable"
        | "runtime_inactive";
    };

async function readHostedRuntimeGroupOwnerActiveAccess(input: {
  memberId: string;
  prisma: HostedOnboardingReadClient;
}): Promise<HostedRuntimeGroupOwnerActiveAccess> {
  const container = await input.prisma.hostedThreadContainer.findUnique({
    where: { memberId: input.memberId },
    select: {
      member: {
        select: { suspendedAt: true },
      },
      ownerMemberId: true,
    },
  });
  if (!container) {
    return { status: "unavailable", unavailableReason: "not_group_runtime" };
  }
  if (container.member.suspendedAt) {
    return { status: "unavailable", unavailableReason: "runtime_inactive" };
  }
  if (!await readActiveHostedMemberAccess({
    memberId: container.ownerMemberId,
    prisma: input.prisma,
  })) {
    return { status: "unavailable", unavailableReason: "owner_unavailable" };
  }

  return { status: "ok", ownerMemberId: container.ownerMemberId };
}

async function handleHostedRuntimeGroupRevokeOwnEmailShare(input: {
  memberId: string;
  participant: HostedExecutionAcceptedGroupMessageParticipant | null;
  selfOptOut: HostedRuntimeGroupToolSelfOptOutContext | null;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "revoke_own_email_share",
    result: { status: "unavailable", unavailableReason },
  });

  if (!await hasHostedRuntimeActiveAccess(input.memberId)) {
    return unavailable("runtime_inactive");
  }
  if (!input.participant && !input.selfOptOut) {
    return unavailable("sender_unavailable");
  }
  const selfOptOut = input.selfOptOut;
  const prisma = getPrisma();
  let participant: Awaited<
    ReturnType<typeof lookupHostedGroupParticipantMemberByProviderEvidence>
  > | Awaited<ReturnType<typeof lookupSelfOptOutParticipantMember>> | null;
  try {
    participant = input.participant
      ? await lookupHostedGroupParticipantMemberByProviderEvidence({
          participant: input.participant,
          prisma,
        })
      : selfOptOut
        ? await lookupSelfOptOutParticipantMember({
            context: selfOptOut,
            prisma,
          })
        : null;
  } catch {
    return unavailable("membership_lookup_unavailable");
  }
  if (!participant) {
    return unavailable("member_unresolved");
  }
  try {
    assertHostedMemberNotSuspended(participant.core);
  } catch {
    return unavailable("member_unavailable");
  }
  const now = new Date();
  const revoked = await prisma.$transaction(async (tx) => revokeHostedGroupMemberEmailShareTx({
    groupRuntimeMemberId: input.memberId,
    memberId: participant.core.id,
    now,
    tx,
  }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  if (revoked.kind !== "ok") {
    return unavailable(revoked.kind);
  }

  return {
    action: "revoke_own_email_share",
    result: revoked.revokedCount > 0
      ? { revokedCount: 1, status: "revoked" }
      : { revokedCount: 0, status: "already_removed" },
  };
}

async function lookupSelfOptOutParticipantMember(input: {
  context: HostedRuntimeGroupToolSelfOptOutContext;
  prisma: ReturnType<typeof getPrisma>;
}) {
  if (input.context.source === "email") {
    return null;
  }

  return await lookupHostedGroupParticipantMemberByHandle({
    handle: input.context.senderHandle,
    prisma: input.prisma,
  });
}

async function handleHostedRuntimeGroupCreateJoinLink(input: {
  joinLink: HostedRuntimeGroupCreateJoinLinkRequest | null;
  memberId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "create_join_link",
    result: { group: null, status: "unavailable", unavailableReason },
  });

  const publicBaseUrl = resolveHostedPublicBaseUrl();
  if (!publicBaseUrl) {
    return unavailable("join_links_unavailable");
  }

  const prisma = getPrisma();
  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    const ownerAccess = await readHostedRuntimeGroupOwnerActiveAccess({
      memberId: input.memberId,
      prisma: tx,
    });
    if (ownerAccess.status !== "ok") {
      return { kind: ownerAccess.unavailableReason };
    }
    const requestedVaultShareProjectionScopes =
      resolveHostedGroupAccessOfferProjectionScopes(
        input.joinLink?.requestedVaultShareProjectionScopes
          ?? input.joinLink?.requestedVaultShareProjectionKinds,
      );
    const result = await createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: ownerAccess.ownerMemberId,
      containerMemberId: input.memberId,
      displayName: input.joinLink?.displayName ?? null,
      kind: input.joinLink?.kind ?? null,
      now,
      requestedVaultShareProjectionScopes,
      tx,
    });
    return {
      kind: "ok" as const,
      ownerMemberId: ownerAccess.ownerMemberId,
      ...result,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (created.kind !== "ok") {
    return unavailable(created.kind);
  }
  const joinUrl = buildHostedGroupJoinUrl({
    joinCode: created.joinCode,
    publicBaseUrl,
  });
  if (!joinUrl) {
    return unavailable("join_links_unavailable");
  }

  try {
    // The owner's membership grants profile-name.v0 in the transaction above;
    // waking their runtime lets the name projection deliver promptly instead of
    // waiting for the owner's next organic wake.
    await signalHostedRuntimeMaintenanceRuntime({ userId: created.ownerMemberId });
  } catch {
    // Durable grant already committed; the owner's runtime offers the
    // projection on a later wake if this best-effort signal fails.
  }
  await enqueueGroupOwnerNewsletterEmailNeededNudgeIfGrantedBestEffort({
    group: created.group,
    ownerMemberId: created.ownerMemberId,
    prisma,
  });

  return {
    action: "create_join_link",
    result: {
      group: created.group,
      joinUrl,
      status: "ok",
    },
  };
}

async function handleHostedRuntimeGroupPostDisclosureRequest(input: {
  linqThread: HostedRuntimeGroupToolLinqThreadContext | null;
  memberId: string;
  originAssistantInputId: string;
  permissionText: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "post_disclosure_request",
    result: { status: "unavailable", unavailableReason },
  });

  let permissionText: string;
  try {
    permissionText = canonicalizeHostedGroupDisclosurePermissionText(
      input.permissionText,
    );
  } catch {
    return unavailable("permission_text_unavailable");
  }

  const authorized = await authorizeHostedRuntimeGroupLinqThread({
    linqThread: input.linqThread,
    memberId: input.memberId,
  });
  if ("unavailableReason" in authorized) {
    return unavailable(authorized.unavailableReason);
  }

  const prisma = getPrisma();
  const authority = await prisma.$transaction(async (tx) => {
    const ownerAccess = await readHostedRuntimeGroupOwnerActiveAccess({
      memberId: input.memberId,
      prisma: tx,
    });
    if (ownerAccess.status !== "ok") {
      return { kind: ownerAccess.unavailableReason };
    }
    const groupId = await readHostedGroupIdByRuntimeMemberId({
      prisma: tx,
      runtimeMemberId: input.memberId,
    });
    if (!groupId) {
      return { kind: "group_not_found" as const };
    }
    const admission = await admitHostedGroupDisclosurePermissionAppendTx({
      groupId,
      originAssistantInputId: input.originAssistantInputId,
      permissionText,
      tx,
    });
    return admission.kind === "limit_reached"
      ? { kind: "permission_history_limit_reached" as const }
      : { groupId, kind: "ok" as const };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  if (authority.kind !== "ok") {
    return unavailable(authority.kind);
  }

  const consentMessage = buildHostedGroupDisclosureConsentMessage(permissionText);
  const providerIdempotencyKey =
    createHostedGroupDisclosurePermissionProviderIdempotencyKey({
      consentMessage,
      groupId: authority.groupId,
      originAssistantInputId: input.originAssistantInputId,
    });
  const postedAt = new Date();
  const sendAuthorized = await authorizeHostedRuntimeGroupLinqThread({
    linqThread: input.linqThread,
    memberId: input.memberId,
  });
  if ("unavailableReason" in sendAuthorized) {
    return unavailable(sendAuthorized.unavailableReason);
  }
  let sent: Awaited<ReturnType<typeof sendHostedLinqChatMessage>>;
  try {
    sent = await sendHostedLinqChatMessage({
      chatId: sendAuthorized.chatId,
      idempotencyKey: providerIdempotencyKey,
      message: consentMessage,
    });
  } catch {
    return unavailable("send_failed");
  }
  if (!sent.messageId) {
    return unavailable("provider_message_unavailable");
  }

  let binding: Awaited<ReturnType<typeof recordHostedGroupDisclosurePermissionTx>>;
  try {
    binding = await prisma.$transaction(
      async (tx) => {
        return recordHostedGroupDisclosurePermissionTx({
          groupId: authority.groupId,
          message: { channel: "linq", messageId: sent.messageId },
          originAssistantInputId: input.originAssistantInputId,
          permissionText,
          postedAt,
          tx,
        });
      },
      HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    );
  } catch {
    return unavailable("permission_binding_failed");
  }
  if (binding.kind === "limit_reached") {
    return unavailable("permission_history_limit_reached");
  }

  return {
    action: "post_disclosure_request",
    result: { status: "sent" },
  };
}

function buildHostedGroupDisclosureConsentMessage(permissionText: string): string {
  return [
    "Like this message to let this group ask your Murph for:",
    "",
    permissionText,
    "",
    "Only this exact permission is granted. Before an answer from your Murph is shared here, a separate outgoing reviewer checks it against this permission. Incoming questions do not go through a separate reviewer. You can revoke this permission at any time.",
  ].join("\n");
}

async function handleHostedRuntimeGroupPostJoinOffer(input: {
  joinOffer: HostedRuntimeGroupPostJoinOfferRequest | null;
  linqThread: HostedRuntimeGroupToolLinqThreadContext | null;
  memberId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "post_join_offer",
    result: { group: null, status: "unavailable", unavailableReason },
  });

  const publicBaseUrl = resolveHostedPublicBaseUrl();
  if (!publicBaseUrl) {
    return unavailable("join_links_unavailable");
  }
  const authorized = await authorizeHostedRuntimeGroupLinqThread({
    linqThread: input.linqThread,
    memberId: input.memberId,
  });
  if ("unavailableReason" in authorized) {
    return unavailable(authorized.unavailableReason);
  }

  const prisma = getPrisma();
  const now = new Date();
  const projectionScopes = resolveHostedGroupAccessOfferProjectionScopes(
    input.joinOffer?.projectionScopes
      ?? input.joinOffer?.projectionKinds,
  );
  const created = await prisma.$transaction(async (tx) => {
    const ownerAccess = await readHostedRuntimeGroupOwnerActiveAccess({
      memberId: input.memberId,
      prisma: tx,
    });
    if (ownerAccess.status !== "ok") {
      return { kind: ownerAccess.unavailableReason };
    }
    const result = await createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: ownerAccess.ownerMemberId,
      containerMemberId: input.memberId,
      displayName: input.joinOffer?.displayName ?? null,
      now,
      requestedVaultShareProjectionScopes: projectionScopes,
      tx,
    });
    const offerPost = await prepareHostedGroupJoinOfferPostTx({
      groupId: result.group.id,
      now,
      projectionScopes,
      tx,
    });
    if (offerPost.kind === "unavailable") {
      return { kind: "active_offer_state_unavailable" as const };
    }
    return {
      kind: "ok" as const,
      offerPost,
      ownerMemberId: ownerAccess.ownerMemberId,
      ...result,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  if (created.kind !== "ok") {
    return unavailable(created.kind);
  }

  const joinUrl = buildHostedGroupJoinUrl({
    joinCode: created.joinCode,
    publicBaseUrl,
  });
  if (!joinUrl) {
    return unavailable("join_links_unavailable");
  }
  if (created.offerPost.kind === "active_offer") {
    return {
      action: "post_join_offer",
      result: {
        group: created.group,
        joinUrl,
        offerState: "existing",
        status: "sent",
      },
    };
  }
  const offerGeneration = created.offerPost.offerGeneration;

  const message = buildHostedGroupJoinOfferMessage({
    joinUrl,
    projectionScopes,
  });
  const providerSendStartedAt = new Date();
  let sent: Awaited<ReturnType<typeof sendHostedLinqChatMessage>>;
  try {
    sent = await sendHostedLinqReactionBoundChatMessage({
      chatId: authorized.chatId,
      idempotencyKey: buildHostedGroupJoinOfferProviderIdempotencyKey({
        groupId: created.group.id,
        joinCode: created.offerPost.joinCode,
        offerGeneration,
        projectionScopes,
      }),
      message,
    });
  } catch {
    return unavailable("send_failed");
  }
  const providerSendCompletedAt = new Date();
  if (!sent.messageId) {
    return unavailable("provider_message_unavailable");
  }
  const providerCreatedAtMs = sent.messageCreatedAt
    ? Date.parse(sent.messageCreatedAt)
    : Number.NaN;
  const providerCreatedAt = Number.isFinite(providerCreatedAtMs)
    ? new Date(providerCreatedAtMs)
    : null;
  const providerSendStartedAtSecond = Math.floor(
    providerSendStartedAt.getTime() / 1_000,
  );
  const providerSendCompletedAtSecond = Math.floor(
    providerSendCompletedAt.getTime() / 1_000,
  );
  const providerCreatedAtSecond = providerCreatedAt === null
    ? null
    : Math.floor(providerCreatedAt.getTime() / 1_000);
  const providerCreatedDuringAttempt = providerCreatedAt !== null
    && providerCreatedAtSecond !== null
    && providerCreatedAtSecond >= providerSendStartedAtSecond
    && providerCreatedAtSecond <= providerSendCompletedAtSecond;
  const postedAt = providerCreatedAt ?? providerSendCompletedAt;

  try {
    await prisma.$transaction(async (tx) => {
      await recordHostedGroupJoinOfferTx({
        expectedOfferGeneration: offerGeneration,
        groupId: created.group.id,
        message: { channel: "linq", messageId: sent.messageId },
        postedAt,
        projectionScopes,
        tx,
      });
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  } catch {
    return unavailable("offer_binding_failed");
  }

  try {
    await signalHostedRuntimeMaintenanceRuntime({ userId: created.ownerMemberId });
  } catch {
    // The group and offer binding are durable; owner runtime maintenance can
    // catch up on its next organic wake.
  }
  await enqueueGroupOwnerNewsletterEmailNeededNudgeIfGrantedBestEffort({
    group: created.group,
    ownerMemberId: created.ownerMemberId,
    prisma,
  });

  return {
    action: "post_join_offer",
    result: {
      group: created.group,
      joinUrl,
      offerState: "posted",
      ...(providerCreatedDuringAttempt
        ? { offeredAt: providerCreatedAt.toISOString() }
        : {}),
      status: "sent",
    },
  };
}

async function handleHostedRuntimeGroupSetChatAvatar(input: {
  groupChatIconUrl: string;
  linqThread: HostedRuntimeGroupToolLinqThreadContext | null;
  memberId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (
    unavailableReason: string,
    providerDiagnostics?: {
      providerErrorCode?: number;
    },
  ): HostedRuntimeGroupToolResponse => ({
    action: "set_chat_avatar",
    result: {
      status: "unavailable",
      unavailableReason,
      ...providerDiagnostics,
    },
  });

  const access = await checkHostedRuntimeGroupLinqChatMutationAccess({
    linqThread: input.linqThread,
    memberId: input.memberId,
  });
  if (access.status !== "ok") {
    return unavailable(access.unavailableReason);
  }

  const groupChatIconUrl = normalizeHostedGroupChatIconUrl(input.groupChatIconUrl);
  if (!groupChatIconUrl) {
    return unavailable("group_chat_icon_url_unavailable");
  }

  const timing = startHostedOnboardingTiming("hosted-groups.set-chat-avatar", {
    chatIdSuffix: toHostedOnboardingLogIdSuffix(access.chatId),
  });
  try {
    await updateHostedLinqChatAvatar({
      chatId: access.chatId,
      groupChatIconUrl,
    });
  } catch (error) {
    const providerDiagnostics = readHostedLinqAvatarProviderDiagnostics(error);
    const requestOutcome =
      isHostedOnboardingError(error)
      && error.code === "LINQ_SEND_FAILED"
      && error.details?.failureStage === "http"
        ? "provider-request-rejected"
        : "provider-request-unconfirmed";
    finishHostedOnboardingTiming(timing, requestOutcome, {
      errorName: deriveHostedOnboardingTimingErrorName(error),
      providerErrorCode: providerDiagnostics?.providerErrorCode,
    });
    return unavailable(
      "provider_unavailable",
      providerDiagnostics,
    );
  }

  finishHostedOnboardingTiming(timing, "provider-request-accepted");

  return {
    action: "set_chat_avatar",
    result: { status: "requested" },
  };
}

function readHostedLinqAvatarProviderDiagnostics(error: unknown): {
  providerErrorCode?: number;
} | undefined {
  if (
    !isHostedOnboardingError(error)
    || error.code !== "LINQ_SEND_FAILED"
    || error.details?.failureStage !== "http"
  ) {
    return undefined;
  }
  const code = error.details.providerErrorCode;
  const providerErrorCode = typeof code === "number"
    && Number.isSafeInteger(code)
    && code >= 1_000
    && code <= 9_999
      ? code
      : null;
  if (providerErrorCode === null) {
    return undefined;
  }
  if (
    hostedRuntimeLinqProviderErrorMessageForCode(providerErrorCode) === null
  ) {
    return undefined;
  }
  return { providerErrorCode };
}

async function handleHostedRuntimeGroupSetChatAvatarPreflight(input: {
  linqThread: HostedRuntimeGroupToolLinqThreadContext | null;
  memberId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const access = await checkHostedRuntimeGroupLinqChatMutationAccess(input);
  if (access.status !== "ok") {
    return {
      action: "preflight_set_chat_avatar",
      result: { status: "unavailable", unavailableReason: access.unavailableReason },
    };
  }

  return {
    action: "preflight_set_chat_avatar",
    result: { status: "ok" },
  };
}

type HostedRuntimeGroupLinqChatMutationAccess =
  | { status: "ok"; chatId: string }
  | { status: "unavailable"; unavailableReason: string };

async function checkHostedRuntimeGroupLinqChatMutationAccess(input: {
  linqThread: HostedRuntimeGroupToolLinqThreadContext | null;
  memberId: string;
}): Promise<HostedRuntimeGroupLinqChatMutationAccess> {
  const authorized = await authorizeHostedRuntimeGroupLinqThread({
    linqThread: input.linqThread,
    memberId: input.memberId,
  });
  if ("unavailableReason" in authorized) {
    return { status: "unavailable", unavailableReason: authorized.unavailableReason };
  }

  const ownerAccess = await readHostedRuntimeGroupOwnerActiveAccess({
    memberId: input.memberId,
    prisma: getPrisma(),
  });
  if (ownerAccess.status !== "ok") {
    return { status: "unavailable", unavailableReason: ownerAccess.unavailableReason };
  }

  return { status: "ok", chatId: authorized.chatId };
}

export function buildHostedGroupJoinOfferMessage(input: {
  joinUrl: string;
  projectionScopes: readonly HostedVaultShareProjectionScope[];
}): string {
  return HOSTED_RUNTIME_GROUP_JOIN_OFFER_LEGACY_MESSAGE_TEMPLATE
    .replace(
      HOSTED_GROUP_JOIN_OFFER_SHARE_SCOPE_PLACEHOLDER,
      () => renderHostedGroupJoinOfferScopeSentence(input.projectionScopes),
    )
    .replace(HOSTED_GROUP_JOIN_OFFER_JOIN_URL_PLACEHOLDER, () => input.joinUrl);
}

const HOSTED_GROUP_JOIN_OFFER_SHARE_SCOPE_PLACEHOLDER = "{{share_scope}}";
const HOSTED_GROUP_JOIN_OFFER_JOIN_URL_PLACEHOLDER = "{{join_url}}";

async function enqueueGroupOwnerNewsletterEmailNeededNudgeIfGrantedBestEffort(input: {
  group: {
    id: string;
    members: readonly {
      grantedVaultShareProjectionKinds: readonly HostedVaultShareProjectionKind[];
      memberId: string;
    }[];
  };
  ownerMemberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  if (!input.group.members.some((member) =>
    member.memberId === input.ownerMemberId
    && member.grantedVaultShareProjectionKinds.includes("group-email.v0")
  )) {
    return;
  }

  await enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort({
    groupId: input.group.id,
    memberId: input.ownerMemberId,
    prisma: input.prisma,
  });
}

function normalizeHostedGroupChatIconUrl(value: string): string | null {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > HOSTED_RUNTIME_GROUP_CHAT_ICON_URL_MAX_LENGTH
  ) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return null;
  }
  if (!isHostedRuntimePrivateImageDeliveryUrl(
    parsed,
    readHostedExecutionControlOrigin() ?? undefined,
  )) {
    return null;
  }
  return parsed.toString();
}

function normalizeHostedGroupDisplayName(value: string): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (
    !normalized
    || normalized.length > HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH
  ) {
    return null;
  }
  return normalized;
}

async function handleHostedRuntimeGroupReadChatName(input: {
  memberId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "read_chat_name",
    result: { displayName: null, status: "unavailable", unavailableReason },
  });

  if (!await hasHostedRuntimeActiveAccess(input.memberId)) {
    return unavailable("runtime_inactive");
  }

  let destination: Awaited<
    ReturnType<typeof resolveHostedAssistantNotificationDestination>
  >;
  try {
    destination = await resolveHostedAssistantNotificationDestination({
      memberId: input.memberId,
    });
  } catch {
    return unavailable("route_unavailable");
  }

  const authority = destination?.conversationShape === "thread-container"
    ? destination.externalThreadRouteAuthority
    : null;
  if (!authority) {
    return unavailable("group_chat_unavailable");
  }

  let providerDisplayName: string | null;
  try {
    if (authority.channel === "linq") {
      providerDisplayName = await readHostedLinqExplicitGroupDisplayName(
        authority.threadId,
      );
    } else if (authority.channel === "telegram") {
      providerDisplayName = await getHostedTelegramGroupTitle({
        threadId: authority.threadId,
      });
    } else {
      return unavailable("group_chat_unavailable");
    }
  } catch {
    return unavailable("provider_unavailable");
  }

  const displayName = providerDisplayName
    ? normalizeHostedGroupDisplayName(providerDisplayName)
    : null;
  return displayName
    ? {
        action: "read_chat_name",
        result: { displayName, status: "ok" },
      }
    : {
        action: "read_chat_name",
        result: { displayName: null, status: "none" },
      };
}

async function readHostedLinqExplicitGroupDisplayName(
  chatId: string,
): Promise<string | null> {
  const chat = await getHostedLinqChatSummary({ chatId });
  if (chat.isGroup !== true) {
    return null;
  }
  const displayName = chat.displayName
    ? normalizeHostedGroupDisplayName(chat.displayName)
    : null;
  if (!displayName) {
    return null;
  }

  // Linq defaults display_name to a comma-separated list of handles. Suppress
  // every current SDK variant so phone numbers and emails never become the
  // hosted group label.
  const normalizeHandles = (handles: readonly string[]) =>
    handles
      .map((handle) => handle.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join("\0");
  const displayNameKey = normalizeHandles(displayName.split(","));
  const activeHandles = chat.handles.filter(isActiveHostedLinqChatHandle);
  const candidateHandleSets = [
    chat.handles,
    activeHandles,
    chat.handles.filter(({ isMe }) => !isMe),
    activeHandles.filter(({ isMe }) => !isMe),
  ];

  return displayNameKey
      && candidateHandleSets.some((handles) =>
        handles.length > 0
        && normalizeHandles(handles.map(({ handle }) => handle)) === displayNameKey
      )
    ? null
    : displayName;
}

function renderHostedGroupJoinOfferScopeSentence(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
): string {
  const labels = projectHostedVaultShareProjectionDisplays(projectionScopes)
    .map((display) => formatHostedGroupJoinOfferShareScopeLabel(display.label));
  const sentence = `your ${formatHumanList(["Murph profile name", ...labels])}`;
  const disclosures: string[] = [];
  // Nutrition labels (e.g. "daily protein") read as a bare number; disclose that
  // the totals come from the member's meals, connected-app imports included, so a
  // like-to-consent reaction is not materially narrower than what is exported.
  if (projectionScopes.some(isHostedGroupMealNutritionProjectionScope)) {
    disclosures.push(
      "nutrition totals come from your meals in Murph, including meals imported from connected apps",
    );
  }
  if (projectionScopes.some(isHostedGroupSleepSourceProjectionScope)) {
    disclosures.push(
      "by-source sleep includes every available source's value and name, plus when Murph recorded that source value",
    );
  }
  return disclosures.length > 0
    ? `${sentence} (${disclosures.join("; ")})`
    : sentence;
}

function isHostedGroupMealNutritionProjectionScope(
  scope: HostedVaultShareProjectionScope,
): boolean {
  return (
    getHostedVaultShareDailyMetricProjectionSpec(scope.projectionKind)?.source.kind
      === "meal-nutrition-total"
  );
}

function isHostedGroupSleepSourceProjectionScope(
  scope: HostedVaultShareProjectionScope,
): boolean {
  return scope.projectionKind === "deep-sleep-sources-days.v1"
    || scope.projectionKind === "rem-sleep-sources-days.v1";
}

function formatHostedGroupJoinOfferShareScopeLabel(label: string): string {
  const first = label[0];
  const second = label[1];
  return first && second && second >= "a" && second <= "z"
    ? `${first.toLowerCase()}${label.slice(1)}`
    : label;
}

function formatHumanList(values: readonly string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

type HostedRuntimeGroupLinqThreadAuthorization =
  | { chatId: string }
  | { unavailableReason: string };

/**
 * Authorize a personalized contact card against the direct/home Linq owner.
 * `hostedMemberRouting` is the sole owner of a direct chat, and the same chat
 * is forbidden from existing in the group thread-route store, so the group
 * assertion can never admit one. This reuses the existing runtime egress
 * assertion rather than introducing a second direct-route owner.
 */
async function authorizeHostedRuntimeDirectLinqChat(input: {
  chatId: string;
  memberId: string;
}): Promise<HostedRuntimeGroupLinqThreadAuthorization> {
  try {
    const assertion = await assertHostedLinqRecentInboundEngagementForRuntime({
      authorityCheckOnly: true,
      memberId: input.memberId,
      prisma: getPrisma(),
      target: input.chatId,
    });
    if (assertion.threadIsDirect !== true) {
      return { unavailableReason: "linq_thread_unauthorized" };
    }
  } catch {
    return { unavailableReason: "linq_thread_unauthorized" };
  }
  return { chatId: input.chatId };
}

async function authorizeHostedRuntimeGroupLinqThread(input: {
  linqThread: HostedRuntimeGroupToolLinqThreadContext | null;
  memberId: string;
}): Promise<HostedRuntimeGroupLinqThreadAuthorization> {
  if (!input.linqThread) {
    return { unavailableReason: "linq_thread_unavailable" };
  }
  const { authority, chatId } = input.linqThread;
  if (
    authority.containerMemberId !== input.memberId
    || authority.threadId !== chatId
  ) {
    return { unavailableReason: "linq_thread_unauthorized" };
  }
  try {
    await assertHostedLinqRouteEgressAuthority({
      authority,
      prisma: getPrisma(),
    });
  } catch {
    return { unavailableReason: "linq_thread_unauthorized" };
  }
  return { chatId };
}

async function handleHostedRuntimeGroupReadChatParticipants(input: {
  linqThread: HostedRuntimeGroupToolLinqThreadContext | null;
  memberId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "read_chat_participants",
    result: { participants: null, status: "unavailable", unavailableReason },
  });

  const authorized = await authorizeHostedRuntimeGroupLinqThread(input);
  if ("unavailableReason" in authorized) {
    return unavailable(authorized.unavailableReason);
  }

  let handles: Awaited<ReturnType<typeof getHostedLinqChatHandles>>;
  try {
    handles = await getHostedLinqChatHandles({ chatId: authorized.chatId });
  } catch {
    return unavailable("provider_unavailable");
  }
  // An empty roster means the provider payload had no recognizable handles;
  // treat that as provider trouble instead of a truthful "nobody here".
  if (handles.length === 0) {
    return unavailable("provider_unavailable");
  }

  const prisma = getPrisma();
  const participantHandles = selectHostedThreadContainerParticipantHandles({
    chatId: authorized.chatId,
    containerMemberId: input.memberId,
    handles,
  });
  let participants: HostedRuntimeGroupChatParticipant[];
  let resolvedParticipants: HostedThreadContainerResolvedParticipant[];
  try {
    const memberIdsByHandle = await lookupHostedGroupParticipantMemberIdsByHandles({
      handles: participantHandles.map((handle) => handle.handle),
      prisma,
    });
    resolvedParticipants = participantHandles.flatMap((handle) => {
      const participantMemberId = memberIdsByHandle.get(handle.handle) ?? null;
      return participantMemberId
        ? [{ handle: handle.handle, participantMemberId }]
        : [];
    });
    const activatedMemberIds = await readHostedMemberActivationProofMemberIds({
      memberIds: resolvedParticipants.map(
        (participant) => participant.participantMemberId,
      ),
      prisma,
    });
    participants = participantHandles.map((handle) => {
      const participantMemberId = memberIdsByHandle.get(handle.handle) ?? null;
      return {
        handle: handle.handle,
        hasOwnMurph: participantMemberId !== null
          && activatedMemberIds.has(participantMemberId),
      };
    });
  } catch {
    // A failed identity or activation lookup must not degrade into a guessed
    // hasOwnMurph value or an unstructured route error.
    return unavailable("membership_lookup_unavailable");
  }

  await reconcileHostedThreadContainerParticipants({
    chatId: authorized.chatId,
    containerMemberId: input.memberId,
    handles,
    prisma,
    resolvedParticipants,
  });

  const ownerAdvisoryNames =
    await readHostedOwnerAddressBookAdvisoryNamesWithinDeadline({
      containerMemberId: input.memberId,
      phoneHandles: participants.map((participant) => participant.handle),
      prisma,
    });
  for (const participant of participants) {
    const ownerAdvisoryName =
      ownerAdvisoryNames?.names.get(participant.handle);
    if (ownerAdvisoryName) {
      participant.ownerAdvisoryName = ownerAdvisoryName;
    }
  }

  return {
    action: "read_chat_participants",
    result: { participants, status: "ok" },
  };
}

async function handleHostedRuntimeGroupReadParticipantDisplayNames(input: {
  linqSenderHandles: readonly string[];
  memberId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (): HostedRuntimeGroupToolResponse => ({
    action: "read_participant_display_names",
    result: {
      status: "unavailable",
      unavailableReason: "participant_names_unavailable",
    },
  });

  try {
    const candidates =
      await readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId({
        linqSenderHandles: input.linqSenderHandles,
        runtimeMemberId: input.memberId,
      });
    if (candidates.status !== "ok") {
      return {
        action: "read_participant_display_names",
        result: candidates,
      };
    }

    const participants: HostedRuntimeGroupParticipantDisplayName[] = [];
    const nameMissSenderHandles: string[] = [];
    const unresolvedPhoneHandles: string[] = [];
    for (const candidate of candidates.candidates) {
      if (candidate.profileDisplayName) {
        participants.push({
          displayName: candidate.profileDisplayName,
          displayNameSource: "profile-name",
          senderHandle: candidate.senderHandle,
        });
      } else if (
        normalizePhoneNumber(candidate.senderHandle) === candidate.senderHandle
      ) {
        unresolvedPhoneHandles.push(candidate.senderHandle);
      } else {
        // Owner contacts are phone-only. Reaching this branch proves the exact
        // current member/profile lookup succeeded and no applicable second
        // source exists for this handle.
        nameMissSenderHandles.push(candidate.senderHandle);
      }
    }

    const contactLookupPhoneHandles = unresolvedPhoneHandles.slice(
      0,
      HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES,
    );
    const ownerContactLookup = contactLookupPhoneHandles.length === 0
      ? null
      : await readHostedOwnerAddressBookAdvisoryNamesWithinDeadline({
          containerMemberId: input.memberId,
          phoneHandles: contactLookupPhoneHandles,
          prisma: getPrisma(),
        });
    if (contactLookupPhoneHandles.length > 0 && ownerContactLookup === null) {
      return unavailable();
    }
    for (const senderHandle of contactLookupPhoneHandles) {
      const displayName = ownerContactLookup?.names.get(senderHandle);
      if (displayName) {
        participants.push({
          displayName,
          displayNameSource: "unverified-owner-contact",
          senderHandle,
        });
      }
    }
    if (
      ownerContactLookup
      && ownerContactLookup.outcome === "no_contact_match"
    ) {
      const namedPhoneHandles = ownerContactLookup.names;
      for (const senderHandle of contactLookupPhoneHandles) {
        if (!namedPhoneHandles.has(senderHandle)) {
          nameMissSenderHandles.push(senderHandle);
        }
      }
    }

    return {
      action: "read_participant_display_names",
      result: {
        ...(nameMissSenderHandles.length === 0
          ? {}
          : { nameMissSenderHandles }),
        participants,
        status: "ok",
      },
    };
  } catch {
    return unavailable();
  }
}

async function readHostedOwnerAddressBookAdvisoryNamesWithinDeadline(
  input: Parameters<typeof readHostedOwnerAddressBookAdvisoryNames>[0],
): Promise<HostedOwnerAddressBookAdvisoryNamesResult | null> {
  const lookup = readHostedOwnerAddressBookAdvisoryNames(input).then(
    (result) => ({ kind: "completed" as const, result }),
    (error: unknown) => ({
      errorName: deriveHostedOnboardingTimingErrorName(error),
      kind: "failed" as const,
    }),
  );
  // Prisma operations do not consume AbortSignal. Bound the entire optional
  // overlay at its caller so a stuck read can never delay the truthful roster.
  // The underlying lookup still receives its own KMS abort signal.

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ kind: "deadline_exceeded" }>((resolve) => {
    timeout = setTimeout(() => {
      resolve({ kind: "deadline_exceeded" });
    }, HOSTED_ADDRESS_BOOK_LOOKUP_TIMEOUT_MS);
  });

  try {
    const terminal = await Promise.race([lookup, deadline]);
    if (terminal.kind === "completed") {
      console.info("Hosted address-book advisory lookup finished.", {
        canonicalHandleCount: terminal.result.canonicalHandleCount,
        contactMatchCount: terminal.result.contactMatchCount,
        labelMatchCount: terminal.result.names.size,
        outcome: terminal.result.outcome,
        requestedHandleCount: terminal.result.requestedHandleCount,
      });
      return terminal.result;
    }
    if (terminal.kind === "failed") {
      console.warn("Hosted address-book advisory lookup unavailable.", {
        ...sanitizeHostedOnboardingStructuredLogDetails({
          errorName: terminal.errorName,
          outcome: "lookup_failed",
        }),
      });
    } else {
      console.info("Hosted address-book advisory lookup unavailable.", {
        outcome: "deadline_exceeded",
      });
    }
    return null;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export type HostedThreadContainerResolvedParticipant = {
  handle: string;
  participantMemberId: string;
};

export async function reconcileHostedThreadContainerParticipants(input: {
  chatId: string;
  containerMemberId: string;
  handles?: readonly HostedLinqChatHandleSummary[];
  prisma: HostedOnboardingReadClient;
  resolvedParticipants?: readonly HostedThreadContainerResolvedParticipant[];
}): Promise<void> {
  try {
    const handles = input.handles ?? await getHostedLinqChatHandles({ chatId: input.chatId });
    if (handles.length === 0) {
      logHostedThreadContainerParticipantReconcileSkipped({
        chatId: input.chatId,
        containerMemberId: input.containerMemberId,
        reason: "empty_roster",
      });
      return;
    }

    const hasCompleteRoster =
      handles.length <= HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX;
    const participantHandles = selectHostedThreadContainerParticipantHandles({
      chatId: input.chatId,
      containerMemberId: input.containerMemberId,
      handles,
    });
    const boundedHandleValues = new Set(participantHandles.map((handle) => handle.handle));
    const resolvedParticipants = (input.resolvedParticipants
      ?? await resolveHostedThreadContainerParticipants({
        handles: participantHandles,
        prisma: input.prisma,
      })).filter((participant) => boundedHandleValues.has(participant.handle));
    const now = new Date();
    const seenByMemberId = new Map<string, {
      handleLookupKey: string;
      participantMemberId: string;
    }>();

    for (const participant of resolvedParticipants) {
      const handleLookupKey = createHostedThreadContainerParticipantHandleLookupKey(
        participant.handle,
      );
      if (!handleLookupKey || seenByMemberId.has(participant.participantMemberId)) {
        continue;
      }
      seenByMemberId.set(participant.participantMemberId, {
        handleLookupKey,
        participantMemberId: participant.participantMemberId,
      });
    }

    const seenParticipants = [...seenByMemberId.values()];
    const inputParticipantRows = seenParticipants.length === 0
      ? Prisma.sql`
          SELECT NULL::text, NULL::text
          WHERE FALSE
        `
      : Prisma.sql`
          VALUES ${Prisma.join(seenParticipants.map((participant) => Prisma.sql`
            (${participant.participantMemberId}::text, ${participant.handleLookupKey}::text)
          `))}
        `;

    await input.prisma.$executeRaw(Prisma.sql`
      WITH input_participant(participant_member_id, handle_lookup_key) AS (
        ${inputParticipantRows}
      ),
      upserted AS (
        INSERT INTO hosted_thread_container_participant (
          container_member_id,
          participant_member_id,
          handle_lookup_key,
          first_seen_at,
          last_seen_at,
          removed_at,
          created_at,
          updated_at
        )
        SELECT
          ${input.containerMemberId},
          input_participant.participant_member_id,
          input_participant.handle_lookup_key,
          ${now},
          ${now},
          NULL,
          ${now},
          ${now}
        FROM input_participant
        ON CONFLICT (container_member_id, participant_member_id)
        DO UPDATE SET
          handle_lookup_key = EXCLUDED.handle_lookup_key,
          last_seen_at = EXCLUDED.last_seen_at,
          removed_at = NULL,
          updated_at = EXCLUDED.updated_at
        RETURNING participant_member_id
      )
      UPDATE hosted_thread_container_participant AS participant
      SET
        removed_at = ${now},
        updated_at = ${now}
      FROM (SELECT COUNT(*) FROM upserted) AS upsert_barrier
      WHERE ${hasCompleteRoster}
        AND participant.container_member_id = ${input.containerMemberId}
        AND participant.removed_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM input_participant
          WHERE input_participant.participant_member_id = participant.participant_member_id
        )
    `);

    if (!hasCompleteRoster) {
      logHostedThreadContainerParticipantReconcileSkipped({
        chatId: input.chatId,
        containerMemberId: input.containerMemberId,
        reason: "roster_exceeds_cap",
      });
    }
  } catch (error) {
    logHostedThreadContainerParticipantReconcileSkipped({
      chatId: input.chatId,
      containerMemberId: input.containerMemberId,
      errorName: deriveHostedOnboardingTimingErrorName(error),
      reason: "reconcile_failed",
    });
  }
}

async function resolveHostedThreadContainerParticipants(input: {
  handles: readonly HostedLinqChatHandleSummary[];
  prisma: HostedOnboardingReadClient;
}): Promise<HostedThreadContainerResolvedParticipant[]> {
  const currentHandles = input.handles.filter(isCurrentHostedLinqParticipantHandle);
  const memberIdsByHandle = await lookupHostedGroupParticipantMemberIdsByHandles({
    handles: currentHandles.map((handle) => handle.handle),
    prisma: input.prisma,
  });

  return currentHandles.flatMap((handle) => {
    const participantMemberId = memberIdsByHandle.get(handle.handle) ?? null;
    return participantMemberId
      ? [{ handle: handle.handle, participantMemberId }]
      : [];
  });
}

function isActiveHostedLinqChatHandle(handle: HostedLinqChatHandleSummary): boolean {
  return !handle.status || handle.status.trim().toLowerCase() === "active";
}

function isCurrentHostedLinqParticipantHandle(handle: HostedLinqChatHandleSummary): boolean {
  return !handle.isMe && isActiveHostedLinqChatHandle(handle);
}

function selectHostedThreadContainerParticipantHandles(input: {
  chatId: string;
  containerMemberId: string;
  handles: readonly HostedLinqChatHandleSummary[];
}): HostedLinqChatHandleSummary[] {
  const currentHandles = input.handles.filter(isCurrentHostedLinqParticipantHandle);
  if (currentHandles.length > HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX) {
    logHostedThreadContainerParticipantReconcileCapped({
      cap: HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
      chatId: input.chatId,
      containerMemberId: input.containerMemberId,
      rosterSize: currentHandles.length,
    });
  }

  return currentHandles.slice(0, HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX);
}

function createHostedThreadContainerParticipantHandleLookupKey(handle: string): string | null {
  if (handle.includes("@")) {
    return createHostedLinqParticipantContactLookupKey({
      kind: "email",
      value: handle,
    });
  }

  const phoneNumber = normalizePhoneNumber(handle);
  return phoneNumber
    ? createHostedLinqParticipantContactLookupKey({
        kind: "phone",
        value: phoneNumber,
      })
    : null;
}

function logHostedThreadContainerParticipantReconcileSkipped(input: {
  chatId: string;
  containerMemberId: string;
  errorName?: string;
  reason: string;
}): void {
  console.warn("Hosted thread-container participant reconcile skipped.", {
    ...sanitizeHostedOnboardingStructuredLogDetails({
      chatIdSuffix: toHostedOnboardingLogIdSuffix(input.chatId),
      containerMemberIdSuffix: toHostedOnboardingLogIdSuffix(input.containerMemberId),
      errorName: input.errorName,
      reason: input.reason,
    }),
  });
}

function logHostedThreadContainerParticipantReconcileCapped(input: {
  cap: number;
  chatId: string;
  containerMemberId: string;
  rosterSize: number;
}): void {
  console.warn("Hosted thread-container participant reconcile capped.", {
    ...sanitizeHostedOnboardingStructuredLogDetails({
      cap: input.cap,
      chatIdSuffix: toHostedOnboardingLogIdSuffix(input.chatId),
      containerMemberIdSuffix: toHostedOnboardingLogIdSuffix(input.containerMemberId),
      reason: "roster_exceeds_cap",
      rosterSize: input.rosterSize,
    }),
  });
}

type HostedRuntimeGroupShareContactCardInput =
  | {
      kind: "canonical";
      linqThread: HostedRuntimeGroupToolLinqThreadContext | null;
      memberId: string;
    }
  | {
      kind: "personalized";
      contactCardImageUrl: string;
      contactCardShareKey: string;
      directLinqChatId: string;
      memberId: string;
      requestStartedAtMs?: number;
    };

async function handleHostedRuntimeGroupShareContactCard(
  input: HostedRuntimeGroupShareContactCardInput,
): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "share_contact_card",
    result: { status: "unavailable", unavailableReason },
  });

  // Anchored to when the web-control request arrived, so the body read,
  // signature verification, and nonce consumption that already happened are
  // charged to the same budget as the work below. Falling back to now is only
  // for direct unit callers; production always supplies the route's value.
  // Authorization and the backup-number read take no signal, so they are
  // checked against the deadline instead; everything after them either
  // consumes it or is past the point of no return.
  const deadlines = input.kind === "personalized"
    ? resolveHostedLinqPersonalizedContactCardDeadlines(
      input.requestStartedAtMs ?? Date.now(),
    )
    : null;

  const authorized = input.kind === "personalized"
    ? await authorizeHostedRuntimeDirectLinqChat({
      chatId: input.directLinqChatId,
      memberId: input.memberId,
    })
    : await authorizeHostedRuntimeGroupLinqThread({
      linqThread: input.linqThread,
      memberId: input.memberId,
    });
  if ("unavailableReason" in authorized) {
    return unavailable(authorized.unavailableReason);
  }

  const prisma = getPrisma();
  let outcome: Awaited<ReturnType<typeof shareMurphHostedLinqContactCardVcfToChat>>;
  if (input.kind === "personalized") {
    const contactCardImageUrl = normalizeHostedGroupChatIconUrl(
      input.contactCardImageUrl,
    );
    if (!contactCardImageUrl) {
      return unavailable("contact_card_image_url_unavailable");
    }
    // Authorization takes no signal, so this is where its cost is charged
    // against the deadline. Refusing here is provably before any provider
    // work, which is why it is an ordinary unavailable rather than uncertainty.
    if (deadlines && Date.now() >= deadlines.preSendDeadlineAt) {
      return unavailable("contact_card_presend_deadline_exceeded");
    }
    outcome = await shareMurphHostedLinqContactCardVcfToChat({
      chatId: authorized.chatId,
      idempotencyKeyPrefix: "personalized-contact-card",
      imageUrl: contactCardImageUrl,
      memberId: input.memberId,
      prisma,
      shareKey: input.contactCardShareKey,
      ...(deadlines ? { operationDeadlineAt: deadlines.operationDeadlineAt } : {}),
    });
  } else {
    const ownerAccess = await readHostedRuntimeGroupOwnerActiveAccess({
      memberId: input.memberId,
      prisma,
    });
    if (ownerAccess.status !== "ok") {
      return unavailable(ownerAccess.unavailableReason);
    }
    outcome = await shareMurphHostedLinqContactCardVcfToChat({
      chatId: authorized.chatId,
      idempotencyKeyPrefix: "group-contact-card",
      memberId: input.memberId,
      prisma,
    });
  }

  if (outcome.status === "already_shared") {
    return {
      action: "share_contact_card",
      result: { status: "already_shared" },
    };
  }
  if (outcome.status === "unconfirmed") {
    return {
      action: "share_contact_card",
      result: { status: "unconfirmed" },
    };
  }
  if (outcome.status !== "sent") {
    return unavailable(outcome.reason);
  }

  return {
    action: "share_contact_card",
    result: { status: "sent" },
  };
}
