import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "@/src/lib/prisma";
import { readHostedStarterAbuseHealth } from "@/src/lib/hosted-execution/starter-abuse-alert-monitor";
import { readHostedRecentMemberProviderActivity } from "@/src/lib/hosted-ops/recent-member-provider-activity";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) throw new Error("Local PostgreSQL required.");
const now = new Date("2026-08-20T12:00:00Z");
describe.skipIf(!enabled)("Starter and Growth SQL boundaries", () => {
  it("counts pre-activation receipt identities once and excludes mailbox, outbound, foreign, and old messages", async () => {
    const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE hosted_member_routing (member_id text, linq_chat_lookup_key text, pending_linq_chat_lookup_key text) ON COMMIT DROP`);
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE hosted_linq_provider_event (event_type text, direction text, message_lookup_key text, linq_chat_lookup_key text, received_at timestamp) ON COMMIT DROP`);
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE hosted_mailbox_item (user_id text, kind text, source_message_lookup_key text) ON COMMIT DROP`);
        await tx.$executeRawUnsafe(`INSERT INTO hosted_member_routing VALUES ('member_a', 'chat_a', 'chat_a'), ('member_b', null, 'chat_b')`);
        await tx.$executeRawUnsafe(`INSERT INTO hosted_linq_provider_event VALUES
          ('message.received','inbound','message_one','chat_a','2026-08-20 10:00'),
          ('message.received','inbound','message_one','chat_a','2026-08-20 10:01'),
          ('message.received','inbound','message_two','chat_a','2026-08-19 10:00'),
          ('message.received','inbound','message_mailbox','chat_a','2026-08-20 11:00'),
          ('message.sent','outbound','message_out','chat_a','2026-08-20 11:15'),
          ('message.received','inbound','message_other','chat_b','2026-08-20 11:20'),
          ('message.received','inbound','message_old','chat_a','2026-08-01 10:00'),
          ('message.received','inbound',null,'chat_a','2026-08-20 11:30')`);
        await tx.$executeRawUnsafe(`INSERT INTO hosted_mailbox_item VALUES ('member_a','conversation.message','message_mailbox')`);
        const input = { memberIds: ["member_a"], now, todayStart: new Date("2026-08-20T00:00:00Z"), start: new Date("2026-08-13T12:00:00Z"), prisma: tx };
        await expect(readHostedRecentMemberProviderActivity(input)).resolves.toEqual([{ memberId: "member_a", messagesLast7Days: 2, messagesToday: 1, lastMessageAt: new Date("2026-08-20T10:00:00Z") }]);
        await tx.$executeRawUnsafe(`INSERT INTO hosted_mailbox_item VALUES ('member_a','conversation.message','message_one')`);
        await expect(readHostedRecentMemberProviderActivity(input)).resolves.toEqual([{ memberId: "member_a", messagesLast7Days: 1, messagesToday: 0, lastMessageAt: new Date("2026-08-19T10:00:00Z") }]);
      });
    } finally { await prisma.$disconnect(); }
  });
  it("detects signup bursts and rapid canonical Starter-grant use with bounded accounts", async () => {
    const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE hosted_member (id text, created_at timestamp) ON COMMIT DROP`);
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE hosted_usage_credit_entry (id text, beneficiary_member_id text, kind text, semantic_source_key text, amount_usd_micros bigint, beneficiary_sequence bigint) ON COMMIT DROP`);
        await tx.$executeRawUnsafe(`CREATE TEMP TABLE hosted_usage_credit_grant (entry_id text, remaining_usd_micros bigint) ON COMMIT DROP`);
        await tx.$executeRaw(Prisma.sql`INSERT INTO hosted_member SELECT 'member_' || n, ${new Date("2026-08-20T11:50:00Z")} FROM generate_series(1,10) n`);
        await tx.$executeRawUnsafe(`INSERT INTO hosted_usage_credit_entry SELECT 'grant_' || id, id, 'starter_grant', 'hosted-starter-usage:' || id || ':v1', 4500000, 1 FROM hosted_member`);
        await tx.$executeRawUnsafe(`INSERT INTO hosted_usage_credit_grant SELECT id, 4500000 FROM hosted_usage_credit_entry`);
        await expect(readHostedStarterAbuseHealth({ now, prisma: tx })).resolves.toMatchObject({ anomalous: true, recentSignups: 10, rapidUseAccounts: 0 });
        await tx.$executeRawUnsafe(`UPDATE hosted_member SET created_at = '2026-08-20 11:30'`);
        await expect(readHostedStarterAbuseHealth({ now, prisma: tx })).resolves.toMatchObject({ anomalous: false, recentSignups: 0 });
        await tx.$executeRawUnsafe(`UPDATE hosted_usage_credit_grant SET remaining_usd_micros = 2250000 WHERE entry_id IN ('grant_member_1','grant_member_2','grant_member_3')`);
        await expect(readHostedStarterAbuseHealth({ now, prisma: tx })).resolves.toMatchObject({ anomalous: true, rapidUseAccounts: 3 });
        await tx.$executeRawUnsafe(`UPDATE hosted_member SET created_at = '2026-08-20 10:30'`);
        await expect(readHostedStarterAbuseHealth({ now, prisma: tx })).resolves.toMatchObject({ anomalous: false, rapidUseAccounts: 0, recentSignups: 0 });
      });
    } finally { await prisma.$disconnect(); }
  });
});
