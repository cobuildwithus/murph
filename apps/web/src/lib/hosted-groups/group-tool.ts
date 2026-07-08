import "server-only";

import {
  HOSTED_RUNTIME_GROUP_CHAT_ICON_URL_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
  HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_JOIN_OFFER_MESSAGE_TEMPLATE_MAX_LENGTH,
  type HostedRuntimeGroupChatParticipant,
  type HostedRuntimeGroupCreateJoinLinkRequest,
  type HostedRuntimeGroupPostJoinOfferRequest,
  type HostedRuntimeGroupToolAction,
  type HostedRuntimeGroupToolLinqThreadContext,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeGroupToolResponse,
  type HostedRuntimeGroupToolSelfOptOutContext,
} from "@murphai/hosted-execution/runtime-control";
import type { HostedVaultShareProjectionScope } from "@murphai/hosted-execution/vault-share";

import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import {
  assertHostedMemberNotSuspended,
} from "../hosted-onboarding/entitlement";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import {
  getHostedLinqChatHandles,
  type HostedLinqChatHandleSummary,
  isHostedLinqAttachmentSendPrepareFailure,
  sendHostedLinqAttachmentMessage,
  sendHostedLinqChatMessage,
  updateHostedLinqChatAvatar,
  updateHostedLinqChatDisplayName,
} from "../hosted-onboarding/linq-client";
import {
  buildMurphHostedLinqContactCardVcf,
  fetchMurphHostedLinqContactCardVcfPhoto,
  MURPH_CONTACT_CARD_VCF_CONTENT_TYPE,
  MURPH_CONTACT_CARD_VCF_FILE_NAME,
  resolveMurphHostedLinqContactCardBackupPhoneNumber,
} from "../hosted-onboarding/linq-contact-card";
import {
  releaseHostedLinqContactCardShareAttempt,
  reserveHostedLinqContactCardShareAttempt,
} from "../hosted-onboarding/linq-contact-card-share";
import { createHostedLinqParticipantContactLookupKey } from "../hosted-onboarding/linq-participant-contact";
import {
  deriveHostedOnboardingTimingErrorName,
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "../hosted-onboarding/logging";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  type HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";
import {
  signalHostedMailboxAppendRuntime,
  signalHostedRuntimeMaintenanceRuntime,
} from "../hosted-orchestration/signal-runtime";
import { assertHostedLinqRouteEgressAuthority } from "../hosted-routing/thread-route-store";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import { getPrisma } from "../prisma";
import { buildHostedGroupJoinUrl } from "./group-links";
import {
  createHostedGroupJoinLinkForOwnedThreadContainerTx,
  readHostedGroupByRuntimeMemberId,
  recordHostedGroupJoinOfferTx,
  revokeHostedGroupMemberEmailShareTx,
  updateHostedGroupDisplayNameByRuntimeMemberIdTx,
} from "./group-store";
import {
  normalizeHostedVaultShareProjectionScopes,
  projectHostedVaultShareProjectionDisplays,
} from "./join-policy";

export const HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX =
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX;

const HOSTED_GROUP_JOIN_OFFER_JOIN_URL_PLACEHOLDER = "{{join_url}}";
const HOSTED_GROUP_JOIN_OFFER_SHARE_SCOPE_PLACEHOLDER = "{{share_scope}}";

export type HostedRuntimeGroupToolAccessClassification =
  | "owner_active"
  | "participant_aware";

export const HOSTED_RUNTIME_GROUP_TOOL_ACCESS_CLASSIFICATION = {
  create_join_link: "owner_active",
  post_join_offer: "owner_active",
  preflight_set_chat_avatar: "owner_active",
  read_chat_participants: "participant_aware",
  read_current: "participant_aware",
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
}): Promise<HostedRuntimeGroupToolResponse> {
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
    return handleHostedRuntimeGroupShareContactCard({
      linqThread: input.request.linqThread ?? null,
      memberId: input.memberId,
    });
  }

  if (input.request.action === "revoke_own_email_share") {
    return handleHostedRuntimeGroupRevokeOwnEmailShare({
      memberId: input.memberId,
      selfOptOut: input.request.selfOptOut ?? null,
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

  return {
    action: "read_current",
    result: group
      ? { status: "ok", group }
      : { status: "none", group: null },
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

  const existing = await readHostedGroupByRuntimeMemberId({
    runtimeMemberId: input.memberId,
  });
  if (!existing) {
    return unavailable("group_not_found");
  }

  try {
    await updateHostedLinqChatDisplayName({
      chatId: access.chatId,
      displayName,
    });
  } catch {
    return unavailable("provider_unavailable");
  }

  const prisma = getPrisma();
  const updated = await prisma.$transaction(async (tx) =>
    updateHostedGroupDisplayNameByRuntimeMemberIdTx({
      displayName,
      runtimeMemberId: input.memberId,
      tx,
    }), HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return {
    action: "update_display_name",
    result: updated
      ? { group: updated, status: "ok" }
      : { group: null, status: "unavailable", unavailableReason: "group_not_found" },
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
  selfOptOut: HostedRuntimeGroupToolSelfOptOutContext | null;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "revoke_own_email_share",
    result: { status: "unavailable", unavailableReason },
  });

  if (!await hasHostedRuntimeActiveAccess(input.memberId)) {
    return unavailable("runtime_inactive");
  }
  if (!input.selfOptOut) {
    return unavailable("sender_unavailable");
  }

  const prisma = getPrisma();
  let participant: Awaited<ReturnType<typeof lookupSelfOptOutParticipantMember>> | null;
  try {
    participant = await lookupSelfOptOutParticipantMember({
      context: input.selfOptOut,
      prisma,
    });
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
  if (!await readActiveHostedMemberAccess({
    memberId: participant.core.id,
    prisma,
  })) {
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

  await signalVaultShareCleanupRuntimesBestEffort(revoked.vaultShareCleanupSignals);

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

  return await lookupParticipantMemberByHandle({
    handle: input.context.senderHandle,
    prisma: input.prisma,
  });
}

async function signalVaultShareCleanupRuntimesBestEffort(
  signals: readonly { mailboxItemId: string; memberId: string }[],
): Promise<void> {
  await Promise.all(signals.map(async (signal) => {
    try {
      await signalHostedMailboxAppendRuntime({
        expectedUserId: signal.memberId,
        mailboxItemId: signal.mailboxItemId,
      });
    } catch {
      // The revoke mailbox item is durable; the destination runtime will observe it later.
    }
  }));
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
      normalizeHostedVaultShareProjectionScopes(
        input.joinLink?.requestedVaultShareProjectionScopes
          ?? input.joinLink?.requestedVaultShareProjectionKinds
          ?? [],
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
    return { kind: "ok" as const, ownerMemberId: ownerAccess.ownerMemberId, ...result };
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

  return {
    action: "create_join_link",
    result: { group: created.group, joinUrl, status: "ok" },
  };
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
  const projectionScopes = normalizeHostedVaultShareProjectionScopes(
    input.joinOffer?.projectionScopes
      ?? input.joinOffer?.projectionKinds
      ?? [],
  );
  const messageTemplate = normalizeHostedGroupJoinOfferMessageTemplate(
    input.joinOffer?.messageTemplate ?? null,
  );
  if (
    !messageTemplate
    || !isHostedGroupJoinOfferMessageTemplateUsable(messageTemplate)
  ) {
    return unavailable("join_offer_message_template_unavailable");
  }
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
    return { kind: "ok" as const, ownerMemberId: ownerAccess.ownerMemberId, ...result };
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

  const message = buildHostedGroupJoinOfferMessage({
    joinUrl,
    messageTemplate,
    projectionScopes,
  });
  let sent: Awaited<ReturnType<typeof sendHostedLinqChatMessage>>;
  try {
    sent = await sendHostedLinqChatMessage({
      chatId: authorized.chatId,
      idempotencyKey: `group-join-offer:${created.group.id}:${now.toISOString()}`,
      message,
    });
  } catch {
    return unavailable("send_failed");
  }
  if (!sent.messageId) {
    return unavailable("provider_message_unavailable");
  }

  try {
    await prisma.$transaction(async (tx) => {
      await recordHostedGroupJoinOfferTx({
        groupId: created.group.id,
        messageId: sent.messageId,
        postedAt: now,
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

  return {
    action: "post_join_offer",
    result: { group: created.group, joinUrl, status: "sent" },
  };
}

async function handleHostedRuntimeGroupSetChatAvatar(input: {
  groupChatIconUrl: string;
  linqThread: HostedRuntimeGroupToolLinqThreadContext | null;
  memberId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "set_chat_avatar",
    result: { status: "unavailable", unavailableReason },
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

  try {
    await updateHostedLinqChatAvatar({
      chatId: access.chatId,
      groupChatIconUrl,
    });
  } catch {
    return unavailable("provider_unavailable");
  }

  return {
    action: "set_chat_avatar",
    result: { status: "requested" },
  };
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

function buildHostedGroupJoinOfferMessage(input: {
  joinUrl: string;
  messageTemplate: string;
  projectionScopes: readonly HostedVaultShareProjectionScope[];
}): string {
  return input.messageTemplate
    .replace(
      HOSTED_GROUP_JOIN_OFFER_SHARE_SCOPE_PLACEHOLDER,
      renderHostedGroupJoinOfferScopeSentence(input.projectionScopes),
    )
    .replace(HOSTED_GROUP_JOIN_OFFER_JOIN_URL_PLACEHOLDER, input.joinUrl);
}

function normalizeHostedGroupJoinOfferMessageTemplate(
  messageTemplate: string | null,
): string | null {
  if (messageTemplate === null) return null;
  const normalized = messageTemplate.trim().replace(/\s+/gu, " ");
  if (
    normalized.length === 0
    || normalized.length > HOSTED_RUNTIME_GROUP_JOIN_OFFER_MESSAGE_TEMPLATE_MAX_LENGTH
  ) {
    return null;
  }
  return normalized;
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
  if (!isHostedGroupChatIconDeliveryUrl(parsed)) {
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

function isHostedGroupChatIconDeliveryUrl(url: URL): boolean {
  if (url.hostname !== "imagedelivery.net" || url.search || url.hash) {
    return false;
  }
  return url.pathname.split("/").filter(Boolean).length >= 3;
}

function isHostedGroupJoinOfferMessageTemplateUsable(messageTemplate: string): boolean {
  return hasPlaceholderExactlyOnce(
    messageTemplate,
    HOSTED_GROUP_JOIN_OFFER_SHARE_SCOPE_PLACEHOLDER,
  ) && hasPlaceholderExactlyOnce(
    messageTemplate,
    HOSTED_GROUP_JOIN_OFFER_JOIN_URL_PLACEHOLDER,
  );
}

function hasPlaceholderExactlyOnce(messageTemplate: string, placeholder: string): boolean {
  return (
    messageTemplate.includes(placeholder)
    && messageTemplate.indexOf(placeholder) === messageTemplate.lastIndexOf(placeholder)
  );
}

function renderHostedGroupJoinOfferScopeSentence(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
): string {
  const labels = projectHostedVaultShareProjectionDisplays(projectionScopes)
    .map((display) => formatHostedGroupJoinOfferShareScopeLabel(display.label));
  return `your ${formatHumanList(["Murph profile name", ...labels])}`;
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
  const participants: HostedRuntimeGroupChatParticipant[] = [];
  const resolvedParticipants: HostedThreadContainerResolvedParticipant[] = [];
  try {
    for (const handle of participantHandles) {
      const lookup = await lookupParticipantMemberByHandle({
        handle: handle.handle,
        prisma,
      });
      const participantMemberId = lookup?.core.id ?? null;
      if (participantMemberId) {
        resolvedParticipants.push({
          handle: handle.handle,
          participantMemberId,
        });
      }
      if (participants.length < HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX) {
        participants.push({
          handle: handle.handle,
          hasOwnMurph: participantMemberId !== null
            && await readActiveHostedMemberAccess({
              memberId: participantMemberId,
              prisma,
            }),
        });
      }
    }
  } catch {
    // A failed identity lookup must not degrade into a guessed hasOwnMurph
    // value or an unstructured route error.
    return unavailable("membership_lookup_unavailable");
  }

  await reconcileHostedThreadContainerParticipants({
    chatId: authorized.chatId,
    containerMemberId: input.memberId,
    handles,
    prisma,
    resolvedParticipants,
  });

  return {
    action: "read_chat_participants",
    result: { participants, status: "ok" },
  };
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

    const seenParticipantMemberIds = [...seenByMemberId.keys()];
    for (const participant of seenByMemberId.values()) {
      await input.prisma.hostedThreadContainerParticipant.upsert({
        create: {
          containerMemberId: input.containerMemberId,
          firstSeenAt: now,
          handleLookupKey: participant.handleLookupKey,
          lastSeenAt: now,
          participantMemberId: participant.participantMemberId,
          removedAt: null,
        },
        update: {
          handleLookupKey: participant.handleLookupKey,
          lastSeenAt: now,
          removedAt: null,
        },
        where: {
          containerMemberId_participantMemberId: {
            containerMemberId: input.containerMemberId,
            participantMemberId: participant.participantMemberId,
          },
        },
      });
    }

    if (!hasCompleteRoster) {
      logHostedThreadContainerParticipantReconcileSkipped({
        chatId: input.chatId,
        containerMemberId: input.containerMemberId,
        reason: "roster_exceeds_cap",
      });
      return;
    }

    await input.prisma.hostedThreadContainerParticipant.updateMany({
      data: {
        removedAt: now,
      },
      where: {
        containerMemberId: input.containerMemberId,
        ...(seenParticipantMemberIds.length > 0
          ? { participantMemberId: { notIn: seenParticipantMemberIds } }
          : {}),
        removedAt: null,
      },
    });
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
  const resolvedParticipants: HostedThreadContainerResolvedParticipant[] = [];
  for (const handle of input.handles) {
    if (!isCurrentHostedLinqParticipantHandle(handle)) {
      continue;
    }
    const lookup = await lookupParticipantMemberByHandle({
      handle: handle.handle,
      prisma: input.prisma,
    });
    const participantMemberId = lookup?.core.id ?? null;
    if (participantMemberId) {
      resolvedParticipants.push({
        handle: handle.handle,
        participantMemberId,
      });
    }
  }
  return resolvedParticipants;
}

async function lookupParticipantMemberByHandle(input: {
  handle: string;
  prisma: HostedOnboardingReadClient;
}) {
  if (input.handle.includes("@")) {
    return await lookupHostedMemberByVerifiedEmailAddress({
      address: input.handle,
      prisma: input.prisma,
    });
  }
  const phoneNumber = normalizePhoneNumber(input.handle);
  if (!phoneNumber) {
    return null;
  }
  return await lookupHostedMemberIdentityByPhoneNumber({
    phoneNumber,
    prisma: input.prisma,
  });
}

function isCurrentHostedLinqParticipantHandle(handle: HostedLinqChatHandleSummary): boolean {
  return !handle.isMe
    && (!handle.status || handle.status.trim().toLowerCase() === "active");
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

async function handleHostedRuntimeGroupShareContactCard(input: {
  linqThread: HostedRuntimeGroupToolLinqThreadContext | null;
  memberId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "share_contact_card",
    result: { status: "unavailable", unavailableReason },
  });

  const authorized = await authorizeHostedRuntimeGroupLinqThread(input);
  if ("unavailableReason" in authorized) {
    return unavailable(authorized.unavailableReason);
  }

  const prisma = getPrisma();
  const ownerAccess = await readHostedRuntimeGroupOwnerActiveAccess({
    memberId: input.memberId,
    prisma,
  });
  if (ownerAccess.status !== "ok") {
    return unavailable(ownerAccess.unavailableReason);
  }

  let linePhoneNumber: string | null = null;
  let rosterPresent = false;
  try {
    const handles = await getHostedLinqChatHandles({ chatId: authorized.chatId });
    rosterPresent = handles.length > 0;
    linePhoneNumber = normalizePhoneNumber(
      handles.find((handle) => handle.isMe)?.handle ?? null,
    );
  } catch {
    return unavailable("provider_unavailable");
  }
  if (!rosterPresent) {
    return unavailable("provider_unavailable");
  }
  if (!linePhoneNumber) {
    return unavailable("line_unresolved");
  }

  const reservation = await reserveHostedLinqContactCardShareAttempt({
    chatId: authorized.chatId,
    memberId: input.memberId,
    prisma,
  });
  if (reservation.action !== "share") {
    if (reservation.reason === "recent_attempt") {
      return {
        action: "share_contact_card",
        result: { status: "already_shared" },
      };
    }
    return unavailable(reservation.reason);
  }

  const [photo, backupPhoneNumber] = await Promise.all([
    fetchMurphHostedLinqContactCardVcfPhoto(),
    resolveMurphHostedLinqContactCardBackupPhoneNumber({
      excludePhoneNumber: linePhoneNumber,
      prisma: getPrisma(),
    }),
  ]);
  const vcf = buildMurphHostedLinqContactCardVcf({
    backupPhoneNumber,
    phoneNumber: linePhoneNumber,
    photo,
  });
  try {
    await sendHostedLinqAttachmentMessage({
      bytes: new Uint8Array(Buffer.from(vcf, "utf8")),
      chatId: authorized.chatId,
      contentType: MURPH_CONTACT_CARD_VCF_CONTENT_TYPE,
      fileName: MURPH_CONTACT_CARD_VCF_FILE_NAME,
      // Chat id + day: dedupes duplicate provider submissions of this share
      // without suppressing an intentional re-share after the 48h throttle.
      // The chat id is Linq's own identifier, so no new exposure.
      idempotencyKey: `group-contact-card:${authorized.chatId}:${new Date().toISOString().slice(0, 10)}`,
    });
  } catch (error) {
    if (isHostedLinqAttachmentSendPrepareFailure(error)) {
      // Nothing reached the chat; free the 48h reservation so a later retry
      // is not locked out. Ambiguous message-send failures keep it.
      try {
        await releaseHostedLinqContactCardShareAttempt({
          attemptedAt: reservation.attemptedAt,
          chatId: authorized.chatId,
          memberId: input.memberId,
          prisma,
        });
      } catch {
        // Best effort: a stuck reservation only delays the next attempt.
      }
    }
    return unavailable("send_failed");
  }

  return {
    action: "share_contact_card",
    result: { status: "sent" },
  };
}
