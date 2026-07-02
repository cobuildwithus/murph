import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedGroupJoinLinkForOwnedThreadContainerTx: vi.fn(),
  hasHostedRuntimeActiveAccess: vi.fn(),
  hostedMemberFindUnique: vi.fn(),
  hostedThreadContainerFindUnique: vi.fn(),
  readHostedGroupByRuntimeMemberId: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  hasHostedRuntimeActiveAccess: mocks.hasHostedRuntimeActiveAccess,
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  createHostedGroupJoinLinkForOwnedThreadContainerTx:
    mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx,
  readHostedGroupByRuntimeMemberId: mocks.readHostedGroupByRuntimeMemberId,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

const fakeTx = {
  hostedMember: { findUnique: mocks.hostedMemberFindUnique },
  hostedThreadContainer: { findUnique: mocks.hostedThreadContainerFindUnique },
};

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: (run: (tx: typeof fakeTx) => Promise<unknown>) => run(fakeTx),
  }),
}));

import { handleHostedRuntimeGroupTool } from "@/src/lib/hosted-groups/group-tool";
import {
  mergeHostedGroupJoinPolicy,
  projectHostedVaultShareProjectionDisplays,
  readHostedGroupJoinPolicy,
} from "@/src/lib/hosted-groups/join-policy";

const GROUP_SUMMARY = {
  displayName: "Sunday sleep crew",
  id: "hgrp_123",
  kind: "friends",
  memberCount: 3,
  requestedVaultShareProjectionKinds: ["sleep-times.v0" as const],
  status: "active",
};

describe("handleHostedRuntimeGroupTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(true);
    mocks.readHostedGroupByRuntimeMemberId.mockResolvedValue(GROUP_SUMMARY);
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://www.withmurph.ai");
    mocks.hostedThreadContainerFindUnique.mockResolvedValue({
      ownerMemberId: "member_owner",
    });
    mocks.hostedMemberFindUnique.mockResolvedValue({ suspendedAt: null });
    mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx.mockResolvedValue({
      group: GROUP_SUMMARY,
      joinCode: "abc123",
    });
  });

  it("reads the current group for the runtime member", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_current" },
    })).resolves.toEqual({
      action: "read_current",
      result: {
        group: GROUP_SUMMARY,
        status: "ok",
      },
    });

    expect(mocks.readHostedGroupByRuntimeMemberId).toHaveBeenCalledWith({
      runtimeMemberId: "member_group_runtime",
    });
  });

  it("does not read group state when runtime access is inactive", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "read_current" },
    })).resolves.toEqual({
      action: "read_current",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "runtime_inactive",
      },
    });

    expect(mocks.readHostedGroupByRuntimeMemberId).not.toHaveBeenCalled();
  });

  it("reports no group when the runtime member is not attached to one", async () => {
    mocks.readHostedGroupByRuntimeMemberId.mockResolvedValue(null);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_regular",
      request: { action: "read_current" },
    })).resolves.toEqual({
      action: "read_current",
      result: {
        group: null,
        status: "none",
      },
    });
  });

  it("creates a join link bound to the runtime member's thread container owner", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "create_join_link",
        joinLink: {
          displayName: "Sunday sleep crew",
          kind: "friends",
          requestedVaultShareProjectionKinds: ["sleep-times.v0"],
        },
      },
    })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: GROUP_SUMMARY,
        joinUrl: "https://www.withmurph.ai/groups/join/abc123",
        status: "ok",
      },
    });

    expect(mocks.hostedThreadContainerFindUnique).toHaveBeenCalledWith({
      where: { memberId: "member_group_runtime" },
      select: { ownerMemberId: true },
    });
    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).toHaveBeenCalledWith(
      expect.objectContaining({
        actorMemberId: "member_owner",
        containerMemberId: "member_group_runtime",
        displayName: "Sunday sleep crew",
        kind: "friends",
        requestedVaultShareProjectionKinds: ["sleep-times.v0"],
      }),
    );
  });

  it("does not mint a join link when runtime access is inactive", async () => {
    mocks.hasHostedRuntimeActiveAccess.mockResolvedValue(false);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "create_join_link" },
    })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "runtime_inactive",
      },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).not.toHaveBeenCalled();
  });

  it("reports join links unavailable without a public base url", async () => {
    mocks.resolveHostedPublicBaseUrl.mockReturnValue(null);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "create_join_link" },
    })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "join_links_unavailable",
      },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).not.toHaveBeenCalled();
  });

  it("rejects join-link creation when the runtime member is not a thread container", async () => {
    mocks.hostedThreadContainerFindUnique.mockResolvedValue(null);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_regular",
      request: { action: "create_join_link" },
    })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "not_group_runtime",
      },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).not.toHaveBeenCalled();
  });

  it("rejects join-link creation when the container owner is suspended", async () => {
    mocks.hostedMemberFindUnique.mockResolvedValue({ suspendedAt: new Date() });

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: { action: "create_join_link" },
    })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        status: "unavailable",
        unavailableReason: "owner_unavailable",
      },
    });

    expect(mocks.createHostedGroupJoinLinkForOwnedThreadContainerTx).not.toHaveBeenCalled();
  });
});

describe("hosted group join policy", () => {
  it("keeps optional health sharing on the closed projection registry", () => {
    expect(readHostedGroupJoinPolicy({
      requestedVaultShareProjectionKinds: ["sleep-times.v0"],
      schema: "murph.hosted-group.join-policy.v1",
    })).toEqual({
      requestedVaultShareProjectionKinds: ["sleep-times.v0"],
      schema: "murph.hosted-group.join-policy.v1",
    });

    expect(mergeHostedGroupJoinPolicy({
      existing: {
        requestedVaultShareProjectionKinds: ["sleep-times.v0"],
        schema: "murph.hosted-group.join-policy.v1",
      },
      requestedVaultShareProjectionKinds: ["sleep-times.v0"],
    }).requestedVaultShareProjectionKinds).toEqual(["sleep-times.v0"]);

    expect(readHostedGroupJoinPolicy({
      requestedVaultShareProjectionKinds: ["all-health-data"],
      schema: "murph.hosted-group.join-policy.v1",
    }).requestedVaultShareProjectionKinds).toEqual([]);

    expect(projectHostedVaultShareProjectionDisplays(["sleep-times.v0"])).toEqual([{
      description:
        "Allows this group to receive your recent sleep start and end times as bounded shared records.",
      label: "Recent sleep timing",
      projectionKind: "sleep-times.v0",
    }]);
  });
});
