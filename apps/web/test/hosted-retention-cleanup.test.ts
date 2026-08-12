import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const accountDeletionCleanupMocks = vi.hoisted(() => ({
  drainHostedAccountDeletionCleanupBatch: vi.fn(),
}));

vi.mock("@/src/lib/hosted-privacy/account-deletion-cleanup", () => ({
  drainHostedAccountDeletionCleanupBatch:
    accountDeletionCleanupMocks.drainHostedAccountDeletionCleanupBatch,
}));

import * as hostedRuntimeSignals from "@/src/lib/hosted-orchestration/signal-runtime";
import {
  HOSTED_CONTROL_ARTIFACT_RETENTION_BATCH_SIZE,
  HOSTED_CONTROL_ARTIFACT_RETENTION_MAX_BATCHES,
  HOSTED_DEVICE_WEBHOOK_TRACE_RETENTION_MS,
  HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE,
  HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS,
  HOSTED_INGRESS_LATENCY_TRACE_RETENTION_MS,
  HOSTED_LINQ_PROVIDER_EVENT_DIAGNOSTIC_RETENTION_MS,
  HOSTED_MAILBOX_RETENTION_MS,
  HOSTED_MAILBOX_STRUCTURAL_RETENTION_MS,
  HOSTED_RETENTION_BATCH_SIZE,
  HOSTED_RETENTION_MAX_BATCHES,
  HOSTED_STARTED_CONNECT_INTENT_RETENTION_GRACE_MS,
  HOSTED_WEB_SESSION_RETENTION_MS,
  runHostedRetentionCleanup,
} from "@/src/lib/hosted-retention/cleanup";

