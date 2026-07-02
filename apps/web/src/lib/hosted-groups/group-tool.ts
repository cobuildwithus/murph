import "server-only";

import type {
  HostedRuntimeGroupCreateJoinLinkRequest,
  HostedRuntimeGroupToolRequest,
  HostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/runtime-control";

import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
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
    return { kind: "ok" as const, ...result };
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

  return {
    action: "create_join_link",
    result: { group: created.group, joinUrl, status: "ok" },
  };
}
