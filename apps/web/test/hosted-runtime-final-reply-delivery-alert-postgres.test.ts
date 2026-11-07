import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedLinqDeliverySourceRefLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { deleteExpiredFinalReplyDeliveryAlerts } from "@/src/lib/hosted-retention/cleanup";
import {
  buildHostedFinalReplyDeliveryQuery,
  runHostedRuntimeFinalReplyDeliveryAlertMonitor,
} from "@/src/lib/hosted-runtime-latency/final-reply-delivery-alert-monitor";

const mocks = vi.hoisted(() => ({
  sendPendingHostedLinqAlertsBestEffort: vi.fn(async () => undefined),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-alert-email", () => ({
  sendPendingHostedLinqAlertsBestEffort: mocks.sendPendingHostedLinqAlertsBestEffort,
}));

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (runPostgresProof) {
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("Final reply delivery alert proof requires local PostgreSQL.");
  }
}

const NOW = new Date("2030-01-10T12:00:00.000Z");

async function createTables(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE hosted_linq_delivery (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_ref TEXT,
      thread_is_direct BOOLEAN,
      attempted_at TIMESTAMP(3) NOT NULL,
      accepted_at TIMESTAMP(3)
    ) ON COMMIT DROP
  `);
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE hosted_ingress_latency_trace (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      accepted_at TIMESTAMP(3) NOT NULL,
      linq_delivery_id TEXT,
      runtime_attempt_id TEXT,
      reply_runtime_attempt_id TEXT
    ) ON COMMIT DROP
  `);
  await tx.$executeRaw(Prisma.sql`
    CREATE TEMP TABLE hosted_linq_alert (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      event_id TEXT,
      delivery_id TEXT,
      phone_number_lookup_key TEXT,
      phone_number_hint TEXT,
      subject TEXT NOT NULL,
      details_json JSONB NOT NULL,
      claimed_at TIMESTAMP(3) NOT NULL,
      last_attempted_at TIMESTAMP(3),
      sent_at TIMESTAMP(3),
      provider_message_id TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_provider_status INTEGER,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP(3) NOT NULL
    ) ON COMMIT DROP
  `);
}

