import "server-only";
import { Prisma } from "@prisma/client";
import { gamePartnersSql } from "../game/partners";
import { activeHostedPersonAccessSql } from "../hosted-onboarding/member-access-projections";
import { hostedLaunchConsentGrantedSql } from "../legal/consent";
import { healthFeedAuthors } from "./flag";

type Db = Pick<Prisma.TransactionClient, "$queryRaw">;

type PostAccess = "content" | "includeOwnerReceipt";

function healthAuthorSql(memberId: Prisma.Sql, receiptOwner?: string) {
  const authors = healthFeedAuthors();
  // Keep PostgreSQL checking this author by ID instead of joining the whole eligible population.
  return Prisma.sql`EXISTS (SELECT 1 FROM hosted_member author WHERE author.id = ${memberId}
    ${authors === "everyone" ? Prisma.empty : Prisma.sql`AND author.id = ANY(${authors}::text[])`}
    AND ${activeHostedPersonAccessSql(Prisma.sql`author`)}
    AND (${receiptOwner === undefined ? Prisma.empty : Prisma.sql`author.id = ${receiptOwner} OR`}
      ${hostedLaunchConsentGrantedSql(Prisma.sql`author.id`)}) OFFSET 0)`;
}

function unblockedSql(first: string | Prisma.Sql, subject: Prisma.Sql, hides: "both" | "bySubject" = "both") {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM game_block b WHERE
      (b.blocker_member_id = ${first} AND b.blocked_member_id = ${subject}) OR
      (b.blocked_member_id = ${first} AND b.blocker_member_id = ${subject}))
    AND NOT EXISTS (SELECT 1 FROM health_feed_hide h WHERE
      (h.member_id = ${subject} AND h.hidden_member_id = ${first})
      ${hides === "both" ? Prisma.sql`OR (h.member_id = ${first} AND h.hidden_member_id = ${subject})` : Prisma.empty})`;
}

function healthPersonAllowedSql(viewerId: string, subject: Prisma.Sql, access: PostAccess) {
  return Prisma.sql`${unblockedSql(viewerId, subject)}
    AND ${healthAuthorSql(subject, access === "includeOwnerReceipt" ? viewerId : undefined)}`;
}

/** A hide can identify someone the viewer could see through a game or a comment before hiding them. */
export function hiddenHealthIdentitySql(viewerId: string, subject: Prisma.Sql) {
  return Prisma.sql`${unblockedSql(viewerId, subject, "bySubject")} AND ${healthAuthorSql(subject)}
    AND (EXISTS (${gamePartnersSql(viewerId, subject)}) OR EXISTS (
      SELECT 1 FROM health_post_comment c JOIN health_post p ON p.id = c.post_id
      WHERE c.author_member_id = ${subject} AND ${visibleHealthPostSql(viewerId)}
        AND ${commentContextOnPostSql(viewerId, Prisma.sql`p.author_member_id`)}
    ))`;
}

export function eligibleHealthAuthorsSql(viewerId: string) {
  return Prisma.sql`SELECT partner.member_id FROM
    (SELECT ${viewerId}::text AS member_id UNION ${gamePartnersSql(viewerId)}) partner
    WHERE ${healthPersonAllowedSql(viewerId, Prisma.sql`partner.member_id`, "includeOwnerReceipt")}`;
}

export function visibleHealthPersonSql(viewerId: string, subject: Prisma.Sql, access: PostAccess = "content") {
  return Prisma.sql`(${subject} = ${viewerId} OR EXISTS (${gamePartnersSql(viewerId, subject)}))
    AND ${healthPersonAllowedSql(viewerId, subject, access)}`;
}

/** Queries using these clauses alias the parent post p and the comment c. */
export function visibleHealthPostSql(viewerId: string, access: PostAccess = "content") {
  return Prisma.sql`p.deleted_at IS NULL AND ${visibleHealthPersonSql(viewerId, Prisma.sql`p.author_member_id`, access)}`;
}

function commentContextOnPostSql(viewerId: string, poster: Prisma.Sql) {
  const commenter = Prisma.sql`c.author_member_id`;
  return Prisma.sql`c.deleted_at IS NULL
    AND (c.visibility = 'everyone' OR c.author_member_id = ${viewerId} OR ${poster} = ${viewerId})
    AND ${unblockedSql(poster, commenter)}
    AND (${poster} = ${commenter} OR EXISTS (${gamePartnersSql(poster, commenter)}))`;
}

export function visibleHealthCommentOnPostSql(viewerId: string, poster: Prisma.Sql) {
  const commenter = Prisma.sql`c.author_member_id`;
  return Prisma.sql`${commentContextOnPostSql(viewerId, poster)}
    AND ${unblockedSql(viewerId, commenter)} AND ${healthAuthorSql(commenter)}`;
}

export function visibleHealthCommentSql(viewerId: string) {
  return Prisma.sql`${visibleHealthPostSql(viewerId)}
    AND ${visibleHealthCommentOnPostSql(viewerId, Prisma.sql`p.author_member_id`)}`;
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
