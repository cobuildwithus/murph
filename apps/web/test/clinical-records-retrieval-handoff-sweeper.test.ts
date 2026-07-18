import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn((query: unknown): Promise<Array<{
    laneSeq: bigint;
    mailboxItemId: string;
    memberId: string;
  }>> => {
    void query;
    return Promise.resolve([]);
  }),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ $queryRaw: mocks.queryRaw }),
}));

import {
  runHostedClinicalRetrievalHandoffSweeper,
} from "@/src/lib/clinical-records/retrieval-handoff-sweeper";

describe("Clinical Records retrieval handoff sweeper", () => {
  it("re-signals an unconsumed queued-run wake without logging private pointers", async () => {
    const logger = buildLogger();
    const requestHandoff = vi.fn(async () => ({
      signalAccepted: true as const,
      workflowId: "hosted-user-runtime:synthetic",
    }));
    const candidate = buildCandidate("accepted");

    const result = await runHostedClinicalRetrievalHandoffSweeper({
      hasActiveAccess: vi.fn(async () => true),
      logger,
      requestHandoff,
      store: buildStore([candidate]),
    });

    expect(requestHandoff).toHaveBeenCalledWith({
      expectedUserId: candidate.memberId,
      knownCheckpoint: {
        lane: "system",
        laneSeq: candidate.laneSeq.toString(),
        userId: candidate.memberId,
      },
      mailboxItemId: candidate.mailboxItemId,
    });
    expect(result).toEqual({
      candidateRuns: 1,
      handoffAccepted: 1,
      handoffAttempted: 1,
      handoffFailed: 0,
      handoffLimit: 25,
      handoffSkippedInactive: 0,
      skippedCandidateRuns: 0,
    });
    const logs = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
    ]);
    expect(logs).not.toContain(candidate.memberId);
    expect(logs).not.toContain(candidate.mailboxItemId);
  });

  it("leaves durable candidates retryable after failed signals", async () => {
    const store = buildStore([buildCandidate("retry")]);
    const requestHandoff = vi.fn()
      .mockRejectedValueOnce(new Error("signal unavailable"))
      .mockResolvedValueOnce({
        signalAccepted: true as const,
        workflowId: "hosted-user-runtime:synthetic",
      });
    const input = {
      hasActiveAccess: vi.fn(async () => true),
      logger: buildLogger(),
      requestHandoff,
      store,
    };

    await expect(runHostedClinicalRetrievalHandoffSweeper(input)).resolves.toMatchObject({
      handoffFailed: 1,
    });
    await expect(runHostedClinicalRetrievalHandoffSweeper(input)).resolves.toMatchObject({
      handoffFailed: 0,
      handoffAccepted: 1,
    });
    expect(requestHandoff).toHaveBeenCalledTimes(2);
  });

  it("skips inactive owners without consuming the active handoff limit", async () => {
    const inactive = buildCandidate("inactive");
    const active = buildCandidate("active");
    const requestHandoff = vi.fn(async () => ({
      signalAccepted: true as const,
      workflowId: "hosted-user-runtime:synthetic",
    }));

    const result = await runHostedClinicalRetrievalHandoffSweeper({
      handoffLimit: 1,
      hasActiveAccess: vi.fn(async (memberId) => memberId === active.memberId),
      logger: buildLogger(),
      requestHandoff,
      store: buildStore([inactive, active]),
    });

    expect(requestHandoff).toHaveBeenCalledTimes(1);
    expect(requestHandoff).toHaveBeenCalledWith(expect.objectContaining({
      mailboxItemId: active.mailboxItemId,
    }));
    expect(result).toMatchObject({
      handoffAccepted: 1,
      handoffAttempted: 1,
      handoffSkippedInactive: 1,
      skippedCandidateRuns: 0,
    });
  });

  it("selects only the exact active queued generation and unconsumed wake before LIMIT", async () => {
    mocks.queryRaw.mockResolvedValueOnce([buildCandidate("query")]);

    await runHostedClinicalRetrievalHandoffSweeper({
      hasActiveAccess: vi.fn(async () => true),
      logger: buildLogger(),
      requestHandoff: vi.fn(async () => ({
        signalAccepted: true as const,
        workflowId: "hosted-user-runtime:synthetic",
      })),
    });

    const query = mocks.queryRaw.mock.calls[0]?.[0] as {
      strings?: readonly string[];
    } | undefined;
    const sql = query?.strings?.join("?") ?? "";
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
    expect(sql).toContain('"member"."billing_status" = \'active\'');
    expect(sql).toContain('LIMIT ?');
  });
});

function buildCandidate(suffix: string) {
  return {
    laneSeq: 7n,
    mailboxItemId: `mailbox_clinical_${suffix}`,
    memberId: `member_clinical_${suffix}`,
  };
}

function buildStore(rows: ReturnType<typeof buildCandidate>[]) {
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
