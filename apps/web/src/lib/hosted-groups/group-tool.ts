import "server-only";

import type {
  HostedRuntimeGroupToolRequest,
  HostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/runtime-control";

import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { resolveHostedPublicBaseUrl } from "../hosted-web/public-url";
import { getPrisma } from "../prisma";
import { buildHostedGroupJoinUrl } from "./group-links";
import {
  createOrReadHostedGroupJoinLinkTx,
  ensureHostedGroupForThreadContainerTx,
  readHostedGroupByRuntimeMemberId,
} from "./group-store";

export async function handleHostedRuntimeGroupTool(input: {
  memberId: string;
  request: HostedRuntimeGroupToolRequest;
}): Promise<HostedRuntimeGroupToolResponse> {
  if (input.request.action === "read_current") {
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

  const request = input.request;
  const prisma = getPrisma();
  const container = await prisma.hostedThreadContainer.findUnique({
    where: { memberId: input.memberId },
    select: { memberId: true, ownerMemberId: true },
  });
  if (!container) {
    return {
      action: "create_join_link",
      result: {
        status: "unavailable",
        unavailableReason: "current_runtime_is_not_thread_container",
        group: null,
        joinUrl: null,
        replyText: null,
      },
    };
  }

  const publicBaseUrl = resolveHostedPublicBaseUrl();
  if (!publicBaseUrl) {
    return {
      action: "create_join_link",
      result: {
        status: "unavailable",
        unavailableReason: "public_base_url_unavailable",
        group: null,
        joinUrl: null,
        replyText: null,
      },
    };
  }

  const now = new Date();
  const { group, joinCode } = await prisma.$transaction(async (tx) => {
    const group = await ensureHostedGroupForThreadContainerTx({
      containerMemberId: container.memberId,
      displayName: request.displayName ?? null,
      kind: request.kind ?? null,
      now,
      requestedVaultShareProjectionKinds: request.requestedVaultShareProjectionKinds ?? [],
      tx,
    });
    const link = await createOrReadHostedGroupJoinLinkTx({
      actorMemberId: container.ownerMemberId,
      groupId: group.id,
      now,
      tx,
    });
    return { group, joinCode: link.joinCode };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  const joinUrl = buildHostedGroupJoinUrl({ joinCode, publicBaseUrl });
  if (!joinUrl) {
    return {
      action: "create_join_link",
      result: {
        status: "unavailable",
        unavailableReason: "public_base_url_unavailable",
        group: null,
        joinUrl: null,
        replyText: null,
      },
    };
  }

  return {
    action: "create_join_link",
    result: {
      status: "ok",
      group,
      joinUrl,
      replyText: buildHostedGroupJoinReplyText(joinUrl),
    },
  };
}

function buildHostedGroupJoinReplyText(joinUrl: string): string {
  return [
    "I made a Murph group for this chat.",
    "",
    "Everyone who wants to participate can join here:",
    joinUrl,
    "",
    "Joining does not share your private Murph chats, health data, vault data, account data, or email settings. The page will ask about any optional health permissions this group feature requested.",
  ].join("\n");
}
