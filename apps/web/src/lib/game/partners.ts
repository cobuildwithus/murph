import "server-only";
import { Prisma } from "@prisma/client";

/** Current joined seats shared with the member. Cancellation makes the game void. */
export function gamePartnersSql(member: string | Prisma.Sql, subject?: Prisma.Sql) {
  return Prisma.sql`SELECT partner.member_id FROM game_player own
    JOIN game_player partner ON partner.game_id = own.game_id
    JOIN game g ON g.id = own.game_id
    WHERE own.member_id = ${member} AND partner.member_id IS NOT NULL
      ${subject ? Prisma.sql`AND partner.member_id = ${subject}` : Prisma.empty}
      AND own.joined_at IS NOT NULL AND own.left_at IS NULL
      AND partner.joined_at IS NOT NULL AND partner.left_at IS NULL
      AND g.status IN ('live', 'settled')`;
}
