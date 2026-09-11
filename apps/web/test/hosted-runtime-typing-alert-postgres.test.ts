import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";

import {
  buildHostedRuntimeTypingAlertQuery,
  runHostedRuntimeTypingAlertMonitor,
} from "@/src/lib/hosted-runtime-latency/typing-alert-monitor";
import { deleteExpiredTypingAlerts } from "@/src/lib/hosted-retention/cleanup";
import { sendRecoverableHostedLinqAlertsBestEffort } from "@/src/lib/hosted-onboarding/linq-alert-email";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Typing alert PostgreSQL proof requires a local database.");
}
const now = new Date("2026-09-10T04:00:00.000Z");
const received = new Date(now.getTime() - 60_000);
const env = {
  RESEND_API_KEY: "synthetic-key",
  HOSTED_LINQ_ALERT_EMAIL_FROM: "Murph Alerts <alerts@example.test>",
  HOSTED_LINQ_ALERT_EMAILS: "ops@example.test",
};

describe.skipIf(!enabled)("per-message typing alert PostgreSQL proof", () => {
  it("uses strict webhook-to-first-typing thresholds across warm, cold, rollout, and missing observations", async () => {
    await withTables(async (tx) => {
      await insertTrace(tx, "warm-boundary", { elapsed: 3000 });
      await insertTrace(tx, "warm-slow", { elapsed: 3001 });
      await insertTrace(tx, "cold-boundary", { cold: true, elapsed: 10_000 });
      await insertTrace(tx, "cold-slow", { cold: true, elapsed: 10_001 });
      await insertTrace(tx, "retained-after-cold", { cold: true, restoredBeforeReceipt: true, elapsed: 3001 });
      await insertTrace(tx, "cold-fast", { cold: true, elapsed: 5000 });
      await insertTrace(tx, "rollout-slow", { cold: true, elapsed: 10_001,
        extra: { orchestration: { activeFenceTargetWasPriorVersion: true, replacedStaleFence: true } } });
      await insertTrace(tx, "missing-warm", { elapsed: null });
      await insertTrace(tx, "missing-cold", { cold: true, elapsed: null });
      await insertTrace(tx, "unconfirmed", { cold: null, elapsed: null });
      await insertTrace(tx, "early-hint", { cold: true, elapsed: 20_000 });
      await tx.$executeRaw`UPDATE hosted_ingress_latency_trace
        SET ingress_typing_accepted_at = ${new Date(received.getTime() + 500)}
        WHERE id = 'early-hint'`;
      await insertTrace(tx, "negative", { elapsed: -1 });
      await insertTrace(tx, "future", { elapsed: 100_000 });
      await insertTrace(tx, "legacy-no-receipt", { elapsed: 50_000, receivedAt: null });
      await insertTrace(tx, "telegram-slow", { source: "telegram", elapsed: 3001 });
      await insertTrace(tx, "telegram-fast", { source: "telegram", elapsed: 3000 });
      await insertTrace(tx, "telegram-active-followup", { source: "telegram", elapsed: -1000 });
      await insertTrace(tx, "telegram-missing", { source: "telegram", elapsed: null });
      await insertTrace(tx, "telegram-cold-fast", { source: "telegram", cold: true, elapsed: 10_000 });
      await insertTrace(tx, "telegram-cold-slow", { source: "telegram", cold: true, elapsed: 10_001 });
      await insertTrace(tx, "telemetry-in-flight", { elapsed: null, receivedAt: new Date(now.getTime() - 5000) });
      const rows = await tx.$queryRaw<Array<{ id: string; workspaceState: string; elapsedMs: bigint }>>(
        buildHostedRuntimeTypingAlertQuery({ now }),
      );
      expect(rows.map((row) => row.id).sort()).toEqual([
        "cold-slow", "missing-cold", "missing-warm", "retained-after-cold", "rollout-slow",
        "telegram-slow", "telegram-cold-slow", "telegram-missing", "unconfirmed", "warm-slow",
      ].map((id) => `runtime-typing/${id}`).sort());
      expect(rows.find((row) => row.id.endsWith("retained-after-cold"))?.workspaceState).toBe("warm");
      // Acceptance happens two seconds after webhook receipt; those seconds count.
      expect(rows.find((row) => row.id.endsWith("warm-slow"))?.elapsedMs).toBe(3001n);
      const scoped = await tx.$queryRaw<Array<{ id: string }>>(buildHostedRuntimeTypingAlertQuery({
        now, userId: "synthetic-member", assistantInputIds: ["input-warm-slow"],
      }));
      expect(scoped.map((row) => row.id)).toEqual(["runtime-typing/warm-slow"]);
    });
  });

  it.each(["linq", "telegram"] as const)("deduplicates %s emails and retries their frozen body through existing recovery", async (source) => {
    await withTables(async (tx) => {
      await insertTrace(tx, "first", { source, elapsed: 4000 });
      await insertTrace(tx, "second", { source, cold: true, elapsed: 11_000 });
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("failed", { status: 500 }));
      const first = await runHostedRuntimeTypingAlertMonitor({ env, fetchImpl, now, prisma: tx });
      expect(first.queuedCount).toBe(2);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const bodies = fetchImpl.mock.calls.map((call) => String(call[1]?.body));
      expect(bodies.join("\n")).not.toContain("synthetic-member");
      expect(bodies[0]).toContain("4000 ms");
      expect(bodies[1]).toContain("11000 ms");
      expect(bodies[0]).not.toContain("refreshed Linq service");
      expect(bodies[0]).toContain("ops@example.test");
      expect((await runHostedRuntimeTypingAlertMonitor({ env, fetchImpl, now, prisma: tx })).queuedCount).toBe(0);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ id: "synthetic-email" }), { status: 200 }));
      await sendRecoverableHostedLinqAlertsBestEffort({ env, fetchImpl, now, prisma: tx });
      expect(fetchImpl.mock.calls.slice(2).map((call) => String(call[1]?.body)).sort()).toEqual([...bodies].sort());
      expect(await tx.hostedLinqAlert.count({ where: { status: "sent" } })).toBe(2);
      await sendRecoverableHostedLinqAlertsBestEffort({ env, fetchImpl, now, prisma: tx });
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      await tx.hostedLinqAlert.update({ where: { id: "runtime-typing/second" }, data: { status: "failed" } });
      expect(await deleteExpiredTypingAlerts({ now: new Date(now.getTime() + 31 * 86_400_000), prisma: tx })).toBe(1);
      expect(await tx.hostedLinqAlert.count({ where: { status: "failed" } })).toBe(1);
    });
  });

  it("bounds a burst and advances beyond already queued alerts without dropping distinct messages", async () => {
    await withTables(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO hosted_ingress_latency_trace
          (id, user_id, source, accepted_at, webhook_received_at, phase_breakdown_json)
        SELECT 'burst-' || n, 'synthetic-member', 'linq', ${received}, ${received},
          jsonb_build_object('boot', jsonb_build_object('restoreWasCold', false))
        FROM generate_series(1, 1005) AS n
      `);
      const disabledEnv = {};
      expect(await runHostedRuntimeTypingAlertMonitor({ env: disabledEnv, now, prisma: tx })).toEqual({
        queuedCount: 1000, scanTruncated: true,
      });
      expect(await runHostedRuntimeTypingAlertMonitor({ env: disabledEnv, now, prisma: tx })).toEqual({
        queuedCount: 5, scanTruncated: false,
      });
      expect(await tx.hostedLinqAlert.count()).toBe(1005);
    });
  });
});

async function withTables(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }, { schema: "pg_temp" }),
  });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`CREATE TEMP TABLE hosted_ingress_latency_trace (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source TEXT NOT NULL,
        assistant_input_id TEXT, accepted_at TIMESTAMP(3), webhook_received_at TIMESTAMP(3),
        workspace_restore_done_at TIMESTAMP(3), ingress_typing_accepted_at TIMESTAMP(3), phase_breakdown_json JSONB
      ) ON COMMIT DROP`;
      await tx.$executeRaw`CREATE TEMP TABLE hosted_linq_alert (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        event_id TEXT, delivery_id TEXT, phone_number_lookup_key TEXT, phone_number_hint TEXT,
        subject TEXT NOT NULL, details_json JSONB NOT NULL, claimed_at TIMESTAMP(3) NOT NULL,
        last_attempted_at TIMESTAMP(3), sent_at TIMESTAMP(3), provider_message_id TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0, last_error_code TEXT, last_provider_status INTEGER,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ON COMMIT DROP`;
      await run(tx);
    }, { timeout: 60_000 });
  } finally {
    await prisma.$disconnect();
  }
}

async function insertTrace(tx: Prisma.TransactionClient, id: string, input: {
  cold?: boolean | null;
  elapsed: number | null;
  extra?: Prisma.InputJsonObject;
  receivedAt?: Date | null;
  restoredBeforeReceipt?: boolean;
  source?: "linq" | "telegram";
}) {
  const source = input.source ?? "linq";
  const receivedAt = input.receivedAt === undefined ? received : input.receivedAt;
  const restoredAt = new Date(received.getTime() + (input.restoredBeforeReceipt ? -10_000 : 1000));
  const phase = {
    boot: input.cold === null ? {} : { restoreWasCold: input.cold ?? false },
    assistant: input.elapsed === null ? {} : {
      [source === "linq" ? "linqTypingAcceptedAtEpochMs" : "telegramTypingAcceptedAtEpochMs"]:
        received.getTime() + input.elapsed,
    },
    ...input.extra,
  };
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO hosted_ingress_latency_trace
      (id, user_id, source, assistant_input_id, accepted_at, webhook_received_at,
       workspace_restore_done_at, phase_breakdown_json)
    VALUES (${id}, 'synthetic-member', ${source}, ${`input-${id}`},
      ${new Date(received.getTime() + 2000)}, ${receivedAt}, ${restoredAt},
      ${JSON.stringify(phase)}::jsonb)
  `);
}
