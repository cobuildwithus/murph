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
      abortSignal: expect.any(AbortSignal),
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

  it("bounds a hung handoff so the recovery sweep can finish", async () => {
    const requestHandoff = vi.fn(() => new Promise<never>(() => {}));
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(0);

    try {
      const result = await runHostedPreferenceHandoffSweeper({
        handoffTimeoutMs: 1,
        hasActiveAccess: vi.fn(async () => true),
        logger: buildLogger(),
        requestHandoff,
        store: buildStore([{
          mailboxItemId: "mailbox_preference_hung",
          userId: "member_preference_hung",
        }]),
      });

      expect(result).toMatchObject({
        handoffAccepted: 0,
        handoffAttempted: 1,
        handoffFailed: 1,
      });
      expect(requestHandoff).toHaveBeenCalledWith({
        abortSignal: expect.any(AbortSignal),
        expectedUserId: "member_preference_hung",
        mailboxItemId: "mailbox_preference_hung",
      });
    } finally {
      dateNow.mockRestore();
    }
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
      abortSignal: expect.any(AbortSignal),
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
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_group_runtime",
      mailboxItemId: "mailbox_group_preference",
    });
  });

  it("selects exact current Clinical Records wakes in the shared mailbox sweep", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{
      mailboxItemId: "mailbox_clinical_current",
      userId: "member_clinical_current",
    }]);
    const requestHandoff = vi.fn(async () => ({
      signalAccepted: true as const,
      workflowId: "hosted-user-runtime:synthetic",
    }));

    await runHostedPreferenceHandoffSweeper({
      hasActiveAccess: vi.fn(async () => true),
      logger: buildLogger(),
      requestHandoff,
    });

    const query = mocks.queryRaw.mock.calls[0]?.[0] as {
      strings?: readonly string[];
    } | undefined;
    const sql = query?.strings?.join("?") ?? "";
    expect(sql).toContain('"pending_handoff_candidates"');
    expect(sql).toContain('SELECT DISTINCT ON ("userId")');
    expect(sql).toContain('"connection"."retrieval_generation" = "run"."generation"');
    expect(sql).toContain('"connection"."status" = \'active\'');
    expect(sql).toContain('"run"."status" = \'queued\'');
    expect(sql).toContain('"run"."completed_at" IS NULL');
    expect(sql).toContain('"item"."kind" = \'clinical-records.sync-requested\'');
    expect(sql).toContain('"item"."lane" = \'system\'');
    expect(sql).toContain('"item"."dedupe_key" = (');
    expect(sql).toContain(
      '\'clinical-records:sync:v1:\' || "run"."id" || \':\' || "run"."generation"::text',
    );
    expect(sql).toContain('"item"."lane_seq" > COALESCE("lane_counter"."consumed_seq", 0)');
    expect(sql).toContain('"item"."expires_at" IS NULL OR "item"."expires_at" > ?');
    expect(requestHandoff).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_clinical_current",
      mailboxItemId: "mailbox_clinical_current",
    });
  });

  it("selects pending browser-vault, maintenance, and provider-setup wakes in the shared mailbox sweep", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{
      mailboxItemId: "mailbox_browser_refresh",
      userId: "member_browser_refresh",
    }]);
    const requestHandoff = vi.fn(async () => ({
      signalAccepted: true as const,
      workflowId: "hosted-user-runtime:synthetic",
    }));

    await runHostedPreferenceHandoffSweeper({
      hasActiveAccess: vi.fn(async () => true),
      logger: buildLogger(),
      requestHandoff,
    });

    const query = mocks.queryRaw.mock.calls[0]?.[0] as {
      strings?: readonly string[];
    } | undefined;
    const sql = query?.strings?.join("?") ?? "";
    expect(sql).toContain('"pending_runtime_control_users"');
    expect(sql).toContain(
      "'runtime.browser-vault-refresh-requested'",
    );
    expect(sql).toContain(
      "'runtime.maintenance-requested'",
    );
    expect(sql).toContain(
      "'runtime.provider-setup-continuation-requested'",
    );
    expect(sql).toContain(
      '"item"."lane_seq" > COALESCE("lane_counter"."consumed_seq", 0)',
    );
    expect(requestHandoff).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_browser_refresh",
      mailboxItemId: "mailbox_browser_refresh",
    });
  });

  it("retries an exact current Clinical Records wake after a hung shared handoff", async () => {
    const store = buildStore([{
      mailboxItemId: "mailbox_clinical_hung_retry",
      userId: "member_clinical_hung_retry",
    }]);
    let handoffCalls = 0;
    const requestHandoff = vi.fn(() => {
      handoffCalls += 1;
      return handoffCalls === 1
        ? new Promise<never>(() => {})
        : Promise.resolve({
            signalAccepted: true as const,
            workflowId: "hosted-user-runtime:synthetic",
          });
    });
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(0);

    try {
      await expect(runHostedPreferenceHandoffSweeper({
        handoffTimeoutMs: 1,
        hasActiveAccess: vi.fn(async () => true),
        logger: buildLogger(),
        requestHandoff,
        store,
      })).resolves.toMatchObject({
        handoffAccepted: 0,
        handoffFailed: 1,
      });
      await expect(runHostedPreferenceHandoffSweeper({
        handoffTimeoutMs: 1,
        hasActiveAccess: vi.fn(async () => true),
        logger: buildLogger(),
        requestHandoff,
        store,
      })).resolves.toMatchObject({
        handoffAccepted: 1,
        handoffFailed: 0,
      });
    } finally {
      dateNow.mockRestore();
    }

    expect(requestHandoff).toHaveBeenCalledTimes(2);
    expect(requestHandoff).toHaveBeenNthCalledWith(1, {
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_clinical_hung_retry",
      mailboxItemId: "mailbox_clinical_hung_retry",
    });
    expect(requestHandoff).toHaveBeenNthCalledWith(2, {
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_clinical_hung_retry",
      mailboxItemId: "mailbox_clinical_hung_retry",
    });
  });

  it("requests one wake per user when multiple pending mailbox kinds exist", async () => {
    const requestHandoff = vi.fn(async () => ({
      signalAccepted: true as const,
      workflowId: "hosted-user-runtime:synthetic",
    }));
    const hasActiveAccess = vi.fn(async () => true);

    const result = await runHostedPreferenceHandoffSweeper({
      hasActiveAccess,
      logger: buildLogger(),
      requestHandoff,
      store: buildStore([
        {
          mailboxItemId: "mailbox_preference_shared",
          userId: "member_shared",
        },
        {
          mailboxItemId: "mailbox_clinical_shared",
          userId: "member_shared",
        },
      ]),
    });

    expect(hasActiveAccess).toHaveBeenCalledTimes(1);
    expect(requestHandoff).toHaveBeenCalledTimes(1);
    expect(requestHandoff).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      expectedUserId: "member_shared",
      mailboxItemId: "mailbox_preference_shared",
    });
    expect(result.candidateUsers).toBe(1);
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
