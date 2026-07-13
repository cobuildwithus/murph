import { describe, expect, it, vi } from "vitest";

import {
  runHostedPreferenceHandoffSweeper,
} from "@/src/lib/hosted-orchestration/preference-handoff-sweeper";

describe("hosted preference handoff sweeper", () => {
  it("signals a pending preference row without logging its owner or item id", async () => {
    const logger = buildLogger();
    const requestHandoff = vi.fn(async () => ({
      signalAccepted: true as const,
      workflowId: "hosted-user-runtime:synthetic",
    }));

    const result = await runHostedPreferenceHandoffSweeper({
      hasActiveAccess: vi.fn(async () => true),
      logger,
      requestHandoff,
      store: buildStore([{
        mailboxItemId: "mailbox_preference_1",
        userId: "member_preference_1",
      }]),
    });

    expect(requestHandoff).toHaveBeenCalledWith({
      expectedUserId: "member_preference_1",
      mailboxItemId: "mailbox_preference_1",
    });
    expect(result).toEqual({
      candidateUsers: 1,
      handoffAccepted: 1,
      handoffAttempted: 1,
      handoffFailed: 0,
      handoffLimit: 25,
      handoffSkippedInactive: 0,
      skippedCandidateUsers: 0,
    });
    const logs = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
    ]);
    expect(logs).not.toContain("member_preference_1");
    expect(logs).not.toContain("mailbox_preference_1");
  });

  it("retries the same durable candidate on a later sweep after signal failure", async () => {
    const store = buildStore([{
      mailboxItemId: "mailbox_preference_retry",
      userId: "member_preference_retry",
    }]);
    const requestHandoff = vi.fn()
      .mockRejectedValueOnce(new Error("signal unavailable"))
      .mockResolvedValueOnce({
        signalAccepted: true,
        workflowId: "hosted-user-runtime:synthetic",
      });

    await expect(runHostedPreferenceHandoffSweeper({
      hasActiveAccess: vi.fn(async () => true),
      logger: buildLogger(),
      requestHandoff,
      store,
    })).resolves.toMatchObject({
      handoffAccepted: 0,
      handoffFailed: 1,
    });
    await expect(runHostedPreferenceHandoffSweeper({
      hasActiveAccess: vi.fn(async () => true),
      logger: buildLogger(),
      requestHandoff,
      store,
    })).resolves.toMatchObject({
      handoffAccepted: 1,
      handoffFailed: 0,
    });

    expect(requestHandoff).toHaveBeenCalledTimes(2);
  });

  it("skips inactive owners and keeps each sweep bounded", async () => {
    const candidates = [
      {
        mailboxItemId: "mailbox_preference_inactive",
        userId: "member_preference_inactive",
      },
      {
        mailboxItemId: "mailbox_preference_over_limit",
        userId: "member_preference_over_limit",
      },
    ];
    const requestHandoff = vi.fn();

    const result = await runHostedPreferenceHandoffSweeper({
      handoffLimit: 1,
      hasActiveAccess: vi.fn(async () => false),
      logger: buildLogger(),
      requestHandoff,
      store: buildStore(candidates),
    });

    expect(requestHandoff).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      candidateUsers: 2,
      handoffAttempted: 0,
      handoffLimit: 1,
      handoffSkippedInactive: 1,
      skippedCandidateUsers: 1,
    });
  });
});

function buildStore(rows: Array<{
  mailboxItemId: string;
  userId: string;
}>) {
  return {
    listCandidates: vi.fn(async () => rows),
  };
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}
