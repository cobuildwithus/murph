import "server-only";

import {
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
  type HostedRuntimeGroupChatParticipant,
  type HostedRuntimeGroupCreateJoinLinkRequest,
  type HostedRuntimeGroupToolLinqThreadContext,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/runtime-control";

import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import {
} from "../hosted-onboarding/entitlement";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { lookupHostedMemberIdentityByPhoneNumber } from "../hosted-onboarding/hosted-member-identity-store";
import { lookupHostedMemberByVerifiedEmailAddress } from "../hosted-onboarding/hosted-member-store";
import {
  getHostedLinqChatHandles,
  isHostedLinqAttachmentSendPrepareFailure,
  sendHostedLinqAttachmentMessage,
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
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import {
  signalHostedRuntimeMaintenanceRuntime,
} from "../hosted-orchestration/signal-runtime";
import { assertHostedLinqRouteEgressAuthority } from "../hosted-routing/thread-route-store";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import { getPrisma } from "../prisma";
import { buildHostedGroupJoinUrl } from "./group-links";
import {
  createHostedGroupJoinLinkForOwnedThreadContainerTx,
  readHostedGroupByRuntimeMemberId,
} from "./group-store";

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

  if (input.request.action === "read_chat_participants") {
    return handleHostedRuntimeGroupReadChatParticipants({
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

async function handleHostedRuntimeGroupCreateJoinLink(input: {
  joinLink: HostedRuntimeGroupCreateJoinLinkRequest | null;
  memberId: string;
}): Promise<HostedRuntimeGroupToolResponse> {
  const unavailable = (unavailableReason: string): HostedRuntimeGroupToolResponse => ({
    action: "create_join_link",
    result: { group: null, status: "unavailable", unavailableReason },
  });

  if (!await hasHostedRuntimeActiveAccess(input.memberId)) {
    return unavailable("runtime_inactive");
  }
  const publicBaseUrl = resolveHostedPublicBaseUrl();
  if (!publicBaseUrl) {
    return unavailable("join_links_unavailable");
  }

  const prisma = getPrisma();
  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    const container = await tx.hostedThreadContainer.findUnique({
      where: { memberId: input.memberId },
      select: { ownerMemberId: true },
    });
    if (!container) {
      return { kind: "not_group_runtime" as const };
    }
    const owner = await tx.hostedMember.findUnique({
      where: { id: container.ownerMemberId },
      select: { suspendedAt: true },
    });
    if (!owner || owner.suspendedAt) {
      return { kind: "owner_unavailable" as const };
    }
    const result = await createHostedGroupJoinLinkForOwnedThreadContainerTx({
      actorMemberId: container.ownerMemberId,
      containerMemberId: input.memberId,
      displayName: input.joinLink?.displayName ?? null,
      kind: input.joinLink?.kind ?? null,
      now,
      requestedVaultShareProjectionKinds:
        input.joinLink?.requestedVaultShareProjectionKinds ?? [],
      tx,
    });
    return { kind: "ok" as const, ownerMemberId: container.ownerMemberId, ...result };
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
  const participants: HostedRuntimeGroupChatParticipant[] = [];
  try {
    for (const handle of handles) {
      if (handle.isMe) {
        continue;
      }
      if (handle.status && handle.status.trim().toLowerCase() !== "active") {
        continue;
      }
      if (participants.length >= HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX) {
        break;
      }
      participants.push({
        handle: handle.handle,
        hasOwnMurph: await hasParticipantOwnMurphMembership({
          handle: handle.handle,
          prisma,
        }),
      });
    }
  } catch {
    // A failed identity lookup must not degrade into a guessed hasOwnMurph
    // value or an unstructured route error.
    return unavailable("membership_lookup_unavailable");
  }

  return {
    action: "read_chat_participants",
    result: { participants, status: "ok" },
  };
}

async function hasParticipantOwnMurphMembership(input: {
  handle: string;
  prisma: ReturnType<typeof getPrisma>;
}): Promise<boolean> {
  const lookup = await lookupParticipantMemberByHandle(input);
  const member = lookup?.core ?? null;
  return member !== null
    && await readActiveHostedMemberAccess({
      memberId: member.id,
      prisma: input.prisma,
    });
}

async function lookupParticipantMemberByHandle(input: {
  handle: string;
  prisma: ReturnType<typeof getPrisma>;
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

  const prisma = getPrisma();
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
