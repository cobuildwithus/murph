import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  HOSTED_USAGE_ADVISORY_RECHECK_CAMPAIGN,
  recheckHostedUsageAdvisoryWorkflows,
} from "@/src/lib/hosted-ops/runtime-recheck-rollout";
import {
  parseHostedUsageAdvisoryRecheckScriptOptions,
} from "../scripts/recheck-usage-advisory-workflows";

describe("hosted usage-advisory runtime recheck rollout", () => {
  const findMany = vi.fn();
  const readActiveAccess = vi.fn();
  const signalRuntimeRecheck = vi.fn();
  const prisma = {
    hostedWorkspace: { findMany },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([
      { userId: "member_active" },
      { userId: "member_inactive" },
    ]);
    readActiveAccess.mockImplementation(async ({ memberId }) => (
      memberId === "member_active"
    ));
    signalRuntimeRecheck.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_active",
    });
  });

  it("previews every workspace without signaling", async () => {
    await expect(recheckHostedUsageAdvisoryWorkflows({
      mode: "dry-run",
      prisma: prisma as never,
      readActiveAccess,
      signalRuntimeRecheck,
    })).resolves.toEqual({
      activeWorkspaceCount: 1,
      failedSignalCount: 0,
      mode: "dry-run",
      signaledWorkspaceCount: 0,
      skippedInactiveWorkspaceCount: 1,
      workspaceCount: 2,
    });
    expect(signalRuntimeRecheck).not.toHaveBeenCalled();
  });

  it("signals active workspaces and keeps count-only failure evidence", async () => {
    signalRuntimeRecheck.mockRejectedValueOnce(new Error("signal unavailable"));

    await expect(recheckHostedUsageAdvisoryWorkflows({
      mode: "apply",
      prisma: prisma as never,
      readActiveAccess,
      signalRuntimeRecheck,
    })).resolves.toEqual({
      activeWorkspaceCount: 1,
      failedSignalCount: 1,
      mode: "apply",
      signaledWorkspaceCount: 0,
      skippedInactiveWorkspaceCount: 1,
      workspaceCount: 2,
    });
    expect(signalRuntimeRecheck).toHaveBeenCalledExactlyOnceWith({
      prisma,
      userId: "member_active",
    });
  });

  it("requires the exact fixed campaign before apply", () => {
    expect(parseHostedUsageAdvisoryRecheckScriptOptions([])).toEqual({
      help: false,
      mode: "dry-run",
    });
    expect(parseHostedUsageAdvisoryRecheckScriptOptions([
      "--apply",
      "--campaign",
      HOSTED_USAGE_ADVISORY_RECHECK_CAMPAIGN,
    ])).toEqual({
      help: false,
      mode: "apply",
    });
    expect(() => parseHostedUsageAdvisoryRecheckScriptOptions([
      "--apply",
      "--campaign",
      "wrong-campaign",
    ])).toThrow(`--apply requires --campaign ${HOSTED_USAGE_ADVISORY_RECHECK_CAMPAIGN}.`);
  });
});
