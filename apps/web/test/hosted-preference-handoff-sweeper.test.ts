import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn((..._args: unknown[]): Promise<Array<{
    mailboxItemId: string;
    userId: string;
  }>> => Promise.resolve([])),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ $queryRaw: mocks.queryRaw }),
}));

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
      handoffSkippedInactive: 2,
      skippedCandidateUsers: 0,
    });
  });

  it("does not let inactive candidates consume the handoff limit", async () => {
    const inactiveCandidates = Array.from({ length: 25 }, (_, index) => ({
      mailboxItemId: `mailbox_preference_inactive_${index}`,
      userId: `member_preference_inactive_${index}`,
    }));
    const activeCandidate = {
      mailboxItemId: "mailbox_preference_active",
      userId: "member_preference_active",
    };
    const requestHandoff = vi.fn(async () => ({
      signalAccepted: true as const,
      workflowId: "hosted-user-runtime:synthetic",
    }));

    const result = await runHostedPreferenceHandoffSweeper({
      hasActiveAccess: vi.fn(async (userId) => userId === activeCandidate.userId),
      logger: buildLogger(),
      requestHandoff,
      store: buildStore([...inactiveCandidates, activeCandidate]),
    });

    expect(requestHandoff).toHaveBeenCalledWith({
      expectedUserId: activeCandidate.userId,
      mailboxItemId: activeCandidate.mailboxItemId,
    });
    expect(result).toMatchObject({
      handoffAccepted: 1,
      handoffAttempted: 1,
      handoffSkippedInactive: 25,
    });
  });

  it("selects active synthetic room runtimes before applying the handoff limit", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{
      mailboxItemId: "mailbox_group_preference",
      userId: "member_group_runtime",
    }]);
    const requestHandoff = vi.fn(async () => ({
      signalAccepted: true as const,
      workflowId: "hosted-user-runtime:synthetic",
    }));
    const hasActiveAccess = vi.fn(async () => true);

    await runHostedPreferenceHandoffSweeper({
      hasActiveAccess,
      logger: buildLogger(),
      requestHandoff,
    });

    const query = mocks.queryRaw.mock.calls[0]?.[0] as {
      strings?: readonly string[];
    } | undefined;
    const sql = query?.strings?.join("?") ?? "";
    expect(sql).toContain('"active_person_members"');
    expect(sql).toContain('"active_member"."id" IS NOT NULL');
    expect(sql).toContain('"active_owner"."id" IS NOT NULL');
    expect(sql).toContain('"hosted_thread_container_participant"');
    expect(sql).toContain('JOIN "active_person_members" AS "active_participant"');
    expect(sql).toContain('"participant"."removed_at" IS NULL');
    expect(hasActiveAccess).toHaveBeenCalledWith("member_group_runtime");
    expect(hasActiveAccess.mock.invocationCallOrder[0]).toBeLessThan(
      requestHandoff.mock.invocationCallOrder[0]!,
    );
    expect(requestHandoff).toHaveBeenCalledWith({
      expectedUserId: "member_group_runtime",
      mailboxItemId: "mailbox_group_preference",
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