describe.skipIf(!runPostgresProof)("hosted final reply delivery alert PostgreSQL proof", () => {
  it("selects the bounded accepted page with linkage, attempts, and alert ownership", async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }, { schema: "pg_temp" }),
    });
    try {
      await prisma.$transaction(async (tx) => {
        await createTables(tx);
        const linkedRef = createHostedLinqDeliverySourceRefLookupKey("intent_linked");
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO hosted_linq_delivery
            (id, source, source_ref, thread_is_direct, attempted_at, accepted_at)
          VALUES
            ('linked', 'hosted_runtime_linq_delivery', ${linkedRef}, false,
             '2030-01-10 11:49:59.000', '2030-01-10 11:50:00.000'),
            ('unlinked', 'hosted_runtime_linq_delivery', 'ref_unlinked', NULL,
             '2030-01-10 11:40:00.000', '2030-01-10 11:40:01.000'),
            ('alerted', 'hosted_runtime_linq_delivery', 'ref_alerted', true,
             '2030-01-10 11:30:00.000', '2030-01-10 11:30:01.000'),
            ('webhook', 'webhook', 'ref_webhook', true,
             '2030-01-10 11:50:00.000', '2030-01-10 11:50:01.000'),
            ('too_old', 'hosted_runtime_linq_delivery', 'ref_old', true,
             '2030-01-10 09:00:00.000', '2030-01-10 09:00:01.000'),
            ('unaccepted', 'hosted_runtime_linq_delivery', 'ref_unaccepted', true,
             '2030-01-10 11:55:00.000', NULL),
            ('no_ref', 'hosted_runtime_linq_delivery', NULL, true,
             '2030-01-10 11:55:00.000', '2030-01-10 11:55:01.000')
        `);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO hosted_ingress_latency_trace
            (id, source, accepted_at, linq_delivery_id, runtime_attempt_id, reply_runtime_attempt_id)
          VALUES
            ('trace_1', 'linq', '2030-01-10 09:30:00.000', 'linked', 'attempt_original', 'attempt_retry'),
            ('trace_2', 'linq', '2030-01-10 11:49:00.000', 'linked', 'attempt_retry', 'attempt_retry'),
            ('trace_telegram', 'telegram', '2030-01-10 08:00:00.000', 'linked', 'attempt_other', NULL),
            ('trace_alerted', 'linq', '2030-01-10 11:29:00.000', 'alerted', 'attempt_alerted', NULL)
        `);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO hosted_linq_alert (id, kind, subject, details_json, claimed_at, updated_at)
          VALUES ('runtime-final-reply-delivery/alerted', 'runtime_final_reply_delivery_slow',
            'synthetic', '{}'::jsonb, '2030-01-10 11:35:00.000', '2030-01-10 11:35:00.000')
        `);

        const rows = await tx.$queryRaw<Record<string, unknown>[]>(buildHostedFinalReplyDeliveryQuery({
          now: NOW,
          windowStart: new Date(NOW.getTime() - 2 * 60 * 60_000),
        }));
        expect(rows.map((row) => row.id)).toEqual(["alerted", "unlinked", "linked"]);
        expect(rows[2]).toMatchObject({
          alertRecorded: false,
          earliestTraceAcceptedAt: new Date("2030-01-10T09:30:00.000Z"),
          replyRuntimeAttemptIds: ["attempt_retry"],
          runtimeAttemptIds: ["attempt_original", "attempt_retry"],
          sourceRef: linkedRef,
          threadIsDirect: false,
        });
        expect(rows[1]).toMatchObject({
          earliestTraceAcceptedAt: null,
          replyRuntimeAttemptIds: [],
          runtimeAttemptIds: [],
        });
        expect(rows[0]).toMatchObject({ alertRecorded: true });

        const replyRow = {
          at: "2030-01-10T11:49:51.000Z",
          attemptId: "attempt_original",
          id: "log_synthetic_reply",
          redactedJson: {
            deliveryIntentPresent: true,
            deliveryOutcomeKind: "queued",
            finalReplySelected: true,
            schema: "murph.assistant-turn-timing.v1",
            turnTimingDeliveryIntentId: "intent_linked",
            turnTimingProviderResultAtEpochMs: Date.parse("2030-01-10T11:49:50.000Z"),
            turnTimingStage: "reply-dispatched",
            type: "assistant.turn.timing",
          },
        };
        const listTimingLogs = vi.fn(async () => [replyRow]);
        const first = await runHostedRuntimeFinalReplyDeliveryAlertMonitor({
          listTimingLogs,
          now: NOW,
          prisma: tx as never,
        });
        expect(first).toMatchObject({ queuedCount: 1, timingScan: "complete" });
        expect(listTimingLogs).toHaveBeenCalledWith(expect.objectContaining({
          attemptIds: expect.arrayContaining(["attempt_original", "attempt_retry"]),
          from: new Date(Date.parse("2030-01-10T09:30:00.000Z") - 60_000),
        }));

        const second = await runHostedRuntimeFinalReplyDeliveryAlertMonitor({
          listTimingLogs,
          now: new Date(NOW.getTime() + 5 * 60_000),
          prisma: tx as never,
        });
        expect(second).toMatchObject({ counts: { alreadyAlertedCount: 1 }, queuedCount: 0 });
        const alerts = await tx.$queryRaw<{ id: string; status: string }[]>(Prisma.sql`
          SELECT id, status FROM hosted_linq_alert
          WHERE kind = 'runtime_final_reply_delivery_slow' ORDER BY id
        `);
        expect(alerts).toEqual([
          { id: "runtime-final-reply-delivery/alerted", status: "pending" },
          { id: "runtime-final-reply-delivery/linked", status: "pending" },
        ]);
        expect(mocks.sendPendingHostedLinqAlertsBestEffort).toHaveBeenCalledOnce();
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("retires only sent final reply alerts past retention", async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }, { schema: "pg_temp" }),
    });
    try {
      await prisma.$transaction(async (tx) => {
        await createTables(tx);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO hosted_linq_alert (id, kind, status, subject, details_json, claimed_at, updated_at)
          VALUES
            ('old_sent', 'runtime_final_reply_delivery_slow', 'sent', 's', '{}'::jsonb,
             '2029-11-01 00:00:00', '2029-11-01 00:00:00'),
            ('old_pending', 'runtime_final_reply_delivery_slow', 'pending', 's', '{}'::jsonb,
             '2029-11-01 00:00:00', '2029-11-01 00:00:00'),
            ('recent_sent', 'runtime_final_reply_delivery_slow', 'sent', 's', '{}'::jsonb,
             '2030-01-09 00:00:00', '2030-01-09 00:00:00'),
            ('old_typing', 'runtime_warm_typing_slow', 'sent', 's', '{}'::jsonb,
             '2029-11-01 00:00:00', '2029-11-01 00:00:00')
        `);

        expect(await deleteExpiredFinalReplyDeliveryAlerts({ now: NOW, prisma: tx })).toBe(1);
        const remaining = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT id FROM hosted_linq_alert ORDER BY id
        `);
        expect(remaining.map((row) => row.id)).toEqual(["old_pending", "old_typing", "recent_sent"]);
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
