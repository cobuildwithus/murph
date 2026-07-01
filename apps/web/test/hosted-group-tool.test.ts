import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOrReadHostedGroupJoinLinkTx: vi.fn(),
  ensureHostedGroupForThreadContainerTx: vi.fn(),
  getPrisma: vi.fn(),
  readHostedGroupByRuntimeMemberId: vi.fn(),
  resolveHostedPublicBaseUrl: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicBaseUrl: mocks.resolveHostedPublicBaseUrl,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS: {},
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
  createOrReadHostedGroupJoinLinkTx: mocks.createOrReadHostedGroupJoinLinkTx,
  ensureHostedGroupForThreadContainerTx: mocks.ensureHostedGroupForThreadContainerTx,
  readHostedGroupByRuntimeMemberId: mocks.readHostedGroupByRuntimeMemberId,
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
    mocks.getPrisma.mockReturnValue({
      $transaction: vi.fn((callback) => callback({ label: "tx" })),
      hostedThreadContainer: {
        findUnique: vi.fn().mockResolvedValue({
          memberId: "member_group_runtime",
          ownerMemberId: "member_owner",
        }),
      },
    });
    mocks.resolveHostedPublicBaseUrl.mockReturnValue("https://local.withmurph.ai");
    mocks.readHostedGroupByRuntimeMemberId.mockResolvedValue(GROUP_SUMMARY);
    mocks.ensureHostedGroupForThreadContainerTx.mockResolvedValue(GROUP_SUMMARY);
    mocks.createOrReadHostedGroupJoinLinkTx.mockResolvedValue({ joinCode: "join_abc" });
  });

  it("reads the current group for the runtime member without creating a link", async () => {
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
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("does not mint a join link from a non-container runtime", async () => {
    const prisma = {
      $transaction: vi.fn(),
      hostedThreadContainer: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_regular",
      request: { action: "create_join_link" },
    })).resolves.toEqual({
      action: "create_join_link",
      result: {
        group: null,
        joinUrl: null,
        replyText: null,
        status: "unavailable",
        unavailableReason: "current_runtime_is_not_thread_container",
      },
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.ensureHostedGroupForThreadContainerTx).not.toHaveBeenCalled();
  });

  it("creates or reuses the group join link for a thread-container runtime", async () => {
    await expect(handleHostedRuntimeGroupTool({
      memberId: "member_group_runtime",
      request: {
        action: "create_join_link",
        displayName: "Sunday sleep crew",
        kind: "friends",
        requestedVaultShareProjectionKinds: ["sleep-times.v0"],
      },
    })).resolves.toMatchObject({
      action: "create_join_link",
      result: {
        group: GROUP_SUMMARY,
        joinUrl: "https://local.withmurph.ai/groups/join/join_abc",
        status: "ok",
      },
    });

    expect(mocks.ensureHostedGroupForThreadContainerTx).toHaveBeenCalledWith({
      containerMemberId: "member_group_runtime",
      displayName: "Sunday sleep crew",
      kind: "friends",
      now: expect.any(Date),
      requestedVaultShareProjectionKinds: ["sleep-times.v0"],
      tx: { label: "tx" },
    });
    expect(mocks.createOrReadHostedGroupJoinLinkTx).toHaveBeenCalledWith({
      actorMemberId: "member_owner",
      groupId: "hgrp_123",
      now: expect.any(Date),
      tx: { label: "tx" },
    });
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
