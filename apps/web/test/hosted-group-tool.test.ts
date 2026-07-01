import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readHostedGroupByRuntimeMemberId: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-store", () => ({
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
    mocks.readHostedGroupByRuntimeMemberId.mockResolvedValue(GROUP_SUMMARY);
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
