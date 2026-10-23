import "server-only";

import { Prisma } from "@prisma/client";
import { hostedThreadContainerParticipantAccessCutoff } from "../hosted-groups/thread-container-participant-access";
import { HOSTED_HEALTH_DATA_CONSENT_SCOPE } from "../legal/consent";
import { parseCommaSeparatedList } from "../primitives";
import { isGameEnabled } from "./access";

export const GAME_CHAT_SETTLED_ACCESS_MS = 7 * 86_400_000;

/** Admission only. Game tools and message delivery independently verify the
 * complete current provider roster before sharing game content. */
export async function readGameChatFundingRooms(input: {
  memberIds: readonly string[];
  now: Date;
  prisma: Pick<Prisma.TransactionClient, "$queryRaw">;
}): Promise<Map<string, string>> {
  const memberIds = [...new Set(input.memberIds)];
  if (!isGameEnabled() || memberIds.length === 0) return new Map();
  const allowlist = parseCommaSeparatedList(process.env.MURPH_GAME_MEMBER_ALLOWLIST);
  const cutoff = hostedThreadContainerParticipantAccessCutoff(input.now);
  const settledCutoff = new Date(input.now.getTime() - GAME_CHAT_SETTLED_ACCESS_MS);
  const rows = await input.prisma.$queryRaw<Array<{ memberId: string; beneficiaryMemberId: string }>>(Prisma.sql`
    SELECT room.id AS "memberId", candidate.chat_container_member_id AS "beneficiaryMemberId"
    FROM hosted_member room
    JOIN hosted_thread_container container ON container.member_id = room.id
    JOIN LATERAL (
      SELECT array_agg(participant_member_id ORDER BY participant_member_id) AS player_ids
      FROM (
        SELECT participant_member_id, last_seen_at FROM hosted_thread_container_participant
        WHERE container_member_id = room.id AND removed_at IS NULL
        ORDER BY participant_member_id LIMIT 3
      ) roster
      HAVING count(*) = 2 AND bool_and(last_seen_at >= ${cutoff})
    ) pair ON TRUE
    JOIN LATERAL (
      SELECT COALESCE(
        -- A live/negotiating pair is uniquely reserved. Resolve it directly;
        -- repeated prior games do not add work to the active-game path.
        (SELECT id FROM game WHERE live_roster_key = array_to_string(pair.player_ids, ':')
          AND status IN ('negotiating', 'live')),
        (SELECT recent.id FROM game_player first_player
          JOIN game recent ON recent.id = first_player.game_id
          WHERE first_player.member_id = pair.player_ids[1]
            AND recent.status = 'settled' AND recent.settled_at > ${settledCutoff} AND recent.settled_at <= ${input.now}
            AND EXISTS (SELECT 1 FROM game_player second_player
              WHERE second_player.game_id = recent.id AND second_player.member_id = pair.player_ids[2])
          ORDER BY recent.settled_at DESC, recent.id LIMIT 1),
        -- Cancellation releases the pair but keeps its already-bound room
        -- available until the reserved notice reaches provider dispatch.
        (SELECT cancelled.id FROM game cancelled
          WHERE cancelled.chat_container_member_id = room.id AND cancelled.status = 'void'
            AND EXISTS (SELECT 1 FROM game_event event
              WHERE event.game_id = cancelled.id AND event.type IN ('cancelled', 'change_expired')
                AND event.created_at > ${settledCutoff} AND event.created_at <= ${input.now})
            AND EXISTS (SELECT 1 FROM hosted_linq_delivery receipt
              WHERE receipt.source = 'game_lifecycle'
                AND ((receipt.source_ref = cancelled.id AND receipt.template = 'game_cancelled')
                  OR (starts_with(receipt.source_ref, cancelled.id || ':') AND receipt.template = 'game_change_expired'))
                AND receipt.status IN ('awaiting_generation', 'generation_queued')
                AND receipt.skipped_at IS NULL)
          ORDER BY cancelled.created_at DESC, cancelled.id LIMIT 1)
      ) AS game_id
    ) matched ON TRUE
    JOIN LATERAL (
      SELECT game.chat_container_member_id
      FROM game
      JOIN hosted_member primary_room ON primary_room.id = game.chat_container_member_id
      JOIN hosted_thread_container primary_container ON primary_container.member_id = primary_room.id
      WHERE game.id = matched.game_id AND primary_room.suspended_at IS NULL
        AND (EXISTS (SELECT 1 FROM hosted_thread_route route
              WHERE route.container_member_id = room.id AND route.channel = 'linq')
          OR (room.id = game.chat_container_member_id
            AND NOT EXISTS (SELECT 1 FROM hosted_thread_route route WHERE route.container_member_id = room.id)
            AND EXISTS (SELECT 1 FROM hosted_linq_delivery receipt
              WHERE receipt.payload_owner_member_id = room.id AND receipt.source = 'game_lifecycle'
                AND ((receipt.status = 'generation_queued' AND (receipt.source_ref = game.id
                    OR (receipt.template IN ('game_change_cancelled', 'game_change_expired') AND starts_with(receipt.source_ref, game.id || ':'))))
                  OR receipt.payload_schema = 'game_chat_bootstrap_v1')
                AND receipt.bootstrap_route_attached_at IS NULL AND receipt.skipped_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM hosted_linq_delivery receipt
              WHERE receipt.payload_owner_member_id = room.id AND receipt.source = 'game_lifecycle'
                AND receipt.payload_schema = 'game_chat_bootstrap_v1' AND receipt.bootstrap_route_attached_at IS NOT NULL)))
        AND (game.status IN ('negotiating', 'live') OR
          (game.status = 'settled' AND game.settled_at > ${settledCutoff} AND game.settled_at <= ${input.now}) OR
          (game.status = 'void' AND game.chat_container_member_id = room.id))
        AND EXISTS (SELECT 1 FROM game_player p WHERE p.game_id = game.id AND p.seat = 0)
        AND EXISTS (SELECT 1 FROM game_player p WHERE p.game_id = game.id AND p.seat = 1)
        AND NOT EXISTS (
          SELECT 1 FROM game_player p
          JOIN hosted_member person ON person.id = p.member_id
          WHERE p.game_id = game.id AND (
            p.seat NOT IN (0, 1) OR NOT (p.member_id = ANY(pair.player_ids)) OR person.suspended_at IS NOT NULL
            ${allowlist.length ? Prisma.sql`OR p.member_id NOT IN (${Prisma.join(allowlist)})` : Prisma.empty}
            OR EXISTS (SELECT 1 FROM hosted_consent_grant consent
              WHERE consent.member_id = person.id AND consent.scope = ${HOSTED_HEALTH_DATA_CONSENT_SCOPE}
                AND consent.status = 'revoked')
          )
        )
    ) candidate ON TRUE
    WHERE room.id IN (${Prisma.join(memberIds)}) AND room.suspended_at IS NULL
  `);
  return new Map(rows.map(row => [row.memberId, row.beneficiaryMemberId]));
}