beforeEach(() => {
  accountDeletionCleanupMocks.drainHostedAccountDeletionCleanupBatch.mockReset();
  accountDeletionCleanupMocks.drainHostedAccountDeletionCleanupBatch.mockResolvedValue({
    completed: 0,
    failed: 0,
    pending: 0,
    selected: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function sqlOf(call: readonly unknown[]): string {
  return (call[0] as TemplateStringsArray).join("?");
}

function findRetentionCall(
  executeRaw: ReturnType<typeof vi.fn>,
  fragment: string,
): unknown[] {
  const call = executeRaw.mock.calls.find((candidate) =>
    sqlOf(candidate).includes(fragment)
  );
  if (!call) {
    throw new Error(`Expected retention SQL containing ${fragment}.`);
  }

  return call;
}

function findRetentionCalls(
  executeRaw: ReturnType<typeof vi.fn>,
  fragment: string,
): unknown[][] {
  return executeRaw.mock.calls.filter((candidate) =>
    sqlOf(candidate).includes(fragment)
  );
}

/** Every retention statement resolves to `0`, so each category runs one batch. */
function createRetentionPrisma(input?: {
  executeRaw?: ReturnType<typeof vi.fn>;
  queryRaw?: ReturnType<typeof vi.fn>;
}) {
  return {
    $executeRaw: input?.executeRaw ?? vi.fn().mockResolvedValue(0),
    $queryRaw: input?.queryRaw ?? vi.fn().mockResolvedValue([]),
    hostedComputerRun: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("hosted retention cleanup", () => {
  it("uses the retention-only runtime signal for due inactive workspaces", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const signalRetentionRecheck = vi.spyOn(
      hostedRuntimeSignals,
      "signalHostedRetentionRuntimeRecheck",
    ).mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_inactive",
    });
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        policyNonReplies: 0n,
        retired: 0n,
        tombstonesDeleted: 0n,
      }])
      .mockResolvedValueOnce([{ userId: "member_inactive" }]);
    const prisma = createRetentionPrisma({ queryRaw });

    await expect(runHostedRetentionCleanup({
      now,
      prisma: prisma as never,
    })).resolves.toMatchObject({
      inboxMediaRetentionRuntimeSignalFailures: 0,
      inboxMediaRetentionRuntimeSignalsSent: 1,
    });
    expect(signalRetentionRecheck).toHaveBeenCalledWith({
      abortSignal: expect.anything(),
      userId: "member_inactive",
    });
  });

  it("prunes every high-volume diagnostic table before signaling runtimes", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const countsByStatement = new Map<string, number>([
      ['DELETE FROM "hosted_connected_app_connect_intent"', 1],
      ['DELETE FROM "hosted_sensitive_action_challenge"', 2],
      ['DELETE FROM "device_connect_intent"', 3],
      ['DELETE FROM "device_oauth_session"', 4],
      ['DELETE FROM "clinical_record_connect_intent"', 5],
      ['DELETE FROM "clinical_record_oauth_session"', 6],
      ['DELETE FROM "hosted_web_internal_request_nonce"', 6],
      ['DELETE FROM "hosted_ingress_latency_trace"', 1],
      ['DELETE FROM "hosted_assistant_runtime_issue"', 2],
      ['DELETE FROM "device_webhook_trace"', 4],
      ['UPDATE "hosted_linq_provider_event"', 5],
    ]);
    const executeRaw = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "hosted_web_session"')) {
        return sql.includes('"expires_at" <') ? 4 : 5;
      }
      return [...countsByStatement]
        .find(([fragment]) => sql.includes(fragment))?.[1] ?? 0;
    });
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        policyNonReplies: 0n,
        retired: 7n,
        tombstonesDeleted: 3n,
      }])
      .mockResolvedValueOnce([
        { userId: "member_due_1" },
        { userId: "member_due_2" },
      ]);
    const signalRuntimeRecheck = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Temporal unavailable"));
    const prisma = createRetentionPrisma({
      executeRaw,
      queryRaw,
    });

    await expect(runHostedRetentionCleanup({
      now,
      prisma: prisma as never,
      signalRuntimeRecheck,
    })).resolves.toEqual({
      accountDeletionCleanup: {
        completed: 0,
        failed: 0,
        pending: 0,
        selected: 0,
      },
      compactedLinqProviderEventDiagnostics: 5,
      expiredAssistantRuntimeIssuesDeleted: 2,
      expiredCallbackRequestNoncesDeleted: 6,
      expiredClinicalRecordConnectIntentsDeleted: 5,
      expiredClinicalRecordOauthSessionsDeleted: 6,
      expiredComputerRunsCleanedUp: 0,
      expiredConnectedAppConnectIntentsDeleted: 1,
      expiredConversationPolicyNonRepliesRecorded: 0,
      expiredDeviceConnectIntentsDeleted: 3,
      expiredDeviceOauthSessionsDeleted: 4,
      expiredDeviceWebhookTracesDeleted: 4,
      expiredIngressLatencyTracesDeleted: 1,
      expiredMailboxContentRetired: 7,
      expiredMailboxTombstonesDeleted: 3,
      expiredSensitiveActionChallengesDeleted: 2,
      inboxMediaRetentionRuntimeSignalFailures: 1,
      inboxMediaRetentionRuntimeSignalsSent: 1,
      oldRuntimeLogsDeleted: 0,
      staleWebSessionsDeleted: 9,
    });
    expect(
      accountDeletionCleanupMocks.drainHostedAccountDeletionCleanupBatch,
    ).toHaveBeenCalledWith({ now, prisma });
    expect(
      accountDeletionCleanupMocks.drainHostedAccountDeletionCleanupBatch
        .mock.invocationCallOrder[0],
    ).toBeLessThan(executeRaw.mock.invocationCallOrder[0]!);

    const mailboxDeleteSql = String(queryRaw.mock.calls[0]?.[0].join("?"));
    expect(mailboxDeleteSql).toContain('UPDATE "hosted_mailbox_item"');
    expect(mailboxDeleteSql).toContain('DELETE FROM "hosted_mailbox_payload"');
    expect(mailboxDeleteSql).toContain('"content_retired_at"');
    expect(mailboxDeleteSql).toContain("'policy_non_reply.content_expired'");
    expect(mailboxDeleteSql).toContain("legacy_consumed_preferences");
    expect(mailboxDeleteSql).toContain(
      "eligible.\"lane_seq\" <= COALESCE(counter.\"consumed_seq\", 0)",
    );
    expect(mailboxDeleteSql).toContain(
      "DELETE FROM \"hosted_mailbox_item\" AS item",
    );
    expect(mailboxDeleteSql).toContain('UPDATE "hosted_mailbox_lane_counter"');
    expect(mailboxDeleteSql).toContain('"consumed_seq" = GREATEST');
    expect(mailboxDeleteSql).toContain('MIN(blocker."lane_seq") - 1');
    expect(mailboxDeleteSql.match(/FOR UPDATE SKIP LOCKED/g)).toHaveLength(2);
    expect(queryRaw.mock.calls[0]?.slice(1)).toEqual([
      now,
      new Date(now.getTime() - HOSTED_MAILBOX_RETENTION_MS),
      HOSTED_RETENTION_BATCH_SIZE,
      now,
      now,
      now,
      now,
      new Date(now.getTime() - HOSTED_MAILBOX_STRUCTURAL_RETENTION_MS),
      HOSTED_RETENTION_BATCH_SIZE,
    ]);

    // One statement per category: every short batch stops that category's loop.
    expect(executeRaw).toHaveBeenCalledTimes(13);

    const controlArtifactStatements = [
      {
        fragment: 'DELETE FROM "hosted_connected_app_connect_intent"',
        lockAlias: "intent",
        key: 'intent."claim_hash"',
      },
      {
        fragment: 'DELETE FROM "hosted_sensitive_action_challenge"',
        lockAlias: "challenge",
        key: 'challenge."token_hash"',
      },
      {
        fragment: 'DELETE FROM "device_connect_intent"',
        lockAlias: "intent",
        key: 'intent."claim_hash"',
      },
      {
        fragment: 'DELETE FROM "device_oauth_session"',
        lockAlias: "oauth_session",
        key: 'oauth_session."state"',
      },
      {
        fragment: 'DELETE FROM "clinical_record_connect_intent"',
        lockAlias: "intent",
        key: 'intent."claim_hash"',
      },
      {
        fragment: 'DELETE FROM "clinical_record_oauth_session"',
        lockAlias: "oauth_session",
        key: 'oauth_session."state_hash"',
      },
    ] as const;
    for (const statement of controlArtifactStatements) {
      const call = findRetentionCall(executeRaw, statement.fragment);
      const sql = sqlOf(call);
      expect(sql).toContain("doomed AS MATERIALIZED");
      expect(sql).toContain(`${statement.lockAlias}."expires_at" <= ?`);
      expect(sql).toContain(
        `ORDER BY ${statement.lockAlias}."expires_at" ASC, ${statement.key} ASC`,
      );
      expect(sql).toContain(
        `FOR UPDATE OF ${statement.lockAlias} SKIP LOCKED`,
      );
      expect(sql).toContain(`${statement.key} = doomed.`);
      const startedIntentOwner = statement.fragment
        === 'DELETE FROM "hosted_connected_app_connect_intent"'
        || statement.fragment === 'DELETE FROM "clinical_record_connect_intent"';
      if (startedIntentOwner) {
        expect(sql).toContain(`${statement.lockAlias}."started_at" IS NULL`);
        expect(sql).toContain(`OR ${statement.lockAlias}."expires_at" <= ?`);
        expect(call.slice(1)).toEqual([
          now,
          new Date(
            now.getTime() - HOSTED_STARTED_CONNECT_INTENT_RETENTION_GRACE_MS,
          ),
          HOSTED_CONTROL_ARTIFACT_RETENTION_BATCH_SIZE,
        ]);
      } else {
        expect(call.slice(1)).toEqual([
          now,
          HOSTED_CONTROL_ARTIFACT_RETENTION_BATCH_SIZE,
        ]);
      }
    }
    expect(
      sqlOf(findRetentionCall(
        executeRaw,
        'DELETE FROM "hosted_sensitive_action_challenge"',
      )),
    ).toContain('challenge."approval_key" IS NULL');

    const callbackNonceCall = findRetentionCall(
      executeRaw,
      'DELETE FROM "hosted_web_internal_request_nonce"',
    );
    expect(sqlOf(callbackNonceCall)).toContain(
      "WITH database_clock AS MATERIALIZED",
    );
    expect(sqlOf(callbackNonceCall)).toContain("doomed AS MATERIALIZED");
    expect(sqlOf(callbackNonceCall)).toContain("date_trunc(");
    expect(sqlOf(callbackNonceCall)).toContain("'milliseconds'");
    expect(sqlOf(callbackNonceCall)).toContain(
      "clock_timestamp() AT TIME ZONE 'UTC'",
    );
    expect(sqlOf(callbackNonceCall)).toContain(
      'WHERE request_nonce."expires_at" < database_clock."now"',
    );
    expect(sqlOf(callbackNonceCall)).toContain(
      'request_nonce."expires_at" ASC',
    );
    expect(sqlOf(callbackNonceCall)).toContain(
      'request_nonce."nonce_hash" ASC',
    );
    expect(sqlOf(callbackNonceCall)).toContain("LIMIT ?");
    expect(sqlOf(callbackNonceCall)).toContain(
      "FOR UPDATE OF request_nonce SKIP LOCKED",
    );
    expect(sqlOf(callbackNonceCall)).toContain(
      'WHERE request_nonce."nonce_hash" = doomed."nonce_hash"',
    );
    expect(callbackNonceCall.slice(1)).toEqual([
      HOSTED_RETENTION_BATCH_SIZE,
    ]);

    const latencyTraceCall = findRetentionCall(
      executeRaw,
      'DELETE FROM "hosted_ingress_latency_trace"',
    );
    expect(sqlOf(latencyTraceCall)).toContain('"accepted_at" <');
    expect(sqlOf(latencyTraceCall)).toContain('"updated_at" <');
    expect(latencyTraceCall.slice(1)).toEqual([
      new Date(now.getTime() - HOSTED_INGRESS_LATENCY_TRACE_RETENTION_MS),
      new Date(now.getTime() - HOSTED_INGRESS_LATENCY_TRACE_RETENTION_MS),
      HOSTED_RETENTION_BATCH_SIZE,
    ]);
    expect(
      findRetentionCall(executeRaw, 'DELETE FROM "hosted_assistant_runtime_issue"').slice(1),
    ).toEqual([now, HOSTED_RETENTION_BATCH_SIZE]);
    // `device_sync_signal` rows are the companion status read model, not
    // diagnostics, so retention must never touch them.
    expect(
      executeRaw.mock.calls.some((call) =>
        sqlOf(call).includes('device_sync_signal')
      ),
    ).toBe(false);

    // Only processed traces expire; an in-flight claim is still the duplicate gate.
    const webhookTraceCall = findRetentionCall(executeRaw, 'DELETE FROM "device_webhook_trace"');
    expect(sqlOf(webhookTraceCall)).toContain(`"status" = 'processed'`);
    expect(webhookTraceCall.slice(1)).toEqual([
      new Date(now.getTime() - HOSTED_DEVICE_WEBHOOK_TRACE_RETENTION_MS),
      HOSTED_RETENTION_BATCH_SIZE,
    ]);

    // Linq provider events are the durable webhook duplicate gate: their bulky
    // diagnostics are nulled, but the row itself must survive.
    const linqCall = findRetentionCall(executeRaw, 'UPDATE "hosted_linq_provider_event"');
    expect(sqlOf(linqCall)).toContain('"extraction_json" = NULL');
    expect(sqlOf(linqCall)).toContain('"payload_sanitized_json" = NULL');
    expect(sqlOf(linqCall)).toContain('"payload_shape_json" = NULL');
    expect(sqlOf(linqCall)).toContain("FOR UPDATE OF provider_event SKIP LOCKED");
    expect(linqCall.slice(1)).toEqual([
      new Date(now.getTime() - HOSTED_LINQ_PROVIDER_EVENT_DIAGNOSTIC_RETENTION_MS),
      HOSTED_RETENTION_BATCH_SIZE,
    ]);
    expect(
      executeRaw.mock.calls.some((call) =>
        sqlOf(call).includes('DELETE FROM "hosted_linq_provider_event"')
      ),
    ).toBe(false);

    const webSessionCalls = findRetentionCalls(
      executeRaw,
      'DELETE FROM "hosted_web_session"',
    );
    expect(webSessionCalls).toHaveLength(2);
    expect(sqlOf(webSessionCalls[0]!)).toContain('"expires_at" <');
    expect(sqlOf(webSessionCalls[1]!)).toContain('"revoked_at" <');
    for (const call of webSessionCalls) {
      expect(call.slice(1)).toEqual([
        new Date(now.getTime() - HOSTED_WEB_SESSION_RETENTION_MS),
        HOSTED_RETENTION_BATCH_SIZE,
      ]);
    }
    // Call 0 retires mailbox content; call 1 claims due workspaces.
    expect(queryRaw).toHaveBeenCalledTimes(2);
    const dueSql = String(queryRaw.mock.calls[1]?.[0].join("?"));
    expect(dueSql).toContain("WITH due AS");
    expect(dueSql).toContain('FROM "hosted_workspace"');
    expect(dueSql).toContain('"inbox_media_retention_wake_at" <=');
    expect(dueSql).toContain('"inbox_media_retention_signal_attempted_at" ASC NULLS FIRST');
    expect(dueSql).toContain('UPDATE "hosted_workspace"');
    expect(dueSql).toContain(
      'SET "inbox_media_retention_signal_attempted_at" = ?',
    );
    expect(dueSql).toContain('RETURNING "hosted_workspace"."user_id" AS "userId"');
    expect(dueSql).toContain(`LIMIT ?`);
    expect(dueSql).toContain("FOR UPDATE SKIP LOCKED");
    expect(queryRaw.mock.calls[1]?.slice(1)).toEqual([
      now,
      HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE,
      now,
    ]);
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      queryRaw.mock.invocationCallOrder[1],
    );
    // Every delete finishes before the runtime signals start, so cleanup work
    // never runs concurrently with the signal fan-out.
    expect(executeRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
      queryRaw.mock.invocationCallOrder[1]!,
    );
    expect(
      prisma.hostedComputerRun.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(queryRaw.mock.invocationCallOrder[1]!);
    expect(signalRuntimeRecheck).toHaveBeenCalledTimes(2);
    expect(signalRuntimeRecheck).toHaveBeenNthCalledWith(1, {
      abortSignal: expect.anything(),
      userId: "member_due_1",
    });
    expect(signalRuntimeRecheck).toHaveBeenNthCalledWith(2, {
      abortSignal: expect.anything(),
      userId: "member_due_2",
    });
    expect(prisma.hostedComputerRun.findMany).toHaveBeenCalledWith({
      orderBy: {
        updatedAt: "asc",
      },
      take: 25,
      where: {
        OR: [
          {
            expiresAt: { lte: now },
            status: { in: ["running", "awaiting_user", "cleanup_pending"] },
          },
          {
            kernelSessionId: { not: null },
            status: { in: ["completed", "failed", "expired", "canceled"] },
          },
        ],
      },
    });
  });

  it("keeps started connect intents through one bounded provider-continuation grace", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const executeRaw = vi.fn().mockResolvedValue(0);
    const prisma = createRetentionPrisma({ executeRaw });

    await runHostedRetentionCleanup({
      now,
      prisma: prisma as never,
      signalRuntimeRecheck: vi.fn(),
    });

    const cutoff = new Date(
      now.getTime() - HOSTED_STARTED_CONNECT_INTENT_RETENTION_GRACE_MS,
    );
    for (const fragment of [
      'DELETE FROM "hosted_connected_app_connect_intent"',
      'DELETE FROM "clinical_record_connect_intent"',
    ]) {
      const call = findRetentionCall(executeRaw, fragment);
      const sql = sqlOf(call);
      expect(sql).toContain('intent."expires_at" <= ?');
      expect(sql).toContain('intent."started_at" IS NULL');
      expect(sql).toContain('OR intent."expires_at" <= ?');
      expect(call.slice(1)).toEqual([
        now,
        cutoff,
        HOSTED_CONTROL_ARTIFACT_RETENTION_BATCH_SIZE,
      ]);
    }
  });

  it("records an explicit policy non-reply instead of silently dropping accepted work", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        policyNonReplies: 1n,
        retired: 3n,
        tombstonesDeleted: 0n,
      }])
      .mockResolvedValueOnce([]);
    const prisma = createRetentionPrisma({ queryRaw });
    await expect(runHostedRetentionCleanup({
      now,
      prisma: prisma as never,
      signalRuntimeRecheck: vi.fn(),
    })).resolves.toMatchObject({
      expiredConversationPolicyNonRepliesRecorded: 1,
      expiredMailboxContentRetired: 3,
    });
    const sql = String(queryRaw.mock.calls[0]?.[0].join("?"));
    expect(sql).toContain('"payload_inline_ciphertext" = NULL');
    expect(sql).toContain('"payload_ref" = NULL');
    expect(sql).toContain('"consumed_at" = CASE');
    expect(sql).toContain('FROM "hosted_member" AS member');
    expect(sql).toContain('member."assistant_tone_causal_seq"');
    expect(sql).toContain('member."assistant_unhinged_causal_seq"');
  });

  it("bounds mailbox retirement and structural pruning to the per-run ceiling", async () => {
    let mailboxBatches = 0;
    const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
      if (!strings.join("?").includes('UPDATE "hosted_mailbox_item"')) {
        return [];
      }
      mailboxBatches += 1;
      return [{
        policyNonReplies: 1n,
        retired: BigInt(HOSTED_RETENTION_BATCH_SIZE),
        tombstonesDeleted: BigInt(HOSTED_RETENTION_BATCH_SIZE),
      }];
    });
    const prisma = createRetentionPrisma({ queryRaw });

    await expect(runHostedRetentionCleanup({
      now: "2026-04-25T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      expiredConversationPolicyNonRepliesRecorded: HOSTED_RETENTION_MAX_BATCHES,
      expiredMailboxContentRetired:
        HOSTED_RETENTION_BATCH_SIZE * HOSTED_RETENTION_MAX_BATCHES,
      expiredMailboxTombstonesDeleted:
        HOSTED_RETENTION_BATCH_SIZE * HOSTED_RETENTION_MAX_BATCHES,
    });
    expect(mailboxBatches).toBe(HOSTED_RETENTION_MAX_BATCHES);
    for (const call of queryRaw.mock.calls.slice(0, mailboxBatches)) {
      expect(sqlOf(call).match(/LIMIT \?/g)).toHaveLength(2);
      const values: readonly unknown[] = call.slice(1);
      expect(values.filter((value) =>
        value === HOSTED_RETENTION_BATCH_SIZE
      )).toHaveLength(2);
    }
  });

  it("stops each category at its per-run batch ceiling", async () => {
    // A backlog that keeps returning full batches must not turn one hourly run
    // into an unbounded delete loop.
    let nonceBatches = 0;
    let traceBatches = 0;
    const executeRaw = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes('DELETE FROM "hosted_web_internal_request_nonce"')) {
        nonceBatches += 1;
        return HOSTED_RETENTION_BATCH_SIZE;
      }
      if (sql.includes('DELETE FROM "hosted_ingress_latency_trace"')) {
        traceBatches += 1;
        return HOSTED_RETENTION_BATCH_SIZE;
      }
      return 0;
    });
    const prisma = createRetentionPrisma({ executeRaw });

    await expect(runHostedRetentionCleanup({
      now: "2026-04-25T12:00:00.000Z",
      prisma: prisma as never,
    })).resolves.toMatchObject({
      expiredCallbackRequestNoncesDeleted:
        HOSTED_RETENTION_BATCH_SIZE * HOSTED_RETENTION_MAX_BATCHES,
      expiredIngressLatencyTracesDeleted:
        HOSTED_RETENTION_BATCH_SIZE * HOSTED_RETENTION_MAX_BATCHES,
    });
    expect(nonceBatches).toBe(HOSTED_RETENTION_MAX_BATCHES);
    expect(traceBatches).toBe(HOSTED_RETENTION_MAX_BATCHES);
  });

  it("caps aggregate short-lived control-artifact work across all six owners", async () => {
    const controlFragments = [
      'DELETE FROM "hosted_connected_app_connect_intent"',
      'DELETE FROM "hosted_sensitive_action_challenge"',
      'DELETE FROM "device_connect_intent"',
      'DELETE FROM "device_oauth_session"',
      'DELETE FROM "clinical_record_connect_intent"',
      'DELETE FROM "clinical_record_oauth_session"',
    ] as const;
    const executeRaw = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      return controlFragments.some((fragment) => sql.includes(fragment))
        ? HOSTED_CONTROL_ARTIFACT_RETENTION_BATCH_SIZE
        : 0;
    });
    const prisma = createRetentionPrisma({ executeRaw });

    const result = await runHostedRetentionCleanup({
      now: "2026-04-25T12:00:00.000Z",
      prisma: prisma as never,
    });
    const perOwnerCeiling =
      HOSTED_CONTROL_ARTIFACT_RETENTION_BATCH_SIZE
      * HOSTED_CONTROL_ARTIFACT_RETENTION_MAX_BATCHES;
    expect({
      clinicalConnect: result.expiredClinicalRecordConnectIntentsDeleted,
      clinicalOauth: result.expiredClinicalRecordOauthSessionsDeleted,
      connectedApp: result.expiredConnectedAppConnectIntentsDeleted,
      deviceConnect: result.expiredDeviceConnectIntentsDeleted,
      deviceOauth: result.expiredDeviceOauthSessionsDeleted,
      sensitiveAction: result.expiredSensitiveActionChallengesDeleted,
    }).toEqual({
      clinicalConnect: perOwnerCeiling,
      clinicalOauth: perOwnerCeiling,
      connectedApp: perOwnerCeiling,
      deviceConnect: perOwnerCeiling,
      deviceOauth: perOwnerCeiling,
      sensitiveAction: perOwnerCeiling,
    });
    const controlCalls = executeRaw.mock.calls.filter((call) =>
      controlFragments.some((fragment) => sqlOf(call).includes(fragment))
    );
    expect(controlCalls).toHaveLength(
      controlFragments.length
      * HOSTED_CONTROL_ARTIFACT_RETENTION_MAX_BATCHES,
    );
    expect(
      controlCalls.length * HOSTED_CONTROL_ARTIFACT_RETENTION_BATCH_SIZE,
    ).toBe(3_000);
  });

  it("runs retention categories one at a time", async () => {
    // Serial database use is the protection this job owes the primary pool.
    // Immediately-resolving mocks would keep passing after a parallel fan-out
    // regression, so hold the first statement open and prove nothing else runs.
    let releaseFirstStatement: () => void = () => undefined;
    const firstStatementHeld = new Promise<void>((resolve) => {
      releaseFirstStatement = resolve;
    });
    let startedStatements = 0;
    const executeRaw = vi.fn(async () => {
      startedStatements += 1;
      if (startedStatements === 1) {
        await firstStatementHeld;
      }
      return 0;
    });
    const prisma = createRetentionPrisma({ executeRaw });

    const cleanup = runHostedRetentionCleanup({
      now: "2026-04-25T12:00:00.000Z",
      prisma: prisma as never,
    });
    for (let tick = 0; tick < 50; tick += 1) {
      await Promise.resolve();
    }

    expect(startedStatements).toBe(1);
    releaseFirstStatement();
    await cleanup;
    expect(startedStatements).toBeGreaterThan(1);
  });

  it("finishes database cleanup before timing out stuck media-retention signals", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-04-25T12:00:00.000Z");
      const executeRaw = vi.fn().mockResolvedValue(1);
      const queryRaw = vi.fn()
        .mockResolvedValueOnce([{
          policyNonReplies: 0n,
          retired: 1n,
          tombstonesDeleted: 0n,
        }])
        .mockResolvedValueOnce([{ userId: "member_due_stuck" }]);
      const observedAbortSignals: AbortSignal[] = [];
      const signalRuntimeRecheck = vi.fn((input: {
        abortSignal?: AbortSignal;
        userId: string;
      }) => {
        if (input.abortSignal) {
          observedAbortSignals.push(input.abortSignal);
        }
        return new Promise(() => undefined);
      });
      const prisma = createRetentionPrisma({
        executeRaw,
        queryRaw,
      });

      const cleanup = runHostedRetentionCleanup({
        now,
        prisma: prisma as never,
        signalRuntimeRecheck,
      });

      for (let index = 0; index < 200 && queryRaw.mock.calls.length < 2; index += 1) {
        await Promise.resolve();
      }
      expect(queryRaw).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS);
      await expect(cleanup).resolves.toEqual({
        accountDeletionCleanup: {
          completed: 0,
          failed: 0,
          pending: 0,
          selected: 0,
        },
        compactedLinqProviderEventDiagnostics: 1,
        expiredAssistantRuntimeIssuesDeleted: 1,
        expiredCallbackRequestNoncesDeleted: 1,
        expiredClinicalRecordConnectIntentsDeleted: 1,
        expiredClinicalRecordOauthSessionsDeleted: 1,
        expiredComputerRunsCleanedUp: 0,
        expiredConnectedAppConnectIntentsDeleted: 1,
        expiredConversationPolicyNonRepliesRecorded: 0,
        expiredDeviceConnectIntentsDeleted: 1,
        expiredDeviceOauthSessionsDeleted: 1,
        expiredDeviceWebhookTracesDeleted: 1,
        expiredIngressLatencyTracesDeleted: 1,
        expiredMailboxContentRetired: 1,
        expiredMailboxTombstonesDeleted: 0,
        expiredSensitiveActionChallengesDeleted: 1,
        inboxMediaRetentionRuntimeSignalFailures: 1,
        inboxMediaRetentionRuntimeSignalsSent: 0,
        oldRuntimeLogsDeleted: 0,
        staleWebSessionsDeleted: 2,
      });
      expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        queryRaw.mock.invocationCallOrder[1],
      );
      expect(executeRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
        queryRaw.mock.invocationCallOrder[1]!,
      );
      expect(
        prisma.hostedComputerRun.findMany.mock.invocationCallOrder[0],
      ).toBeLessThan(queryRaw.mock.invocationCallOrder[1]!);
      expect(signalRuntimeRecheck).toHaveBeenCalledWith({
        abortSignal: expect.anything(),
        userId: "member_due_stuck",
      });
      expect(observedAbortSignals[0]?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  }, HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_TIMEOUT_MS + 1_000);

  it("starts one five-signal wave and contains synchronous adapter faults", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const workspaces = Array.from(
      { length: HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE },
      (_, index) => ({ userId: `member_due_${index + 1}` }),
    );
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        policyNonReplies: 0n,
        retired: 0n,
        tombstonesDeleted: 0n,
      }])
      .mockResolvedValueOnce(workspaces);
    let releaseSignals: () => void = () => undefined;
    const signalGate = new Promise<void>((resolve) => {
      releaseSignals = resolve;
    });
    const signalRuntimeRecheck = vi.fn((input: {
      abortSignal?: AbortSignal;
      userId: string;
    }) => {
      if (input.userId === workspaces[0]!.userId) {
        throw new Error("synchronous runtime adapter failure");
      }
      return signalGate;
    });
    const prisma = createRetentionPrisma({ queryRaw });

    const cleanup = runHostedRetentionCleanup({
      now,
      prisma: prisma as never,
      signalRuntimeRecheck,
    });

    for (
      let tick = 0;
      tick < 200
      && signalRuntimeRecheck.mock.calls.length
        < HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE;
      tick += 1
    ) {
      await Promise.resolve();
    }
    expect(signalRuntimeRecheck).toHaveBeenCalledTimes(
      HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE,
    );
    expect(
      signalRuntimeRecheck.mock.calls.map(([input]) => input.userId),
    ).toEqual(workspaces.map((workspace) => workspace.userId));

    releaseSignals();
    await expect(cleanup).resolves.toMatchObject({
      inboxMediaRetentionRuntimeSignalFailures: 1,
      inboxMediaRetentionRuntimeSignalsSent:
        HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE - 1,
    });
  });

  it("rotates failed media-retention signal attempts past the oldest batch", async () => {
    const now = new Date("2026-04-25T12:00:00.000Z");
    const nextHour = new Date("2026-04-25T13:00:00.000Z");
    const workspaces = Array.from(
      { length: HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE + 1 },
      (_, index) => ({
        attemptedAt: null as Date | null,
        userId: `member_due_${String(index + 1).padStart(2, "0")}`,
        wakeAt: now,
      }),
    );
    const queryRaw = vi.fn(async (
      sql: TemplateStringsArray,
      dueAt: Date,
      limit: number,
      attemptedAt: Date,
    ) => {
      // The mailbox delete shares $queryRaw with the due-workspace claim, so
      // branch on the statement rather than on call order.
      if (sql.join("?").includes('UPDATE "hosted_mailbox_item"')) {
        return [{
          policyNonReplies: 0n,
          retired: 0n,
          tombstonesDeleted: 0n,
        }];
      }
      const selected = workspaces
        .filter((workspace) => workspace.wakeAt <= dueAt)
        .sort((left, right) => {
          const leftAttemptedAt = left.attemptedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
          const rightAttemptedAt = right.attemptedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
          if (leftAttemptedAt !== rightAttemptedAt) {
            return leftAttemptedAt - rightAttemptedAt;
          }
          if (left.wakeAt.getTime() !== right.wakeAt.getTime()) {
            return left.wakeAt.getTime() - right.wakeAt.getTime();
          }
          return left.userId.localeCompare(right.userId);
        })
        .slice(0, limit);
      for (const workspace of selected) {
        workspace.attemptedAt = attemptedAt;
      }
      return selected.map((workspace) => ({ userId: workspace.userId }));
    });
    const signalRuntimeRecheck = vi.fn(async (input: { userId: string }) => {
      void input.userId;
      throw new Error("runtime unavailable");
    });
    const prisma = createRetentionPrisma({ queryRaw });

    await expect(runHostedRetentionCleanup({
      now,
      prisma: prisma as never,
      signalRuntimeRecheck,
    })).resolves.toMatchObject({
      inboxMediaRetentionRuntimeSignalFailures: HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE,
      inboxMediaRetentionRuntimeSignalsSent: 0,
    });
    await expect(runHostedRetentionCleanup({
      now: nextHour,
      prisma: prisma as never,
      signalRuntimeRecheck,
    })).resolves.toMatchObject({
      inboxMediaRetentionRuntimeSignalFailures: HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE,
      inboxMediaRetentionRuntimeSignalsSent: 0,
    });

    const firstRunUserIds = signalRuntimeRecheck.mock.calls
      .slice(0, HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE)
      .map(([input]) => input.userId);
    const secondRunUserIds = signalRuntimeRecheck.mock.calls
      .slice(HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE)
      .map(([input]) => input.userId);
    const deferredUserId =
      `member_due_${String(HOSTED_INBOX_MEDIA_RETENTION_SIGNAL_BATCH_SIZE + 1)
        .padStart(2, "0")}`;
    expect(firstRunUserIds).not.toContain(deferredUserId);
    expect(secondRunUserIds).toContain(deferredUserId);
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });
});
