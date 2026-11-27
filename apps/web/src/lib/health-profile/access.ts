import "server-only";
import { Prisma } from "@prisma/client";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { assertGameMemberAuthCurrentForRead, assertGameMemberAuthCurrentTx } from "../game/http/auth";
import { gameNotFound } from "../game/http/errors";
import { visibleHealthPersonSql } from "../health-wins/audience";
import { getPrisma } from "../prisma";

export type ProfileAuth = HostedNativeMemberAuth;
export type ProfileDb = Prisma.TransactionClient;

export async function assertProfileAccess(tx: ProfileDb, auth: ProfileAuth, owner: string, write = false) {
  if (write) await assertGameMemberAuthCurrentTx(auth, tx);
  else await assertGameMemberAuthCurrentForRead(auth, tx);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: tx });
  const rows = await tx.$queryRaw`SELECT 1 WHERE ${visibleHealthPersonSql(auth.member.id, Prisma.sql`${owner}::text`)}`;
  if (!Array.isArray(rows) || !rows.length) throw gameNotFound();
}

export function withProfileWrite<T>(auth: ProfileAuth, save: (tx: ProfileDb, profile: { timeZone: string }) => Promise<T>) {
  const member = auth.member.id;
  return getPrisma().$transaction(async tx => {
    await assertProfileAccess(tx, auth, member, true);
    const [profile] = await tx.$queryRaw<{ timeZone: string }[]>`
      SELECT time_zone AS "timeZone" FROM game_profile WHERE member_id = ${member} FOR UPDATE`;
    if (!profile) throw gameNotFound();
    return save(tx, profile);
  });
}
