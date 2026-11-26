import "server-only";
import { Prisma } from "@prisma/client";
import { activeHostedPersonAccessSql } from "../hosted-onboarding/member-access-projections";
import { hostedLaunchConsentGrantedSql } from "../legal/consent";
import { healthFeedMemberIds } from "./flag";

type Db = Pick<Prisma.TransactionClient, "$queryRaw">;

type PostAccess = "content" | "includeOwnerReceipt";

function healthAuthorSql(memberId: Prisma.Sql, receiptOwner?: string) {
  return Prisma.sql`EXISTS (SELECT 1 FROM hosted_member author WHERE author.id = ${memberId}
    AND author.id = ANY(${healthFeedMemberIds()}::text[])
    AND ${activeHostedPersonAccessSql(Prisma.sql`author`)}
    AND (${receiptOwner === undefined ? Prisma.empty : Prisma.sql`author.id = ${receiptOwner} OR`}
      ${hostedLaunchConsentGrantedSql(Prisma.sql`author.id`)}))`;
}

function unblockedSql(first: string | Prisma.Sql, subject: Prisma.Sql, hides: "both" | "bySubject" = "both") {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM game_block b WHERE
      (b.blocker_member_id = ${first} AND b.blocked_member_id = ${subject}) OR
      (b.blocked_member_id = ${first} AND b.blocker_member_id = ${subject}))
    AND NOT EXISTS (SELECT 1 FROM health_feed_hide h WHERE
      (h.member_id = ${subject} AND h.hidden_member_id = ${first})
      ${hides === "both" ? Prisma.sql`OR (h.member_id = ${first} AND h.hidden_member_id = ${subject})` : Prisma.empty})`;
}

/** Same games and seats as friendCohortIds, with the partner relation kept in PostgreSQL. */
function healthPartnersSql(member: string | Prisma.Sql, subject?: Prisma.Sql) {
  return Prisma.sql`SELECT b.member_id FROM game_player a
    JOIN game_player b ON b.game_id = a.game_id
    JOIN game g ON g.id = a.game_id
    WHERE a.member_id = ${member} AND b.member_id IS NOT NULL
      ${subject ? Prisma.sql`AND b.member_id = ${subject}` : Prisma.empty}
      AND a.joined_at IS NOT NULL AND b.joined_at IS NOT NULL AND a.left_at IS NULL AND b.left_at IS NULL
      AND g.status IN ('live', 'settled')
      AND NOT EXISTS (SELECT 1 FROM game_event e WHERE e.game_id = g.id AND e.type = 'cancelled')`;
}

function healthPersonAllowedSql(viewerId: string, subject: Prisma.Sql, access: PostAccess) {
  return Prisma.sql`${unblockedSql(viewerId, subject)}
    AND ${healthAuthorSql(subject, access === "includeOwnerReceipt" ? viewerId : undefined)}`;
}

/** A hide can identify someone the viewer could see through a game or a comment before hiding them. */
export function hiddenHealthIdentitySql(viewerId: string, subject: Prisma.Sql) {
  return Prisma.sql`${unblockedSql(viewerId, subject, "bySubject")} AND ${healthAuthorSql(subject)}
    AND (EXISTS (${healthPartnersSql(viewerId, subject)}) OR EXISTS (
      SELECT 1 FROM health_post_comment c JOIN health_post p ON p.id = c.post_id
      WHERE c.author_member_id = ${subject} AND ${visibleCommentContextSql(viewerId)}
    ))`;
}

export function eligibleHealthAuthorsSql(viewerId: string) {
  return Prisma.sql`SELECT partner.member_id FROM
    (SELECT ${viewerId}::text AS member_id UNION ${healthPartnersSql(viewerId)}) partner
    WHERE ${healthPersonAllowedSql(viewerId, Prisma.sql`partner.member_id`, "includeOwnerReceipt")}`;
}

export function visibleHealthPersonSql(viewerId: string, subject: Prisma.Sql, access: PostAccess = "content") {
  return Prisma.sql`(${subject} = ${viewerId} OR EXISTS (${healthPartnersSql(viewerId, subject)}))
    AND ${healthPersonAllowedSql(viewerId, subject, access)}`;
}

/** Queries using these clauses alias the parent post p and the comment c. */
export function visibleHealthPostSql(viewerId: string, access: PostAccess = "content") {
  return Prisma.sql`p.deleted_at IS NULL AND ${visibleHealthPersonSql(viewerId, Prisma.sql`p.author_member_id`, access)}`;
}

function visibleCommentContextSql(viewerId: string) {
  const poster = Prisma.sql`p.author_member_id`, commenter = Prisma.sql`c.author_member_id`;
  return Prisma.sql`${visibleHealthPostSql(viewerId)} AND c.deleted_at IS NULL
    AND (c.visibility = 'everyone' OR c.author_member_id = ${viewerId} OR p.author_member_id = ${viewerId})
    AND ${unblockedSql(poster, commenter)}
    AND (${poster} = ${commenter} OR EXISTS (${healthPartnersSql(poster, commenter)}))`;
}

export function visibleHealthCommentSql(viewerId: string) {
  const commenter = Prisma.sql`c.author_member_id`;
  return Prisma.sql`${visibleCommentContextSql(viewerId)}
    AND ${unblockedSql(viewerId, commenter)} AND ${healthAuthorSql(commenter)}`;
}

export interface VisiblePost {
  id: string;
  authorMemberId: string;
  version: number;
}

export async function findVisibleHealthPost(db: Db, viewerId: string, postId: string): Promise<VisiblePost | null> {
  const rows = await db.$queryRaw<VisiblePost[]>`SELECT p.id, p.author_member_id AS "authorMemberId", p.version
    FROM health_post p WHERE p.id = ${postId}::uuid AND ${visibleHealthPostSql(viewerId)}`;
  return rows[0] ?? null;
}

export async function findVisibleHealthComment(db: Db, viewerId: string, commentId: string) {
  const rows = await db.$queryRaw<Array<{ id: string; postId: string; authorMemberId: string; pushClaimedAt: Date | null }>>`
    SELECT c.id, c.post_id AS "postId", c.author_member_id AS "authorMemberId", c.push_claimed_at AS "pushClaimedAt"
    FROM health_post_comment c JOIN health_post p ON p.id = c.post_id
    WHERE c.id = ${commentId}::uuid AND ${visibleHealthCommentSql(viewerId)}`;
  return rows[0] ?? null;
}
