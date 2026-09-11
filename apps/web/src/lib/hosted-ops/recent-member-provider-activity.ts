import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";

export interface HostedRecentMemberProviderActivity {
  memberId: string;
  messagesLast7Days: number;
  messagesToday: number;
  lastMessageAt: Date | null;
}

export async function readHostedRecentMemberProviderActivity(input: {
  memberIds: readonly string[];
  now: Date;
  start: Date;
  todayStart: Date;
  prisma: Pick<PrismaClient, "$queryRaw">;
}): Promise<HostedRecentMemberProviderActivity[]> {
  if (input.memberIds.length === 0) return [];
  if (input.memberIds.length > 20) throw new TypeError("Recent member activity is limited to 20 accounts.");
  // Only currently owned private home/pending chats are eligible. A provider
  // message that already has a mailbox receipt contributes through that owner.
  // No private payloads are read and no analytics-only mailbox work is created.
  return input.prisma.$queryRaw<HostedRecentMemberProviderActivity[]>(Prisma.sql`
    WITH chats AS (
      SELECT member_id, linq_chat_lookup_key AS chat_key
      FROM hosted_member_routing WHERE member_id IN (${Prisma.join([...input.memberIds])})
      UNION
      SELECT member_id, pending_linq_chat_lookup_key AS chat_key
      FROM hosted_member_routing WHERE member_id IN (${Prisma.join([...input.memberIds])})
    ), messages AS (
      SELECT chats.member_id, event.message_lookup_key, MIN(event.received_at) AS received_at
      FROM chats JOIN hosted_linq_provider_event event ON event.linq_chat_lookup_key = chats.chat_key
      WHERE event.event_type = 'message.received' AND event.direction = 'inbound'
        AND event.message_lookup_key IS NOT NULL
        AND event.received_at >= ${input.start} AND event.received_at < ${input.now}
        AND NOT EXISTS (
          SELECT 1 FROM hosted_mailbox_item mailbox
          WHERE mailbox.user_id = chats.member_id AND mailbox.kind = 'conversation.message'
            AND mailbox.source_message_lookup_key = event.message_lookup_key
        )
      GROUP BY chats.member_id, event.message_lookup_key
    )
    SELECT member_id AS "memberId", COUNT(*)::int AS "messagesLast7Days",
      (COUNT(*) FILTER (WHERE received_at >= ${input.todayStart}))::int AS "messagesToday",
      MAX(received_at) AS "lastMessageAt"
    FROM messages GROUP BY member_id
  `);
}
