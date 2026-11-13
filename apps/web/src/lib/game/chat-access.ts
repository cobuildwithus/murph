import "server-only";

import { HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX } from "@murphai/hosted-execution/runtime-control";
import { Prisma } from "@prisma/client";
import { hostedThreadContainerParticipantAccessCutoff } from "../hosted-groups/thread-container-participant-access";
import { HOSTED_HEALTH_DATA_CONSENT_SCOPE } from "../legal/consent";
import { gameOnSql, isGameEnabled } from "./access";

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
  const cutoff = hostedThreadContainerParticipantAccessCutoff(input.now);
  const settledCutoff = new Date(input.now.getTime() - GAME_CHAT_SETTLED_ACCESS_MS);
  const groupPlayers = Prisma.sql`EXISTS (SELECT 1 FROM game_player p WHERE p.game_id = game.id
      AND p.left_at IS NULL AND p.member_id = ANY(roster.member_ids))
    AND NOT EXISTS (SELECT 1 FROM game_player p WHERE p.game_id = game.id
      AND p.left_at IS NULL AND (p.member_id IS NULL OR NOT (p.member_id = ANY(roster.member_ids))))`;
  const restrictedMembers = Prisma.sql`(roster.member_ids || ARRAY(SELECT p.member_id FROM game_player p
    WHERE p.game_id = game.id AND p.member_id IS NOT NULL))`;
  const rows = await input.prisma.$queryRaw<Array<{ memberId: string; beneficiaryMemberId: string }>>(Prisma.sql`
    SELECT room.id AS "memberId", candidate.chat_container_member_id AS "beneficiaryMemberId"
    FROM hosted_member room
    JOIN hosted_thread_container container ON container.member_id = room.id
    JOIN LATERAL (
      SELECT array_agg(participant_member_id ORDER BY participant_member_id) AS member_ids
      FROM (
        SELECT participant_member_id, last_seen_at FROM hosted_thread_container_participant
        WHERE container_member_id = room.id AND removed_at IS NULL
        ORDER BY participant_member_id LIMIT ${HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX + 1}
      ) participants
      HAVING count(*) BETWEEN 1 AND ${HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX} AND bool_and(last_seen_at >= ${cutoff})
    ) roster ON TRUE
    LEFT JOIN LATERAL (
      -- Room eligibility follows its own bound game. Billing still follows the
      -- established primary for that game's pair, including duplicate rooms.
      SELECT CASE WHEN cardinality(roster.member_ids) = 2 THEN roster.member_ids ELSE (
        SELECT ARRAY(SELECT p.member_id FROM game_player p WHERE p.game_id = bound.id ORDER BY p.member_id)
        FROM game bound
        WHERE bound.max_players = 2 AND bound.chat_container_member_id = room.id
          AND cardinality(roster.member_ids) > 2
          AND (bound.status = 'live' OR (bound.status = 'negotiating'
            AND (bound.invite_expires_at IS NULL OR bound.invite_expires_at > ${input.now}))
            OR (bound.status = 'settled' AND bound.settled_at > ${settledCutoff} AND bound.settled_at <= ${input.now}))
          AND (SELECT count(*) FROM game_player p WHERE p.game_id = bound.id) = 2
          AND NOT EXISTS (SELECT 1 FROM game_player p WHERE p.game_id = bound.id
            AND (p.member_id IS NULL OR p.left_at IS NOT NULL OR NOT (p.member_id = ANY(roster.member_ids))))
        ORDER BY bound.created_at, bound.id LIMIT 1
      ) END AS member_ids
    ) pair ON TRUE
    JOIN LATERAL (
      SELECT COALESCE(
        (SELECT game.id FROM game WHERE game.max_players = 10
          AND game.chat_container_member_id = room.id
          AND (game.status IN ('invited', 'live') OR (game.status = 'settled' AND game.settled_at > ${settledCutoff} AND game.settled_at <= ${input.now}))
          AND ${groupPlayers}
          ORDER BY game.created_at DESC, game.id LIMIT 1),
        -- An addressed rematch temporarily funds only its inherited primary
        -- room while the one bound-room notice is still waiting.
        (SELECT rematch.id FROM game rematch
          WHERE rematch.max_players = 2 AND rematch.chat_container_member_id = room.id AND rematch.status = 'invited'
            AND (rematch.invite_expires_at IS NULL OR rematch.invite_expires_at > ${input.now})
            AND rematch.created_by = ANY(roster.member_ids)
            AND EXISTS (SELECT 1 FROM game_invitee invited WHERE invited.game_id = rematch.id AND invited.member_id = ANY(roster.member_ids) AND invited.member_id <> rematch.created_by)
            AND EXISTS (SELECT 1 FROM hosted_linq_delivery receipt
              WHERE receipt.source = 'game_lifecycle' AND receipt.source_ref = rematch.id
                AND receipt.template = 'game_rematch'
                AND receipt.status IN ('awaiting_generation', 'generation_queued')
                AND receipt.skipped_at IS NULL)
          ORDER BY rematch.created_at DESC, rematch.id LIMIT 1),
        -- Derive the pair from the indexed seats. Select one established
        -- primary room even when several games are live or still unbound.
        (SELECT active.id FROM game_player first_player
          JOIN game active ON active.id = first_player.game_id
          WHERE cardinality(pair.member_ids) = 2 AND active.max_players = 2 AND first_player.member_id = pair.member_ids[1]
            AND active.chat_container_member_id IS NOT NULL
            AND (active.status = 'live' OR (active.status = 'negotiating'
              AND (active.invite_expires_at IS NULL OR active.invite_expires_at > ${input.now})))
            AND EXISTS (SELECT 1 FROM game_player second_player
              WHERE second_player.game_id = active.id AND second_player.member_id = pair.member_ids[2])
          ORDER BY active.created_at, active.id LIMIT 1),
        (SELECT recent.id FROM game_player first_player
          JOIN game recent ON recent.id = first_player.game_id
          WHERE cardinality(pair.member_ids) = 2 AND recent.max_players = 2 AND first_player.member_id = pair.member_ids[1]
            AND recent.status = 'settled' AND recent.settled_at > ${settledCutoff} AND recent.settled_at <= ${input.now}
            AND EXISTS (SELECT 1 FROM game_player second_player
              WHERE second_player.game_id = recent.id AND second_player.member_id = pair.member_ids[2])
          ORDER BY recent.settled_at DESC, recent.id LIMIT 1),
        -- Cancellation releases its slot but keeps its already-bound room
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
                AND ((receipt.status = 'generation_queued' AND EXISTS (
                  -- The pending bootstrap can belong to another game in this same room.
                  SELECT 1 FROM game bootstrap
                  WHERE bootstrap.chat_container_member_id = room.id
                    AND (receipt.source_ref = bootstrap.id
                      OR (receipt.template IN ('game_change_cancelled', 'game_change_expired') AND starts_with(receipt.source_ref, bootstrap.id || ':')))
                    -- Keep the selected game's existing settled/cancellation eligibility.
                    AND (bootstrap.id = game.id OR (
                      (bootstrap.status = 'live' OR (bootstrap.status IN ('invited', 'negotiating')
                        AND (bootstrap.invite_expires_at IS NULL OR bootstrap.invite_expires_at > ${input.now})))
                      AND ((bootstrap.status = 'invited'
                          AND bootstrap.created_by = ANY(roster.member_ids)
                          AND EXISTS (SELECT 1 FROM game_invitee invited WHERE invited.game_id = bootstrap.id AND invited.member_id = ANY(roster.member_ids) AND invited.member_id <> bootstrap.created_by))
                        OR (bootstrap.status <> 'invited'
                          AND EXISTS (SELECT 1 FROM game_player p WHERE p.game_id = bootstrap.id AND p.seat = 0)
                          AND EXISTS (SELECT 1 FROM game_player p WHERE p.game_id = bootstrap.id AND p.seat = 1)
                          AND NOT EXISTS (SELECT 1 FROM game_player p
                            WHERE p.game_id = bootstrap.id AND (p.seat NOT IN (0, 1) OR p.member_id IS NULL OR p.left_at IS NOT NULL OR NOT (p.member_id = ANY(roster.member_ids))))))
                    ))))
                  OR receipt.payload_schema = 'game_chat_bootstrap_v1')
                AND receipt.bootstrap_route_attached_at IS NULL AND receipt.skipped_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM hosted_linq_delivery receipt
              WHERE receipt.payload_owner_member_id = room.id AND receipt.source = 'game_lifecycle'
                AND receipt.payload_schema = 'game_chat_bootstrap_v1' AND receipt.bootstrap_route_attached_at IS NOT NULL)))
        AND (game.status = 'live'
          OR (game.status IN ('invited', 'negotiating')
            AND (game.invite_expires_at IS NULL OR game.invite_expires_at > ${input.now})) OR
          (game.status = 'settled' AND game.settled_at > ${settledCutoff} AND game.settled_at <= ${input.now}) OR
          (game.status = 'void' AND game.chat_container_member_id = room.id))
        AND ((game.max_players = 10 AND ${groupPlayers}) OR (game.max_players = 2 AND (game.chat_container_member_id = room.id OR cardinality(pair.member_ids) = 2) AND ((game.status = 'invited'
              AND game.created_by = ANY(roster.member_ids)
              AND EXISTS (SELECT 1 FROM game_invitee invited WHERE invited.game_id = game.id AND invited.member_id = ANY(roster.member_ids) AND invited.member_id <> game.created_by))
          OR (game.status <> 'invited'
              AND EXISTS (SELECT 1 FROM game_player p WHERE p.game_id = game.id AND p.seat = 0)
              AND EXISTS (SELECT 1 FROM game_player p WHERE p.game_id = game.id AND p.seat = 1)
              AND NOT EXISTS (SELECT 1 FROM game_player p
                WHERE p.game_id = game.id AND (p.seat NOT IN (0, 1) OR p.member_id IS NULL OR p.left_at IS NOT NULL OR NOT (p.member_id = ANY(roster.member_ids))))))
        ))
        AND NOT EXISTS (SELECT 1 FROM game_block blocked
          WHERE blocked.blocker_member_id = ANY(${restrictedMembers}) AND blocked.blocked_member_id = ANY(${restrictedMembers}))
        AND ${gameOnSql()}
        AND NOT EXISTS (
          SELECT 1 FROM hosted_member person
          WHERE person.id = ANY(${restrictedMembers}) AND (
            person.suspended_at IS NOT NULL
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
