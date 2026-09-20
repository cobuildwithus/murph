import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";

import {
  buildHostedRuntimeTypingAlertQuery,
  runHostedRuntimeTypingAlertMonitor,
} from "@/src/lib/hosted-runtime-latency/typing-alert-monitor";
import { linkHostedIngressLatencyTracesToAcceptedLinqDelivery } from "@/src/lib/hosted-runtime-latency/store";
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
      await insertTrace(tx, "cold-boundary", { cold: true, elapsed: 8_000 });
      await insertTrace(tx, "cold-slow", { cold: true, elapsed: 8_001 });
      await insertTrace(tx, "retained-after-cold", { cold: true, restoredBeforeReceipt: true, elapsed: 3001 });
      await insertTrace(tx, "cold-fast", { cold: true, elapsed: 5000 });
      await insertTrace(tx, "rollout-slow", { cold: true, elapsed: 8_001,
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
      await insertTrace(tx, "telegram-cold-fast", { source: "telegram", cold: true, elapsed: 8_000 });
      await insertTrace(tx, "telegram-cold-slow", { source: "telegram", cold: true, elapsed: 8_001 });
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

  it("resolves synthetic instant replies through the production delivery link and leaves failed sends alertable", async () => {
    await withTables(async (tx) => {
      for (const id of ["instant-accepted", "instant-failed", "instant-ordinary"]) {
        await insertTrace(tx, id, { elapsed: null });
      }
      await insertDelivery(tx, "delivery-instant", "chat-instant", 2500);
      await insertDelivery(tx, "delivery-failed", "chat-failed", null);
      const readAlerts = () => tx.$queryRaw<Array<{ id: string }>>(buildHostedRuntimeTypingAlertQuery({ now }));
      expect((await readAlerts()).map((row) => row.id)).toContain("runtime-typing/instant-accepted");
      // Synthetic outbound contexts have no source-message routing key or typing
      // observation. Only their exact provider-accepted delivery answers them.
      for (const [id, deliveryId] of [["instant-accepted", "delivery-instant"], ["instant-failed", "delivery-failed"]] as const) {
        await expect(linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
          authenticatedUserId: "synthetic-member",
          answeredMailboxItemIds: [`mailbox-${id}`],
          linqDeliveryId: deliveryId,
          prisma: tx,
          replyRuntimeAttemptId: null,
        })).resolves.toEqual({ matchedCount: 1, recorded: true });
      }
      expect((await readAlerts()).map((row) => row.id).sort()).toEqual([
        "runtime-typing/instant-failed", "runtime-typing/instant-ordinary",
      ]);
      await expect(linkHostedIngressLatencyTracesToAcceptedLinqDelivery({
        authenticatedUserId: "synthetic-member",
        answeredMailboxItemIds: ["mailbox-instant-accepted"],
        linqDeliveryId: "delivery-competing",
        prisma: tx,
        replyRuntimeAttemptId: null,
      })).resolves.toEqual({ matchedCount: 0, recorded: false });
      expect(await tx.$queryRaw`SELECT reply_runtime_attempt_id, linq_delivery_id
        FROM hosted_ingress_latency_trace WHERE id = 'instant-accepted'`).toEqual([
        { reply_runtime_attempt_id: null, linq_delivery_id: "delivery-instant" },
      ]);
    });
  });

  it.each(["linq", "telegram"] as const)("excludes completed silent %s inputs without hiding slow typing or unresolved work", async (source) => {
    await withTables(async (tx) => {
      const terminalMs = received.getTime() + 12_000;
      for (const [id, marker] of [
        ["silent-warm", terminalMs], ["silent-cold", terminalMs],
        ["silent-unconfirmed", terminalMs], ["missing-marker", null],
        ["before-receipt", received.getTime() - 1],
        ["before-acceptance", received.getTime() + 1000],
        ["future-marker", now.getTime() + 1], ["text-marker", String(terminalMs)],
        ["object-marker", {}], ["fraction-marker", terminalMs + 0.5],
        ["oversized-marker", 1e20], ["later-staging", terminalMs],
        ["later-provider", terminalMs], ["earlier-provider", terminalMs], ["slow-typing", terminalMs],
        ["slow-ingress-typing", terminalMs], ["other-input", null],
      ] as const) {
        await insertTrace(tx, id, {
          source, cold: id === "silent-unconfirmed" ? null : id === "silent-cold",
          elapsed: id === "slow-typing" ? 4000 : null,
          extra: { assistant: {
            terminalNonReplyCommittedAtEpochMs: marker,
            ...(id === "slow-typing" ? {
              [source === "linq" ? "linqTypingAcceptedAtEpochMs" : "telegramTypingAcceptedAtEpochMs"]:
                received.getTime() + 4000,
            } : {}),
          } },
        });
      }
      await tx.$executeRaw`UPDATE hosted_ingress_latency_trace
        SET assistant_input_staged_at = ${new Date(terminalMs + 1)} WHERE id = 'later-staging'`;
      await tx.$executeRaw`UPDATE hosted_ingress_latency_trace
        SET provider_start_at = ${new Date(terminalMs + 1)} WHERE id = 'later-provider'`;
      await tx.$executeRaw`UPDATE hosted_ingress_latency_trace
        SET provider_start_at = ${new Date(terminalMs - 1)} WHERE id = 'earlier-provider'`;
      await tx.$executeRaw`UPDATE hosted_ingress_latency_trace
        SET ingress_typing_accepted_at = ${new Date(received.getTime() + 4000)} WHERE id = 'slow-ingress-typing'`;
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
        new Response(JSON.stringify({ id: "synthetic-email" }), { status: 200 }));
      expect(await runHostedRuntimeTypingAlertMonitor({ env, fetchImpl, now, prisma: tx })).toEqual({
        queuedCount: 14, scanTruncated: false,
      });
      const alerts = await tx.hostedLinqAlert.findMany({ select: { id: true, status: true } });
      expect(alerts.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        "before-acceptance", "before-receipt", "earlier-provider", "fraction-marker", "future-marker", "later-provider",
        "later-staging", "missing-marker", "object-marker", "other-input", "oversized-marker",
        "slow-ingress-typing", "slow-typing", "text-marker",
      ].map((id) => ({ id: `runtime-typing/${id}`, status: "sent" })));
      expect(fetchImpl).toHaveBeenCalledTimes(14);
    });
  });

  it("measures post-send silence and preserves active typing and conversation isolation", async () => {
    await withTables(async (tx) => {
      for (const id of ["sent", "missing-sent", "other-chat", "failed-send", "late-send",
        "active", "expired", "finished", "other-member", "unknown-route"]) {
        await insertTrace(tx, id, { elapsed: id === "missing-sent" ? null : 9000 });
        if (id !== "unknown-route") await bindConversation(tx, id, `chat-${id}`);
      }
      await insertDelivery(tx, "sent", "chat-sent", 5000);
      await insertDelivery(tx, "missing-sent", "chat-missing-sent", 15_000);
      await insertDelivery(tx, "unrelated", "chat-unrelated", 1000);
      await insertDelivery(tx, "failed", "chat-failed-send", null);
      await insertDelivery(tx, "late", "chat-late-send", 10_000);
      for (const id of ["active", "expired", "finished", "other-member"]) {
        const ageMs = id === "expired" ? 301_000 : 2000;
        await insertTrace(tx, `prior-${id}`, {
          elapsed: -ageMs,
          receivedAt: new Date(received.getTime() - ageMs - 1000),
        });
        await bindConversation(tx, `prior-${id}`, `chat-${id}`);
      }
      await insertDelivery(tx, "finished", "chat-finished", -500);
      await tx.$executeRaw`UPDATE hosted_ingress_latency_trace
        SET linq_delivery_id = 'finished' WHERE id = 'prior-finished'`;
      await tx.$executeRaw`UPDATE hosted_mailbox_item SET user_id = 'other-member'
        WHERE id = 'mailbox-prior-other-member'`;
      await tx.$executeRaw`UPDATE hosted_ingress_latency_trace SET user_id = 'other-member'
        WHERE id = 'prior-other-member'`;
      const rows = await tx.$queryRaw<Array<{ id: string }>>(buildHostedRuntimeTypingAlertQuery({ now }));
      expect(rows.map((row) => row.id).sort()).toEqual([
        "expired", "failed-send", "finished", "late-send", "missing-sent", "other-chat", "other-member", "sent", "unknown-route",
      ].map((id) => `runtime-typing/${id}`).sort());
    });
  });

  it("restarts pending silence after replies and after earlier typing ends", async () => {
    await withTables(async (tx) => {
      for (const id of ["gap", "boundary", "repeated", "missing", "recent", "answered", "answered-typed",
        "prior-ended", "prior-expired", "cold-gap", "cold-boundary"]) {
        await insertTrace(tx, id, {
          elapsed: ["missing", "recent", "answered"].includes(id) ? null
            : id.startsWith("cold-") ? 11_000 : 9000,
          cold: id.startsWith("cold-"),
        });
        await bindConversation(tx, id, `chat-${id}`);
      }
      await insertDelivery(tx, "gap-reply", "chat-gap", 2000);
      await insertDelivery(tx, "boundary-reply", "chat-boundary", 6000);
      await insertDelivery(tx, "repeated-first", "chat-repeated", 2000);
      await insertDelivery(tx, "repeated-last", "chat-repeated", 6500);
      await insertDelivery(tx, "missing-reply", "chat-missing", 2000);
      await insertDelivery(tx, "recent-reply", "chat-recent", 58_000);
      await insertDelivery(tx, "answer", "chat-answered", 2000);
      await tx.$executeRaw`UPDATE hosted_ingress_latency_trace
        SET linq_delivery_id = 'answer' WHERE id = 'answered'`;
      await insertDelivery(tx, "typed-answer", "chat-answered-typed", 2000);
      await tx.$executeRaw`UPDATE hosted_ingress_latency_trace
        SET linq_delivery_id = 'typed-answer' WHERE id = 'answered-typed'`;
      await insertDelivery(tx, "cold-gap-reply", "chat-cold-gap", 2000);
      await insertDelivery(tx, "cold-boundary-reply", "chat-cold-boundary", 3000);
      for (const [id, age] of [["prior-ended", 2000], ["prior-expired", 298_000]] as const) {
        await insertTrace(tx, `${id}-earlier`, {
          elapsed: -age, receivedAt: new Date(received.getTime() - age - 1000),
        });
        await bindConversation(tx, `${id}-earlier`, `chat-${id}`);
      }
      await insertDelivery(tx, "prior-answer", "chat-prior-ended", 2000);
      await tx.$executeRaw`UPDATE hosted_ingress_latency_trace
        SET linq_delivery_id = 'prior-answer' WHERE id = 'prior-ended-earlier'`;
      const rows = await tx.$queryRaw<Array<{ id: string; elapsedMs: bigint }>>(
        buildHostedRuntimeTypingAlertQuery({ now }),
      );
      expect(rows.map(({ id, elapsedMs }) => [id, elapsedMs]).sort()).toEqual([
        ["runtime-typing/cold-gap", 9000n],
        ["runtime-typing/gap", 7000n],
        ["runtime-typing/missing", 58_000n],
        ["runtime-typing/prior-ended", 7000n],
        ["runtime-typing/prior-expired", 7000n],
      ]);
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
        new Response(JSON.stringify({ id: "synthetic-email" }), { status: 200 }));
      await runHostedRuntimeTypingAlertMonitor({
        env, fetchImpl, now, prisma: tx, userId: "synthetic-member", assistantInputIds: ["input-gap"],
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const body = String(fetchImpl.mock.calls[0]?.[1]?.body);
      expect(body).toContain("Silence measured from: 2026-09-10T03:59:02.000Z");
      expect(body).toContain("Wait without typing or a reply: 7000 ms");
      expect(body).not.toContain("Webhook-to-typing wait");
    });
  });

  it.each(["linq", "telegram"] as const)("excludes usage-denied %s inputs while alerting on other slow inputs for the same member", async (source) => {
    await withTables(async (tx) => {
      const usageDeniedAt = new Date(received.getTime() + 1500);
      await insertTrace(tx, "denied-warm", { source, elapsed: null, usageDeniedAt });
      await insertTrace(tx, "denied-cold", { source, cold: true, elapsed: null, usageDeniedAt });
      await insertTrace(tx, "denied-unconfirmed", { source, cold: null, elapsed: null, usageDeniedAt });
      await insertTrace(tx, "denied-later-typing", { source, elapsed: 20_000, usageDeniedAt });
      await insertTrace(tx, "allowed-slow", { source, elapsed: 4000 });
      await insertTrace(tx, "allowed-missing", { source, cold: null, elapsed: null });

      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
        new Response(JSON.stringify({ id: "synthetic-email" }), { status: 200 }));
      expect(await runHostedRuntimeTypingAlertMonitor({ env, fetchImpl, now, prisma: tx })).toEqual({
        queuedCount: 2, scanTruncated: false,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const alerts = await tx.hostedLinqAlert.findMany({ select: { id: true, status: true } });
      expect(alerts.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        { id: "runtime-typing/allowed-missing", status: "sent" },
        { id: "runtime-typing/allowed-slow", status: "sent" },
      ]);
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
      await tx.$executeRaw`CREATE TEMP TABLE hosted_mailbox_item (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_message_lookup_key TEXT, ai_usage_denied_at TIMESTAMP(3),
        lane TEXT NOT NULL DEFAULT 'conversation', lane_seq BIGINT NOT NULL DEFAULT 1,
        kind TEXT NOT NULL DEFAULT 'conversation.message', created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
      ) ON COMMIT DROP`;
      await tx.$executeRaw`CREATE TEMP TABLE hosted_ingress_latency_trace (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source TEXT NOT NULL, mailbox_item_id TEXT UNIQUE,
        mailbox_lane TEXT, mailbox_lane_seq BIGINT, runtime_attempt_id TEXT, reply_runtime_attempt_id TEXT,
        created_at TIMESTAMP(3), updated_at TIMESTAMP(3),
        assistant_input_id TEXT, linq_delivery_id TEXT, accepted_at TIMESTAMP(3), webhook_received_at TIMESTAMP(3),
        workspace_restore_done_at TIMESTAMP(3), ingress_typing_accepted_at TIMESTAMP(3),
        assistant_input_staged_at TIMESTAMP(3), provider_start_at TIMESTAMP(3), phase_breakdown_json JSONB
      ) ON COMMIT DROP`;
      await tx.$executeRaw`CREATE TEMP TABLE hosted_linq_provider_event (
        message_lookup_key TEXT, linq_chat_lookup_key TEXT, provider_created_at TIMESTAMP(3)
      ) ON COMMIT DROP`;
      await tx.$executeRaw`CREATE TEMP TABLE hosted_linq_delivery (
        id TEXT PRIMARY KEY, linq_chat_lookup_key TEXT, attempted_at TIMESTAMP(3), accepted_at TIMESTAMP(3)
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
  usageDeniedAt?: Date;
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
  const mailboxItemId = `mailbox-${id}`;
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO hosted_mailbox_item (id, user_id, ai_usage_denied_at)
    VALUES (${mailboxItemId}, 'synthetic-member', ${input.usageDeniedAt ?? null})
  `);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO hosted_ingress_latency_trace
      (id, user_id, source, mailbox_item_id, assistant_input_id, accepted_at, webhook_received_at,
       workspace_restore_done_at, phase_breakdown_json)
    VALUES (${id}, 'synthetic-member', ${source}, ${mailboxItemId}, ${`input-${id}`},
      ${new Date(received.getTime() + 2000)}, ${receivedAt}, ${restoredAt},
      ${JSON.stringify(phase)}::jsonb)
  `);
}

async function bindConversation(tx: Prisma.TransactionClient, traceId: string, chat: string) {
  await tx.$executeRaw`UPDATE hosted_mailbox_item
    SET source_message_lookup_key = ${`message-${traceId}`} WHERE id = ${`mailbox-${traceId}`}`;
  await tx.$executeRaw`INSERT INTO hosted_linq_provider_event
    (message_lookup_key, linq_chat_lookup_key, provider_created_at)
    SELECT ${`message-${traceId}`}, ${chat}, webhook_received_at
    FROM hosted_ingress_latency_trace WHERE id = ${traceId}`;
}

async function insertDelivery(tx: Prisma.TransactionClient, id: string, chat: string, offsetMs: number | null) {
  const acceptedAt = offsetMs === null ? null : new Date(received.getTime() + offsetMs);
  await tx.$executeRaw`INSERT INTO hosted_linq_delivery
    (id, linq_chat_lookup_key, attempted_at, accepted_at)
    VALUES (${id}, ${chat}, ${acceptedAt ?? received}, ${acceptedAt})`;
}
