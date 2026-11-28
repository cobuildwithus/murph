import "server-only";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../prisma";
import { playableGroupIds } from "./group-invites";
import { areGameGroupsEnabled } from "../game/access";
import { visibleHealthCommentSql, visibleHealthPersonSql, visibleHealthPostSql } from "../health-wins/audience";

export type SocialKind = "cheer" | "workingOnCheer" | "comment" | "reply" | "ticket" | "joined" | "challenge";
export interface SocialRow {
  kind: SocialKind;
  id: string;
  target: string;
  at: Date;
  actors: string[];
  count: number;
  owed: boolean | null;
}

export async function socialRows(member: string, from: Date, now: Date, zone: string, contactKeys: string[], working: boolean) {
  const db = getPrisma();
  const liveGroups = await playableGroupIds(db, member, contactKeys, zone, from, now);
  const visible = (actor: Prisma.Sql) => visibleHealthPersonSql(member, actor);
  const query = Prisma.sql`
    WITH relevant_comments AS (
      SELECT c.id FROM health_post mine JOIN health_post_comment c ON c.post_id = mine.id
      WHERE mine.author_member_id = ${member} AND mine.deleted_at IS NULL AND c.deleted_at IS NULL
        AND c.created_at BETWEEN ${from} AND ${now}
      UNION
      SELECT c.id FROM health_post_comment mine JOIN health_post_comment c
        ON c.post_id = mine.post_id AND c.parent_comment_id = mine.id
      WHERE mine.author_member_id = ${member} AND mine.deleted_at IS NULL AND c.deleted_at IS NULL
        AND c.created_at BETWEEN ${from} AND ${now}
    ), events(kind, event, target, at, actor, owed) AS (
      SELECT 'cheer', NULL::text, p.id::text, ch.created_at, ch.member_id, NULL::boolean
      FROM health_post p JOIN health_post_cheer ch ON ch.post_id = p.id
      WHERE p.author_member_id = ${member} AND ch.created_at BETWEEN ${from} AND ${now}
        AND ${visibleHealthPostSql(member)} AND ${visible(Prisma.sql`ch.member_id`)}
      UNION ALL
      SELECT 'workingOnCheer', NULL, ch.factor, ch.created_at, ch.member_id, NULL
      FROM health_working_on_cheer ch WHERE ${working} AND ch.owner_id = ${member}
        AND ch.created_at BETWEEN ${from} AND ${now} AND ${visible(Prisma.sql`ch.member_id`)}
      UNION ALL
      SELECT CASE WHEN parent.author_member_id = ${member} THEN 'reply' ELSE 'comment' END,
        c.id::text, p.id::text, c.created_at, c.author_member_id, NULL
      FROM relevant_comments ids JOIN health_post_comment c ON c.id = ids.id JOIN health_post p ON p.id = c.post_id
      LEFT JOIN health_post_comment parent ON parent.id = c.parent_comment_id AND parent.post_id = p.id
      WHERE ${visibleHealthCommentSql(member)}
      UNION ALL
      SELECT 'joined', game.id || ':' || partner.member_id, game.id, partner.joined_at AT TIME ZONE 'UTC', partner.member_id, NULL
      FROM game JOIN game_player partner ON partner.game_id = game.id
      JOIN game_player own ON own.game_id = game.id AND own.member_id = ${member}
      WHERE game.created_by = ${member} AND game.status IN ('live','settled')
        AND own.left_at IS NULL AND partner.left_at IS NULL AND own.joined_at IS NOT NULL
        AND partner.joined_at BETWEEN (${from}::timestamptz AT TIME ZONE 'UTC') AND (${now}::timestamptz AT TIME ZONE 'UTC')
        AND ${visible(Prisma.sql`partner.member_id`)}
      UNION ALL
      SELECT 'ticket', t.id, game.id, t.created_at AT TIME ZONE 'UTC', other.member_id, own.seat = ANY(t.owed_by_seats)
      FROM game_player own JOIN game ON game.id = own.game_id JOIN game_ticket t ON t.game_id = game.id
      JOIN game_player other ON other.game_id = game.id
      WHERE own.member_id = ${member} AND own.left_at IS NULL AND other.left_at IS NULL AND t.status = 'open'
        AND ((own.seat = ANY(t.owed_to_seats) AND other.seat = ANY(t.owed_by_seats))
          OR (own.seat = ANY(t.owed_by_seats) AND other.seat = ANY(t.owed_to_seats)))
        AND t.created_at BETWEEN (${from}::timestamptz AT TIME ZONE 'UTC') AND (${now}::timestamptz AT TIME ZONE 'UTC')
        AND ${visible(Prisma.sql`other.member_id`)}
      UNION ALL
      SELECT 'challenge', g.id, g.id, g.created_at AT TIME ZONE 'UTC', g.created_by, NULL
      FROM game_invitee i JOIN game g ON g.id = i.game_id
      WHERE (i.member_id = ${member} OR (i.member_id IS NULL AND i.recipient_lookup_key = ANY(${contactKeys}::text[])))
        AND (g.max_players = 2 OR ${areGameGroupsEnabled()}) AND (g.status = 'invited' OR (g.status = 'live' AND g.id = ANY(${liveGroups}::text[]))) AND g.invite_token_encrypted IS NOT NULL
        AND g.created_at BETWEEN (${from}::timestamptz AT TIME ZONE 'UTC') AND (${now}::timestamptz AT TIME ZONE 'UTC')
        AND (g.status = 'live' OR g.invite_expires_at IS NULL OR g.invite_expires_at > (${now}::timestamptz AT TIME ZONE 'UTC') + COALESCE(g.dev_clock_offset_ms, 0) * interval '1 millisecond')
        AND NOT EXISTS (SELECT 1 FROM game_player p WHERE p.game_id = g.id AND (p.member_id = ${member} OR p.seat = i.seat))
        AND NOT EXISTS (SELECT 1 FROM game_event e WHERE e.game_id = g.id AND (e.type = 'cancelled' OR (e.type = 'invite_dismissed' AND e.actor = ${member})))
        AND ${visible(Prisma.sql`g.created_by`)}
    ), unique_actors AS (
      SELECT kind, coalesce(event, target || ':' || to_char(at AT TIME ZONE ${zone}, 'YYYY-MM-DD')) AS key,
        target, actor, max(at) AS at, owed FROM events WHERE actor <> ${member} GROUP BY 1,2,3,4,6
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY kind, key ORDER BY at DESC, actor) AS position FROM unique_actors
    )
    SELECT kind, kind || ':' || key AS id, target, max(at) AS at,
      array_agg(actor ORDER BY position) FILTER (WHERE position <= 2) AS actors, count(*)::int AS count, owed
    FROM ranked GROUP BY kind, key, target, owed ORDER BY max(at) DESC, id LIMIT 99`;
  return db.$transaction(async tx => {
    // The audience predicates make the planner estimate a costly query even on a tiny inbox.
    // Compile-free execution keeps these bounded interactive reads fast.
    await tx.$executeRaw`SET LOCAL jit = off`;
    return tx.$queryRaw<SocialRow[]>(query);
  });
}
